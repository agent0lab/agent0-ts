import 'dotenv/config';
import { SDK } from '../src/index.js';
import {
  HashgraphRegistryBrokerChatAdapter,
  HashgraphRegistryBrokerSearchAdapter,
} from '../src/adapters/registry-broker.js';

const baseUrl =
  process.env.REGISTRY_BROKER_BASE_URL?.trim() || 'https://hol.org/registry/api/v1';
const apiKey =
  process.env.REGISTRY_BROKER_API_KEY?.trim() || process.env.RB_API_KEY?.trim() || undefined;
const registry = process.env.ERC8004_REGISTRY?.trim() || 'erc-8004';
const adapters = (() => {
  const raw = process.env.ERC8004_ADAPTERS?.trim();
  if (!raw) {
    return undefined;
  }
  const parsed = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return parsed.length > 0 ? parsed : undefined;
})();
const searchQuery =
  process.env.ERC8004_AGENT_QUERY?.trim() || 'defillama-verifiable-agent';
const targetUaid = process.env.ERC8004_AGENT_UAID?.trim() || '';

const extractReply = (payload: { content?: string; message?: string }): string =>
  payload.content?.trim() || payload.message?.trim() || '';

async function main(): Promise<void> {
  const sdk = new SDK({
    chainId: Number(process.env.CHAIN_ID ?? '11155111'),
    rpcUrl: process.env.RPC_URL?.trim() || 'http://127.0.0.1:8545',
  });

  sdk.registerSearchAdapter(new HashgraphRegistryBrokerSearchAdapter({ apiKey, baseUrl }));
  sdk.registerChatAdapter(new HashgraphRegistryBrokerChatAdapter({ apiKey, baseUrl }));

  console.log(`Using Registry Broker baseUrl: ${baseUrl}`);
  console.log(`Searching registry "${registry}" for agents (query="${searchQuery || '[empty]'}")`);
  const result = await sdk.search({
    query: searchQuery,
    registry,
    adapters,
    limit: 200,
    sortBy: 'most-recent',
  });

  if (!result?.hits?.length) {
    throw new Error('No ERC-8004 agents found for this query');
  }

  console.log(`Found ${result.hits.length} candidates`);

  const selectedHit =
    (targetUaid ? result.hits.find((hit) => hit.uaid === targetUaid) : null) ??
    result.hits.find((hit) => (hit.uaid ?? '').includes(';proto=mcp;')) ??
    result.hits.find((hit) => (hit.uaid ?? '').includes(';proto=a2a;')) ??
    result.hits[0];

  const selectedUaid = selectedHit?.uaid?.trim() ?? '';
  if (!selectedUaid) {
    throw new Error('Selected ERC-8004 agent is missing a UAID');
  }

  console.log(`Opening session with UAID: ${selectedUaid}`);
  const chat = await sdk.chat({
    uaid: selectedUaid,
    historyTtlSeconds: 300,
    message: 'Give a one-sentence summary of your capabilities.',
    encryption: { preference: 'disabled' },
  });

  console.log(`Session established: ${chat.sessionId}`);

  const firstReply = extractReply(chat.response);
  console.log('Agent reply:');
  console.log(firstReply || '[empty response]');

  const followUp = await sdk.sendChatMessage({
    sessionId: chat.sessionId,
    uaid: selectedUaid,
    message: 'Great. Please share one concrete task you can perform and what info you need from me.',
  });

  const secondReply = extractReply(followUp);
  console.log('\nFollow-up reply:');
  console.log(secondReply || '[empty response]');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
