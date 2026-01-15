/**
 * Standard API v1 types matching the Universal Agent Semantic Search API Standard v1.0
 * These types are used for semantic search integration
 */

// Filter Operators
export interface StandardFilters {
  equals?: Record<string, unknown>;
  in?: Record<string, unknown[]>;
  notIn?: Record<string, unknown[]>;
  exists?: string[];
  notExists?: string[];
}

// Search Request
export interface StandardSearchRequest {
  query: string;
  limit?: number;
  offset?: number;
  cursor?: string;
  filters?: StandardFilters;
  minScore?: number;
  includeMetadata?: boolean;
  // Optional extensions for SearchParams compatibility
  name?: string; // Substring search for name (post-filtered)
  chains?: number[] | 'all'; // Multi-chain search support
  sort?: string[]; // Sort by fields (e.g., ["updatedAt:desc", "name:asc"])
}

// Pagination Metadata
export interface PaginationMetadata {
  hasMore: boolean;
  nextCursor?: string;
  limit: number;
  offset?: number;
}

// Search Result
export interface StandardSearchResult {
  rank: number;
  vectorId: string;
  agentId: string;
  chainId: number;
  name: string;
  description: string;
  score: number;
  metadata?: StandardMetadata;
  matchReasons?: string[];
}

// Standard Metadata (AgentRegistrationFile fields)
export interface StandardMetadata {
  id?: string;
  cid?: string;
  agentId?: string;
  name?: string;
  description?: string;
  image?: string;
  active?: boolean;
  x402support?: boolean;
  supportedTrusts?: string[];
  mcpEndpoint?: string;
  mcpVersion?: string;
  a2aEndpoint?: string;
  a2aVersion?: string;
  ens?: string;
  did?: string;
  agentWallet?: string;
  agentWalletChainId?: number;
  mcpTools?: string[];
  mcpPrompts?: string[];
  mcpResources?: string[];
  a2aSkills?: string[];
  agentURI?: string;
  createdAt?: number;
  updatedAt?: string;
  // Additional fields from current implementation
  capabilities?: string[];
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  tags?: string[];
  owner?: string;
  operators?: string[];
  mcp?: boolean;
  a2a?: boolean;
  [key: string]: unknown;
}

// Search Response
export interface StandardSearchResponse {
  query: string;
  results: StandardSearchResult[];
  total: number;
  pagination?: PaginationMetadata;
  requestId: string;
  timestamp: string;
  provider: {
    name: string;
    version: string;
  };
}

// Error Response
export interface StandardErrorResponse {
  error: string;
  code: 'VALIDATION_ERROR' | 'RATE_LIMIT_EXCEEDED' | 'INTERNAL_ERROR' | 'BAD_REQUEST' | 'NOT_FOUND' | 'UNKNOWN_ERROR';
  status: number;
  requestId?: string;
  timestamp: string;
}

