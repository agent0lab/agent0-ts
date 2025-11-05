/**
 * Agent Transfer Example
 * 
 * This example demonstrates how to:
 * 1. Check agent ownership
 * 2. Transfer agent to a new owner
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
    signer: process.env.PRIVATE_KEY, // Required for transfers
  });

  const agentId = '11155111:123'; // Replace with your agent ID
  const newOwner = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'; // Replace with new owner address

  // 1. Check if current address is the owner
  const currentAddress = sdk.web3Client.address!;
  const isOwner = await sdk.isAgentOwner(agentId, currentAddress);
  console.log(`Is ${currentAddress} the owner? ${isOwner}`);

  if (!isOwner) {
    console.error('Current address is not the owner. Cannot transfer.');
    return;
  }

  // 2. Get current owner
  const currentOwner = await sdk.getAgentOwner(agentId);
  console.log(`Current owner: ${currentOwner}`);

  // 3. Transfer agent
  console.log(`\nTransferring agent ${agentId} to ${newOwner}...`);
  const result = await sdk.transferAgent(agentId, newOwner);
  console.log(`Transfer completed!`);
  console.log(`Transaction hash: ${result.txHash}`);
  console.log(`From: ${result.from}`);
  console.log(`To: ${result.to}`);
  console.log(`Agent ID: ${result.agentId}`);

  // 4. Verify new owner
  console.log('\nVerifying new owner...');
  const newOwnerAddress = await sdk.getAgentOwner(agentId);
  console.log(`New owner: ${newOwnerAddress}`);
  console.log(`Transfer successful: ${newOwnerAddress.toLowerCase() === newOwner.toLowerCase()}`);
}

main().catch(console.error);

