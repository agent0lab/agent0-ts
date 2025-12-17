/**
 * Client for semantic search API
 * Implements the Universal Agent Semantic Search API Standard v1.0
 */

import type {
  StandardSearchRequest,
  StandardSearchResponse,
  StandardErrorResponse,
} from '../models/semantic-search-types.js';
import {
  SemanticSearchError,
  RateLimitError,
  NetworkError,
} from './semantic-search-errors.js';

export class SemanticSearchClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    // Ensure baseUrl doesn't end with a slash
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * Extract retry-after value from response headers
   */
  private getRetryAfter(headers: Headers): number | undefined {
    const retryAfter = headers.get('Retry-After');
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) {
        return seconds;
      }
      // Try parsing as HTTP date
      const date = new Date(retryAfter);
      if (!isNaN(date.getTime())) {
        return Math.max(0, Math.floor((date.getTime() - Date.now()) / 1000));
      }
    }
    return undefined;
  }

  /**
   * Extract rate limit information from response headers
   */
  private getRateLimitInfo(headers: Headers): {
    limit?: number;
    remaining?: number;
    reset?: number;
  } {
    return {
      limit: headers.get('X-RateLimit-Limit') ? parseInt(headers.get('X-RateLimit-Limit')!, 10) : undefined,
      remaining: headers.get('X-RateLimit-Remaining') ? parseInt(headers.get('X-RateLimit-Remaining')!, 10) : undefined,
      reset: headers.get('X-RateLimit-Reset') ? parseInt(headers.get('X-RateLimit-Reset')!, 10) : undefined,
    };
  }

  /**
   * Perform semantic search
   */
  async searchAgents(request: StandardSearchRequest): Promise<StandardSearchResponse> {
    const url = `${this.baseUrl}/api/v1/search`;
    const requestId = crypto.randomUUID();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': requestId,
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        // Try to parse error response
        let errorData: StandardErrorResponse;
        try {
          errorData = (await response.json()) as StandardErrorResponse;
        } catch {
          // If JSON parsing fails, create a basic error response
          errorData = {
            error: `HTTP ${response.status}: ${response.statusText}`,
            code: response.status === 429 ? 'RATE_LIMIT_EXCEEDED' : 
                  response.status === 400 ? 'BAD_REQUEST' :
                  response.status === 404 ? 'NOT_FOUND' :
                  response.status >= 500 ? 'INTERNAL_ERROR' : 'UNKNOWN_ERROR',
            status: response.status,
            requestId,
            timestamp: new Date().toISOString(),
          };
        }

        // Extract retry-after from headers for rate limit errors
        const retryAfter = this.getRetryAfter(response.headers);
        
        // Create appropriate error type
        const error = SemanticSearchError.fromErrorResponse(
          errorData,
          response.status,
          retryAfter
        );

        // Add rate limit info to error message if available
        if (error instanceof RateLimitError) {
          const rateLimitInfo = this.getRateLimitInfo(response.headers);
          if (rateLimitInfo.limit !== undefined || rateLimitInfo.remaining !== undefined) {
            const infoParts: string[] = [];
            if (rateLimitInfo.limit !== undefined) {
              infoParts.push(`Limit: ${rateLimitInfo.limit}/time period`);
            }
            if (rateLimitInfo.remaining !== undefined) {
              infoParts.push(`Remaining: ${rateLimitInfo.remaining}`);
            }
            if (rateLimitInfo.reset !== undefined) {
              const resetDate = new Date(rateLimitInfo.reset * 1000);
              infoParts.push(`Resets at: ${resetDate.toLocaleString()}`);
            }
            if (infoParts.length > 0) {
              error.message = `${error.message} (${infoParts.join(', ')})`;
            }
          }
        }

        throw error;
      }

      const data = (await response.json()) as StandardSearchResponse;
      return data;
    } catch (error) {
      // Re-throw if it's already a SemanticSearchError
      if (error instanceof SemanticSearchError) {
        throw error;
      }

      // Handle network errors
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new NetworkError(
          `Failed to connect to semantic search service at ${this.baseUrl}. Please check your network connection and ensure the service is accessible.`,
          error as Error
        );
      }

      // Handle other errors
      if (error instanceof Error) {
        // Check if it's a network-related error
        if (error.message.includes('network') || 
            error.message.includes('ECONNREFUSED') ||
            error.message.includes('ENOTFOUND') ||
            error.message.includes('timeout')) {
          throw new NetworkError(
            `Network error while connecting to semantic search service: ${error.message}`,
            error
          );
        }
        throw error;
      }

      throw new NetworkError(`Semantic search request failed: ${String(error)}`);
    }
  }
}

