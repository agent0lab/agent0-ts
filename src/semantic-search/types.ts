import type { AgentId, ChainId } from '../models/types.js';

export interface SemanticAgentRecord {
  chainId: ChainId;
  agentId: AgentId;
  name: string;
  description: string;
  capabilities?: string[];
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface SemanticSearchFilters {
  capabilities?: string[];
  inputMode?: string;
  outputMode?: string;
  minScore?: number;
  [key: string]: unknown;
}

export interface SemanticSearchQueryOptions {
  topK?: number;
  filters?: SemanticSearchFilters;
  minScore?: number;
}

export interface SemanticSearchResult {
  rank: number;
  vectorId: string;
  agentId: AgentId;
  chainId: ChainId;
  name?: string;
  description?: string;
  score: number;
  metadata?: Record<string, unknown>;
  matchReasons?: string[];
}

export interface SemanticSearchResponse {
  query: string;
  results: SemanticSearchResult[];
  total: number;
  timestamp: string;
}

