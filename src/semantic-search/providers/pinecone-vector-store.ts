import { Pinecone, type RecordMetadata, type RecordMetadataValue } from '@pinecone-database/pinecone';
import type { SemanticSearchFilters } from '../types.js';
import type { VectorQueryMatch, VectorQueryParams, VectorStoreProvider, VectorUpsertItem } from '../interfaces.js';

export interface PineconeVectorStoreConfig {
  apiKey: string;
  index: string;
  namespace?: string;
  batchSize?: number;
}

export class PineconeVectorStore implements VectorStoreProvider {
  private readonly client: Pinecone;
  private readonly indexName: string;
  private readonly namespace?: string;
  private readonly batchSize: number;
  private initialized = false;
  private readonly baseIndex;

  constructor(config: PineconeVectorStoreConfig) {
    if (!config?.apiKey) {
      throw new Error('PineconeVectorStore requires an apiKey');
    }
    if (!config.index) {
      throw new Error('PineconeVectorStore requires an index name');
    }

    this.indexName = config.index;
    this.namespace = config.namespace;
    this.batchSize = config.batchSize ?? 100;

    this.client = new Pinecone({
      apiKey: config.apiKey,
    });
    this.baseIndex = this.client.Index(this.indexName);
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.baseIndex.describeIndexStats();
    this.initialized = true;
  }

  async upsert(item: VectorUpsertItem): Promise<void> {
    const index = this.getTargetIndex();
    await index.upsert([
      {
        id: item.id,
        values: item.values,
        metadata: this.normalizeMetadata(item.metadata),
      },
    ]);
  }

  async upsertBatch(items: VectorUpsertItem[]): Promise<void> {
    const index = this.getTargetIndex();

    for (let i = 0; i < items.length; i += this.batchSize) {
      const batch = items.slice(i, i + this.batchSize).map(item => ({
        id: item.id,
        values: item.values,
        metadata: this.normalizeMetadata(item.metadata),
      }));

      await index.upsert(batch);
    }
  }

  async query(params: VectorQueryParams): Promise<VectorQueryMatch[]> {
    const index = this.getTargetIndex();
    const topK = params.topK ?? 5;

    const queryResponse = await index.query({
      vector: params.vector,
      topK,
      includeMetadata: true,
      filter: this.transformFilters(params.filter),
    });

    return (
      queryResponse.matches?.map(match => ({
        id: match.id,
        score: match.score ?? 0,
        metadata: match.metadata as Record<string, unknown> | undefined,
        matchReasons: this.generateMatchReasons(match.score ?? 0, match.metadata),
      })) || []
    );
  }

  async delete(id: string): Promise<void> {
    const index = this.getTargetIndex();
    await index.deleteOne(id);
  }

  async deleteMany(ids: string[]): Promise<void> {
    const index = this.getTargetIndex();
    for (let i = 0; i < ids.length; i += this.batchSize) {
      const batch = ids.slice(i, i + this.batchSize);
      await index.deleteMany(batch);
    }
  }

  private getTargetIndex() {
    return this.namespace ? this.baseIndex.namespace(this.namespace) : this.baseIndex;
  }

  private transformFilters(filters?: SemanticSearchFilters): Record<string, unknown> | undefined {
    if (!filters) {
      return undefined;
    }

    const result: Record<string, unknown> = {};

    if (filters.capabilities && filters.capabilities.length > 0) {
      result.capabilities = { $in: filters.capabilities };
    }

    if (filters.inputMode) {
      result.defaultInputModes = { $in: [filters.inputMode] };
    }

    if (filters.outputMode) {
      result.defaultOutputModes = { $in: [filters.outputMode] };
    }

    for (const [key, value] of Object.entries(filters)) {
      if (key === 'capabilities' || key === 'inputMode' || key === 'outputMode' || key === 'minScore') {
        continue;
      }
      result[key] = value;
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }

  private generateMatchReasons(score: number, metadata?: Record<string, unknown>): string[] | undefined {
    const reasons: string[] = [];

    if (score >= 0.9) {
      reasons.push('Excellent semantic match');
    } else if (score >= 0.7) {
      reasons.push('Good semantic match');
    } else if (score >= 0.5) {
      reasons.push('Moderate semantic match');
    }

    if (metadata && Array.isArray(metadata.capabilities)) {
      const capabilities = (metadata.capabilities as unknown[]).filter(value => typeof value === 'string') as string[];
      if (capabilities.length > 0) {
        reasons.push(`Capabilities: ${capabilities.join(', ')}`);
      }
    }

    return reasons.length > 0 ? reasons : undefined;
  }

  private normalizeMetadata(metadata?: Record<string, unknown>): RecordMetadata | undefined {
    if (!metadata) {
      return undefined;
    }

    const result: Record<string, RecordMetadataValue> = {};

    for (const [key, value] of Object.entries(metadata)) {
      if (this.isMetadataValue(value)) {
        result[key] = value;
      }
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }

  private isMetadataValue(value: unknown): value is RecordMetadataValue {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return true;
    }

    if (Array.isArray(value) && value.every(item => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')) {
      return true;
    }

    return false;
  }
}

