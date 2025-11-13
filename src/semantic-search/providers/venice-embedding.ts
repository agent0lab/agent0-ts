import type { SemanticAgentRecord } from '../types.js';
import type { EmbeddingProvider } from '../interfaces.js';

export interface VeniceEmbeddingConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

interface VeniceEmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

export class VeniceEmbeddingProvider implements EmbeddingProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: VeniceEmbeddingConfig) {
    if (!config?.apiKey) {
      throw new Error('VeniceEmbeddingProvider requires an apiKey');
    }

    this.apiKey = config.apiKey;
    this.model = config.model ?? 'text-embedding-bge-m3';
    this.baseUrl = config.baseUrl ?? 'https://api.venice.ai/api/v1/embeddings';
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const payload = {
      input: text,
      model: this.model,
      encoding_format: 'float',
    };

    const response = await this.executeRequest(payload);
    return response.data[0]?.embedding ?? [];
  }

  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    const payload = {
      input: texts,
      model: this.model,
      encoding_format: 'float',
    };

    const response = await this.executeRequest(payload);
    return response.data.map(entry => entry.embedding);
  }

  prepareAgentText(agent: SemanticAgentRecord): string {
    const skills = Array.isArray(agent.tags) ? `Tags: ${agent.tags.join(', ')}` : '';
    const capabilities = Array.isArray(agent.capabilities)
      ? `Capabilities: ${agent.capabilities.join(', ')}`
      : '';
    const inputs = Array.isArray(agent.defaultInputModes)
      ? `Inputs: ${agent.defaultInputModes.join(', ')}`
      : '';
    const outputs = Array.isArray(agent.defaultOutputModes)
      ? `Outputs: ${agent.defaultOutputModes.join(', ')}`
      : '';

    return [
      agent.name,
      agent.description,
      skills,
      capabilities,
      inputs,
      outputs,
      this.serializeMetadata(agent.metadata),
    ]
      .filter(Boolean)
      .join('. ');
  }

  private async executeRequest(body: Record<string, unknown>): Promise<VeniceEmbeddingResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.baseUrl, {
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
        throw new Error(`Venice embedding request failed: ${response.status} ${errorText}`);
      }

      return (await response.json()) as VeniceEmbeddingResponse;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Venice embedding request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private serializeMetadata(metadata?: Record<string, unknown>): string {
    if (!metadata) {
      return '';
    }

    const entries = Object.entries(metadata)
      .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
      .map(([key, value]) => `${key}: ${String(value)}`);

    return entries.length > 0 ? `Metadata: ${entries.join(', ')}` : '';
  }
}

