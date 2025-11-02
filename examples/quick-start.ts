/**
 * Quick Start Example
 * 
 * This example demonstrates how to:
 * 1. Initialize the SDK
 * 2. Create a new agent
 * 3. Configure endpoints and metadata
 * 4. Register the agent on-chain with IPFS
 */

import * as dotenv from 'dotenv';
import { SDK } from '../src/index';

// Load environment variables from .env file
dotenv.config();

async function main() {
  // Initialize SDK
  const sdk = new SDK({
    chainId: 11155111, // Ethereum Sepolia
    rpcUrl: process.env.RPC_URL || 'https://sepolia.infura.io/v3/YOUR_PROJECT_ID',
    signer: process.env.PRIVATE_KEY, // Optional: private key for signing transactions
    ipfs: 'pinata', // or 'filecoinPin' or 'node'
    pinataJwt: process.env.PINATA_JWT, // Required if ipfs='pinata'
  });

  // Create a new agent
  const agent = sdk.createAgent(
    'My AI Assistant',
    'An intelligent assistant that helps with various tasks. Skills: data analysis, finance, coding. Pricing: $0.01 per request.',
    'https://example.com/agent-image.png'
  );

  // Configure MCP endpoint
  await agent.setMCP('https://api.example.com/mcp', '2025-06-18');

  // Configure A2A endpoint
  await agent.setA2A('https://api.example.com/a2a', '0.30');

  // Set agent wallet
  agent.setAgentWallet('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb', 11155111);

  // Set trust models
  agent.setTrust(true, false);

  // Set custom metadata
  agent.setMetadata({
    version: '1.0.0',
    tags: JSON.stringify(['data_analyst', 'finance']),
    pricing: '0.01',
  });

  // Set active status
  agent.setActive(true);

  // Register agent on-chain with IPFS
  console.log('Registering agent...');
  const registrationFile = await agent.registerIPFS();
  console.log(`Agent registered with ID: ${registrationFile.agentId}`);
  console.log(`Registration file URI: ${registrationFile.agentURI}`);
}

main().catch(console.error);

