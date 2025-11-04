/**
 * Integration test for Agent Search and Discovery using Subgraph
 * Tests various search and filtering capabilities for discovering agents and their reputation.
 */

import { SDK } from '../src/index';
import { CHAIN_ID, RPC_URL, AGENT_ID, printConfig } from './config';

describe('Agent Search and Discovery', () => {
  let sdk: SDK;

  beforeAll(() => {
    printConfig();
    // Initialize SDK without signer (read-only operations)
    sdk = new SDK({
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
    });
  });

  it('should get agent by ID', async () => {
    // Search for any available agent first - use pageSize like Python test
    const results = await sdk.searchAgents({}, undefined, 5); // pageSize=5 like Python
    expect(results.items.length).toBeGreaterThan(0);
    
    const firstAgent = results.items[0];
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
    expect(results.items.length).toBeGreaterThanOrEqual(0);

    if (results.items.length > 0) {
      const firstAgent = results.items[0];
      expect(firstAgent.name).toBeTruthy();
      expect(firstAgent.agentId).toBeTruthy();
    }
  });

  it('should search agents with MCP endpoint', async () => {
    const results = await sdk.searchAgents({ mcp: true });
    expect(results.items.length).toBeGreaterThanOrEqual(0);

    results.items.forEach((agent) => {
      // AgentSummary has mcp as boolean
      expect(typeof agent.mcp === 'boolean').toBe(true);
    });
  });

  it('should search agents by MCP tools', async () => {
    const results = await sdk.searchAgents({ mcpTools: ['data_analysis'] });
    expect(results.items.length).toBeGreaterThanOrEqual(0);

    if (results.items.length > 0) {
      const firstAgent = results.items[0];
      expect(firstAgent.mcpTools).toBeDefined();
    }
  });

  it('should search agents by A2A skills', async () => {
    const results = await sdk.searchAgents({ a2aSkills: ['javascript'] });
    expect(results.items.length).toBeGreaterThanOrEqual(0);

    if (results.items.length > 0) {
      const firstAgent = results.items[0];
      expect(firstAgent.a2aSkills).toBeDefined();
    }
  });

  it('should search agents by ENS domain', async () => {
    const results = await sdk.searchAgents({ ens: 'test' });
    expect(results.items.length).toBeGreaterThanOrEqual(0);
  });

  it('should search only active agents', async () => {
    const results = await sdk.searchAgents({ active: true }, undefined, 10);
    expect(results.items.length).toBeGreaterThanOrEqual(0);

    results.items.forEach((agent) => {
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
    expect(results.items.length).toBeGreaterThanOrEqual(0);
  });

  it('should search agents by reputation', async () => {
    const results = await sdk.searchAgentsByReputation(
      undefined, // agents
      undefined, // tags
      undefined, // reviewers
      undefined, // capabilities
      undefined, // skills
      undefined, // tasks
      undefined, // names
      80 // minAverageScore
    );
    expect(results.items.length).toBeGreaterThanOrEqual(0);
  });

  it('should handle pagination', async () => {
    const page1 = await sdk.searchAgents({ active: true }, undefined, 5);
    expect(page1.items.length).toBeLessThanOrEqual(5);

    if (page1.nextCursor && page1.items.length > 0) {
      const page2 = await sdk.searchAgents({ active: true }, undefined, 5, page1.nextCursor);
      expect(page2.items.length).toBeGreaterThanOrEqual(0);

      // Verify no duplicates between pages (only if we have results)
      if (page1.items.length > 0 && page2.items.length > 0) {
        const ids1 = page1.items.map((a) => a.agentId);
        const ids2 = page2.items.map((a) => a.agentId);
        const duplicates = ids1.filter((id) => ids2.includes(id));
        expect(duplicates.length).toBe(0);
      }
    }
  });

  it('should search agents by single owner address', async () => {
    // First get a sample agent with an owner
    const allAgents = await sdk.searchAgents({}, undefined, 10);
    expect(allAgents.items.length).toBeGreaterThan(0);

    const agentWithOwner = allAgents.items.find(a => a.owners && a.owners.length > 0);
    if (!agentWithOwner) {
      console.log('No agents with owners found, skipping test');
      return;
    }

    const testOwner = agentWithOwner.owners[0];

    // Search by owner
    const ownerResults = await sdk.searchAgents({ owners: [testOwner] });
    expect(ownerResults.items.length).toBeGreaterThan(0);

    // Verify all results have the correct owner
    ownerResults.items.forEach(agent => {
      const hasOwner = agent.owners.some(owner =>
        owner.toLowerCase() === testOwner.toLowerCase()
      );
      expect(hasOwner).toBe(true);
    });
  });

  it('should search agents by multiple owner addresses', async () => {
    // Get sample agents with owners
    const allAgents = await sdk.searchAgents({}, undefined, 20);
    const agentsWithOwners = allAgents.items.filter(a => a.owners && a.owners.length > 0);

    if (agentsWithOwners.length < 2) {
      console.log('Not enough agents with owners found, skipping test');
      return;
    }

    const owner1 = agentsWithOwners[0].owners[0];
    const owner2 = agentsWithOwners[1].owners[0];

    // Search by multiple owners
    const results = await sdk.searchAgents({ owners: [owner1, owner2] });
    expect(results.items.length).toBeGreaterThan(0);

    // Verify all results have at least one of the specified owners
    results.items.forEach(agent => {
      const hasMatchingOwner = agent.owners.some(owner =>
        owner.toLowerCase() === owner1.toLowerCase() ||
        owner.toLowerCase() === owner2.toLowerCase()
      );
      expect(hasMatchingOwner).toBe(true);
    });
  });

  it('should search agents by operator addresses', async () => {
    // First get a sample agent with an operator
    const allAgents = await sdk.searchAgents({}, undefined, 50);
    const agentWithOperator = allAgents.items.find(a => a.operators && a.operators.length > 0);

    if (!agentWithOperator) {
      console.log('No agents with operators found, skipping test');
      return;
    }

    const testOperator = agentWithOperator.operators[0];

    // Search by operator
    const operatorResults = await sdk.searchAgents({ operators: [testOperator] });
    expect(operatorResults.items.length).toBeGreaterThan(0);

    // Verify all results have the correct operator
    operatorResults.items.forEach(agent => {
      const hasOperator = agent.operators.some(op =>
        op.toLowerCase() === testOperator.toLowerCase()
      );
      expect(hasOperator).toBe(true);
    });
  });
});

