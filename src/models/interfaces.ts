/**
 * Core interfaces for Agent0 SDK
 */

import type { AgentId, Address, URI, Timestamp } from './types.js';
import type { EndpointType, TrustModel } from './enums.js';

/**
 * Represents an agent endpoint
 */
export interface Endpoint {
  type: EndpointType;
  value: string; // endpoint value (URL, name, DID, ENS)
  meta?: Record<string, any>; // optional metadata
}

/**
 * Agent registration file structure
 */
export interface RegistrationFile {
  agentId?: AgentId; // None until minted
  agentURI?: URI; // where this file is (or will be) published
  name: string;
  description: string;
  image?: URI;
  walletAddress?: Address;
  walletChainId?: number; // Chain ID for the wallet address
  endpoints: Endpoint[];
  trustModels: (TrustModel | string)[];
  owners: Address[]; // from chain (read-only, hydrated)
  operators: Address[]; // from chain (read-only, hydrated)
  active: boolean; // SDK extension flag
  x402support: boolean; // Binary flag for x402 payment support
  metadata: Record<string, any>; // arbitrary, SDK-managed
  updatedAt: Timestamp;
}

/**
 * Summary information for agent discovery and search
 */
export interface AgentSummary {
  chainId: number; // ChainId
  agentId: AgentId;
  name: string;
  image?: URI;
  description: string;
  owners: Address[];
  operators: Address[];
  mcp: boolean;
  a2a: boolean;
  ens?: string;
  did?: string;
  walletAddress?: Address;
  supportedTrusts: string[]; // normalized string keys
  a2aSkills: string[];
  mcpTools: string[];
  mcpPrompts: string[];
  mcpResources: string[];
  active: boolean;
  x402support: boolean;
  extras: Record<string, any>;
}

/**
 * Feedback data structure
 */
export interface Feedback {
  id: FeedbackIdTuple; // (agentId, clientAddress, feedbackIndex)
  agentId: AgentId;
  reviewer: Address;
  score?: number; // 0-100
  tags: string[];
  /**
   * Optional on-chain field in ERC-8004 Jan 2026.
   * Prefer the on-chain value; only fall back to off-chain feedback file if missing.
   */
  endpoint?: string;
  text?: string;
  context?: Record<string, any>;
  proofOfPayment?: Record<string, any>;
  fileURI?: URI;
  createdAt: Timestamp;
  answers: Array<Record<string, any>>;
  isRevoked: boolean;

  // Off-chain only fields (not stored on blockchain)
  capability?: string; // MCP capability: "prompts", "resources", "tools", "completions"
  name?: string; // MCP tool/resource name
  skill?: string; // A2A skill
  task?: string; // A2A task
}

/**
 * Off-chain feedback file content.
 *
 * This is only uploaded (IPFS/Pinata/Filecoin/node) when you have rich fields that
 * do not fit on-chain. It intentionally does NOT include on-chain fields like:
 * score, tag1, tag2, endpoint.
 */
export interface FeedbackFileInput {
  text?: string;
  context?: Record<string, any>;
  proofOfPayment?: Record<string, any>;

  // Off-chain only fields
  capability?: string; // MCP capability: "prompts", "resources", "tools", "completions"
  name?: string; // MCP tool/resource name
  skill?: string; // A2A skill
  task?: string; // A2A task

  // Allow callers to add extra keys if needed
  [key: string]: any;
}

/**
 * Feedback ID tuple: [agentId, clientAddress, feedbackIndex]
 */
export type FeedbackIdTuple = [AgentId, Address, number];

/**
 * Feedback ID string format: "agentId:clientAddress:feedbackIndex"
 */
export type FeedbackId = string;

/**
 * Parameters for agent search
 */
export interface SearchParams {
  chains?: number[] | 'all'; // ChainId[] or 'all' to search all configured chains
  name?: string; // case-insensitive substring
  description?: string; // semantic; vector distance < threshold
  query?: string; // Natural language query for semantic search (enables semantic search when provided)
  owners?: Address[];
  operators?: Address[];
  mcp?: boolean;
  a2a?: boolean;
  ens?: string; // exact, case-insensitive
  did?: string; // exact
  walletAddress?: Address;
  supportedTrust?: string[];
  a2aSkills?: string[];
  mcpTools?: string[];
  mcpPrompts?: string[];
  mcpResources?: string[];
  active?: boolean;
  x402support?: boolean;
  minScore?: number; // Minimum similarity score (0.0-1.0) for semantic search (only used when query is provided)
}

/**
 * Paging/sort options for search calls.
 */
export interface SearchOptions {
  sort?: string[];
  pageSize?: number;
  cursor?: string;
}

/**
 * Filters for reputation-based agent search.
 * (Matches the criteria portion of the Jan 2026 SDK search API; excludes paging/sort/chains.)
 */
export interface ReputationSearchFilters {
  agents?: AgentId[];
  tags?: string[];
  reviewers?: Address[];
  capabilities?: string[];
  skills?: string[];
  tasks?: string[];
  names?: string[];
  minAverageScore?: number;
}

export interface ReputationSearchOptions extends SearchOptions {
  includeRevoked?: boolean;
  chains?: number[] | 'all';
}

/**
 * Parameters for feedback search
 */
export interface SearchFeedbackParams {
  agents?: AgentId[];
  tags?: string[];
  reviewers?: Address[];
  capabilities?: string[];
  skills?: string[];
  tasks?: string[];
  names?: string[]; // MCP tool/resource/prompt names
  minScore?: number; // 0-100
  maxScore?: number; // 0-100
  includeRevoked?: boolean;
}

/**
 * Filters for agent feedback search scoped to a single agentId.
 */
export interface FeedbackSearchFilters {
  agentId: AgentId;
  tags?: string[];
  reviewers?: Address[];
  capabilities?: string[];
  skills?: string[];
  tasks?: string[];
  names?: string[];
  includeRevoked?: boolean;
}

export interface FeedbackSearchOptions {
  minScore?: number; // 0-100
  maxScore?: number; // 0-100
}

/**
 * Metadata for multi-chain search results
 */
export interface SearchResultMeta {
  chains: number[]; // ChainId[]
  successfulChains: number[]; // ChainId[]
  failedChains: number[]; // ChainId[]
  totalResults: number;
  timing: {
    totalMs: number;
    averagePerChainMs?: number;
  };
}

