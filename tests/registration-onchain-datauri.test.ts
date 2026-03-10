/**
 * Live integration test for fully on-chain registration (ERC-8004 data URI).
 *
 * This writes agentURI/tokenURI as:
 *   data:application/json;base64,...
 *
 * and verifies `loadAgent()` can decode it back.
 */

import { describe, expect, it } from '@jest/globals';
import { SDK } from '../src/index';
import { CHAIN_ID, RPC_URL, AGENT_PRIVATE_KEY, printConfig } from './config';
import { defineChain, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const HAS_AGENT_KEY = Boolean(AGENT_PRIVATE_KEY && AGENT_PRIVATE_KEY.trim() !== '');
// Live/integration test (on-chain).
// Default: enabled when env vars are present. Set RUN_LIVE_TESTS=0 to disable.
const RUN_LIVE_TESTS = process.env.RUN_LIVE_TESTS !== '0';
const describeMaybe = RUN_LIVE_TESTS && HAS_AGENT_KEY ? describe : describe.skip;

function randomSuffix(): number {
  return Math.floor(Math.random() * 900000) + 100000;
}

describeMaybe('Agent Registration with on-chain data URI (EIP-8004)', () => {
  beforeAll(() => {
    printConfig();
    if (CHAIN_ID !== 84532) {
      // This test is intended for Base Sepolia when running in CI/local.
      // It still works on other chains, but we keep expectations explicit.
      console.warn(`registration-onchain-datauri.test.ts: expected CHAIN_ID=84532, got ${CHAIN_ID}`);
    }
  });

  it(
    'should register agent on-chain with data URI and reload via loadAgent',
    async () => {
      const sdk = new SDK({
        chainId: CHAIN_ID,
        rpcUrl: RPC_URL,
        privateKey: AGENT_PRIVATE_KEY,
        // Keep default 256 KiB limit; data URI here is tiny.
      });

      // Preflight: ensure signer has funds on this chain, otherwise skip without failing the suite.
      const pk = AGENT_PRIVATE_KEY.startsWith('0x') ? AGENT_PRIVATE_KEY : `0x${AGENT_PRIVATE_KEY}`;
      const acct = privateKeyToAccount(pk as any);
      const chain = defineChain({
        id: CHAIN_ID,
        name: `chain-${CHAIN_ID}`,
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [RPC_URL] } },
      });
      const pub = createPublicClient({ chain, transport: http(RPC_URL) });
      const bal = await pub.getBalance({ address: acct.address });
      if (bal === 0n) {
        console.warn(
          `Skipping live on-chain data URI test: ${acct.address} has 0 balance on chainId=${CHAIN_ID}.`
        );
        return;
      }

      const s = randomSuffix();
      const agent = sdk.createAgent(`OnChain Agent ${s}`, `OnChain registration ${s}`);
      agent.setActive(true);
      agent.setTrust(true, false, false);

      const tx = await agent.registerOnChain();
      const { result: rf } = await tx.waitConfirmed({ timeoutMs: 180_000 });

      expect(rf.agentId).toBeTruthy();
      expect(rf.agentURI).toBeTruthy();
      expect(rf.agentURI!.startsWith('data:application/json')).toBe(true);

      // Read it back from chain (tokenURI => data: URI => decoded JSON)
      const loaded = await sdk.loadAgent(rf.agentId!);
      expect(loaded.name).toBe(`OnChain Agent ${s}`);
      expect(loaded.description).toBe(`OnChain registration ${s}`);
    },
    240_000
  );
});

