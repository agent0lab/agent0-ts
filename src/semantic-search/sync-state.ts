import type { SemanticAgentRecord } from './types.js';

interface LegacySemanticSyncState {
  lastUpdatedAt?: string;
  agentHashes?: Record<string, string>;
}

export interface ChainSyncState {
  lastUpdatedAt: string;
  agentHashes?: Record<string, string>;
}

/**
 * Persisted sync state used to resume semantic indexing without reprocessing all agents.
 */
export interface SemanticSyncState {
  chains: Record<string, ChainSyncState>;
}

/**
 * Abstraction for persisting semantic sync state.
 * Implementations can back this by the file system, databases, or in-memory stores.
 */
export interface SemanticSyncStateStore {
  load(): Promise<SemanticSyncState | LegacySemanticSyncState | null>;
  save(state: SemanticSyncState): Promise<void>;
  clear?(): Promise<void>;
}

/**
 * Normalise incoming state (including legacy single-chain format) into the new multi-chain structure.
 */
export function normalizeSemanticSyncState(
  raw: SemanticSyncState | LegacySemanticSyncState | null | undefined
): SemanticSyncState {
  if (!raw) {
    return { chains: {} };
  }

  if ('chains' in raw && raw.chains) {
    const normalizedChains: Record<string, ChainSyncState> = {};
    for (const [key, chainState] of Object.entries(raw.chains)) {
      normalizedChains[key] = {
        lastUpdatedAt: chainState?.lastUpdatedAt ?? '0',
        agentHashes: chainState?.agentHashes ? { ...chainState.agentHashes } : undefined,
      };
    }
    return { chains: normalizedChains };
  }

  const legacy = raw as LegacySemanticSyncState;
  return {
    chains: {
      __legacy: {
        lastUpdatedAt: legacy.lastUpdatedAt ?? '0',
        agentHashes: legacy.agentHashes ? { ...legacy.agentHashes } : undefined,
      },
    },
  };
}

function cloneState(state: SemanticSyncState): SemanticSyncState {
  const clonedChains: Record<string, ChainSyncState> = {};
  for (const [chainId, chainState] of Object.entries(state.chains)) {
    clonedChains[chainId] = {
      lastUpdatedAt: chainState.lastUpdatedAt,
      agentHashes: chainState.agentHashes ? { ...chainState.agentHashes } : undefined,
    };
  }
  return { chains: clonedChains };
}

/**
 * Default in-memory store (non-persistent). Useful for quick starts and tests.
 */
export class InMemorySemanticSyncStateStore implements SemanticSyncStateStore {
  private state: SemanticSyncState | null = null;

  async load(): Promise<SemanticSyncState | null> {
    return this.state ? cloneState(this.state) : null;
  }

  async save(state: SemanticSyncState): Promise<void> {
    this.state = cloneState(state);
  }

  async clear(): Promise<void> {
    this.state = null;
  }
}

/**
 * Helper to compute a deterministic hash for a semantic agent record.
 * Consumers can use this to implement custom stores without re-exporting crypto utilities.
 */
export function computeAgentHash(agent: SemanticAgentRecord): string {
  // Use structured data to avoid property order issues.
  const canonical = JSON.stringify(agent, Object.keys(agent).sort());
  // Small, dependency-free hashing (FNV-1a 32-bit)
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

