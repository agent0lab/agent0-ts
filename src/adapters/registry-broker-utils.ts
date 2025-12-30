import type {
  ChatConversationHandle,
  CreateSessionRequestPayload,
  CreateSessionResponse,
  SearchParams,
  StartChatOptions,
  SendMessageRequestPayload,
  SendMessageResponse,
  VectorSearchRequest,
  VectorSearchResponse,
} from '@hol-org/rb-client';
import type {
  AgentChatConversationHandle,
  AgentChatSendMessageResponse,
  AgentSearchResult,
  AgentVectorSearchResponse,
} from '../core/adapters.js';
import { RegistryBrokerClient } from '@hol-org/rb-client';

export interface RegistryBrokerClientChatApi {
  readonly chat: {
    start: (options: StartChatOptions) => Promise<ChatConversationHandle>;
    createSession: (
      payload: CreateSessionRequestPayload,
    ) => Promise<CreateSessionResponse>;
    sendMessage: (
      payload: SendMessageRequestPayload,
    ) => Promise<SendMessageResponse>;
  };
  vectorSearch: (request: VectorSearchRequest) => Promise<VectorSearchResponse>;
}

export const isRegistryBrokerClientChatApi = (
  client: RegistryBrokerClient,
): client is RegistryBrokerClient & RegistryBrokerClientChatApi =>
  'vectorSearch' in client && 'chat' in client;

const extractNativeIdFromUaid = (uaid: string): string | null => {
  const match = /(?:^|;)nativeId=([^;]+)/.exec(uaid);
  const candidate = match?.[1]?.trim() ?? '';
  return candidate.length > 0 ? candidate : null;
};

export const mapSearchResult = (result: {
  hits?: Array<{
    id: string;
    uaid?: string;
    originalId?: string;
    registry?: string;
    name?: string;
    description?: string | null;
  }>;
  total?: number;
}): AgentSearchResult => ({
  hits: (result.hits ?? []).map((hit) => ({
    id:
      typeof hit.originalId === 'string'
        ? hit.originalId
        : (() => {
          const uaid =
            typeof hit.uaid === 'string' && hit.uaid.trim().length > 0
              ? hit.uaid.trim()
              : null;
          const nativeId = uaid ? extractNativeIdFromUaid(uaid) : null;
          return nativeId ?? hit.id;
        })(),
    registry: hit.registry,
    name: hit.name,
    description: hit.description ?? undefined,
  })),
  total: result.total,
});

export const mapVectorSearchResponse = (
  response: VectorSearchResponse,
): AgentVectorSearchResponse => ({
  hits: (response.hits ?? []).map((hit) => ({
    agent: hit.agent
      ? {
        id:
          typeof hit.agent.originalId === 'string'
            ? hit.agent.originalId
            : (() => {
                const uaid =
                  typeof hit.agent.uaid === 'string' &&
                  hit.agent.uaid.trim().length > 0
                    ? hit.agent.uaid.trim()
                    : null;
                const nativeId = uaid ? extractNativeIdFromUaid(uaid) : null;
                return nativeId ?? hit.agent.id;
              })(),
          registry: hit.agent.registry,
          name: hit.agent.name,
          description: hit.agent.description,
        }
      : undefined,
    score: hit.score ?? undefined,
    highlights: hit.highlights ?? undefined,
  })),
  total: response.total,
  took: response.took,
});

export const mapSendMessageResponse = (
  response: SendMessageResponse,
): AgentChatSendMessageResponse => ({
  message: response.message,
  content: response.content,
  historyLength: Array.isArray(response.history) ? response.history.length : 0,
});

export const mapConversationHandle = (
  handle: ChatConversationHandle,
): AgentChatConversationHandle => ({
  sessionId: handle.sessionId,
  mode: handle.mode === 'encrypted' ? 'encrypted' : 'plaintext',
  send: async (options) => {
    const plaintext = options.plaintext ?? options.message;
    if (!plaintext) {
      throw new Error('plaintext is required to send an encrypted message');
    }
    const response = await handle.send({
      message: options.message,
      plaintext,
      auth: options.auth,
      streaming: options.streaming,
    });
    return mapSendMessageResponse(response);
  },
});

export const resolveChatTarget = (options: {
  uaid?: string;
  agentUrl?: string;
}): { uaid: string } | { agentUrl: string } => {
  const trimmedUaid = options.uaid?.trim();
  if (trimmedUaid) {
    return { uaid: trimmedUaid };
  }
  const trimmedUrl = options.agentUrl?.trim();
  if (trimmedUrl) {
    return { agentUrl: trimmedUrl };
  }
  throw new Error('Either uaid or agentUrl is required for chat');
};
