/**
 * Feedback Usage Example
 * 
 * This example demonstrates how to:
 * 1. Prepare feedback
 * 2. Give feedback on-chain
 * 3. Search for feedback
 * 4. Append response to feedback
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
    signer: process.env.PRIVATE_KEY, // Required for submitting feedback
    ipfs: 'pinata', // Optional: for storing rich feedback data
    pinataJwt: process.env.PINATA_JWT,
  });

  const agentId = '11155111:123'; // Replace with agent ID

  // 1. Prepare feedback (optional: can submit on-chain only with score and tags)
  const feedbackFile = sdk.prepareFeedback(
    agentId,
    85, // score (0-100) - MANDATORY
    ['data_analyst', 'finance'], // tags - optional
    undefined, // text - optional
    'tools', // capability (MCP) - optional
    'financial_analyzer', // name (MCP tool) - optional
    'financial_analysis', // skill (A2A) - optional
    'analyze_balance_sheet', // task (A2A) - optional
    { userId: 'user123', sessionId: 'session456' }, // context - optional
    { txHash: '0x...', amount: '0.01' } // proofOfPayment - optional
  );

  // 2. Sign feedback authorization (optional: SDK will create if not provided)
  const feedbackAuth = await sdk.signFeedbackAuth(agentId, sdk.web3Client.address!, undefined, 24);

  // 3. Give feedback on-chain
  console.log('Submitting feedback...');
  const feedback = await sdk.giveFeedback(agentId, feedbackFile, feedbackAuth);
  console.log(`Feedback submitted with ID: ${feedback.id.join(':')}`);
  console.log(`Score: ${feedback.score}, Tags: ${feedback.tags}`);

  // 4. Search for feedback
  console.log('\nSearching for feedback...');
  const results = await sdk.searchFeedback(
    agentId,
    ['data_analyst'], // tags filter
    ['tools'], // capabilities filter
    ['financial_analysis'], // skills filter
    70, // minScore
    100 // maxScore
  );
  console.log(`Found ${results.length} feedback entries`);

  // 5. Append response to feedback (agent acknowledging feedback)
  if (results.length > 0) {
    const firstFeedback = results[0];
    const [agentIdFromFeedback, clientAddress, feedbackIndex] = firstFeedback.id;

    // Agent responds to feedback (e.g., acknowledging refund)
    const responseUri = 'ipfs://QmExampleResponse';
    const responseHash = '0x' + '00'.repeat(32); // Hash of response file

    console.log('\nAppending response to feedback...');
    const txHash = await sdk.appendResponse(agentId, clientAddress, feedbackIndex, {
      uri: responseUri,
      hash: responseHash,
    });
    console.log(`Response appended. Transaction: ${txHash}`);
  }

  // 6. Get reputation summary
  console.log('\nGetting reputation summary...');
  const summary = await sdk.getReputationSummary(agentId, 'data_analyst');
  console.log(`Reputation: ${summary.averageScore}/100 from ${summary.count} reviews`);
}

main().catch(console.error);

