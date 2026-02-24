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
} from '../src/core/a2a-client.js';
import type { X402RequestDeps } from '../src/core/x402-request.js';
import type { RegistrationFile } from '../src/models/interfaces.js';
import { EndpointType, TrustModel } from '../src/models/enums.js';
import { Agent } from '../src/core/agent.js';
import type { SDK } from '../src/core/sdk.js';

function mockResponse(init: { status: number; body?: unknown; ok?: boolean }): Response {
  const bodyStr = init.body !== undefined ? JSON.stringify(init.body) : '';
  const ok = init.ok ?? (init.status >= 200 && init.status < 300);
  return {
    ok,
    status: init.status,
    statusText: ok ? 'OK' : 'Error',
    text: () => Promise.resolve(bodyStr),
    json: () => Promise.resolve(init.body ?? {}),
    headers: new Headers(),
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
  _baseUrl: string,
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
      `${baseUrl}/message:send`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'A2A-Version': a2aVersion, 'Content-Type': 'application/json' }),
      })
    );
    const callBody = JSON.parse((fetchSpy.mock.calls[0] as any)[1].body);
    expect(callBody.message.role).toBe('ROLE_USER');
    expect(callBody.message.parts).toEqual([{ text: 'hello' }]);
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
    expect(callBody.message.parts).toEqual([{ text: 'analyze' }, { url: 'https://example.com' }]);
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
      `${baseUrl}/message:send`,
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
      `${baseUrl}/message:send?api_key=query-secret`,
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
      `${baseUrl}/message:send`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer jwt-token-xyz',
        }),
      })
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
      .mockResolvedValueOnce(mockResponse({ status: 402, body: { accepts } }))
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
      `${baseUrl}/tasks/task-abc?historyLength=10`,
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
      `${baseUrl}/message:send`,
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      })
    );
    const callBody = JSON.parse((fetchSpy.mock.calls[0] as any)[1].body);
    expect(callBody.message.taskId).toBe(taskId);
    expect(callBody.message.contextId).toBe(contextId);
    expect(callBody.message.parts).toEqual([{ text: 'follow up' }]);

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
      `${baseUrl}/tasks/task-abc:cancel`,
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'A2A-Version': a2aVersion }) })
    );
    expect('x402Required' in result).toBe(false);
    if (!('x402Required' in result)) {
      expect(result.taskId).toBe(taskId);
      expect(result.contextId).toBe(contextId);
      expect(result.status).toEqual({ state: 'canceled' });
    }
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
    const body = {
      message: {
        content: 'OK',
        contextId: 'c1',
      },
    };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body }));

    const agent = makeAgentWithA2A(agentCardUrl);
    const result = await agent.messageA2A('ping');

    expect(fetchSpy).toHaveBeenCalledWith(
      `${baseUrl}/message:send`,
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
    const body = { message: { content: 'OK' } };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body }));

    const agent = makeAgentWithA2A('https://a2a.example.com/card.json', '0.30');
    await agent.messageA2A('hi');

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'A2A-Version': '0.30' }),
      })
    );
  });
});
