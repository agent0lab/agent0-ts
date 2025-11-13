import type { SemanticAgentRecord, SemanticSearchFilters } from './types.js';

export interface EmbeddingProvider {
  initialize?(): Promise<void>;
  generateEmbedding(text: string): Promise<number[]>;
  generateBatchEmbeddings?(texts: string[]): Promise<number[][]>;
  prepareAgentText(agent: SemanticAgentRecord): string;
}

export interface VectorUpsertItem {
  id: string;
  values: number[];
  metadata?: Record<string, unknown>;
}

export interface VectorQueryParams {
  vector: number[];
  topK?: number;
  filter?: SemanticSearchFilters;
}

export interface VectorQueryMatch {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
  matchReasons?: string[];
}

export interface VectorStoreProvider {
  initialize?(): Promise<void>;
  upsert(item: VectorUpsertItem): Promise<void>;
  upsertBatch?(items: VectorUpsertItem[]): Promise<void>;
  query(params: VectorQueryParams): Promise<VectorQueryMatch[]>;
  delete(id: string): Promise<void>;
  deleteMany?(ids: string[]): Promise<void>;
}

export interface SemanticSearchProviders {
  embedding: EmbeddingProvider;
  vectorStore: VectorStoreProvider;
}

export interface SemanticQueryRequest {
  query: string;
  topK?: number;
  filters?: SemanticSearchFilters;
  minScore?: number;
}

