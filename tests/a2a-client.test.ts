/**
 * Unit tests for A2A client: parseMessageSendResponse, sendMessage, createTaskHandle.
 * Uses mocked fetch. Agent.messageA2A delegation tested here via Agent with A2A endpoint.
 */

import type { AgentTask, Part } from '../src/models/a2a.js';
import {
  parseMessageSendResponse,
  sendMessage,
  createTaskHandle,
  postAndParseMessageSend,
  applyCredential,
  listTasks,
  getTask,
  normalizeInterfaces,
  pickInterface,
  resolveA2aFromEndpointUrl,
} from '../src/core/a2a-client.js';
import type { NormalizedInterface } from '../src/core/a2a-client.js';
import type { X402RequestDeps } from '../src/core/x402-request.js';
import type { RegistrationFile } from '../src/models/interfaces.js';
import { EndpointType, TrustModel } from '../src/models/enums.js';
import { Agent } from '../src/core/agent.js';
import { SDK } from '../src/core/sdk.js';
import { A2AClientFromSummary } from '../src/core/a2a-summary-client.js';
import { A2AClientFromUrl } from '../src/core/a2a-summary-client.js';
import type { AgentSummary } from '../src/models/interfaces.js';

function mockResponse(init: {
  status: number;
  body?: unknown;
  ok?: boolean;
  /** For 402: x402 spec uses PAYMENT-REQUIRED header (base64 JSON). Pass { accepts } to set it. */
  paymentRequired?: { accepts: unknown[] };
}): Response {
  const bodyStr = init.body !== undefined ? JSON.stringify(init.body) : '';
  const ok = init.ok ?? (init.status >= 200 && init.status < 300);
  const headers = new Headers();
  if (init.status === 402 && init.paymentRequired) {
    const b64 = Buffer.from(JSON.stringify(init.paymentRequired), 'utf8').toString('base64');
    headers.set('payment-required', b64);
  }
  return {
    ok,
    status: init.status,
    statusText: ok ? 'OK' : 'Error',
    text: () => Promise.resolve(bodyStr),
    json: () => Promise.resolve(init.body ?? {}),
    headers,
    redirected: false,
    type: 'basic',
    url: '',
    clone: function () {
      return this;
    },
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
  } as Response;
}

function stubCreateTaskHandle(
  _endpoint: string,
  _a2aVersion: string,
  taskId: string,
  contextId: string
): AgentTask {
  return {
    taskId,
    contextId,
    query: async () => ({ taskId, contextId, status: undefined, artifacts: undefined, messages: undefined }),
    message: async () => ({ content: 'stub', parts: undefined, contextId }),
    cancel: async () => ({ taskId, contextId, status: undefined }),
  };
}

describe('normalizeInterfaces', () => {
  it('returns empty array for null, undefined, or non-object card', () => {
    expect(normalizeInterfaces(null)).toEqual([]);
    expect(normalizeInterfaces(undefined)).toEqual([]);
    expect(normalizeInterfaces('not an object' as unknown as Record<string, unknown>)).toEqual([]);
  });

  it('normalizes v1 supportedInterfaces with url, protocolBinding, protocolVersion, tenant', () => {
    const card = {
      supportedInterfaces: [
        {
          url: 'https://api.example.com/a2a/',
          protocolBinding: 'HTTP+JSON',
          protocolVersion: '0.3',
          tenant: 'org-1',
        },
      ],
    };
    const result = normalizeInterfaces(card as Record<string, unknown>);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      url: 'https://api.example.com/a2a',
      binding: 'HTTP+JSON',
      version: '0.3',
      tenant: 'org-1',
    });
  });

  it('normalizes protocolBinding variants to JSONRPC and GRPC', () => {
    const card = {
      supportedInterfaces: [
        { url: 'https://a.com', protocolBinding: 'JSON-RPC' },
        { url: 'https://b.com', protocol: 'grpc' },
      ],
    };
    const result = normalizeInterfaces(card as Record<string, unknown>);
    expect(result[0].binding).toBe('JSONRPC');
    expect(result[1].binding).toBe('GRPC');
  });

  it('treats missing or unknown protocolBinding as AUTO', () => {
    const card = {
      supportedInterfaces: [
        { url: 'https://a.com' },
        { url: 'https://b.com', protocolBinding: 'unknown' },
      ],
    };
    const result = normalizeInterfaces(card as Record<string, unknown>);
    expect(result[0].binding).toBe('AUTO');
    expect(result[1].binding).toBe('AUTO');
  });

  it('skips entries without valid http(s) URL', () => {
    const card = {
      supportedInterfaces: [
        { url: '' },
        { url: 'ftp://x.com' },
        { url: 'https://valid.com/' },
      ],
    };
    const result = normalizeInterfaces(card as Record<string, unknown>);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://valid.com');
  });

  it('normalizes 0.3-style card with url, preferredTransport, additionalInterfaces', () => {
    const card = {
      url: 'https://base.example.com',
      preferredTransport: 'HTTP+JSON',
      protocolVersion: '0.3',
      additionalInterfaces: [
        { url: 'https://alt.example.com', transport: 'JSONRPC', tenant: 't2' },
      ],
    };
    const result = normalizeInterfaces(card as Record<string, unknown>);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ url: 'https://base.example.com', binding: 'HTTP+JSON', version: '0.3' });
    expect(result[1]).toMatchObject({ url: 'https://alt.example.com', binding: 'JSONRPC', tenant: 't2' });
  });
});

describe('pickInterface', () => {
  it('returns null for empty list', () => {
    expect(pickInterface([], ['HTTP+JSON', 'JSONRPC'])).toBeNull();
  });

  it('picks single matching interface', () => {
    const ifaces: NormalizedInterface[] = [
      { url: 'https://a.com', binding: 'HTTP+JSON', version: '0.3' },
    ];
    expect(pickInterface(ifaces, ['HTTP+JSON', 'JSONRPC'])).toEqual(ifaces[0]);
  });

  it('prefers HTTP+JSON over JSONRPC when both present (order in list after version/AUTO sort)', () => {
    const ifaces: NormalizedInterface[] = [
      { url: 'https://httpjson.com', binding: 'HTTP+JSON', version: '0.3' },
      { url: 'https://jsonrpc.com', binding: 'JSONRPC', version: '0.3' },
    ];
    const picked = pickInterface(ifaces, ['HTTP+JSON', 'JSONRPC']);
    expect(picked?.url).toBe('https://httpjson.com');
    expect(picked?.binding).toBe('HTTP+JSON');
  });

  it('allows AUTO and places it after others in version tie-break', () => {
    const ifaces: NormalizedInterface[] = [
      { url: 'https://auto.com', binding: 'AUTO', version: '0.3' },
      { url: 'https://httpjson.com', binding: 'HTTP+JSON', version: '0.3' },
    ];
    const picked = pickInterface(ifaces, ['HTTP+JSON', 'JSONRPC']);
    expect(picked?.binding).toBe('HTTP+JSON');
    expect(picked?.url).toBe('https://httpjson.com');
  });

  it('prefers higher version when binding tie-break', () => {
    const ifaces: NormalizedInterface[] = [
      { url: 'https://old.com', binding: 'HTTP+JSON', version: '0.3' },
      { url: 'https://new.com', binding: 'HTTP+JSON', version: '1.0' },
    ];
    const picked = pickInterface(ifaces, ['HTTP+JSON']);
    expect(picked?.version).toBe('1.0');
    expect(picked?.url).toBe('https://new.com');
  });

  it('respects custom preferredBindings (allowed set; first in list with same version wins)', () => {
    const ifaces: NormalizedInterface[] = [
      { url: 'https://jsonrpc.com', binding: 'JSONRPC', version: '0.3' },
      { url: 'https://httpjson.com', binding: 'HTTP+JSON', version: '0.3' },
    ];
    const picked = pickInterface(ifaces, ['JSONRPC', 'HTTP+JSON']);
    expect(picked?.binding).toBe('JSONRPC');
    expect(picked?.url).toBe('https://jsonrpc.com');
  });

  it('prefers preferredBindings order over card order when version ties (card lists HTTP+JSON first)', () => {
    const ifaces: NormalizedInterface[] = [
      { url: 'https://httpjson.com', binding: 'HTTP+JSON', version: '0.3' },
      { url: 'https://jsonrpc.com', binding: 'JSONRPC', version: '0.3' },
    ];
    const picked = pickInterface(ifaces, ['JSONRPC', 'HTTP+JSON']);
    expect(picked?.binding).toBe('JSONRPC');
    expect(picked?.url).toBe('https://jsonrpc.com');
  });

  it('returns null when no interface matches allowed bindings', () => {
    const ifaces: NormalizedInterface[] = [
      { url: 'https://grpc.com', binding: 'GRPC', version: '0.3' },
    ];
    expect(pickInterface(ifaces, ['HTTP+JSON', 'JSONRPC'])).toBeNull();
  });
});

describe('parseMessageSendResponse', () => {
  const baseUrl = 'https://a2a.example.com';
  const a2aVersion = '0.3';

  it('returns MessageResponse when data.message is present', () => {
    const data = {
      message: {
        content: 'Hello back',
        parts: [{ text: 'Hello back' }],
        contextId: 'ctx-1',
      },
    };
    const result = parseMessageSendResponse(data as Record<string, unknown>, stubCreateTaskHandle, baseUrl, a2aVersion);
    expect('task' in result).toBe(false);
    expect(result).toEqual({
      content: 'Hello back',
      parts: [{ text: 'Hello back' }],
      contextId: 'ctx-1',
    });
  });

  it('returns TaskResponse when data.task is present', () => {
    const data = {
      task: {
        id: 'task-123',
        contextId: 'ctx-1',
        status: { state: 'open' },
      },
    };
    const result = parseMessageSendResponse(data as Record<string, unknown>, stubCreateTaskHandle, baseUrl, a2aVersion);
    expect('task' in result).toBe(true);
    if (!('task' in result)) return;
    expect(result.taskId).toBe('task-123');
    expect(result.contextId).toBe('ctx-1');
    expect(result.task.taskId).toBe('task-123');
    expect(result.task.contextId).toBe('ctx-1');
  });

  it('accepts taskId alias in task object', () => {
    const data = {
      task: {
        taskId: 'task-456',
        contextId: 'ctx-2',
      },
    };
    const result = parseMessageSendResponse(data as Record<string, unknown>, stubCreateTaskHandle, baseUrl, a2aVersion);
    expect('task' in result).toBe(true);
    if (!('task' in result)) return;
    expect(result.taskId).toBe('task-456');
    expect(result.contextId).toBe('ctx-2');
  });

  it('throws when task object has no id/taskId', () => {
    const data = {
      task: {
        contextId: 'ctx-1',
      },
    };
    expect(() =>
      parseMessageSendResponse(data as Record<string, unknown>, stubCreateTaskHandle, baseUrl, a2aVersion)
    ).toThrow('A2A task response missing task id');
  });

  it('throws when response has neither task nor message', () => {
    const data = { foo: 'bar' };
    expect(() =>
      parseMessageSendResponse(data as Record<string, unknown>, stubCreateTaskHandle, baseUrl, a2aVersion)
    ).toThrow('A2A response contained neither task nor message');
  });
});

describe('applyCredential', () => {
  it('puts apiKey in header when scheme is apiKey in header', () => {
    const auth = {
      securitySchemes: {
        apiKey: { type: 'apiKey' as const, in: 'header' as const, name: 'X-API-Key' },
      },
      security: [{ apiKey: [] }],
    };
    const out = applyCredential({ apiKey: 'secret-123' }, auth);
    expect(out.headers['X-API-Key']).toBe('secret-123');
    expect(Object.keys(out.queryParams)).toHaveLength(0);
  });

  it('puts apiKey in query when scheme is apiKey in query', () => {
    const auth = {
      securitySchemes: {
        apiKey: { type: 'apiKey' as const, in: 'query' as const, name: 'key' },
      },
      security: [{ apiKey: [] }],
    };
    const out = applyCredential({ apiKey: 'q-secret' }, auth);
    expect(out.queryParams['key']).toBe('q-secret');
    expect(Object.keys(out.headers)).toHaveLength(0);
  });

  it('puts apiKey in Cookie header when scheme is apiKey in cookie', () => {
    const auth = {
      securitySchemes: {
        apiKey: { type: 'apiKey' as const, in: 'cookie' as const, name: 'session' },
      },
      security: [{ apiKey: [] }],
    };
    const out = applyCredential({ apiKey: 'sess-abc' }, auth);
    expect(out.headers['Cookie']).toBe('session=sess-abc');
  });

  it('sets Authorization Bearer when scheme is http bearer', () => {
    const auth = {
      securitySchemes: {
        bearerAuth: { type: 'http' as const, scheme: 'bearer' as const },
      },
      security: [{ bearerAuth: [] }],
    };
    const out = applyCredential({ bearerAuth: 'token-xyz' }, auth);
    expect(out.headers['Authorization']).toBe('Bearer token-xyz');
  });

  it('sets Authorization Basic when scheme is http basic', () => {
    const auth = {
      securitySchemes: {
        basicAuth: { type: 'http' as const, scheme: 'basic' as const },
      },
      security: [{ basicAuth: [] }],
    };
    const out = applyCredential({ basicAuth: 'alice:secret' }, auth);
    expect(out.headers['Authorization']).toMatch(/^Basic [A-Za-z0-9+/]+=*$/);
    const b64 = out.headers['Authorization'].replace(/^Basic /, '');
    expect(Buffer.from(b64, 'base64').toString('utf8')).toBe('alice:secret');
  });

  it('normalizes string credential to apiKey', () => {
    const auth = {
      securitySchemes: {
        apiKey: { type: 'apiKey' as const, in: 'header' as const, name: 'Authorization' },
      },
      security: [{ apiKey: [] }],
    };
    const out = applyCredential('string-token', auth);
    expect(out.headers['Authorization']).toBe('string-token');
  });

  it('returns empty when security is empty', () => {
    const auth = { securitySchemes: { apiKey: { type: 'apiKey' as const, in: 'header' as const, name: 'X-API-Key' } }, security: [] };
    const out = applyCredential({ apiKey: 'x' }, auth);
    expect(out.headers).toEqual({});
    expect(out.queryParams).toEqual({});
  });

  it('returns empty when credential has no value for required scheme', () => {
    const auth = {
      securitySchemes: {
        apiKey: { type: 'apiKey' as const, in: 'header' as const, name: 'X-API-Key' },
      },
      security: [{ apiKey: [] }],
    };
    const out = applyCredential({ bearer: 'unused' }, auth);
    expect(out.headers).toEqual({});
    expect(out.queryParams).toEqual({});
  });

  it('uses first required security entry when credential has value for first', () => {
    const auth = {
      securitySchemes: {
        apiKey: { type: 'apiKey' as const, in: 'header' as const, name: 'X-API-Key' },
        bearerAuth: { type: 'http' as const, scheme: 'bearer' as const },
      },
      security: [{ apiKey: [] }, { bearerAuth: [] }] as Array<Record<string, string[]>>,
    };
    const out = applyCredential({ apiKey: 'first' }, auth);
    expect(out.headers['X-API-Key']).toBe('first');
    expect(out.headers['Authorization']).toBeUndefined();
  });

  it('uses second scheme when credential has value only for second (first-match)', () => {
    const auth = {
      securitySchemes: {
        apiKey: { type: 'apiKey' as const, in: 'header' as const, name: 'X-API-Key' },
        bearerAuth: { type: 'http' as const, scheme: 'bearer' as const },
      },
      security: [{ apiKey: [] }, { bearerAuth: [] }] as Array<Record<string, string[]>>,
    };
    const out = applyCredential({ bearerAuth: 'jwt-token-only' }, auth);
    expect(out.headers['Authorization']).toBe('Bearer jwt-token-only');
    expect(out.headers['X-API-Key']).toBeUndefined();
  });

  it('uses first scheme when credential has values for multiple schemes', () => {
    const auth = {
      securitySchemes: {
        apiKey: { type: 'apiKey' as const, in: 'query' as const, name: 'key' },
        bearerAuth: { type: 'http' as const, scheme: 'bearer' as const },
      },
      security: [{ apiKey: [] }, { bearerAuth: [] }] as Array<Record<string, string[]>>,
    };
    const out = applyCredential({ apiKey: 'q', bearerAuth: 'jwt' }, auth);
    expect(out.queryParams['key']).toBe('q');
    expect(out.headers['Authorization']).toBeUndefined();
  });

  it('returns empty when credential has no value for any of multiple schemes', () => {
    const auth = {
      securitySchemes: {
        apiKey: { type: 'apiKey' as const, in: 'header' as const, name: 'X-API-Key' },
        bearerAuth: { type: 'http' as const, scheme: 'bearer' as const },
      },
      security: [{ apiKey: [] }, { bearerAuth: [] }] as Array<Record<string, string[]>>,
    };
    const out = applyCredential({ otherKey: 'ignored' }, auth);
    expect(out.headers).toEqual({});
    expect(out.queryParams).toEqual({});
  });

  it('string credential uses apiKey when apiKey is second in security (first-match)', () => {
    const auth = {
      securitySchemes: {
        bearerAuth: { type: 'http' as const, scheme: 'bearer' as const },
        apiKey: { type: 'apiKey' as const, in: 'header' as const, name: 'X-API-Key' },
      },
      security: [{ bearerAuth: [] }, { apiKey: [] }] as Array<Record<string, string[]>>,
    };
    const out = applyCredential('my-api-key', auth);
    expect(out.headers['X-API-Key']).toBe('my-api-key');
    expect(out.headers['Authorization']).toBeUndefined();
  });
});

describe('sendMessage (mocked fetch)', () => {
  const baseUrl = 'https://a2a.example.com';
  const a2aVersion = '0.3';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends POST to /message:send with string content and returns MessageResponse', async () => {
    const body = {
      message: {
        content: 'Echo: hello',
        parts: [{ text: 'Echo: hello' }],
        contextId: 'ctx-1',
      },
    };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body }));

    const result = await sendMessage({
      baseUrl,
      a2aVersion,
      content: 'hello',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      `${baseUrl}/v1/message:send`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'A2A-Version': a2aVersion, 'Content-Type': 'application/json' }),
      })
    );
    const postCall = fetchSpy.mock.calls.find((c) => String(c[0]).includes('message:send'));
    expect(postCall).toBeDefined();
    const callBody = JSON.parse((postCall as any)[1].body);
    expect(callBody.message.role).toBe('ROLE_USER');
    // v0.3 format: kind + text / file.uri
    expect(callBody.message.parts).toEqual([{ kind: 'text', text: 'hello' }]);
    expect(callBody.message.messageId).toBeDefined();

    expect('task' in result).toBe(false);
    expect(result).toMatchObject({ content: 'Echo: hello', contextId: 'ctx-1' });
  });

  it('sends parts when content is object and returns TaskResponse', async () => {
    const body = {
      task: {
        id: 'task-1',
        contextId: 'ctx-1',
        status: { state: 'open' },
      },
    };
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body }));

    const result = await sendMessage({
      baseUrl,
      a2aVersion,
      content: { parts: [{ text: 'analyze' }, { url: 'https://example.com' }] },
      options: { blocking: true, contextId: 'ctx-0' },
    });

    expect('task' in result).toBe(true);
    if (!('task' in result)) return;
    expect(result.taskId).toBe('task-1');
    expect(result.contextId).toBe('ctx-1');
    expect(result.task.taskId).toBe('task-1');

    const fetchCall = (globalThis.fetch as jest.Mock).mock.calls[0];
    const callBody = JSON.parse(fetchCall[1].body);
    // v0.3 format: kind + text, kind + file.uri
    expect(callBody.message.parts).toEqual([
      { kind: 'text', text: 'analyze' },
      { kind: 'file', file: { uri: 'https://example.com' } },
    ]);
    expect(callBody.message.contextId).toBe('ctx-0');
    expect(callBody.configuration).toEqual({ blocking: true });
  });

  it('throws on 402', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 402, body: { accepts: [] } }));

    await expect(
      sendMessage({ baseUrl, a2aVersion, content: 'hi' })
    ).rejects.toThrow('402 Payment Required');
  });

  it('throws on non-ok status', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 500, body: {} }));

    await expect(sendMessage({ baseUrl, a2aVersion, content: 'hi' })).rejects.toThrow(
      'A2A request failed: HTTP 500'
    );
  });

  it('sends credential as header when auth is apiKey in header', async () => {
    const body = {
      message: { content: 'OK', parts: [{ text: 'OK' }], contextId: 'ctx-1' },
    };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body }));

    await sendMessage({
      baseUrl,
      a2aVersion,
      content: 'hello',
      options: { credential: 'my-api-key' },
      auth: {
        securitySchemes: {
          apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        },
        security: [{ apiKey: [] }],
      },
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      `${baseUrl}/v1/message:send`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'A2A-Version': a2aVersion,
          'Content-Type': 'application/json',
          'X-API-Key': 'my-api-key',
        }),
      })
    );
  });

  it('sends credential as query param when auth is apiKey in query', async () => {
    const body = {
      message: { content: 'OK', parts: [{ text: 'OK' }], contextId: 'ctx-1' },
    };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body }));

    await sendMessage({
      baseUrl,
      a2aVersion,
      content: 'hello',
      options: { credential: { apiKey: 'query-secret' } },
      auth: {
        securitySchemes: {
          apiKey: { type: 'apiKey', in: 'query', name: 'api_key' },
        },
        security: [{ apiKey: [] }],
      },
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      `${baseUrl}/v1/message:send?api_key=query-secret`,
      expect.any(Object)
    );
  });

  it('sends Bearer token when auth is http bearer', async () => {
    const body = {
      message: { content: 'OK', parts: [{ text: 'OK' }], contextId: 'ctx-1' },
    };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body }));

    await sendMessage({
      baseUrl,
      a2aVersion,
      content: 'hello',
      options: { credential: { bearerAuth: 'jwt-token-xyz' } },
      auth: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
        },
        security: [{ bearerAuth: [] }],
      },
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      `${baseUrl}/v1/message:send`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer jwt-token-xyz',
        }),
      })
    );
  });

  it('with binding HTTP+JSON uses /v1/message:send for version 0.3', async () => {
    const body = {
      message: { content: 'OK', parts: [{ text: 'OK' }], contextId: 'ctx-1' },
    };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body }));

    await sendMessage({
      baseUrl,
      a2aVersion,
      content: 'hi',
      binding: 'HTTP+JSON',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      `${baseUrl}/v1/message:send`,
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('with binding JSONRPC POSTs to baseUrl with JSON-RPC body (0.3 method message/send)', async () => {
    const body = { result: { message: { content: 'Echo', parts: [{ text: 'Echo' }], contextId: 'c1' } } };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body }));

    await sendMessage({
      baseUrl,
      a2aVersion,
      content: 'hi',
      binding: 'JSONRPC',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      baseUrl.replace(/\/+$/, ''),
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      })
    );
    const callBody = JSON.parse((fetchSpy.mock.calls[0] as any)[1].body);
    expect(callBody.jsonrpc).toBe('2.0');
    expect(callBody.method).toBe('message/send');
    expect(callBody.params?.message).toBeDefined();
  });

  it('with binding JSONRPC and v1 sends flat params (message, configuration; no request wrapper)', async () => {
    const body = { result: { message: { content: 'OK', parts: [{ text: 'OK' }], contextId: 'c1' } } };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body }));

    await sendMessage({
      baseUrl,
      a2aVersion: '1.0',
      content: 'hi',
      options: { blocking: true },
      binding: 'JSONRPC',
    });

    const callBody = JSON.parse((fetchSpy.mock.calls[0] as any)[1].body);
    expect(callBody.method).toBe('SendMessage');
    expect(callBody.params).toHaveProperty('message');
    expect(callBody.params).toHaveProperty('configuration');
    expect(callBody.params.configuration).toEqual({ blocking: true });
    expect(callBody.params).not.toHaveProperty('request');
  });

  it('with binding AUTO tries HTTP+JSON first then JSON-RPC on 404', async () => {
    const messagePayload = {
      message: {
        content: 'From JSON-RPC',
        parts: [{ text: 'From JSON-RPC' }],
        contextId: 'c1',
      },
    };
    const jsonRpcBody = { result: messagePayload };
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse({ status: 404, body: {} }))
      .mockResolvedValueOnce(mockResponse({ status: 404, body: {} }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: jsonRpcBody }));

    const result = await sendMessage({
      baseUrl,
      a2aVersion,
      content: 'hi',
      binding: 'AUTO',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect((fetchSpy.mock.calls[0] as any)[0]).toContain('/v1/message:send');
    expect((fetchSpy.mock.calls[1] as any)[0]).toContain('message:send');
    expect((fetchSpy.mock.calls[2] as any)[1].body).toMatch(/"method":"message\/send"/);
    expect('task' in result).toBe(false);
    if (!('task' in result) && !('x402Required' in result)) expect(result.content).toBe('From JSON-RPC');
  });

  it('with binding AUTO uses HTTP+JSON when first path returns 200', async () => {
    const body = {
      message: { content: 'Direct', parts: [{ text: 'Direct' }], contextId: 'ctx-1' },
    };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body }));

    const result = await sendMessage({
      baseUrl,
      a2aVersion,
      content: 'hi',
      binding: 'AUTO',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((fetchSpy.mock.calls[0] as any)[0]).toContain('/v1/message:send');
    if (!('task' in result) && !('x402Required' in result)) expect(result.content).toBe('Direct');
  });

  it('with tenant passes tenant prefix in path', async () => {
    const body = {
      message: { content: 'OK', parts: [{ text: 'OK' }], contextId: 'ctx-1' },
    };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body }));

    await sendMessage({
      baseUrl,
      a2aVersion,
      content: 'hi',
      tenant: 'tenant-alpha',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      `${baseUrl}/tenants/tenant-alpha/v1/message:send`,
      expect.any(Object)
    );
  });
});

describe('sendMessage with x402Deps (402 then pay())', () => {
  const baseUrl = 'https://a2a.example.com';
  const a2aVersion = '0.3';
  const validPayload = Buffer.from(
    JSON.stringify({
      x402Version: 1,
      scheme: 'exact',
      network: '84532',
      payload: {
        signature: '0x' + 'a'.repeat(130),
        authorization: { from: '0x123', to: '0x456', value: '1000000', validAfter: '0', validBefore: '9999999999', nonce: '0x' + 'b'.repeat(64) },
      },
    })
  ).toString('base64');

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns x402Required on 402, then pay() retries and returns message', async () => {
    const accepts = [{ price: '1000000', token: '0xToken', network: '84532', destination: '0xDest' }];
    const messageBody = {
      message: { content: 'Paid response', parts: [{ text: 'Paid response' }], contextId: 'ctx-1' },
    };
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse({ status: 402, paymentRequired: { accepts } }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: messageBody }));

    const x402Deps: X402RequestDeps = {
      fetch: globalThis.fetch,
      buildPayment: async () => validPayload,
    };

    const result = await sendMessage(
      { baseUrl, a2aVersion, content: 'hi' },
      x402Deps
    );

    expect('x402Required' in result && result.x402Required).toBe(true);
    if (!('x402Required' in result) || !result.x402Required) return;

    const paid = await result.x402Payment.pay();
    expect('task' in paid).toBe(false);
    if (!('task' in paid)) {
      expect(paid.content).toBe('Paid response');
      expect(paid.contextId).toBe('ctx-1');
    }

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondCall = (fetchSpy.mock.calls[1] as any)[1];
    expect(secondCall.headers['PAYMENT-SIGNATURE']).toBe(validPayload);
  });

  it('options.payment set: first request includes PAYMENT-SIGNATURE, 200 returns message (no 402)', async () => {
    const prebuiltPayload = 'prebuilt-payment-base64';
    const messageBody = {
      message: { content: 'OK', parts: [{ text: 'OK' }], contextId: 'ctx-1' },
    };
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse({ status: 200, body: messageBody }));

    const x402Deps: X402RequestDeps = {
      fetch: globalThis.fetch,
      buildPayment: async () => validPayload,
    };

    const result = await sendMessage(
      { baseUrl, a2aVersion, content: 'hi', options: { payment: prebuiltPayload } },
      x402Deps
    );

    expect('x402Required' in result).toBe(false);
    if (!('x402Required' in result) && !('task' in result)) {
      expect(result.content).toBe('OK');
      expect(result.contextId).toBe('ctx-1');
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const firstCall = (fetchSpy.mock.calls[0] as any)[1];
    expect(firstCall.headers['PAYMENT-SIGNATURE']).toBe(prebuiltPayload);
  });

  it('options.payment set but server returns 402: same x402 flow with pay()', async () => {
    const accepts = [{ price: '1000000', token: '0xT', network: '84532', destination: '0xD' }];
    const messageBody = {
      message: { content: 'Paid', parts: [{ text: 'Paid' }], contextId: 'ctx-1' },
    };
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse({ status: 402, paymentRequired: { accepts } }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: messageBody }));

    const x402Deps: X402RequestDeps = {
      fetch: globalThis.fetch,
      buildPayment: async () => validPayload,
    };

    const result = await sendMessage(
      { baseUrl, a2aVersion, content: 'hi', options: { payment: 'rejected-payload' } },
      x402Deps
    );

    expect('x402Required' in result && result.x402Required).toBe(true);
    if (!('x402Required' in result) || !result.x402Required) return;
    const paid = await result.x402Payment.pay();
    expect('x402Required' in paid).toBe(false);
    if (!('x402Required' in paid) && !('task' in paid)) expect(paid.content).toBe('Paid');
  });
});

describe('postAndParseMessageSend', () => {
  const baseUrl = 'https://a2a.example.com';
  const a2aVersion = '0.3';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('tries /v1/message:send first for version 0.3, then /message:send on 404', async () => {
    const body = {
      message: { content: 'OK', parts: [{ text: 'OK' }], contextId: 'ctx-1' },
    };
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse({ status: 404, body: {} }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body }));

    const result = await postAndParseMessageSend(
      baseUrl,
      a2aVersion,
      { message: { role: 'ROLE_USER', parts: [{ text: 'hi' }], messageId: 'm1' } },
      stubCreateTaskHandle,
      undefined,
      undefined
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect((fetchSpy.mock.calls[0] as any)[0]).toBe(`${baseUrl.replace(/\/+$/, '')}/v1/message:send`);
    expect((fetchSpy.mock.calls[1] as any)[0]).toBe(`${baseUrl.replace(/\/+$/, '')}/message:send`);
    expect('task' in result).toBe(false);
    if (!('task' in result)) expect(result.content).toBe('OK');
  });

  it('for version 1.0 tries /message:send first', async () => {
    const body = {
      message: { content: 'OK', parts: [{ text: 'OK' }], contextId: 'ctx-1' },
    };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body }));

    await postAndParseMessageSend(
      baseUrl,
      '1.0',
      { message: { role: 'ROLE_USER', parts: [{ text: 'hi' }], messageId: 'm1' } },
      stubCreateTaskHandle,
      undefined,
      undefined
    );

    expect((fetchSpy.mock.calls[0] as any)[0]).toContain('/message:send');
    expect((fetchSpy.mock.calls[0] as any)[0]).not.toContain('/v1/');
  });

  it('includes tenant prefix in path when tenant provided', async () => {
    const body = {
      message: { content: 'OK', parts: [{ text: 'OK' }], contextId: 'ctx-1' },
    };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body }));

    await postAndParseMessageSend(
      baseUrl,
      a2aVersion,
      { message: { role: 'ROLE_USER', parts: [{ text: 'hi' }], messageId: 'm1' } },
      stubCreateTaskHandle,
      undefined,
      'my-tenant'
    );

    expect((fetchSpy.mock.calls[0] as any)[0]).toContain('/tenants/my-tenant/v1/message:send');
  });

  it('throws clear error when response body is not JSON (e.g. HTML)', async () => {
    const htmlResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve('<html><body>Not JSON</body></html>'),
      headers: new Headers(),
      url: `${baseUrl}/v1/message:send`,
    } as unknown as Response;
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(htmlResponse);

    await expect(
      postAndParseMessageSend(
        baseUrl,
        a2aVersion,
        { message: { role: 'ROLE_USER', parts: [{ text: 'hi' }], messageId: 'm1' } },
        stubCreateTaskHandle,
        undefined,
        undefined
      )
    ).rejects.toThrow(/non-JSON|HTML|wrong URL/);
  });
});

describe('listTasks', () => {
  const baseUrl = 'https://a2a.example.com';
  const a2aVersion = '0.3';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('GETs /tasks and returns merged task list', async () => {
    const tasksBody = {
      tasks: [
        { id: 't1', taskId: 't1', contextId: 'ctx-1', status: { state: 'open' } },
        { id: 't2', taskId: 't2', contextId: 'ctx-1', status: { state: 'open' } },
      ],
    };
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body: tasksBody }));

    const result = await listTasks({ baseUrl, a2aVersion });

    expect(Array.isArray(result)).toBe(true);
    const list = result as import('../src/models/a2a.js').TaskSummary[];
    expect(list).toHaveLength(2);
    expect(list[0].taskId).toBe('t1');
    expect(list[0].contextId).toBe('ctx-1');
    expect(list[1].taskId).toBe('t2');
    expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toContain('/tasks');
    expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toContain('pageSize=100');
  });

  it('surfaces messages from history when task has history (no messages)', async () => {
    const history = [{ role: 'ROLE_USER', parts: [{ text: 'q' }] }, { role: 'ROLE_AGENT', parts: [{ text: 'a' }] }];
    const tasksBody = {
      tasks: [{ id: 't1', taskId: 't1', contextId: 'ctx-1', status: { state: 'open' }, history }],
    };
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body: tasksBody }));

    const result = await listTasks({ baseUrl, a2aVersion });

    const list = result as import('../src/models/a2a.js').TaskSummary[];
    expect(list).toHaveLength(1);
    expect(list[0].messages).toEqual(history);
  });

  it('includes filter params in URL when provided', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body: { tasks: [] } }));

    await listTasks({
      baseUrl,
      a2aVersion,
      options: { filter: { contextId: 'ctx-x', status: 'open' }, historyLength: 5 },
    });

    const url = (globalThis.fetch as jest.Mock).mock.calls[0][0];
    expect(url).toContain('contextId=ctx-x');
    expect(url).toContain('status=open');
    expect(url).toContain('historyLength=5');
  });

  it('fetches all pages when nextPageToken is returned', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          body: { tasks: [{ id: 't1', taskId: 't1', contextId: 'c1', status: {} }], nextPageToken: '100' },
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          body: { tasks: [{ id: 't2', taskId: 't2', contextId: 'c1', status: {} }] },
        })
      );

    const result = await listTasks({ baseUrl, a2aVersion });

    const list = result as import('../src/models/a2a.js').TaskSummary[];
    expect(list).toHaveLength(2);
    expect(list[0].taskId).toBe('t1');
    expect(list[1].taskId).toBe('t2');
    expect((globalThis.fetch as jest.Mock).mock.calls[1][0]).toContain('pageToken=100');
  });

  it('with x402Deps and options.payment: first request has PAYMENT-SIGNATURE, 200 returns list', async () => {
    const prebuiltPayload = 'list-payment-base64';
    const tasksBody = {
      tasks: [
        { id: 't1', taskId: 't1', contextId: 'ctx-1', status: { state: 'open' } },
      ],
    };
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse({ status: 200, body: tasksBody }));

    const x402Deps: X402RequestDeps = {
      fetch: globalThis.fetch,
      buildPayment: async () => 'never-called',
    };

    const result = await listTasks(
      { baseUrl, a2aVersion, options: { payment: prebuiltPayload } },
      x402Deps
    );

    expect('x402Required' in result).toBe(false);
    const list = result as import('../src/models/a2a.js').TaskSummary[];
    expect(list).toHaveLength(1);
    expect(list[0].taskId).toBe('t1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const firstCall = (fetchSpy.mock.calls[0] as any)[1];
    expect(firstCall.headers['PAYMENT-SIGNATURE']).toBe(prebuiltPayload);
  });

  it('with tenant uses /tenants/:tenant/v1/tasks in URL', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body: { tasks: [] } }));

    await listTasks({ baseUrl, a2aVersion, tenant: 'org-42' });

    const url = (globalThis.fetch as jest.Mock).mock.calls[0][0];
    expect(url).toContain('/tenants/org-42/v1/tasks');
  });
});

describe('getTask', () => {
  const baseUrl = 'https://a2a.example.com';
  const a2aVersion = '0.3';
  const taskId = 'task-123';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('GETs /tasks/:id and returns TaskSummary', async () => {
    const taskBody = {
      id: taskId,
      taskId,
      contextId: 'ctx-abc',
      status: { state: 'working' },
      messages: [],
      artifacts: [],
    };
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body: taskBody }));

    const result = await getTask(baseUrl, a2aVersion, taskId);

    expect('x402Required' in result).toBe(false);
    if (!('x402Required' in result)) {
      expect(result.taskId).toBe(taskId);
      expect(result.contextId).toBe('ctx-abc');
      expect(result.status).toEqual({ state: 'working' });
    }
    expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toBe(`${baseUrl}/v1/tasks/task-123`);
  });

  it('surfaces messages from history when server returns history (no messages)', async () => {
    const history = [{ role: 'ROLE_USER', parts: [{ text: 'hello' }] }, { role: 'ROLE_AGENT', parts: [{ text: 'hi' }] }];
    const taskBody = {
      id: taskId,
      contextId: 'ctx-abc',
      status: { state: 'completed' },
      history,
      artifacts: [],
    };
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body: taskBody }));

    const result = await getTask(baseUrl, a2aVersion, taskId);

    expect('x402Required' in result).toBe(false);
    if (!('x402Required' in result)) {
      expect(result.messages).toEqual(history);
    }
  });

  it('with x402Deps and payment: first request has PAYMENT-SIGNATURE, 200 returns TaskSummary', async () => {
    const prebuiltPayload = 'get-task-payment-base64';
    const taskBody = {
      id: taskId,
      taskId,
      contextId: 'ctx-abc',
      status: { state: 'open' },
      messages: [],
      artifacts: [],
    };
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse({ status: 200, body: taskBody }));

    const x402Deps: X402RequestDeps = {
      fetch: globalThis.fetch,
      buildPayment: async () => 'never-called',
    };

    const result = await getTask(baseUrl, a2aVersion, taskId, undefined, x402Deps, prebuiltPayload);

    expect('x402Required' in result).toBe(false);
    if (!('x402Required' in result)) {
      expect(result.taskId).toBe(taskId);
      expect(result.contextId).toBe('ctx-abc');
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const firstCall = (fetchSpy.mock.calls[0] as any)[1];
    expect(firstCall.headers['PAYMENT-SIGNATURE']).toBe(prebuiltPayload);
  });

  it('with tenant uses /tenants/:tenant/v1/tasks/:id in URL', async () => {
    const taskBody = {
      id: taskId,
      taskId,
      contextId: 'ctx-abc',
      status: { state: 'open' },
      messages: [],
      artifacts: [],
    };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body: taskBody }));

    await getTask(baseUrl, a2aVersion, taskId, undefined, undefined, undefined, 'tenant-99');

    expect((fetchSpy.mock.calls[0] as any)[0]).toContain('/tenants/tenant-99/v1/tasks/task-123');
  });
});

describe('createTaskHandle', () => {
  const baseUrl = 'https://a2a.example.com';
  const a2aVersion = '0.3';
  const taskId = 'task-abc';
  const contextId = 'ctx-xyz';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('task.query() GETs /tasks/:id and returns state', async () => {
    const taskData = {
      id: taskId,
      contextId,
      status: { state: 'working' },
      artifacts: [],
      messages: [],
    };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body: taskData }));

    const task = createTaskHandle(baseUrl, a2aVersion, taskId, contextId);
    const result = await task.query({ historyLength: 10 });

    expect(fetchSpy).toHaveBeenCalledWith(
      `${baseUrl}/v1/tasks/task-abc?historyLength=10`,
      expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ 'A2A-Version': a2aVersion }) })
    );
    expect('x402Required' in result).toBe(false);
    if (!('x402Required' in result)) {
      expect(result.taskId).toBe(taskId);
      expect(result.contextId).toBe(contextId);
      expect(result.status).toEqual({ state: 'working' });
      expect(result.artifacts).toEqual([]);
      expect(result.messages).toEqual([]);
    }
  });

  it('task.query() surfaces messages from history when server returns history', async () => {
    const history = [{ role: 'ROLE_USER', parts: [{ text: 'ask' }] }, { role: 'ROLE_AGENT', parts: [{ text: 'answer' }] }];
    const taskData = {
      id: taskId,
      contextId,
      status: { state: 'completed' },
      history,
      artifacts: [],
    };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body: taskData }));

    const task = createTaskHandle(baseUrl, a2aVersion, taskId, contextId);
    const result = await task.query();

    expect(fetchSpy).toHaveBeenCalledWith(
      `${baseUrl}/v1/tasks/${taskId}`,
      expect.objectContaining({ method: 'GET' })
    );
    expect('x402Required' in result).toBe(false);
    if (!('x402Required' in result)) expect(result.messages).toEqual(history);
  });

  it('task.message() POSTs to message:send and returns MessageResponse', async () => {
    const body = {
      message: {
        content: 'Done',
        parts: [{ text: 'Done' }],
        contextId,
      },
    };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body }));

    const task = createTaskHandle(baseUrl, a2aVersion, taskId, contextId);
    const result = await task.message('follow up');

    expect(fetchSpy).toHaveBeenCalledWith(
      `${baseUrl}/v1/message:send`,
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      })
    );
    const callBody = JSON.parse((fetchSpy.mock.calls[0] as any)[1].body);
    expect(callBody.message.taskId).toBe(taskId);
    expect(callBody.message.contextId).toBe(contextId);
    // v0.3 format: kind + text
    expect(callBody.message.parts).toEqual([{ kind: 'text', text: 'follow up' }]);

    expect('task' in result).toBe(false);
    expect('x402Required' in result).toBe(false);
    if (!('task' in result) && !('x402Required' in result)) expect(result.content).toBe('Done');
  });

  it('task.message() can return TaskResponse (nested task)', async () => {
    const body = {
      task: {
        id: 'task-2',
        contextId,
        status: { state: 'open' },
      },
    };
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body }));

    const task = createTaskHandle(baseUrl, a2aVersion, taskId, contextId);
    const result = await task.message('create sub task');

    expect('task' in result).toBe(true);
    if (!('task' in result)) return;
    expect(result.taskId).toBe('task-2');
    expect(result.task.taskId).toBe('task-2');
  });

  it('task.cancel() POSTs to /tasks/:id:cancel', async () => {
    const body = { id: taskId, contextId, status: { state: 'canceled' } };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body }));

    const task = createTaskHandle(baseUrl, a2aVersion, taskId, contextId);
    const result = await task.cancel();

    expect(fetchSpy).toHaveBeenCalledWith(
      `${baseUrl}/v1/tasks/task-abc:cancel`,
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'A2A-Version': a2aVersion }) })
    );
    expect('x402Required' in result).toBe(false);
    if (!('x402Required' in result)) {
      expect(result.taskId).toBe(taskId);
      expect(result.contextId).toBe(contextId);
      expect(result.status).toEqual({ state: 'canceled' });
    }
  });

  it('with tenant: task.query() and task.message() use /tenants/:tenant prefix', async () => {
    const taskData = {
      id: taskId,
      contextId,
      status: { state: 'working' },
      artifacts: [],
      messages: [],
    };
    const messageBody = {
      message: { content: 'OK', parts: [{ text: 'OK' }], contextId },
    };
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse({ status: 200, body: taskData }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: messageBody }));

    const task = createTaskHandle(baseUrl, a2aVersion, taskId, contextId, undefined, undefined, 'org-7');
    await task.query({ historyLength: 5 });
    await task.message('follow up');

    expect((fetchSpy.mock.calls[0] as any)[0]).toContain('/tenants/org-7/v1/tasks/task-abc');
    expect((fetchSpy.mock.calls[1] as any)[0]).toContain('/tenants/org-7/v1/message:send');
  });
});

describe('Agent.messageA2A', () => {
  function makeAgentWithA2A(a2aEndpointUrl: string, a2aVersion = '0.3'): Agent {
    const regFile: RegistrationFile = {
      name: 'Test Agent',
      description: 'Test',
      endpoints: [
        {
          type: EndpointType.A2A,
          value: a2aEndpointUrl,
          meta: { version: a2aVersion },
        },
      ],
      trustModels: [TrustModel.REPUTATION],
      owners: [],
      operators: [],
      active: true,
      x402support: false,
      metadata: {},
      updatedAt: 0,
    };
    return new Agent({} as unknown as SDK, regFile);
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('throws when agent has no A2A endpoint', async () => {
    const regFile: RegistrationFile = {
      name: 'Test',
      description: 'Test',
      endpoints: [],
      trustModels: [],
      owners: [],
      operators: [],
      active: true,
      x402support: false,
      metadata: {},
      updatedAt: 0,
    };
    const agent = new Agent({} as unknown as SDK, regFile);

    await expect(agent.messageA2A('hello')).rejects.toThrow('Agent has no A2A endpoint');
  });

  it('resolves base URL from agent card URL and delegates to sendMessage', async () => {
    const agentCardUrl = 'https://a2a.example.com/.well-known/agent-card.json';
    const baseUrl = 'https://a2a.example.com';
    const cardBody = {
      supportedInterfaces: [{ url: baseUrl + '/', protocolBinding: 'HTTP+JSON', protocolVersion: '0.3' }],
      name: 'Test Agent',
    };
    const messageBody = {
      message: {
        content: 'OK',
        contextId: 'c1',
      },
    };
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse({ status: 200, body: cardBody }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: messageBody }));

    const agent = makeAgentWithA2A(agentCardUrl);
    const result = await agent.messageA2A('ping');

    expect(fetchSpy).toHaveBeenNthCalledWith(1, agentCardUrl, expect.any(Object));
    expect(fetchSpy).toHaveBeenCalledWith(
      `${baseUrl}/v1/message:send`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'A2A-Version': '0.3' }),
      })
    );
    expect('task' in result).toBe(false);
    expect('x402Required' in result).toBe(false);
    if (!('task' in result) && !('x402Required' in result)) {
      expect(result.content).toBe('OK');
      expect(result.contextId).toBe('c1');
    }
  });

  it('uses endpoint meta version when set', async () => {
    const cardBody = {
      supportedInterfaces: [{ url: 'https://a2a.example.com/', protocolBinding: 'HTTP+JSON', protocolVersion: '0.30' }],
    };
    const body = { message: { content: 'OK' } };
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse({ status: 200, body: cardBody }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body }));

    const agent = makeAgentWithA2A('https://a2a.example.com/card.json', '0.30');
    await agent.messageA2A('hi');

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'A2A-Version': '0.30' }),
      })
    );
  });

  it('listTasks GETs /tasks and returns task array', async () => {
    const cardBody = {
      supportedInterfaces: [{ url: 'https://a2a.example.com/', protocolBinding: 'HTTP+JSON', protocolVersion: '0.3' }],
    };
    const tasksBody = {
      tasks: [{ id: 't1', taskId: 't1', contextId: 'ctx-1', status: { state: 'open' } }],
    };
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse({ status: 200, body: cardBody }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: tasksBody }));

    const agent = makeAgentWithA2A('https://a2a.example.com');
    const result = await agent.listTasks();

    expect(Array.isArray(result)).toBe(true);
    const list = result as import('../src/models/a2a.js').TaskSummary[];
    expect(list).toHaveLength(1);
    expect(list[0].taskId).toBe('t1');
    expect(fetchSpy.mock.calls[1][0]).toContain('https://a2a.example.com/v1/tasks');
  });

  it('loadTask GETs /tasks/:id and returns AgentTask', async () => {
    const cardBody = {
      supportedInterfaces: [{ url: 'https://a2a.example.com/', protocolBinding: 'HTTP+JSON', protocolVersion: '0.3' }],
    };
    const taskBody = {
      id: 'task-xyz',
      taskId: 'task-xyz',
      contextId: 'ctx-99',
      status: { state: 'open' },
    };
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse({ status: 200, body: cardBody }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: taskBody }));

    const agent = makeAgentWithA2A('https://a2a.example.com');
    const task = await agent.loadTask('task-xyz');

    expect('x402Required' in task).toBe(false);
    if (!('x402Required' in task)) {
      expect(task.taskId).toBe('task-xyz');
      expect(task.contextId).toBe('ctx-99');
      expect(typeof task.query).toBe('function');
      expect(typeof task.message).toBe('function');
      expect(typeof task.cancel).toBe('function');
    }
    expect(fetchSpy.mock.calls[1][0]).toBe('https://a2a.example.com/v1/tasks/task-xyz');
  });

  it('when endpoint is base URL (no card path), fetches discovery path .well-known/agent-card.json', async () => {
    const baseUrl = 'https://a2a.example.com';
    const cardBody = {
      supportedInterfaces: [{ url: baseUrl + '/', protocolBinding: 'HTTP+JSON', protocolVersion: '0.3' }],
    };
    const messageBody = { message: { content: 'OK', contextId: 'c1' } };
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse({ status: 200, body: cardBody }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: messageBody }));

    const agent = makeAgentWithA2A(baseUrl);
    await agent.messageA2A('ping');

    expect(fetchSpy).toHaveBeenNthCalledWith(1, `${baseUrl}/.well-known/agent-card.json`, expect.any(Object));
    expect(fetchSpy.mock.calls[1][0]).toContain(baseUrl);
    expect(fetchSpy.mock.calls[1][0]).toContain('message:send');
  });

  it('when discovery agent-card.json returns 404, tries agent.json', async () => {
    const baseUrl = 'https://a2a.example.com';
    const cardBody = {
      supportedInterfaces: [{ url: baseUrl + '/', protocolBinding: 'HTTP+JSON', protocolVersion: '0.3' }],
    };
    const messageBody = { message: { content: 'OK', contextId: 'c1' } };
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse({ status: 404, body: {} }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: cardBody }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: messageBody }));

    const agent = makeAgentWithA2A(baseUrl);
    await agent.messageA2A('ping');

    expect((fetchSpy.mock.calls[0] as any)[0]).toContain('agent-card.json');
    expect((fetchSpy.mock.calls[1] as any)[0]).toContain('agent.json');
    expect((fetchSpy.mock.calls[2] as any)[0]).toContain('message:send');
  });

  it('caches version and tenant from card and uses them for message and listTasks', async () => {
    const baseUrl = 'https://a2a.example.com';
    const cardBody = {
      supportedInterfaces: [
        {
          url: baseUrl + '/',
          protocolBinding: 'HTTP+JSON',
          protocolVersion: '0.31',
          tenant: 'tenant-from-card',
        },
      ],
    };
    const messageBody = { message: { content: 'OK', contextId: 'c1' } };
    const tasksBody = { tasks: [{ id: 't1', taskId: 't1', contextId: 'c1', status: {} }] };
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse({ status: 200, body: cardBody }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: messageBody }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: tasksBody }));

    const agent = makeAgentWithA2A('https://a2a.example.com/.well-known/agent-card.json');
    await agent.messageA2A('hi');
    await agent.listTasks();

    expect((fetchSpy.mock.calls[1] as any)[0]).toContain('/tenants/tenant-from-card/');
    expect((fetchSpy.mock.calls[1] as any)[1].headers['A2A-Version']).toBe('0.31');
    expect((fetchSpy.mock.calls[2] as any)[0]).toContain('/tenants/tenant-from-card/v1/tasks');
  });

  it('setA2aBaseUrlOverride causes message to use override base URL', async () => {
    const cardUrl = 'https://a2a.example.com/.well-known/agent-card.json';
    const cardBody = {
      supportedInterfaces: [{ url: 'https://a2a.example.com/', protocolBinding: 'HTTP+JSON', protocolVersion: '0.3' }],
    };
    const overrideBase = 'https://override.example.com';
    const messageBody = { message: { content: 'OK', contextId: 'c1' } };
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse({ status: 200, body: cardBody }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: messageBody }));

    const agent = makeAgentWithA2A(cardUrl).setA2aBaseUrlOverride(overrideBase);
    await agent.messageA2A('ping');

    expect(fetchSpy).toHaveBeenNthCalledWith(1, cardUrl, expect.any(Object));
    expect((fetchSpy.mock.calls[1] as any)[0]).toMatch(new RegExp(`^${overrideBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  });
});

describe('resolveA2aFromEndpointUrl', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches card URL and returns baseUrl, version, binding, auth from card', async () => {
    const cardUrl = 'https://a2a.example.com/.well-known/agent-card.json';
    const baseUrl = 'https://a2a.example.com';
    const cardBody = {
      supportedInterfaces: [{ url: baseUrl + '/', protocolBinding: 'HTTP+JSON', protocolVersion: '0.3' }],
      securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' } },
      security: [{ apiKey: [] }],
    };
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse({ status: 200, body: cardBody })
    );

    const resolved = await resolveA2aFromEndpointUrl(cardUrl);

    expect(resolved.baseUrl).toBe(baseUrl);
    expect(resolved.a2aVersion).toBe('0.3');
    expect(resolved.binding).toBe('HTTP+JSON');
    expect(resolved.auth?.securitySchemes).toEqual(cardBody.securitySchemes);
    expect(resolved.auth?.security).toEqual(cardBody.security);
  });

  it('throws when URL is not http(s)', async () => {
    await expect(resolveA2aFromEndpointUrl('')).rejects.toThrow('A2A endpoint URL must be http or https');
    await expect(resolveA2aFromEndpointUrl('ftp://x.co/card.json')).rejects.toThrow('A2A endpoint URL must be http or https');
  });
});

describe('createA2AClient / A2AClientFromSummary', () => {
  const mockSdk = { getX402RequestDeps: undefined as undefined | (() => X402RequestDeps) };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('createA2AClient(agent) returns the same agent reference', () => {
    const sdk = new SDK({ chainId: 84532, rpcUrl: 'https://base-sepolia.drpc.org' });
    const regFile: RegistrationFile = {
      name: 'Test',
      description: 'Test',
      endpoints: [{ type: EndpointType.A2A, value: 'https://a2a.example.com/card.json', meta: { version: '0.3' } }],
      trustModels: [],
      owners: [],
      operators: [],
      active: true,
      x402support: false,
      metadata: {},
      updatedAt: 0,
    };
    const agent = new Agent(sdk, regFile);
    const client = sdk.createA2AClient(agent);
    expect(client).toBe(agent);
  });

  it('A2AClientFromSummary fetches card on first messageA2A and delegates to sendMessage', async () => {
    const cardUrl = 'https://a2a.example.com/.well-known/agent-card.json';
    const baseUrl = 'https://a2a.example.com';
    const cardBody = {
      supportedInterfaces: [{ url: baseUrl + '/', protocolBinding: 'HTTP+JSON', protocolVersion: '0.3' }],
    };
    const messageBody = { message: { content: 'OK', contextId: 'c1' } };
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse({ status: 200, body: cardBody }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: messageBody }));

    const summary: AgentSummary = {
      chainId: 84532,
      agentId: '84532:1298',
      name: 'Test Agent',
      description: 'Test',
      a2a: cardUrl,
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
    const client = new A2AClientFromSummary(mockSdk, summary);
    const result = await client.messageA2A('ping');

    expect(fetchSpy).toHaveBeenNthCalledWith(1, cardUrl, expect.any(Object));
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      `${baseUrl}/v1/message:send`,
      expect.objectContaining({ method: 'POST' })
    );
    expect('x402Required' in result).toBe(false);
    if (!('x402Required' in result) && !('task' in result)) {
      expect(result.content).toBe('OK');
      expect(result.contextId).toBe('c1');
    }
  });

  it('A2AClientFromSummary throws when summary has no A2A endpoint', async () => {
    const summary: AgentSummary = {
      chainId: 84532,
      agentId: '84532:1',
      name: 'No A2A',
      description: 'Test',
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
    const client = new A2AClientFromSummary(mockSdk, summary);
    await expect(client.messageA2A('hi')).rejects.toThrow('Agent summary has no A2A endpoint');
  });

  it('createA2AClient(url) returns URL-backed client and resolves on first call', async () => {
    const sdk = new SDK({ chainId: 84532, rpcUrl: 'https://base-sepolia.drpc.org' });
    const baseUrl = 'https://a2a.example.com';
    const cardBody = {
      supportedInterfaces: [{ url: `${baseUrl}/`, protocolBinding: 'HTTP+JSON', protocolVersion: '0.3' }],
    };
    const messageBody = { message: { content: 'OK', contextId: 'c1' } };
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockResponse({ status: 200, body: cardBody }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: messageBody }));

    const client = sdk.createA2AClient(baseUrl);
    expect(client).toBeInstanceOf(A2AClientFromUrl);
    const result = await client.messageA2A('ping');
    expect(fetchSpy).toHaveBeenNthCalledWith(1, `${baseUrl}/.well-known/agent-card.json`, expect.any(Object));
    expect(fetchSpy).toHaveBeenNthCalledWith(2, `${baseUrl}/v1/message:send`, expect.any(Object));
    expect('x402Required' in result).toBe(false);
  });
});
