/**
 * Semantic Search Example
 * 
 * This example demonstrates how to use semantic search in the Agent0 SDK.
 * Semantic search enables natural language queries and semantic similarity matching.
 */

import { SDK } from '../src/index';

async function main() {
  // Initialize SDK with semantic search URL
  const sdk = new SDK({
    chainId: 11155111, // Ethereum Sepolia
    rpcUrl: process.env.RPC_URL || 'https://sepolia.infura.io/v3/YOUR_PROJECT_ID',
    // Optional: override default semantic search URL
    semanticSearchUrl: process.env.SEMANTIC_SEARCH_URL || 'https://agent0-semantic-search.dawid-pisarczyk.workers.dev',
  });

  console.log('=== Semantic Search Examples ===\n');

  // 1. Basic semantic search
  console.log('1. Basic semantic search:');
  console.log('   Query: "AI agent for trading"');
  const basicResults = await sdk.searchAgents({
    query: 'AI agent for trading',
  });
  console.log(`   Found ${basicResults.items.length} agents`);
  if (basicResults.items.length > 0) {
    const agent = basicResults.items[0];
    console.log(`   Top result: ${agent.name} (score: ${agent.extras.score?.toFixed(3)})`);
    console.log(`   Description: ${agent.description.substring(0, 100)}...`);
  }
  console.log();

  // 2. Semantic search with filters
  console.log('2. Semantic search with filters:');
  console.log('   Query: "trading agent" + MCP endpoint + Active');
  const filteredResults = await sdk.searchAgents({
    query: 'trading agent',
    mcp: true,
    active: true,
  });
  console.log(`   Found ${filteredResults.items.length} agents`);
  filteredResults.items.forEach((agent, index) => {
    console.log(`   ${index + 1}. ${agent.name} (MCP: ${agent.mcp}, Active: ${agent.active})`);
  });
  console.log();

  // 2b. Semantic search with minScore
  console.log('2b. Semantic search with minimum score:');
  console.log('   Query: "agent" + minScore: 0.7 (only high relevance results)');
  const minScoreResults = await sdk.searchAgents({
    query: 'agent',
    minScore: 0.7, // Only return results with similarity score >= 0.7
  });
  console.log(`   Found ${minScoreResults.items.length} agents with score >= 0.7`);
  if (minScoreResults.items.length > 0) {
    minScoreResults.items.forEach((agent, index) => {
      console.log(`   ${index + 1}. ${agent.name} (score: ${agent.extras.score?.toFixed(3)})`);
    });
  }
  console.log();
  console.log(`   Found ${filteredResults.items.length} agents`);
  filteredResults.items.forEach((agent, index) => {
    console.log(`   ${index + 1}. ${agent.name} (MCP: ${agent.mcp}, Active: ${agent.active})`);
  });
  console.log();

  // 3. Semantic search with sorting
  console.log('3. Semantic search with sorting:');
  console.log('   Query: "agent" sorted by updatedAt descending');
  const sortedResults = await sdk.searchAgents(
    {
      query: 'agent',
    },
    ['updatedAt:desc'],
    10
  );
  console.log(`   Found ${sortedResults.items.length} agents`);
  if (sortedResults.items.length > 0) {
    console.log('   Top 3 results:');
    sortedResults.items.slice(0, 3).forEach((agent, index) => {
      const updatedAt = agent.extras.updatedAt 
        ? new Date(agent.extras.updatedAt).toLocaleDateString()
        : 'N/A';
      console.log(`   ${index + 1}. ${agent.name} (Updated: ${updatedAt})`);
    });
  }
  console.log();

  // 4. Semantic search with pagination
  console.log('4. Semantic search with pagination:');
  console.log('   Query: "agent" (first page, 5 results)');
  const firstPage = await sdk.searchAgents(
    {
      query: 'agent',
    },
    undefined,
    5
  );
  console.log(`   First page: ${firstPage.items.length} agents`);
  console.log(`   Total available: ${firstPage.meta?.totalResults || 'unknown'}`);
  console.log(`   Has next page: ${!!firstPage.nextCursor}`);
  
  if (firstPage.nextCursor) {
    console.log('   Fetching second page...');
    const secondPage = await sdk.searchAgents(
      {
        query: 'agent',
      },
      undefined,
      5,
      firstPage.nextCursor
    );
    console.log(`   Second page: ${secondPage.items.length} agents`);
  }
  console.log();

  // 5. Multi-chain semantic search
  console.log('5. Multi-chain semantic search:');
  console.log('   Query: "agent" across multiple chains');
  const multiChainResults = await sdk.searchAgents({
    query: 'agent',
    chains: [11155111, 84532], // Ethereum Sepolia and Base Sepolia
  });
  console.log(`   Found ${multiChainResults.items.length} agents`);
  const chainCounts = multiChainResults.items.reduce((acc, agent) => {
    acc[agent.chainId] = (acc[agent.chainId] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);
  console.log('   Results by chain:');
  Object.entries(chainCounts).forEach(([chainId, count]) => {
    console.log(`     Chain ${chainId}: ${count} agents`);
  });
  console.log();

  console.log('=== Examples Complete ===');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

