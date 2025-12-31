/**
 * Frontend Browser Wallet Example
 *
 * This example demonstrates how to use the Agent0 SDK in a frontend application
 * with browser wallets like MetaMask, Coinbase Wallet, etc.
 *
 * Note: This file is meant to be used in a browser environment.
 * It won't work directly in Node.js without a mock window.ethereum.
 */

import { SDK } from '../src/index';
import {
  connectBrowserWallet,
  setupWalletListeners,
  isWalletAvailable,
  detectWalletType,
  isWalletConnected,
  getConnectedAccounts,
  type BrowserWalletConnection,
} from '../src/utils/browser-wallet';

// Store the SDK and wallet connection globally for this example
let sdk: SDK | null = null;
let walletConnection: BrowserWalletConnection | null = null;

/**
 * Initialize the SDK with a browser wallet
 */
async function initializeSDK(): Promise<SDK> {
  // Check if wallet is available
  if (!isWalletAvailable()) {
    throw new Error('No wallet detected. Please install MetaMask or another Web3 wallet.');
  }

  const walletType = detectWalletType();
  console.log(`Detected wallet: ${walletType}`);

  // Connect to the wallet
  // Optionally specify target chain (e.g., Sepolia testnet)
  walletConnection = await connectBrowserWallet({
    targetChainId: 11155111, // Ethereum Sepolia
    requestAccounts: true,
  });

  console.log('Connected to wallet:');
  console.log(`  Address: ${walletConnection.address}`);
  console.log(`  Chain ID: ${walletConnection.chainId}`);

  // Initialize SDK with browser wallet provider and signer
  sdk = new SDK({
    chainId: walletConnection.chainId,
    provider: walletConnection.provider,
    signer: walletConnection.signer,
    // Optional: Configure IPFS for agent registration
    // ipfs: 'pinata',
    // pinataJwt: 'YOUR_PINATA_JWT',
  });

  console.log(`SDK initialized. Read-only mode: ${sdk.isReadOnly}`);

  return sdk;
}

/**
 * Set up wallet event listeners
 */
function setupListeners(): () => void {
  return setupWalletListeners({
    onAccountsChanged: async (accounts) => {
      console.log('Accounts changed:', accounts);
      if (accounts.length === 0) {
        console.log('Wallet disconnected');
        sdk = null;
        walletConnection = null;
      } else {
        // Re-initialize SDK with new account
        console.log('Switching to new account, re-initializing SDK...');
        await initializeSDK();
      }
    },
    onChainChanged: async (chainId) => {
      console.log('Chain changed to:', chainId);
      // Re-initialize SDK with new chain
      console.log('Re-initializing SDK for new chain...');
      await initializeSDK();
    },
    onDisconnect: () => {
      console.log('Wallet disconnected');
      sdk = null;
      walletConnection = null;
    },
  });
}

/**
 * Example: Search for agents (read-only operation)
 */
async function searchAgentsExample() {
  if (!sdk) {
    throw new Error('SDK not initialized. Call initializeSDK first.');
  }

  console.log('\n=== Searching Agents ===');

  const { items, nextCursor } = await sdk.searchAgents(
    {
      active: true,
      mcp: true,
    },
    ['createdAt:desc'],
    10
  );

  console.log(`Found ${items.length} agents:`);
  items.forEach((agent) => {
    console.log(`  - ${agent.agentId}: ${agent.name}`);
  });

  return items;
}

/**
 * Example: Create and register an agent
 */
async function createAgentExample() {
  if (!sdk) {
    throw new Error('SDK not initialized. Call initializeSDK first.');
  }

  if (sdk.isReadOnly) {
    throw new Error('SDK is in read-only mode. Cannot create agent without signer.');
  }

  console.log('\n=== Creating Agent ===');

  // Create an agent
  const agent = sdk.createAgent('My Frontend Agent', 'An agent created from a frontend application');

  // Configure the agent
  await agent.setMCP('https://my-mcp-server.example.com/mcp');
  agent.setActive(true);
  agent.setTrust(true); // Enable reputation trust model

  console.log('Agent configured. Registration file:');
  console.log(JSON.stringify(agent.getRegistrationFile(), null, 2));

  // Note: To actually register, you would need IPFS configuration
  // const registrationFile = await agent.registerIPFS();
  // console.log(`Agent registered with ID: ${registrationFile.agentId}`);

  return agent;
}

/**
 * Example: Give feedback to an agent
 */
async function giveFeedbackExample(agentId: string) {
  if (!sdk) {
    throw new Error('SDK not initialized. Call initializeSDK first.');
  }

  if (sdk.isReadOnly) {
    throw new Error('SDK is in read-only mode. Cannot give feedback without signer.');
  }

  console.log(`\n=== Giving Feedback to Agent ${agentId} ===`);

  // Prepare feedback
  const feedbackFile = sdk.prepareFeedback(
    agentId,
    85, // score 0-100
    ['helpful', 'fast'], // tags
    'Great agent, very helpful!', // text
    'tools', // capability
    'search_tool' // name
  );

  console.log('Prepared feedback:', feedbackFile);

  // Note: To actually submit feedback, uncomment below
  // const feedback = await sdk.giveFeedback(agentId, feedbackFile);
  // console.log('Feedback submitted:', feedback);

  return feedbackFile;
}

/**
 * Example: Load and display an existing agent
 */
async function loadAgentExample(agentId: string) {
  if (!sdk) {
    throw new Error('SDK not initialized. Call initializeSDK first.');
  }

  console.log(`\n=== Loading Agent ${agentId} ===`);

  try {
    const agent = await sdk.loadAgent(agentId);
    console.log('Agent loaded:');
    console.log(`  Name: ${agent.name}`);
    console.log(`  Description: ${agent.description}`);
    console.log(`  MCP Endpoint: ${agent.mcpEndpoint || 'Not set'}`);
    console.log(`  A2A Endpoint: ${agent.a2aEndpoint || 'Not set'}`);
    console.log(`  Active: ${agent.getRegistrationFile().active}`);
    return agent;
  } catch (error) {
    console.error('Failed to load agent:', error);
    throw error;
  }
}

/**
 * Main example function
 */
async function main() {
  console.log('=== Agent0 SDK - Frontend Wallet Integration Example ===\n');

  try {
    // Check if already connected
    const connected = await isWalletConnected();
    if (connected) {
      const accounts = await getConnectedAccounts();
      console.log('Already connected to accounts:', accounts);
    }

    // Initialize SDK with wallet
    await initializeSDK();

    // Set up event listeners
    const cleanupListeners = setupListeners();

    // Example: Search agents (works even in read-only mode)
    await searchAgentsExample();

    // Example: Create agent (requires signer)
    // await createAgentExample();

    // Example: Load existing agent
    // await loadAgentExample('11155111:123');

    // Example: Give feedback
    // await giveFeedbackExample('11155111:123');

    // To clean up listeners when done (e.g., on page unload):
    // cleanupListeners();
  } catch (error) {
    console.error('Error:', error);
  }
}

// Export for use in browser
export {
  initializeSDK,
  setupListeners,
  searchAgentsExample,
  createAgentExample,
  giveFeedbackExample,
  loadAgentExample,
  main,
};

// If running directly (for testing)
// main().catch(console.error);

