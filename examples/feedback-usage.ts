/**
 * Feedback Usage Example
 * 
 * This example demonstrates how to:
 * 1. Prepare feedback
 * 2. Give feedback on-chain
 * 3. Search for feedback
 * 4. Append response to feedback
 */

import { SDK } from '../src/index';
import { formatFeedbackId } from '../src/utils/id-format';

async function main() {
  const rpcUrl = process.env.RPC_URL;
  const privateKey = process.env.PRIVATE_KEY ?? process.env.AGENT_PRIVATE_KEY;
  const pinataJwt = process.env.PINATA_JWT;

  if (!rpcUrl || rpcUrl.trim() === '') {
    throw new Error('RPC_URL is required for this example');
  }
  if (!privateKey || privateKey.trim() === '') {
    throw new Error('PRIVATE_KEY (or AGENT_PRIVATE_KEY) is required for this example (giving feedback is a tx)');
  }
  if (!pinataJwt || pinataJwt.trim() === '') {
    throw new Error('PINATA_JWT is required for this example (it uses IPFS pinata for feedback files)');
  }

  // Initialize SDK
  const sdk = new SDK({
    chainId: 11155111, // Ethereum Sepolia
    rpcUrl,
    privateKey, // Required for submitting feedback
    ipfs: 'pinata', // Optional: for storing rich feedback data
    pinataJwt,
  });

  const agentId = '11155111:123'; // Replace with agent ID

  // 1. Prepare an OFF-CHAIN feedback file (optional).
  // Only use this if you have rich fields (text/context/capability/etc).
  // On-chain fields (value/tag1/tag2/endpoint) are passed directly to giveFeedback(...).
  const feedbackFile = sdk.prepareFeedbackFile({
    text: undefined,
    capability: 'tools',
    name: 'financial_analyzer',
    skill: 'financial_analysis',
    task: 'analyze_balance_sheet',
    context: { userId: 'user123', sessionId: 'session456' },
    proofOfPayment: { txHash: '0x...', amount: '0.01' },
  });

  // 2. Give feedback on-chain
  // Note: feedbackAuth is no longer required in ERC-8004 Jan 2026 spec
  // Clients can now submit feedback directly without pre-authorization
  console.log('Submitting feedback...');
  // ERC-8004 Jan 2026: `endpoint` is an optional *on-chain* field.
  // The SDK will store it on-chain (and also include it in the off-chain file as fallback if IPFS is used).
  const feedback = await sdk.giveFeedback(
    agentId,
    85,
    'data_analyst',
    'finance',
    'https://api.example.com/feedback',
    feedbackFile
  );
  console.log(
    `Feedback submitted with ID: ${formatFeedbackId(feedback.id[0], feedback.id[1], feedback.id[2])}`
  );
  console.log(`Value: ${feedback.value}, Tags: ${feedback.tags}`);

  // 3. Search for feedback
  console.log('\nSearching for feedback...');
  const results = await sdk.searchFeedback(
    {
    agentId,
      tags: ['data_analyst'],
      capabilities: ['tools'],
      skills: ['financial_analysis'],
    },
    { minValue: 70, maxValue: 100 }
  );
  console.log(`Found ${results.length} feedback entries`);

  // 4. Append response to feedback (agent acknowledging feedback)
  if (results.length > 0) {
    const firstFeedback = results[0];
    const [agentIdFromFeedback, clientAddress, feedbackIndex] = firstFeedback.id;

    // Agent responds to feedback (e.g., acknowledging refund)
    const responseUri = 'ipfs://QmExampleResponse';
    const responseHash = '0x' + '00'.repeat(32); // Hash of response file

    console.log('\nAppending response to feedback...');
    const txHash = await sdk.appendResponse(agentIdFromFeedback, clientAddress, feedbackIndex, {
      uri: responseUri,
      hash: responseHash,
    });
    console.log(`Response appended. Transaction: ${txHash}`);
  }

  // 5. Get reputation summary
  console.log('\nGetting reputation summary...');
  const summary = await sdk.getReputationSummary(agentId, 'data_analyst');
  console.log(`Reputation: ${summary.averageValue} from ${summary.count} reviews`);
}

main().catch(console.error);

