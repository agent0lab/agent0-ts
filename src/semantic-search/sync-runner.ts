import type { SDK } from '../core/sdk.js';
import type { SemanticAgentRecord } from './types.js';
import { SemanticSearchManager } from './manager.js';
import type { SemanticSyncState, SemanticSyncStateStore } from './sync-state.js';
import { InMemorySemanticSyncStateStore, computeAgentHash } from './sync-state.js';

interface SubgraphAgent {
  id: string;
  chainId: string;
  agentId: string;
  updatedAt: string;
  registrationFile: {
    id?: string | null;
    name?: string | null;
    description?: string | null;
    image?: string | null;
    active?: boolean | null;
    x402support?: boolean | null;
    supportedTrusts?: string[] | null;
    mcpTools?: string[] | null;
    mcpPrompts?: string[] | null;
    mcpResources?: string[] | null;
    a2aSkills?: string[] | null;
    agentWallet?: string | null;
    ens?: string | null;
    did?: string | null;
  } | null;
}

export interface SemanticSyncRunnerOptions {
  batchSize?: number;
  stateStore?: SemanticSyncStateStore;
  logger?: (message: string, extra?: Record<string, unknown>) => void;
  /**
   * Include agents whose registration file is missing (will trigger deletions).
   * Defaults to true.
   */
  includeOrphanedAgents?: boolean;
}

export class SemanticSyncRunner {
  private readonly batchSize: number;
  private readonly stateStore: SemanticSyncStateStore;
  private readonly logger?: (message: string, extra?: Record<string, unknown>) => void;
  private readonly includeOrphanedAgents: boolean;

  constructor(
    private readonly sdk: SDK,
    options: SemanticSyncRunnerOptions = {}
  ) {
    if (!sdk.subgraphClient) {
      throw new Error('SemanticSyncRunner requires the SDK to be initialised with a subgraph client');
    }
    if (!sdk.semanticSearch) {
      throw new Error('Semantic search must be configured on the SDK instance');
    }
    this.batchSize = options.batchSize ?? 50;
    this.stateStore = options.stateStore ?? new InMemorySemanticSyncStateStore();
    this.logger = options.logger;
    this.includeOrphanedAgents = options.includeOrphanedAgents ?? true;
  }

  async run(): Promise<void> {
    const state = (await this.stateStore.load()) ?? this.createEmptyState();
    let lastUpdatedAt = state.lastUpdatedAt;
    let processedAny = false;
    let hasMore = true;

    while (hasMore) {
      const agents = await this.fetchAgents(lastUpdatedAt, this.batchSize);

      if (agents.length === 0) {
        hasMore = false;
        break;
      }

      const { toIndex, toDelete, maxUpdatedAt, hashes } = this.prepareAgents(agents, state);

      if (toIndex.length > 0) {
        await this.indexAgents(toIndex);
      }
      if (toDelete.length > 0) {
        await this.sdk.semanticDeleteAgentsBatch(toDelete);
      }

      // Update hashes after successful writes
      for (const { agentId, hash } of hashes) {
        if (hash) {
          state.agentHashes![agentId] = hash;
        } else {
          delete state.agentHashes![agentId];
        }
      }

      lastUpdatedAt = maxUpdatedAt;
      state.lastUpdatedAt = lastUpdatedAt;

      await this.stateStore.save(state);
      processedAny = true;
      this.log('semantic-sync:batch-processed', {
        indexed: toIndex.length,
        deleted: toDelete.length,
        lastUpdatedAt,
      });
    }

    if (!processedAny) {
      this.log('semantic-sync:no-op', { lastUpdatedAt });
    }
  }

  private createEmptyState(): SemanticSyncState {
    return {
      lastUpdatedAt: '0',
      agentHashes: {},
    };
  }

  private async fetchAgents(updatedAfter: string, first: number): Promise<SubgraphAgent[]> {
    const subgraph = this.sdk.subgraphClient!;
    const query = `
      query SemanticSyncAgents($updatedAfter: BigInt!, $first: Int!) {
        agents(
          where: { updatedAt_gt: $updatedAfter }
          orderBy: updatedAt
          orderDirection: asc
          first: $first
        ) {
          id
          chainId
          agentId
          updatedAt
          registrationFile {
            id
            name
            description
            image
            active
            x402support
            supportedTrusts
            mcpTools
            mcpPrompts
            mcpResources
            a2aSkills
            agentWallet
            ens
            did
          }
        }
      }
    `;

    const variables = {
      updatedAfter,
      first,
    };

    const result = await subgraph.query<{ agents: SubgraphAgent[] }>(query, variables);
    return result.agents || [];
  }

  private prepareAgents(
    agents: SubgraphAgent[],
    state: SemanticSyncState
  ): {
    toIndex: SemanticAgentRecord[];
    toDelete: Array<{ chainId: number; agentId: string }>;
    hashes: Array<{ agentId: string; hash?: string }>;
    maxUpdatedAt: string;
  } {
    const toIndex: SemanticAgentRecord[] = [];
    const toDelete: Array<{ chainId: number; agentId: string }> = [];
    const hashes: Array<{ agentId: string; hash?: string }> = [];
    let maxUpdatedAt = state.lastUpdatedAt;

    for (const agent of agents) {
      const chainId = Number(agent.chainId);
      const agentId = agent.id;
      const updatedAt = agent.updatedAt ?? '0';

      if (updatedAt > maxUpdatedAt) {
        maxUpdatedAt = updatedAt;
      }

      if (!agent.registrationFile) {
        if (this.includeOrphanedAgents) {
          toDelete.push({ chainId, agentId });
          hashes.push({ agentId });
        }
        continue;
      }

      const record = this.toSemanticAgentRecord(agent);
      const hash = computeAgentHash(record);

      if (state.agentHashes?.[agentId] === hash) {
        continue;
      }

      toIndex.push(record);
      hashes.push({ agentId, hash });
    }

    return { toIndex, toDelete, hashes, maxUpdatedAt };
  }

  private toSemanticAgentRecord(agent: SubgraphAgent): SemanticAgentRecord {
    const chainId = Number(agent.chainId);
    const reg = agent.registrationFile!;

    const metadata: Record<string, unknown> = {
      registrationId: reg.id ?? undefined,
      supportedTrusts: reg.supportedTrusts ?? undefined,
      mcpTools: reg.mcpTools ?? undefined,
      mcpPrompts: reg.mcpPrompts ?? undefined,
      mcpResources: reg.mcpResources ?? undefined,
      a2aSkills: reg.a2aSkills ?? undefined,
      ens: reg.ens ?? undefined,
      did: reg.did ?? undefined,
      agentWallet: reg.agentWallet ?? undefined,
      active: reg.active ?? undefined,
      x402support: reg.x402support ?? undefined,
      updatedAt: agent.updatedAt,
    };

    return {
      chainId,
      agentId: agent.id,
      name: reg.name ?? '',
      description: reg.description ?? '',
      capabilities: [
        ...(reg.mcpTools ?? []),
        ...(reg.mcpPrompts ?? []),
        ...(reg.a2aSkills ?? []),
      ],
      defaultInputModes: reg.mcpTools && reg.mcpTools.length > 0 ? ['mcp'] : ['text'],
      defaultOutputModes: ['json'],
      tags: reg.supportedTrusts ?? [],
      metadata,
    };
  }

  private async indexAgents(records: SemanticAgentRecord[]): Promise<void> {
    const manager: SemanticSearchManager = this.sdk.semanticSearch;

    if (records.length === 1) {
      await manager.indexAgent(records[0]);
    } else if (records.length > 1) {
      await manager.indexAgentsBatch(records);
    }
  }

  private log(message: string, extra?: Record<string, unknown>) {
    if (this.logger) {
      this.logger(message, extra);
    }
  }
}

