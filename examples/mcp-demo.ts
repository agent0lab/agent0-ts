/**
 * Delx MCP demo: list tools, free tool call, then `donate_to_delx_project` (~$0.01 USDC via x402).
 *
 *   npx tsx examples/mcp-demo.ts
 *
 * Env (via `examples/_env`):
 *   RPC_URL or DELX_RPC_URL — Base mainnet RPC (default: https://mainnet.base.org).
 *   PRIVATE_KEY or AGENT_PRIVATE_KEY — Required for the donation step (x402 pay on Base).
 *
 * If `donate_to_delx_project` rejects arguments, match fields to its `inputSchema` from the tool list.
 */
import './_env';
import { SDK, isX402Required, type X402RequestResult } from '../src/index';
import type { AgentId } from '../src/models/types.js';

const DELX_AGENT_ID = '8453:28350' as AgentId;

async function main() {
  const privateKey = process.env.PRIVATE_KEY ?? process.env.AGENT_PRIVATE_KEY;

  const sdk = new SDK({
    chainId: 8453,
    rpcUrl: process.env.DELX_RPC_URL || process.env.RPC_URL || 'https://mainnet.base.org',
    ...(privateKey?.trim() ? { privateKey: privateKey.trim() } : {}),
  });

  const agent = await sdk.loadAgent(DELX_AGENT_ID);

  const tools = await agent.mcp.listTools();
  if (isX402Required(tools)) {
    console.error('listTools returned x402 (unexpected). Pay or use a different endpoint.');
    return;
  }
  console.log(
    'Tools (' + tools.length + '):\n  ' +
      tools.map((t) => t.name + (t.description ? ` — ${t.description}` : '')).join('\n  ')
  );

  const affirmation = await agent.mcp.call('get_affirmation', {});
  if (isX402Required(affirmation as X402RequestResult<unknown>)) {
    console.error('get_affirmation requires x402; this demo expects a free call.');
    return;
  }
  console.log('get_affirmation:', JSON.stringify(affirmation, null, 2));

  if (!privateKey?.trim()) {
    console.log('\nSkipping donate_to_delx_project: set PRIVATE_KEY or AGENT_PRIVATE_KEY for x402 USDC pay on Base.');
    return;
  }

  const donateFirst = (await agent.mcp.call('donate_to_delx_project', {
    message: 'Thanks for Delx — encouragement from agent0-ts mcp-demo.',
  })) as X402RequestResult<unknown>;

  let donateResult: unknown;
  if (isX402Required(donateFirst)) {
    console.log('donate_to_delx_project: paying x402 (~$0.01 USDC)…');
    donateResult = await donateFirst.x402Payment.pay();
  } else {
    donateResult = donateFirst;
  }
  console.log('donate_to_delx_project:', JSON.stringify(donateResult, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
