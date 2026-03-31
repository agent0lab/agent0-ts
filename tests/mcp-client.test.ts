import { MCPClient, createMCPHandle } from '../src/core/mcp-client.js';
import { MCPClientFromSummary } from '../src/core/mcp-summary-client.js';
import { SDK } from '../src/core/sdk.js';
import { Agent } from '../src/core/agent.js';
import { EndpointType, TrustModel } from '../src/models/enums.js';
import type { RegistrationFile, AgentSummary } from '../src/models/interfaces.js';
import type { X402RequestDeps } from '../src/core/x402-request.js';

function mockResponse(init: {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  contentType?: string;
}): Response {
  const bodyStr = init.body !== undefined ? JSON.stringify(init.body) : '';
  const headers = new Headers({ 'content-type': init.contentType ?? 'application/json', ...(init.headers ?? {}) });
  return {
    ok: init.status >= 200 && init.status < 300,
    status: init.status,
    statusText: init.status >= 200 && init.status < 300 ? 'OK' : 'Error',
    text: () => Promise.resolve(bodyStr),
    json: () => Promise.resolve(init.body ?? {}),
    headers,
  } as unknown as Response;
}

describe('MCPClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('initializes first, sends initialized notification, then tools/list', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          headers: { 'Mcp-Session-Id': 'sess-1' },
          body: {
            jsonrpc: '2.0',
            id: '1',
            result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } },
          },
        })
      )
      .mockResolvedValueOnce(mockResponse({ status: 202, body: {} }))
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          body: { jsonrpc: '2.0', id: '2', result: { tools: [{ name: 'get_weather' }] } },
        })
      );

    const client = new MCPClient('https://mcp.example.com/mcp');
    const tools = await client.listTools();
    expect('x402Required' in tools).toBe(false);
    if ('x402Required' in tools) return;
    expect(tools).toEqual([{ name: 'get_weather' }]);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const initializeBody = JSON.parse((fetchSpy.mock.calls[0] as any)[1].body);
    expect(initializeBody.method).toBe('initialize');
    const initNotifBody = JSON.parse((fetchSpy.mock.calls[1] as any)[1].body);
    expect(initNotifBody.method).toBe('notifications/initialized');
    const toolListBody = JSON.parse((fetchSpy.mock.calls[2] as any)[1].body);
    expect(toolListBody.method).toBe('tools/list');
    expect((fetchSpy.mock.calls[2] as any)[1].headers['Mcp-Session-Id']).toBe('sess-1');
  });

  it('supports tool call via call(name,args)', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          body: { jsonrpc: '2.0', id: '1', result: { protocolVersion: '2025-06-18' } },
        })
      )
      .mockResolvedValueOnce(mockResponse({ status: 202, body: {} }))
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          body: {
            jsonrpc: '2.0',
            id: '2',
            result: { content: [{ type: 'text', text: 'Sunny' }], isError: false },
          },
        })
      );

    const client = new MCPClient('https://mcp.example.com/mcp');
    const result = (await client.call('weather/get', { location: 'Paris' })) as any;
    expect('x402Required' in result).toBe(false);
    if ('x402Required' in result) return;
    expect(result.content[0].text).toBe('Sunny');
  });

  it('supports identifier-safe proxy access', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          body: { jsonrpc: '2.0', id: '1', result: { protocolVersion: '2025-06-18' } },
        })
      )
      .mockResolvedValueOnce(mockResponse({ status: 202, body: {} }))
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          body: { jsonrpc: '2.0', id: '2', result: { content: [{ type: 'text', text: 'ok' }] } },
        })
      );
    const handle = createMCPHandle('https://mcp.example.com/mcp');
    const result = await (handle as any).get_weather({ location: 'Rome' });
    expect((result as any).content[0].text).toBe('ok');
  });

  it('lists and gets prompts', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        mockResponse({ status: 200, body: { jsonrpc: '2.0', id: '1', result: { protocolVersion: '2025-06-18' } } })
      )
      .mockResolvedValueOnce(mockResponse({ status: 202, body: {} }))
      .mockResolvedValueOnce(
        mockResponse({ status: 200, body: { jsonrpc: '2.0', id: '2', result: { prompts: [{ name: 'code_review' }] } } })
      )
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          body: {
            jsonrpc: '2.0',
            id: '3',
            result: { messages: [{ role: 'user', content: { type: 'text', text: 'review this' } }] },
          },
        })
      );

    const client = new MCPClient('https://mcp.example.com/mcp');
    const prompts = await client.prompts.list();
    expect('x402Required' in prompts).toBe(false);
    const promptGet = await client.prompts.get('code_review', { code: 'x' });
    expect('x402Required' in promptGet).toBe(false);
    if ('x402Required' in promptGet) return;
    expect(promptGet.messages[0]?.role).toBe('user');
  });

  it('lists and reads resources and templates', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        mockResponse({ status: 200, body: { jsonrpc: '2.0', id: '1', result: { protocolVersion: '2025-06-18' } } })
      )
      .mockResolvedValueOnce(mockResponse({ status: 202, body: {} }))
      .mockResolvedValueOnce(
        mockResponse({ status: 200, body: { jsonrpc: '2.0', id: '2', result: { resources: [{ uri: 'file:///a', name: 'a' }] } } })
      )
      .mockResolvedValueOnce(
        mockResponse({ status: 200, body: { jsonrpc: '2.0', id: '3', result: { contents: [{ uri: 'file:///a', text: 'hello' }] } } })
      )
      .mockResolvedValueOnce(
        mockResponse({ status: 200, body: { jsonrpc: '2.0', id: '4', result: { resourceTemplates: [{ uriTemplate: 'file:///{path}', name: 'files' }] } } })
      );

    const client = new MCPClient('https://mcp.example.com/mcp');
    const list = await client.resources.list();
    expect('x402Required' in list).toBe(false);
    const read = await client.resources.read('file:///a');
    expect('x402Required' in read).toBe(false);
    const templates = await client.resources.templates.list();
    expect('x402Required' in templates).toBe(false);
  });

  it('applies Authorization bearer header from credential', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        mockResponse({ status: 200, body: { jsonrpc: '2.0', id: '1', result: { protocolVersion: '2025-06-18' } } })
      )
      .mockResolvedValueOnce(mockResponse({ status: 202, body: {} }))
      .mockResolvedValueOnce(
        mockResponse({ status: 200, body: { jsonrpc: '2.0', id: '2', result: { tools: [] } } })
      );
    const client = new MCPClient('https://mcp.example.com/mcp', { credential: 'token-123' });
    await client.listTools();
    expect((fetchSpy.mock.calls[2] as any)[1].headers['Authorization']).toBe('Bearer token-123');
  });

  it('handles 402 with x402 deps and pay() retry', async () => {
    const accepts = [{ price: '100', token: '0xT', network: '84532', destination: '0xD' }];
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        mockResponse({ status: 402, headers: { 'payment-required': Buffer.from(JSON.stringify({ accepts })).toString('base64') } })
      )
      .mockResolvedValueOnce(
        mockResponse({ status: 200, body: { jsonrpc: '2.0', id: '1', result: { protocolVersion: '2025-06-18' } } })
      )
      .mockResolvedValueOnce(mockResponse({ status: 202, body: {} }));
    const deps: X402RequestDeps = {
      fetch: globalThis.fetch,
      buildPayment: async () => Buffer.from(JSON.stringify({ x402Version: 1, payload: { signature: '0x' + 'a'.repeat(130), authorization: {} } })).toString('base64'),
    };
    const client = new MCPClient('https://mcp.example.com/mcp', {}, deps);
    const init = await client.initialize();
    expect('x402Required' in init && init.x402Required).toBe(true);
    if (!('x402Required' in init) || !init.x402Required) return;
    await init.x402Payment.pay();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('MCP summary/sdk/agent wiring', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('MCPClientFromSummary throws if summary has no mcp endpoint', async () => {
    const summary = {
      chainId: 1,
      agentId: '1:1',
      name: 'x',
      description: 'x',
      owners: [],
      operators: [],
      supportedTrusts: [],
      a2aSkills: [],
      mcpTools: [],
      mcpPrompts: [],
      mcpResources: [],
      oasfSkills: [],
      oasfDomains: [],
      active: true,
      x402support: false,
      extras: {},
    } as AgentSummary;
    const client = new MCPClientFromSummary({}, summary);
    expect(() => client.listTools()).toThrow('Agent summary has no MCP endpoint');
  });

  it('sdk.createMCPClient(agent) returns agent.mcp handle', async () => {
    const sdk = new SDK({ chainId: 84532, rpcUrl: 'https://base-sepolia.drpc.org' });
    const reg: RegistrationFile = {
      name: 'x',
      description: 'x',
      endpoints: [{ type: EndpointType.MCP, value: 'https://mcp.example.com/mcp', meta: { version: '2025-06-18' } }],
      trustModels: [TrustModel.REPUTATION],
      owners: [],
      operators: [],
      active: true,
      x402support: false,
      metadata: {},
      updatedAt: 0,
    };
    const agent = new Agent(sdk, reg);
    const client = sdk.createMCPClient(agent);
    expect(client).toBe(agent.mcp);
  });

  it('sdk.createMCPClient(summary) returns summary-backed client', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        mockResponse({ status: 200, body: { jsonrpc: '2.0', id: '1', result: { protocolVersion: '2025-06-18' } } })
      )
      .mockResolvedValueOnce(mockResponse({ status: 202, body: {} }))
      .mockResolvedValueOnce(
        mockResponse({ status: 200, body: { jsonrpc: '2.0', id: '2', result: { tools: [] } } })
      );
    const sdk = new SDK({ chainId: 84532, rpcUrl: 'https://base-sepolia.drpc.org' });
    const summary: AgentSummary = {
      chainId: 1,
      agentId: '1:1',
      name: 'x',
      description: 'x',
      mcp: 'https://mcp.example.com/mcp',
      owners: [],
      operators: [],
      supportedTrusts: [],
      a2aSkills: [],
      mcpTools: [],
      mcpPrompts: [],
      mcpResources: [],
      oasfSkills: [],
      oasfDomains: [],
      active: true,
      x402support: false,
      extras: {},
    };
    const client = sdk.createMCPClient(summary);
    await client.listTools();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('sdk.createMCPClient(url) returns direct MCP handle', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        mockResponse({ status: 200, body: { jsonrpc: '2.0', id: '1', result: { protocolVersion: '2025-06-18' } } })
      )
      .mockResolvedValueOnce(mockResponse({ status: 202, body: {} }))
      .mockResolvedValueOnce(
        mockResponse({ status: 200, body: { jsonrpc: '2.0', id: '2', result: { tools: [] } } })
      );
    const sdk = new SDK({ chainId: 84532, rpcUrl: 'https://base-sepolia.drpc.org' });
    const client = sdk.createMCPClient('https://mcp.example.com/mcp');
    await client.listTools();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});

