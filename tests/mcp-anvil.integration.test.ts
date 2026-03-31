import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { SDK } from '../src/index.js';
import type { AgentSummary } from '../src/models/interfaces.js';

const ANVIL_PORT = 8547;
const RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;
const CHAIN_ID = 31337;
const SERVER_PORT = 4043;
const SERVER_PATH = 'tests/mcp-server/server.mjs';
const DEPLOY_RESULT_PATH = join(process.cwd(), 'tests', '.x402-deploy-result-mcp.json');
const ANVIL_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

let anvil: ReturnType<typeof spawn> | null = null;
let server: ReturnType<typeof spawn> | null = null;

async function waitForRpc(url: string, attempts = 50): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      const j = (await res.json()) as { result?: string };
      if (j.result) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('anvil not ready');
}

async function waitForServer(url: string, attempts = 30): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url.replace('/mcp', '/'));
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('mcp server not ready');
}

function runForgeBuild(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('forge', ['build'], { cwd: process.cwd(), stdio: 'pipe' });
    let stderr = '';
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`forge build failed (${code}): ${stderr}`))));
    child.on('error', (e) => reject(new Error(`forge not found: ${e.message}`)));
  });
}

function runDeploy(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['scripts/deploy-x402-mock.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, RPC_URL, DEPLOY_RESULT_PATH },
      stdio: 'pipe',
    });
    let stderr = '';
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`deploy failed (${code}): ${stderr}`))));
    child.on('error', reject);
  });
}

interface DeployResult {
  token: string;
  tokens?: string[];
  payTo: string;
  chainId: number;
}

function readDeployResult(): DeployResult {
  return JSON.parse(readFileSync(DEPLOY_RESULT_PATH, 'utf8')) as DeployResult;
}

const run = process.env.RUN_MCP_ANVIL === '1';
const describeRun = run ? describe : describe.skip;

describeRun('MCP anvil integration (real x402 pay)', () => {
  const baseUrl = `http://localhost:${SERVER_PORT}/mcp`;

  beforeAll(async () => {
    anvil = spawn('anvil', ['--port', String(ANVIL_PORT)], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'pipe',
    });
    await waitForRpc(RPC_URL);
    const outPath = join(process.cwd(), 'out', 'MockEIP3009.sol', 'MockEIP3009.json');
    if (!existsSync(outPath)) await runForgeBuild();
    await runDeploy();
    const deploy = readDeployResult();
    const tokenAddresses = deploy.tokens ?? [deploy.token];
    const accepts = tokenAddresses.map((token) => ({
      price: '1000000',
      token,
      network: String(deploy.chainId),
      scheme: 'exact',
      destination: deploy.payTo,
    }));
    server = spawn('node', [SERVER_PATH], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(SERVER_PORT),
        MCP_402: '1',
        MCP_SESSION_REQUIRED: '1',
        ACCEPTS_JSON: JSON.stringify(accepts),
      },
      stdio: 'pipe',
    });
    await waitForServer(baseUrl);
  }, 90000);

  afterAll(() => {
    if (server) server.kill();
    if (anvil) anvil.kill();
    server = null;
    anvil = null;
  });

  it('agent.mcp listTools 402 -> pay() -> success', async () => {
    const sdk = new SDK({ chainId: CHAIN_ID, rpcUrl: RPC_URL, privateKey: ANVIL_PK });
    const agent = await sdk.createAgent('MCP Agent', 'Test').setMCP(baseUrl, '2025-06-18', false);
    const result = await agent.mcp.listTools();
    expect('x402Required' in result && result.x402Required).toBe(true);
    if (!('x402Required' in result) || !result.x402Required) return;
    const paid = await result.x402Payment.pay();
    expect('x402Required' in (paid as any)).toBe(false);
  }, 25000);

  it('summary-backed client listTools 402 -> pay() -> success', async () => {
    const sdk = new SDK({ chainId: CHAIN_ID, rpcUrl: RPC_URL, privateKey: ANVIL_PK });
    const summary: AgentSummary = {
      chainId: CHAIN_ID,
      agentId: `${CHAIN_ID}:0`,
      name: 'MCP Summary Agent',
      description: 'Test',
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
    const client = sdk.createMCPClient(summary);
    const result = await client.listTools();
    expect('x402Required' in result && result.x402Required).toBe(true);
    if (!('x402Required' in result) || !result.x402Required) return;
    const paid = await result.x402Payment.pay();
    expect('x402Required' in (paid as any)).toBe(false);
  }, 25000);
});

