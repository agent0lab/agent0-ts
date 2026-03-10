/**
 * A2A (Agent-to-Agent) types.
 */

/** Credential as object; string is normalized to { apiKey: string }. */
export interface CredentialObject {
  apiKey?: string;
  bearer?: string;
  [key: string]: unknown;
}

/** Options for messageA2A (blocking, contextId, taskId, credential, payment per §2.1, §4.2). */
export interface MessageA2AOptions {
  blocking?: boolean;
  contextId?: string;
  taskId?: string;
  /** When the agent's endpoint requires auth: string (→ apiKey) or object (e.g. { apiKey } or { bearer }). */
  credential?: string | CredentialObject;
  /** Optional payment payload (e.g. base64 PAYMENT-SIGNATURE) to send with the first request; if server accepts, 2xx and no 402. */
  payment?: string;
}

/** OpenAPI-style apiKey scheme: where to send the value and under what name. */
export interface SecuritySchemeApiKey {
  type: 'apiKey';
  in: 'header' | 'query' | 'cookie';
  name: string;
  description?: string;
}

/** OpenAPI-style http (Bearer) scheme. */
export interface SecuritySchemeHttp {
  type: 'http';
  scheme: 'bearer' | 'basic';
  bearerFormat?: string;
  description?: string;
}

/** Supported A2A security scheme types (per spec §2.5). */
export type SecurityScheme = SecuritySchemeApiKey | SecuritySchemeHttp;

/** AgentCard auth shape: securitySchemes and which are required. */
export interface AgentCardAuth {
  securitySchemes?: Record<string, SecurityScheme>;
  security?: Array<Record<string, string[]>>;
}

/**
 * Part: smallest unit of content in a Message or Artifact.
 * Per A2A Protocol: text, url, data, or raw.
 */
export interface Part {
  text?: string;
  url?: string;
  data?: string;
  raw?: string;
  [key: string]: unknown;
}

/**
 * Direct message response from an A2A server (no task created).
 * No `task` or `taskId`; discriminate from TaskResponse by 'task' in msg.
 * Has x402Required?: false so you can use if (result.x402Required) to detect 402.
 */
export interface MessageResponse {
  x402Required?: false;
  content?: string;
  parts?: Part[];
  contextId?: string;
}

/**
 * Task state returned by task.query() or after cancel.
 * Server-specific status values; common: open, working, completed, failed, canceled, rejected.
 */
export interface TaskState {
  state?: string;
  [key: string]: unknown;
}

/**
 * When an A2A request returns HTTP 402. Caller may call x402Payment.pay() to pay and retry.
 * Compatible with X402RequiredResponse from core/x402-types (used by a2a-client).
 */
export interface A2APaymentRequired<T = unknown> {
  x402Required: true;
  x402Payment: {
    pay(accept?: unknown): Promise<T>;
    accepts: unknown[];
    price?: string;
    token?: string;
    network?: string;
  };
}

/** Result of task.query(): state or 402. */
export type TaskQueryResult = { taskId: string; contextId: string; status?: TaskState; artifacts?: unknown[]; messages?: unknown[] };

/** Result of task.cancel(): state or 402. */
export type TaskCancelResult = { taskId: string; contextId: string; status?: TaskState };

/** Summary of a task returned by listTasks. */
export interface TaskSummary {
  x402Required?: false;
  taskId: string;
  contextId: string;
  status?: TaskState;
  /** Optional message history when historyLength > 0. */
  messages?: unknown[];
  [key: string]: unknown;
}

/** Options for listTasks (filter, historyLength, credential, payment per §2.3, §4.2). */
export interface ListTasksOptions {
  filter?: { contextId?: string; status?: string; [key: string]: unknown };
  historyLength?: number;
  credential?: string | CredentialObject;
  /** Optional payment payload to send with the first request; if server accepts, 2xx and no 402. */
  payment?: string;
}

/**
 * Task handle: read-only taskId, contextId, and methods query, message, cancel.
 * Returned by response.task and by agent.loadTask(taskId).
 * Methods may return 402 (A2APaymentRequired); use pay() to retry.
 */
export interface AgentTask {
  readonly taskId: string;
  readonly contextId: string;
  query(options?: { historyLength?: number }): Promise<TaskQueryResult | A2APaymentRequired<TaskQueryResult>>;
  message(content: string | { parts: Part[] }): Promise<MessageResponse | TaskResponse | A2APaymentRequired<MessageResponse | TaskResponse>>;
  cancel(): Promise<TaskCancelResult | A2APaymentRequired<TaskCancelResult>>;
}

/**
 * Response when the server created a task.
 * Discriminate from MessageResponse by 'task' in response.
 * Has x402Required?: false so you can use if (result.x402Required) to detect 402.
 */
export interface TaskResponse {
  x402Required?: false;
  taskId: string;
  contextId: string;
  task: AgentTask;
  /** Optional task snapshot from send response */
  status?: TaskState;
}
