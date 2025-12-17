/**
 * Utility to map StandardSearchResponse to AgentSummary format
 */

import type { AgentSummary, Endpoint } from '../models/interfaces.js';
import type { StandardSearchResult, StandardMetadata } from '../models/semantic-search-types.js';
import { EndpointType } from '../models/enums.js';
import { parseAgentId } from './id-format.js';

/**
 * Map StandardSearchResult to AgentSummary
 */
export function mapStandardResultToAgentSummary(result: StandardSearchResult): AgentSummary {
  const metadata = result.metadata || {};
  
  // Parse agentId to get chainId and tokenId
  const parsedId = parseAgentId(result.agentId);
  const chainId = parsedId?.chainId ?? result.chainId;
  
  // Extract endpoints
  const endpoints: Endpoint[] = [];
  if (metadata.mcpEndpoint && typeof metadata.mcpEndpoint === 'string') {
    endpoints.push({ type: EndpointType.MCP, value: metadata.mcpEndpoint });
  }
  if (metadata.a2aEndpoint && typeof metadata.a2aEndpoint === 'string') {
    endpoints.push({ type: EndpointType.A2A, value: metadata.a2aEndpoint });
  }
  if (metadata.ens && typeof metadata.ens === 'string') {
    endpoints.push({ type: EndpointType.ENS, value: metadata.ens });
  }
  if (metadata.did && typeof metadata.did === 'string') {
    endpoints.push({ type: EndpointType.DID, value: metadata.did });
  }

  // Extract owners and operators
  const owners: string[] = [];
  if (metadata.owner && typeof metadata.owner === 'string') {
    owners.push(metadata.owner);
  } else if (Array.isArray(metadata.owner)) {
    owners.push(...metadata.owner.filter((o): o is string => typeof o === 'string'));
  }

  const operators: string[] = [];
  if (Array.isArray(metadata.operators)) {
    operators.push(...metadata.operators.filter((o): o is string => typeof o === 'string'));
  }

  // Extract trust models
  const trustModels: string[] = [];
  if (Array.isArray(metadata.supportedTrusts)) {
    trustModels.push(...metadata.supportedTrusts.filter((t): t is string => typeof t === 'string'));
  }

  // Extract capabilities, tags, etc.
  const capabilities: string[] = [];
  if (Array.isArray(metadata.capabilities)) {
    capabilities.push(...metadata.capabilities.filter((c): c is string => typeof c === 'string'));
  }

  const tags: string[] = [];
  if (Array.isArray(metadata.tags)) {
    tags.push(...metadata.tags.filter((t): t is string => typeof t === 'string'));
  }

  const mcpTools: string[] = [];
  if (Array.isArray(metadata.mcpTools)) {
    mcpTools.push(...metadata.mcpTools.filter((t): t is string => typeof t === 'string'));
  }

  const a2aSkills: string[] = [];
  if (Array.isArray(metadata.a2aSkills)) {
    a2aSkills.push(...metadata.a2aSkills.filter((s): s is string => typeof s === 'string'));
  }

  const mcpPrompts: string[] = [];
  if (Array.isArray(metadata.mcpPrompts)) {
    mcpPrompts.push(...metadata.mcpPrompts.filter((p): p is string => typeof p === 'string'));
  }

  const mcpResources: string[] = [];
  if (Array.isArray(metadata.mcpResources)) {
    mcpResources.push(...metadata.mcpResources.filter((r): r is string => typeof r === 'string'));
  }

  const agentSummary: AgentSummary = {
    chainId,
    agentId: result.agentId,
    name: result.name,
    image: typeof metadata.image === 'string' ? metadata.image : undefined,
    description: result.description,
    owners,
    operators,
    mcp: metadata.mcp === true || !!metadata.mcpEndpoint,
    a2a: metadata.a2a === true || !!metadata.a2aEndpoint,
    ens: typeof metadata.ens === 'string' ? metadata.ens : undefined,
    did: typeof metadata.did === 'string' ? metadata.did : undefined,
    walletAddress: typeof metadata.agentWallet === 'string' ? metadata.agentWallet : undefined,
    supportedTrusts: trustModels,
    a2aSkills,
    mcpTools,
    mcpPrompts,
    mcpResources,
    active: metadata.active === true,
    x402support: metadata.x402support === true,
    extras: {
      // Include additional metadata in extras
      score: result.score,
      rank: result.rank,
      vectorId: result.vectorId,
      matchReasons: result.matchReasons,
      capabilities,
      tags,
      agentWalletChainId: typeof metadata.agentWalletChainId === 'number' ? metadata.agentWalletChainId : undefined,
      createdAt: typeof metadata.createdAt === 'number' ? metadata.createdAt : undefined,
      updatedAt: typeof metadata.updatedAt === 'string' ? metadata.updatedAt : undefined,
      cid: typeof metadata.cid === 'string' ? metadata.cid : undefined,
      agentURI: typeof metadata.agentURI === 'string' ? metadata.agentURI : undefined,
    },
  };

  return agentSummary;
}

