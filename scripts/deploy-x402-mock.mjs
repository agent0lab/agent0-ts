/**
 * Deploy MockEIP3009 for x402 tests using viem. Reads Forge artifact from out/.
 * Requires: forge build already run, anvil (or other RPC) running.
 *
 * Env:
 *   RPC_URL             - default http://127.0.0.1:8545
 *   DEPLOY_RESULT_PATH  - default tests/.x402-deploy-result.json
 *
 * Run: node scripts/deploy-x402-mock.mjs
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { anvil } from 'viem/chains';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const DEPLOY_RESULT_PATH =
  process.env.DEPLOY_RESULT_PATH || path.join(projectRoot, 'tests', '.x402-deploy-result.json');

// Anvil default account #0 (same as Hardhat)
const DEFAULT_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

async function main() {
  const artifactPath = path.join(projectRoot, 'out', 'MockEIP3009.sol', 'MockEIP3009.json');
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  const rawBytecode = artifact.bytecode?.object ?? artifact.bytecode;
  const abi = artifact.abi;
  if (!rawBytecode || !abi) throw new Error('Artifact missing bytecode or abi');
  const bytecode = typeof rawBytecode === 'string' && rawBytecode.startsWith('0x') ? rawBytecode : `0x${rawBytecode}`;

  const account = privateKeyToAccount(DEFAULT_PRIVATE_KEY);
  const chain = { ...anvil, id: 31337, rpcUrls: { default: { http: [RPC_URL] } } };
  const transport = http(RPC_URL);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ chain, transport, account });

  const payTo = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'; // anvil account #1
  const mintAmount = 10n ** 18n;
  const mintAbi = parseAbi(['function mint(address to, uint256 amount) external']);

  const deployAndMint = async () => {
    const hash = await walletClient.deployContract({ abi, bytecode, account });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const address = receipt.contractAddress;
    if (!address) throw new Error('No contract address in receipt');
    const mintHash = await walletClient.writeContract({
      address,
      abi: mintAbi,
      functionName: 'mint',
      args: [account.address, mintAmount],
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash: mintHash });
    return address;
  };

  const token1 = await deployAndMint();
  const token2 = await deployAndMint();

  const result = {
    token: token1,
    tokens: [token1, token2],
    payTo,
    chainId: 31337,
    mintAmount: String(mintAmount),
  };

  mkdirSync(path.dirname(DEPLOY_RESULT_PATH), { recursive: true });
  writeFileSync(DEPLOY_RESULT_PATH, JSON.stringify(result, null, 2), 'utf8');
  console.log('Deployed MockEIP3009 x2:', token1, token2, 'chainId: 31337', 'payTo:', payTo);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
