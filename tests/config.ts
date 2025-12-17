/**
 * Shared configuration loader for test examples.
 * Loads configuration from environment variables (.env file).
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env file
// Look for .env in parent directory (project root)
const envPath = path.join(__dirname, '../../.env');
dotenv.config({ path: envPath });

// Chain Configuration
export const CHAIN_ID = parseInt(process.env.CHAIN_ID || '11155111', 10);
export const RPC_URL =
  process.env.RPC_URL ||
  'https://eth-sepolia.g.alchemy.com/v2/7nkA4bJ0tKWcl2-5Wn15c5eRdpGZ8DDr';
export const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || '';

// IPFS Configuration (Pinata)
export const PINATA_JWT = process.env.PINATA_JWT || '';

// Arweave Configuration
// Note: Uses production Arweave mainnet (no testnet exists)
// Turbo provides free uploads for files <100KB (typical agent files are 1-10KB)
// No additional credentials needed - reuses AGENT_PRIVATE_KEY for EVM signing
export const ARWEAVE_ENABLED = process.env.ARWEAVE_ENABLED !== 'false'; // Default: enabled

// Subgraph Configuration
export const SUBGRAPH_URL =
  process.env.SUBGRAPH_URL ||
  'https://gateway.thegraph.com/api/00a452ad3cd1900273ea62c1bf283f93/subgraphs/id/6wQRC7geo9XYAhckfmfo8kbMRLeWU8KQd3XsJqFKmZLT';

// Agent ID for testing (can be overridden via env)
export const AGENT_ID = process.env.AGENT_ID || '11155111:374';

// Client configuration (different wallet for feedback tests)
// Load from environment variable for security
export const CLIENT_PRIVATE_KEY = process.env.CLIENT_PRIVATE_KEY || '';

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
  console.log();
}

