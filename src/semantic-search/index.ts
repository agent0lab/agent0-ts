export type {
  SemanticAgentRecord,
  SemanticSearchFilters,
  SemanticSearchQueryOptions,
  SemanticSearchResponse,
  SemanticSearchResult,
} from './types.js';

export type {
  EmbeddingProvider,
  VectorStoreProvider,
  VectorUpsertItem,
  VectorQueryParams,
  VectorQueryMatch,
  SemanticQueryRequest,
} from './interfaces.js';

export { SemanticSearchManager } from './manager.js';

export { VeniceEmbeddingProvider } from './providers/venice-embedding.js';
export { OpenAIEmbeddingProvider } from './providers/openai-embedding.js';
export { PineconeVectorStore } from './providers/pinecone-vector-store.js';
export { WeaviateVectorStore } from './providers/weaviate-vector-store.js';
export {
  resolveSemanticSearchProviders,
  type SemanticSearchConfig,
  type EmbeddingProviderDefinition,
  type VectorStoreProviderDefinition,
} from './config.js';
export {
  type SemanticSyncState,
  type SemanticSyncStateStore,
  InMemorySemanticSyncStateStore,
  computeAgentHash,
} from './sync-state.js';
export { FileSemanticSyncStateStore } from './file-sync-state-store.js';
export { SemanticSyncRunner, type SemanticSyncRunnerOptions } from './sync-runner.js';

