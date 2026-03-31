import type { AgentSummary } from '../models/interfaces.js';
import type { MCPClientOptions, MCPHandle } from '../models/mcp.js';
import type { X402RequestDeps } from './x402-request.js';
import { createMCPHandle } from './mcp-client.js';

export interface SDKLikeMCP {
  getX402RequestDeps?(): X402RequestDeps;
}

export class MCPClientFromSummary implements MCPHandle {
  private _client: MCPHandle | null = null;

  constructor(
    private readonly _sdk: SDKLikeMCP,
    private readonly _summary: AgentSummary,
    private readonly _options: MCPClientOptions = {}
  ) {}

  private _ensureClient(): MCPHandle {
    if (this._client) return this._client;
    const endpoint = this._summary.mcp;
    if (!endpoint || (!endpoint.startsWith('http://') && !endpoint.startsWith('https://'))) {
      throw new Error('Agent summary has no MCP endpoint');
    }
    this._client = createMCPHandle(endpoint, this._options, this._sdk.getX402RequestDeps?.());
    return this._client;
  }

  get tools() {
    return this._ensureClient().tools;
  }
  get prompts() {
    return this._ensureClient().prompts;
  }
  get resources() {
    return this._ensureClient().resources;
  }
  listTools = (options?: Parameters<MCPHandle['listTools']>[0]) => this._ensureClient().listTools(options);
  call = (name: string, args?: Record<string, unknown>, options?: Parameters<MCPHandle['call']>[2]) =>
    this._ensureClient().call(name, args, options);
  getSessionId = () => this._ensureClient().getSessionId();
  setSessionId = (sessionId?: string) => this._ensureClient().setSessionId(sessionId);
  resetSession = () => this._ensureClient().resetSession();
  initialize = (options?: Parameters<MCPHandle['initialize']>[0]) => this._ensureClient().initialize(options);
}

