/**
 * Shared constants for Agent0 SDK
 */

/**
 * SDK version for tagging and identification
 */
export const SDK_VERSION = '0.2.1';

/**
 * IPFS gateway URLs for fallback retrieval
 */
export const IPFS_GATEWAYS = [
  'https://gateway.pinata.cloud/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
] as const;

/**
 * Arweave gateway URLs for parallel fallback retrieval
 */
export const ARWEAVE_GATEWAYS = [
  'https://arweave.net',
  'https://turbo-gateway.com',
  'https://ario-gateway.nethermind.dev',
  'https://ar-io-gateway.svc.blacksand.xyz',
] as const;

/**
 * Timeout values in milliseconds
 */
export const TIMEOUTS = {
  IPFS_GATEWAY: 10000, // 10 seconds
  PINATA_UPLOAD: 80000, // 80 seconds
  ARWEAVE_GATEWAY: 10000, // 10 seconds (parallel gateway requests)
  ARWEAVE_UPLOAD: 100000, // 100 seconds (Turbo upload + settlement)
  TRANSACTION_WAIT: 30000, // 30 seconds
  ENDPOINT_CRAWLER_DEFAULT: 5000, // 5 seconds
} as const;

/**
 * Default values
 */
export const DEFAULTS = {
  FEEDBACK_EXPIRY_HOURS: 24,
  SEARCH_PAGE_SIZE: 50,
} as const;

