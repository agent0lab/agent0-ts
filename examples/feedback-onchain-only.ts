/**
 * On-chain Only Feedback Example (ERC-8004 Jan 2026)
 *
 * This example demonstrates how to submit feedback that is *only* stored on-chain:
 * - value
 * - tag1
 * - tag2
 * - endpoint (optional on-chain field)
 *
 * No off-chain feedback file is created/uploaded because the SDK is configured without IPFS.
 */

import { SDK } from '../src/index';

async function main() {
  const rpcUrl = process.env.RPC_URL;
  const privateKey = process.env.PRIVATE_KEY ?? process.env.AGENT_PRIVATE_KEY;

  if (!rpcUrl || rpcUrl.trim() === '') {
    throw new Error('RPC_URL is required for this example');
  }
  if (!privateKey || privateKey.trim() === '') {
    throw new Error('PRIVATE_KEY (or AGENT_PRIVATE_KEY) is required for this example (giving feedback is a tx)');
  }

  const sdk = new SDK({
    chainId: 11155111, // Ethereum Sepolia
    rpcUrl,
    privateKey, // required for submitting feedback
    // Note: Even if you configure `ipfs`, the SDK will only upload an off-chain feedback file
    // when the payload includes off-chain fields (text/context/capability/etc).
  });

  const agentId = '11155111:123'; // Replace with an existing agent ID

  console.log('Submitting on-chain only feedback...');
  const feedback = await sdk.giveFeedback(
    agentId,
    92,
    'quality',
    'latency',
    'https://api.example.com/feedback' // optional on-chain endpoint
  );

  console.log('Submitted feedback:', feedback.id, {
    value: feedback.value,
    tags: feedback.tags,
    endpoint: feedback.endpoint,
  });

  // Sanity check: this should be on-chain only, so no feedbackURI should be set.
  const [_, clientAddress, feedbackIndex] = feedback.id;
  const retrieved = await sdk.getFeedback(agentId, clientAddress, feedbackIndex);
  if (retrieved.fileURI) {
    throw new Error(`Expected on-chain only feedback (no fileURI), got: ${retrieved.fileURI}`);
  }
}

main().catch(console.error);

