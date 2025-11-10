import type { AgentId, ChainId } from '../models/types.js';
import type {
  SemanticAgentRecord,
  SemanticSearchResponse,
  SemanticSearchResult,
} from './types.js';
import type {
  EmbeddingProvider,
  SemanticQueryRequest,
  VectorStoreProvider,
  VectorUpsertItem,
} from './interfaces.js';

export class SemanticSearchManager {
  private initialized = false;

  constructor(
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly vectorStore: VectorStoreProvider
  ) {}

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.embeddingProvider.initialize) {
      await this.embeddingProvider.initialize();
    }

    if (this.vectorStore.initialize) {
      await this.vectorStore.initialize();
    }

    this.initialized = true;
  }

  static formatVectorId(chainId: ChainId, agentId: AgentId): string {
    return `${chainId}-${agentId}`;
  }

  static parseVectorId(vectorId: string): { chainId: ChainId; agentId: AgentId } {
    const separatorIndex = vectorId.indexOf('-');
    if (separatorIndex === -1) {
      throw new Error(`Invalid vector ID format: ${vectorId}`);
    }

    const chainIdPart = vectorId.slice(0, separatorIndex);
    const agentIdPart = vectorId.slice(separatorIndex + 1);
    const parsedChainId = Number(chainIdPart);

    if (Number.isNaN(parsedChainId)) {
      throw new Error(`Invalid chain ID in vector ID: ${vectorId}`);
    }

    return {
      chainId: parsedChainId as ChainId,
      agentId: agentIdPart as AgentId,
    };
  }

  async indexAgent(agent: SemanticAgentRecord): Promise<void> {
    await this.ensureInitialized();
    const text = this.embeddingProvider.prepareAgentText(agent);
    const embedding = await this.embeddingProvider.generateEmbedding(text);
    const item = this.buildVectorUpsertItem(agent, embedding);
    await this.vectorStore.upsert(item);
  }

  async indexAgentsBatch(agents: SemanticAgentRecord[]): Promise<void> {
    await this.ensureInitialized();
    if (agents.length === 0) {
      return;
    }

    const texts = agents.map(agent => this.embeddingProvider.prepareAgentText(agent));
    let embeddings: number[][];

    if (this.embeddingProvider.generateBatchEmbeddings) {
      embeddings = await this.embeddingProvider.generateBatchEmbeddings(texts);
    } else {
      embeddings = [];
      for (const text of texts) {
        embeddings.push(await this.embeddingProvider.generateEmbedding(text));
      }
    }

    const items = agents.map((agent, index) => this.buildVectorUpsertItem(agent, embeddings[index]));

    if (this.vectorStore.upsertBatch) {
      await this.vectorStore.upsertBatch(items);
      return;
    }

    for (const item of items) {
      await this.vectorStore.upsert(item);
    }
  }

  async updateAgent(agent: SemanticAgentRecord): Promise<void> {
    await this.indexAgent(agent);
  }

  async deleteAgent(chainId: ChainId, agentId: AgentId): Promise<void> {
    await this.ensureInitialized();
    const vectorId = SemanticSearchManager.formatVectorId(chainId, agentId);
    await this.vectorStore.delete(vectorId);
  }

  async deleteAgentsBatch(pairs: Array<{ chainId: ChainId; agentId: AgentId }>): Promise<void> {
    await this.ensureInitialized();
    if (pairs.length === 0) {
      return;
    }

    const vectorIds = pairs.map(({ chainId, agentId }) => SemanticSearchManager.formatVectorId(chainId, agentId));

    if (this.vectorStore.deleteMany) {
      await this.vectorStore.deleteMany(vectorIds);
      return;
    }

    for (const vectorId of vectorIds) {
      await this.vectorStore.delete(vectorId);
    }
  }

  async searchAgents(request: SemanticQueryRequest): Promise<SemanticSearchResponse> {
    await this.ensureInitialized();
    const { query, topK, filters, minScore } = request;
    const embedding = await this.embeddingProvider.generateEmbedding(query);

    const matches = await this.vectorStore.query({
      vector: embedding,
      topK,
      filter: filters,
    });

    let filteredMatches = matches;
    if (typeof minScore === 'number') {
      filteredMatches = matches.filter(match => (match.score ?? 0) >= minScore);
    }

    const results: SemanticSearchResult[] = filteredMatches.map((match, index) => {
      const { chainId, agentId } = SemanticSearchManager.parseVectorId(match.id);
      const metadata = match.metadata || {};
      const name = typeof metadata.name === 'string' ? metadata.name : undefined;
      const description = typeof metadata.description === 'string' ? metadata.description : undefined;

      return {
        rank: index + 1,
        vectorId: match.id,
        agentId,
        chainId,
        name,
        description,
        score: match.score,
        metadata,
        matchReasons: match.matchReasons,
      };
    });

    return {
      query,
      results,
      total: results.length,
      timestamp: new Date().toISOString(),
    };
  }

  private buildVectorUpsertItem(agent: SemanticAgentRecord, embedding: number[]): VectorUpsertItem {
    const vectorId = SemanticSearchManager.formatVectorId(agent.chainId, agent.agentId);

    const metadata: Record<string, unknown> = {
      name: agent.name,
      description: agent.description,
      capabilities: agent.capabilities || [],
      defaultInputModes: agent.defaultInputModes || [],
      defaultOutputModes: agent.defaultOutputModes || [],
      tags: agent.tags || [],
      chainId: agent.chainId,
      agentId: agent.agentId,
      updatedAt: new Date().toISOString(),
      ...(agent.metadata || {}),
    };

    return {
      id: vectorId,
      values: embedding,
      metadata,
    };
  }
}

