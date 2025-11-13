import type { SDK } from '../core/sdk.js';
import type { ChainId } from '../models/types.js';
import { SubgraphClient } from '../core/subgraph-client.js';
import { DEFAULT_SUBGRAPH_URLS } from '../core/contracts.js';
import type { SemanticAgentRecord } from './types.js';
import { SemanticSearchManager } from './manager.js';
import type { ChainSyncState, SemanticSyncState, SemanticSyncStateStore } from './sync-state.js';
import {
  InMemorySemanticSyncStateStore,
  computeAgentHash,
  normalizeSemanticSyncState,
} from './sync-state.js';

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

export interface SemanticSyncRunnerTarget {
  chainId: ChainId;
  subgraphUrl?: string;
  subgraphClient?: SubgraphClient;
}

export interface SemanticSyncRunnerOptions {
  batchSize?: number;
  stateStore?: SemanticSyncStateStore;
  logger?: (message: string, extra?: Record<string, unknown>) => void;
  includeOrphanedAgents?: boolean;
  /**
   * Optional explicit list of chains/subgraphs to index. Falls back to the SDK chain if omitted.
   */
  targets?: SemanticSyncRunnerTarget[];
  /**
   * Optional map of chainId -> subgraph URL overrides.
   */
  subgraphOverrides?: Record<ChainId, string>;
}

interface ResolvedTarget {
  chainId: ChainId;
  subgraphClient: SubgraphClient;
}

export class SemanticSyncRunner {
  private readonly batchSize: number;
  private readonly stateStore: SemanticSyncStateStore;
  private readonly logger?: (message: string, extra?: Record<string, unknown>) => void;
  private readonly includeOrphanedAgents: boolean;
  private readonly targetsConfig?: SemanticSyncRunnerTarget[];
  private readonly subgraphOverrides?: Record<ChainId, string>;
  private resolvedTargets?: ResolvedTarget[];

  constructor(
    private readonly sdk: SDK,
    options: SemanticSyncRunnerOptions = {}
  ) {
    if (!sdk.semanticSearch) {
      throw new Error('Semantic search must be configured on the SDK instance');
    }
    this.batchSize = options.batchSize ?? 50;
    this.stateStore = options.stateStore ?? new InMemorySemanticSyncStateStore();
    this.logger = options.logger;
    this.includeOrphanedAgents = options.includeOrphanedAgents ?? true;
    this.targetsConfig = options.targets;
    this.subgraphOverrides = options.subgraphOverrides;
  }

  async run(): Promise<void> {
    const state = normalizeSemanticSyncState(await this.stateStore.load());
    const targets = await this.resolveTargets();

    if (targets.length === 0) {
      this.log('semantic-sync:no-targets');
      return;
    }

    let processedAny = false;

    for (const target of targets) {
      const processed = await this.processChain(state, target);
      processedAny = processedAny || processed;
    }

    // Persist final state in case we migrated legacy entries without processing batches.
    await this.stateStore.save(state);

    if (!processedAny) {
      this.log('semantic-sync:no-op', {
        chains: targets.map(target => target.chainId),
      });
    }
  }

  private async resolveTargets(): Promise<ResolvedTarget[]> {
    if (this.resolvedTargets) {
      return this.resolvedTargets;
    }

    const overrides = this.subgraphOverrides ?? {};
    const configured =
      this.targetsConfig && this.targetsConfig.length > 0 ? this.targetsConfig : undefined;

    const resolved: ResolvedTarget[] = [];
    let defaultChainId: ChainId | undefined;

    if (!configured) {
      defaultChainId = await this.sdk.chainId();
    }

    const targets = configured ?? [{ chainId: defaultChainId! }];

    for (const target of targets) {
      const chainId = Number(target.chainId) as ChainId;
      let subgraphClient = target.subgraphClient;

      if (!subgraphClient) {
        let url = target.subgraphUrl ?? overrides[chainId];

        if (!url && defaultChainId !== undefined && chainId === defaultChainId && this.sdk.subgraphClient) {
          subgraphClient = this.sdk.subgraphClient;
        } else {
          if (!url) {
            url = DEFAULT_SUBGRAPH_URLS[chainId];
          }

          if (!url) {
            throw new Error(
              `No subgraph URL configured for chain ${chainId}. Provide one via SemanticSyncRunner targets or DEFAULT_SUBGRAPH_URLS.`
            );
          }

          subgraphClient = new SubgraphClient(url);
        }
      }

      resolved.push({
        chainId,
        subgraphClient,
      });
    }

    this.resolvedTargets = resolved;
    return resolved;
  }

  private async processChain(state: SemanticSyncState, target: ResolvedTarget): Promise<boolean> {
    const chainKey = String(target.chainId);
    const chainState = this.ensureChainState(state, chainKey);
    let lastUpdatedAt = chainState.lastUpdatedAt;
    let processedAny = false;
    let hasMore = true;

    while (hasMore) {
      const agents = await this.fetchAgents(target.subgraphClient, lastUpdatedAt, this.batchSize);

      if (agents.length === 0) {
        hasMore = false;
        break;
      }

      const { toIndex, toDelete, maxUpdatedAt, hashes } = this.prepareAgents(agents, chainState);

      if (toIndex.length > 0) {
        await this.indexAgents(toIndex);
      }
      if (toDelete.length > 0) {
        await this.sdk.semanticDeleteAgentsBatch(toDelete);
      }

      // Update hashes after successful writes
      chainState.agentHashes = chainState.agentHashes ?? {};
      for (const { agentId, hash } of hashes) {
        if (hash) {
          chainState.agentHashes[agentId] = hash;
        } else {
          delete chainState.agentHashes[agentId];
        }
      }

      lastUpdatedAt = maxUpdatedAt;
      chainState.lastUpdatedAt = lastUpdatedAt;
      state.chains[chainKey] = chainState;

      await this.stateStore.save(state);
      processedAny = processedAny || toIndex.length > 0 || toDelete.length > 0;
      this.log('semantic-sync:batch-processed', {
        chainId: target.chainId,
        indexed: toIndex.length,
        deleted: toDelete.length,
        lastUpdatedAt,
      });
    }

    if (!processedAny) {
      this.log('semantic-sync:no-op', { chainId: target.chainId, lastUpdatedAt });
    }

    return processedAny;
  }

  private ensureChainState(state: SemanticSyncState, chainKey: string): ChainSyncState {
    if (!state.chains[chainKey]) {
      if (state.chains.__legacy) {
        state.chains[chainKey] = state.chains.__legacy;
        delete state.chains.__legacy;
      } else {
        state.chains[chainKey] = {
          lastUpdatedAt: '0',
          agentHashes: {},
        };
      }
    }
    state.chains[chainKey].agentHashes = state.chains[chainKey].agentHashes ?? {};
    return state.chains[chainKey];
  }

  private async fetchAgents(
    subgraph: SubgraphClient,
    updatedAfter: string,
    first: number
  ): Promise<SubgraphAgent[]> {
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
    chainState: ChainSyncState
  ): {
    toIndex: SemanticAgentRecord[];
    toDelete: Array<{ chainId: number; agentId: string }>;
    hashes: Array<{ agentId: string; hash?: string }>;
    maxUpdatedAt: string;
  } {
    const toIndex: SemanticAgentRecord[] = [];
    const toDelete: Array<{ chainId: number; agentId: string }> = [];
    const hashes: Array<{ agentId: string; hash?: string }> = [];
    let maxUpdatedAt = chainState.lastUpdatedAt;

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

      if (chainState.agentHashes?.[agentId] === hash) {
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

