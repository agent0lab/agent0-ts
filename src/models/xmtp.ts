/**
 * XMTP types for SDK (spec §3).
 */

/**
 * Opaque installation key for loading an existing inbox.
 * Produced by registerXMTPInbox() or getXMTPInstallationKey(); format is internal.
 */
export type XMTPInstallationKey = string;

/**
 * Info about the currently loaded XMTP inbox.
 * Returned by sdk.getXMTPInboxInfo().
 */
export interface XMTPInboxInfo {
  /** Associated wallet address (WA) on the XMTP network. */
  walletAddress: string;
  /** Public key(s) for the installation. */
  publicKeys: Uint8Array | Uint8Array[];
  /** Private key(s) or key material; handle securely. */
  privateKeys: Uint8Array | Uint8Array[];
  /** Installation ID. */
  installationId: string;
  /** Inbox ID. */
  inboxId: string;
}

/**
 * Conversation handle from loadXMTPConversation or agent.loadXMTPConversation.
 */
export interface XMTPConversationHandle {
  /** Fetch message history from the network (optional pagination). */
  history(options?: { limit?: number; before?: string }): Promise<XMTPMessage[]>;
  /** Send a message. */
  message(content: string): Promise<void>;
}

/**
 * Simple message shape for history.
 */
export interface XMTPMessage {
  id: string;
  content: string;
  senderInboxId?: string;
  sentAt: Date;
}

/**
 * Summary of an XMTP conversation (e.g. from XMTPConversations()).
 */
export interface XMTPConversationSummary {
  /** Peer wallet address (for DMs). */
  peerAddress?: string;
  /** Peer inbox ID. */
  peerInboxId: string;
  /** Last activity if available. */
  lastActivity?: Date;
}
