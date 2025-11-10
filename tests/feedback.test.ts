/**
 * Integration test for Agent Feedback Flow with IPFS Pin
 * Submits feedback from a client to an existing agent and verifies data integrity.
 *
 * Flow:
 * 1. Load existing agent by ID
 * 2. Client submits multiple feedback entries
 * 3. Verify feedback data consistency (score, tags, capability, skill)
 * 4. Wait for blockchain finalization
 * 5. Verify feedback can be retrieved (if SDK supports it)
 */

import { SDK } from '../src/index';
import { CHAIN_ID, RPC_URL, AGENT_PRIVATE_KEY, PINATA_JWT, AGENT_ID, CLIENT_PRIVATE_KEY, printConfig } from './config';

// Client configuration (different wallet)
// Must be set in .env file
if (!CLIENT_PRIVATE_KEY || CLIENT_PRIVATE_KEY.trim() === '') {
  throw new Error('CLIENT_PRIVATE_KEY is required for feedback tests. Set it in .env file.');
}
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

  const capabilities = [
    'data_analysis',
    'code_generation',
    'natural_language_understanding',
    'problem_solving',
    'communication',
  ];

  const skills = ['python', 'javascript', 'machine_learning', 'web_development', 'cloud_computing'];

  return {
    score: scores[Math.floor(Math.random() * scores.length)],
    tags: tagsSets[Math.floor(Math.random() * tagsSets.length)],
    capability: capabilities[Math.floor(Math.random() * capabilities.length)],
    skill: skills[Math.floor(Math.random() * skills.length)],
    context: 'enterprise',
  };
}

describe('Agent Feedback Flow with IPFS Pin', () => {
  let agentSdk: SDK;
  let clientSdk: SDK;
  let agentSdkWithSigner: SDK;
  let clientAddress: string;
  const agentId = AGENT_ID;

  beforeAll(() => {
    printConfig();
  });

  it('should load existing agent', async () => {
    // SDK Configuration
    const sdkConfig = {
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
      ipfs: 'pinata' as const,
      pinataJwt: PINATA_JWT,
    };

    agentSdk = new SDK(sdkConfig); // Read-only for loading

    const agent = await agentSdk.loadAgent(agentId);
    expect(agent.name).toBeTruthy();
    expect(agent.agentId).toBe(agentId);
  });

  it('should sign feedback authorization', async () => {
    const sdkConfig = {
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
      ipfs: 'pinata' as const,
      pinataJwt: PINATA_JWT,
    };

    if (!AGENT_PRIVATE_KEY || AGENT_PRIVATE_KEY.trim() === '') {
      throw new Error('AGENT_PRIVATE_KEY is required for feedback tests. Set it in .env file.');
    }

    clientSdk = new SDK({ ...sdkConfig, signer: clientPrivateKey });
    if (!clientSdk.web3Client.signer) {
      throw new Error('Failed to initialize client signer. Check CLIENT_PRIVATE_KEY in .env file.');
    }
    clientAddress = clientSdk.web3Client.address!;
    if (!clientAddress) {
      throw new Error('Failed to get client address from signer.');
    }

    // Agent SDK needs to be initialized with signer for signing feedback auth
    agentSdkWithSigner = new SDK({ ...sdkConfig, signer: AGENT_PRIVATE_KEY });
    if (!agentSdkWithSigner.web3Client.signer) {
      throw new Error('Failed to initialize agent signer. Check AGENT_PRIVATE_KEY in .env file.');
    }

    // Sign feedback authorization
    const feedbackAuth = await agentSdkWithSigner.signFeedbackAuth(agentId, clientAddress, undefined, 24);
    expect(feedbackAuth).toBeTruthy();
    expect(feedbackAuth.length).toBeGreaterThan(0);
  });

  it('should submit feedback with IPFS storage', async () => {
    if (!clientSdk || !agentSdkWithSigner || !clientAddress) {
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

      // Prepare feedback file
      const feedbackFile = clientSdk.prepareFeedback(
        agentId,
        feedbackData.score,
        feedbackData.tags,
        undefined, // text
        feedbackData.capability,
        undefined, // name
        feedbackData.skill,
        undefined, // task
        { context: feedbackData.context }
      );

      // Sign feedback authorization
      const feedbackAuth = await agentSdkWithSigner.signFeedbackAuth(agentId, clientAddress, undefined, 24);

      // Submit feedback - this will fail if client wallet has insufficient funds
      const feedback = await clientSdk.giveFeedback(agentId, feedbackFile, feedbackAuth);

      // Extract actual feedback index from the returned Feedback object
      const actualFeedbackIndex = feedback.id[2];

      feedbackEntries.push({
        index: actualFeedbackIndex,
        data: feedbackData,
        feedback,
      });

      expect(feedback.score).toBe(feedbackData.score);
      expect(feedback.tags).toEqual(feedbackData.tags);
      expect(feedback.capability).toBe(feedbackData.capability);
      expect(feedback.skill).toBe(feedbackData.skill);
      expect(feedback.fileURI).toBeTruthy();

      // Wait between submissions
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  });

  it('should append response to feedback', async () => {
    if (!agentSdkWithSigner || !clientAddress) {
      throw new Error('Required SDKs not initialized. Previous tests must pass first.');
    }

    // This test assumes feedback was submitted in previous test
    // The feedback index should be 1 if feedback was successfully submitted
    const feedbackIndex = 1;

    const responseUri = 'ipfs://QmExampleResponse';
    const responseHash = '0x' + '00'.repeat(32);

    // Agent responds to the client's feedback
    // This will fail if feedback doesn't exist (index out of bounds)
    const txHash = await agentSdkWithSigner.appendResponse(agentId, clientAddress, feedbackIndex, {
      uri: responseUri,
      hash: responseHash,
    });
    expect(txHash).toBeTruthy();
  });

  it('should retrieve feedback using getFeedback', async () => {
    if (!agentSdkWithSigner || !clientAddress) {
      throw new Error('Required SDKs not initialized. Previous tests must pass first.');
    }

    // Wait for blockchain and subgraph
    await new Promise((resolve) => setTimeout(resolve, 15000)); // 15 seconds

    const feedbackIndex = 1; // Should match the feedback submitted in previous test

    // This will fail if feedback doesn't exist (index out of bounds)
    const retrievedFeedback = await agentSdkWithSigner.getFeedback(agentId, clientAddress, feedbackIndex);

    expect(retrievedFeedback).toBeTruthy();
    expect(retrievedFeedback.score).toBeDefined();
    expect(retrievedFeedback.agentId).toBe(agentId);
  });

  it('should search feedback with filters', async () => {
    if (!agentSdkWithSigner) {
      throw new Error('Required SDKs not initialized. Previous tests must pass first.');
    }

    // Wait for subgraph indexing
    await new Promise((resolve) => setTimeout(resolve, 60000)); // 60 seconds

    // Search by capability
    const capabilityResults = await agentSdkWithSigner.searchFeedback(agentId, undefined, ['data_analysis']);
    expect(Array.isArray(capabilityResults)).toBe(true);

    // Search by skill
    const skillResults = await agentSdkWithSigner.searchFeedback(agentId, undefined, undefined, ['python']);
    expect(Array.isArray(skillResults)).toBe(true);

    // Search by tags
    const tagResults = await agentSdkWithSigner.searchFeedback(agentId, ['enterprise']);
    expect(Array.isArray(tagResults)).toBe(true);

    // Search by score range
    const scoreResults = await agentSdkWithSigner.searchFeedback(
      agentId,
      undefined,
      undefined,
      undefined,
      75,
      95
    );
    expect(Array.isArray(scoreResults)).toBe(true);
  });
});

