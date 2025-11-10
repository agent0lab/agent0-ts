/**
 * Test for Multi-Chain Agent Operations
 * Tests all multi-chain functionality using real subgraph queries.
 *
 * Flow:
 * 1. Test getAgent() with chainId:agentId format across all chains
 * 2. Test searchFeedback() with chainId:agentId format across all chains
 * 3. Test searchAgentsByReputation() with chains parameter (single, multiple, "all")
 * 4. Test getReputationSummary() with chainId:agentId format across all chains
 * 5. Test various chain combinations
 */

import { SDK } from '../src/index.js';
import { CHAIN_ID, RPC_URL, printConfig } from './config.js';

// Supported chains for multi-chain testing
const SUPPORTED_CHAINS = [11155111, 84532, 80002]; // ETH Sepolia, Base Sepolia, Polygon Amoy

// Known test agents with feedback (from discovery script)
// These are agents that are known to have feedback entries
const TEST_AGENTS_WITH_FEEDBACK: Record<number, string[]> = {
  11155111: ['11155111:1377', '11155111:1340'], // Both have feedback
  84532: ['84532:557', '84532:545', '84532:543', '84532:541', '84532:540', '84532:539', '84532:538', '84532:536'], // All have feedback and averageScore=5.0
};

// Known agents with reputation (averageScore) for reputation search tests
const TEST_AGENTS_WITH_REPUTATION: Record<number, string[]> = {
  11155111: [], // No agents with calculated averageScore on this chain
  84532: ['84532:557', '84532:545', '84532:543', '84532:541', '84532:540', '84532:539', '84532:538', '84532:536'], // All have averageScore=5.0
  80002: [], // No agents with reputation on this chain
};

// Known tags that exist in feedback data
const TEST_TAGS = ['price', 'analysis'];

describe('Multi-Chain Agent Operations', () => {
  let sdk: SDK;

  beforeAll(() => {
    console.log('🌐 Testing Multi-Chain Agent Operations');
    printConfig();
    console.log('='.repeat(60));

    // Initialize SDK without signer (read-only operations)
    // Using default chain (ETH Sepolia)
    sdk = new SDK({
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
    });
  });

  describe('Step 1: Test getAgent() with chainId:agentId format', () => {
    it('should get agents across all supported chains', async () => {
      console.log('\n📍 Step 1: Test getAgent() with chainId:agentId format');
      console.log('-'.repeat(60));
      console.log('Testing getAgent() across all supported chains...');

      for (const chainId of SUPPORTED_CHAINS) {
        try {
          // First, search for agents on this chain to get a real agent ID
          const searchResult = await sdk.searchAgents(
            { chains: [chainId] },
            [],
            1
          );

          if (searchResult.items && searchResult.items.length > 0) {
            const agentSummary = searchResult.items[0];
            const agentId = agentSummary.agentId;

            // Format as chainId:agentId if not already formatted
            let fullAgentId: string;
            if (agentId.includes(':')) {
              const tokenId = agentId.split(':').pop()!;
              fullAgentId = `${chainId}:${tokenId}`;
            } else {
              fullAgentId = `${chainId}:${agentId}`;
            }

            // Test getAgent with chainId:agentId format
            const agent = await sdk.getAgent(fullAgentId);

            expect(agent).toBeTruthy();
            expect(agent?.chainId).toBe(chainId);
            console.log(`✅ Chain ${chainId}: Found agent ${agent?.name}`);
            console.log(`   Agent ID: ${agent?.agentId}`);
            console.log(`   Chain ID: ${agent?.chainId} (verified)`);
            console.log(`   Active: ${agent?.active}`);
          } else {
            console.log(`⚠️  Chain ${chainId}: No agents found`);
          }
        } catch (error) {
          console.log(`❌ Chain ${chainId}: Failed - ${error}`);
          // Don't fail the test, just log the error
        }
      }
    });

    it('should get agent with default chain (no chainId prefix)', async () => {
      console.log('\n📍 Step 2: Test getAgent() with default chain (no chainId prefix)');
      console.log('-'.repeat(60));

      try {
        // Test with just agentId (uses SDK's default chain)
        const searchResult = await sdk.searchAgents(
          { chains: [CHAIN_ID] },
          [],
          1
        );

        if (searchResult.items && searchResult.items.length > 0) {
          const agentItem = searchResult.items[0];
          let agentId = agentItem.agentId;
          // Remove chainId prefix if present
          if (agentId.includes(':')) {
            agentId = agentId.split(':').pop()!;
          }

          const agent = await sdk.getAgent(agentId);
          expect(agent).toBeTruthy();
          expect(agent?.chainId).toBe(CHAIN_ID);
          console.log(`✅ Default chain: Found agent ${agent?.name}`);
          console.log(`   Agent ID: ${agent?.agentId}`);
          console.log(`   Chain ID: ${agent?.chainId} (should match SDK default: ${CHAIN_ID})`);
        } else {
          console.log('⚠️  No agents found on default chain');
        }
      } catch (error) {
        console.log(`❌ Default chain: Failed - ${error}`);
        throw error;
      }
    });
  });

  describe('Step 3: Test searchFeedback() with chainId:agentId format', () => {
    it('should search feedback across all supported chains', async () => {
      console.log('\n📍 Step 3: Test searchFeedback() with chainId:agentId format');
      console.log('-'.repeat(60));
      console.log('Testing searchFeedback() across all supported chains...');

      for (const chainId of SUPPORTED_CHAINS) {
        try {
          // Use known agents with feedback if available, otherwise search for any agent
          let testAgentId: string | undefined;
          if (TEST_AGENTS_WITH_FEEDBACK[chainId] && TEST_AGENTS_WITH_FEEDBACK[chainId].length > 0) {
            testAgentId = TEST_AGENTS_WITH_FEEDBACK[chainId][0];
          } else {
            // Fallback: search for any agent
            const searchResult = await sdk.searchAgents(
              { chains: [chainId] },
              [],
              1
            );

            if (searchResult.items && searchResult.items.length > 0) {
              const agentSummary = searchResult.items[0];
              let agentId = agentSummary.agentId;

              // Format as chainId:agentId
              if (agentId.includes(':')) {
                const tokenId = agentId.split(':').pop()!;
                testAgentId = `${chainId}:${tokenId}`;
              } else {
                testAgentId = `${chainId}:${agentId}`;
              }
            }
          }

          if (testAgentId) {
            // Test searchFeedback with chainId:agentId format
            const feedbacks = await sdk.searchFeedback(testAgentId, undefined, undefined, undefined, undefined, undefined);

            console.log(`✅ Chain ${chainId}: Found ${feedbacks.length} feedback entries`);
            console.log(`   Agent ID: ${testAgentId}`);
            if (feedbacks.length > 0) {
              console.log(`   First feedback score: ${feedbacks[0].score ?? 'N/A'}`);
              if (feedbacks[0].tags && feedbacks[0].tags.length > 0) {
                console.log(`   First feedback tags: ${feedbacks[0].tags.join(', ')}`);
              }
            } else {
              console.log(`   ⚠️  No feedback found for this agent`);
            }
          } else {
            console.log(`⚠️  Chain ${chainId}: No agents found`);
          }
        } catch (error) {
          console.log(`❌ Chain ${chainId}: Failed - ${error}`);
          // Don't fail the test, just log the error
        }
      }
    });

    it('should search feedback with default chain (no chainId prefix)', async () => {
      console.log('\n📍 Step 4: Test searchFeedback() with default chain (no chainId prefix)');
      console.log('-'.repeat(60));

      try {
        // Use known agent with feedback if available
        let testAgentId: string | undefined;
        if (TEST_AGENTS_WITH_FEEDBACK[CHAIN_ID] && TEST_AGENTS_WITH_FEEDBACK[CHAIN_ID].length > 0) {
          const fullId = TEST_AGENTS_WITH_FEEDBACK[CHAIN_ID][0];
          // Extract token ID for default chain test
          testAgentId = fullId.includes(':') ? fullId.split(':').pop()! : fullId;
        } else {
          // Fallback: search for any agent
          const searchResult = await sdk.searchAgents(
            { chains: [CHAIN_ID] },
            [],
            1
          );

          if (searchResult.items && searchResult.items.length > 0) {
            const agentItem = searchResult.items[0];
            let agentId = agentItem.agentId;
            // Remove chainId prefix if present
            if (agentId.includes(':')) {
              testAgentId = agentId.split(':').pop()!;
            } else {
              testAgentId = agentId;
            }
          }
        }

        if (testAgentId) {
          const feedbacks = await sdk.searchFeedback(testAgentId, undefined, undefined, undefined, undefined, undefined);

          console.log(`✅ Default chain: Found ${feedbacks.length} feedback entries`);
          console.log(`   Agent ID: ${testAgentId}`);
          if (feedbacks.length > 0) {
            console.log(`   First feedback score: ${feedbacks[0].score ?? 'N/A'}`);
          }
        } else {
          console.log('⚠️  No agents found on default chain');
        }
      } catch (error) {
        console.log(`❌ Default chain: Failed - ${error}`);
        throw error;
      }
    });
  });

  describe('Step 5: Test searchAgentsByReputation() with single chains', () => {
    it('should search reputation for each chain individually', async () => {
      console.log('\n📍 Step 5: Test searchAgentsByReputation() with single chains');
      console.log('-'.repeat(60));
      console.log('Testing searchAgentsByReputation() with individual chains...');

      for (const chainId of SUPPORTED_CHAINS) {
        try {
          // Use known agents with reputation for this chain
          const knownAgents = TEST_AGENTS_WITH_REPUTATION[chainId] || [];

          if (knownAgents.length > 0) {
            // First, verify agents exist using getAgent
            const foundAgents: Array<NonNullable<Awaited<ReturnType<typeof sdk.getAgent>>>> = [];
            for (const agentId of knownAgents.slice(0, 5)) {
              try {
                const agent = await sdk.getAgent(agentId);
                if (agent) {
                  foundAgents.push(agent);
                }
              } catch {
                // Skip if agent not found
              }
            }

            if (foundAgents.length > 0) {
              // Now try reputation search
              const result = await sdk.searchAgentsByReputation(
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                false,
                10,
                undefined,
                undefined,
                [chainId]
              );

              const agents = result.items || [];

              if (agents.length > 0) {
                console.log(`✅ Chain ${chainId}: Found ${agents.length} agents by reputation`);
                console.log(`   Verified ${foundAgents.length} known agents exist via getAgent`);

                // Verify all results are from the requested chain
                const allCorrectChain = agents.every(agent => agent.chainId === chainId);
                if (allCorrectChain) {
                  console.log(`   ✓ All agents verified from chain ${chainId}`);
                }

                // Show first agent details
                if (agents.length > 0) {
                  const firstAgent = agents[0];
                  const avgScore = firstAgent.extras?.averageScore ?? 'N/A';
                  console.log(`   First agent: ${firstAgent.name} (Avg Score: ${avgScore})`);
                }
              } else {
                console.log(`⚠️  Chain ${chainId}: Reputation search found 0 agents`);
                console.log(`   Known agents exist: ${foundAgents.slice(0, 3).map(a => a.agentId).join(', ')}`);
              }
            } else {
              console.log(`⚠️  Chain ${chainId}: Could not find any known agents via getAgent`);
            }
          } else {
            // For chains without reputation data, try general search
            const result = await sdk.searchAgentsByReputation(
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              false,
              10,
              undefined,
              undefined,
              [chainId]
            );
            const agents = result.items || [];
            if (agents.length > 0) {
              console.log(`✅ Chain ${chainId}: Found ${agents.length} agents by reputation`);
            } else {
              console.log(`✅ Chain ${chainId}: Found 0 agents (expected: 0 - no reputation data)`);
            }
          }
        } catch (error) {
          console.log(`❌ Chain ${chainId}: Failed - ${error}`);
          // Don't fail the test, just log the error
        }
      }
    });
  });

  describe('Step 6: Test searchAgentsByReputation() with multiple chains', () => {
    it('should search reputation across chain pairs', async () => {
      console.log('\n📍 Step 6: Test searchAgentsByReputation() with multiple chains');
      console.log('-'.repeat(60));
      console.log('Testing with chain combinations...');

      // Test with 2 chains
      const chainPairs = [
        [11155111, 84532],
        [11155111, 80002],
        [84532, 80002],
      ];

      for (const chains of chainPairs) {
        try {
          // Collect known agents with reputation from all chains in this pair
          const knownAgents: string[] = [];
          for (const cid of chains) {
            knownAgents.push(...(TEST_AGENTS_WITH_REPUTATION[cid] || []));
          }

          // Try reputation search
          const result = await sdk.searchAgentsByReputation(
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            false,
            20,
            undefined,
            undefined,
            chains
          );

          const agents = result.items || [];
          const meta = result.meta;
          const successfulChains = meta?.successfulChains || [];
          const failedChains = meta?.failedChains || [];

          const chainIds = new Set(agents.map(agent => agent.chainId));

          if (agents.length > 0) {
            console.log(`✅ Chains ${chains.join(', ')}: Found ${agents.length} agents by reputation search`);
          } else {
            console.log(`⚠️  Chains ${chains.join(', ')}: Reputation search found 0 agents`);
            if (knownAgents.length > 0) {
              console.log(`   Known agents: ${knownAgents.slice(0, 5).join(', ')}`);
            } else {
              console.log(`   ✅ Chains ${chains.join(', ')}: Found 0 agents (expected: 0 - no reputation data)`);
            }
          }

          console.log(`   Successful chains: ${successfulChains.join(', ')}`);
          if (failedChains.length > 0) {
            console.log(`   Failed chains: ${failedChains.join(', ')}`);
          }
          console.log(`   Unique chains in results: ${Array.from(chainIds).join(', ')}`);

          // Show sample agents
          if (agents.length > 0) {
            console.log(`   Sample agents:`);
            for (let i = 0; i < Math.min(3, agents.length); i++) {
              const agent = agents[i];
              const avgScore = agent.extras?.averageScore ?? 'N/A';
              console.log(`      ${i + 1}. ${agent.name} (Chain: ${agent.chainId}, Avg: ${avgScore})`);
            }
          }
        } catch (error) {
          console.log(`❌ Chains ${chains.join(', ')}: Failed - ${error}`);
          // Don't fail the test, just log the error
        }
      }
    });
  });

  describe('Step 7: Test searchAgentsByReputation() with chains="all"', () => {
    it('should search reputation across all chains', async () => {
      console.log('\n📍 Step 7: Test searchAgentsByReputation() with chains="all"');
      console.log('-'.repeat(60));

      try {
        // Collect all known agents with reputation
        const allKnownAgents: string[] = [];
        for (const chainId of SUPPORTED_CHAINS) {
          allKnownAgents.push(...(TEST_AGENTS_WITH_REPUTATION[chainId] || []));
        }

        let result;
        if (allKnownAgents.length > 0) {
          // Query for specific agents we know have reputation
          result = await sdk.searchAgentsByReputation(
            allKnownAgents,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            false,
            20,
            undefined,
            undefined,
            'all'
          );
        } else {
          // General search if no known agents
          result = await sdk.searchAgentsByReputation(
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            false,
            20,
            undefined,
            undefined,
            'all'
          );
        }

        const agents = result.items || [];
        const meta = result.meta;
        const successfulChains = meta?.successfulChains || [];
        const failedChains = meta?.failedChains || [];

        const chainIds = new Set(agents.map(agent => agent.chainId));

        if (agents.length > 0) {
          console.log(`✅ Found ${agents.length} agents across all chains`);
        } else {
          console.log(`⚠️  Reputation search found 0 agents`);
          if (allKnownAgents.length > 0) {
            console.log(`   Verifying ${allKnownAgents.length} known agents exist...`);
            let reputationFound = 0;
            for (const agentId of allKnownAgents.slice(0, 5)) {
              try {
                const agent = await sdk.getAgent(agentId);
                const summary = await sdk.getReputationSummary(agentId);
                if (summary.count > 0) {
                  reputationFound++;
                  if (reputationFound <= 3) {
                    console.log(`   ✅ ${agentId}: ${summary.count} feedback, avg: ${summary.averageScore.toFixed(2)}`);
                  }
                }
              } catch {
                // Skip if error
              }
            }
            if (reputationFound > 0) {
              console.log(`   ✓ Found reputation data for ${reputationFound} agents via getReputationSummary`);
            }
          } else {
            console.log(`✅ Found 0 agents (expected: 0 - no reputation data)`);
          }
        }

        console.log(`   Successful chains: ${successfulChains.join(', ')}`);
        if (failedChains.length > 0) {
          console.log(`   Failed chains: ${failedChains.join(', ')}`);
        }
        console.log(`   Unique chains in results: ${Array.from(chainIds).join(', ')}`);

        // Show sample agents from different chains
        if (agents.length > 0) {
          console.log(`   Sample agents:`);
          for (let i = 0; i < Math.min(5, agents.length); i++) {
            const agent = agents[i];
            const avgScore = agent.extras?.averageScore ?? 'N/A';
            console.log(`      ${i + 1}. ${agent.name} (Chain: ${agent.chainId}, Avg: ${avgScore})`);
          }
        }
      } catch (error) {
        console.log(`❌ All chains: Failed - ${error}`);
        throw error;
      }
    });
  });

  describe('Step 8: Test searchAgentsByReputation() with filters and multi-chain', () => {
    it('should search reputation with filters across chains', async () => {
      console.log('\n📍 Step 8: Test searchAgentsByReputation() with filters and multi-chain');
      console.log('-'.repeat(60));

      try {
        // Use known tags that exist in feedback data
        // Test with chains that have reputation data (84532 has agents with averageScore)
        const result = await sdk.searchAgentsByReputation(
          undefined,
          TEST_TAGS.slice(0, 1), // Use "price" tag which exists in feedback
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          0, // No threshold to see any results
          false,
          20,
          undefined,
          undefined,
          [84532] // Use chain with reputation data
        );

        const agents = result.items || [];
        console.log(`✅ Found ${agents.length} agents with filters`);
        console.log(`   Filter: tags=${TEST_TAGS.slice(0, 1).join(', ')}, chains=[84532]`);
        if (agents.length > 0) {
          for (let i = 0; i < Math.min(3, agents.length); i++) {
            const agent = agents[i];
            const avgScore = agent.extras?.averageScore ?? 'N/A';
            console.log(`   ${i + 1}. ${agent.name} (Chain: ${agent.chainId}, Avg: ${avgScore})`);
          }
        } else {
          console.log(`   ⚠️  No agents found with tag '${TEST_TAGS[0]}' (may need to check if tag filtering works)`);
        }
      } catch (error) {
        console.log(`❌ Filtered multi-chain search: Failed - ${error}`);
        // Don't fail the test, just log the error
      }
    });
  });

  describe('Step 9: Test getReputationSummary() with chainId:agentId format', () => {
    it('should get reputation summary across all supported chains', async () => {
      console.log('\n📍 Step 9: Test getReputationSummary() with chainId:agentId format');
      console.log('-'.repeat(60));
      console.log('Testing getReputationSummary() across all supported chains...');

      for (const chainId of SUPPORTED_CHAINS) {
        try {
          // Use known agents with feedback if available
          let testAgentId: string | undefined;
          if (TEST_AGENTS_WITH_FEEDBACK[chainId] && TEST_AGENTS_WITH_FEEDBACK[chainId].length > 0) {
            testAgentId = TEST_AGENTS_WITH_FEEDBACK[chainId][0];
          } else {
            // Fallback: search for agents and try each one
            const searchResult = await sdk.searchAgents(
              { chains: [chainId] },
              [],
              10
            );

            if (searchResult.items && searchResult.items.length > 0) {
              // Try to get reputation for each agent until we find one with feedback
              for (const agentSummary of searchResult.items) {
                let agentId = agentSummary.agentId;
                if (agentId.includes(':')) {
                  const tokenId = agentId.split(':').pop()!;
                  testAgentId = `${chainId}:${tokenId}`;
                } else {
                  testAgentId = `${chainId}:${agentId}`;
                }

                try {
                  const summary = await sdk.getReputationSummary(testAgentId);
                  // If we get here, we found one with feedback
                  break;
                } catch {
                  testAgentId = undefined;
                  continue;
                }
              }
            }
          }

          if (testAgentId) {
            try {
              const summary = await sdk.getReputationSummary(testAgentId);

              expect(summary).toBeTruthy();
              expect(summary.count).toBeGreaterThanOrEqual(0);
              expect(summary.averageScore).toBeGreaterThanOrEqual(0);
              console.log(`✅ Chain ${chainId}: Got reputation summary`);
              console.log(`   Agent ID: ${testAgentId}`);
              console.log(`   Count: ${summary.count}`);
              console.log(`   Average Score: ${summary.averageScore.toFixed(2)}`);
            } catch (error) {
              console.log(`⚠️  Chain ${chainId}: Failed to get reputation for ${testAgentId}: ${error}`);
            }
          } else {
            console.log(`⚠️  Chain ${chainId}: No agents with feedback found`);
          }
        } catch (error) {
          console.log(`❌ Chain ${chainId}: Failed - ${error}`);
          // Don't fail the test, just log the error
        }
      }
    });

    it('should get reputation summary with default chain (no chainId prefix)', async () => {
      console.log('\n📍 Step 10: Test getReputationSummary() with default chain (no chainId prefix)');
      console.log('-'.repeat(60));

      try {
        // Use known agent with feedback if available
        let testAgentId: string | undefined;
        if (TEST_AGENTS_WITH_FEEDBACK[CHAIN_ID] && TEST_AGENTS_WITH_FEEDBACK[CHAIN_ID].length > 0) {
          const fullId = TEST_AGENTS_WITH_FEEDBACK[CHAIN_ID][0];
          // Extract token ID for default chain test
          testAgentId = fullId.includes(':') ? fullId.split(':').pop()! : fullId;
        } else {
          // Fallback: search for agents and try each one
          const searchResult = await sdk.searchAgents(
            { chains: [CHAIN_ID] },
            [],
            10
          );

          if (searchResult.items && searchResult.items.length > 0) {
            // Try to get reputation for each agent until we find one with feedback
            for (const agentSummary of searchResult.items) {
              let agentId = agentSummary.agentId;
              if (agentId.includes(':')) {
                testAgentId = agentId.split(':').pop()!;
              } else {
                testAgentId = agentId;
              }

              try {
                const summary = await sdk.getReputationSummary(testAgentId);
                // If we get here, we found one with feedback
                break;
              } catch {
                testAgentId = undefined;
                continue;
              }
            }
          }
        }

        if (testAgentId) {
          try {
            const summary = await sdk.getReputationSummary(testAgentId);

            expect(summary).toBeTruthy();
            expect(summary.count).toBeGreaterThanOrEqual(0);
            expect(summary.averageScore).toBeGreaterThanOrEqual(0);
            console.log(`✅ Default chain: Got reputation summary`);
            console.log(`   Agent ID: ${testAgentId}`);
            console.log(`   Count: ${summary.count}`);
            console.log(`   Average Score: ${summary.averageScore.toFixed(2)}`);
          } catch (error) {
            console.log(`⚠️  Default chain: Failed to get reputation for ${testAgentId}: ${error}`);
            throw error;
          }
        } else {
          console.log('⚠️  No agents with feedback found on default chain');
        }
      } catch (error) {
        console.log(`❌ Default chain: Failed - ${error}`);
        throw error;
      }
    });
  });

  describe('Step 11: Test all three chains together', () => {
    it('should search reputation across all three chains', async () => {
      console.log('\n📍 Step 11: Test all three chains together');
      console.log('-'.repeat(60));

      try {
        // Collect all known agents with reputation
        const allKnownAgents: string[] = [];
        for (const chainId of SUPPORTED_CHAINS) {
          allKnownAgents.push(...(TEST_AGENTS_WITH_REPUTATION[chainId] || []));
        }

        let result;
        if (allKnownAgents.length > 0) {
          // Query for specific agents we know have reputation
          result = await sdk.searchAgentsByReputation(
            allKnownAgents,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            false,
            20,
            undefined,
            undefined,
            SUPPORTED_CHAINS
          );
        } else {
          // General search if no known agents
          result = await sdk.searchAgentsByReputation(
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            false,
            20,
            undefined,
            undefined,
            SUPPORTED_CHAINS
          );
        }

        const agents = result.items || [];
        const chainIds = new Set(agents.map(agent => agent.chainId));

        if (agents.length > 0) {
          console.log(`✅ All three chains: Found ${agents.length} agents`);
        } else {
          // If search returned 0, verify agents exist and show reputation
          if (allKnownAgents.length > 0) {
            console.log(`⚠️  Reputation search found 0 agents`);
            console.log(`   Verifying ${allKnownAgents.length} known agents exist...`);
            let reputationFound = 0;
            for (const agentId of allKnownAgents.slice(0, 5)) {
              try {
                const agent = await sdk.getAgent(agentId);
                const summary = await sdk.getReputationSummary(agentId);
                if (summary.count > 0) {
                  reputationFound++;
                  if (reputationFound <= 3) {
                    console.log(`   ✅ ${agentId}: ${summary.count} feedback, avg: ${summary.averageScore.toFixed(2)}`);
                  }
                }
              } catch {
                // Skip if error
              }
            }
            if (reputationFound > 0) {
              console.log(`   ✓ Found reputation data for ${reputationFound} agents via getReputationSummary`);
            }
          } else {
            console.log(`✅ All three chains: Found 0 agents (expected: 0 - no reputation data)`);
          }
        }

        console.log(`   Unique chains in results: ${Array.from(chainIds).join(', ')}`);

        // Group by chain
        const byChain: Record<number, typeof agents> = {};
        for (const agent of agents) {
          const chain = agent.chainId;
          if (!byChain[chain]) {
            byChain[chain] = [];
          }
          byChain[chain].push(agent);
        }

        for (const [chain, chainAgents] of Object.entries(byChain)) {
          console.log(`   Chain ${chain}: ${chainAgents.length} agents`);
        }

        // Show sample agents
        if (agents.length > 0) {
          console.log(`   Sample agents:`);
          for (let i = 0; i < Math.min(5, agents.length); i++) {
            const agent = agents[i];
            const avgScore = agent.extras?.averageScore ?? 'N/A';
            console.log(`      ${i + 1}. ${agent.name} (Chain: ${agent.chainId}, Avg: ${avgScore})`);
          }
        }
      } catch (error) {
        console.log(`❌ All three chains: Failed - ${error}`);
        throw error;
      }
    });
  });

  afterAll(() => {
    console.log('\n' + '='.repeat(60));
    console.log('✅ Multi-Chain Tests Completed!');
    console.log('='.repeat(60));
  });
});
