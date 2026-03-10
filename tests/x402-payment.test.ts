/**
 * x402 EVM payment builder unit tests.
 * Mocked ChainClient; assert PAYMENT-SIGNATURE payload shape (base64 JSON, expected keys).
 */

import { buildEvmPayment, checkEvmBalance } from '../src/core/x402-payment.js';
import type { ChainClient } from '../src/core/chain-client.js';
import type { X402Accept } from '../src/core/x402-types.js';

const TOKEN = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const DEST = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0';
const FROM = '0x1234567890123456789012345678901234567890';
const CHAIN_ID = 84532;

function createMockChainClient(overrides?: Partial<ChainClient>): ChainClient {
  const readContract = jest.fn().mockImplementation(async (args: { functionName: string }) => {
    if (args.functionName === 'name') return 'USD Coin';
    if (args.functionName === 'version') return '2';
    return undefined;
  });
  return {
    chainId: CHAIN_ID,
    rpcUrl: 'https://base-sepolia.drpc.org',
    getAddress: jest.fn().mockResolvedValue(FROM),
    ensureAddress: jest.fn().mockResolvedValue(FROM),
    readContract,
    writeContract: jest.fn(),
    sendTransaction: jest.fn(),
    waitForTransaction: jest.fn(),
    getEventLogs: jest.fn(),
    getBlockNumber: jest.fn(),
    getBlockTimestamp: jest.fn(),
    keccak256Utf8: jest.fn(),
    isAddress: jest.fn((x: string) => /^0x[a-fA-F0-9]{40}$/.test(x)),
    toChecksumAddress: jest.fn((x: string) => x as `0x${string}`),
    signMessage: jest.fn(),
    signTypedData: jest.fn().mockResolvedValue('0x' + 'a'.repeat(130)),
    ...overrides,
  } as unknown as ChainClient;
}

function decodePayload(base64: string): Record<string, unknown> {
  const json = typeof Buffer !== 'undefined'
    ? Buffer.from(base64, 'base64').toString('utf8')
    : decodeURIComponent(escape(atob(base64)));
  return JSON.parse(json) as Record<string, unknown>;
}

describe('buildEvmPayment', () => {
  const accept: X402Accept = {
    price: '1000000',
    token: TOKEN,
    network: 'base-sepolia',
    destination: DEST,
  };

  it('returns base64 string', async () => {
    const client = createMockChainClient();
    const result = await buildEvmPayment(accept, client);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(() => decodePayload(result)).not.toThrow();
  });

  it('payload has x402Version, scheme, network, payload.signature, payload.authorization', async () => {
    const client = createMockChainClient();
    const base64 = await buildEvmPayment(accept, client);
    const payload = decodePayload(base64);

    expect(payload.x402Version).toBe(1);
    expect(payload.scheme).toBe('exact');
    expect(payload.network).toBe('base-sepolia');
    expect(payload.payload).toBeDefined();

    const inner = payload.payload as Record<string, unknown>;
    expect(inner.signature).toBeDefined();
    expect(typeof inner.signature).toBe('string');
    expect((inner.signature as string).startsWith('0x')).toBe(true);

    expect(inner.authorization).toBeDefined();
    const auth = inner.authorization as Record<string, unknown>;
    expect(auth.from).toBe(FROM);
    expect(auth.to).toBe(DEST);
    expect(auth.value).toBe('1000000');
    expect(auth.validAfter).toBeDefined();
    expect(auth.validBefore).toBeDefined();
    expect(auth.nonce).toBeDefined();
    expect((auth.nonce as string).startsWith('0x')).toBe(true);
  });

  it('uses accept.scheme when provided', async () => {
    const client = createMockChainClient();
    const base64 = await buildEvmPayment({ ...accept, scheme: 'custom' }, client);
    const payload = decodePayload(base64);
    expect(payload.scheme).toBe('custom');
  });

  it('V2 payload has accepted (chosen PaymentRequirements) when network is CAIP-2 (eip155:*)', async () => {
    const client = createMockChainClient();
    const base64 = await buildEvmPayment({ ...accept, network: 'eip155:84532' }, client);
    const payload = decodePayload(base64);
    expect(payload.x402Version).toBe(2);
    expect(payload.accepted).toBeDefined();
    const acc = payload.accepted as Record<string, unknown>;
    expect(acc.network).toBe('eip155:84532');
    expect(acc.scheme).toBe('exact');
    expect(acc.amount).toBeDefined();
    expect(acc.asset).toBeDefined();
    expect(acc.payTo).toBeDefined();
    expect(payload.payload).toBeDefined();
  });

  it('uses accept.maxAmountRequired when price not set', async () => {
    const client = createMockChainClient();
    const acceptNoPrice = { ...accept, price: undefined as unknown as string, maxAmountRequired: '999999' };
    const base64 = await buildEvmPayment(acceptNoPrice, client);
    const payload = decodePayload(base64);
    const auth = (payload.payload as Record<string, unknown>).authorization as Record<string, unknown>;
    expect(auth.value).toBe('999999');
  });

  it('calls signTypedData with TransferWithAuthorization domain and message', async () => {
    const signTypedData = jest.fn().mockResolvedValue('0x' + 'b'.repeat(130));
    const client = createMockChainClient({ signTypedData });

    await buildEvmPayment(accept, client);

    expect(signTypedData).toHaveBeenCalledTimes(1);
    const callArgs = signTypedData.mock.calls[0]![0];
    expect(callArgs.domain).toMatchObject({
      name: 'USD Coin',
      version: '2',
      chainId: CHAIN_ID,
      verifyingContract: TOKEN,
    });
    expect(callArgs.primaryType).toBe('TransferWithAuthorization');
    expect(callArgs.types.TransferWithAuthorization).toBeDefined();
    expect(callArgs.message).toMatchObject({
      from: FROM,
      to: DEST,
      value: BigInt('1000000'),
    });
    expect(callArgs.message.nonce).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it('throws when accept has no valid token/asset', async () => {
    const client = createMockChainClient();
    (client.isAddress as jest.Mock).mockReturnValue(false);

    await expect(buildEvmPayment(accept, client)).rejects.toThrow(/token\/asset/);
  });

  it('throws when accept has no valid destination', async () => {
    const client = createMockChainClient();
    (client.isAddress as jest.Mock).mockImplementation((addr: string) => addr === TOKEN);

    await expect(buildEvmPayment({ ...accept, destination: '' }, client)).rejects.toThrow(/destination/);
  });

  it('throws when signTypedData throws (no signer)', async () => {
    const client = createMockChainClient({
      signTypedData: jest.fn().mockRejectedValue(new Error('No signer available')),
    });

    await expect(buildEvmPayment(accept, client)).rejects.toThrow('No signer available');
  });
});

describe('checkEvmBalance', () => {
  const accept: X402Accept = {
    price: '1000000',
    token: TOKEN,
    network: 'eip155:84532',
    destination: DEST,
  };

  it('returns true when balance >= price', async () => {
    const client = createMockChainClient();
    (client.readContract as jest.Mock).mockResolvedValue(BigInt(2000000));
    const result = await checkEvmBalance(accept, client);
    expect(result).toBe(true);
    expect(client.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'balanceOf', args: [FROM] })
    );
  });

  it('returns true when balance equals price', async () => {
    const client = createMockChainClient();
    (client.readContract as jest.Mock).mockResolvedValue(BigInt(1000000));
    const result = await checkEvmBalance(accept, client);
    expect(result).toBe(true);
  });

  it('returns false when balance < price', async () => {
    const client = createMockChainClient();
    (client.readContract as jest.Mock).mockResolvedValue(BigInt(500000));
    const result = await checkEvmBalance(accept, client);
    expect(result).toBe(false);
  });

  it('returns false when readContract throws', async () => {
    const client = createMockChainClient();
    (client.readContract as jest.Mock).mockRejectedValue(new Error('Contract not found'));
    const result = await checkEvmBalance(accept, client);
    expect(result).toBe(false);
  });

  it('returns false when ensureAddress returns undefined', async () => {
    const client = createMockChainClient();
    (client.ensureAddress as jest.Mock).mockResolvedValue(undefined);
    const result = await checkEvmBalance(accept, client);
    expect(result).toBe(false);
  });
});
