import {
  RegistryBroker,
  type AgentSearchHit,
  type SendMessageResponse,
} from '../src/core/registry-broker.ts';


const resolveApiKey = (): string | undefined =>
  process.env.REGISTRY_BROKER_API_KEY?.trim() ||
  process.env.RB_API_KEY?.trim() ||
  undefined;

const defaultQuery =
  process.env.ERC8004_AGENT_QUERY?.trim() || 'defillama-verifiable-agent';

const pickAgentWithUaid = (hits: AgentSearchHit[]): AgentSearchHit | null => {
  for (const hit of hits) {
    if (typeof hit.uaid === 'string' && hit.uaid.trim().length > 0) {
      return hit;
    }
  }
  return null;
};

const extractReplyText = (payload: SendMessageResponse): string => {
  if (typeof payload.content === 'string' && payload.content.trim().length > 0) {
    return payload.content.trim();
  }
  if (typeof payload.message === 'string') {
    return payload.message.trim();
  }
  return '';
};

describe('RegistryBroker ERC-8004 integration', () => {
  const broker = new RegistryBroker({
    apiKey: resolveApiKey(),
  });

  it('searches for ERC-8004 agents', async () => {
    const result = await broker.searchErc8004Agents({
      query: defaultQuery,
      limit: 8,
      sortBy: 'most-recent',
    });

    expect(result.total).toBeGreaterThan(0);
    expect(result.hits.length).toBeGreaterThan(0);
    const selected = pickAgentWithUaid(result.hits);
    expect(selected).not.toBeNull();
  });

  it('creates a session and exchanges a message with an ERC-8004 agent', async () => {
    const search = await broker.searchErc8004Agents({
      query: defaultQuery,
      limit: 8,
      sortBy: 'most-recent',
    });
    const agent = pickAgentWithUaid(search.hits);
    expect(agent).not.toBeNull();

    const uaid = agent?.uaid ?? '';
    if (uaid.trim().length === 0) {
      throw new Error('No ERC-8004 agent with UAID available for chat');
    }
    const chatResult = await broker.chat({
      uaid,
      message:
        'Provide a concise, one sentence summary of your available capabilities.',
      historyTtlSeconds: 180,
      encryption: { preference: 'preferred' },
    });
    expect(chatResult.sessionId.length).toBeGreaterThan(0);

    const reply = extractReplyText(chatResult.response);
    expect(reply.length).toBeGreaterThan(0);
  });
});
