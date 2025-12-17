/**
 * Unit tests for Semantic Search functionality
 * Tests semantic search integration with the SDK
 */

import { SDK } from '../src/index';
import {
  RateLimitError,
  ValidationError,
  NetworkError,
  SemanticSearchError,
} from '../src/index';
import { CHAIN_ID, RPC_URL, printConfig } from './config';

// Default semantic search URL (can be overridden via env)
const SEMANTIC_SEARCH_URL =
  process.env.SEMANTIC_SEARCH_URL ||
  'https://agent0-semantic-search.dawid-pisarczyk.workers.dev';

describe('Semantic Search', () => {
  let sdk: SDK;

  beforeAll(() => {
    printConfig();
    sdk = new SDK({
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
      semanticSearchUrl: SEMANTIC_SEARCH_URL,
    });
  });

  describe('Basic Functionality', () => {
    it('should perform semantic search with a query', async () => {
      const results = await sdk.searchAgents({
        query: 'AI agent for trading',
      });

      expect(results).toBeDefined();
      expect(results.items).toBeDefined();
      expect(Array.isArray(results.items)).toBe(true);

      if (results.items.length > 0) {
        const firstAgent = results.items[0];
        expect(firstAgent.agentId).toBeTruthy();
        expect(firstAgent.name).toBeTruthy();
        expect(firstAgent.chainId).toBeDefined();
        
        // Check semantic search metadata
        expect(firstAgent.extras).toBeDefined();
        expect(firstAgent.extras.score).toBeDefined();
        expect(typeof firstAgent.extras.score).toBe('number');
      }
    }, 30000);

    it('should fall back to subgraph search when no query provided', async () => {
      const results = await sdk.searchAgents({
        mcp: true,
      });

      expect(results).toBeDefined();
      expect(results.items).toBeDefined();
      expect(Array.isArray(results.items)).toBe(true);
    }, 30000);

    it('should fall back to subgraph search when query is empty', async () => {
      const results = await sdk.searchAgents({
        query: '',
        mcp: true,
      });

      expect(results).toBeDefined();
      expect(results.items).toBeDefined();
    }, 30000);

    it('should support minScore with semantic search', async () => {
      const results = await sdk.searchAgents({
        query: 'AI agent for trading',
        minScore: 0.5, // Only return results with score >= 0.5
      });

      expect(results).toBeDefined();
      expect(results.items).toBeDefined();
      
      // All results should have score >= minScore
      results.items.forEach((agent) => {
        if (agent.extras.score !== undefined) {
          expect(agent.extras.score).toBeGreaterThanOrEqual(0.5);
        }
      });
    }, 30000);

    it('should throw error if minScore is used without query', async () => {
      await expect(
        sdk.searchAgents({
          minScore: 0.5,
          mcp: true,
        })
      ).rejects.toThrow('minScore can only be used with semantic search');
    });
  });

  describe('Error Handling', () => {
    it('should handle rate limit errors (429)', async () => {
      const originalFetch = global.fetch;
      
      global.fetch = (async () => {
        return {
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: new Headers({
            'Retry-After': '60',
          }),
          json: async () => ({
            error: 'Rate limit exceeded',
            code: 'RATE_LIMIT_EXCEEDED',
            status: 429,
            timestamp: new Date().toISOString(),
          }),
        } as Response;
      }) as typeof fetch;

      const rateLimitSdk = new SDK({
        chainId: CHAIN_ID,
        rpcUrl: RPC_URL,
        semanticSearchUrl: SEMANTIC_SEARCH_URL,
      });

      await expect(
        rateLimitSdk.searchAgents({ query: 'test' })
      ).rejects.toThrow(RateLimitError);

      global.fetch = originalFetch;
    });

    it('should handle validation errors (400)', async () => {
      const originalFetch = global.fetch;
      
      global.fetch = (async () => {
        return {
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: async () => ({
            error: 'Invalid request',
            code: 'VALIDATION_ERROR',
            status: 400,
            timestamp: new Date().toISOString(),
          }),
        } as Response;
      }) as typeof fetch;

      const validationSdk = new SDK({
        chainId: CHAIN_ID,
        rpcUrl: RPC_URL,
        semanticSearchUrl: SEMANTIC_SEARCH_URL,
      });

      await expect(
        validationSdk.searchAgents({ query: 'test' })
      ).rejects.toThrow(ValidationError);

      global.fetch = originalFetch;
    });

    it('should handle network errors', async () => {
      const invalidSdk = new SDK({
        chainId: CHAIN_ID,
        rpcUrl: RPC_URL,
        semanticSearchUrl: 'https://invalid-url-that-does-not-exist-12345.com',
      });

      await expect(
        invalidSdk.searchAgents({ query: 'test' })
      ).rejects.toThrow();
    }, 30000);
  });
});
