/**
 * Search Agents Example
 * 
 * This example demonstrates how to:
 * 1. Search for agents by various criteria
 * 2. Filter by capabilities, skills, trust models
 * 3. Get agent summaries
 */

import * as dotenv from 'dotenv';
import { SDK } from '../src/index';

// Load environment variables from .env file
dotenv.config();

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
  console.log(`Found ${nameResults.items.length} agents matching "AI"`);

  // 2. Search agents with MCP endpoint
  console.log('\nSearching agents with MCP endpoint...');
  const mcpResults = await sdk.searchAgents({ mcp: true });
  console.log(`Found ${mcpResults.items.length} agents with MCP`);

  // 3. Search agents with specific tools
  console.log('\nSearching agents with specific tools...');
  const toolResults = await sdk.searchAgents({
    mcpTools: ['financial_analyzer', 'data_processor'],
    active: true,
  });
  console.log(`Found ${toolResults.items.length} active agents with specified tools`);
  for (const agent of toolResults.items) {
    console.log(`  - ${agent.name} (${agent.agentId})`);
    console.log(`    Tools: ${agent.mcpTools.join(', ')}`);
  }

  // 4. Search agents by reputation
  console.log('\nSearching agents by reputation...');
  const reputationResults = await sdk.searchAgentsByReputation(
    undefined, // agents (optional)
    ['data_analyst', 'finance'], // tags
    undefined, // reviewers (optional)
    undefined, // capabilities (optional)
    undefined, // skills (optional)
    undefined, // tasks (optional)
    undefined, // names (optional)
    80 // minAverageScore
  );
  console.log(`Found ${reputationResults.items.length} agents with high reputation`);
  // Note: averageScore is available in agent.extras.averageScore

  // 5. Get specific agent by ID
  console.log('\nGetting specific agent...');
  const agentId = '11155111:123'; // Replace with actual agent ID
  try {
    const agent = await sdk.getAgent(agentId);
    console.log(`Agent: ${agent.name}`);
    console.log(`Description: ${agent.description}`);
    console.log(`MCP: ${agent.mcp ? 'Yes' : 'No'}`);
    console.log(`A2A: ${agent.a2a ? 'Yes' : 'No'}`);
    console.log(`Active: ${agent.active}`);
    console.log(`x402 Support: ${agent.x402support}`);
  } catch (error) {
    console.error(`Failed to get agent: ${error}`);
  }

  // 6. Pagination example
  console.log('\nPagination example...');
  let cursor: string | undefined;
  let page = 1;
  do {
    const pageResults = await sdk.searchAgents(
      { active: true },
      undefined,
      10, // pageSize
      cursor
    );
    console.log(`Page ${page}: Found ${pageResults.items.length} agents`);
    cursor = pageResults.nextCursor;
    page++;
    if (page > 3) break; // Limit to 3 pages for demo
  } while (cursor);
}

main().catch(console.error);

