import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  type Hex,
  type Address as ViemAddress,
  keccak256,
  toBytes,
  isAddress as viemIsAddress,
  getAddress as viemGetAddress,
  encodeFunctionData,
  getAbiItem,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import type { Address } from '../models/types.js';
import type { ChainClient, ChainLog, ChainReceipt, EIP1193Provider, TransactionOptions, WaitForTransactionArgs } from './chain-client.js';
import { normalizeEcdsaSignature } from '../utils/signatures.js';

export type ViemChainClientConfig = {
  chainId: number;
  rpcUrl: string;
  sponsorWhenAvailable?: boolean;
  megaFuelUrl?: string;
  megaFuelUserAgent?: string;
  /**
   * Browser path: injected wallet provider (EIP-1193), usually selected via ERC-6963.
   */
  walletProvider?: EIP1193Provider;
  /**
   * Server path: private key for signing (hex string with or without 0x prefix).
   */
  privateKey?: string;
};

const BSC_TESTNET_CHAIN_ID = 97;
const DEFAULT_BSC_MEGAFUEL_URL = 'https://bsc-megafuel-testnet.nodereal.io';
const DEFAULT_MEGAFUEL_USER_AGENT = 'agent0-sdk-ts/1.x';

function normalizeHexKey(key: string): Hex {
  const k = key.trim();
  const with0x = k.startsWith('0x') ? k : `0x${k}`;
  return with0x as Hex;
}

function toViemAddress(addr: Address): ViemAddress {
  return addr as unknown as ViemAddress;
}

function toSdkAddress(addr: string): Address {
  return addr as Address;
}

function toRpcHex(value: bigint): `0x${string}` {
  return `0x${value.toString(16)}` as `0x${string}`;
}

function toViemTxOptions(options?: TransactionOptions): Record<string, unknown> {
  if (!options) return {};
  const out: Record<string, unknown> = {};
  if (options.gasLimit !== undefined) out.gas = options.gasLimit;
  if (options.gasPrice !== undefined) out.gasPrice = options.gasPrice;
  if (options.maxFeePerGas !== undefined) out.maxFeePerGas = options.maxFeePerGas;
  if (options.maxPriorityFeePerGas !== undefined) out.maxPriorityFeePerGas = options.maxPriorityFeePerGas;
  return out;
}

export class ViemChainClient implements ChainClient {
  public readonly chainId: number;
  public readonly rpcUrl: string;
  private readonly sponsorWhenAvailable: boolean;
  private readonly megaFuelUrl?: string;
  private readonly megaFuelUserAgent: string;

  private readonly publicClient: ReturnType<typeof createPublicClient>;
  private readonly receiptClient?: ReturnType<typeof createPublicClient>;
  private readonly walletClient?: ReturnType<typeof createWalletClient>;
  private readonly account?: PrivateKeyAccount;

  constructor(config: ViemChainClientConfig) {
    this.chainId = config.chainId;
    this.rpcUrl = config.rpcUrl;
    this.sponsorWhenAvailable = config.sponsorWhenAvailable ?? true;
    this.megaFuelUserAgent = config.megaFuelUserAgent ?? DEFAULT_MEGAFUEL_USER_AGENT;
    this.megaFuelUrl =
      this.chainId === BSC_TESTNET_CHAIN_ID
        ? (config.megaFuelUrl ?? DEFAULT_BSC_MEGAFUEL_URL).replace(/\/+$/, '')
        : (config.megaFuelUrl ? config.megaFuelUrl.replace(/\/+$/, '') : undefined);

    // viem requires a `chain` to be set for some wallet-client actions (e.g. writeContract)
    // when using an EIP-1193 wallet provider transport. We construct a minimal chain object
    // from chainId + rpcUrl so consumers don't need to provide viem chain definitions.
    const viemChain = defineChain({
      id: this.chainId,
      name: `chain-${this.chainId}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [this.rpcUrl] } },
    });

    this.publicClient = createPublicClient({
      chain: viemChain,
      transport: http(this.rpcUrl),
    });

    if (config.privateKey) {
      this.account = privateKeyToAccount(normalizeHexKey(config.privateKey));
      this.walletClient = createWalletClient({
        chain: viemChain,
        account: this.account,
        transport: http(this.rpcUrl),
      });
    } else if (config.walletProvider) {
      // When using a browser wallet, transactions may be submitted via the wallet's RPC backend.
      // Some public RPCs can lag or be out of sync, which can cause receipt polling timeouts.
      // We keep `publicClient` on rpcUrl for normal reads, but use this receiptClient as a fallback
      // for `waitForTransaction` when the rpcUrl path times out.
      this.receiptClient = createPublicClient({
        chain: viemChain,
        transport: custom(config.walletProvider),
      });
      this.walletClient = createWalletClient({
        chain: viemChain,
        transport: custom(config.walletProvider),
      });
    }
  }

  async getAddress(): Promise<Address | undefined> {
    // Private key path
    if (this.account) {
      return toSdkAddress(this.account.address);
    }

    // Wallet provider path (non-interactive): eth_accounts
    if (!this.walletClient) return undefined;
    try {
      const addrs = await (this.walletClient as any).getAddresses?.();
      if (Array.isArray(addrs) && typeof addrs[0] === 'string') {
        return toSdkAddress(addrs[0]);
      }
    } catch {
      // fall through
    }
    try {
      const prov = (this.walletClient as any).transport?.value as EIP1193Provider | undefined;
      const accounts = prov ? await prov.request({ method: 'eth_accounts' }) : undefined;
      if (Array.isArray(accounts) && typeof accounts[0] === 'string') {
        return toSdkAddress(accounts[0]);
      }
    } catch {
      // ignore
    }
    return undefined;
  }

  async ensureAddress(): Promise<Address> {
    const existing = await this.getAddress();
    if (existing) return existing;

    // Private key path has no interactive prompt; if missing, it's a config error.
    if (this.account) {
      throw new Error('No account available (privateKey configured but address could not be resolved)');
    }

    if (!this.walletClient) {
      throw new Error('No signer available. Configure walletProvider (browser) or privateKey (server).');
    }

    const prov = (this.walletClient as any).transport?.value as EIP1193Provider | undefined;
    if (!prov) {
      throw new Error('No EIP-1193 provider available to request accounts.');
    }

    const accounts = await prov.request({ method: 'eth_requestAccounts' });
    if (Array.isArray(accounts) && typeof accounts[0] === 'string') {
      return toSdkAddress(accounts[0]);
    }
    throw new Error('Wallet did not return accounts from eth_requestAccounts');
  }

  async readContract<T = unknown>(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<T> {
    // Optional safety: verify configured chainId matches RPC chainId.
    const rpcChainId = await this.publicClient.getChainId();
    if (rpcChainId !== this.chainId) {
      throw new Error(
        `RPC chainId mismatch: SDK configured for chainId=${this.chainId} but rpcUrl reports chainId=${rpcChainId}`
      );
    }

    return (await this.publicClient.readContract({
      address: toViemAddress(args.address),
      abi: args.abi as any,
      functionName: args.functionName as any,
      args: (args.args ?? []) as any,
    })) as T;
  }

  async writeContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
    options?: TransactionOptions;
  }): Promise<`0x${string}`> {
    if (!this.walletClient) {
      throw new Error('No signer available. Configure walletProvider (browser) or privateKey (server).');
    }

    if (this.shouldAttemptSponsorship()) {
      const sponsoredHash = await this.trySponsoredWriteContract(args);
      if (sponsoredHash) return sponsoredHash;
    }

    // Ensure account exists / is connected
    // IMPORTANT:
    // - If we have a local private key account, pass the ACCOUNT OBJECT so viem signs locally and uses eth_sendRawTransaction.
    // - If we're on a browser wallet, pass the address so the wallet signs and uses eth_sendTransaction (via the wallet provider).
    const accountForViem = (this.account ?? ((await this.ensureAddress()) as unknown as ViemAddress)) as any;

    // Browser safety: if wallet is on the wrong chain, fail with a clear message.
    try {
      const walletChainId = await (this.walletClient as any).getChainId?.();
      if (typeof walletChainId === 'number' && walletChainId !== this.chainId) {
        throw new Error(
          `Wallet chainId mismatch: expected chainId=${this.chainId}, got chainId=${walletChainId}. ` +
            `Please switch the wallet network.`
        );
      }
    } catch {
      // If not supported, we rely on RPC errors or downstream handling.
    }

    const hash = (await (this.walletClient as any).writeContract({
      address: toViemAddress(args.address),
      abi: args.abi as any,
      functionName: args.functionName as any,
      args: (args.args ?? []) as any,
      account: accountForViem,
      ...toViemTxOptions(args.options),
    })) as Hex;
    return hash as `0x${string}`;
  }

  async sendTransaction(args: {
    to: Address;
    data: `0x${string}`;
    options?: TransactionOptions;
  }): Promise<`0x${string}`> {
    if (!this.walletClient) {
      throw new Error('No signer available. Configure walletProvider (browser) or privateKey (server).');
    }

    if (this.shouldAttemptSponsorship()) {
      const sponsoredHash = await this.trySponsoredSendTransaction(args);
      if (sponsoredHash) return sponsoredHash;
    }
    const accountForViem = (this.account ?? ((await this.ensureAddress()) as unknown as ViemAddress)) as any;
    const hash = (await (this.walletClient as any).sendTransaction({
      to: toViemAddress(args.to),
      data: args.data as Hex,
      account: accountForViem,
      ...toViemTxOptions(args.options),
    })) as Hex;
    return hash as `0x${string}`;
  }

  private shouldAttemptSponsorship(): boolean {
    return Boolean(
      this.sponsorWhenAvailable &&
        this.chainId === BSC_TESTNET_CHAIN_ID &&
        this.account &&
        this.megaFuelUrl
    );
  }

  private async trySponsoredWriteContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
    options?: TransactionOptions;
  }): Promise<`0x${string}` | undefined> {
    try {
      const data = encodeFunctionData({
        abi: args.abi as any,
        functionName: args.functionName as any,
        args: (args.args ?? []) as any,
      }) as `0x${string}`;
      return await this.trySponsoredSendRawTransaction({
        to: args.address,
        data,
        options: args.options,
      });
    } catch {
      return undefined;
    }
  }

  private async trySponsoredSendTransaction(args: {
    to: Address;
    data: `0x${string}`;
    options?: TransactionOptions;
  }): Promise<`0x${string}` | undefined> {
    try {
      return await this.trySponsoredSendRawTransaction(args);
    } catch {
      return undefined;
    }
  }

  private async trySponsoredSendRawTransaction(args: {
    to: Address;
    data: `0x${string}`;
    options?: TransactionOptions;
  }): Promise<`0x${string}` | undefined> {
    if (!this.account || !this.megaFuelUrl) return undefined;

    const from = this.account.address as ViemAddress;
    const gas =
      args.options?.gasLimit ??
      (await this.publicClient.estimateGas({
        account: from,
        to: toViemAddress(args.to),
        data: args.data as Hex,
      }));

    const sponsorable = await this.isMegaFuelSponsorable({
      to: args.to,
      from: from as unknown as Address,
      value: 0n,
      data: args.data,
      gas,
    });
    if (!sponsorable) return undefined;

    const nonce = await this.getMegaFuelNonce(from as unknown as Address);
    const signedTx = await this.account.signTransaction({
      to: toViemAddress(args.to),
      data: args.data as Hex,
      chainId: this.chainId,
      nonce,
      gas,
      gasPrice: 0n,
      type: 'legacy',
    });

    const txHash = await this.megaFuelRpc<string>(
      'eth_sendRawTransaction',
      [signedTx],
      { 'User-Agent': this.megaFuelUserAgent }
    );
    if (!txHash || typeof txHash !== 'string' || !txHash.startsWith('0x')) {
      return undefined;
    }
    return txHash as `0x${string}`;
  }

  private async isMegaFuelSponsorable(tx: {
    to: Address;
    from: Address;
    value: bigint;
    data: `0x${string}`;
    gas: bigint;
  }): Promise<boolean> {
    const result = await this.megaFuelRpc<any>('pm_isSponsorable', [
      {
        to: tx.to,
        from: tx.from,
        value: toRpcHex(tx.value),
        data: tx.data,
        gas: toRpcHex(tx.gas),
      },
    ]);
    const sponsorable = result?.sponsorable ?? result?.Sponsorable;
    return sponsorable === true;
  }

  private async getMegaFuelNonce(address: Address): Promise<number> {
    const hexNonce = await this.megaFuelRpc<string>('eth_getTransactionCount', [address, 'pending']);
    if (typeof hexNonce !== 'string' || !hexNonce.startsWith('0x')) {
      throw new Error('Invalid nonce response from MegaFuel');
    }
    return Number(BigInt(hexNonce));
  }

  private async megaFuelRpc<T = unknown>(
    method: string,
    params: unknown[],
    headers?: Record<string, string>
  ): Promise<T> {
    if (!this.megaFuelUrl) throw new Error('MegaFuel URL is not configured');
    const res = await fetch(this.megaFuelUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(headers ?? {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
    });
    if (!res.ok) {
      throw new Error(`MegaFuel RPC HTTP ${res.status}`);
    }
    const body = (await res.json()) as { result?: T; error?: { message?: string } };
    if (body.error) {
      throw new Error(body.error.message || `MegaFuel RPC error in ${method}`);
    }
    return body.result as T;
  }

  async waitForTransaction(args: WaitForTransactionArgs): Promise<ChainReceipt> {
    let receipt: any;
    try {
      receipt = await this.publicClient.waitForTransactionReceipt({
        hash: args.hash as Hex,
        timeout: args.timeoutMs,
        confirmations: args.confirmations,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (this.receiptClient && message.toLowerCase().includes('timed out')) {
        receipt = await this.receiptClient.waitForTransactionReceipt({
          hash: args.hash as Hex,
          timeout: args.timeoutMs,
          confirmations: args.confirmations,
        });
      } else {
        throw err;
      }
    }

    const logs: ChainLog[] = (receipt.logs || []).map((l: any) => ({
      address: toSdkAddress(l.address),
      data: l.data as `0x${string}`,
      topics: (l.topics || []) as `0x${string}`[],
      blockNumber: l.blockNumber,
      transactionHash: l.transactionHash,
      logIndex: typeof l.logIndex === 'number' ? l.logIndex : undefined,
    }));

    const status: ChainReceipt['status'] = receipt.status === 'reverted' ? 'reverted' : 'success';

    return {
      transactionHash: receipt.transactionHash as `0x${string}`,
      blockNumber: receipt.blockNumber,
      status,
      logs,
    };
  }

  async getEventLogs(args: {
    address: Address;
    abi: readonly unknown[];
    eventName: string;
    eventArgs?: Record<string, unknown>;
    fromBlock?: bigint;
    toBlock?: bigint;
  }): Promise<ChainLog[]> {
    const event = getAbiItem({ abi: args.abi as any, name: args.eventName, type: 'event' } as any);
    const logs = await this.publicClient.getLogs({
      address: toViemAddress(args.address),
      event: event as any,
      args: (args.eventArgs ?? undefined) as any,
      fromBlock: args.fromBlock,
      toBlock: args.toBlock,
    });
    return (logs || []).map((l: any) => ({
      address: toSdkAddress(l.address),
      data: l.data as `0x${string}`,
      topics: (l.topics || []) as `0x${string}`[],
      blockNumber: l.blockNumber,
      transactionHash: l.transactionHash,
      logIndex: typeof l.logIndex === 'number' ? l.logIndex : undefined,
    }));
  }

  async getBlockNumber(): Promise<bigint> {
    return await this.publicClient.getBlockNumber();
  }

  async getBlockTimestamp(blockTag: 'latest' = 'latest'): Promise<bigint> {
    const block = await this.publicClient.getBlock({ blockTag });
    return block.timestamp;
  }

  keccak256Utf8(message: string): `0x${string}` {
    return keccak256(toBytes(message)) as `0x${string}`;
  }

  isAddress(address: string): boolean {
    return viemIsAddress(address);
  }

  toChecksumAddress(address: string): Address {
    return toSdkAddress(viemGetAddress(address));
  }

  async signMessage(message: string | Uint8Array): Promise<`0x${string}`> {
    if (!this.walletClient) {
      throw new Error('No signer available. Configure walletProvider (browser) or privateKey (server).');
    }
    const account = (this.account?.address ?? (await this.ensureAddress())) as unknown as ViemAddress;
    const sig = (await (this.walletClient as any).signMessage({
      account,
      message: typeof message === 'string' ? message : { raw: message },
    })) as Hex;
    return normalizeEcdsaSignature(sig) as `0x${string}`;
  }

  async signTypedData(args: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<`0x${string}`> {
    if (!this.walletClient) {
      throw new Error('No signer available. Configure walletProvider (browser) or privateKey (server).');
    }
    const account = (this.account?.address ?? (await this.ensureAddress())) as unknown as ViemAddress;
    const sig = (await (this.walletClient as any).signTypedData({
      account,
      domain: args.domain as any,
      types: args.types as any,
      primaryType: args.primaryType as any,
      message: args.message as any,
    })) as Hex;
    return normalizeEcdsaSignature(sig) as `0x${string}`;
  }

  /**
   * Helper for encoding function data, used for overloaded functions when needed.
   */
  encodeFunctionData(args: { abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }): `0x${string}` {
    return encodeFunctionData({
      abi: args.abi as any,
      functionName: args.functionName as any,
      args: (args.args ?? []) as any,
    }) as `0x${string}`;
  }
}

