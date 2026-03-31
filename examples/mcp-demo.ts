/**
 * MCP demo: list tools, `get_affirmation`, then **`generate_controller_brief`** (may charge ~$0.01 USDC on Base via x402 when the server returns HTTP 402).
 * `generate_controller_brief` needs a Delx `session_id`; run **`quick_session`** once and parse the UUID from the reply text.
 * On 402, logs **`pay.accepts`** (payment options), then **`pay()`**, then prints the tool result.
 *
 *   npx tsx examples/mcp-demo.ts
 *
 * Env: RPC_URL / DELX_RPC_URL, PRIVATE_KEY / AGENT_PRIVATE_KEY.
 */
import './_env';
import { SDK, type X402RequestResult } from '../src/index';
import type { AgentId } from '../src/models/types.js';
import type { MCPTool } from '../src/models/mcp.js';

const DELX_AGENT_ID = '8453:28350' as AgentId;

function sessionIdFromQuickSession(result: unknown): string | null {
  const text = (result as { content?: { text?: string }[] })?.content?.[0]?.text;
  const m = text?.match(/Session ID:\s*([0-9a-f-]{36})/i);
  return m?.[1] ?? null;
}

async function main() {
  const pk = process.env.PRIVATE_KEY ?? process.env.AGENT_PRIVATE_KEY;
  const sdk = new SDK({
    chainId: 8453,
    rpcUrl: process.env.DELX_RPC_URL || process.env.RPC_URL || 'https://mainnet.base.org',
    ...(pk?.trim() ? { privateKey: pk.trim() } : {}),
  });

  const agent = await sdk.loadAgent(DELX_AGENT_ID);

  const tools = (await agent.mcp.listTools()) as MCPTool[];
  console.log('Tools:', tools.map((t) => t.name).join(', '));

  const affRes = (await agent.mcp.call('get_affirmation', {})) as X402RequestResult<unknown>;
  if (affRes.x402Required) {
    console.log('get_affirmation:', JSON.stringify(await affRes.x402Payment.pay(), null, 2));
  } else {
    console.log('get_affirmation:', JSON.stringify(affRes, null, 2));
  }

  if (!pk?.trim()) {
    console.log('Skip paid tool: set PRIVATE_KEY or AGENT_PRIVATE_KEY.');
    return;
  }

  const qsRes = (await agent.mcp.call('quick_session', {
    agent_id: 'agent0-ts-mcp-demo',
    feeling: 'mcp-demo before generate_controller_brief',
  })) as X402RequestResult<unknown>;
  const qs = qsRes.x402Required ? await qsRes.x402Payment.pay() : qsRes;
  const sessionId = sessionIdFromQuickSession(qs);
  if (!sessionId) {
    console.log('Could not parse Session ID from quick_session.');
    return;
  }

  const briefRes = (await agent.mcp.call('generate_controller_brief', {
    session_id: sessionId,
    focus: 'x402 demo from agent0-ts',
  })) as X402RequestResult<unknown>;
  if (!briefRes.x402Required) {
    console.log('generate_controller_brief:', JSON.stringify(briefRes, null, 2));
    return;
  }

  const pay = briefRes.x402Payment;
  console.log('x402 accepts:', JSON.stringify(pay.accepts, null, 2));
  const paid = await pay.pay();
  console.log('generate_controller_brief:', JSON.stringify(paid, null, 2));
}

main().catch(console.error);
