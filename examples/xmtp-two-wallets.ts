/**
 * XMTP two-wallets example
 *
 * Creates two SDK instances (Alice and Bob), each with a different wallet.
 * Both register an XMTP inbox, send messages to each other, then one side fetches and prints conversation history.
 *
 * Private keys are generated at runtime unless PRIVATE_KEY_ALICE and PRIVATE_KEY_BOB are set.
 * Environment:
 *   RPC_URL            — Optional. Default: https://base-sepolia.drpc.org.
 *   PRIVATE_KEY_ALICE  — Optional. Alice wallet private key (hex). If unset, a random key is used.
 *   PRIVATE_KEY_BOB    — Optional. Bob wallet private key (hex). If unset, a random key is used.
 *
 * Run:  npx tsx examples/xmtp-two-wallets.ts
 */

import './_env';
import { SDK } from '../src/index';

const CHAIN_ID = 84532;
const DEFAULT_RPC = 'https://base-sepolia.drpc.org';

/** Generate a random 32-byte hex private key for demo wallets. */
function randomPrivateKey(): `0x${string}` {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let hex = '0x';
  for (let i = 0; i < bytes.length; i++) {
    hex += (bytes[i]! as number).toString(16).padStart(2, '0');
  }
  return hex as `0x${string}`;
}

async function main(): Promise<void> {
  const keyAlice = (process.env.PRIVATE_KEY_ALICE ?? '').trim() || randomPrivateKey();
  const keyBob = (process.env.PRIVATE_KEY_BOB ?? '').trim() || randomPrivateKey();

  const rpcUrl = (process.env.RPC_URL ?? DEFAULT_RPC).trim() || DEFAULT_RPC;

  const sdkAlice = new SDK({ chainId: CHAIN_ID, rpcUrl, privateKey: keyAlice });
  const sdkBob = new SDK({ chainId: CHAIN_ID, rpcUrl, privateKey: keyBob });

  await sdkAlice.registerXMTPInbox();
  await sdkBob.registerXMTPInbox();

  // Installation key: identifies this inbox. You need to keep it between runs and pass it via
  // SDK config (xmtpInstallationKey) or loadXMTPInbox(key) to reuse the same inbox; otherwise
  // each run registers a new inbox and you can hit XMTP's per-wallet installation limit.
  const installKeyAlice = sdkAlice.getXMTPInstallationKey();
  const installKeyBob = sdkBob.getXMTPInstallationKey();
  console.log('Alice installation key:', installKeyAlice);
  console.log('Bob installation key:', installKeyBob);

  const aliceAddress = sdkAlice.getXMTPInboxInfo()!.walletAddress;
  const bobAddress = sdkBob.getXMTPInboxInfo()!.walletAddress;
  console.log('Alice wallet:', aliceAddress);
  console.log('Bob wallet:', bobAddress);

  // Same conversation: Alice opens DM with Bob, Bob opens DM with Alice (same 1:1 thread)
  await sdkAlice.messageXMTP(bobAddress, 'Hello from Alice');
  await sdkBob.messageXMTP(aliceAddress, 'Hello from Bob');

  await new Promise((r) => setTimeout(r, 2000));

  // Check Alice's view of the conversation (does she see her own send?)
  const convAlice = await sdkAlice.loadXMTPConversation(bobAddress);
  const aliceView = await convAlice.history({ limit: 10 });
  console.log("\nAlice's view (conversation with Bob):", aliceView.length, 'messages', aliceView.map((m) => m.content));

  // Bob's view
  const convBob = await sdkBob.loadXMTPConversation(aliceAddress);
  const bobView = await convBob.history({ limit: 10 });
  console.log("Bob's view (conversation with Alice):", bobView.length, 'messages', bobView.map((m) => m.content));

  console.log('\nConversation history (Bob\'s view):');
  console.log(JSON.stringify(bobView, null, 2));
}

main().catch(console.error);
