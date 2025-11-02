/**
 * Agent Update Example
 * 
 * This example demonstrates how to:
 * 1. Load an existing agent
 * 2. Update agent information
 * 3. Update the registration file on-chain
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
    signer: process.env.PRIVATE_KEY, // Required for updates
    ipfs: 'pinata',
    pinataJwt: process.env.PINATA_JWT,
  });

  // Load existing agent by ID
  const agentId = '11155111:123'; // Replace with your agent ID
  const agent = await sdk.loadAgent(agentId);

  console.log(`Loaded agent: ${agent.name}`);
  console.log(`Current description: ${agent.description}`);

  // Update agent information
  // Note: In TypeScript, we'd need to add updateInfo method or modify properties directly
  // For now, using a simplified approach - you would typically use updateInfo() method
  // agent.updateInfo(
  //   name: 'Updated AI Assistant',
  //   description: 'Updated description with new skills and pricing'
  // );

  // Update metadata
  agent.setMetadata({
    version: '1.1.0',
    tags: ['data_analyst', 'finance', 'coding'],
    pricing: '0.015', // Updated pricing
  });

  // Update endpoints if needed
  await agent.setMCP('https://api.example.com/mcp-updated', '2025-06-18');

  // Re-register with updated information
  console.log('Updating agent registration...');
  const updatedRegistrationFile = await agent.registerIPFS();
  console.log(`Agent updated. New URI: ${updatedRegistrationFile.agentURI}`);
}

main().catch(console.error);

