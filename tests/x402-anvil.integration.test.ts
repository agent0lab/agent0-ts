/**
 * x402 integration tests with real chain (Foundry anvil) and EIP-3009 token.
 * Uses viem only: anvil for the chain, forge to build the contract, a viem deploy script to deploy.
 * Then runs SDK request → 402 → pay() with real buildEvmPayment (real signer and signatures).
 *
 * Requires: Foundry on PATH (forge, anvil). Install: foundryup
 *
 * Run with: RUN_X402_ANVIL=1 npm test -- --testPathPattern=x402-anvil
 * Or:       npm run test:x402-anvil
 */

import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { SDK, ViemChainClient } from '../src/index.js';
import { buildEvmPayment } from '../src/core/x402-payment.js';

const ANVIL_PORT = 8545;
const RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;
const CHAIN_ID = 31337;
const SERVER_PORT = 4023;
const SERVER_PATH = 'tests/x402-server/server.mjs';
const DEPLOY_RESULT_PATH = join(process.cwd(), 'tests', '.x402-deploy-result.json');

// Anvil default account #0 (same as Hardhat)
const ANVIL_ACCOUNT_0_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

let anvilProcess: ReturnType<typeof spawn> | null = null;
let serverProcess: ReturnType<typeof spawn> | null = null;

async function waitForRpc(url: string, maxAttempts = 50): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
      });
      const data = (await res.json()) as { result?: string };
      if (data.result) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Anvil RPC did not become ready');
}

async function waitForServer(url: string, maxAttempts = 30): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 402 || res.status === 200) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('x402 server did not become ready');
}

function runForgeBuild(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('forge', ['build'], { cwd: process.cwd(), stdio: 'pipe' });
    let stderr = '';
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`forge build failed (${code}): ${stderr}`));
    });
    child.on('error', (e) => reject(new Error(`forge not found: ${e.message}. Install Foundry: foundryup`)));
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
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Deploy failed (${code}): ${stderr}`));
    });
    child.on('error', reject);
  });
}

interface DeployResult {
  token: string;
  tokens?: string[];
  payTo: string;
  chainId: number;
  mintAmount: string;
}

function readDeployResult(): DeployResult {
  const raw = readFileSync(DEPLOY_RESULT_PATH, 'utf8');
  return JSON.parse(raw) as DeployResult;
}

const runAnvil = process.env.RUN_X402_ANVIL === '1';
const describeAnvil = runAnvil ? describe : describe.skip;

describeAnvil('x402 Anvil integration (real chain + token + SDK, viem only)', () => {
  let baseUrl: string;
  let accepts: Array<{ price: string; token: string; network: string; scheme: string; destination: string }>;

  beforeAll(async () => {
    anvilProcess = spawn('anvil', ['--port', String(ANVIL_PORT)], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'pipe',
    });
    await waitForRpc(RPC_URL);

    const outDir = join(process.cwd(), 'out', 'MockEIP3009.sol', 'MockEIP3009.json');
    if (!existsSync(outDir)) await runForgeBuild();
    await runDeploy();

    const deploy = readDeployResult();
    const tokenAddresses = deploy.tokens ?? [deploy.token];
    accepts = tokenAddresses.map((token) => ({
      price: '1000000',
      token,
      network: String(deploy.chainId),
      scheme: 'exact' as const,
      destination: deploy.payTo,
    }));
    baseUrl = `http://localhost:${SERVER_PORT}`;
    serverProcess = spawn('node', [SERVER_PATH], {
      env: {
        ...process.env,
        PORT: String(SERVER_PORT),
        ACCEPTS_JSON: JSON.stringify(accepts),
      },
      stdio: 'pipe',
    });
    await waitForServer(baseUrl);
  }, 90000);

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
    }
    if (anvilProcess) {
      anvilProcess.kill();
      anvilProcess = null;
    }
  });

  const parseResponse = (r: Response) => r.json() as Promise<{ success?: boolean; data?: string }>;

  it('request → 402, then pay() with real buildEvmPayment → 200', async () => {
    const sdk = new SDK({
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
      privateKey: ANVIL_ACCOUNT_0_PRIVATE_KEY,
    });

    const result = await sdk.request({
      url: baseUrl,
      method: 'GET',
      parseResponse,
    });

    expect('x402Required' in result && result.x402Required).toBe(true);
    if (!('x402Required' in result) || !result.x402Required) return;

    const paid = await result.x402Payment.pay();
    expect(paid).toMatchObject({ success: true, data: 'resource' });
  }, 15000);

  it('payment with first request (real payload) → 200 in one round trip', async () => {
    const chainClient = new ViemChainClient({
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
      privateKey: ANVIL_ACCOUNT_0_PRIVATE_KEY,
    });
    const accept = accepts[0];
    if (!accept) throw new Error('no accept');
    const paymentPayload = await buildEvmPayment(accept, chainClient);

    const sdk = new SDK({
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
      privateKey: ANVIL_ACCOUNT_0_PRIVATE_KEY,
    });
    const result = await sdk.request({
      url: baseUrl,
      method: 'GET',
      payment: paymentPayload,
      parseResponse,
    });

    expect('x402Required' in result && result.x402Required).toBe(false);
    expect(result).toMatchObject({ success: true, data: 'resource' });
  }, 15000);

  it('multiple accepts (two tokens, one chain): pay(1) with second token → 200', async () => {
    expect(accepts.length).toBeGreaterThanOrEqual(2);
    const sdk = new SDK({
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
      privateKey: ANVIL_ACCOUNT_0_PRIVATE_KEY,
    });

    const result = await sdk.request({
      url: baseUrl,
      method: 'GET',
      parseResponse,
    });
    expect('x402Required' in result && result.x402Required).toBe(true);
    if (!('x402Required' in result) || !result.x402Required) return;

    const paid = await result.x402Payment.pay(1);
    expect(paid).toMatchObject({ success: true, data: 'resource' });
  }, 15000);
});
