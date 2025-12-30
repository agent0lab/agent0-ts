import { RegistryBrokerClient } from '@hol-org/rb-client';
import type {
  CreateSessionResponse,
  JsonValue,
  RegistryBrokerClientOptions,
  SearchParams,
} from '@hol-org/rb-client';
import type {
  AgentAdapterHost,
  AgentChatAdapter,
  AgentChatConversationHandle,
  AgentChatOpenConversationRequest,
  AgentChatSendMessageResponse,
  AgentSearchAdapter,
  AgentSearchOptions,
  AgentSearchResult,
  AgentVectorSearchRequest,
  AgentVectorSearchResponse,
} from '../core/adapters.js';
import {
  isRegistryBrokerClientChatApi,
  mapConversationHandle,
  mapSearchResult,
  mapSendMessageResponse,
  mapVectorSearchResponse,
  resolveChatTarget,
  type RegistryBrokerClientChatApi,
} from './registry-broker-utils.js';

export const ERC8004_DEFAULT_ADAPTER = 'erc8004-adapter';
export const ERC8004_DEFAULT_REGISTRY = 'erc-8004';

export const HASHGRAPH_REGISTRY_BROKER_SEARCH_ADAPTER_ID =
  'hashgraph-registry-broker/search';
export const HASHGRAPH_REGISTRY_BROKER_CHAT_ADAPTER_ID =
  'hashgraph-registry-broker/chat';

type BrokerSearchHit = {
  id: string;
  uaid?: string;
  originalId?: string;
  registry?: string;
  name?: string;
  description?: string | null;
};

type BrokerSearchResult = {
  hits: BrokerSearchHit[];
  total?: number;
};

type HttpErrorLike = {
  status?: number;
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isRetryableBrokerError = (error: HttpErrorLike): boolean =>
  error.status === 502 || error.status === 503 || error.status === 504;

const withRetry = async <T>(fn: () => Promise<T>): Promise<T> => {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryableBrokerError(error as HttpErrorLike) || attempt === maxAttempts) {
        throw error;
      }
      await delay(450 * attempt);
    }
  }

  throw new Error('Unreachable retry state');
};

const isJsonRecord = (value: JsonValue): value is Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeString = (value: JsonValue): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const appendList = (
  query: URLSearchParams,
  key: string,
  values: SearchParams[keyof SearchParams],
): void => {
  if (!Array.isArray(values)) {
    return;
  }
  values.forEach((value) => {
    const trimmed = normalizeString(value);
    if (trimmed) {
      query.append(key, trimmed);
    }
  });
};

const buildSearchQuery = (params: SearchParams): string => {
  const query = new URLSearchParams();

  if (typeof params.q === 'string') {
    const trimmed = params.q.trim();
    if (trimmed.length > 0) {
      query.set('q', trimmed);
    }
  }
  if (typeof params.page === 'number') {
    query.set('page', params.page.toString());
  }
  if (typeof params.limit === 'number') {
    query.set('limit', params.limit.toString());
  }
  if (typeof params.sortBy === 'string') {
    const trimmed = params.sortBy.trim();
    if (trimmed.length > 0) {
      query.set('sortBy', trimmed);
    }
  }
  if (typeof params.registry === 'string') {
    const trimmed = params.registry.trim();
    if (trimmed.length > 0) {
      query.set('registry', trimmed);
    }
  }
  appendList(query, 'registries', params.registries);
  if (typeof params.minTrust === 'number') {
    query.set('minTrust', params.minTrust.toString());
  }
  appendList(query, 'capabilities', params.capabilities);
  appendList(query, 'protocols', params.protocols);
  appendList(query, 'adapters', params.adapters);
  if (params.metadata) {
    Object.entries(params.metadata).forEach(([key, values]) => {
      if (!key || !Array.isArray(values) || values.length === 0) {
        return;
      }
      const trimmedKey = key.trim();
      if (trimmedKey.length === 0) {
        return;
      }
      values.forEach((value) => {
        if (value === undefined || value === null) {
          return;
        }
        query.append(`metadata.${trimmedKey}`, String(value));
      });
    });
  }
  if (typeof params.type === 'string') {
    const trimmed = params.type.trim();
    if (trimmed.length > 0 && trimmed.toLowerCase() !== 'all') {
      query.set('type', trimmed);
    }
  }
  if (params.verified === true) {
    query.set('verified', 'true');
  }
  if (params.online === true) {
    query.set('online', 'true');
  }

  return query.size > 0 ? `?${query.toString()}` : '';
};

const parseBrokerSearchResult = (value: JsonValue): BrokerSearchResult => {
  if (!isJsonRecord(value)) {
    throw new Error('Registry Broker search returned a non-object payload');
  }
  const hitsRaw = value.hits;
  const hitsValue =
    Array.isArray(hitsRaw) && hitsRaw.every((hit) => isJsonRecord(hit))
      ? hitsRaw
      : [];

  const hits: BrokerSearchHit[] = [];
  hitsValue.forEach((hit) => {
    const id = typeof hit.id === 'string' ? hit.id : '';
    if (!id) {
      return;
    }
    hits.push({
      id,
      uaid: typeof hit.uaid === 'string' ? hit.uaid : undefined,
      originalId: typeof hit.originalId === 'string' ? hit.originalId : undefined,
      registry: typeof hit.registry === 'string' ? hit.registry : undefined,
      name: typeof hit.name === 'string' ? hit.name : undefined,
      description: typeof hit.description === 'string' ? hit.description : null,
    });
  });

  const total = typeof value.total === 'number' ? value.total : undefined;

  return { hits, total };
};

export class HashgraphRegistryBrokerSearchAdapter implements AgentSearchAdapter {
  readonly id = HASHGRAPH_REGISTRY_BROKER_SEARCH_ADAPTER_ID;
  private readonly client: RegistryBrokerClient & RegistryBrokerClientChatApi;

  constructor(options: RegistryBrokerClientOptions = {}) {
    const client = new RegistryBrokerClient({ ...options });
    if (!isRegistryBrokerClientChatApi(client)) {
      throw new Error(
        'Installed @hol-org/rb-client version does not expose the expected Registry Broker APIs. Please upgrade @hol-org/rb-client to the latest version.',
      );
    }
    this.client = client;
  }

  private async searchBroker(params: SearchParams): Promise<BrokerSearchResult> {
    const suffix = buildSearchQuery(params);
    const raw = await withRetry(() =>
      this.client.requestJson(`/search${suffix}`, {
        method: 'GET',
      }),
    );
    return parseBrokerSearchResult(raw);
  }

  async search(options: AgentSearchOptions): Promise<AgentSearchResult> {
    const registry =
      options.registry ?? options.registries?.[0] ?? ERC8004_DEFAULT_REGISTRY;
    const searchParamsBase: SearchParams = {
      q: options.query,
      limit: options.limit ?? 25,
      sortBy: options.sortBy ?? 'most-recent',
      registry,
      registries: options.registries,
      minTrust: options.minTrust,
      protocols: options.protocols,
    };

    if (options.adapters) {
      const result = await this.searchBroker({
        ...searchParamsBase,
        adapters: options.adapters,
      });
      return mapSearchResult(result);
    }

    if (registry !== ERC8004_DEFAULT_REGISTRY) {
      const result = await this.searchBroker(searchParamsBase);
      return mapSearchResult(result);
    }

    const resultWithDefaultAdapter = await this.searchBroker({
      ...searchParamsBase,
      adapters: [ERC8004_DEFAULT_ADAPTER],
    });
    if (resultWithDefaultAdapter.hits?.length) {
      return mapSearchResult(resultWithDefaultAdapter);
    }

    const resultWithoutAdapter = await this.searchBroker(searchParamsBase);
    return mapSearchResult(resultWithoutAdapter);
  }

  async vectorSearch(
    request: AgentVectorSearchRequest,
  ): Promise<AgentVectorSearchResponse> {
    const result = await this.client.vectorSearch({
      query: request.query,
      limit: request.limit,
      offset: request.offset,
      filter: request.filter
        ? {
            registry: request.filter.registry,
            protocols: request.filter.protocols,
            adapter: request.filter.adapters,
          }
        : undefined,
    });
    return mapVectorSearchResponse(result);
  }
}

export class HashgraphRegistryBrokerChatAdapter implements AgentChatAdapter {
  readonly id = HASHGRAPH_REGISTRY_BROKER_CHAT_ADAPTER_ID;
  private readonly client: RegistryBrokerClient & RegistryBrokerClientChatApi;
  private readonly uaidByAgentId = new Map<string, string>();

  constructor(options: RegistryBrokerClientOptions = {}) {
    const client = new RegistryBrokerClient({ ...options });
    if (!isRegistryBrokerClientChatApi(client)) {
      throw new Error(
        'Installed @hol-org/rb-client version does not expose the expected Registry Broker APIs. Please upgrade @hol-org/rb-client to the latest version.',
      );
    }
    this.client = client;
  }

  private async resolveChatTargetFromAgent(request: {
    agent: AgentChatOpenConversationRequest['agent'];
    auth?: AgentChatOpenConversationRequest['auth'];
    senderUaid?: AgentChatOpenConversationRequest['senderUaid'];
    historyTtlSeconds?: AgentChatOpenConversationRequest['historyTtlSeconds'];
  }): Promise<{
    uaid?: string;
    agentUrl?: string;
  }> {
    const agentId = request.agent.agentId?.trim() ?? '';
    if (agentId) {
      const cached = this.uaidByAgentId.get(agentId);
      if (cached) {
        return { uaid: cached };
      }

      const search = async (adapters?: string[]): Promise<BrokerSearchResult> => {
        const suffix = buildSearchQuery({
          registry: ERC8004_DEFAULT_REGISTRY,
          adapters,
          limit: 5,
          sortBy: 'most-recent',
          metadata: {
            nativeId: [agentId],
          },
        });
        const raw = await withRetry(() =>
          this.client.requestJson(`/search${suffix}`, {
            method: 'GET',
          }),
        );
        return parseBrokerSearchResult(raw);
      };

      const resultWithAdapter = await search([ERC8004_DEFAULT_ADAPTER]);
      const uaidFromAdapter = resultWithAdapter.hits[0]?.uaid?.trim();
      const uaidFromFallback = uaidFromAdapter
        ? undefined
        : (await search()).hits[0]?.uaid?.trim();

      const uaid = uaidFromAdapter ?? uaidFromFallback ?? '';
      if (!uaid) {
        throw new Error(`Unable to resolve broker UAID for agentId "${agentId}"`);
      }
      this.uaidByAgentId.set(agentId, uaid);
      return { uaid };
    }

    const agentUrl = request.agent.a2aEndpoint?.trim() ?? request.agent.mcpEndpoint?.trim() ?? '';
    if (agentUrl) {
      return { agentUrl };
    }

    throw new Error('Agent does not have an agentId or a chat-capable endpoint');
  }

  private createPlaintextHandle(sessionId: string): AgentChatConversationHandle {
    return {
      sessionId,
      mode: 'plaintext',
      send: async (options): Promise<AgentChatSendMessageResponse> => {
        const message = options.message?.trim() ?? '';
        if (!message) {
          throw new Error('message is required');
        }
        const response = await withRetry(() =>
          this.client.chat.sendMessage({
            sessionId,
            message,
            streaming: options.streaming,
            auth: options.auth,
          }),
        );
        return mapSendMessageResponse(response);
      },
    };
  }

  async message(
    request: AgentChatOpenConversationRequest,
  ): Promise<AgentChatConversationHandle> {
    const preference = request.encryption?.preference ?? 'preferred';
    const sessionId = request.sessionId?.trim() ?? '';
    if (sessionId) {
      if (preference === 'required') {
        throw new Error(
          'Encrypted chat cannot be resumed from an existing sessionId; start a new chat session instead.',
        );
      }
      return this.createPlaintextHandle(sessionId);
    }

    const resolved = await this.resolveChatTargetFromAgent(request);
    const target = resolveChatTarget(resolved);

    if (preference !== 'disabled') {
      try {
        const handle = await withRetry(() =>
          this.client.chat.start({
            ...target,
            historyTtlSeconds: request.historyTtlSeconds,
            auth: request.auth,
            senderUaid: request.senderUaid,
            encryption: request.encryption,
          }),
        );
        return mapConversationHandle(handle);
      } catch (error) {
        if (preference === 'required') {
          throw error;
        }
      }
    }

    const response: CreateSessionResponse = await withRetry(() =>
      this.client.chat.createSession({
        ...target,
        historyTtlSeconds: request.historyTtlSeconds,
        auth: request.auth,
        senderUaid: request.senderUaid,
        encryptionRequested: false,
      }),
    );
    const createdSessionId = response.sessionId?.trim() ?? '';
    if (!createdSessionId) {
      throw new Error('Registry Broker createSession did not return a sessionId');
    }
    return this.createPlaintextHandle(createdSessionId);
  }
}

export const registerHashgraphRegistryBrokerAdapters = (
  host: AgentAdapterHost,
  options: RegistryBrokerClientOptions = {},
): void => {
  host.registerSearchAdapter(new HashgraphRegistryBrokerSearchAdapter(options));
  host.registerChatAdapter(new HashgraphRegistryBrokerChatAdapter(options));
};
