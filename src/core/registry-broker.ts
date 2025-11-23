import {
  RegistryBrokerClient,
  RegistryBrokerError,
  RegistryBrokerParseError,
} from '@hashgraphonline/standards-sdk';
import type {
  AgentAuthConfig,
  AgentSearchHit,
  CreateSessionResponse,
  ConversationEncryptionOptions,
  RegistryBrokerClientOptions,
  SearchParams,
  SearchResult,
  SendMessageResponse,
} from '@hashgraphonline/standards-sdk';

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
    const searchParams: SearchParams = {
      q: options.query,
      limit: options.limit ?? 25,
      sortBy: options.sortBy ?? 'most-recent',
      registry: options.registry ?? ERC8004_DEFAULT_REGISTRY,
      adapters: options.adapters ?? [ERC8004_DEFAULT_ADAPTER],
      minTrust: options.minTrust,
      protocols: options.protocols,
    };
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
    const response = await this.sendErc8004Message({
      sessionId: session.sessionId,
      uaid,
      message: options.message,
      auth: options.auth,
    });
    return { sessionId: session.sessionId, response, mode: 'plaintext' };
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
};
