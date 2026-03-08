/**
 * Unit tests for subgraph-aligned Feedback: Feedback uses spec fields
 * (mcpTool, a2aSkills, a2aContextId, a2aTaskId, oasfSkills, oasfDomains)
 * and subgraph queries select those fields (no legacy capability/skill/task/context).
 *
 * Live subgraph tests run when RUN_LIVE_TESTS=1 (same as Py: SUBGRAPH_URL + RPC).
 */

import { SDK } from '../src/index.js';
import { FeedbackManager } from '../src/core/feedback-manager.js';
import type { SubgraphClient } from '../src/core/subgraph-client.js';
import type { ChainClient } from '../src/core/chain-client.js';
import { CHAIN_ID, RPC_URL, SUBGRAPH_URL, AGENT_ID, printConfig } from './config.js';

const RUN_LIVE = process.env.RUN_LIVE_TESTS === '1';
const describeLive = RUN_LIVE ? describe : describe.skip;

const SPEC_FIELDS = [
  'mcpTool',
  'mcpPrompt',
  'mcpResource',
  'a2aSkills',
  'a2aContextId',
  'a2aTaskId',
  'oasfSkills',
  'oasfDomains',
] as const;

describe('Subgraph feedback alignment', () => {
  it('searchFeedback maps subgraph feedbackFile spec fields to Feedback', async () => {
    const mockSubgraph: SubgraphClient = {
      searchFeedback: async () => [
        {
          id: '8453:99:0x1234567890123456789012345678901234567890:1',
          value: '75',
          tag1: 'tag1',
          tag2: null,
          endpoint: null,
          feedbackURI: null,
          isRevoked: false,
          createdAt: '1000',
          feedbackFile: {
            id: 'ff-1',
            feedbackId: 'f1',
            text: 'Great',
            mcpTool: 'tools',
            mcpPrompt: null,
            mcpResource: null,
            a2aSkills: ['skill-a'],
            a2aContextId: 'ctx-1',
            a2aTaskId: 'task-1',
            oasfSkills: ['oasf-skill'],
            oasfDomains: ['domain-a'],
            proofOfPaymentFromAddress: null,
            proofOfPaymentToAddress: null,
            proofOfPaymentChainId: null,
            proofOfPaymentTxHash: null,
            tag1: null,
            tag2: null,
            createdAt: null,
          },
          responses: [],
        },
      ],
    } as any;

    const mockChain: ChainClient = {} as any;

    const manager = new FeedbackManager(
      mockChain,
      undefined,
      undefined,
      undefined,
      mockSubgraph
    );

    const results = await manager.searchFeedback({
      agents: ['8453:99'],
    });

    expect(results.length).toBe(1);
    const feedback = results[0]!;
    expect(feedback.mcpTool).toBe('tools');
    expect(feedback.a2aSkills).toEqual(['skill-a']);
    expect(feedback.a2aContextId).toBe('ctx-1');
    expect(feedback.a2aTaskId).toBe('task-1');
    expect(feedback.oasfSkills).toEqual(['oasf-skill']);
    expect(feedback.oasfDomains).toEqual(['domain-a']);
    expect(feedback.value).toBe(75);
    expect(feedback.text).toBe('Great');
    expect(feedback.tags).toContain('tag1');
  });
});

// Run with: RUN_LIVE_TESTS=1 npm test -- --testPathPattern=subgraph-feedback-alignment
// Same default SUBGRAPH_URL as Py (tests/config); Feedback shape is spec-aligned in both SDKs.
describeLive('Live subgraph (parity with Py)', () => {
  it('searchFeedback succeeds and returns Feedback with spec-aligned shape', async () => {
    printConfig();
    const sdk = new SDK({
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
      subgraphOverrides: { [CHAIN_ID]: SUBGRAPH_URL },
    });
    expect(sdk.subgraphClient).toBeDefined();
    const feedbacks = await sdk.searchFeedback({ agentId: AGENT_ID });
    expect(Array.isArray(feedbacks)).toBe(true);
    for (const fb of feedbacks) {
      for (const key of SPEC_FIELDS) {
        expect(fb).toHaveProperty(key);
      }
    }
  });

  it('getReputationSummary succeeds', async () => {
    const sdk = new SDK({
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
      subgraphOverrides: { [CHAIN_ID]: SUBGRAPH_URL },
    });
    const result = await sdk.getReputationSummary(AGENT_ID);
    expect(result).toBeDefined();
    expect(typeof result.count).toBe('number');
    expect(typeof result.averageValue).toBe('number');
  });
});
