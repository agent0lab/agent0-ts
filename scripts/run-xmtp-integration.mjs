#!/usr/bin/env node
/**
 * Run XMTP integration: two wallets, register both, exchange messages, load inboxes.
 *
 * Usage (from repo root):
 *   npm run build
 *   npm run test:xmtp-integration:run
 *
 * Optional .env: CHAIN_ID, RPC_URL. Fresh wallets are generated each run.
 */

import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

require('dotenv').config({ path: join(__dirname, '..', '.env') });

const CHAIN_ID = parseInt(process.env.CHAIN_ID || '11155111', 10);
const RPC_URL = process.env.RPC_URL || 'https://eth-sepolia.g.alchemy.com/v2/demo';

function ok(condition, message) {
  if (!condition) throw new Error(message);
}

function wallet() {
  const privateKey = '0x' + randomBytes(32).toString('hex');
  return { privateKey };
}

async function main() {
  const alice = wallet();
  const bob = wallet();

  console.log('Loading SDK...');
  const distPath = pathToFileURL(join(__dirname, '..', 'dist', 'index.js')).href;
  const { SDK, Agent, XMTPReceiverNotRegisteredError } = await import(distPath);

  const sdkAlice = new SDK({
    chainId: CHAIN_ID,
    rpcUrl: RPC_URL,
    privateKey: alice.privateKey,
    xmtpEnv: 'production',
  });
  const sdkBob = new SDK({
    chainId: CHAIN_ID,
    rpcUrl: RPC_URL,
    privateKey: bob.privateKey,
    xmtpEnv: 'production',
  });

  console.log('1. Register Alice...');
  const keyAlice = await sdkAlice.registerXMTPInbox();
  ok(JSON.parse(keyAlice).walletAddress, 'Alice key');
  const addrAlice = sdkAlice.getXMTPInboxInfo()?.walletAddress;
  ok(addrAlice, 'Alice address');
  console.log('   OK —', addrAlice.slice(0, 10) + '...');

  console.log('2. Register Bob...');
  const keyBob = await sdkBob.registerXMTPInbox();
  ok(JSON.parse(keyBob).walletAddress, 'Bob key');
  const addrBob = sdkBob.getXMTPInboxInfo()?.walletAddress;
  ok(addrBob, 'Bob address');
  console.log('   OK —', addrBob.slice(0, 10) + '...');

  // Brief delay so both identities are visible on the network
  await new Promise((r) => setTimeout(r, 2000));

  console.log('3. Alice → Bob: messageXMTP + loadXMTPConversation().message()...');
  await sdkAlice.messageXMTP(addrBob, 'Hello Bob, from Alice');
  const convAliceToBob = await sdkAlice.loadXMTPConversation(addrBob);
  await convAliceToBob.message('Second message from Alice');
  console.log('   OK');

  console.log('4. Bob → Alice: messageXMTP + loadXMTPConversation().message()...');
  await sdkBob.messageXMTP(addrAlice, 'Hello Alice, from Bob');
  const convBobToAlice = await sdkBob.loadXMTPConversation(addrAlice);
  await convBobToAlice.message('Second message from Bob');
  console.log('   OK');

  console.log('5. Alice → Agent(Bob): agent.messageXMTP + agent.loadXMTPConversation() (live)...');
  const regFileBob = {
    name: 'Bob',
    description: 'Test agent',
    endpoints: [],
    trustModels: ['reputation'],
    owners: [],
    operators: [],
    active: false,
    x402support: false,
    metadata: {},
    updatedAt: Math.floor(Date.now() / 1000),
    walletAddress: addrBob,
  };
  const agentBob = new Agent(sdkAlice, regFileBob);
  await agentBob.messageXMTP('Hello agent, from Alice via Agent');
  const convToAgent = await agentBob.loadXMTPConversation();
  await convToAgent.message('Second message to agent');
  const histToAgent = await convToAgent.history({ limit: 10 });
  ok(histToAgent.length >= 1, 'agent conversation has messages');
  ok(histToAgent.some((m) => m.content?.includes('Hello agent') || m.content?.includes('Second message to agent')), 'Alice sees messages to agent');
  console.log('   OK — messages:', histToAgent.length);

  // Allow time for messages to sync before reading inboxes
  await new Promise((r) => setTimeout(r, 3000));

  console.log('6. Alice: XMTPConversations() + load conversation with Bob, check history...');
  const listAlice = await sdkAlice.XMTPConversations();
  ok(Array.isArray(listAlice) && listAlice.length >= 1, 'Alice has conversations');
  const convAlice = await sdkAlice.loadXMTPConversation(addrBob);
  const historyAlice = await convAlice.history({ limit: 20 });
  ok(historyAlice.length >= 2, 'Alice sees at least 2 messages in thread');
  const fromBob = historyAlice.filter((m) => m.content?.includes('from Bob'));
  ok(fromBob.length >= 1, 'Alice sees at least one message from Bob');
  console.log('   OK — messages:', historyAlice.length, 'from Bob:', fromBob.length);

  console.log('7. Bob: XMTPConversations() + load conversation with Alice, check history...');
  const listBob = await sdkBob.XMTPConversations();
  ok(Array.isArray(listBob) && listBob.length >= 1, 'Bob has conversations');
  const convBob = await sdkBob.loadXMTPConversation(addrAlice);
  const historyBob = await convBob.history({ limit: 20 });
  ok(historyBob.length >= 2, 'Bob sees at least 2 messages in thread');
  const fromAlice = historyBob.filter((m) => m.content?.includes('from Alice'));
  ok(fromAlice.length >= 1, 'Bob sees at least one message from Alice');
  console.log('   OK — messages:', historyBob.length, 'from Alice:', fromAlice.length);

  console.log('8. messageXMTP(unregistered) throws XMTPReceiverNotRegisteredError...');
  const unregistered = '0x0000000000000000000000000000000000000001';
  try {
    await sdkAlice.messageXMTP(unregistered, 'Hi');
    throw new Error('expected throw');
  } catch (e) {
    ok(e?.name === 'XMTPReceiverNotRegisteredError', 'receiver not registered');
  }
  console.log('   OK');

  console.log('9. loadXMTPConversation(unregistered) throws...');
  try {
    await sdkAlice.loadXMTPConversation(unregistered);
    throw new Error('expected throw');
  } catch (e) {
    ok(e?.name === 'XMTPReceiverNotRegisteredError', 'receiver not registered');
  }
  console.log('   OK');

  console.log('\nAll XMTP integration steps passed (2 wallets, Agent messaging, inbox load).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
