/**
 * Arweave tag generation utilities for registration files.
 * Tags are cryptographically authenticated via Turbo SDK's EthereumSigner.
 */

import type { RegistrationFile } from '../models/interfaces';
import { EndpointType } from '../models/enums';
import { SDK_VERSION } from './constants';

/**
 * Generate comprehensive tags for Arweave registration file uploads.
 *
 * Tags include:
 * - Essential metadata (Content-Type, App-Name, Protocol, etc.)
 * - Optional Agent-Id (only if agent already registered)
 * - Capability flags (Has-MCP, Has-A2A, Has-Wallet, Active)
 * - Upload timestamp (ISO 8601 with milliseconds)
 *
 * All tags are cryptographically signed by the uploader's EVM private key
 * via Turbo SDK's EthereumSigner, making them tamper-proof and verifiable.
 *
 * @param registrationFile - The registration file to generate tags for
 * @param chainId - Blockchain network ID (e.g., 11155111 for Sepolia)
 * @returns Array of tag objects formatted for Turbo SDK upload
 *
 * @example
 * ```typescript
 * const tags = generateArweaveRegistrationTags(registrationFile, 11155111);
 * // Tags will include:
 * // - Content-Type: application/json
 * // - App-Name: Agent0-v0.2.1
 * // - Protocol: ERC-8004
 * // - Chain-Id: 11155111
 * // - Has-MCP: true (if MCP endpoint exists)
 * // - Agent-Id: 11155111:123 (if agent registered)
 * // ... etc
 * ```
 */
export function generateArweaveRegistrationTags(
  registrationFile: RegistrationFile,
  chainId: number
): Array<{ name: string; value: string }> {
  const tags: Array<{ name: string; value: string }> = [];

  // Essential tags (always included)
  tags.push(
    { name: 'Content-Type', value: 'application/json' },
    { name: 'App-Name', value: `Agent0-v${SDK_VERSION}` },
    { name: 'Protocol', value: 'ERC-8004' },
    { name: 'Data-Type', value: 'agent-registration' },
    { name: 'Chain-Id', value: chainId.toString() },
    { name: 'Schema-Version', value: '1.0' }
  );

  // Agent-Id tag (optional - only if agent already registered)
  // During first-time registration, agentId won't exist yet
  if (registrationFile.agentId) {
    tags.push({ name: 'Agent-Id', value: registrationFile.agentId });
  }

  // Capability flags (conditional based on registration file contents)
  const hasMCP = registrationFile.endpoints.some(ep => ep.type === EndpointType.MCP);
  const hasA2A = registrationFile.endpoints.some(ep => ep.type === EndpointType.A2A);
  const hasWallet = Boolean(registrationFile.walletAddress);

  tags.push(
    { name: 'Has-MCP', value: hasMCP.toString() },
    { name: 'Has-A2A', value: hasA2A.toString() },
    { name: 'Has-Wallet', value: hasWallet.toString() },
    { name: 'Active', value: registrationFile.active.toString() }
  );

  // Timestamp (ISO 8601 with milliseconds for precision)
  tags.push({ name: 'Timestamp', value: new Date().toISOString() });

  return tags;
}
