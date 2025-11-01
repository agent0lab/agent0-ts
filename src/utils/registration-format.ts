/**
 * Shared utility for ERC-8004 registration file formatting
 * Used by both IPFSClient and ArweaveClient to ensure consistency
 */

import type { RegistrationFile } from '../models/interfaces';

/**
 * Format RegistrationFile to ERC-8004 compliant storage format.
 * Used by both IPFSClient and ArweaveClient to ensure consistency.
 *
 * @param registrationFile - The registration file to format
 * @param chainId - Optional chain ID for agent registry reference
 * @param identityRegistryAddress - Optional registry address for agent registry reference
 * @returns ERC-8004 compliant data object ready for storage
 */
export function formatRegistrationFileForStorage(
  registrationFile: RegistrationFile,
  chainId?: number,
  identityRegistryAddress?: string
): Record<string, unknown> {
  // Transform endpoints to ERC-8004 format
  const endpoints: Array<Record<string, unknown>> = [];
  for (const ep of registrationFile.endpoints) {
    const endpointDict: Record<string, unknown> = {
      name: ep.type,
      endpoint: ep.value,
    };

    if (ep.meta) {
      Object.assign(endpointDict, ep.meta);
    }

    endpoints.push(endpointDict);
  }

  // Add wallet as endpoint if present
  if (registrationFile.walletAddress) {
    const walletChainId = registrationFile.walletChainId || chainId || 1;
    endpoints.push({
      name: 'agentWallet',
      endpoint: `eip155:${walletChainId}:${registrationFile.walletAddress}`,
    });
  }

  // Build registrations array
  const registrations: Array<Record<string, unknown>> = [];
  if (registrationFile.agentId) {
    const [, , tokenId] = registrationFile.agentId.split(':');
    const agentRegistry = chainId && identityRegistryAddress
      ? `eip155:${chainId}:${identityRegistryAddress}`
      : `eip155:1:{identityRegistry}`;
    registrations.push({
      agentId: parseInt(tokenId, 10),
      agentRegistry,
    });
  }

  // Build ERC-8004 compliant data
  return {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: registrationFile.name,
    description: registrationFile.description,
    ...(registrationFile.image && { image: registrationFile.image }),
    endpoints,
    ...(registrations.length > 0 && { registrations }),
    ...(registrationFile.trustModels.length > 0 && {
      supportedTrusts: registrationFile.trustModels,
    }),
    active: registrationFile.active,
    x402support: registrationFile.x402support,
  };
}
