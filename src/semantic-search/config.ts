import type { EmbeddingProvider, SemanticSearchProviders, VectorStoreProvider } from './interfaces.js';
import { VeniceEmbeddingProvider, type VeniceEmbeddingConfig } from './providers/venice-embedding.js';
import { PineconeVectorStore, type PineconeVectorStoreConfig } from './providers/pinecone-vector-store.js';

export type EmbeddingProviderDefinition =
  | EmbeddingProvider
  | ({ provider: 'venice' } & VeniceEmbeddingConfig);

export type VectorStoreProviderDefinition =
  | VectorStoreProvider
  | ({ provider: 'pinecone' } & PineconeVectorStoreConfig);

export interface SemanticSearchConfig {
  embedding: EmbeddingProviderDefinition;
  vectorStore: VectorStoreProviderDefinition;
}

export function resolveSemanticSearchProviders(config: SemanticSearchConfig): SemanticSearchProviders {
  if (!config.embedding) {
    throw new Error('Semantic search configuration must include an embedding provider');
  }
  if (!config.vectorStore) {
    throw new Error('Semantic search configuration must include a vector store provider');
  }

  const embedding = resolveEmbeddingProvider(config.embedding);
  const vectorStore = resolveVectorStoreProvider(config.vectorStore);

  return { embedding, vectorStore };
}

function resolveEmbeddingProvider(definition: EmbeddingProviderDefinition): EmbeddingProvider {
  if (isEmbeddingProviderInstance(definition)) {
    return definition;
  }

  if (definition.provider === 'venice') {
    const { provider: _provider, ...rest } = definition;
    void _provider;
    return new VeniceEmbeddingProvider(rest);
  }

  throw new Error(`Unsupported embedding provider: ${(definition as { provider?: string }).provider}`);
}

function resolveVectorStoreProvider(definition: VectorStoreProviderDefinition): VectorStoreProvider {
  if (isVectorStoreProviderInstance(definition)) {
    return definition;
  }

  if (definition.provider === 'pinecone') {
    const { provider: _provider, ...rest } = definition;
    void _provider;
    return new PineconeVectorStore(rest);
  }

  throw new Error(`Unsupported vector store provider: ${(definition as { provider?: string }).provider}`);
}

function isEmbeddingProviderInstance(value: unknown): value is EmbeddingProvider {
  return typeof value === 'object' && value !== null && 'generateEmbedding' in value;
}

function isVectorStoreProviderInstance(value: unknown): value is VectorStoreProvider {
  return typeof value === 'object' && value !== null && 'query' in value && 'upsert' in value;
}

