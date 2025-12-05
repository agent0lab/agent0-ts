import {
  RegistryBrokerClient,
  RegistryBrokerError,
  RegistryBrokerParseError,
} from '@hol-org/rb-client';
import type {
  AgentAuthConfig,
  AgentSearchHit,
  CreateSessionResponse,
  ConversationEncryptionOptions,
  RegistryBrokerClientOptions,
  SearchParams,
  SearchResult,
  SendMessageResponse,
  VectorSearchRequest,
  VectorSearchResponse,
} from '@hol-org/rb-client';

export const ERC8004_DEFAULT_ADAPTER = 'erc8004-adapter';
export const ERC8004_DEFAULT_REGISTRY = 'erc-8004';

export interface Erc8004SearchOptions {
  query?: string;
  limit?: number;
  sortBy?: string;
  registry?: string;
  adapters?: string[];
  minTrust?: number;
  protocols?: string[];
}

export interface Erc8004SessionOptions {
  historyTtlSeconds?: number;
  auth?: AgentAuthConfig;
  senderUaid?: string;
}

export interface Erc8004MessageOptions {
  sessionId: string;
  message: string;
  auth?: AgentAuthConfig;
  uaid?: string;
  streaming?: boolean;
}

export interface Erc8004ChatOptions extends Erc8004SessionOptions {
  uaid: string;
  message: string;
  encryption?: ConversationEncryptionOptions;
}

export interface Erc8004ChatResult {
  sessionId: string;
  response: SendMessageResponse;
  mode: 'encrypted' | 'plaintext';
}

export class RegistryBroker {
  private readonly client: RegistryBrokerClient;

  constructor(options: RegistryBrokerClientOptions = {}) {
    this.client = new RegistryBrokerClient({
      ...options,
    });
  }

  async searchErc8004Agents(options: Erc8004SearchOptions = {}): Promise<SearchResult> {
    const registry = options.registry ?? ERC8004_DEFAULT_REGISTRY;
    const searchParams: SearchParams = {
      q: options.query,
      limit: options.limit ?? 25,
      sortBy: options.sortBy ?? 'most-recent',
      registry,
      minTrust: options.minTrust,
      protocols: options.protocols,
    };
    if (options.adapters) {
      searchParams.adapters = options.adapters;
    } else if (registry === ERC8004_DEFAULT_REGISTRY) {
      searchParams.adapters = [ERC8004_DEFAULT_ADAPTER];
    }
    return this.client.search(searchParams);
  }

  async startErc8004Session(
    uaid: string,
    options: Erc8004SessionOptions = {}
  ): Promise<CreateSessionResponse> {
    const trimmed = uaid.trim();
    if (trimmed.length === 0) {
      throw new Error('uaid is required to start an ERC-8004 session');
    }
    return this.client.chat.createSession({
      uaid: trimmed,
      historyTtlSeconds: options.historyTtlSeconds,
      auth: options.auth,
      senderUaid: options.senderUaid,
      encryptionRequested: false,
    });
  }

  async startErc8004SessionByUrl(
    agentUrl: string,
    options: Erc8004SessionOptions = {}
  ): Promise<CreateSessionResponse> {
    const trimmed = agentUrl.trim();
    if (trimmed.length === 0) {
      throw new Error('agentUrl is required to start an ERC-8004 session');
    }
    return this.client.chat.createSession({
      agentUrl: trimmed,
      historyTtlSeconds: options.historyTtlSeconds,
      auth: options.auth,
      senderUaid: options.senderUaid,
      encryptionRequested: false,
    });
  }

  async sendErc8004Message(options: Erc8004MessageOptions): Promise<SendMessageResponse> {
    const sessionId = options.sessionId.trim();
    if (sessionId.length === 0) {
      throw new Error('sessionId is required for ERC-8004 messages');
    }
    const message = options.message.trim();
    if (message.length === 0) {
      throw new Error('message is required for ERC-8004 messages');
    }
    return this.client.chat.sendMessage({
      sessionId,
      message,
      streaming: options.streaming,
      uaid: options.uaid,
      auth: options.auth,
    });
  }

  async vectorSearch(request: VectorSearchRequest): Promise<VectorSearchResponse> {
    const result = await this.client.vectorSearch(request);
    const hits = result.hits ?? [];
    return {
      ...result,
      hits: hits.map((hit) => ({
        ...hit,
        uaid:
          (hit as { uaid?: string }).uaid ??
          hit.agent?.uaid ??
          hit.agent?.id ??
          null,
      })),
    };
  }

  async vectorSearchErc8004(
    query: string,
    options?: {
      limit?: number;
      offset?: number;
      adapters?: string[];
      protocols?: string[];
      registry?: string;
    }
  ): Promise<VectorSearchResponse> {
    const filter: VectorSearchRequest['filter'] = {
      registry: options?.registry ?? ERC8004_DEFAULT_REGISTRY,
      protocols: options?.protocols ?? ['a2a'],
    };
    const request: VectorSearchRequest = {
      query,
      limit: options?.limit,
      offset: options?.offset,
      filter,
    };

    try {
      return await this.vectorSearch(request);
    } catch {
      const fallback = await this.searchErc8004Agents(
        {
          query,
          registry: request.filter?.registry,
          protocols: request.filter?.protocols,
          limit: request.limit,
        }
      );
      const fallbackHits = fallback.hits ?? [];
      return {
        hits: fallbackHits.map((hit) => ({
          agent: hit as AgentSearchHit,
          score: 0,
          uaid: (hit as { uaid?: string }).uaid ?? hit.id ?? null,
          highlights: {},
        })),
        total: fallback.total ?? fallbackHits.length,
        took: 0,
      };
    }
  }

  async chat(options: Erc8004ChatOptions): Promise<Erc8004ChatResult> {
    const uaid = options.uaid.trim();
    if (!uaid) {
      throw new Error('uaid is required for ERC-8004 chat');
    }
    const preference = options.encryption?.preference ?? 'preferred';
    if (preference !== 'disabled') {
      try {
        const handle = await this.client.chat.start({
          uaid,
          historyTtlSeconds: options.historyTtlSeconds,
          auth: options.auth,
          senderUaid: options.senderUaid,
          encryption: options.encryption,
        });
        const response = await handle.send({
          message: options.message,
          plaintext: options.message,
          auth: options.auth,
        });
        return { sessionId: handle.sessionId, response, mode: handle.mode };
      } catch (error) {
        if (preference === 'required') {
          throw error;
        }
        // Fall back to plaintext session below
      }
    }

    const session = await this.startErc8004Session(uaid, {
      historyTtlSeconds: options.historyTtlSeconds,
      auth: options.auth,
      senderUaid: options.senderUaid,
    });
    const sessionId = session.sessionId ?? '';
    const response = await this.sendErc8004Message({
      sessionId,
      uaid,
      message: options.message,
      auth: options.auth,
    });
    return { sessionId, response, mode: 'plaintext' };
  }

  get getClient(): RegistryBrokerClient {
    return this.client;
  }
}

export { RegistryBrokerClient, RegistryBrokerError, RegistryBrokerParseError };

export type {
  AgentAuthConfig,
  AgentSearchHit,
  CreateSessionResponse,
  RegistryBrokerClientOptions,
  SearchResult,
  SendMessageResponse,
  VectorSearchRequest,
  VectorSearchResponse,
};
