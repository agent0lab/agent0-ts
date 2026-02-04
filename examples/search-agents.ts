/**
 * Search Agents Example
 * 
 * This example demonstrates how to:
 * 1. Search for agents by various criteria
 * 2. Filter by capabilities, skills, trust models
 * 3. Get agent summaries
 */

import './_env';
import { SDK } from '../src/index';

async function main() {
  // Initialize SDK (read-only mode is fine for searching)
  const sdk = new SDK({
    chainId: 11155111, // Ethereum Sepolia
    rpcUrl: process.env.RPC_URL || 'https://sepolia.infura.io/v3/YOUR_PROJECT_ID',
    // No signer needed for read-only operations
  });

  // 1. Search agents by name
  console.log('Searching agents by name...');
  const nameResults = await sdk.searchAgents({ name: 'AI' });
  console.log(`Found ${nameResults.length} agents matching "AI"`);

  // 2. Search agents with MCP endpoint
  console.log('\nSearching agents with MCP endpoint...');
  const mcpResults = await sdk.searchAgents({ hasMCP: true });
  console.log(`Found ${mcpResults.length} agents with MCP`);

  // 3. Search agents with specific tools
  console.log('\nSearching agents with specific tools...');
  const toolResults = await sdk.searchAgents({
    mcpTools: ['financial_analyzer', 'data_processor'],
    active: true,
  });
  console.log(`Found ${toolResults.length} active agents with specified tools`);
  for (const agent of toolResults) {
    console.log(`  - ${agent.name} (${agent.agentId})`);
    console.log(`    Tools: ${agent.mcpTools.join(', ')}`);
  }

  // 4. Search agents by feedback (unified search)
  console.log('\nSearching agents by feedback (min average value)...');
  const feedbackResults = await sdk.searchAgents({
    feedback: { minValue: 80, includeRevoked: false },
  });
  console.log(`Found ${feedbackResults.length} agents with high average feedback value`);
  // Note: averageValue is available in agent.averageValue

  // 5. Get specific agent by ID
  console.log('\nGetting specific agent...');
  const agentId = '11155111:123'; // Replace with actual agent ID
  try {
    const agent = await sdk.getAgent(agentId);
    if (!agent) {
      console.log(`Agent not found: ${agentId}`);
    } else {
      console.log(`Agent: ${agent.name}`);
      console.log(`Description: ${agent.description}`);
      console.log(`MCP: ${agent.mcp ?? 'No'}`);
      console.log(`A2A: ${agent.a2a ?? 'No'}`);
      console.log(`Active: ${agent.active}`);
      console.log(`x402 Support: ${agent.x402support}`);
    }
  } catch (error) {
    console.error(`Failed to get agent: ${error}`);
  }

  // 6. Note on pagination
  console.log('\nNote: searchAgents() no longer exposes pagination (pageSize/cursor/nextCursor).');
  console.log('It returns a full list; use Array.prototype.slice(...) client-side if you want the first N items.');
  const activeAgents = await sdk.searchAgents({ active: true });
  console.log(`Active agents: total=${activeAgents.length}, showing first 10: ${activeAgents.slice(0, 10).length}`);
}

main().catch(console.error);

