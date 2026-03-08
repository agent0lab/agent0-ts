import type { RegistrationFile } from '../models/interfaces.js';
import { parseAgentId } from './id-format.js';

/**
 * Build an ERC-8004 compliant registration JSON object from the SDK's internal `RegistrationFile`.
 *
 * This matches the JSON shape produced by the IPFS publishing path so all publishing mechanisms
 * (IPFS, HTTP-hosted, on-chain data URI) stay consistent.
 */
export function buildErc8004RegistrationJson(
  registrationFile: RegistrationFile,
  opts?: { chainId?: number; identityRegistryAddress?: string }
): Record<string, unknown> {
  // Convert internal format { type, value, meta } to ERC-8004 format { name, endpoint, version, ...meta }
  const services: Array<Record<string, unknown>> = [];
  for (const ep of registrationFile.endpoints) {
    const endpointDict: Record<string, unknown> = {
      name: ep.type, // EndpointType enum value (e.g., "MCP", "A2A")
      endpoint: ep.value,
    };
    if (ep.meta) {
      Object.assign(endpointDict, ep.meta);
    }
    services.push(endpointDict);
  }

  // Build registrations array (only when agentId is known).
  const registrations: Array<Record<string, unknown>> = [];
  if (registrationFile.agentId) {
    // Support both internal SDK AgentId format ("chainId:tokenId") and CAIP-style ("eip155:chainId:tokenId")
    const agentIdParts = registrationFile.agentId.split(':');
    let parsedChainId: number | undefined;
    let parsedTokenId: number | undefined;

    if (agentIdParts.length === 3 && agentIdParts[0] === 'eip155') {
      parsedChainId = parseInt(agentIdParts[1], 10);
      parsedTokenId = parseInt(agentIdParts[2], 10);
    } else {
      const parsed = parseAgentId(registrationFile.agentId);
      parsedChainId = parsed.chainId;
      parsedTokenId = parsed.tokenId;
    }

    if (parsedTokenId === undefined || Number.isNaN(parsedTokenId)) {
      throw new Error(`Invalid agentId for registration file: ${registrationFile.agentId}`);
    }

    const effectiveChainId = opts?.chainId ?? parsedChainId ?? 1;
    const agentRegistry = opts?.identityRegistryAddress
      ? `eip155:${effectiveChainId}:${opts.identityRegistryAddress}`
      : `eip155:${effectiveChainId}:{identityRegistry}`;

    registrations.push({
      agentId: parsedTokenId,
      agentRegistry,
    });
  }

  const data: Record<string, unknown> = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: registrationFile.name,
    description: registrationFile.description,
    ...(registrationFile.image && { image: registrationFile.image }),
    services,
    ...(registrations.length > 0 && { registrations }),
    ...(registrationFile.trustModels.length > 0 && { supportedTrust: registrationFile.trustModels }),
    active: registrationFile.active,
    x402Support: registrationFile.x402support,
    ...(registrationFile.updatedAt !== undefined && { updatedAt: registrationFile.updatedAt }),
  };

  // Include metadata bag only if present and non-empty (keeps payload smaller by default).
  if (registrationFile.metadata && Object.keys(registrationFile.metadata).length > 0) {
    data.metadata = registrationFile.metadata;
  }

  return data;
}

