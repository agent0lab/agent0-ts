interface OpenAIEmbeddingRequest {
  input: string | string[];
  model: string;
  dimensions?: number;
}

interface OpenAIEmbeddingResponse {
  data: Array<{
    embedding: number[];
  }>;
}

export interface OpenAIEmbeddingConfig {
  apiKey: string;
  model?: string;
  /**
   * Optional base URL (e.g. custom OpenAI-compatible host). Defaults to OpenAI public API.
   */
  baseUrl?: string;
  /**
   * Optional override for fetch timeout (ms).
   */
  timeoutMs?: number;
  /**
   * Optional request hook to tweak payload before dispatch.
   */
  buildPayload?: (body: OpenAIEmbeddingRequest) => OpenAIEmbeddingRequest;
}

import type { SemanticAgentRecord } from '../types.js';
import type { EmbeddingProvider } from '../interfaces.js';

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly buildPayload?: (body: OpenAIEmbeddingRequest) => OpenAIEmbeddingRequest;

  constructor(config: OpenAIEmbeddingConfig) {
    if (!config?.apiKey) {
      throw new Error('OpenAIEmbeddingProvider requires an apiKey');
    }

    this.apiKey = config.apiKey;
    this.model = config.model ?? 'text-embedding-3-small';
    this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.buildPayload = config.buildPayload;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const requestBody: OpenAIEmbeddingRequest = {
      input: text,
      model: this.model,
    };

    const finalPayload = this.buildPayload ? this.buildPayload(requestBody) : requestBody;
    const response = await this.executeRequest(finalPayload);
    return response.data[0]?.embedding ?? [];
  }

  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    const requestBody: OpenAIEmbeddingRequest = {
      input: texts,
      model: this.model,
    };

    const finalPayload = this.buildPayload ? this.buildPayload(requestBody) : requestBody;
    const response = await this.executeRequest(finalPayload);
    return response.data.map(entry => entry.embedding);
  }

  prepareAgentText(agent: SemanticAgentRecord): string {
    const capabilities = agent.capabilities?.join(', ') || '';
    const tags = agent.tags?.join(', ') || '';

    const metadataPairs =
      agent.metadata &&
      Object.entries(agent.metadata)
        .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
        .map(([key, value]) => `${key}: ${String(value)}`);

    return [
      agent.name,
      agent.description,
      capabilities && `Capabilities: ${capabilities}`,
      tags && `Tags: ${tags}`,
      metadataPairs && metadataPairs.length > 0 ? `Metadata: ${metadataPairs.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('. ');
  }

  private async executeRequest(body: OpenAIEmbeddingRequest): Promise<OpenAIEmbeddingResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI embedding request failed: ${response.status} ${errorText}`);
      }

      return (await response.json()) as OpenAIEmbeddingResponse;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('OpenAI embedding request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

