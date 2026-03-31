import type { X402RequestDeps } from './x402-request.js';
import { requestWithX402 } from './x402-request.js';
import type { X402RequiredResponse } from './x402-types.js';
import type {
  MCPAuthOptions,
  MCPClientOptions,
  MCPHandle,
  MCPInitializeResult,
  MCPMaybePaid,
  MCPPrompt,
  MCPPromptGetResult,
  MCPResource,
  MCPResourceTemplate,
  MCPTool,
} from '../models/mcp.js';

const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const SESSION_HEADER = 'Mcp-Session-Id';

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
};

function isIdentifierSafe(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

function normalizeBearer(credential?: string): string | undefined {
  if (!credential) return undefined;
  const trimmed = credential.trim();
  if (!trimmed) return undefined;
  if (/^Bearer\s+/i.test(trimmed)) return trimmed;
  return `Bearer ${trimmed}`;
}

function parseSseJson(text: string): Record<string, unknown> | null {
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      return JSON.parse(payload) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return null;
}

function extractJsonRpcBody(text: string, contentType: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('MCP server returned empty response');
  if (contentType.includes('text/event-stream')) {
    const parsed = parseSseJson(trimmed);
    if (!parsed) throw new Error('MCP server returned invalid SSE JSON-RPC response');
    return parsed;
  }
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const parsed = parseSseJson(trimmed);
    if (parsed) return parsed;
    throw new Error('MCP server returned non-JSON response');
  }
}

function parseJsonRpcResult<T>(data: Record<string, unknown>, method: string): T {
  if (data.error && typeof data.error === 'object') {
    const err = data.error as Record<string, unknown>;
    throw new Error(`MCP ${method} failed: ${String(err.message ?? err.code ?? 'unknown error')}`);
  }
  if (!('result' in data)) {
    throw new Error(`MCP ${method} failed: missing JSON-RPC result`);
  }
  return data.result as T;
}

function castX402<T>(result: X402RequiredResponse<unknown>): X402RequiredResponse<T> {
  return result as X402RequiredResponse<T>;
}

export class MCPClient implements MCPHandle {
  private _initialized = false;
  private _sessionId?: string;
  private _protocolVersion: string;
  /** From last `initialize` result; used to skip prompts/resources RPC when the server did not advertise them. */
  private _serverCaps: Record<string, unknown> | undefined;
  private _toolsCache: MCPTool[] | null = null;
  private _dynamicTools: Record<string, (args?: Record<string, unknown>, options?: MCPAuthOptions) => Promise<MCPMaybePaid<unknown>>> = {};

  constructor(
    private readonly _endpoint: string,
    private readonly _options: MCPClientOptions = {},
    private readonly _x402Deps?: X402RequestDeps
  ) {
    this._protocolVersion = _options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION;
    this._sessionId = _options.sessionId;
  }

  private _baseHeaders(auth?: MCPAuthOptions): Record<string, string> {
    const bearer = normalizeBearer(auth?.credential ?? this._options.credential);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': this._protocolVersion,
      ...(this._options.headers ?? {}),
      ...(auth?.headers ?? {}),
      ...(bearer ? { Authorization: bearer } : {}),
      ...(this._sessionId ? { [SESSION_HEADER]: this._sessionId } : {}),
    };
    return headers;
  }

  private async _postJsonRpc<T>(
    method: string,
    params: Record<string, unknown> | undefined,
    auth?: MCPAuthOptions
  ): Promise<MCPMaybePaid<T>> {
    const body: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: `${method}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      method,
      ...(params ? { params } : {}),
    };
    const headers = this._baseHeaders(auth);

    if (this._x402Deps) {
      const result = await requestWithX402<T>(
        {
          url: this._endpoint,
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          parseResponse: async (res) => {
            const newSession = res.headers.get(SESSION_HEADER);
            if (newSession) this._sessionId = newSession;
            if (this._sessionId && res.status === 404) {
              this._initialized = false;
              this._sessionId = undefined;
              throw new Error('MCP session expired');
            }
            const text = await res.text();
            const data = extractJsonRpcBody(text, res.headers.get('content-type') ?? '');
            return parseJsonRpcResult<T>(data, method);
          },
        },
        this._x402Deps
      );
      if ('x402Required' in result && result.x402Required) {
        return result as X402RequiredResponse<T>;
      }
      return result as T;
    }

    const res = await fetch(this._endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const newSession = res.headers.get(SESSION_HEADER);
    if (newSession) this._sessionId = newSession;
    if (this._sessionId && res.status === 404) {
      this._initialized = false;
      this._sessionId = undefined;
      throw new Error('MCP session expired');
    }
    if (!res.ok) throw new Error(`MCP ${method} failed: HTTP ${res.status}`);
    const text = await res.text();
    return parseJsonRpcResult<T>(extractJsonRpcBody(text, res.headers.get('content-type') ?? ''), method);
  }

  private async _ensureInitialized(auth?: MCPAuthOptions): Promise<X402RequiredResponse<unknown> | null> {
    if (this._initialized) return null;
    const initResult = await this._postJsonRpc<MCPInitializeResult>(
      'initialize',
      {
        protocolVersion: this._protocolVersion,
        capabilities: {},
        clientInfo: this._options.clientInfo ?? {
          name: 'agent0-ts',
          version: '1.0.0',
        },
      },
      auth
    );
    if ('x402Required' in initResult && initResult.x402Required) return initResult as X402RequiredResponse<unknown>;
    const initialized = initResult as MCPInitializeResult;
    this._protocolVersion = initialized.protocolVersion ?? this._protocolVersion;
    const caps = initialized.capabilities;
    this._serverCaps =
      caps !== undefined && caps !== null && typeof caps === 'object' ? (caps as Record<string, unknown>) : undefined;

    const initializedNotif: JsonRpcRequest = { jsonrpc: '2.0', method: 'notifications/initialized' };
    const notifHeaders = this._baseHeaders(auth);
    if (this._x402Deps) {
      await requestWithX402(
        {
          url: this._endpoint,
          method: 'POST',
          headers: notifHeaders,
          body: JSON.stringify(initializedNotif),
          parseResponse: async (res) => {
            if (res.status !== 202 && !res.ok) throw new Error(`MCP initialized notification failed: HTTP ${res.status}`);
            return {};
          },
        },
        this._x402Deps
      );
    } else {
      const res = await fetch(this._endpoint, {
        method: 'POST',
        headers: notifHeaders,
        body: JSON.stringify(initializedNotif),
      });
      if (res.status !== 202 && !res.ok) throw new Error(`MCP initialized notification failed: HTTP ${res.status}`);
    }
    this._initialized = true;
    return null;
  }

  /** If we parsed server capabilities, only call feature X when that key was present (MCP omits unsupported primitives). */
  private _advertises(feature: 'prompts' | 'resources'): boolean {
    if (this._serverCaps === undefined) return true;
    return Object.prototype.hasOwnProperty.call(this._serverCaps, feature);
  }

  async initialize(options?: MCPAuthOptions): Promise<MCPMaybePaid<MCPInitializeResult>> {
    const res = await this._ensureInitialized(options);
    if (res && 'x402Required' in res && res.x402Required) return castX402<MCPInitializeResult>(res);
    return {
      protocolVersion: this._protocolVersion,
    };
  }

  async listTools(options?: MCPAuthOptions): Promise<MCPMaybePaid<MCPTool[]>> {
    const init = await this._ensureInitialized(options);
    if (init && 'x402Required' in init && init.x402Required) return castX402<MCPTool[]>(init);
    if (this._toolsCache) return this._toolsCache;
    const out: MCPTool[] = [];
    let cursor: string | undefined;
    do {
      const page = await this._postJsonRpc<{ tools?: MCPTool[]; nextCursor?: string }>(
        'tools/list',
        cursor ? { cursor } : {},
        options
      );
      if ('x402Required' in page && page.x402Required) return castX402<MCPTool[]>(page);
      const p = page as { tools?: MCPTool[]; nextCursor?: string };
      out.push(...(p.tools ?? []));
      cursor = p.nextCursor;
    } while (cursor);
    this._toolsCache = out;
    this._rebuildDynamicToolAccess(out);
    return out;
  }

  private _rebuildDynamicToolAccess(tools: MCPTool[]): void {
    this._dynamicTools = {};
    for (const tool of tools) {
      const callFn = (args?: Record<string, unknown>, options?: MCPAuthOptions) => this.call(tool.name, args, options);
      this._dynamicTools[tool.name] = callFn;
    }
  }

  async call(name: string, args?: Record<string, unknown>, options?: MCPAuthOptions): Promise<MCPMaybePaid<unknown>> {
    const init = await this._ensureInitialized(options);
    if (init && 'x402Required' in init && init.x402Required) return castX402<unknown>(init);
    return this._postJsonRpc<unknown>('tools/call', { name, arguments: args ?? {} }, options);
  }

  readonly prompts = {
    list: async (options?: MCPAuthOptions): Promise<MCPMaybePaid<MCPPrompt[]>> => {
      const init = await this._ensureInitialized(options);
      if (init && 'x402Required' in init && init.x402Required) return castX402<MCPPrompt[]>(init);
      if (!this._advertises('prompts')) return [];
      const out: MCPPrompt[] = [];
      let cursor: string | undefined;
      do {
        const page = await this._postJsonRpc<{ prompts?: MCPPrompt[]; nextCursor?: string }>(
          'prompts/list',
          cursor ? { cursor } : {},
          options
        );
        if ('x402Required' in page && page.x402Required) return castX402<MCPPrompt[]>(page);
        const p = page as { prompts?: MCPPrompt[]; nextCursor?: string };
        out.push(...(p.prompts ?? []));
        cursor = p.nextCursor;
      } while (cursor);
      return out;
    },
    get: async (name: string, args?: Record<string, unknown>, options?: MCPAuthOptions): Promise<MCPMaybePaid<MCPPromptGetResult>> => {
      const init = await this._ensureInitialized(options);
      if (init && 'x402Required' in init && init.x402Required) return castX402<MCPPromptGetResult>(init);
      if (!this._advertises('prompts')) {
        throw new Error('MCP server did not advertise prompts capability');
      }
      return this._postJsonRpc<MCPPromptGetResult>('prompts/get', { name, arguments: args ?? {} }, options);
    },
  };

  readonly resources = {
    list: async (options?: MCPAuthOptions): Promise<MCPMaybePaid<MCPResource[]>> => {
      const init = await this._ensureInitialized(options);
      if (init && 'x402Required' in init && init.x402Required) return castX402<MCPResource[]>(init);
      if (!this._advertises('resources')) return [];
      const out: MCPResource[] = [];
      let cursor: string | undefined;
      do {
        const page = await this._postJsonRpc<{ resources?: MCPResource[]; nextCursor?: string }>(
          'resources/list',
          cursor ? { cursor } : {},
          options
        );
        if ('x402Required' in page && page.x402Required) return castX402<MCPResource[]>(page);
        const p = page as { resources?: MCPResource[]; nextCursor?: string };
        out.push(...(p.resources ?? []));
        cursor = p.nextCursor;
      } while (cursor);
      return out;
    },
    read: async (
      uri: string,
      options?: MCPAuthOptions
    ): Promise<MCPMaybePaid<{ contents: Array<{ uri: string; [key: string]: unknown }> }>> => {
      const init = await this._ensureInitialized(options);
      if (init && 'x402Required' in init && init.x402Required) {
        return castX402<{ contents: Array<{ uri: string; [key: string]: unknown }> }>(init);
      }
      if (!this._advertises('resources')) {
        throw new Error('MCP server did not advertise resources capability');
      }
      return this._postJsonRpc<{ contents: Array<{ uri: string; [key: string]: unknown }> }>(
        'resources/read',
        { uri },
        options
      );
    },
    templates: {
      list: async (options?: MCPAuthOptions): Promise<MCPMaybePaid<MCPResourceTemplate[]>> => {
        const init = await this._ensureInitialized(options);
        if (init && 'x402Required' in init && init.x402Required) return castX402<MCPResourceTemplate[]>(init);
        if (!this._advertises('resources')) return [];
        const out: MCPResourceTemplate[] = [];
        let cursor: string | undefined;
        do {
          const page = await this._postJsonRpc<{ resourceTemplates?: MCPResourceTemplate[]; nextCursor?: string }>(
            'resources/templates/list',
            cursor ? { cursor } : {},
            options
          );
          if ('x402Required' in page && page.x402Required) return castX402<MCPResourceTemplate[]>(page);
          const p = page as { resourceTemplates?: MCPResourceTemplate[]; nextCursor?: string };
          out.push(...(p.resourceTemplates ?? []));
          cursor = p.nextCursor;
        } while (cursor);
        return out;
      },
    },
  };

  get tools(): Record<string, (args?: Record<string, unknown>, options?: MCPAuthOptions) => Promise<MCPMaybePaid<unknown>>> {
    return this._dynamicTools;
  }

  getSessionId(): string | undefined {
    return this._sessionId;
  }

  setSessionId(sessionId?: string): void {
    this._sessionId = sessionId;
    if (sessionId) {
      this._initialized = true;
    }
  }

  resetSession(): void {
    this._sessionId = undefined;
    this._initialized = false;
    this._serverCaps = undefined;
    this._toolsCache = null;
  }
}

export function createMCPHandle(
  endpoint: string,
  options: MCPClientOptions = {},
  x402Deps?: X402RequestDeps
): MCPHandle {
  const client = new MCPClient(endpoint, options, x402Deps);
  return new Proxy(client as unknown as MCPHandle, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && isIdentifierSafe(prop) && !(prop in target)) {
        return async (args?: Record<string, unknown>, options?: MCPAuthOptions) =>
          target.call(prop, args, options);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

