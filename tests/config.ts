/**
 * Shared configuration loader for test examples.
 * Loads configuration from environment variables (.env file).
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env file
// Prefer agent0-ts/.env (project root), with fallback to monorepo root .env
const localEnvPath = path.join(__dirname, '../.env');
const monorepoEnvPath = path.join(__dirname, '../../.env');
dotenv.config({ path: localEnvPath });
dotenv.config({ path: monorepoEnvPath, override: false });

// Chain Configuration
export const CHAIN_ID = parseInt(process.env.CHAIN_ID || '11155111', 10);
export const RPC_URL =
  process.env.RPC_URL ||
  'https://eth-sepolia.g.alchemy.com/v2/7nkA4bJ0tKWcl2-5Wn15c5eRdpGZ8DDr';
export const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || '';

// IPFS Configuration (Pinata)
export const PINATA_JWT = process.env.PINATA_JWT || '';

// Subgraph Configuration
export const SUBGRAPH_URL =
  process.env.SUBGRAPH_URL ||
  'https://gateway.thegraph.com/api/00a452ad3cd1900273ea62c1bf283f93/subgraphs/id/6wQRC7geo9XYAhckfmfo8kbMRLeWU8KQd3XsJqFKmZLT';

// Agent ID for testing (can be overridden via env)
export const AGENT_ID = process.env.AGENT_ID || '11155111:374';

// Client configuration (different wallet for feedback tests)
// Load from environment variable for security
export const CLIENT_PRIVATE_KEY = process.env.CLIENT_PRIVATE_KEY || '';

// Semantic Search Configuration
export const SEMANTIC_SEARCH_URL =
  process.env.SEMANTIC_SEARCH_URL ||
  'https://agent0-semantic-search.dawid-pisarczyk.workers.dev';

/**
 * Print current configuration (hiding sensitive values).
 */
export function printConfig(): void {
  console.log('Configuration:');
  console.log(`  CHAIN_ID: ${CHAIN_ID}`);
  console.log(`  RPC_URL: ${RPC_URL.substring(0, 50)}...`);
  console.log(`  AGENT_PRIVATE_KEY: ${AGENT_PRIVATE_KEY ? '***' : 'NOT SET'}`);
  console.log(`  PINATA_JWT: ${PINATA_JWT ? '***' : 'NOT SET'}`);
  console.log(`  SUBGRAPH_URL: ${SUBGRAPH_URL.substring(0, 50)}...`);
  console.log(`  AGENT_ID: ${AGENT_ID}`);
  console.log(`  SEMANTIC_SEARCH_URL: ${SEMANTIC_SEARCH_URL.substring(0, 50)}...`);
  console.log();
}

