/**
 * Arweave tag generation utilities for registration files.
 * Tags are cryptographically authenticated via Turbo SDK's EthereumSigner.
 */

import type { RegistrationFile } from '../models/interfaces.js';
import { EndpointType } from '../models/enums.js';
import { SDK_VERSION } from './constants.js';

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

/**
 * Generate comprehensive tags for Arweave feedback file uploads.
 *
 * Tags include:
 * - Essential metadata (Content-Type, App-Name, Protocol, etc.)
 * - Agent and reviewer identification (Agent-Id, Reviewer)
 * - Feedback content metadata (Score, Tag1, Tag2)
 * - Capability and skill context (Capability, Skill)
 * - Upload timestamp (ISO 8601 with milliseconds)
 *
 * All tags are cryptographically signed by the uploader's EVM private key
 * via Turbo SDK's EthereumSigner, making them tamper-proof and verifiable.
 *
 * @param feedbackFile - The feedback file to generate tags for
 * @param chainId - Blockchain network ID (e.g., 11155111 for Sepolia)
 * @param agentId - Optional agent identifier (e.g., "11155111:123")
 * @param clientAddress - Optional reviewer's Ethereum address
 * @returns Array of tag objects formatted for Turbo SDK upload
 *
 * @example
 * ```typescript
 * const feedbackFile = {
 *   score: 85,
 *   tag1: 'helpful',
 *   tag2: 'accurate',
 *   capability: 'tools',
 *   skill: 'code_generation'
 * };
 * const tags = generateArweaveFeedbackTags(feedbackFile, 11155111, '11155111:123', '0xabc...');
 * // Tags will include:
 * // - Content-Type: application/json
 * // - App-Name: Agent0-v0.2.1
 * // - Protocol: ERC-8004
 * // - Data-Type: agent-feedback
 * // - Chain-Id: 11155111
 * // - Agent-Id: 11155111:123
 * // - Reviewer: 0xabc...
 * // - Score: 85
 * // - Tag1: helpful
 * // - Tag2: accurate
 * // - Capability: tools
 * // - Skill: code_generation
 * // - Timestamp: 2025-11-06T...
 * ```
 */
export function generateArweaveFeedbackTags(
  feedbackFile: Record<string, unknown>,
  chainId: number,
  agentId?: string,
  clientAddress?: string
): Array<{ name: string; value: string }> {
  const tags: Array<{ name: string; value: string }> = [];

  // Essential tags (always included)
  tags.push(
    { name: 'Content-Type', value: 'application/json' },
    { name: 'App-Name', value: `Agent0-v${SDK_VERSION}` },
    { name: 'Protocol', value: 'ERC-8004' },
    { name: 'Data-Type', value: 'agent-feedback' },
    { name: 'Chain-Id', value: chainId.toString() },
    { name: 'Schema-Version', value: '1.0' }
  );

  // Agent and reviewer identification (optional)
  if (agentId) {
    tags.push({ name: 'Agent-Id', value: agentId });
  }

  if (clientAddress) {
    tags.push({ name: 'Reviewer', value: clientAddress });
  }

  // Feedback content metadata (conditional based on feedback file contents)
  const score = feedbackFile.score;
  if (typeof score === 'number') {
    tags.push({ name: 'Score', value: score.toString() });
  }

  const tag1 = feedbackFile.tag1;
  if (typeof tag1 === 'string' && tag1) {
    tags.push({ name: 'Tag1', value: tag1 });
  }

  const tag2 = feedbackFile.tag2;
  if (typeof tag2 === 'string' && tag2) {
    tags.push({ name: 'Tag2', value: tag2 });
  }

  // Capability and skill context (optional)
  const capability = feedbackFile.capability;
  if (typeof capability === 'string' && capability) {
    tags.push({ name: 'Capability', value: capability });
  }

  const skill = feedbackFile.skill;
  if (typeof skill === 'string' && skill) {
    tags.push({ name: 'Skill', value: skill });
  }

  // Timestamp (ISO 8601 with milliseconds for precision)
  tags.push({ name: 'Timestamp', value: new Date().toISOString() });

  return tags;
}

/**
 * Generate essential tags that should ALWAYS be present on Arweave uploads.
 * This is a fallback for cases where chainId might not be available yet.
 *
 * Essential tags include:
 * - Content-Type: application/json (critical for proper content handling)
 * - App-Name: Agent0 version
 * - Protocol: ERC-8004
 *
 * These tags ensure that uploaded data is at least identifiable and properly
 * typed, even if full metadata cannot be generated.
 *
 * @returns Array of essential tag objects formatted for Turbo SDK upload
 */
export function generateEssentialTags(): Array<{ name: string; value: string }> {
  return [
    { name: 'Content-Type', value: 'application/json' },
    { name: 'App-Name', value: `Agent0-v${SDK_VERSION}` },
    { name: 'Protocol', value: 'ERC-8004' },
  ];
}
