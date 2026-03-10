/**
 * A2A client backed by an AgentSummary. Resolves the A2A interface from summary.a2a (agent card)
 * and exposes messageA2A, listTasks, loadTask with the same signatures as Agent.
 */

import type { AgentSummary } from '../models/interfaces.js';
import type {
  MessageResponse,
  TaskResponse,
  TaskSummary,
  AgentTask,
  MessageA2AOptions,
  ListTasksOptions,
  LoadTaskOptions,
  A2APaymentRequired,
  A2AClient,
} from '../models/a2a.js';
import type { X402RequestDeps } from './x402-request.js';
import {
  resolveA2aFromEndpointUrl,
  sendMessage,
  listTasks,
  getTask,
  createTaskHandle,
  applyCredential,
} from './a2a-client.js';
import type { ResolvedA2A } from './a2a-client.js';
import type { X402Accept } from './x402-types.js';

/** Minimal SDK surface needed for A2A (avoids circular dependency on SDK). */
export interface SDKLike {
  getX402RequestDeps?(): X402RequestDeps;
}

/**
 * A2A client that wraps an AgentSummary. Resolves the agent card from summary.a2a on first use
 * and delegates to the same low-level A2A functions as Agent.
 */
export class A2AClientFromSummary implements A2AClient {
  private _resolved: ResolvedA2A | null = null;

  constructor(
    private readonly _sdk: SDKLike,
    private readonly _summary: AgentSummary
  ) {}

  private async _ensureResolved(): Promise<ResolvedA2A> {
    if (this._resolved) return this._resolved;
    const a2a = this._summary.a2a;
    if (!a2a || (!a2a.startsWith('http://') && !a2a.startsWith('https://'))) {
      throw new Error('Agent summary has no A2A endpoint');
    }
    this._resolved = await resolveA2aFromEndpointUrl(a2a);
    return this._resolved;
  }

  async messageA2A(
    content: string | { parts: import('../models/a2a.js').Part[] },
    options?: MessageA2AOptions
  ): Promise<MessageResponse | TaskResponse | A2APaymentRequired<MessageResponse | TaskResponse>> {
    const resolved = await this._ensureResolved();
    const x402Deps = this._sdk.getX402RequestDeps?.();
    return sendMessage(
      {
        baseUrl: resolved.baseUrl,
        a2aVersion: resolved.a2aVersion,
        content,
        options,
        auth: resolved.auth,
        tenant: resolved.tenant,
        binding: resolved.binding,
      },
      x402Deps
    );
  }

  async listTasks(
    options?: ListTasksOptions
  ): Promise<TaskSummary[] | A2APaymentRequired<TaskSummary[]>> {
    const resolved = await this._ensureResolved();
    const x402Deps = this._sdk.getX402RequestDeps?.();
    return listTasks(
      {
        baseUrl: resolved.baseUrl,
        a2aVersion: resolved.a2aVersion,
        options,
        auth: resolved.auth,
        tenant: resolved.tenant,
      },
      x402Deps
    );
  }

  async loadTask(
    taskId: string,
    options?: LoadTaskOptions
  ): Promise<AgentTask | A2APaymentRequired<AgentTask>> {
    const resolved = await this._ensureResolved();
    const x402Deps = this._sdk.getX402RequestDeps?.();
    const resolvedAuth =
      options?.credential != null && resolved.auth
        ? applyCredential(options.credential, resolved.auth)
        : undefined;

    const result = await getTask(
      resolved.baseUrl,
      resolved.a2aVersion,
      taskId,
      resolvedAuth,
      x402Deps,
      options?.payment,
      resolved.tenant
    );

    if (result.x402Required) {
      return {
        x402Required: true,
        x402Payment: {
          ...result.x402Payment,
          pay: async (accept?: X402Accept | number) => {
            const summary = await result.x402Payment.pay(accept);
            return createTaskHandle(
              resolved.baseUrl,
              resolved.a2aVersion,
              summary.taskId,
              summary.contextId,
              x402Deps,
              resolvedAuth,
              resolved.tenant
            );
          },
          payFirst: result.x402Payment.payFirst
            ? async () => {
                const summary = await result.x402Payment.payFirst!();
                return createTaskHandle(
                  resolved.baseUrl,
                  resolved.a2aVersion,
                  summary.taskId,
                  summary.contextId,
                  x402Deps,
                  resolvedAuth,
                  resolved.tenant
                );
              }
            : undefined,
        },
      };
    }

    const summary = result as TaskSummary;
    return createTaskHandle(
      resolved.baseUrl,
      resolved.a2aVersion,
      summary.taskId,
      summary.contextId,
      x402Deps,
      resolvedAuth,
      resolved.tenant
    );
  }
}
