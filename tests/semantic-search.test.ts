import {
  SemanticSearchManager,
  resolveSemanticSearchProviders,
  VeniceEmbeddingProvider,
  OpenAIEmbeddingProvider,
  PineconeVectorStore,
  WeaviateVectorStore,
  type SemanticAgentRecord,
  type SemanticQueryRequest,
  type VectorQueryMatch,
  type VectorQueryParams,
  type VectorUpsertItem,
} from '../src/semantic-search/index.js';
import { SDK } from '../src/core/sdk.js';

class MockEmbeddingProvider {
  prepareAgentText = jest.fn((agent: SemanticAgentRecord) => `${agent.name}: ${agent.description}`);
  generateEmbedding = jest.fn(async () => [0.1, 0.2, 0.3]);
  generateBatchEmbeddings = jest.fn(async (texts: string[]) => texts.map(() => [0.4, 0.5, 0.6]));
}

class MockVectorStoreProvider {
  initialize = jest.fn(async () => {});
  upsert = jest.fn(async (_item: VectorUpsertItem) => {});
  upsertBatch = jest.fn(async (_items: VectorUpsertItem[]) => {});
  query = jest.fn(async (_params: VectorQueryParams) => [] as VectorQueryMatch[]);
  delete = jest.fn(async (_id: string) => {});
  deleteMany = jest.fn(async (_ids: string[]) => {});
}

describe('resolveSemanticSearchProviders', () => {
  it('returns provided instances unchanged', () => {
    const embedding = new MockEmbeddingProvider();
    const vectorStore = new MockVectorStoreProvider();

    const providers = resolveSemanticSearchProviders({
      embedding,
      vectorStore,
    });

    expect(providers.embedding).toBe(embedding);
    expect(providers.vectorStore).toBe(vectorStore);
  });

  it('instantiates default venice + pinecone providers', () => {
    const providers = resolveSemanticSearchProviders({
      embedding: { provider: 'venice', apiKey: 'venice-key' },
      vectorStore: { provider: 'pinecone', apiKey: 'pinecone-key', index: 'test-index' },
    });

    expect(providers.embedding).toBeInstanceOf(VeniceEmbeddingProvider);
    expect(providers.vectorStore).toBeInstanceOf(PineconeVectorStore);
  });

  it('throws for unsupported providers', () => {
    expect(() =>
      resolveSemanticSearchProviders({
        embedding: { provider: 'unknown' as 'venice', apiKey: 'foo' },
        vectorStore: { provider: 'pinecone', apiKey: 'pinecone-key', index: 'test-index' },
      })
    ).toThrow('Unsupported embedding provider');
  });
});

describe('WeaviateVectorStore', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete (global as unknown as { fetch?: typeof fetch }).fetch;
    }
    jest.resetAllMocks();
  });

  it('upserts vectors via REST API', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    (global as unknown as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;

    const store = new WeaviateVectorStore({
      endpoint: 'https://weaviate.example.com',
      apiKey: 'test-key',
      className: 'Agent',
    });

    await store.upsert({
      id: '11155111-123',
      values: [0.1, 0.2],
      metadata: { name: 'Sample' },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://weaviate.example.com/v1/batch/objects',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
        }),
      })
    );
  });

  it('executes vector query via GraphQL', async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            Get: {
              Agent: [
                {
                  _additional: {
                    id: '11155111-123',
                    score: 0.95,
                  },
                  metadata: { name: 'Alpha' },
                },
              ],
            },
          },
        }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

    (global as unknown as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;

    const store = new WeaviateVectorStore({
      endpoint: 'https://weaviate.example.com',
    });

    const matches = await store.query({
      vector: [0.1, 0.2],
      topK: 1,
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      id: '11155111-123',
      score: 0.95,
      metadata: { name: 'Alpha' },
    });
  });
});

describe('OpenAIEmbeddingProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete (global as unknown as { fetch?: typeof fetch }).fetch;
    }
    jest.resetAllMocks();
  });

  it('sends requests to configured base URL and returns embeddings', async () => {
    const mockResponse = { data: [{ embedding: [0.25, 0.5, 0.75] }] };
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    (global as unknown as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;

    const provider = new OpenAIEmbeddingProvider({
      apiKey: 'test-openai-key',
      model: 'text-embedding-3-small',
      baseUrl: 'https://api.openai.com/v1',
    });

    const embedding = await provider.generateEmbedding('hello world');
    expect(embedding).toEqual([0.25, 0.5, 0.75]);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [, requestInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(requestInit?.method).toBe('POST');
    expect(requestInit?.headers).toMatchObject({
      Authorization: 'Bearer test-openai-key',
      'Content-Type': 'application/json',
    });

    const parsedBody = JSON.parse(requestInit?.body as string);
    expect(parsedBody).toMatchObject({
      input: 'hello world',
      model: 'text-embedding-3-small',
    });
  });

  it('allows payload overrides via buildPayload hook', async () => {
    const mockResponse = { data: [{ embedding: [1, 2] }] };
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    (global as unknown as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;

    const provider = new OpenAIEmbeddingProvider({
      apiKey: 'key',
      buildPayload: body => ({
        ...body,
        dimensions: 256,
      }),
    });

    await provider.generateEmbedding('payload');
    const [, requestInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const parsedBody = JSON.parse(requestInit?.body as string);
    expect(parsedBody.dimensions).toBe(256);
  });
});

const baseAgent: SemanticAgentRecord = {
  chainId: 11155111,
  agentId: '11155111:123',
  name: 'Navigator',
  description: 'Helps with DeFi strategies',
  capabilities: ['defi'],
  defaultInputModes: ['text'],
  defaultOutputModes: ['json'],
  tags: ['portfolio'],
};

describe('SemanticSearchManager', () => {
  it('formats and parses vector ids', () => {
    const vectorId = SemanticSearchManager.formatVectorId(baseAgent.chainId, baseAgent.agentId);
    expect(vectorId).toBe('11155111-11155111:123');
    expect(SemanticSearchManager.parseVectorId(vectorId)).toEqual({
      chainId: 11155111,
      agentId: '11155111:123',
    });
  });

  it('indexes a single agent', async () => {
    const embedding = new MockEmbeddingProvider();
    const vectorStore = new MockVectorStoreProvider();
    const manager = new SemanticSearchManager(embedding as any, vectorStore as any);

    await manager.indexAgent(baseAgent);

    expect(embedding.prepareAgentText).toHaveBeenCalledWith(baseAgent);
    expect(embedding.generateEmbedding).toHaveBeenCalled();
    expect(vectorStore.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: '11155111-11155111:123' })
    );
  });

  it('indexes agents in batch using batch embeddings when available', async () => {
    const embedding = new MockEmbeddingProvider();
    const vectorStore = new MockVectorStoreProvider();
    const manager = new SemanticSearchManager(embedding as any, vectorStore as any);

    await manager.indexAgentsBatch([baseAgent, { ...baseAgent, agentId: '11155111:999' }]);

    expect(embedding.generateBatchEmbeddings).toHaveBeenCalled();
    expect(vectorStore.upsertBatch).toHaveBeenCalled();
  });

  it('filters matches below minScore when searching', async () => {
    const embedding = new MockEmbeddingProvider();
    const vectorStore = new MockVectorStoreProvider();
    vectorStore.query.mockResolvedValue([
      { id: '11155111-11155111:123', score: 0.9, metadata: { name: 'High' } },
      { id: '11155111-11155111:456', score: 0.4, metadata: { name: 'Low' } },
    ] as VectorQueryMatch[]);

    const manager = new SemanticSearchManager(embedding as any, vectorStore as any);

    const request: SemanticQueryRequest = {
      query: 'defi agent',
      minScore: 0.5,
    };

    const response = await manager.searchAgents(request);

    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toMatchObject({ agentId: '11155111:123', score: 0.9 });
  });

  it('falls back to single deletions when deleteMany is unavailable', async () => {
    const embedding = new MockEmbeddingProvider();
    const vectorStore = new MockVectorStoreProvider();
    vectorStore.deleteMany = undefined as any;

    const manager = new SemanticSearchManager(embedding as any, vectorStore as any);
    await manager.deleteAgentsBatch([
      { chainId: baseAgent.chainId, agentId: baseAgent.agentId },
      { chainId: baseAgent.chainId, agentId: '11155111:456' },
    ]);

    expect(vectorStore.delete).toHaveBeenCalledTimes(2);
  });
});

describe('SDK semantic search integration', () => {
  it('throws when semantic search is not configured', async () => {
    const sdk = new SDK({
      chainId: 11155111,
      rpcUrl: 'http://localhost:8545',
    });

    expect(() => sdk.semanticSearch).toThrow('Semantic search is not configured');
    await expect(sdk.semanticSearchAgents({ query: 'test' })).rejects.toThrow(
      'Semantic search is not configured'
    );
  });

  it('delegates to semantic search manager when configured', async () => {
    const embedding = new MockEmbeddingProvider();
    const vectorStore = new MockVectorStoreProvider();
    const sdk = new SDK({
      chainId: 11155111,
      rpcUrl: 'http://localhost:8545',
      semanticSearch: {
        embedding: embedding as any,
        vectorStore: vectorStore as any,
      },
    });

    const record: SemanticAgentRecord = { ...baseAgent, agentId: '11155111:777' };

    await sdk.semanticIndexAgent(record);
    expect(embedding.prepareAgentText).toHaveBeenCalled();
    expect(vectorStore.upsert).toHaveBeenCalled();
  });
});

