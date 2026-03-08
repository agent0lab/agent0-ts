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
  /**
   * Endpoint strings (new unified search + Jan 2026 schema).
   * Present when the agent's registration file advertises the endpoint.
   */
  mcp?: string;
  a2a?: string;
  web?: string;
  email?: string;
  ens?: string;
  did?: string;
  walletAddress?: Address;
  supportedTrusts: string[]; // normalized string keys
  a2aSkills: string[];
  mcpTools: string[];
  mcpPrompts: string[];
  mcpResources: string[];
  oasfSkills: string[];
  oasfDomains: string[];
  active: boolean;
  x402support: boolean;
  /**
   * New optional top-level fields (preferred over putting these into extras).
   */
  createdAt?: number; // unix seconds
  updatedAt?: number; // unix seconds
  lastActivity?: number; // unix seconds
  agentURI?: string;
  agentURIType?: string;
  feedbackCount?: number;
  averageValue?: number;
  semanticScore?: number;

  /**
   * Reserved for experimental fields.
   */
  extras: Record<string, any>;
}

/**
 * Feedback data structure
 */
export interface Feedback {
  id: FeedbackIdTuple; // (agentId, clientAddress, feedbackIndex)
  agentId: AgentId;
  reviewer: Address;
  /**
   * Transaction hash for the on-chain feedback write (when created via SDK).
   * Optional because:
   * - some callers may construct Feedback objects from subgraph data, and
   * - older SDK builds did not include it.
   */
  txHash?: string;
  value?: number;
  tags: string[];
  /**
   * Optional on-chain field in ERC-8004 Jan 2026.
   * Prefer the on-chain value; only fall back to off-chain feedback file if missing.
   */
  endpoint?: string;
  text?: string;
  proofOfPayment?: Record<string, any>;
  fileURI?: URI;
  createdAt: Timestamp;
  answers: Array<Record<string, any>>;
  isRevoked: boolean;

  // Subgraph FeedbackFile fields (spec-aligned)
  mcpTool?: string;
  mcpPrompt?: string;
  mcpResource?: string;
  a2aSkills?: string[];
  a2aContextId?: string;
  a2aTaskId?: string;
  oasfSkills?: string[];
  oasfDomains?: string[];
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
  proofOfPayment?: Record<string, any>;

  // Spec-aligned FeedbackFile fields (subgraph)
  mcpTool?: string;
  mcpPrompt?: string;
  mcpResource?: string;
  a2aSkills?: string[];
  a2aContextId?: string;
  a2aTaskId?: string;
  oasfSkills?: string[];
  oasfDomains?: string[];

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
export interface FeedbackFilters {
  hasFeedback?: boolean;
  hasNoFeedback?: boolean;
  includeRevoked?: boolean;
  minValue?: number;
  maxValue?: number;
  minCount?: number;
  maxCount?: number;
  fromReviewers?: Address[];
  endpoint?: string; // substring match
  hasResponse?: boolean;
  tag1?: string;
  tag2?: string;
  tag?: string; // matches tag1 OR tag2
}

export interface SearchFilters {
  // Chain / identity
  chains?: number[] | 'all';
  agentIds?: AgentId[];

  // Text
  name?: string; // substring
  description?: string; // substring

  // Owners / operators
  owners?: Address[];
  operators?: Address[];

  // Endpoint existence
  hasRegistrationFile?: boolean;
  hasWeb?: boolean;
  hasMCP?: boolean;
  hasA2A?: boolean;
  hasOASF?: boolean;
  hasEndpoints?: boolean;

  // Endpoint substring contains
  webContains?: string;
  mcpContains?: string;
  a2aContains?: string;
  ensContains?: string;
  didContains?: string;

  // Wallet
  walletAddress?: Address;

  // Capability arrays (ANY semantics)
  supportedTrust?: string[];
  a2aSkills?: string[];
  mcpTools?: string[];
  mcpPrompts?: string[];
  mcpResources?: string[];
  oasfSkills?: string[];
  oasfDomains?: string[];

  // Status
  active?: boolean;
  x402support?: boolean;

  // Time filters (developer friendly; SDK normalizes to unix seconds)
  registeredAtFrom?: Date | string | number;
  registeredAtTo?: Date | string | number;
  updatedAtFrom?: Date | string | number;
  updatedAtTo?: Date | string | number;

  // Metadata filters (two-phase)
  hasMetadataKey?: string;
  metadataValue?: { key: string; value: string };

  // Semantic search
  keyword?: string;

  // Feedback filters (two-phase)
  feedback?: FeedbackFilters;
}

/**
 * Paging/sort options for search calls.
 */
export interface SearchOptions {
  sort?: string[];
  semanticMinScore?: number;
  semanticTopK?: number;
}

/**
 * Filters for reputation-based agent search.
 * (Matches the criteria portion of the Jan 2026 SDK search API; excludes paging/sort/chains.)
 */
// Note: `searchAgentsByReputation` has been removed in favor of unified `searchAgents()`.

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
  minValue?: number;
  maxValue?: number;
  includeRevoked?: boolean;
}

/**
 * Filters for feedback search.
 *
 * Backwards compatible:
 * - `agentId` used to be required; it is now optional.
 *
 * New:
 * - `agents` allows searching across multiple agents in one call.
 */
export interface FeedbackSearchFilters {
  agentId?: AgentId;
  agents?: AgentId[];
  tags?: string[];
  reviewers?: Address[];
  capabilities?: string[];
  skills?: string[];
  tasks?: string[];
  names?: string[];
  includeRevoked?: boolean;
}

export interface FeedbackSearchOptions {
  minValue?: number;
  maxValue?: number;
}

/**
 * Metadata for multi-chain search results
 */
// Note: Pagination has been removed; search APIs now return full result lists.

