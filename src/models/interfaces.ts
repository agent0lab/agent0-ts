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

