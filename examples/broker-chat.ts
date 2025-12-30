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
const targetAgentId = process.env.ERC8004_AGENT_ID?.trim() || '';
const targetAgentUrl = process.env.ERC8004_AGENT_URL?.trim() || '';

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

  if (targetAgentUrl) {
    const agent = await sdk
      .createAgent('Remote Agent', 'Remote Agent handle')
      .setA2A(targetAgentUrl, '0.30', false);
    const chat = await agent.message('Give a one-sentence summary of your capabilities.', {
      historyTtlSeconds: 300,
      encryption: { preference: 'disabled' },
    });

    console.log(`Session established: ${chat.sessionId}`);

    const firstReply = extractReply(chat.response);
    console.log('Agent reply:');
    console.log(firstReply || '[empty response]');

    return;
  }

  console.log(`Searching registry "${registry}" for agents (query="${searchQuery || '[empty]'}")`);
  let result = await sdk.search({
    query: searchQuery,
    registry,
    adapters,
    limit: 200,
    sortBy: 'most-recent',
  });

  if (!result?.hits?.length) {
    console.log('No agents found for this query; falling back to most recent agents.');
    result = await sdk.search({
      registry,
      adapters,
      limit: 200,
      sortBy: 'most-recent',
    });
  }

  if (!result?.hits?.length) {
    throw new Error('No ERC-8004 agents found in this registry');
  }

  console.log(`Found ${result.hits.length} candidates`);

  if (!targetAgentId) {
    console.log('Set ERC8004_AGENT_ID to open a chat session. Top results:');
    result.hits.slice(0, 5).forEach((hit) => {
      console.log(`- ${(hit.name ?? '').trim() || '[no name]'} (${hit.id ?? '[no id]'})`);
    });
    return;
  }

  console.log(`Loading agent: ${targetAgentId}`);
  const agent = await sdk.loadAgent(targetAgentId);
  const chat = await agent.message('Give a one-sentence summary of your capabilities.', {
    historyTtlSeconds: 300,
    encryption: { preference: 'disabled' },
  });

  console.log(`Session established: ${chat.sessionId}`);

  const firstReply = extractReply(chat.response);
  console.log('Agent reply:');
  console.log(firstReply || '[empty response]');

  const followUp = await agent.message(
    'Great. Please share one concrete task you can perform and what info you need from me.',
    {
      sessionId: chat.sessionId,
      encryption: { preference: 'disabled' },
    },
  );

  const secondReply = extractReply(followUp.response);
  console.log('\nFollow-up reply:');
  console.log(secondReply || '[empty response]');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
