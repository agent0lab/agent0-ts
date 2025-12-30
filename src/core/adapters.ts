export type AgentAdapterId = string;

export interface AgentSearchHit {
  uaid?: string;
  id?: string;
  registry?: string;
  name?: string;
  description?: string;
}

export interface AgentSearchOptions {
  query?: string;
  limit?: number;
  sortBy?: string;
  registry?: string;
  registries?: string[];
  adapters?: string[];
  minTrust?: number;
  protocols?: string[];
}

export interface AgentSearchResult {
  hits: AgentSearchHit[];
  total?: number;
}

export interface AgentVectorSearchFilter {
  registry?: string;
  registries?: string[];
  protocols?: string[];
  adapters?: string[];
}

export interface AgentVectorSearchRequest {
  query: string;
  limit?: number;
  offset?: number;
  filter?: AgentVectorSearchFilter;
}

export interface AgentVectorSearchHit {
  agent?: AgentSearchHit;
  score?: number;
  highlights?: Record<string, string[]>;
}

export interface AgentVectorSearchResponse {
  hits?: AgentVectorSearchHit[];
  total?: number;
  took?: number;
}

export interface AgentChatAuthConfig {
  token?: string;
  username?: string;
  password?: string;
  headerName?: string;
  headerValue?: string;
  headers?: Record<string, string>;
}

export interface AgentChatCreateSessionRequest {
  uaid?: string;
  agentUrl?: string;
  historyTtlSeconds?: number;
  auth?: AgentChatAuthConfig;
  senderUaid?: string;
}

export interface AgentChatCreateSessionResponse {
  sessionId?: string;
}

export interface AgentChatSendMessageRequest {
  sessionId: string;
  message: string;
  uaid?: string;
  auth?: AgentChatAuthConfig;
  streaming?: boolean;
}

export interface AgentChatSendMessageResponse {
  message?: string;
  content?: string;
  historyLength?: number;
}

export interface AgentChatEncryptionOptions {
  preference?: 'preferred' | 'required' | 'disabled';
}

export interface AgentChatStartRequest extends AgentChatCreateSessionRequest {
  encryption?: AgentChatEncryptionOptions;
}

export interface AgentChatConversationHandle {
  sessionId: string;
  mode: 'encrypted' | 'plaintext';
  send: (options: {
    message?: string;
    plaintext?: string;
    auth?: AgentChatAuthConfig;
  }) => Promise<AgentChatSendMessageResponse>;
}

export interface AgentChatRequest {
  uaid: string;
  message: string;
  historyTtlSeconds?: number;
  auth?: AgentChatAuthConfig;
  senderUaid?: string;
  encryption?: AgentChatEncryptionOptions;
}

export interface AgentChatResult {
  sessionId: string;
  response: AgentChatSendMessageResponse;
  mode: 'encrypted' | 'plaintext';
}

export interface AgentSearchAdapter {
  readonly id: AgentAdapterId;
  search: (options: AgentSearchOptions) => Promise<AgentSearchResult>;
  vectorSearch?: (request: AgentVectorSearchRequest) => Promise<AgentVectorSearchResponse>;
}

export interface AgentChatAdapter {
  readonly id: AgentAdapterId;
  createSession: (
    request: AgentChatCreateSessionRequest,
  ) => Promise<AgentChatCreateSessionResponse>;
  sendMessage: (
    request: AgentChatSendMessageRequest,
  ) => Promise<AgentChatSendMessageResponse>;
  startChat?: (request: AgentChatStartRequest) => Promise<AgentChatConversationHandle>;
}

export interface AgentAdapterHost {
  registerSearchAdapter: (adapter: AgentSearchAdapter) => void;
  registerChatAdapter: (adapter: AgentChatAdapter) => void;
}

export class AgentAdapterRegistry implements AgentAdapterHost {
  private readonly searchAdapters = new Map<AgentAdapterId, AgentSearchAdapter>();
  private readonly chatAdapters = new Map<AgentAdapterId, AgentChatAdapter>();

  registerSearchAdapter(adapter: AgentSearchAdapter): void {
    this.searchAdapters.set(adapter.id, adapter);
  }

  registerChatAdapter(adapter: AgentChatAdapter): void {
    this.chatAdapters.set(adapter.id, adapter);
  }

  getSearchAdapter(id: AgentAdapterId): AgentSearchAdapter | undefined {
    return this.searchAdapters.get(id);
  }

  getChatAdapter(id: AgentAdapterId): AgentChatAdapter | undefined {
    return this.chatAdapters.get(id);
  }

  listSearchAdapters(): AgentAdapterId[] {
    return [...this.searchAdapters.keys()];
  }

  listChatAdapters(): AgentAdapterId[] {
    return [...this.chatAdapters.keys()];
  }
}
