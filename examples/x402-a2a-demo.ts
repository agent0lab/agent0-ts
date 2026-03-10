/**
 * x402 and A2A Demo
 *
 * Runs three flows in order:
 *
 *   1. Pure x402   — GET a payment-required API (Twitter search), pay with Base USDC, print JSON.
 *   2. Pure A2A    — Load an agent that does not require payment; send message, use task if present, list and load tasks.
 *   3. A2A + x402  — Load an agent that returns 402; pay, then print the success response.
 *
 * Environment:
 *   PRIVATE_KEY or AGENT_PRIVATE_KEY  — Required for signing and x402 payments.
 *   RPC_URL                           — Optional. Base Sepolia RPC (default: https://base-sepolia.drpc.org).
 *   BASE_MAINNET_RPC_URL              — Optional. Base mainnet RPC for flow 1 (default: https://base.drpc.org).
 *
 * Run:  npx tsx examples/x402-a2a-demo.ts
 */

import './_env';
import {
  SDK,
  type MessageResponse,
  type TaskResponse,
  type AgentTask,
  type TaskSummary,
} from '../src/index';

const BASE_SEPOLIA_CHAIN_ID = 84532;

/**
 * Flow 1 — Pure x402: call a payment-required HTTP API, pay, then use the response.
 * Uses the Twitter x402 API; on 402 we pay with the Base (EVM) option and print the JSON body.
 */
const X402_SEARCH_URL = 'https://twitter.x402.agentbox.fyi/search?q=from:elonmusk+AI&type=Latest&limit=5';

async function runPureX402(sdk: SDK): Promise<void> {
  console.log('\n--- 1. Pure x402 ---');

  const result = await sdk.request({ url: X402_SEARCH_URL, method: 'GET' });

  if (result.x402Required) {
    // accepts are already EVM-only (Solana filtered out when 402 is received). pay(index) = first, second, … EVM option.
    const paid = await result.x402Payment.pay(0);
    console.log(JSON.stringify(paid, null, 2));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

/**
 * Flow 2 — Pure A2A: send a message; if the server creates a task we query it, send a follow-up, and cancel.
 * Then list tasks and, if any, load the first and query it.
 */
async function runPureA2A(sdk: SDK): Promise<void> {
  console.log('\n--- 2. Pure A2A ---');

  const agent = await sdk.loadAgent('84532:1298');

  const msg = (await agent.messageA2A('Hello, this is a demo message.')) as MessageResponse | TaskResponse;
  console.log('messageA2A:', JSON.stringify(msg, null, 2));

  if ('task' in msg) {
    const task = msg.task;
    console.log('task.query():', JSON.stringify(await task.query(), null, 2));
    await task.message('Follow-up message.');
    console.log('task.cancel():', JSON.stringify(await task.cancel(), null, 2));
  }

  const tasks = (await agent.listTasks()) as TaskSummary[];
  console.log('listTasks:', JSON.stringify(tasks, null, 2));
  if (tasks.length > 0) {
    const task = (await agent.loadTask(tasks[0]!.taskId)) as AgentTask;
    console.log('loadTask + query():', JSON.stringify(await task.query(), null, 2));
  }
}

/**
 * Flow 3 — A2A with x402: agent 84532:1301 returns 402; we pay then get the success response.
 * One message triggers payment; after pay() we get the same shape as a normal message/task response.
 */
async function runA2AWithX402(sdk: SDK): Promise<void> {
  console.log('\n--- 3. A2A with x402 ---');

  const agent = await sdk.loadAgent('84532:1301');

  const result = await agent.messageA2A('Hello, please charge me once.');
  if (!result.x402Required) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const paid = await result.x402Payment.pay();
  console.log(JSON.stringify(paid, null, 2));
}

const BASE_SEPOLIA_RPC = 'https://base-sepolia.drpc.org';
const BASE_MAINNET_RPC = 'https://base.drpc.org';

/**
 * Build SDK (Base Sepolia + Base mainnet for x402), then run the three demo flows.
 */
async function main(): Promise<void> {
  const rpcUrl = (process.env.RPC_URL ?? BASE_SEPOLIA_RPC).trim() || BASE_SEPOLIA_RPC;
  const privateKey = process.env.PRIVATE_KEY ?? process.env.AGENT_PRIVATE_KEY;
  if (!privateKey || privateKey.trim() === '') {
    throw new Error('PRIVATE_KEY (or AGENT_PRIVATE_KEY) is required for x402 pay and A2A+x402');
  }

  const sdk = new SDK({
    chainId: BASE_SEPOLIA_CHAIN_ID,
    rpcUrl,
    privateKey,
    rpcUrls: {
      [BASE_SEPOLIA_CHAIN_ID]: rpcUrl,
      8453: process.env.BASE_MAINNET_RPC_URL?.trim() || BASE_MAINNET_RPC,
    },
  });

  await runPureX402(sdk);
  await runPureA2A(sdk);
  await runA2AWithX402(sdk);
  console.log('\nDone.');
}

main().catch(console.error);
