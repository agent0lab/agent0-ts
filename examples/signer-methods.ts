/**
 * Signer Methods Example
 * 
 * This example demonstrates the two ways to configure a signer in the SDK:
 * 1. Using a private key string
 * 2. Using an ethers Wallet or Signer object
 */

import { SDK } from '../src/index';
import { ethers } from 'ethers';

async function main() {
  console.log('=== Agent0 SDK - Signer Configuration Methods ===\n');

  // ========================================
  // Method 1: Using a private key string
  // ========================================
  console.log('Method 1: Private Key String');
  console.log('-------------------------------');
  
  const sdkWithPrivateKey = new SDK({
    chainId: 11155111, // Ethereum Sepolia
    rpcUrl: process.env.RPC_URL || 'https://sepolia.infura.io/v3/YOUR_PROJECT_ID',
    signer: process.env.PRIVATE_KEY, // String: private key
    ipfs: 'pinata',
    pinataJwt: process.env.PINATA_JWT,
  });

  console.log('✓ SDK initialized with private key string');
  console.log(`  Read-only mode: ${sdkWithPrivateKey.isReadOnly}`);
  if (!sdkWithPrivateKey.isReadOnly) {
    console.log(`  Signer address: ${sdkWithPrivateKey.web3Client.address}`);
  }
  console.log();

  // ========================================
  // Method 2: Using an ethers Wallet object
  // ========================================
  console.log('Method 2: Ethers Wallet Object');
  console.log('-------------------------------');
  
  // Create a wallet instance
  const wallet = new ethers.Wallet(
    process.env.PRIVATE_KEY || ethers.Wallet.createRandom().privateKey
  );
  
  const sdkWithWallet = new SDK({
    chainId: 11155111,
    rpcUrl: process.env.RPC_URL || 'https://sepolia.infura.io/v3/YOUR_PROJECT_ID',
    signer: wallet, // ethers.Wallet object
    ipfs: 'pinata',
    pinataJwt: process.env.PINATA_JWT,
  });

  console.log('✓ SDK initialized with ethers Wallet object');
  console.log(`  Read-only mode: ${sdkWithWallet.isReadOnly}`);
  if (!sdkWithWallet.isReadOnly) {
    console.log(`  Signer address: ${sdkWithWallet.web3Client.address}`);
  }
  console.log();

  // ========================================
  // Method 3: Using a connected Signer
  // ========================================
  console.log('Method 3: Connected Signer (e.g., from Web3 Provider)');
  console.log('-------------------------------------------------------');
  
  // This simulates getting a signer from a web3 provider (e.g., MetaMask)
  // In a browser environment, you might get this from:
  // const provider = new ethers.BrowserProvider(window.ethereum);
  // const signer = await provider.getSigner();
  
  const provider = new ethers.JsonRpcProvider(
    process.env.RPC_URL || 'https://sepolia.infura.io/v3/YOUR_PROJECT_ID'
  );
  const connectedWallet = new ethers.Wallet(
    process.env.PRIVATE_KEY || ethers.Wallet.createRandom().privateKey,
    provider
  );
  
  const sdkWithSigner = new SDK({
    chainId: 11155111,
    rpcUrl: process.env.RPC_URL || 'https://sepolia.infura.io/v3/YOUR_PROJECT_ID',
    signer: connectedWallet, // Already connected Signer
    ipfs: 'pinata',
    pinataJwt: process.env.PINATA_JWT,
  });

  console.log('✓ SDK initialized with connected Signer');
  console.log(`  Read-only mode: ${sdkWithSigner.isReadOnly}`);
  if (!sdkWithSigner.isReadOnly) {
    // For generic Signers, use async getAddress()
    const signerAddress = await sdkWithSigner.web3Client.getAddress();
    console.log(`  Signer address: ${signerAddress}`);
  }
  console.log();

  // ========================================
  // Method 4: Read-only mode (no signer)
  // ========================================
  console.log('Method 4: Read-Only Mode (No Signer)');
  console.log('--------------------------------------');
  
  const readOnlySdk = new SDK({
    chainId: 11155111,
    rpcUrl: process.env.RPC_URL || 'https://sepolia.infura.io/v3/YOUR_PROJECT_ID',
    // No signer provided - read-only mode
  });

  console.log('✓ SDK initialized in read-only mode');
  console.log(`  Read-only mode: ${readOnlySdk.isReadOnly}`);
  console.log('  Can search agents: ✓');
  console.log('  Can read feedback: ✓');
  console.log('  Can register agents: ✗ (requires signer)');
  console.log('  Can give feedback: ✗ (requires signer)');
  console.log();

  // ========================================
  // Using the SDK with different signers
  // ========================================
  console.log('=== Example Usage ===');
  console.log('---------------------');
  
  try {
    // This works with any of the above signer methods
    const agent = sdkWithWallet.createAgent(
      'Test Agent',
      'An agent created with Wallet signer',
      'https://example.com/image.png'
    );
    
    console.log('✓ Agent created successfully');
    console.log(`  Ready for configuration and registration`);
    
    // Note: Actual registration would require valid configuration
    // await agent.registerIPFS();
  } catch (error) {
    console.error('Error:', error);
  }
}

main().catch(console.error);
