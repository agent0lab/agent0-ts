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
export { PineconeVectorStore } from './providers/pinecone-vector-store.js';
export {
  resolveSemanticSearchProviders,
  type SemanticSearchConfig,
  type EmbeddingProviderDefinition,
  type VectorStoreProviderDefinition,
} from './config.js';

