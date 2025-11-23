import 'dotenv/config';
import { RegistryBroker, type AgentSearchHit } from '../src/core/registry-broker.js';

const apiKey =
  process.env.REGISTRY_BROKER_API_KEY?.trim() || process.env.RB_API_KEY?.trim() || undefined;
const searchQuery = process.env.ERC8004_AGENT_QUERY?.trim() || 'defillama-verifiable-agent';

const selectAgentWithUaid = (hits: AgentSearchHit[]): AgentSearchHit | null =>
  hits.find((hit) => typeof hit.uaid === 'string' && hit.uaid.trim().length > 0) || null;

const extractReply = (payload: { content?: unknown; message?: unknown }): string => {
  if (typeof payload.content === 'string' && payload.content.trim().length > 0) {
    return payload.content.trim();
  }
  if (typeof payload.message === 'string') {
    return payload.message.trim();
  }
  return '';
};

async function main(): Promise<void> {
  const broker = new RegistryBroker({ apiKey });

  console.log(`Searching for ERC-8004 agents with query "${searchQuery}"`);
  const result = await broker.searchErc8004Agents({
    query: searchQuery,
    limit: 10,
    sortBy: 'most-recent',
  });

  if (!result?.hits?.length) {
    throw new Error('No ERC-8004 agents found for this query');
  }

  console.log(`Found ${result.hits.length} candidates`);

  const agent = selectAgentWithUaid(result.hits);
  if (!agent?.uaid) {
    throw new Error('No ERC-8004 agent with a UAID was found for this query');
  }
  console.log(`Opening session with UAID: ${agent.uaid}`);
  const chat = await broker.chat({
    uaid: agent.uaid,
    historyTtlSeconds: 300,
    message: 'Give a one-sentence summary of your capabilities.',
    encryption: { preference: 'preferred' },
  });
  console.log(`Session established: ${chat.sessionId}`);

  const reply = extractReply(chat.response);

  console.log('Agent reply:');
  console.log(reply || '[empty response]');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
