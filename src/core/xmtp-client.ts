/**
 * Internal XMTP client wrapper around @xmtp/node-sdk.
 * Uses dbPath: null (no local DB); builds EOA signer from chain client.
 */
import { Client } from '@xmtp/node-sdk';
import type { Identifier } from '@xmtp/node-sdk';
import type { ChainClient } from './chain-client.js';
import type { XMTPInboxInfo } from '../models/xmtp.js';
import type { XMTPInstallationKey } from '../models/xmtp.js';
import {
  XMTPAlreadyConnectedError,
  XMTPLoadError,
  XMTPMaxInstallationsError,
  XMTPReceiverNotRegisteredError,
  XMTPWalletRequiredError,
} from './xmtp-errors.js';

const IDENTIFIER_KIND_ETHEREUM = 0 as const;

function hexToBytes(hex: `0x${string}`): Uint8Array {
  const s = hex.startsWith('0x') ? hex.slice(2) : hex;
  const len = s.length / 2;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Build XMTP Identifier from wallet address (for canMessage, createDm, etc.). */
export function toIdentifier(address: string): Identifier {
  return { identifier: address, identifierKind: IDENTIFIER_KIND_ETHEREUM };
}

/**
 * Ensure the peer has a registered inbox; throw XMTPReceiverNotRegisteredError if not.
 */
export async function ensurePeerCanMessage(
  client: InstanceType<typeof Client>,
  peerAddress: string
): Promise<void> {
  const identifier = toIdentifier(peerAddress);
  const map = await client.canMessage([identifier]);
  const key = peerAddress.toLowerCase();
  const can =
    map.get(peerAddress) ??
    map.get(identifier.identifier) ??
    map.get(key) ??
    false;
  if (!can) {
    throw new XMTPReceiverNotRegisteredError();
  }
}

export type XmtpClientOptions = {
  env?: 'local' | 'dev' | 'production';
};

/** Serialized installation key format (internal). */
export interface InstallationKeyPayload {
  version: number;
  walletAddress: string;
  env?: 'local' | 'dev' | 'production';
}

function serializeInstallationKey(payload: InstallationKeyPayload): XMTPInstallationKey {
  return JSON.stringify(payload);
}

function parseInstallationKey(key: XMTPInstallationKey): InstallationKeyPayload {
  try {
    const parsed = JSON.parse(key) as InstallationKeyPayload;
    if (typeof parsed.walletAddress !== 'string' || !parsed.walletAddress) {
      throw new XMTPLoadError('Invalid installation key: missing walletAddress');
    }
    if (parsed.version !== 1) {
      throw new XMTPLoadError('Invalid installation key: unsupported version');
    }
    return parsed;
  } catch (e) {
    if (e instanceof XMTPLoadError) throw e;
    throw new XMTPLoadError('Invalid installation key: invalid format');
  }
}

export type XMTPClientWrapperState = {
  client: InstanceType<typeof Client>;
  installationKey: XMTPInstallationKey;
};

/**
 * Build an EOA signer for XMTP from the SDK's chain client.
 * Throws XMTPWalletRequiredError if no signer/address available.
 */
export async function buildXmtpEoaSigner(chainClient: ChainClient): Promise<{
  type: 'EOA';
  getIdentifier: () => Promise<Identifier>;
  signMessage: (message: string) => Promise<Uint8Array>;
}> {
  const address = await chainClient.getAddress();
  if (!address) {
    throw new XMTPWalletRequiredError();
  }
  return {
    type: 'EOA',
    async getIdentifier() {
      return toIdentifier(address);
    },
    async signMessage(message: string) {
      const hex = await chainClient.signMessage(message);
      return hexToBytes(hex);
    },
  };
}

const DEFAULT_ENV: 'local' | 'dev' | 'production' = 'production';

/**
 * Load an existing XMTP inbox from a previously saved installation key.
 * Validates that the inbox exists (e.g. via network); throws on invalid key or missing inbox.
 */
export async function loadXMTPInboxFromKey(
  installationKey: XMTPInstallationKey,
  options?: XmtpClientOptions
): Promise<XMTPClientWrapperState> {
  const payload = parseInstallationKey(installationKey);
  const env = options?.env ?? payload.env ?? DEFAULT_ENV;
  const identifier = toIdentifier(payload.walletAddress);
  const client = await Client.build(identifier, {
    dbPath: null,
    env,
  });
  // Validate inbox exists: ensure we can read something (e.g. sync or list)
  try {
    await client.conversations.sync();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new XMTPLoadError(`Inbox not found or invalid for key: ${msg}`);
  }
  const key = serializeInstallationKey({
    version: 1,
    walletAddress: payload.walletAddress,
    env,
  });
  return { client, installationKey: key };
}

/**
 * Register a new XMTP inbox using the chain client's signer. SDK generates installation key(s).
 * Throws if already connected, or no wallet, or max installations.
 */
export async function registerXMTPInboxWithSigner(
  chainClient: ChainClient,
  options?: XmtpClientOptions
): Promise<XMTPClientWrapperState> {
  const signer = await buildXmtpEoaSigner(chainClient);
  const env = options?.env ?? DEFAULT_ENV;
  try {
    const client = await Client.create(signer, {
      dbPath: null,
      env,
    });
    const walletAddress = client.accountIdentifier?.identifier ?? '';
    const installationKey = serializeInstallationKey({
      version: 1,
      walletAddress,
      env,
    });
    return { client, installationKey };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Only treat as max installations when the message clearly refers to installation limit
    // (avoid matching e.g. "too many requests" rate limit)
    if (/max(imum)?\s*(number\s*of\s*)?installation|installation\s*(limit|maximum|reached)/i.test(msg)) {
      throw new XMTPMaxInstallationsError(msg);
    }
    throw e;
  }
}

/**
 * Get inbox info from a loaded client state.
 * privateKeys are not exposed by the XMTP Node SDK; we return installationIdBytes as public key material.
 */
export function getXMTPInboxInfoFromState(state: XMTPClientWrapperState): XMTPInboxInfo {
  const c = state.client;
  const walletAddress = c.accountIdentifier?.identifier ?? '';
  return {
    walletAddress,
    publicKeys: [c.installationIdBytes],
    privateKeys: [],
    installationId: c.installationId,
    inboxId: c.inboxId,
  };
}
