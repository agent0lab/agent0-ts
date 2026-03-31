import type { X402RequiredResponse } from '../core/x402-types.js';

export type MCPProtocolVersion = '2025-06-18' | string;

export interface MCPClientInfo {
  name: string;
  title?: string;
  version: string;
}

export interface MCPInitializeResult {
  protocolVersion: MCPProtocolVersion;
  capabilities?: Record<string, unknown>;
  serverInfo?: {
    name?: string;
    title?: string;
    version?: string;
  };
  instructions?: string;
}

export interface MCPTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MCPPrompt {
  name: string;
  title?: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
  [key: string]: unknown;
}

export interface MCPPromptMessage {
  role: 'user' | 'assistant';
  content: Record<string, unknown>;
}

export interface MCPPromptGetResult {
  description?: string;
  messages: MCPPromptMessage[];
  [key: string]: unknown;
}

export interface MCPResource {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
  annotations?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MCPResourceTemplate {
  uriTemplate: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  annotations?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MCPResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
  [key: string]: unknown;
}

export interface MCPAuthOptions {
  /** Bearer token (without prefix or full "Bearer ..."). */
  credential?: string;
  /** Additional headers merged into MCP requests. */
  headers?: Record<string, string>;
}

export interface MCPClientOptions extends MCPAuthOptions {
  protocolVersion?: MCPProtocolVersion;
  sessionId?: string;
  clientInfo?: MCPClientInfo;
}

export type MCPMaybePaid<T> = T | X402RequiredResponse<T>;

export interface MCPHandle {
  readonly tools: Record<string, (args?: Record<string, unknown>, options?: MCPAuthOptions) => Promise<MCPMaybePaid<unknown>>>;
  readonly prompts: {
    list(options?: MCPAuthOptions): Promise<MCPMaybePaid<MCPPrompt[]>>;
    get(name: string, args?: Record<string, unknown>, options?: MCPAuthOptions): Promise<MCPMaybePaid<MCPPromptGetResult>>;
    [key: string]: unknown;
  };
  readonly resources: {
    list(options?: MCPAuthOptions): Promise<MCPMaybePaid<MCPResource[]>>;
    read(uri: string, options?: MCPAuthOptions): Promise<MCPMaybePaid<{ contents: MCPResourceContent[] }>>;
    templates: {
      list(options?: MCPAuthOptions): Promise<MCPMaybePaid<MCPResourceTemplate[]>>;
    };
  };
  listTools(options?: MCPAuthOptions): Promise<MCPMaybePaid<MCPTool[]>>;
  call(name: string, args?: Record<string, unknown>, options?: MCPAuthOptions): Promise<MCPMaybePaid<unknown>>;
  getSessionId(): string | undefined;
  setSessionId(sessionId?: string): void;
  resetSession(): void;
  initialize(options?: MCPAuthOptions): Promise<MCPMaybePaid<MCPInitializeResult>>;
}

