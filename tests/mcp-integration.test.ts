import { spawn } from 'child_process';
import { SDK } from '../src/core/sdk.js';
import { Agent } from '../src/core/agent.js';
import { EndpointType, TrustModel } from '../src/models/enums.js';
import type { RegistrationFile, AgentSummary } from '../src/models/interfaces.js';

const PORT = 4040;
const PORT_AUTH = 4041;
const PORT_402 = 4042;
const SERVER_PATH = 'tests/mcp-server/server.mjs';
const BASE = `http://localhost:${PORT}/mcp`;
const BASE_AUTH = `http://localhost:${PORT_AUTH}/mcp`;
const BASE_402 = `http://localhost:${PORT_402}/mcp`;
const API_KEY = 'test-secret';

const VALID_PAYLOAD_402 = Buffer.from(
  JSON.stringify({
    x402Version: 1,
    scheme: 'exact',
    network: '84532',
    payload: {
      signature: '0x' + 'a'.repeat(130),
      authorization: {
        from: '0x1234567890123456789012345678901234567890',
        to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
        value: '1000000',
        validAfter: '0',
        validBefore: String(Math.floor(Date.now() / 1000) + 3600),
        nonce: '0x' + 'b'.repeat(64),
      },
    },
  })
).toString('base64');

async function waitFor(url: string, attempts = 30): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url.replace('/mcp', '/'));
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server not ready');
}

function makeAgent(baseUrl: string, buildPayment?: () => Promise<string>): Agent {
  const reg: RegistrationFile = {
    name: 'mcp-agent',
    description: 'test',
    endpoints: [{ type: EndpointType.MCP, value: baseUrl, meta: { version: '2025-06-18' } }],
    trustModels: [TrustModel.REPUTATION],
    owners: [],
    operators: [],
    active: true,
    x402support: false,
    metadata: {},
    updatedAt: 0,
  };
  const sdkLike = {
    getX402RequestDeps: () => ({
      fetch: globalThis.fetch,
      buildPayment: buildPayment ?? (async () => VALID_PAYLOAD_402),
    }),
  } as unknown as SDK;
  return new Agent(sdkLike, reg);
}

function makeSummaryClient(baseUrl: string): ReturnType<SDK['createMCPClient']> {
  const sdk = new SDK({ chainId: 84532, rpcUrl: 'https://base-sepolia.drpc.org' });
  const summary: AgentSummary = {
    chainId: 1,
    agentId: '1:1',
    name: 'mcp-summary',
    description: 'test',
    mcp: baseUrl,
    owners: [],
    operators: [],
    supportedTrusts: [],
    a2aSkills: [],
    mcpTools: [],
    mcpPrompts: [],
    mcpResources: [],
    oasfSkills: [],
    oasfDomains: [],
    active: true,
    x402support: false,
    extras: {},
  };
  return sdk.createMCPClient(summary);
}

const run = process.env.RUN_MCP_INTEGRATION === '1';
const describeRun = run ? describe : describe.skip;

describeRun('MCP integration', () => {
  let proc: ReturnType<typeof spawn> | null = null;
  beforeAll(async () => {
    proc = spawn('node', [SERVER_PATH], {
      env: { ...process.env, PORT: String(PORT), MCP_SESSION_REQUIRED: '1' },
      stdio: 'pipe',
    });
    await waitFor(BASE);
  }, 15000);
  afterAll(() => {
    if (proc) proc.kill();
    proc = null;
  });

  it('agent.mcp tools/prompts/resources flow works', async () => {
    const agent = makeAgent(BASE);
    const tools = await agent.mcp.listTools();
    expect('x402Required' in tools).toBe(false);
    const weather = (await agent.mcp.call('get_weather', { location: 'Paris' })) as any;
    expect('x402Required' in weather).toBe(false);
    if (!('x402Required' in weather)) expect(weather.content[0].text).toContain('Weather');
    const prompts = await agent.mcp.prompts.list();
    expect('x402Required' in prompts).toBe(false);
    const prompt = await agent.mcp.prompts.get('code_review', { code: 'x' });
    expect('x402Required' in prompt).toBe(false);
    const resources = await agent.mcp.resources.list();
    expect('x402Required' in resources).toBe(false);
    const read = await agent.mcp.resources.read('file:///README.md');
    expect('x402Required' in read).toBe(false);
    const tpl = await agent.mcp.resources.templates.list();
    expect('x402Required' in tpl).toBe(false);
  }, 15000);

  it('summary-backed MCP client works', async () => {
    const client = makeSummaryClient(BASE);
    const tools = await client.listTools();
    expect('x402Required' in tools).toBe(false);
    const out = (await client.call('user-profile/update', { userId: '1' })) as any;
    expect('x402Required' in out).toBe(false);
  }, 15000);
});

describeRun('MCP integration with auth', () => {
  let proc: ReturnType<typeof spawn> | null = null;
  beforeAll(async () => {
    proc = spawn('node', [SERVER_PATH], {
      env: { ...process.env, PORT: String(PORT_AUTH), MCP_AUTH: '1', MCP_EXPECTED_KEY: API_KEY, MCP_SESSION_REQUIRED: '1' },
      stdio: 'pipe',
    });
    await waitFor(BASE_AUTH);
  }, 15000);
  afterAll(() => {
    if (proc) proc.kill();
    proc = null;
  });

  it('requires auth and succeeds with bearer credential', async () => {
    const agent = makeAgent(BASE_AUTH);
    await expect(agent.mcp.listTools()).rejects.toThrow(/401|unauthorized/i);
    const ok = await agent.mcp.listTools({ credential: API_KEY });
    expect('x402Required' in ok).toBe(false);
  }, 12000);
});

describeRun('MCP integration with x402', () => {
  let proc: ReturnType<typeof spawn> | null = null;
  beforeAll(async () => {
    proc = spawn('node', [SERVER_PATH], {
      env: { ...process.env, PORT: String(PORT_402), MCP_402: '1', MCP_SESSION_REQUIRED: '1' },
      stdio: 'pipe',
    });
    await waitFor(BASE_402);
  }, 15000);
  afterAll(() => {
    if (proc) proc.kill();
    proc = null;
  });

  it('returns x402Required then pay() succeeds', async () => {
    const agent = makeAgent(BASE_402, async () => VALID_PAYLOAD_402);
    const result = await agent.mcp.listTools();
    expect('x402Required' in result && result.x402Required).toBe(true);
    if (!('x402Required' in result) || !result.x402Required) return;
    const paid = await result.x402Payment.pay();
    expect('x402Required' in (paid as any)).toBe(false);
  }, 15000);
});

