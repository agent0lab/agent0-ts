/**
 * Custom error classes for semantic search API errors
 */

import type { StandardErrorResponse } from '../models/semantic-search-types.js';

/**
 * Base class for semantic search errors
 */
export class SemanticSearchError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly requestId?: string;
  public readonly timestamp?: string;
  public readonly retryAfter?: number;

  constructor(
    message: string,
    code: string,
    status: number,
    requestId?: string,
    timestamp?: string,
    retryAfter?: number
  ) {
    super(message);
    this.name = 'SemanticSearchError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.timestamp = timestamp;
    this.retryAfter = retryAfter;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SemanticSearchError);
    }
  }

  /**
   * Create error from API error response
   */
  static fromErrorResponse(
    errorData: StandardErrorResponse,
    status: number,
    retryAfter?: number
  ): SemanticSearchError {
    const code = errorData.code || 'UNKNOWN_ERROR';
    
    switch (code) {
      case 'RATE_LIMIT_EXCEEDED':
        return new RateLimitError(
          errorData.error || 'Rate limit exceeded',
          errorData.requestId,
          errorData.timestamp,
          retryAfter
        );
      case 'VALIDATION_ERROR':
        return new ValidationError(
          errorData.error || 'Validation error',
          errorData.requestId,
          errorData.timestamp
        );
      case 'INTERNAL_ERROR':
        return new InternalServerError(
          errorData.error || 'Internal server error',
          errorData.requestId,
          errorData.timestamp
        );
      case 'BAD_REQUEST':
        return new BadRequestError(
          errorData.error || 'Bad request',
          errorData.requestId,
          errorData.timestamp
        );
      case 'NOT_FOUND':
        return new NotFoundError(
          errorData.error || 'Resource not found',
          errorData.requestId,
          errorData.timestamp
        );
      default:
        return new SemanticSearchError(
          errorData.error || `Semantic search failed with status ${status}`,
          code,
          status,
          errorData.requestId,
          errorData.timestamp,
          retryAfter
        );
    }
  }
}

/**
 * Rate limit exceeded error
 */
export class RateLimitError extends SemanticSearchError {
  constructor(
    message: string = 'Rate limit exceeded. Please try again later.',
    requestId?: string,
    timestamp?: string,
    retryAfter?: number
  ) {
    const retryMessage = retryAfter
      ? `${message} Retry after ${retryAfter} seconds.`
      : message;
    
    super(
      retryMessage,
      'RATE_LIMIT_EXCEEDED',
      429,
      requestId,
      timestamp,
      retryAfter
    );
    this.name = 'RateLimitError';
  }

  /**
   * Get retry delay in milliseconds
   */
  getRetryDelayMs(): number {
    return (this.retryAfter || 60) * 1000;
  }
}

/**
 * Validation error (400)
 */
export class ValidationError extends SemanticSearchError {
  constructor(
    message: string = 'Invalid request. Please check your query parameters.',
    requestId?: string,
    timestamp?: string
  ) {
    super(message, 'VALIDATION_ERROR', 400, requestId, timestamp);
    this.name = 'ValidationError';
  }
}

/**
 * Bad request error (400)
 */
export class BadRequestError extends SemanticSearchError {
  constructor(
    message: string = 'Bad request. Please check your request format.',
    requestId?: string,
    timestamp?: string
  ) {
    super(message, 'BAD_REQUEST', 400, requestId, timestamp);
    this.name = 'BadRequestError';
  }
}

/**
 * Internal server error (500)
 */
export class InternalServerError extends SemanticSearchError {
  constructor(
    message: string = 'Internal server error. Please try again later or contact support.',
    requestId?: string,
    timestamp?: string
  ) {
    super(message, 'INTERNAL_ERROR', 500, requestId, timestamp);
    this.name = 'InternalServerError';
  }
}

/**
 * Not found error (404)
 */
export class NotFoundError extends SemanticSearchError {
  constructor(
    message: string = 'Resource not found.',
    requestId?: string,
    timestamp?: string
  ) {
    super(message, 'NOT_FOUND', 404, requestId, timestamp);
    this.name = 'NotFoundError';
  }
}

/**
 * Network error (connection issues, timeouts, etc.)
 */
export class NetworkError extends SemanticSearchError {
  constructor(
    message: string = 'Network error. Please check your connection and try again.',
    originalError?: Error
  ) {
    super(
      originalError ? `${message} Original error: ${originalError.message}` : message,
      'NETWORK_ERROR',
      0
    );
    this.name = 'NetworkError';
    
    if (originalError?.stack) {
      this.stack = originalError.stack;
    }
  }
}

