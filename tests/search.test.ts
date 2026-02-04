/**
 * Integration test for Agent Search and Discovery using Subgraph
 * Tests various search and filtering capabilities for discovering agents and their reputation.
 */

import { SDK } from '../src/index';
import { CHAIN_ID, RPC_URL, printConfig } from './config';

// Live/integration test (subgraph). Opt-in to avoid flaky CI.
const RUN_LIVE_TESTS = process.env.RUN_LIVE_TESTS === '1';
const describeMaybe = RUN_LIVE_TESTS ? describe : describe.skip;

describeMaybe('Agent Search and Discovery (live)', () => {
  let sdk: SDK;

  beforeAll(() => {
    printConfig();
    // Initialize SDK without signer (read-only operations)
    sdk = new SDK({
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
    });
  });

  // Note: AGENT_ID is exported by tests/config.ts for convenience, but this test suite
  // does not rely on a fixed hardcoded agentId. It discovers agents via subgraph queries.

  it('should get agent by ID', async () => {
    // Search for any available agent first
    const results = await sdk.searchAgents({}); // returns all
    expect(results.length).toBeGreaterThan(0);
    
    const firstAgent = results[0];
    const agent = await sdk.getAgent(firstAgent.agentId);

    expect(agent).toBeTruthy();
    if (agent) {
      expect(agent.name).toBeTruthy();
      expect(agent.agentId).toBe(firstAgent.agentId);
      expect(agent.chainId).toBe(CHAIN_ID);
    } else {
      // Agent not found in subgraph, skip this test
      console.log('Agent not found in subgraph, skipping test');
    }
  });

  it('should search agents by name', async () => {
    const results = await sdk.searchAgents({ name: 'Test' });
    expect(results).toBeTruthy();

    if (results.length > 0) {
      const firstAgent = results[0];
      expect(firstAgent.name).toBeTruthy();
      expect(firstAgent.agentId).toBeTruthy();
    }
  });

  it('should search agents with MCP endpoint', async () => {
    const results = await sdk.searchAgents({ hasMCP: true });
    expect(results).toBeTruthy();

    results.forEach((agent) => {
      // AgentSummary has mcp as an endpoint string when present
      expect(typeof agent.mcp).toBe('string');
    });
  });

  it('should search agents by MCP tools', async () => {
    const results = await sdk.searchAgents({ mcpTools: ['data_analysis'] });
    expect(results).toBeTruthy();

    if (results.length > 0) {
      const firstAgent = results[0];
      expect(firstAgent.mcpTools).toBeDefined();
    }
  });

  it('should search agents by A2A skills', async () => {
    const results = await sdk.searchAgents({ a2aSkills: ['javascript'] });
    expect(results).toBeTruthy();

    if (results.length > 0) {
      const firstAgent = results[0];
      expect(firstAgent.a2aSkills).toBeDefined();
    }
  });

  it('should search agents by ENS domain', async () => {
    const results = await sdk.searchAgents({ ensContains: 'test' });
    expect(results).toBeTruthy();
  });

  it('should search only active agents', async () => {
    const results = await sdk.searchAgents({ active: true });
    expect(results).toBeTruthy();

    results.forEach((agent) => {
      // AgentSummary active is a boolean property
      expect(typeof agent.active === 'boolean').toBe(true);
      if (typeof agent.active === 'boolean') {
        expect(agent.active).toBe(true);
      }
    });
  });

  it('should search agents with multiple filters', async () => {
    const results = await sdk.searchAgents({
      mcpTools: ['communication'],
      a2aSkills: ['python'],
    });
    expect(results).toBeTruthy();
  });

  it('should search agents by reputation', async () => {
    const results = await sdk.searchAgents({ feedback: { minValue: 80 } });
    expect(results).toBeTruthy();
  });

  // Pagination removed: searchAgents now returns all results.

  it('should search agents by single owner address', async () => {
    // First get a sample agent with an owner
    const allAgents = await sdk.searchAgents({});
    expect(allAgents.length).toBeGreaterThan(0);

    const agentWithOwner = allAgents.find((a) => a.owners && a.owners.length > 0);
    if (!agentWithOwner) {
      console.log('No agents with owners found, skipping test');
      return;
    }

    const testOwner = agentWithOwner.owners[0];

    // Search by owner
    const ownerResults = await sdk.searchAgents({ owners: [testOwner] });
    expect(ownerResults.length).toBeGreaterThan(0);

    // Verify all results have the correct owner
    ownerResults.forEach((agent) => {
      const hasOwner = agent.owners.some(owner =>
        owner.toLowerCase() === testOwner.toLowerCase()
      );
      expect(hasOwner).toBe(true);
    });
  });

  it('should search agents by multiple owner addresses', async () => {
    // Get sample agents with owners
    const allAgents = await sdk.searchAgents({});
    const agentsWithOwners = allAgents.filter((a) => a.owners && a.owners.length > 0);

    if (agentsWithOwners.length < 2) {
      console.log('Not enough agents with owners found, skipping test');
      return;
    }

    const owner1 = agentsWithOwners[0].owners[0];
    const owner2 = agentsWithOwners[1].owners[0];

    // Search by multiple owners
    const results = await sdk.searchAgents({ owners: [owner1, owner2] });
    expect(results.length).toBeGreaterThan(0);

    // Verify all results have at least one of the specified owners
    results.forEach((agent) => {
      const hasMatchingOwner = agent.owners.some(owner =>
        owner.toLowerCase() === owner1.toLowerCase() ||
        owner.toLowerCase() === owner2.toLowerCase()
      );
      expect(hasMatchingOwner).toBe(true);
    });
  });

  it('should search agents by operator addresses', async () => {
    // First get a sample agent with an operator
    const allAgents = await sdk.searchAgents({});
    const agentWithOperator = allAgents.find((a) => a.operators && a.operators.length > 0);

    if (!agentWithOperator) {
      console.log('No agents with operators found, skipping test');
      return;
    }

    const testOperator = agentWithOperator.operators[0];

    // Search by operator
    const operatorResults = await sdk.searchAgents({ operators: [testOperator] });
    expect(operatorResults.length).toBeGreaterThan(0);

    // Verify all results have the correct operator
    operatorResults.forEach((agent) => {
      const hasOperator = agent.operators.some(op =>
        op.toLowerCase() === testOperator.toLowerCase()
      );
      expect(hasOperator).toBe(true);
    });
  });
});

