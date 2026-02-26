/**
 * Unit tests for XMTP Phase 1 (inbox lifecycle) and Phase 2 (messaging, auto-register).
 * Mocks @xmtp/node-sdk to avoid network and real wallet.
 */

import { SDK, Agent } from '../src/index.js';
import type { RegistrationFile } from '../src/models/interfaces.js';
import { TrustModel } from '../src/models/enums.js';
import {
  XMTPLoadError,
  XMTPAlreadyConnectedError,
  XMTPMaxInstallationsError,
  XMTPWalletRequiredError,
  XMTPReceiverNotRegisteredError,
} from '../src/index.js';

const mockSync = jest.fn().mockResolvedValue(undefined);
const mockList = jest.fn().mockResolvedValue([]);
const mockCreateDmWithIdentifier = jest.fn();
const mockCanMessage = jest.fn().mockResolvedValue(new Map<string, boolean>());
const mockSendText = jest.fn().mockResolvedValue(undefined);
const mockMessages = jest.fn().mockResolvedValue([]);
const mockFetchInboxStates = jest.fn().mockResolvedValue([]);
const mockBuild = jest.fn();
const mockCreate = jest.fn();

const mockDmSync = jest.fn().mockResolvedValue(undefined);

function createMockDm(peerInboxId: string) {
  return {
    peerInboxId,
    sync: mockDmSync,
    sendText: mockSendText,
    messages: mockMessages,
    lastMessage: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockClient(overrides?: { walletAddress?: string; syncThrows?: boolean }) {
  const walletAddress = overrides?.walletAddress ?? '0x1234567890123456789012345678901234567890';
  return {
    accountIdentifier: { identifier: walletAddress },
    installationId: 'inst-1',
    inboxId: 'inbox-1',
    installationIdBytes: new Uint8Array(32),
    conversations: {
      sync: overrides?.syncThrows ? () => Promise.reject(new Error('Inbox not found')) : mockSync,
      list: mockList,
      createDmWithIdentifier: mockCreateDmWithIdentifier,
    },
    canMessage: mockCanMessage,
  };
}

jest.mock('@xmtp/node-sdk', () => ({
  Client: {
    build: (...args: unknown[]) => mockBuild(...args),
    create: (...args: unknown[]) => mockCreate(...args),
    fetchInboxStates: (...args: unknown[]) => mockFetchInboxStates(...args),
  },
  isText: (m: { content?: unknown }) => typeof m?.content === 'string',
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSync.mockResolvedValue(undefined);
  mockList.mockResolvedValue([]);
  mockCanMessage.mockResolvedValue(new Map<string, boolean>());
  mockSendText.mockResolvedValue(undefined);
  mockMessages.mockResolvedValue([]);
  mockFetchInboxStates.mockResolvedValue([]);
  mockCreateDmWithIdentifier.mockImplementation((ident: { identifier: string }) =>
    Promise.resolve(createMockDm(`inbox-${ident.identifier.slice(0, 10)}`))
  );
  mockBuild.mockResolvedValue(createMockClient());
  mockCreate.mockResolvedValue(createMockClient());
});

describe('XMTP Phase 1 — loadXMTPInbox', () => {
  it('loadXMTPInbox(key) succeeds and sets state', async () => {
    const key = JSON.stringify({ version: 1, walletAddress: '0x1234567890123456789012345678901234567890' });
    const sdk = new SDK({ chainId: 1, rpcUrl: 'https://eth.llamarpc.com' });
    await sdk.loadXMTPInbox(key);
    expect(sdk.getXMTPInstallationKey()).toBeDefined();
    expect(sdk.getXMTPInboxInfo()?.walletAddress).toBe('0x1234567890123456789012345678901234567890');
  });

  it('loadXMTPInbox() throws when no key provided', async () => {
    const sdk = new SDK({ chainId: 1, rpcUrl: 'https://eth.llamarpc.com' });
    await expect(sdk.loadXMTPInbox()).rejects.toThrow('No XMTP installation key');
  });

  it('loadXMTPInbox(invalidKey) throws XMTPLoadError', async () => {
    const sdk = new SDK({ chainId: 1, rpcUrl: 'https://eth.llamarpc.com' });
    await expect(sdk.loadXMTPInbox('not-json')).rejects.toThrow(XMTPLoadError);
    await expect(sdk.loadXMTPInbox(JSON.stringify({ version: 1 }))).rejects.toThrow(XMTPLoadError);
  });
});

describe('XMTP Phase 1 — registerXMTPInbox', () => {
  it('registerXMTPInbox() throws XMTPWalletRequiredError when no wallet', async () => {
    const sdk = new SDK({ chainId: 1, rpcUrl: 'https://eth.llamarpc.com' });
    await expect(sdk.registerXMTPInbox()).rejects.toThrow(XMTPWalletRequiredError);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('registerXMTPInbox() succeeds with wallet and returns key', async () => {
    const sdk = new SDK({
      chainId: 1,
      rpcUrl: 'https://eth.llamarpc.com',
      privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    });
    const key = await sdk.registerXMTPInbox();
    expect(typeof key).toBe('string');
    expect(JSON.parse(key).version).toBe(1);
    expect(mockCreate).toHaveBeenCalled();
  });

  it('registerXMTPInbox() throws XMTPAlreadyConnectedError when already loaded', async () => {
    const key = JSON.stringify({ version: 1, walletAddress: '0x1234567890123456789012345678901234567890' });
    const sdk = new SDK({ chainId: 1, rpcUrl: 'https://eth.llamarpc.com' });
    await sdk.loadXMTPInbox(key);
    await expect(sdk.registerXMTPInbox()).rejects.toThrow(XMTPAlreadyConnectedError);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('registerXMTPInbox() throws XMTPMaxInstallationsError when XMTP returns max installations', async () => {
    mockCreate.mockRejectedValueOnce(new Error('max installations limit'));
    const sdk = new SDK({
      chainId: 1,
      rpcUrl: 'https://eth.llamarpc.com',
      privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    });
    await expect(sdk.registerXMTPInbox()).rejects.toThrow(XMTPMaxInstallationsError);
  });
});

describe('XMTP Phase 1 — getXMTPInstallationKey / getXMTPInboxInfo', () => {
  it('return undefined when no inbox loaded', () => {
    const sdk = new SDK({ chainId: 1, rpcUrl: 'https://eth.llamarpc.com' });
    expect(sdk.getXMTPInstallationKey()).toBeUndefined();
    expect(sdk.getXMTPInboxInfo()).toBeUndefined();
  });
});

describe('XMTP Phase 2 — _ensureXMTPInbox (via messaging methods)', () => {
  it('XMTPConversations() auto-registers when no inbox and wallet connected', async () => {
    const sdk = new SDK({
      chainId: 1,
      rpcUrl: 'https://eth.llamarpc.com',
      privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    });
    const list = await sdk.XMTPConversations();
    expect(mockCreate).toHaveBeenCalled();
    expect(mockSync).toHaveBeenCalled();
    expect(mockList).toHaveBeenCalled();
    expect(Array.isArray(list)).toBe(true);
  });

  it('XMTPConversations() uses config key when no inbox and xmtpInstallationKey set', async () => {
    const key = JSON.stringify({ version: 1, walletAddress: '0x1234567890123456789012345678901234567890' });
    const sdk = new SDK({ chainId: 1, rpcUrl: 'https://eth.llamarpc.com', xmtpInstallationKey: key });
    await sdk.XMTPConversations();
    expect(mockBuild).toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('XMTPConversations() throws XMTPWalletRequiredError when no inbox and no wallet', async () => {
    const sdk = new SDK({ chainId: 1, rpcUrl: 'https://eth.llamarpc.com' });
    await expect(sdk.XMTPConversations()).rejects.toThrow(XMTPWalletRequiredError);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('XMTPConversations() returns summaries with peerAddress when fetchInboxStates returns states', async () => {
    const key = JSON.stringify({ version: 1, walletAddress: '0x1234567890123456789012345678901234567890' });
    const sdk = new SDK({ chainId: 1, rpcUrl: 'https://eth.llamarpc.com', xmtpInstallationKey: key });
    mockList.mockResolvedValueOnce([
      { peerInboxId: 'inbox-peer1', lastMessage: () => Promise.resolve({ sentAt: new Date('2025-01-01') }) },
    ]);
    mockFetchInboxStates.mockResolvedValueOnce([
      { inboxId: 'inbox-peer1', recoveryIdentifier: { identifier: '0xpeer1111111111111111111111111111111111' }, identifiers: [] },
    ]);
    const list = await sdk.XMTPConversations();
    expect(list).toHaveLength(1);
    expect(list[0].peerInboxId).toBe('inbox-peer1');
    expect(list[0].peerAddress).toBe('0xpeer1111111111111111111111111111111111');
  });
});

describe('XMTP Phase 2 — messageXMTP', () => {
  it('messageXMTP(peer, content) ensures inbox, checks canMessage, sends text', async () => {
    const key = JSON.stringify({ version: 1, walletAddress: '0x1234567890123456789012345678901234567890' });
    const sdk = new SDK({ chainId: 1, rpcUrl: 'https://eth.llamarpc.com', xmtpInstallationKey: key });
    const peer = '0xabcd000000000000000000000000000000000000';
    mockCanMessage.mockResolvedValueOnce(new Map([[peer, true]]));
    await sdk.messageXMTP(peer, 'Hello');
    expect(mockCanMessage).toHaveBeenCalled();
    expect(mockCreateDmWithIdentifier).toHaveBeenCalled();
    expect(mockSendText).toHaveBeenCalledWith('Hello');
  });

  it('messageXMTP(peer, content) throws XMTPReceiverNotRegisteredError when peer has no inbox', async () => {
    const key = JSON.stringify({ version: 1, walletAddress: '0x1234567890123456789012345678901234567890' });
    const sdk = new SDK({ chainId: 1, rpcUrl: 'https://eth.llamarpc.com', xmtpInstallationKey: key });
    mockCanMessage.mockResolvedValueOnce(new Map([['0xpeer', false]]));
    await expect(sdk.messageXMTP('0xpeer', 'Hi')).rejects.toThrow(XMTPReceiverNotRegisteredError);
    expect(mockCreateDmWithIdentifier).not.toHaveBeenCalled();
    expect(mockSendText).not.toHaveBeenCalled();
  });
});

describe('XMTP Phase 2 — loadXMTPConversation', () => {
  it('loadXMTPConversation(peer) returns handle with history() and message()', async () => {
    const key = JSON.stringify({ version: 1, walletAddress: '0x1234567890123456789012345678901234567890' });
    const sdk = new SDK({ chainId: 1, rpcUrl: 'https://eth.llamarpc.com', xmtpInstallationKey: key });
    const peer = '0xabcd000000000000000000000000000000000000';
    mockCanMessage.mockResolvedValueOnce(new Map([[peer, true]]));
    mockMessages.mockResolvedValueOnce([
      { id: 'msg-1', content: 'Hi', senderInboxId: 'other', sentAt: new Date(), fallback: 'Hi' },
    ]);
    const conv = await sdk.loadXMTPConversation(peer);
    expect(conv.history).toBeDefined();
    expect(conv.message).toBeDefined();
    const history = await conv.history({ limit: 10 });
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe('msg-1');
    expect(history[0].content).toBe('Hi');
    await conv.message('Reply');
    expect(mockSendText).toHaveBeenCalledWith('Reply');
  });

  it('loadXMTPConversation(peer) throws XMTPReceiverNotRegisteredError when peer has no inbox', async () => {
    const key = JSON.stringify({ version: 1, walletAddress: '0x1234567890123456789012345678901234567890' });
    const sdk = new SDK({ chainId: 1, rpcUrl: 'https://eth.llamarpc.com', xmtpInstallationKey: key });
    mockCanMessage.mockResolvedValueOnce(new Map([['0xpeer', false]]));
    await expect(sdk.loadXMTPConversation('0xpeer')).rejects.toThrow(XMTPReceiverNotRegisteredError);
  });
});

function minimalRegistrationFile(walletAddress: string): RegistrationFile {
  return {
    name: 'Test Agent',
    description: '',
    endpoints: [],
    trustModels: [TrustModel.REPUTATION],
    owners: [],
    operators: [],
    active: false,
    x402support: false,
    metadata: {},
    updatedAt: Math.floor(Date.now() / 1000),
    walletAddress: walletAddress as `0x${string}`,
  };
}

describe('XMTP Phase 3 — Agent messageXMTP / loadXMTPConversation', () => {
  it('agent.messageXMTP(content) uses registrationFile.walletAddress and sends via SDK', async () => {
    const key = JSON.stringify({ version: 1, walletAddress: '0x1234567890123456789012345678901234567890' });
    const sdk = new SDK({ chainId: 1, rpcUrl: 'https://eth.llamarpc.com', xmtpInstallationKey: key });
    const agentWallet = '0xabcd000000000000000000000000000000000000';
    mockCanMessage.mockResolvedValue(new Map([[agentWallet, true]]));
    const regFile = minimalRegistrationFile(agentWallet);
    const agent = new Agent(sdk, regFile);
    await agent.messageXMTP('Hello agent');
    expect(mockCreateDmWithIdentifier).toHaveBeenCalledWith(expect.objectContaining({ identifier: agentWallet }));
    expect(mockSendText).toHaveBeenCalledWith('Hello agent');
  });

  it('agent.loadXMTPConversation() returns handle using registrationFile.walletAddress', async () => {
    const key = JSON.stringify({ version: 1, walletAddress: '0x1234567890123456789012345678901234567890' });
    const sdk = new SDK({ chainId: 1, rpcUrl: 'https://eth.llamarpc.com', xmtpInstallationKey: key });
    const agentWallet = '0xabcd000000000000000000000000000000000000';
    mockCanMessage.mockResolvedValue(new Map([[agentWallet, true]]));
    mockMessages.mockResolvedValue([{ id: 'm1', content: 'Hi', senderInboxId: 'x', sentAt: new Date(), fallback: 'Hi' }]);
    const regFile = minimalRegistrationFile(agentWallet);
    const agent = new Agent(sdk, regFile);
    const conv = await agent.loadXMTPConversation();
    expect(conv.history).toBeDefined();
    expect(conv.message).toBeDefined();
    const history = await conv.history({ limit: 5 });
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe('Hi');
    await conv.message('Reply');
    expect(mockSendText).toHaveBeenCalledWith('Reply');
  });

  it('agent.messageXMTP throws when registrationFile has no walletAddress and no agentId', async () => {
    const key = JSON.stringify({ version: 1, walletAddress: '0x1234567890123456789012345678901234567890' });
    const sdk = new SDK({ chainId: 1, rpcUrl: 'https://eth.llamarpc.com', xmtpInstallationKey: key });
    const regFile = minimalRegistrationFile('0xab');
    delete (regFile as Partial<RegistrationFile>).walletAddress;
    const agent = new Agent(sdk, regFile);
    await expect(agent.messageXMTP('Hi')).rejects.toThrow(/wallet|registered/);
  });
});
