/**
 * A2A (Agent-to-Agent) types per docs/sdk-messaging-tasks-x402-spec.md §2 and §5.
 */

/** Options for messageA2A (blocking, contextId, taskId; credential and payment in later phases). */
export interface MessageA2AOptions {
  blocking?: boolean;
  contextId?: string;
  taskId?: string;
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
 * No `task` or `taskId`; discriminate from TaskResponse by shape.
 */
export interface MessageResponse {
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
 */
export interface TaskResponse {
  taskId: string;
  contextId: string;
  task: AgentTask;
  /** Optional task snapshot from send response */
  status?: TaskState;
}
