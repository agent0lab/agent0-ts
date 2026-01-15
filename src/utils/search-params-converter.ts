/**
 * Utility to convert SearchParams to StandardFilters format
 * for semantic search API compatibility
 */

import type { SearchParams } from '../models/interfaces.js';
import type { StandardFilters } from '../models/semantic-search-types.js';

/**
 * Convert SearchParams to StandardFilters format
 */
export function convertSearchParamsToFilters(params: SearchParams): StandardFilters {
  const filters: StandardFilters = {};

  // Chains - handled separately via chains parameter, not filters
  // (but we can add it to filters.in.chainId if needed for consistency)

  // Owners - semantic search API has 'owner' (single) field
  // For single owner, use equals; for multiple owners, use in operator
  // Note: The semantic search API supports 'owner' as a single field, so for multiple owners
  // we'll use filters.in.operators as a workaround (though semantically operators != owners)
  // A better approach would be to filter client-side or use multiple queries
  if (params.owners && params.owners.length > 0) {
    if (params.owners.length === 1) {
      // Single owner - use equals
      if (!filters.equals) filters.equals = {};
      filters.equals.owner = params.owners[0];
    } else {
      // Multiple owners - use in operator on operators field as workaround
      // TODO: Semantic search API should support filtering by owner array directly
      if (!filters.in) filters.in = {};
      // Note: This is a limitation - we're using operators field for owners
      // The semantic search API should ideally support filters.in.owner
      filters.in.operators = params.owners;
    }
  }

  // Operators - use in operator (array)
  if (params.operators && params.operators.length > 0) {
    if (!filters.in) filters.in = {};
    filters.in.operators = params.operators;
  }

  // MCP - use exists operator
  if (params.mcp === true) {
    if (!filters.exists) filters.exists = [];
    filters.exists.push('mcpEndpoint');
  } else if (params.mcp === false) {
    if (!filters.notExists) filters.notExists = [];
    filters.notExists.push('mcpEndpoint');
  }

  // A2A - use exists operator
  if (params.a2a === true) {
    if (!filters.exists) filters.exists = [];
    filters.exists.push('a2aEndpoint');
  } else if (params.a2a === false) {
    if (!filters.notExists) filters.notExists = [];
    filters.notExists.push('a2aEndpoint');
  }

  // ENS - use equals operator
  if (params.ens) {
    if (!filters.equals) filters.equals = {};
    filters.equals.ens = params.ens;
  }

  // DID - use equals operator
  if (params.did) {
    if (!filters.equals) filters.equals = {};
    filters.equals.did = params.did;
  }

  // Wallet Address - use equals operator
  if (params.walletAddress) {
    if (!filters.equals) filters.equals = {};
    filters.equals.agentWallet = params.walletAddress;
  }

  // Supported Trust - use in operator (array)
  if (params.supportedTrust && params.supportedTrust.length > 0) {
    if (!filters.in) filters.in = {};
    filters.in.supportedTrusts = params.supportedTrust;
  }

  // A2A Skills - use in operator (array)
  if (params.a2aSkills && params.a2aSkills.length > 0) {
    if (!filters.in) filters.in = {};
    filters.in.a2aSkills = params.a2aSkills;
  }

  // MCP Tools - use in operator (array)
  if (params.mcpTools && params.mcpTools.length > 0) {
    if (!filters.in) filters.in = {};
    filters.in.mcpTools = params.mcpTools;
  }

  // MCP Prompts - use in operator (array)
  if (params.mcpPrompts && params.mcpPrompts.length > 0) {
    if (!filters.in) filters.in = {};
    filters.in.mcpPrompts = params.mcpPrompts;
  }

  // MCP Resources - use in operator (array)
  if (params.mcpResources && params.mcpResources.length > 0) {
    if (!filters.in) filters.in = {};
    filters.in.mcpResources = params.mcpResources;
  }

  // Active - use equals operator
  if (params.active !== undefined) {
    if (!filters.equals) filters.equals = {};
    filters.equals.active = params.active;
  }

  // X402 Support - use equals operator
  if (params.x402support !== undefined) {
    if (!filters.equals) filters.equals = {};
    filters.equals.x402support = params.x402support;
  }

  return filters;
}

