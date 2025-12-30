import {
  RegistryBrokerClient,
  RegistryBrokerError,
  RegistryBrokerParseError,
} from '@hol-org/rb-client';
import type {
  CreateSessionResponse,
  RegistryBrokerClientOptions,
  SearchParams,
  SearchResult,
  SendMessageResponse,
  VectorSearchRequest,
  VectorSearchResponse,
} from '@hol-org/rb-client';
import type {
  AgentAdapterHost,
  AgentChatAdapter,
  AgentChatConversationHandle,
  AgentChatCreateSessionRequest,
  AgentChatCreateSessionResponse,
  AgentChatSendMessageRequest,
  AgentChatSendMessageResponse,
  AgentChatStartRequest,
  AgentSearchAdapter,
  AgentSearchOptions,
  AgentSearchResult,
  AgentVectorSearchRequest,
  AgentVectorSearchResponse,
} from '../core/adapters.js';
import {
  isRegistryBrokerClientChatApi,
  mapConversationHandle,
  mapCreateSessionResponse,
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

  async search(options: AgentSearchOptions): Promise<AgentSearchResult> {
    const registry =
      options.registry ?? options.registries?.[0] ?? ERC8004_DEFAULT_REGISTRY;
    const searchParams: SearchParams = {
      q: options.query,
      limit: options.limit ?? 25,
      sortBy: options.sortBy ?? 'most-recent',
      registry,
      registries: options.registries,
      minTrust: options.minTrust,
      protocols: options.protocols,
    };
    if (options.adapters) {
      searchParams.adapters = options.adapters;
    } else if (registry === ERC8004_DEFAULT_REGISTRY) {
      searchParams.adapters = [ERC8004_DEFAULT_ADAPTER];
    }
    const result = await this.client.search(searchParams);
    return mapSearchResult(result);
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

  constructor(options: RegistryBrokerClientOptions = {}) {
    const client = new RegistryBrokerClient({ ...options });
    if (!isRegistryBrokerClientChatApi(client)) {
      throw new Error(
        'Installed @hol-org/rb-client version does not expose the expected Registry Broker APIs. Please upgrade @hol-org/rb-client to the latest version.',
      );
    }
    this.client = client;
  }

  async createSession(
    request: AgentChatCreateSessionRequest,
  ): Promise<AgentChatCreateSessionResponse> {
    const target = resolveChatTarget(request.uaid, request.agentUrl);
    const response = await this.client.chat.createSession({
      ...target,
      historyTtlSeconds: request.historyTtlSeconds,
      auth: request.auth,
      senderUaid: request.senderUaid,
      encryptionRequested: false,
    });
    return mapCreateSessionResponse(response);
  }

  async sendMessage(
    request: AgentChatSendMessageRequest,
  ): Promise<AgentChatSendMessageResponse> {
    const response = await this.client.chat.sendMessage({
      sessionId: request.sessionId,
      message: request.message,
      streaming: request.streaming,
      auth: request.auth,
    });
    return mapSendMessageResponse(response);
  }

  async startChat(
    request: AgentChatStartRequest,
  ): Promise<AgentChatConversationHandle> {
    const target = resolveChatTarget(request.uaid, request.agentUrl);
    const handle = await this.client.chat.start({
      ...target,
      historyTtlSeconds: request.historyTtlSeconds,
      auth: request.auth,
      senderUaid: request.senderUaid,
      encryption: request.encryption,
    });
    return mapConversationHandle(handle);
  }
}

export const registerHashgraphRegistryBrokerAdapters = (
  host: AgentAdapterHost,
  options: RegistryBrokerClientOptions = {},
): void => {
  host.registerSearchAdapter(new HashgraphRegistryBrokerSearchAdapter(options));
  host.registerChatAdapter(new HashgraphRegistryBrokerChatAdapter(options));
};

export { RegistryBrokerClient, RegistryBrokerError, RegistryBrokerParseError };

export type {
  CreateSessionResponse,
  RegistryBrokerClientOptions,
  SendMessageResponse,
  SearchParams,
  SearchResult,
  VectorSearchRequest,
  VectorSearchResponse,
};
