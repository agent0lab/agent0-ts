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
  TaskSummary,
  ListTasksOptions,
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

/** Normalized A2A interface from agent card (v1 supportedInterfaces or 0.3 url + additionalInterfaces). */
export type NormalizedInterface = {
  url: string;
  binding: 'HTTP+JSON' | 'JSONRPC' | 'GRPC' | 'AUTO';
  version: string | undefined;
  tenant?: string;
};

const PREFERRED_BINDINGS: NormalizedInterface['binding'][] = ['HTTP+JSON', 'JSONRPC', 'GRPC', 'AUTO'];

function normalizeBinding(raw: unknown): NormalizedInterface['binding'] {
  const s = typeof raw === 'string' ? String(raw).trim().toUpperCase().replace(/-/g, '') : '';
  if (s === 'HTTP+JSON' || s === 'JSONRPC' || s === 'GRPC') return s as NormalizedInterface['binding'];
  return 'AUTO';
}

/**
 * Normalize agent card (v1 or 0.3 style) to a list of interfaces. Doc §6.1.
 */
export function normalizeInterfaces(card: Record<string, unknown> | null | undefined): NormalizedInterface[] {
  const result: NormalizedInterface[] = [];
  if (!card || typeof card !== 'object') return result;

  if (Array.isArray(card.supportedInterfaces) && card.supportedInterfaces.length > 0) {
    for (const i of card.supportedInterfaces as Record<string, unknown>[]) {
      const url = typeof i?.url === 'string' ? i.url.trim() : '';
      if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) continue;
      result.push({
        url: url.replace(/\/+$/, ''),
        binding: normalizeBinding(i.protocolBinding ?? i.protocol),
        version: typeof i.protocolVersion === 'string' ? i.protocolVersion : undefined,
        tenant: typeof i.tenant === 'string' ? i.tenant : undefined,
      });
    }
    return result;
  }

  const primaryBinding = normalizeBinding(card.preferredTransport);
  if (typeof card.url === 'string' && (card.url.startsWith('http://') || card.url.startsWith('https://'))) {
    result.push({
      url: (card.url as string).trim().replace(/\/+$/, ''),
      binding: primaryBinding,
      version: typeof card.protocolVersion === 'string' ? card.protocolVersion : undefined,
    });
  }
  if (Array.isArray(card.additionalInterfaces)) {
    for (const i of card.additionalInterfaces as Record<string, unknown>[]) {
      const url = typeof i?.url === 'string' ? i.url.trim() : '';
      if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) continue;
      result.push({
        url: url.replace(/\/+$/, ''),
        binding: normalizeBinding(i.transport ?? i.protocolBinding),
        version: typeof i.protocolVersion === 'string' ? i.protocolVersion : undefined,
        tenant: typeof i.tenant === 'string' ? i.tenant : undefined,
      });
    }
  }
  return result;
}

/**
 * Pick the best interface from the list that the client supports. Prefers HTTP+JSON then JSON-RPC. Doc §6.1.
 * AUTO is always allowed so interfaces with no protocolBinding are picked and sendMessage will try both bindings.
 */
export function pickInterface(
  interfaces: NormalizedInterface[],
  preferredBindings: readonly NormalizedInterface['binding'][]
): NormalizedInterface | null {
  const base = preferredBindings.length > 0 ? preferredBindings : PREFERRED_BINDINGS;
  const allowed = new Set([...base, 'AUTO']);
  const supported = interfaces.filter((i) => allowed.has(i.binding));
  if (supported.length === 0) return null;
  const order: NormalizedInterface['binding'] = 'AUTO';
  return supported.sort((a, b) => {
    const v = (b.version ?? '').localeCompare(a.version ?? '');
    if (v !== 0) return v;
    return (a.binding === order ? 1 : 0) - (b.binding === order ? 1 : 0);
  })[0] ?? null;
}

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
  auth?: A2AAuth,
  tenant?: string
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
 * Path order for SendMessage by protocol version. Returns path suffixes (with optional tenant prefix) to try in order.
 */
function getMessageSendPathsToTry(a2aVersion: string, tenant?: string): string[] {
  const v = (a2aVersion ?? '').trim();
  const tenantPrefix = tenant ? `/tenants/${encodeURIComponent(tenant)}` : '';
  const first = v.startsWith('0.') ? '/v1/message:send' : '/message:send';
  const second = v.startsWith('0.') ? '/message:send' : '/v1/message:send';
  return [tenantPrefix + first, tenantPrefix + second];
}

/** Build path suffix for an operation (version + optional tenant prefix). Doc §5.1, §6.2.1. */
function buildPathSuffix(
  operation: 'message:send' | 'message:stream' | 'tasks' | 'task' | 'taskCancel' | 'taskSubscribe',
  a2aVersion: string,
  tenant?: string,
  taskId?: string
): string {
  const v = (a2aVersion ?? '').trim();
  const useV1Prefix = v.startsWith('0.');
  const tenantPrefix = tenant ? `/tenants/${encodeURIComponent(tenant)}` : '';
  switch (operation) {
    case 'message:send':
      return tenantPrefix + (useV1Prefix ? '/v1/message:send' : '/message:send');
    case 'message:stream':
      return tenantPrefix + (useV1Prefix ? '/v1/message:stream' : '/message:stream');
    case 'tasks':
      return tenantPrefix + (useV1Prefix ? '/v1/tasks' : '/tasks');
    case 'task':
      return tenantPrefix + (useV1Prefix ? '/v1/tasks/' : '/tasks/') + encodeURIComponent(taskId ?? '');
    case 'taskCancel':
      return tenantPrefix + (useV1Prefix ? '/v1/tasks/' : '/tasks/') + encodeURIComponent(taskId ?? '') + ':cancel';
    case 'taskSubscribe':
      return tenantPrefix + (useV1Prefix ? '/v1/tasks/' : '/tasks/') + encodeURIComponent(taskId ?? '') + ':subscribe';
    default:
      return tenantPrefix + '/message:send';
  }
}

/**
 * Parse response body as JSON; on failure (e.g. HTML) throw a clear error.
 */
async function parseJsonResponse(res: Response, url: string): Promise<Record<string, unknown>> {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) {
    const hint = trimmed.startsWith('<') ? ' (server may have returned HTML or wrong URL)' : '';
    throw new Error(`A2A server returned non-JSON body${hint}. URL: ${url}`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`A2A server returned invalid JSON: ${msg}. URL: ${url}`);
  }
}

/**
 * POST to /message:send, handle 402/!ok, parse JSON into MessageResponse | TaskResponse.
 * Path order from version (+ optional tenant). On 404 try next path once.
 */
export async function postAndParseMessageSend(
  baseUrl: string,
  a2aVersion: string,
  body: Record<string, unknown>,
  createTaskHandle: CreateTaskHandleFn,
  auth?: A2AAuth,
  tenant?: string
): Promise<MessageResponse | TaskResponse> {
  const base = baseUrl.replace(/\/+$/, '');
  const pathsToTry = getMessageSendPathsToTry(a2aVersion, tenant);
  let lastRes: Response | null = null;
  let lastUrl = '';

  for (const path of pathsToTry) {
    const url = appendQueryParams(`${base}${path}`, auth?.queryParams ?? {});
    const res = await fetch(url, {
      method: 'POST',
      headers: a2aHeaders(a2aVersion, auth),
      body: JSON.stringify(body),
    });
    lastRes = res;
    lastUrl = url;
    if (res.status === 402) throw new Error(ERR_402);
    if (res.ok) {
      const data = await parseJsonResponse(res, url);
      return parseMessageSendResponse(data, createTaskHandle, baseUrl, a2aVersion, undefined, auth);
    }
    if (res.status !== 404) break;
  }

  throw new Error(
    `A2A request failed: HTTP ${lastRes?.status ?? 'error'} ${lastRes?.statusText ?? ''}${lastUrl ? ` (${lastUrl})` : ''}`
  );
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
  auth?: A2AAuth,
  tenant?: string
): AgentTask {
  const base = baseUrl.replace(/\/+$/, '');
  const headers = () => a2aHeaders(a2aVersion, auth);
  const createTask = (b: string, v: string, tid: string, cid: string) =>
    createTaskHandle(b, v, tid, cid, x402Deps, auth, tenant);

  const task: AgentTask = {
    taskId,
    contextId,
    async query(options?: { historyLength?: number }) {
      const params = new URLSearchParams();
      if (options?.historyLength !== undefined) params.set('historyLength', String(options.historyLength));
      const q = params.toString();
      const path = buildPathSuffix('task', a2aVersion, tenant, taskId) + (q ? `?${q}` : '');
      let url = appendQueryParams(`${base}${path}`, auth?.queryParams ?? {});
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
        const paths = getMessageSendPathsToTry(a2aVersion, tenant);
        const pathsToTry = paths.map((p) => appendQueryParams(`${base}${p}`, auth?.queryParams ?? {}));
        const messageSendUrl = pathsToTry[0]!;
        const result = await requestWithX402<MessageResponse | TaskResponse>(
          {
            url: messageSendUrl,
            method: 'POST',
            headers: headers(),
            body: JSON.stringify(body),
            alternateUrls: pathsToTry.slice(1),
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
      return postAndParseMessageSend(baseUrl, a2aVersion, body, createTask, auth, tenant);
    },
    async cancel() {
      const path = buildPathSuffix('taskCancel', a2aVersion, tenant, taskId);
      let url = appendQueryParams(`${base}${path}`, auth?.queryParams ?? {});
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

export interface ListTasksParams {
  baseUrl: string;
  a2aVersion: string;
  options?: ListTasksOptions;
  auth?: AgentCardAuth;
  /** Optional tenant from agent card for path prefix (e.g. /tenants/{tenant}/tasks). */
  tenant?: string;
}

const DEFAULT_PAGE_SIZE = 100;

function toTaskSummary(raw: Record<string, unknown>): TaskSummary {
  const taskId = String(raw.id ?? raw.taskId ?? '');
  const contextId = String(raw.contextId ?? '');
  return {
    taskId,
    contextId,
    status: raw.status as TaskState | undefined,
    messages: raw.messages as unknown[] | undefined,
    ...raw,
  };
}

/**
 * Fetch a single task by ID (GET /tasks/:id). Used by loadTask to get contextId and build AgentTask.
 * When x402Deps provided, 402 returns x402Required + pay() instead of throwing.
 * Optional payment sends with first request (spec §4.2).
 */
export async function getTask(
  baseUrl: string,
  a2aVersion: string,
  taskId: string,
  auth?: A2AAuth,
  x402Deps?: X402RequestDeps,
  payment?: string,
  tenant?: string
): Promise<TaskSummary | X402RequiredResponse<TaskSummary>> {
  const base = baseUrl.replace(/\/+$/, '');
  const path = buildPathSuffix('task', a2aVersion, tenant, taskId);
  const url = appendQueryParams(`${base}${path}`, auth?.queryParams ?? {});
  if (x402Deps) {
    const result = await requestWithX402<TaskSummary>(
      {
        url,
        method: 'GET',
        headers: a2aHeaders(a2aVersion, auth),
        payment,
        parseResponse: async (res) => {
          if (!res.ok) throw new Error(`Get task failed: HTTP ${res.status} ${res.statusText}`);
          const data = (await res.json()) as Record<string, unknown>;
          return toTaskSummary(data);
        },
      },
      x402Deps
    );
    return result as TaskSummary | X402RequiredResponse<TaskSummary>;
  }
  const res = await fetch(url, { method: 'GET', headers: a2aHeaders(a2aVersion, auth) });
  if (res.status === 402) throw new Error(ERR_402);
  if (!res.ok) throw new Error(`Get task failed: HTTP ${res.status} ${res.statusText}`);
  const data = (await res.json()) as Record<string, unknown>;
  return toTaskSummary(data);
}

/**
 * List tasks (GET /tasks with optional filter, historyLength). Fetches all pages internally.
 * When x402Deps provided, 402 on the first request returns x402Required + pay().
 */
export async function listTasks(
  params: ListTasksParams,
  x402Deps?: X402RequestDeps
): Promise<TaskSummary[] | X402RequiredResponse<TaskSummary[]>> {
  const { baseUrl, a2aVersion, options, auth: cardAuth, tenant } = params;
  const resolvedAuth =
    options?.credential != null && cardAuth ? applyCredential(options.credential, cardAuth) : undefined;

  const base = baseUrl.replace(/\/+$/, '');
  const tasksPath = buildPathSuffix('tasks', a2aVersion, tenant);

  const buildListUrl = (token?: string) => {
    const q = new URLSearchParams();
    if (options?.filter?.contextId) q.set('contextId', options.filter.contextId);
    if (options?.filter?.status) q.set('status', options.filter.status);
    if (options?.historyLength !== undefined) q.set('historyLength', String(options.historyLength));
    q.set('pageSize', String(DEFAULT_PAGE_SIZE));
    if (token) q.set('pageToken', token);
    const url = `${base}${tasksPath}?${q.toString()}`;
    return appendQueryParams(url, resolvedAuth?.queryParams ?? {});
  };

  const parseListPage = (data: Record<string, unknown>) => {
    const tasks = (data.tasks ?? data.items ?? data.results ?? []) as Record<string, unknown>[];
    const nextToken = (data.nextPageToken ?? data.pageToken ?? data.nextPage) as string | undefined;
    return { tasks: tasks.map((t) => toTaskSummary(t)), nextPageToken: nextToken };
  };

  const fetchOnePage = async (url: string): Promise<{ tasks: TaskSummary[]; nextPageToken?: string }> => {
    const res = await fetch(url, { method: 'GET', headers: a2aHeaders(a2aVersion, resolvedAuth) });
    if (res.status === 402) throw new Error(ERR_402);
    if (!res.ok) throw new Error(`List tasks failed: HTTP ${res.status} ${res.statusText}`);
    const data = (await res.json()) as Record<string, unknown>;
    return parseListPage(data);
  };

  if (x402Deps) {
    const result = await requestWithX402<TaskSummary[]>(
      {
        url: buildListUrl(),
        method: 'GET',
        headers: a2aHeaders(a2aVersion, resolvedAuth),
        payment: options?.payment,
        parseResponse: async (res) => {
          if (!res.ok) throw new Error(`List tasks failed: HTTP ${res.status} ${res.statusText}`);
          const data = (await res.json()) as Record<string, unknown>;
          const { tasks: firstTasks, nextPageToken: firstNext } = parseListPage(data);
          const merged = [...firstTasks];
          let token = firstNext;
          while (token) {
            const url = buildListUrl(token);
            const page = await fetchOnePage(url);
            merged.push(...page.tasks);
            token = page.nextPageToken;
          }
          return merged;
        },
      },
      x402Deps
    );
    if ('x402Required' in result && result.x402Required) {
      return result as X402RequiredResponse<TaskSummary[]>;
    }
    return result as TaskSummary[];
  }

  const allTasks: TaskSummary[] = [];
  let pageToken: string | undefined;
  do {
    const url = buildListUrl(pageToken);
    const page = await fetchOnePage(url);
    allTasks.push(...page.tasks);
    pageToken = page.nextPageToken;
  } while (pageToken);

  return allTasks;
}

export interface SendMessageParams {
  baseUrl: string;
  a2aVersion: string;
  content: string | { parts: Part[] };
  options?: MessageA2AOptions;
  /** From AgentCard: where and how to send credential (per §2.5). */
  auth?: AgentCardAuth;
  /** Optional tenant from agent card for path prefix. */
  tenant?: string;
  /** When JSONRPC, use JSON-RPC binding; when AUTO (or unspecified in card), try HTTP+JSON then JSON-RPC. */
  binding?: 'HTTP+JSON' | 'JSONRPC' | 'GRPC' | 'AUTO';
}

/** JSON-RPC method names by version; doc §4.4. v1: SendMessage + fallback message/send; 0.3: message/send + fallback SendMessage. */
function getJsonRpcSendMessageMethods(a2aVersion: string): { primary: string; fallback: string } {
  const v = (a2aVersion ?? '').trim();
  if (v.startsWith('1.')) return { primary: 'SendMessage', fallback: 'message/send' };
  return { primary: 'message/send', fallback: 'SendMessage' };
}

/**
 * Send message via JSON-RPC binding. POST to baseUrl with JSON-RPC 2.0; try primary method, on Method not found retry fallback. Doc §4.
 */
async function sendMessageJsonRpc(
  params: {
    baseUrl: string;
    a2aVersion: string;
    body: Record<string, unknown>;
    resolvedAuth?: A2AAuth;
    tenant?: string;
  },
  createTaskHandle: CreateTaskHandleFn,
  _x402Deps?: X402RequestDeps
): Promise<MessageResponse | TaskResponse> {
  const { baseUrl, a2aVersion, body, resolvedAuth } = params;
  const url = appendQueryParams(baseUrl.replace(/\/+$/, ''), resolvedAuth?.queryParams ?? {});
  const { primary, fallback } = getJsonRpcSendMessageMethods(a2aVersion);
  const v = (a2aVersion ?? '').trim();
  const isV1 = v.startsWith('1.');

  const makeRequest = (method: string) => {
    const paramsPayload = isV1 && method === 'SendMessage'
      ? { request: { message: body.message, configuration: body.configuration ?? { blocking: false } } }
      : { message: body.message };
    return {
      jsonrpc: '2.0' as const,
      id: `a2a-${Date.now()}`,
      method,
      params: paramsPayload,
    };
  };

  const tryMethod = async (method: string): Promise<MessageResponse | TaskResponse | null> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: a2aHeaders(a2aVersion, resolvedAuth),
      body: JSON.stringify(makeRequest(method)),
    });
    if (res.status === 402) throw new Error(ERR_402);
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    if (data.error != null && typeof data.error === 'object') {
      const err = data.error as Record<string, unknown>;
      const code = err.code;
      const msg = (err.message ?? '').toString().toLowerCase();
      if (code === -32601 || msg.includes('method not found')) return null;
      throw new Error(`A2A JSON-RPC error: ${err.message ?? code}`);
    }
    const result = data.result;
    if (result != null && typeof result === 'object') {
      return parseMessageSendResponse(
        result as Record<string, unknown>,
        createTaskHandle,
        baseUrl,
        a2aVersion,
        undefined,
        resolvedAuth
      );
    }
    throw new Error(ERR_NEITHER);
  };

  const first = await tryMethod(primary);
  if (first !== null) return first;
  const second = await tryMethod(fallback);
  if (second !== null) return second;
  throw new Error(`A2A JSON-RPC failed: ${primary} and ${fallback} not supported`);
}

/** True when the error suggests the wrong protocol binding (e.g. 404/405 or method not found). Used to retry with other binding when binding is AUTO. */
function isBindingMismatchError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  const lower = msg.toLowerCase();
  if (lower.includes('402') || lower.includes('payment')) return false;
  if (lower.includes('404') || lower.includes('405')) return true;
  if (lower.includes('a2a request failed') || lower.includes('method not found') || lower.includes('not supported')) return true;
  return false;
}

/**
 * Send a message to the A2A endpoint. Returns MessageResponse or TaskResponse per spec §2.1.
 * When x402Deps is provided, 402 is returned as x402Required + x402Payment.pay() instead of throwing.
 * When binding is AUTO (card did not declare protocolBinding), tries HTTP+JSON first, then JSON-RPC on binding mismatch.
 */
export async function sendMessage(
  params: SendMessageParams,
  x402Deps?: X402RequestDeps
): Promise<MessageResponse | TaskResponse | X402RequiredResponse<MessageResponse | TaskResponse>> {
  const { baseUrl, a2aVersion, content, options, auth: cardAuth, tenant, binding } = params;
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

  const createTaskWithTenant = (b: string, v: string, tid: string, cid: string) =>
    createTaskHandle(b, v, tid, cid, x402Deps, resolvedAuth, tenant);
  const createTaskNoX402 = (b: string, v: string, tid: string, cid: string) =>
    createTaskHandle(b, v, tid, cid, undefined, resolvedAuth, tenant);

  const tryHttpJson = async (): Promise<MessageResponse | TaskResponse | X402RequiredResponse<MessageResponse | TaskResponse>> => {
    if (x402Deps) {
      const createTask = (b: string, v: string, tid: string, cid: string) =>
        createTaskHandle(b, v, tid, cid, x402Deps, resolvedAuth, tenant);
      const base = baseUrl.replace(/\/+$/, '');
      const pathOrder = getMessageSendPathsToTry(a2aVersion, tenant);
      const pathsToTry = pathOrder.map((p) => appendQueryParams(`${base}${p}`, resolvedAuth?.queryParams ?? {}));
      let lastErr: Error | null = null;
      for (const messageSendUrl of pathsToTry) {
        try {
          return await requestWithX402<MessageResponse | TaskResponse>(
            {
              url: messageSendUrl,
              method: 'POST',
              headers: a2aHeaders(a2aVersion, resolvedAuth),
              body: JSON.stringify(body),
              payment: options?.payment,
              alternateUrls: pathsToTry.filter((u) => u !== messageSendUrl),
              parseResponse: async (res) => {
                if (!res.ok) throw new Error(`A2A request failed: HTTP ${res.status} ${res.statusText}`);
                const data = await parseJsonResponse(res, messageSendUrl);
                return parseMessageSendResponse(data, createTask, baseUrl, a2aVersion, x402Deps, resolvedAuth);
              },
            },
            x402Deps
          );
        } catch (e) {
          lastErr = e instanceof Error ? e : new Error(String(e));
          if (lastErr.message.includes('404') && messageSendUrl === pathsToTry[0]) continue;
          throw lastErr;
        }
      }
      throw lastErr ?? new Error('A2A request failed');
    }
    return postAndParseMessageSend(baseUrl, a2aVersion, body, createTaskNoX402, resolvedAuth, tenant);
  };

  if (binding === 'AUTO') {
    try {
      return await tryHttpJson();
    } catch (e) {
      if (!isBindingMismatchError(e)) throw e;
      return sendMessageJsonRpc(
        { baseUrl, a2aVersion, body, resolvedAuth, tenant },
        x402Deps ? createTaskWithTenant : createTaskNoX402,
        x402Deps
      );
    }
  }

  if (x402Deps && binding === 'JSONRPC') {
    return sendMessageJsonRpc(
      { baseUrl, a2aVersion, body, resolvedAuth, tenant },
      createTaskWithTenant,
      x402Deps
    );
  }

  if (x402Deps) {
    return tryHttpJson();
  }

  if (binding === 'JSONRPC') {
    return sendMessageJsonRpc(
      { baseUrl, a2aVersion, body, resolvedAuth, tenant },
      createTaskNoX402,
      x402Deps
    );
  }

  return postAndParseMessageSend(
    baseUrl,
    a2aVersion,
    body,
    createTaskNoX402,
    resolvedAuth,
    tenant
  );
}
