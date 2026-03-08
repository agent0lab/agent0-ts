/**
 * Integration test for Agent Feedback Flow with IPFS Pin
 * Submits feedback from a client to a freshly-registered agent and verifies data integrity.
 *
 * Flow:
 * 1. Create and register a new agent (so the test doesn't rely on a hardcoded agentId)
 * 2. Client submits one or more feedback entries
 * 3. Verify feedback data consistency (value, tags, mcpTool, a2aSkills)
 * 4. Wait for blockchain finalization
 * 5. Verify feedback can be retrieved and searched
 */

import { SDK } from '../src/index';
import { CHAIN_ID, RPC_URL, AGENT_PRIVATE_KEY, PINATA_JWT, CLIENT_PRIVATE_KEY, printConfig } from './config';

const HAS_REQUIRED_ENV =
  Boolean(RPC_URL && RPC_URL.trim() !== '') &&
  Boolean(AGENT_PRIVATE_KEY && AGENT_PRIVATE_KEY.trim() !== '') &&
  Boolean(CLIENT_PRIVATE_KEY && CLIENT_PRIVATE_KEY.trim() !== '') &&
  Boolean(PINATA_JWT && PINATA_JWT.trim() !== '');

// These are live/integration tests (on-chain + IPFS).
// Default: enabled when env vars are present. Set RUN_LIVE_TESTS=0 to disable.
const RUN_LIVE_TESTS = process.env.RUN_LIVE_TESTS !== '0';
const describeMaybe = RUN_LIVE_TESTS && HAS_REQUIRED_ENV ? describe : describe.skip;
const itMaybe = RUN_LIVE_TESTS && HAS_REQUIRED_ENV ? it : it.skip;

// Client configuration (different wallet)
const clientPrivateKey = CLIENT_PRIVATE_KEY;

function generateFeedbackData(index: number) {
  const scores = [50, 75, 80, 85, 90, 95];
  const tagsSets = [
    ['data_analysis', 'enterprise'],
    ['code_generation', 'enterprise'],
    ['natural_language_understanding', 'enterprise'],
    ['problem_solving', 'enterprise'],
    ['communication', 'enterprise'],
  ];
  const mcpTools = [
    'data_analysis',
    'code_generation',
    'natural_language_understanding',
    'problem_solving',
    'communication',
  ];
  const skills = ['python', 'javascript', 'machine_learning', 'web_development', 'cloud_computing'];

  return {
    value: scores[Math.floor(Math.random() * scores.length)],
    tags: tagsSets[Math.floor(Math.random() * tagsSets.length)],
    mcpTool: mcpTools[Math.floor(Math.random() * mcpTools.length)],
    a2aSkills: [skills[Math.floor(Math.random() * skills.length)]],
    a2aContextId: 'enterprise',
  };
}

describeMaybe('Agent Feedback Flow with IPFS Pin', () => {
  let agentSdk: SDK;
  let clientSdk: SDK;
  let agentSdkWithSigner: SDK | undefined;
  let clientAddress: string;
  let agentId: string;
  let feedbackSubmitted = false;
  let submittedFeedbackIndex: number | undefined;
  let clientFeedbackId: string | undefined;

  beforeAll(() => {
    printConfig();
  });

  itMaybe('should create and register an agent for feedback tests', async () => {
    // Use a signer so we can mint; keep IPFS configured since feedback files are stored on IPFS.
    const sdkConfig = {
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
      ipfs: 'pinata' as const,
      pinataJwt: PINATA_JWT,
      privateKey: AGENT_PRIVATE_KEY,
    };

    agentSdkWithSigner = new SDK(sdkConfig);
    if (agentSdkWithSigner.isReadOnly) {
      throw new Error('Failed to initialize agent signer. Check AGENT_PRIVATE_KEY in .env file.');
    }

    // Also keep a read-only instance (used by some code paths)
    agentSdk = new SDK({
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
      ipfs: 'pinata' as const,
      pinataJwt: PINATA_JWT,
    });

    const unique = Math.floor(Math.random() * 1_000_000);
    const agent = agentSdkWithSigner.createAgent(
      `Feedback Test Agent ${unique}`,
      `Feedback test agent created at ${Math.floor(Date.now() / 1000)}`,
      `https://example.com/feedback_test_${unique}.png`
    );

    // Register via HTTP URI (fast, no dependency on loading the file back)
    const mockUri = `https://example.com/agents/feedback_test_${unique}.json`;
    const regTx = await agent.registerHTTP(mockUri);
    const { result: reg } = await regTx.waitConfirmed({ timeoutMs: 120_000 });
    agentId = reg.agentId!;

    expect(agentId).toBeTruthy();
    expect(agent.agentId).toBe(agentId);
  });

  itMaybe('should initialize client SDK', async () => {
    const sdkConfig = {
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
      ipfs: 'pinata' as const,
      pinataJwt: PINATA_JWT,
    };

    clientSdk = new SDK({ ...sdkConfig, privateKey: clientPrivateKey });
    if (clientSdk.isReadOnly) {
      throw new Error('Failed to initialize client signer. Check CLIENT_PRIVATE_KEY in .env file.');
    }
    clientAddress = (await clientSdk.chainClient.getAddress()) || (await clientSdk.chainClient.ensureAddress());

    // Note: feedbackAuth is no longer required in ERC-8004 Jan 2026 spec
    // Clients can now submit feedback directly without pre-authorization
  });

  // agentSdkWithSigner is initialized as part of agent registration above

  itMaybe('should submit feedback with IPFS storage', async () => {
    if (!clientSdk || !clientAddress) {
      throw new Error('Required SDKs not initialized. Previous tests must pass first.');
    }

    const numFeedback = 1;
    const feedbackEntries: Array<{
      index: number;
      data: ReturnType<typeof generateFeedbackData>;
      feedback: any;
    }> = [];

    for (let i = 0; i < numFeedback; i++) {
      const feedbackData = generateFeedbackData(i + 1);

      const tag1 = feedbackData.tags[0];
      const tag2 = feedbackData.tags[1];
      const endpoint = 'https://example.com/feedback'; // optional on-chain field

      // Prepare off-chain feedback file (spec-aligned fields)
      const feedbackFile = clientSdk.prepareFeedbackFile({
        mcpTool: feedbackData.mcpTool,
        a2aSkills: feedbackData.a2aSkills,
        a2aContextId: feedbackData.a2aContextId,
      });

      // Submit feedback - this will fail if client wallet has insufficient funds
      // Note: feedbackAuth is no longer required in ERC-8004 Jan 2026 spec
      let feedback: any;
      try {
        const tx = await clientSdk.giveFeedback(
          agentId,
          feedbackData.value,
          tag1,
          tag2,
          endpoint,
          feedbackFile
        );
        const mined = await tx.waitConfirmed({ timeoutMs: 120_000 });
        feedback = mined.result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // These are live tests; if the configured wallet is unfunded / RPC is restrictive, don't fail the suite.
        if (
          msg.toLowerCase().includes('insufficient funds') ||
          msg.toLowerCase().includes('gas required exceeds allowance')
        ) {
          // eslint-disable-next-line no-console
          console.warn(`[live-test] Skipping feedback submission due to funding/RPC issue: ${msg}`);
          return;
        }
        throw err;
      }

      // Extract actual feedback index from the returned Feedback object
      const actualFeedbackIndex = feedback.id[2];
      feedbackSubmitted = true;
      submittedFeedbackIndex = actualFeedbackIndex;

      feedbackEntries.push({
        index: actualFeedbackIndex,
        data: feedbackData,
        feedback,
      });

      expect(feedback.value).toBe(feedbackData.value);
      expect(feedback.tags).toEqual(feedbackData.tags);
      expect(feedback.mcpTool).toBe(feedbackData.mcpTool);
      expect(feedback.a2aSkills).toEqual(feedbackData.a2aSkills);
      expect(feedback.fileURI).toBeTruthy();
      clientFeedbackId = feedback.idString;

      // Wait between submissions
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  });

  itMaybe('should append response to feedback', async () => {
    if (!agentSdkWithSigner || !clientAddress) {
      throw new Error('Required SDKs not initialized. Previous tests must pass first.');
    }
    if (!feedbackSubmitted || submittedFeedbackIndex === undefined) {
      // eslint-disable-next-line no-console
      console.warn('[live-test] Skipping appendResponse because no feedback was submitted');
      return;
    }

    // This test assumes feedback was submitted in previous test
    // The feedback index should be 1 if feedback was successfully submitted
    const feedbackIndex = submittedFeedbackIndex;

    const responseUri = 'ipfs://QmExampleResponse';
    const responseHash = '0x' + '00'.repeat(32);

    // Agent responds to the client's feedback
    // This will fail if feedback doesn't exist (index out of bounds)
    const tx = await agentSdkWithSigner.appendResponse(agentId, clientAddress, feedbackIndex, {
      uri: responseUri,
      hash: responseHash,
    });
    expect(tx.hash).toBeTruthy();
    await tx.waitConfirmed({ timeoutMs: 120_000 });
  });

  itMaybe('should retrieve feedback using getFeedback', async () => {
    if (!agentSdkWithSigner || !clientAddress) {
      throw new Error('Required SDKs not initialized. Previous tests must pass first.');
    }
    if (!feedbackSubmitted || submittedFeedbackIndex === undefined) {
      // eslint-disable-next-line no-console
      console.warn('[live-test] Skipping getFeedback because no feedback was submitted');
      return;
    }

    // Wait for blockchain and subgraph
    await new Promise((resolve) => setTimeout(resolve, 15000)); // 15 seconds

    const feedbackIndex = submittedFeedbackIndex; // Should match the feedback submitted in previous test

    // This will fail if feedback doesn't exist (index out of bounds)
    const retrievedFeedback = await agentSdkWithSigner.getFeedback(agentId, clientAddress, feedbackIndex);

    expect(retrievedFeedback).toBeTruthy();
    expect(retrievedFeedback.value).toBeDefined();
    expect(retrievedFeedback.agentId).toBe(agentId);
  });

  itMaybe('should search feedback with filters', async () => {
    if (!agentSdkWithSigner) {
      throw new Error('Required SDKs not initialized. Previous tests must pass first.');
    }

    // Wait for subgraph indexing
    await new Promise((resolve) => setTimeout(resolve, 60000)); // 60 seconds

    // Search by tags
    const tagResults = await agentSdkWithSigner.searchFeedback({
      agentId,
      tags: ['enterprise'],
    });
    expect(Array.isArray(tagResults)).toBe(true);

    // Search by value range
    const valueResults = await agentSdkWithSigner.searchFeedback({ agentId }, { minValue: 75, maxValue: 95 });
    expect(Array.isArray(valueResults)).toBe(true);
  });

  itMaybe('should support reviewer-only searchFeedback (agentId omitted)', async () => {
    if (!agentSdkWithSigner || !clientAddress) {
      throw new Error('Required SDKs not initialized. Previous tests must pass first.');
    }
    if (!feedbackSubmitted) {
      // eslint-disable-next-line no-console
      console.warn('[live-test] Skipping reviewer-only search because no feedback was submitted');
      return;
    }

    // Wait for subgraph indexing
    await new Promise((resolve) => setTimeout(resolve, 60000)); // 60 seconds

    const results = await agentSdkWithSigner.searchFeedback({ reviewers: [clientAddress] });
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    if (clientFeedbackId) {
      // Ensure at least one result is from this test run
      const found = results.some((f: any) => f.idString === clientFeedbackId);
      expect(found).toBe(true);
    }
  });

  itMaybe('should support multi-agent searchFeedback (agents[])', async () => {
    if (!agentSdkWithSigner) {
      throw new Error('Required SDKs not initialized. Previous tests must pass first.');
    }
    if (!feedbackSubmitted) {
      // eslint-disable-next-line no-console
      console.warn('[live-test] Skipping multi-agent search because no feedback was submitted');
      return;
    }

    // Best-effort: pick a second agent from the subgraph to ensure the "agents" code path is exercised.
    // If none are found, fall back to a single-agent array (still validates the new param path).
    let otherAgentId: string | undefined;
    try {
      const agents = await agentSdkWithSigner.searchAgents({});
      otherAgentId = agents.find((a) => a.agentId && a.agentId !== agentId)?.agentId;
    } catch {
      // ignore and use fallback
    }

    const agents = otherAgentId ? [agentId, otherAgentId] : [agentId];
    const results = await agentSdkWithSigner.searchFeedback({ agents });
    expect(Array.isArray(results)).toBe(true);
  });

  it('should reject empty searchFeedback filters', async () => {
    // This is a safety guard introduced in 1.4.0. It should throw before any network call.
    const sdk = new SDK({ chainId: CHAIN_ID, rpcUrl: RPC_URL });
    await expect(sdk.searchFeedback({} as any)).rejects.toThrow();
  });
});

