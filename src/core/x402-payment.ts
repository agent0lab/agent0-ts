/**
 * Build EVM x402 PAYMENT-SIGNATURE payload (EIP-3009 TransferWithAuthorization style).
 * Uses ChainClient only (no viem) to align with SDK conventions.
 */

import type { ChainClient } from './chain-client.js';
import type { X402Accept } from './x402-types.js';
import type { RequestSnapshot } from './x402-request.js';

/** Minimal ABI for token name (ERC-20). */
const NAME_ABI = [
  { inputs: [], name: 'name', outputs: [{ internalType: 'string', name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
] as const;

/** Optional version (EIP-3009 / EIP-712 domain). */
const VERSION_ABI = [
  { inputs: [], name: 'version', outputs: [{ internalType: 'string', name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
] as const;

/** EIP-3009 TransferWithAuthorization type for EIP-712. */
const TRANSFER_WITH_AUTHORIZATION_TYPES = [
  { name: 'from', type: 'address' },
  { name: 'to', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'validAfter', type: 'uint256' },
  { name: 'validBefore', type: 'uint256' },
  { name: 'nonce', type: 'bytes32' },
];

function randomBytes32Hex(): `0x${string}` {
  const bytes = new Uint8Array(32);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    throw new Error('x402: crypto.getRandomValues not available for nonce generation');
  }
  let hex = '0x';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex as `0x${string}`;
}

/**
 * Resolve token contract address from accept (token or asset; must be checksum address).
 */
function tokenAddress(accept: X402Accept, chainClient: ChainClient): string {
  const raw = accept.token || accept.asset || '';
  if (!raw || !chainClient.isAddress(raw)) {
    throw new Error('x402: accept has no valid token/asset address');
  }
  return chainClient.toChecksumAddress(raw);
}

/**
 * Resolve destination (to) address from accept.
 */
function destinationAddress(accept: X402Accept, chainClient: ChainClient): string {
  const raw = accept.destination || (accept as Record<string, unknown>).payTo as string | undefined;
  if (!raw || !chainClient.isAddress(raw)) {
    throw new Error('x402: accept has no valid destination/payTo address');
  }
  return chainClient.toChecksumAddress(raw);
}

/**
 * Resolve value in smallest units (string for uint256).
 */
function valueAmount(accept: X402Accept): string {
  const v = accept.price ?? accept.maxAmountRequired ?? '0';
  return String(v);
}

/**
 * Fetch EIP-712 domain name and version from token contract (for EIP-3009).
 * Falls back to "Token" / "2" if version() is not present.
 */
async function getTokenDomain(
  tokenAddress: string,
  chainId: number,
  chainClient: ChainClient
): Promise<{ name: string; version: string }> {
  let name = 'Token';
  let version = '2';
  try {
    name = await chainClient.readContract<string>({
      address: tokenAddress as `0x${string}`,
      abi: [...NAME_ABI],
      functionName: 'name',
    });
  } catch {
    // keep default
  }
  try {
    version = await chainClient.readContract<string>({
      address: tokenAddress as `0x${string}`,
      abi: [...VERSION_ABI],
      functionName: 'version',
    });
  } catch {
    // EIP-3009 often uses "2"
  }
  return { name: name || 'Token', version: version || '2' };
}

/**
 * Build the base64-encoded PAYMENT-SIGNATURE payload for EVM (x402 style).
 * Uses EIP-3009 TransferWithAuthorization typed data and ChainClient.signTypedData.
 *
 * @param accept - Payment option from 402 response (token, destination, price, etc.)
 * @param chainClient - SDK chain client (signer required)
 * @param _snapshot - Unused; reserved for future (e.g. request-specific nonce)
 * @returns Base64 string to set as PAYMENT-SIGNATURE header
 */
export async function buildEvmPayment(
  accept: X402Accept,
  chainClient: ChainClient,
  _snapshot?: RequestSnapshot
): Promise<string> {
  const token = tokenAddress(accept, chainClient);
  const to = destinationAddress(accept, chainClient);
  const value = valueAmount(accept);

  const chainId = chainClient.chainId;
  const { name: domainName, version: domainVersion } = await getTokenDomain(token, chainId, chainClient);

  const from = await chainClient.ensureAddress();
  const validAfter = '0';
  const validBefore = String(Math.floor(Date.now() / 1000) + 3600); // 1 hour
  const nonce = randomBytes32Hex();

  const domain = {
    name: domainName,
    version: domainVersion,
    chainId,
    verifyingContract: token,
  };

  const types = {
    TransferWithAuthorization: TRANSFER_WITH_AUTHORIZATION_TYPES,
  };

  const message = {
    from,
    to,
    value: BigInt(value),
    validAfter: BigInt(validAfter),
    validBefore: BigInt(validBefore),
    nonce,
  };

  const signature = await chainClient.signTypedData({
    domain,
    types,
    primaryType: 'TransferWithAuthorization',
    message,
  });

  const payload = {
    x402Version: 1,
    scheme: accept.scheme ?? 'exact',
    network: accept.network ?? String(chainId),
    payload: {
      signature,
      authorization: {
        from,
        to,
        value,
        validAfter,
        validBefore,
        nonce,
      },
    },
  };

  const json = JSON.stringify(payload);
  const base64 = typeof Buffer !== 'undefined'
    ? Buffer.from(json, 'utf8').toString('base64')
    : btoa(unescape(encodeURIComponent(json)));
  return base64;
}
