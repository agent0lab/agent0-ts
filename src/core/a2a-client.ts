/**
 * A2A (Agent-to-Agent) HTTP client: message:send, task query/cancel, response parsing.
 * Used by Agent.messageA2A(); protocol details live here for testability and reuse.
 * When x402Deps is provided, 402 is returned as x402Required + x402Payment.pay() instead of throwing.
 */

import type {
  Part,
  MessageResponse,
  TaskResponse,
  AgentTask,
  MessageA2AOptions,
  TaskState,
  TaskQueryResult,
  TaskCancelResult,
  CredentialObject,
  SecurityScheme,
  AgentCardAuth,
} from '../models/a2a.js';
import { requestWithX402, type X402RequestDeps } from './x402-request.js';
import type { X402RequestResult, X402RequiredResponse } from './x402-types.js';

const ERR_402 = 'A2A server returned 402 Payment Required; x402 handling will be added in a later phase';
const ERR_NEITHER = 'A2A response contained neither task nor message';

/** Result of sendMessage or task.message() when 402 is supported (x402Deps provided). */
export type A2AMessageResult = MessageResponse | TaskResponse | X402RequiredResponse<MessageResponse | TaskResponse>;

export interface A2AAuth {
  headers: Record<string, string>;
  queryParams: Record<string, string>;
}

/**
 * Normalize credential to object; string → { apiKey: string } per spec §2.5.
 */
function normalizeCredential(credential: string | CredentialObject): CredentialObject {
  return typeof credential === 'string' ? { apiKey: credential } : credential;
}

/**
 * Apply credential to request using AgentCard securitySchemes and security (spec §2.5, OpenAPI 3 style).
 * Walks security[] in order and uses the first scheme for which the credential object has a string value (first-match).
 * Credential object keys must match scheme names (e.g. apiKey, bearerAuth). String credential normalizes to { apiKey }.
 * Supported: apiKey (in: header|query|cookie + name), http (bearer → Authorization: Bearer; basic → Authorization: Basic base64(user:password)).
 */
export function applyCredential(
  credential: string | CredentialObject,
  auth: AgentCardAuth
): A2AAuth {
  const out: A2AAuth = { headers: {}, queryParams: {} };
  const obj = normalizeCredential(credential);
  const { securitySchemes = {}, security = [] } = auth;

  for (const entry of security) {
    if (!entry || typeof entry !== 'object') continue;
    const schemeName = Object.keys(entry)[0];
    if (!schemeName) continue;

    const scheme = securitySchemes[schemeName];
    if (!scheme || typeof scheme !== 'object') continue;

    const value = obj[schemeName];
    if (value == null || typeof value !== 'string' || value === '') continue;

    // First scheme with a value: apply it and return
    if (scheme.type === 'apiKey') {
      const { in: where, name } = scheme;
      if (where === 'header') out.headers[name] = value;
      else if (where === 'query') out.queryParams[name] = value;
      else if (where === 'cookie') out.headers['Cookie'] = `${name}=${encodeURIComponent(value)}`;
    } else if (scheme.type === 'http') {
      if (scheme.scheme === 'bearer') {
        out.headers['Authorization'] = `Bearer ${value}`;
      } else if (scheme.scheme === 'basic') {
        const encoded =
          /^[A-Za-z0-9+/]+=*$/.test(value) && !value.includes(':')
            ? value
            : typeof Buffer !== 'undefined'
              ? Buffer.from(value, 'utf8').toString('base64')
              : btoa(unescape(encodeURIComponent(value)));
        out.headers['Authorization'] = `Basic ${encoded}`;
      }
    }
    return out;
  }

  return out;
}

function a2aHeaders(a2aVersion: string, auth?: A2AAuth): Record<string, string> {
  const base = { 'Content-Type': 'application/json', 'A2A-Version': a2aVersion };
  if (!auth?.headers) return base;
  return { ...base, ...auth.headers };
}

function appendQueryParams(url: string, queryParams: Record<string, string>): string {
  if (!queryParams || Object.keys(queryParams).length === 0) return url;
  const sep = url.includes('?') ? '&' : '?';
  const pairs = Object.entries(queryParams).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return `${url}${sep}${pairs.join('&')}`;
}

type CreateTaskHandleFn = (
  baseUrl: string,
  a2aVersion: string,
  taskId: string,
  contextId: string,
  x402Deps?: X402RequestDeps,
  auth?: A2AAuth
) => AgentTask;

/**
 * Parse JSON response from POST /message:send into MessageResponse or TaskResponse.
 */
export function parseMessageSendResponse(
  data: Record<string, unknown>,
  createTaskHandle: CreateTaskHandleFn,
  baseUrl: string,
  a2aVersion: string,
  x402Deps?: X402RequestDeps,
  auth?: A2AAuth
): MessageResponse | TaskResponse {
  if (data.task != null && typeof data.task === 'object') {
    const taskObj = data.task as Record<string, unknown>;
    const taskId = String(taskObj.id ?? taskObj.taskId ?? '');
    const contextId = String(taskObj.contextId ?? '');
    if (!taskId) throw new Error('A2A task response missing task id');
    const task = createTaskHandle(baseUrl, a2aVersion, taskId, contextId, x402Deps, auth);
    return {
      taskId,
      contextId,
      task,
      status: taskObj.status as TaskState | undefined,
    };
  }
  if (data.message != null && typeof data.message === 'object') {
    const msg = data.message as Record<string, unknown>;
    const partsOut = msg.parts as Part[] | undefined;
    return {
      content: typeof msg.content === 'string' ? msg.content : undefined,
      parts: Array.isArray(partsOut) ? partsOut : undefined,
      contextId: typeof msg.contextId === 'string' ? msg.contextId : undefined,
    };
  }
  throw new Error(ERR_NEITHER);
}

/**
 * POST to /message:send, handle 402/!ok, parse JSON into MessageResponse | TaskResponse.
 * Used when x402Deps is not provided (402 throws).
 */
export async function postAndParseMessageSend(
  baseUrl: string,
  a2aVersion: string,
  body: Record<string, unknown>,
  createTaskHandle: CreateTaskHandleFn,
  auth?: A2AAuth
): Promise<MessageResponse | TaskResponse> {
  const url = appendQueryParams(`${baseUrl}/message:send`, auth?.queryParams ?? {});
  const res = await fetch(url, {
    method: 'POST',
    headers: a2aHeaders(a2aVersion, auth),
    body: JSON.stringify(body),
  });
  if (res.status === 402) throw new Error(ERR_402);
  if (!res.ok) throw new Error(`A2A request failed: HTTP ${res.status} ${res.statusText}`);
  const data = (await res.json()) as Record<string, unknown>;
  return parseMessageSendResponse(data, createTaskHandle, baseUrl, a2aVersion, undefined, auth);
}

/**
 * Build an AgentTask handle that can query, message, and cancel.
 * When x402Deps is provided, task methods use requestWithX402 and may return 402 + pay().
 */
export function createTaskHandle(
  baseUrl: string,
  a2aVersion: string,
  taskId: string,
  contextId: string,
  x402Deps?: X402RequestDeps,
  auth?: A2AAuth
): AgentTask {
  const headers = () => a2aHeaders(a2aVersion, auth);
  const createTask = (b: string, v: string, tid: string, cid: string) =>
    createTaskHandle(b, v, tid, cid, x402Deps, auth);

  const task: AgentTask = {
    taskId,
    contextId,
    async query(options?: { historyLength?: number }) {
      const params = new URLSearchParams();
      if (options?.historyLength !== undefined) params.set('historyLength', String(options.historyLength));
      const q = params.toString();
      let url = `${baseUrl}/tasks/${encodeURIComponent(taskId)}${q ? `?${q}` : ''}`;
      url = appendQueryParams(url, auth?.queryParams ?? {});
      if (x402Deps) {
        const result = await requestWithX402<TaskQueryResult>(
          {
            url,
            method: 'GET',
            headers: headers(),
            parseResponse: async (res) => {
              if (!res.ok) throw new Error(`Get task failed: HTTP ${res.status}`);
              const data = (await res.json()) as Record<string, unknown>;
              return {
                taskId: String(data.id ?? data.taskId ?? taskId),
                contextId: String(data.contextId ?? contextId),
                status: data.status as TaskState | undefined,
                artifacts: data.artifacts as unknown[] | undefined,
                messages: data.messages as unknown[] | undefined,
              };
            },
          },
          x402Deps
        );
        return result;
      }
      const res = await fetch(url, { method: 'GET', headers: headers() });
      if (!res.ok) throw new Error(`Get task failed: HTTP ${res.status}`);
      const data = (await res.json()) as Record<string, unknown>;
      return {
        taskId: String(data.id ?? data.taskId ?? taskId),
        contextId: String(data.contextId ?? contextId),
        status: data.status as TaskState | undefined,
        artifacts: data.artifacts as unknown[] | undefined,
        messages: data.messages as unknown[] | undefined,
      };
    },
    async message(content: string | { parts: Part[] }) {
      const parts: Part[] =
        typeof content === 'string' ? [{ text: content }] : Array.isArray(content.parts) ? content.parts : [];
      const message: Record<string, unknown> = {
        role: 'ROLE_USER',
        parts,
        taskId,
        contextId,
        messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      };
      const body = { message };
      if (x402Deps) {
        const messageSendUrl = appendQueryParams(`${baseUrl}/message:send`, auth?.queryParams ?? {});
        const result = await requestWithX402<MessageResponse | TaskResponse>(
          {
            url: messageSendUrl,
            method: 'POST',
            headers: headers(),
            body: JSON.stringify(body),
            parseResponse: async (res) => {
              if (!res.ok) throw new Error(`A2A message failed: HTTP ${res.status}`);
              const data = (await res.json()) as Record<string, unknown>;
              return parseMessageSendResponse(data, createTask, baseUrl, a2aVersion, x402Deps, auth);
            },
          },
          x402Deps
        );
        return result;
      }
      return postAndParseMessageSend(baseUrl, a2aVersion, body, createTask, auth);
    },
    async cancel() {
      let url = `${baseUrl}/tasks/${encodeURIComponent(taskId)}:cancel`;
      url = appendQueryParams(url, auth?.queryParams ?? {});
      if (x402Deps) {
        const result = await requestWithX402<TaskCancelResult>(
          {
            url,
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({}),
            parseResponse: async (res) => {
              if (!res.ok) throw new Error(`Cancel task failed: HTTP ${res.status}`);
              const data = (await res.json()) as Record<string, unknown>;
              return {
                taskId: String(data.id ?? data.taskId ?? taskId),
                contextId: String(data.contextId ?? contextId),
                status: data.status as TaskState | undefined,
              };
            },
          },
          x402Deps
        );
        return result;
      }
      const res = await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify({}) });
      if (!res.ok) throw new Error(`Cancel task failed: HTTP ${res.status}`);
      const data = (await res.json()) as Record<string, unknown>;
      return {
        taskId: String(data.id ?? data.taskId ?? taskId),
        contextId: String(data.contextId ?? contextId),
        status: data.status as TaskState | undefined,
      };
    },
  };
  return task;
}

export interface SendMessageParams {
  baseUrl: string;
  a2aVersion: string;
  content: string | { parts: Part[] };
  options?: MessageA2AOptions;
  /** From AgentCard: where and how to send credential (per §2.5). */
  auth?: AgentCardAuth;
}

/**
 * Send a message to the A2A endpoint. Returns MessageResponse or TaskResponse per spec §2.1.
 * When x402Deps is provided, 402 is returned as x402Required + x402Payment.pay() instead of throwing.
 */
export async function sendMessage(
  params: SendMessageParams,
  x402Deps?: X402RequestDeps
): Promise<MessageResponse | TaskResponse | X402RequiredResponse<MessageResponse | TaskResponse>> {
  const { baseUrl, a2aVersion, content, options, auth: cardAuth } = params;
  const resolvedAuth =
    options?.credential != null && cardAuth
      ? applyCredential(options.credential, cardAuth)
      : undefined;

  const parts: Part[] =
    typeof content === 'string'
      ? [{ text: content }]
      : Array.isArray(content.parts)
        ? content.parts
        : [];

  const message: Record<string, unknown> = {
    role: 'ROLE_USER',
    parts,
    messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
  };
  if (options?.contextId) message.contextId = options.contextId;
  if (options?.taskId) message.taskId = options.taskId;

  const body: Record<string, unknown> = { message };
  if (options?.blocking !== undefined) {
    body.configuration = { blocking: options.blocking };
  }

  if (x402Deps) {
    const createTask = (b: string, v: string, tid: string, cid: string) =>
      createTaskHandle(b, v, tid, cid, x402Deps, resolvedAuth);
    const messageSendUrl = appendQueryParams(`${baseUrl}/message:send`, resolvedAuth?.queryParams ?? {});
    const result = await requestWithX402<MessageResponse | TaskResponse>(
      {
        url: messageSendUrl,
        method: 'POST',
        headers: a2aHeaders(a2aVersion, resolvedAuth),
        body: JSON.stringify(body),
        parseResponse: async (res) => {
          if (!res.ok) throw new Error(`A2A request failed: HTTP ${res.status} ${res.statusText}`);
          const data = (await res.json()) as Record<string, unknown>;
          return parseMessageSendResponse(data, createTask, baseUrl, a2aVersion, x402Deps, resolvedAuth);
        },
      },
      x402Deps
    );
    return result;
  }

  return postAndParseMessageSend(
    baseUrl,
    a2aVersion,
    body,
    (b, v, tid, cid) => createTaskHandle(b, v, tid, cid, undefined, resolvedAuth),
    resolvedAuth
  );
}
