import {
  HashgraphRegistryBrokerChatAdapter,
  HashgraphRegistryBrokerSearchAdapter,
} from '../src/adapters/registry-broker.ts';
import type {
  AgentChatSendMessageResponse,
  AgentSearchHit,
  AgentVectorSearchResponse,
} from '../src/core/adapters.ts';

const baseUrl = process.env.REGISTRY_BROKER_BASE_URL?.trim();

const resolveApiKey = (): string | undefined =>
  process.env.REGISTRY_BROKER_API_KEY?.trim() ||
  process.env.RB_API_KEY?.trim() ||
  undefined;

const defaultQuery =
  process.env.ERC8004_AGENT_QUERY?.trim() || 'defillama-verifiable-agent';
const defaultRegistry = process.env.ERC8004_REGISTRY?.trim() || 'erc-8004';
const defaultAdapters = (() => {
  const raw = process.env.ERC8004_ADAPTERS?.trim();
  if (!raw) {
    return undefined;
  }
  const adapters = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return adapters.length > 0 ? adapters : undefined;
})();

const targetUaidRaw = process.env.ERC8004_AGENT_UAID ?? '';
const targetUaid = targetUaidRaw.trim();

const pickAgentWithUaid = (hits: AgentSearchHit[]): AgentSearchHit | null => {
  for (const hit of hits) {
    if (typeof hit.uaid === 'string' && hit.uaid.trim().length > 0) {
      return hit;
    }
  }
  return null;
};

const extractReplyText = (payload: AgentChatSendMessageResponse): string => {
  if (typeof payload.content === 'string' && payload.content.trim().length > 0) {
    return payload.content.trim();
  }
  if (typeof payload.message === 'string') {
    return payload.message.trim();
  }
  return '';
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isVectorSearchHealthyPayload = (value: unknown): boolean => {
  if (!isRecord(value)) {
    return false;
  }
  const vectorStatus = value.vectorStatus;
  if (!isRecord(vectorStatus)) {
    return false;
  }
  return vectorStatus.healthy === true;
};

const fetchVectorSearchHealthy = async (): Promise<boolean> => {
  if (!baseUrl) {
    return false;
  }
  try {
    const response = await fetch(`${baseUrl}/search/status`);
    if (!response.ok) {
      return false;
    }
    const payload: unknown = await response.json();
    return isVectorSearchHealthyPayload(payload);
  } catch {
    return false;
  }
};

const describeRegistryBroker = baseUrl ? describe : describe.skip;

describeRegistryBroker('RegistryBroker ERC-8004 integration', () => {
  const searchAdapter = new HashgraphRegistryBrokerSearchAdapter({
    baseUrl,
    apiKey: resolveApiKey(),
  });
  const chatAdapter = new HashgraphRegistryBrokerChatAdapter({
    baseUrl,
    apiKey: resolveApiKey(),
  });

  let vectorSearchHealthy = false;

  beforeAll(async () => {
    vectorSearchHealthy = await fetchVectorSearchHealthy();
  });

  it('searches for ERC-8004 agents', async () => {
    const result = await searchAdapter.search({
      query: defaultQuery,
      registry: defaultRegistry,
      adapters: defaultAdapters,
      limit: 8,
      sortBy: 'most-recent',
    });

    expect(result.total).toBeGreaterThan(0);
    expect(result.hits.length).toBeGreaterThan(0);
    const selected = pickAgentWithUaid(result.hits);
    expect(selected).not.toBeNull();
  });

  const itChat = targetUaid.length > 0 ? it : it.skip;
  itChat('creates a session and exchanges a message with an ERC-8004 agent', async () => {
    const uaid = targetUaid;

    const session = await chatAdapter.createSession({
      uaid,
      historyTtlSeconds: 180,
    });
    const sessionId = session.sessionId ?? '';
    expect(sessionId.length).toBeGreaterThan(0);

    const replyPayload = await chatAdapter.sendMessage({
      sessionId,
      uaid,
      message:
        'Provide a concise, one sentence summary of your available capabilities.',
    });

    const reply = extractReplyText(replyPayload);
    expect(reply.length).toBeGreaterThan(0);
  });

  it('performs a vector search', async () => {
    if (!vectorSearchHealthy) {
      return;
    }
    if (!searchAdapter.vectorSearch) {
      throw new Error('Search adapter does not support vectorSearch');
    }
    const query = defaultQuery.trim().length > 0 ? defaultQuery : 'claude';
    const response: AgentVectorSearchResponse = await searchAdapter.vectorSearch({
      query,
      limit: 3,
      filter: {
        registry: defaultRegistry,
        adapters: defaultAdapters,
      },
    });
    expect(Array.isArray(response.hits)).toBe(true);
    expect(typeof response.total).toBe('number');
    if (response.hits && response.hits.length > 0) {
      const uaidPresent = response.hits.some(
        (hit) =>
          typeof hit.agent?.uaid === 'string' && hit.agent.uaid.length > 0,
      );
      expect(uaidPresent).toBe(true);
    }
  });
});
