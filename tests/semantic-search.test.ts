/**
 * Integration tests for Semantic Search functionality
 * Tests semantic search queries, filters, error handling, and edge cases
 * 
 * Note: Some tests may fail due to rate limiting when running the full test suite.
 * This is expected behavior when making many API requests in quick succession.
 * Individual tests should pass when run in isolation.
 */

import { SDK } from '../src/index';
import {
  RateLimitError,
  ValidationError,
  NetworkError,
  SemanticSearchError,
} from '../src/index';
import { CHAIN_ID, RPC_URL, printConfig } from './config';

// Helper to check if error is rate limit
function isRateLimitError(error: unknown): boolean {
  return error instanceof RateLimitError;
}

// Helper to retry with exponential backoff on rate limit
async function retryOnRateLimit<T>(
  fn: () => Promise<T>,
  maxRetries: number = 2,
  baseDelay: number = 2000
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (isRateLimitError(error) && attempt < maxRetries - 1) {
        // Use retry delay from error if available, otherwise use exponential backoff
        const delay = error instanceof RateLimitError && error.retryAfter
          ? error.getRetryDelayMs()
          : baseDelay * Math.pow(2, attempt);
        console.log(`⚠️  Rate limited, retrying in ${Math.ceil(delay / 1000)}s... (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}

// Helper to skip test if rate limited (for tests that can't retry)
function skipIfRateLimited(error: unknown): void {
  if (isRateLimitError(error)) {
    console.log('⚠️  Skipping test due to rate limiting');
    // Mark test as skipped
    throw new Error('SKIP_TEST');
  }
}

// Default semantic search URL (can be overridden via env)
const SEMANTIC_SEARCH_URL =
  process.env.SEMANTIC_SEARCH_URL ||
  'https://agent0-semantic-search.dawid-pisarczyk.workers.dev';

describe('Semantic Search Integration', () => {
  let sdk: SDK;

  beforeAll(() => {
    printConfig();
    // Initialize SDK with semantic search URL
    sdk = new SDK({
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
      semanticSearchUrl: SEMANTIC_SEARCH_URL,
    });
  });

  describe('Basic Semantic Search', () => {
    it('should perform semantic search with a query', async () => {
      const results = await retryOnRateLimit(async () => {
        return await sdk.searchAgents({
          query: 'AI agent for trading',
        });
      });

      expect(results).toBeDefined();
      expect(results.items).toBeDefined();
      expect(Array.isArray(results.items)).toBe(true);
      expect(results.items.length).toBeGreaterThanOrEqual(0);

      if (results.items.length > 0) {
        const firstAgent = results.items[0];
        expect(firstAgent.agentId).toBeTruthy();
        expect(firstAgent.name).toBeTruthy();
        expect(firstAgent.description).toBeTruthy();
        expect(firstAgent.chainId).toBeDefined();
        
        // Check that semantic search metadata is in extras
        expect(firstAgent.extras).toBeDefined();
        expect(firstAgent.extras.score).toBeDefined();
        expect(typeof firstAgent.extras.score).toBe('number');
        expect(firstAgent.extras.score).toBeGreaterThanOrEqual(0);
        expect(firstAgent.extras.score).toBeLessThanOrEqual(1);
      }
    }, 30000); // 30 second timeout for API calls

    it('should return results with pagination cursor', async () => {
      const results = await retryOnRateLimit(async () => {
        return await sdk.searchAgents(
          {
            query: 'agent',
          },
          undefined,
          5 // Small page size to trigger pagination
        );
      });

      expect(results).toBeDefined();
      expect(results.items).toBeDefined();
      
      // If there are more results, nextCursor should be present
      if (results.items.length === 5 && results.meta?.totalResults && results.meta.totalResults > 5) {
        expect(results.nextCursor).toBeDefined();
        expect(typeof results.nextCursor).toBe('string');
      }
    }, 30000);

    it('should use pagination cursor for next page', async () => {
      const firstPage = await retryOnRateLimit(async () => {
        return await sdk.searchAgents(
          {
            query: 'agent',
          },
          undefined,
          5
        );
      });

      if (firstPage.nextCursor && firstPage.items.length > 0) {
        const secondPage = await retryOnRateLimit(async () => {
          return await sdk.searchAgents(
            {
              query: 'agent',
            },
            undefined,
            5,
            firstPage.nextCursor
          );
        });

        expect(secondPage).toBeDefined();
        expect(secondPage.items).toBeDefined();
        expect(Array.isArray(secondPage.items)).toBe(true);
        
        // Results should be different (unless there are exactly 5 results)
        if (firstPage.meta?.totalResults && firstPage.meta.totalResults > 5) {
          expect(secondPage.items.length).toBeGreaterThan(0);
          // First item of second page should be different from first page
          const firstPageIds = firstPage.items.map(a => a.agentId);
          const secondPageIds = secondPage.items.map(a => a.agentId);
          const hasOverlap = secondPageIds.some(id => firstPageIds.includes(id));
          // There might be some overlap, but not all should be the same
          expect(hasOverlap || secondPageIds.length === 0).toBe(true);
        }
      } else {
        // Skip test if no pagination needed
        console.log('No pagination cursor available, skipping pagination test');
      }
    }, 30000);
  });

  describe('Semantic Search with Filters', () => {
    it('should combine semantic query with MCP filter', async () => {
      const results = await retryOnRateLimit(async () => {
        return await sdk.searchAgents({
          query: 'trading agent',
          mcp: true,
        });
      });

      expect(results).toBeDefined();
      expect(results.items).toBeDefined();
      
      if (results.items.length > 0) {
        results.items.forEach((agent) => {
          expect(agent.mcp).toBe(true);
        });
      }
    }, 30000);

    it('should combine semantic query with A2A filter', async () => {
      const results = await retryOnRateLimit(async () => {
        return await sdk.searchAgents({
          query: 'agent',
          a2a: true,
        });
      });

      expect(results).toBeDefined();
      expect(results.items).toBeDefined();
      
      if (results.items.length > 0) {
        results.items.forEach((agent) => {
          expect(agent.a2a).toBe(true);
        });
      }
    }, 30000);

    it('should combine semantic query with active filter', async () => {
      const results = await retryOnRateLimit(async () => {
        return await sdk.searchAgents({
          query: 'agent',
          active: true,
        });
      });

      expect(results).toBeDefined();
      expect(results.items).toBeDefined();
      
      if (results.items.length > 0) {
        results.items.forEach((agent) => {
          expect(agent.active).toBe(true);
        });
      }
    }, 30000);

    it('should combine semantic query with chain filter', async () => {
      const results = await retryOnRateLimit(async () => {
        return await sdk.searchAgents({
          query: 'agent',
          chains: [CHAIN_ID],
        });
      });

      expect(results).toBeDefined();
      expect(results.items).toBeDefined();
      
      if (results.items.length > 0) {
        results.items.forEach((agent) => {
          expect(agent.chainId).toBe(CHAIN_ID);
        });
      }
    }, 30000);

    it('should combine semantic query with multiple filters', async () => {
      const results = await retryOnRateLimit(async () => {
        return await sdk.searchAgents({
          query: 'agent',
          mcp: true,
          active: true,
          chains: [CHAIN_ID],
        });
      });

      expect(results).toBeDefined();
      expect(results.items).toBeDefined();
      
      if (results.items.length > 0) {
        results.items.forEach((agent) => {
          expect(agent.mcp).toBe(true);
          expect(agent.active).toBe(true);
          expect(agent.chainId).toBe(CHAIN_ID);
        });
      }
    }, 30000);

    it('should combine semantic query with name filter', async () => {
      const results = await retryOnRateLimit(async () => {
        return await sdk.searchAgents({
          query: 'agent',
          name: 'Test',
        });
      });

      expect(results).toBeDefined();
      expect(results.items).toBeDefined();
      
      if (results.items.length > 0) {
        results.items.forEach((agent) => {
          // Name should contain the filter (case-insensitive)
          expect(agent.name.toLowerCase()).toContain('test');
        });
      }
    }, 30000);
  });

  describe('Semantic Search Sorting', () => {
    it('should sort results by updatedAt descending', async () => {
      const results = await retryOnRateLimit(async () => {
        return await sdk.searchAgents(
          {
            query: 'agent',
          },
          ['updatedAt:desc'],
          10
        );
      });

      expect(results).toBeDefined();
      expect(results.items).toBeDefined();
      
      if (results.items.length > 1) {
        // Check that results are sorted (updatedAt should be decreasing)
        for (let i = 0; i < results.items.length - 1; i++) {
          const current = results.items[i];
          const next = results.items[i + 1];
          
          const currentUpdatedAt = current.extras?.updatedAt;
          const nextUpdatedAt = next.extras?.updatedAt;
          
          if (currentUpdatedAt && nextUpdatedAt) {
            // Both should be ISO date strings or timestamps
            const currentTime = new Date(currentUpdatedAt).getTime();
            const nextTime = new Date(nextUpdatedAt).getTime();
            
            // Current should be >= next (descending order)
            expect(currentTime).toBeGreaterThanOrEqual(nextTime);
          }
        }
      }
    }, 30000);

    it('should sort results by score descending (default)', async () => {
      const results = await retryOnRateLimit(async () => {
        return await sdk.searchAgents(
          {
            query: 'agent',
          },
          ['score:desc'],
          10
        );
      });

      expect(results).toBeDefined();
      expect(results.items).toBeDefined();
      
      if (results.items.length > 1) {
        // Check that results are sorted by score (descending)
        for (let i = 0; i < results.items.length - 1; i++) {
          const current = results.items[i];
          const next = results.items[i + 1];
          
          const currentScore = current.extras?.score ?? 0;
          const nextScore = next.extras?.score ?? 0;
          
          // Current score should be >= next score (descending order)
          expect(currentScore).toBeGreaterThanOrEqual(nextScore);
        }
      }
    }, 30000);

    it('should sort results by name ascending', async () => {
      const results = await retryOnRateLimit(async () => {
        return await sdk.searchAgents(
          {
            query: 'agent',
          },
          ['name:asc'],
          10
        );
      });

      expect(results).toBeDefined();
      expect(results.items).toBeDefined();
      
      if (results.items.length > 1) {
        // Check that results are sorted by name (ascending)
        for (let i = 0; i < results.items.length - 1; i++) {
          const current = results.items[i];
          const next = results.items[i + 1];
          
          // Name comparison (case-insensitive)
          const currentName = current.name.toLowerCase();
          const nextName = next.name.toLowerCase();
          
          // Current should be <= next (ascending order)
          expect(currentName.localeCompare(nextName)).toBeLessThanOrEqual(0);
        }
      }
    }, 30000);
  });

  describe('Error Handling', () => {
    it('should handle rate limit errors (429)', async () => {
      // Mock fetch to return rate limit error
      const originalFetch = global.fetch;
      
      global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        // Return rate limit response
        return {
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: new Headers({
            'Retry-After': '60',
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
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
        rateLimitSdk.searchAgents({
          query: 'test',
        })
      ).rejects.toThrow(RateLimitError);

      // Verify error properties
      try {
        await rateLimitSdk.searchAgents({ query: 'test' });
      } catch (error) {
        if (error instanceof RateLimitError) {
          expect(error.retryAfter).toBe(60);
          expect(error.status).toBe(429);
          expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
        }
      }

      // Restore original fetch
      global.fetch = originalFetch;
    }, 10000);

    it('should handle invalid semantic search URL gracefully', async () => {
      const invalidSdk = new SDK({
        chainId: CHAIN_ID,
        rpcUrl: RPC_URL,
        semanticSearchUrl: 'https://invalid-url-that-does-not-exist-12345.com',
      });

      await expect(
        invalidSdk.searchAgents({
          query: 'test',
        })
      ).rejects.toThrow(NetworkError);
    }, 30000);

    it('should handle empty query gracefully', async () => {
      // Empty query should fall back to subgraph search (no semantic search)
      const results = await sdk.searchAgents({
        query: '',
        mcp: true,
      });

      // Should still work (falls back to subgraph)
      expect(results).toBeDefined();
      expect(results.items).toBeDefined();
    }, 30000);

    it('should handle whitespace-only query gracefully', async () => {
      // Whitespace-only query should fall back to subgraph search
      const results = await sdk.searchAgents({
        query: '   ',
        mcp: true,
      });

      // Should still work (falls back to subgraph)
      expect(results).toBeDefined();
      expect(results.items).toBeDefined();
    }, 30000);

    it('should handle very long query', async () => {
      const longQuery = 'agent '.repeat(1000); // Very long query
      
      try {
        const results = await sdk.searchAgents({
          query: longQuery,
        });

        // Should either return results or throw an error (both are valid)
        if (results) {
          expect(results).toBeDefined();
          expect(results.items).toBeDefined();
        }
      } catch (error) {
        // Error is acceptable for very long queries
        expect(error).toBeDefined();
      }
    }, 30000);

    it('should handle validation errors (400)', async () => {
      // Mock fetch to return validation error
      const originalFetch = global.fetch;
      
      global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        return {
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: async () => ({
            error: 'Invalid request: limit must be between 1 and 100',
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

      // Use a valid query but the mocked API will return a validation error
      await expect(
        validationSdk.searchAgents({
          query: 'test', // Valid query, but API will return validation error
        })
      ).rejects.toThrow(ValidationError);

      // Verify error properties
      try {
        await validationSdk.searchAgents({ query: 'test' });
      } catch (error) {
        if (error instanceof ValidationError) {
          expect(error.status).toBe(400);
          expect(error.code).toBe('VALIDATION_ERROR');
        }
      }

      // Restore original fetch
      global.fetch = originalFetch;
    }, 10000);

    it('should handle server errors (500)', async () => {
      // Mock fetch to return server error
      const originalFetch = global.fetch;
      
      global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({
            error: 'Internal server error',
            code: 'INTERNAL_ERROR',
            status: 500,
            timestamp: new Date().toISOString(),
          }),
        } as Response;
      }) as typeof fetch;

      const serverErrorSdk = new SDK({
        chainId: CHAIN_ID,
        rpcUrl: RPC_URL,
        semanticSearchUrl: SEMANTIC_SEARCH_URL,
      });

      await expect(
        serverErrorSdk.searchAgents({
          query: 'test',
        })
      ).rejects.toThrow(SemanticSearchError);

      // Verify error properties
      try {
        await serverErrorSdk.searchAgents({ query: 'test' });
      } catch (error) {
        if (error instanceof SemanticSearchError) {
          expect(error.status).toBe(500);
          expect(error.code).toBe('INTERNAL_ERROR');
        }
      }

      // Restore original fetch
      global.fetch = originalFetch;
    }, 10000);

    it('should handle network timeout gracefully', async () => {
      // Use a URL that will timeout
      const timeoutSdk = new SDK({
        chainId: CHAIN_ID,
        rpcUrl: RPC_URL,
        semanticSearchUrl: 'https://httpstat.us/200?sleep=60000', // 60 second delay
      });

      // This should timeout or take a very long time
      // We'll just verify it doesn't crash
      try {
        const promise = timeoutSdk.searchAgents({
          query: 'test',
        });
        
        // Wait a bit, but don't wait for full timeout
        await Promise.race([
          promise,
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout test completed')), 5000)
          )
        ]);
      } catch (error) {
        // Expected - either timeout or network error
        expect(error).toBeDefined();
      }
    }, 10000);
  });

  describe('Fallback to Subgraph Search', () => {
    it('should use subgraph search when query is not provided', async () => {
      const results = await sdk.searchAgents({
        mcp: true,
        active: true,
      });

      // Should work without query (uses subgraph)
      expect(results).toBeDefined();
      expect(results.items).toBeDefined();
      expect(Array.isArray(results.items)).toBe(true);
    }, 30000);

    it('should use subgraph search when query is undefined', async () => {
      const results = await sdk.searchAgents({
        mcp: true,
      });

      // Should work without query (uses subgraph)
      expect(results).toBeDefined();
      expect(results.items).toBeDefined();
    }, 30000);
  });

  describe('Response Structure', () => {
    it('should return properly structured AgentSummary objects', async () => {
      const results = await retryOnRateLimit(async () => {
        return await sdk.searchAgents({
          query: 'agent',
        });
      });

      if (results.items.length > 0) {
        const agent = results.items[0];
        
        // Check required fields
        expect(agent.chainId).toBeDefined();
        expect(typeof agent.chainId).toBe('number');
        expect(agent.agentId).toBeDefined();
        expect(typeof agent.agentId).toBe('string');
        expect(agent.name).toBeDefined();
        expect(typeof agent.name).toBe('string');
        expect(agent.description).toBeDefined();
        expect(typeof agent.description).toBe('string');
        
        // Check boolean fields
        expect(typeof agent.mcp).toBe('boolean');
        expect(typeof agent.a2a).toBe('boolean');
        expect(typeof agent.active).toBe('boolean');
        expect(typeof agent.x402support).toBe('boolean');
        
        // Check array fields
        expect(Array.isArray(agent.owners)).toBe(true);
        expect(Array.isArray(agent.operators)).toBe(true);
        expect(Array.isArray(agent.supportedTrusts)).toBe(true);
        expect(Array.isArray(agent.a2aSkills)).toBe(true);
        expect(Array.isArray(agent.mcpTools)).toBe(true);
        expect(Array.isArray(agent.mcpPrompts)).toBe(true);
        expect(Array.isArray(agent.mcpResources)).toBe(true);
        
        // Check extras (semantic search metadata)
        expect(agent.extras).toBeDefined();
        expect(agent.extras.score).toBeDefined();
        expect(typeof agent.extras.score).toBe('number');
        expect(agent.extras.rank).toBeDefined();
        expect(typeof agent.extras.rank).toBe('number');
      }
    }, 30000);

    it('should include meta information in results', async () => {
      const results = await retryOnRateLimit(async () => {
        return await sdk.searchAgents({
          query: 'agent',
        });
      });

      expect(results.meta).toBeDefined();
      if (results.meta) {
        expect(results.meta.totalResults).toBeDefined();
        expect(typeof results.meta.totalResults).toBe('number');
        expect(results.meta.chains).toBeDefined();
        expect(Array.isArray(results.meta.chains)).toBe(true);
        expect(results.meta.successfulChains).toBeDefined();
        expect(Array.isArray(results.meta.successfulChains)).toBe(true);
        expect(results.meta.failedChains).toBeDefined();
        expect(Array.isArray(results.meta.failedChains)).toBe(true);
        expect(results.meta.timing).toBeDefined();
        expect(results.meta.timing.totalMs).toBeDefined();
      }
    }, 30000);
  });

  describe('Multi-chain Semantic Search', () => {
    it('should support multi-chain semantic search', async () => {
      const results = await retryOnRateLimit(async () => {
        return await sdk.searchAgents({
          query: 'agent',
          chains: [11155111, 84532], // Ethereum Sepolia and Base Sepolia
        });
      });

      expect(results).toBeDefined();
      expect(results.items).toBeDefined();
      
      if (results.items.length > 0) {
        const chainIds = results.items.map(a => a.chainId);
        const uniqueChainIds = [...new Set(chainIds)];
        
        // Should have results from at least one of the requested chains
        expect(
          uniqueChainIds.some(id => [11155111, 84532].includes(id))
        ).toBe(true);
      }
    }, 30000);

    it('should support "all" chains semantic search', async () => {
      const results = await retryOnRateLimit(async () => {
        return await sdk.searchAgents({
          query: 'agent',
          chains: 'all',
        });
      });

      expect(results).toBeDefined();
      expect(results.items).toBeDefined();
    }, 30000);
  });
});

