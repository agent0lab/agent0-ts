import type { SemanticSearchFilters } from '../types.js';
import type {
  VectorStoreProvider,
  VectorUpsertItem,
  VectorQueryParams,
  VectorQueryMatch,
} from '../interfaces.js';

export interface WeaviateVectorStoreConfig {
  endpoint: string;
  apiKey?: string;
  className?: string;
  tenant?: string;
  consistencyLevel?: 'ALL' | 'ONE' | 'QUORUM';
  batchSize?: number;
}

interface WeaviateGraphQLResponse {
  data?: {
    Get?: Record<string, Array<{
      _additional?: {
        id?: string;
        vector?: number[];
        distance?: number;
        certainty?: number;
        score?: number;
      };
      [key: string]: unknown;
    }>>;
  };
}

export class WeaviateVectorStore implements VectorStoreProvider {
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly className: string;
  private readonly tenant?: string;
  private readonly consistencyLevel?: 'ALL' | 'ONE' | 'QUORUM';
  private readonly batchSize: number;

  constructor(config: WeaviateVectorStoreConfig) {
    if (!config?.endpoint) {
      throw new Error('WeaviateVectorStore requires an endpoint');
    }

    this.endpoint = config.endpoint.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.className = config.className ?? 'Agent';
    this.tenant = config.tenant;
    this.consistencyLevel = config.consistencyLevel;
    this.batchSize = config.batchSize ?? 100;
  }

  async upsert(item: VectorUpsertItem): Promise<void> {
    await this.upsertBatch([item]);
  }

  async upsertBatch(items: VectorUpsertItem[]): Promise<void> {
    const batches = this.chunk(items, this.batchSize);

    for (const batch of batches) {
      const objects = batch.map(record => ({
        id: record.id,
        class: this.className,
        vector: record.values,
        properties: record.metadata ?? {},
        ...(this.tenant ? { tenant: this.tenant } : {}),
      }));

      await this.restCall('/batch/objects', {
        method: 'POST',
        body: JSON.stringify({ objects }),
      });
    }
  }

  async query(params: VectorQueryParams): Promise<VectorQueryMatch[]> {
    const topK = params.topK ?? 5;
    const query = `
      {
        Get {
          ${this.className}(
            nearVector: { vector: ${JSON.stringify(params.vector)} }
            limit: ${topK}
            ${this.tenant ? `tenant: "${this.tenant}"` : ''}
          ) {
            _additional {
              id
              vector
              distance
              certainty
              score
            }
            metadata
          }
        }
      }
    `;

    const response = await this.graphql(query);
    const data = response.data?.Get?.[this.className] ?? [];

    return data.map((item, index) => {
      const additional = item._additional ?? {};
      return {
        id: additional.id ?? '',
        score: additional.score ?? additional.certainty ?? 0,
        metadata: (item as Record<string, unknown>).metadata as Record<string, unknown> | undefined,
        matchReasons: [
          additional.distance !== undefined ? `distance: ${additional.distance}` : undefined,
          additional.certainty !== undefined ? `certainty: ${additional.certainty}` : undefined,
        ].filter(Boolean) as string[],
        rank: index + 1,
      };
    });
  }

  async delete(id: string): Promise<void> {
    const path = `/objects/${this.className}/${encodeURIComponent(id)}`;
    await this.restCall(path, {
      method: 'DELETE',
    });
  }

  async deleteMany(ids: string[]): Promise<void> {
    const batches = this.chunk(ids, this.batchSize);
    for (const batch of batches) {
      const path = `/batch/objects/delete`;
      await this.restCall(path, {
        method: 'POST',
        body: JSON.stringify({
          match: {
            class: this.className,
            where: {
              operator: 'Or',
              operands: batch.map(id => ({
                path: ['id'],
                operator: 'Equal',
                valueText: id,
              })),
            },
          },
        }),
      });
    }
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size));
    }
    return result;
  }

  private async graphql(query: string): Promise<WeaviateGraphQLResponse> {
    const response = await fetch(`${this.endpoint}/v1/graphql`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Weaviate GraphQL query failed: ${response.status} ${errorText}`);
    }

    return (await response.json()) as WeaviateGraphQLResponse;
  }

  private async restCall(path: string, init: RequestInit): Promise<void> {
    const response = await fetch(`${this.endpoint}/v1${path}`, {
      ...init,
      headers: {
        ...this.buildHeaders(),
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Weaviate REST call failed: ${response.status} ${errorText}`);
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    if (this.consistencyLevel) {
      headers['X-Weaviate-Consistency-Level'] = this.consistencyLevel;
    }
    return headers;
  }

  private transformFilters(filters?: SemanticSearchFilters): Record<string, unknown> | undefined {
    if (!filters) return undefined;
    return filters;
  }
}

