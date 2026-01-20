/**
 * Validation utilities
 */

/**
 * Validate Ethereum address format
 */
export function isValidAddress(address: string): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }
  // Ethereum address: 0x followed by 40 hex characters
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Validate AgentId format
 * Format: "chainId:tokenId" where both are positive integers
 */
export function isValidAgentId(agentId: string): boolean {
  if (!agentId || typeof agentId !== 'string') {
    return false;
  }
  const parts = agentId.split(':');
  if (parts.length !== 2) {
    return false;
  }
  const chainId = parseInt(parts[0], 10);
  const tokenId = parseInt(parts[1], 10);
  return !isNaN(chainId) && !isNaN(tokenId) && chainId > 0 && tokenId >= 0;
}

/**
 * Validate URI format (basic validation)
 */
export function isValidURI(uri: string): boolean {
  if (!uri || typeof uri !== 'string') {
    return false;
  }
  try {
    const url = new URL(uri);
    return url.protocol === 'http:' || url.protocol === 'https:' || uri.startsWith('ipfs://');
  } catch {
    // If URL parsing fails, it might still be a valid IPFS URI
    return uri.startsWith('ipfs://') || uri.startsWith('/ipfs/');
  }
}

/**
 * Validate feedback score (0-100)
 */
export function isValidFeedbackValue(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Normalize address to lowercase for consistent storage and comparison
 */
export function normalizeAddress(address: string): string {
  if (address.startsWith('0x') || address.startsWith('0X')) {
    return '0x' + address.slice(2).toLowerCase();
  }
  return address.toLowerCase();
}

