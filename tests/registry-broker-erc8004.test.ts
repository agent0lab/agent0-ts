import {
  HashgraphRegistryBrokerChatAdapter,
  HashgraphRegistryBrokerSearchAdapter,
} from '../src/adapters/registry-broker.ts';
import { SDK } from '../src/index.js';
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

const targetAgentId = process.env.ERC8004_AGENT_ID?.trim() || '';
const targetAgentUrl = process.env.ERC8004_AGENT_URL?.trim() || '';

const pickAgentWithId = (hits: AgentSearchHit[]): AgentSearchHit | null => {
  for (const hit of hits) {
    if (typeof hit.id === 'string' && hit.id.trim().length > 0) {
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

type VectorSearchStatusPayload = {
  vectorStatus?: {
    healthy?: boolean;
  };
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
    const payload = (await response.json()) as VectorSearchStatusPayload;
    return payload.vectorStatus?.healthy === true;
  } catch {
    return false;
  }
};

const describeRegistryBroker = baseUrl ? describe : describe.skip;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

type RegistryBrokerErrorShape = {
  status?: number;
  body?: {
    error?: string;
    details?: string;
  };
};

const isTransientAgentConnectError = (error: RegistryBrokerErrorShape): boolean => {
  const status = error.status;
  if (status !== 500 && status !== 502 && status !== 503 && status !== 504) {
    return false;
  }
  const err = typeof error.body?.error === 'string' ? error.body.error : '';
  const details = typeof error.body?.details === 'string' ? error.body.details : '';
  return (
    err.toLowerCase().includes('failed to connect to agent') ||
    details.toLowerCase().includes('unavailable') ||
    details.toLowerCase().includes('no connection established')
  );
};

describeRegistryBroker('RegistryBroker ERC-8004 integration', () => {
  const sdk = new SDK({
    chainId: 11155111,
    rpcUrl: process.env.RPC_URL?.trim() || 'http://127.0.0.1:8545',
  });

  sdk.registerSearchAdapter(
    new HashgraphRegistryBrokerSearchAdapter({
      baseUrl,
      apiKey: resolveApiKey(),
    }),
  );
  sdk.registerChatAdapter(
    new HashgraphRegistryBrokerChatAdapter({
      baseUrl,
      apiKey: resolveApiKey(),
    }),
  );

  let vectorSearchHealthy = false;

  beforeAll(async () => {
    vectorSearchHealthy = await fetchVectorSearchHealthy();
  });

  it('searches for ERC-8004 agents', async () => {
    const result = await sdk.search({
      query: defaultQuery,
      registry: defaultRegistry,
      adapters: defaultAdapters,
      limit: 8,
      sortBy: 'most-recent',
    });

    expect(Array.isArray(result.hits)).toBe(true);
    expect(typeof result.total).toBe('number');

    if (result.hits.length === 0) {
      return;
    }

    const selected = pickAgentWithId(result.hits);
    expect(selected).not.toBeNull();
  });

  const itChat = targetAgentId.length > 0 || targetAgentUrl.length > 0 ? it : it.skip;
  itChat('creates a session and exchanges a message with an ERC-8004 agent', async () => {
    const agent = targetAgentUrl
      ? await sdk
          .createAgent('Remote Agent', 'Remote Agent handle')
          .setA2A(targetAgentUrl, '0.30', false)
      : await sdk.loadAgent(targetAgentId);

    const runOnce = async () =>
      agent.message('Provide a concise, one sentence summary of your available capabilities.', {
        historyTtlSeconds: 180,
        encryption: { preference: 'disabled' },
      });

    try {
      const result = await runOnce();
      expect(result.sessionId.length).toBeGreaterThan(0);
      const reply = extractReplyText(result.response);
      expect(reply.length).toBeGreaterThan(0);
    } catch (error) {
      if (isTransientAgentConnectError(error)) {
        await delay(750);
        try {
          const result = await runOnce();
          expect(result.sessionId.length).toBeGreaterThan(0);
          const reply = extractReplyText(result.response);
          expect(reply.length).toBeGreaterThan(0);
        } catch (retryError) {
          if (isTransientAgentConnectError(retryError)) {
            return;
          }
          throw retryError;
        }
      }
      throw error;
    }
  });

  it('performs a vector search', async () => {
    if (!vectorSearchHealthy) {
      return;
    }
    const query = defaultQuery.trim().length > 0 ? defaultQuery : 'claude';
    const response: AgentVectorSearchResponse = await sdk.vectorSearch({
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
      const idPresent = response.hits.some(
        (hit) => typeof hit.agent?.id === 'string' && hit.agent.id.length > 0,
      );
      expect(idPresent).toBe(true);
    }
  });
});
