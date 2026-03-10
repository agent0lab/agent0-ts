/**
 * Main SDK class for Agent0
 */
import type {
  AgentSummary,
  Feedback,
  SearchFeedbackParams,
  RegistrationFile,
  Endpoint,
  FeedbackFileInput,
  SearchOptions,
  FeedbackSearchFilters,
  FeedbackSearchOptions,
  SearchFilters,
} from '../models/interfaces.js';
import type { AgentId, ChainId, Address, URI } from '../models/types.js';
import { EndpointType, TrustModel } from '../models/enums.js';
import { formatAgentId, parseAgentId } from '../utils/id-format.js';
import { IPFS_GATEWAYS, TIMEOUTS } from '../utils/constants.js';
import { decodeErc8004JsonDataUri, isErc8004JsonDataUri } from '../utils/data-uri.js';
import type { ChainClient, EIP1193Provider as Eip1193Provider } from './chain-client.js';
import { ViemChainClient } from './viem-chain-client.js';
import { IPFSClient, type IPFSClientConfig } from './ipfs-client.js';
import { SubgraphClient } from './subgraph-client.js';
import { FeedbackManager } from './feedback-manager.js';
import { AgentIndexer } from './indexer.js';
import { Agent } from './agent.js';
import { A2AClientFromSummary } from './a2a-summary-client.js';
import type { TransactionHandle } from './transaction-handle.js';
import {
  DEFAULT_REGISTRIES,
  DEFAULT_RPC_URLS,
  DEFAULT_SUBGRAPH_URLS,
  IDENTITY_REGISTRY_ABI,
  REPUTATION_REGISTRY_ABI,
} from './contracts.js';
import { requestWithX402, type X402RequestDeps } from './x402-request.js';
import { buildEvmPayment, checkEvmBalance } from './x402-payment.js';
import type { X402RequestOptions, X402RequestResult } from './x402-types.js';

export interface SDKConfig {
  chainId: ChainId;
  /**
   * RPC URL for the primary chain. Optional when a built-in default exists for `chainId`.
   * Overrides DEFAULT_RPC_URLS for this chain when provided.
   */
  rpcUrl?: string;
  /**
   * Backwards-compatible alias for `privateKey` (accepts a hex private key string).
   */
  signer?: string;
  /**
   * Server-side signing (hex private key string).
   */
  privateKey?: string;
  /**
   * Browser-side signing (EIP-1193 provider, typically selected via ERC-6963).
   */
  walletProvider?: Eip1193Provider;
  registryOverrides?: Record<ChainId, Record<string, Address>>;
  // IPFS configuration
  /**
   * IPFS provider selection:
   * - `node`: connect to a running Kubo daemon via HTTP RPC API (`ipfsNodeUrl` required)
   * - `helia`: run an embedded Helia node in-process (no daemon required)
   * - `pinata`: pin via Pinata
   * - `filecoinPin`: (placeholder) Filecoin pinning integration
   */
  ipfs?: 'node' | 'helia' | 'filecoinPin' | 'pinata';
  ipfsNodeUrl?: string;
  filecoinPrivateKey?: string;
  pinataJwt?: string;
  // Subgraph configuration
  subgraphUrl?: string;
  subgraphOverrides?: Record<ChainId, string>;
  /**
   * Per-chain RPC URL overrides (e.g. for x402 payments on other chains).
   * Applied after built-in defaults and config.rpcUrl. Example: { 84532: 'https://base-sepolia.drpc.org' }.
   */
  overrideRpcUrls?: Record<number, string>;
  /**
   * Max decoded bytes for ERC-8004 JSON base64 data URIs (on-chain registration files).
   * Default: 256 KiB.
   */
  registrationDataUriMaxBytes?: number;
}

/**
 * Main SDK class for Agent0
 */
export class SDK {
  private readonly _chainClient: ChainClient;
  private _ipfsClient?: IPFSClient;
  private _subgraphClient?: SubgraphClient;
  private readonly _feedbackManager: FeedbackManager;
  private readonly _indexer: AgentIndexer;
  private readonly _registries: Record<string, Address>;
  private readonly _registryOverrides: Record<ChainId, Record<string, Address>>;
  private readonly _chainId: ChainId;
  private readonly _subgraphUrls: Record<ChainId, string> = {};
  private readonly _hasSignerConfig: boolean;
  private readonly _rpcUrls: Record<number, string>;
  private readonly _paymentChainClients = new Map<number, ChainClient>();
  private readonly _readOnlyChainClients = new Map<number, ChainClient>();
  private readonly _signerForPayment: { privateKey?: string; walletProvider?: Eip1193Provider };
  private readonly _registrationDataUriMaxBytes: number;

  constructor(config: SDKConfig) {
    this._chainId = config.chainId;
    // Merge order: defaults → rpcUrl (primary chain) → overrideRpcUrls
    this._rpcUrls = { ...DEFAULT_RPC_URLS };
    if (config.rpcUrl?.trim()) {
      this._rpcUrls[config.chainId] = config.rpcUrl.trim();
    }
    if (config.overrideRpcUrls) {
      for (const [chainId, url] of Object.entries(config.overrideRpcUrls)) {
        if (url?.trim()) this._rpcUrls[Number(chainId)] = url.trim();
      }
    }
    const mainRpc = this._rpcUrls[config.chainId];
    if (!mainRpc?.trim()) {
      throw new Error(
        `No RPC URL for chain ${config.chainId}. Provide rpcUrl or add the chain to overrideRpcUrls in SDK config.`
      );
    }
    const privateKey = config.privateKey ?? config.signer;
    this._signerForPayment = { privateKey, walletProvider: config.walletProvider };
    this._registrationDataUriMaxBytes = config.registrationDataUriMaxBytes ?? 256 * 1024;

    // Initialize Chain client (viem-only)
    this._hasSignerConfig = Boolean(privateKey || config.walletProvider);
    this._chainClient = new ViemChainClient({
      chainId: config.chainId,
      rpcUrl: mainRpc,
      privateKey,
      walletProvider: config.walletProvider,
    });

    // Resolve registry addresses
    const registryOverrides = config.registryOverrides || {};
    this._registryOverrides = registryOverrides;
    const defaultRegistries = DEFAULT_REGISTRIES[config.chainId] || {};
    this._registries = { ...defaultRegistries, ...(registryOverrides[config.chainId] || {}) };

    // Resolve subgraph URL
    if (config.subgraphOverrides) {
      Object.assign(this._subgraphUrls, config.subgraphOverrides);
    }

    let resolvedSubgraphUrl: string | undefined;
    if (config.chainId in this._subgraphUrls) {
      resolvedSubgraphUrl = this._subgraphUrls[config.chainId];
    } else if (config.chainId in DEFAULT_SUBGRAPH_URLS) {
      resolvedSubgraphUrl = DEFAULT_SUBGRAPH_URLS[config.chainId];
    } else if (config.subgraphUrl) {
      resolvedSubgraphUrl = config.subgraphUrl;
    }

    // Initialize subgraph client if URL available
    if (resolvedSubgraphUrl) {
      this._subgraphClient = new SubgraphClient(resolvedSubgraphUrl);
    }

    // Initialize indexer
    this._indexer = new AgentIndexer(this._subgraphClient, this._subgraphUrls, this._chainId);

    // Initialize IPFS client
    if (config.ipfs) {
      this._ipfsClient = this._initializeIpfsClient(config);
    }

    // Initialize feedback manager (will set registries after they're created)
    this._feedbackManager = new FeedbackManager(
      this._chainClient,
      this._ipfsClient,
      undefined, // reputationRegistryAddress - will be set lazily
      undefined, // identityRegistryAddress - will be set lazily
      this._subgraphClient
    );

    // Set subgraph client getter for multi-chain support
    this._feedbackManager.setSubgraphClientGetter(
      (chainId) => this.getSubgraphClient(chainId),
      this._chainId
    );
  }

  /**
   * Initialize IPFS client based on configuration
   */
  private _initializeIpfsClient(config: SDKConfig): IPFSClient {
    if (!config.ipfs) {
      throw new Error('IPFS provider not specified');
    }

    const ipfsConfig: IPFSClientConfig = {};

    if (config.ipfs === 'node') {
      if (!config.ipfsNodeUrl) {
        throw new Error("ipfsNodeUrl is required when ipfs='node'");
      }
      ipfsConfig.url = config.ipfsNodeUrl;
    } else if (config.ipfs === 'helia') {
      ipfsConfig.embeddedHeliaEnabled = true;
    } else if (config.ipfs === 'filecoinPin') {
      if (!config.filecoinPrivateKey) {
        throw new Error("filecoinPrivateKey is required when ipfs='filecoinPin'");
      }
      ipfsConfig.filecoinPinEnabled = true;
      ipfsConfig.filecoinPrivateKey = config.filecoinPrivateKey;
    } else if (config.ipfs === 'pinata') {
      if (!config.pinataJwt) {
        throw new Error("pinataJwt is required when ipfs='pinata'");
      }
      ipfsConfig.pinataEnabled = true;
      ipfsConfig.pinataJwt = config.pinataJwt;
    } else {
      throw new Error(
        `Invalid ipfs value: ${config.ipfs}. Must be 'node', 'helia', 'filecoinPin', or 'pinata'`
      );
    }

    return new IPFSClient(ipfsConfig);
  }

  /**
   * Get current chain ID
   */
  async chainId(): Promise<ChainId> {
    return this._chainId;
  }

  /**
   * Get resolved registry addresses for current chain
   */
  registries(): Record<string, Address> {
    return { ...this._registries };
  }

  /**
   * Get subgraph client for a specific chain
   */
  getSubgraphClient(chainId?: ChainId): SubgraphClient | undefined {
    const targetChain = chainId !== undefined ? chainId : this._chainId;

    // Check if we already have a client for this chain
    if (targetChain === this._chainId && this._subgraphClient) {
      return this._subgraphClient;
    }

    // Resolve URL for target chain
    let url: string | undefined;
    if (targetChain in this._subgraphUrls) {
      url = this._subgraphUrls[targetChain];
    } else if (targetChain in DEFAULT_SUBGRAPH_URLS) {
      url = DEFAULT_SUBGRAPH_URLS[targetChain];
    }

    if (url) {
      return new SubgraphClient(url);
    }
    return undefined;
  }

  /**
   * Return the chain client to use for building an x402 payment for the given accept.
   * Uses the accept's network (e.g. eip155:84532) so the signature matches the chain the server verifies.
   */
  private getChainClientForAccept(accept: { network?: string; [key: string]: unknown }): ChainClient {
    const raw = accept?.network ?? String(this._chainId);
    const m = String(raw).match(/^eip155:(\d+)$/);
    const chainId = m ? parseInt(m[1]!, 10) : parseInt(String(raw), 10);
    if (Number.isNaN(chainId)) return this._chainClient;
    if (chainId === this._chainId) return this._chainClient;
    const cached = this._paymentChainClients.get(chainId);
    if (cached) return cached;
    const rpcUrl = this._rpcUrls[chainId];
    if (!rpcUrl?.trim()) {
      throw new Error(
        `x402: payment option requires chain ${chainId} but SDK is configured for chain ${this._chainId}. ` +
          `Add overrideRpcUrls: { ${chainId}: 'https://...' } to SDK config to pay on that chain.`
      );
    }
    const client = new ViemChainClient({
      chainId,
      rpcUrl: rpcUrl.trim(),
      privateKey: this._signerForPayment.privateKey,
      walletProvider: this._signerForPayment.walletProvider,
    });
    this._paymentChainClients.set(chainId, client);
    return client;
  }

  /**
   * Perform an HTTP request with built-in x402 (402 Payment Required) handling.
   * On 2xx returns the parsed result (default: JSON body); on 402 returns { x402Required: true, x402Payment } (no throw).
   * Use x402Payment.pay() to pay and retry.
   */
  async request<T = object>(options: X402RequestOptions<T>): Promise<X402RequestResult<T>> {
    return requestWithX402(options, {
      fetch: globalThis.fetch,
      buildPayment: (accept, snapshot) =>
        buildEvmPayment(accept, this.getChainClientForAccept(accept), snapshot),
    });
  }

  /**
   * Alias for request() for x402-specific usage.
   */
  async fetchWithX402<T = object>(options: X402RequestOptions<T>): Promise<X402RequestResult<T>> {
    return this.request(options);
  }

  identityRegistryAddress(): Address {
      const address = this._registries.IDENTITY;
    if (!address) throw new Error(`No identity registry address for chain ${this._chainId}`);
    // Ensure feedback manager has it for off-chain file composition.
    this._feedbackManager.setIdentityRegistryAddress(address);
    return address;
  }

  reputationRegistryAddress(): Address {
      const address = this._registries.REPUTATION;
    if (!address) throw new Error(`No reputation registry address for chain ${this._chainId}`);
    this._feedbackManager.setReputationRegistryAddress(address);
    return address;
  }

  validationRegistryAddress(): Address {
      const address = this._registries.VALIDATION;
    if (!address) throw new Error(`No validation registry address for chain ${this._chainId}`);
    return address;
  }

  /**
   * Get a chain client for the given chain (for reads, e.g. loadAgent or getWallet on another chain).
   * Returns the SDK's main chain client when chainId matches; otherwise a read-only cached client.
   */
  getChainClientForChain(chainId: ChainId): ChainClient {
    if (chainId === this._chainId) {
      return this._chainClient;
    }
    const cached = this._readOnlyChainClients.get(chainId);
    if (cached) return cached;
    const rpcUrl = this._rpcUrls[chainId];
    if (!rpcUrl?.trim()) {
      throw new Error(
        `To load agents from chain ${chainId}, add overrideRpcUrls: { ${chainId}: 'https://...' } to SDK config.`
      );
    }
    const client = new ViemChainClient({
      chainId,
      rpcUrl: rpcUrl.trim(),
    });
    this._readOnlyChainClients.set(chainId, client);
    return client;
  }

  /**
   * Get identity registry address for the given chain (for reads when loading or querying agents on that chain).
   */
  getIdentityRegistryAddressForChain(chainId: ChainId): Address {
    const address =
      (DEFAULT_REGISTRIES[chainId]?.IDENTITY as Address | undefined) ??
      this._registryOverrides[chainId]?.IDENTITY;
    if (!address) {
      throw new Error(`Chain ${chainId} has no identity registry configured.`);
    }
    return address;
  }

  /**
   * Check if SDK is in read-only mode (no signer)
   */
  get isReadOnly(): boolean {
    return !this._hasSignerConfig;
  }

  // Agent lifecycle methods

  /**
   * Create a new agent (off-chain object in memory)
   */
  createAgent(name: string, description: string, image?: URI): Agent {
    const registrationFile: RegistrationFile = {
      name,
      description,
      image,
      endpoints: [],
      // Default trust model: reputation (if caller doesn't set one explicitly).
      trustModels: [TrustModel.REPUTATION],
      owners: [],
      operators: [],
      active: false,
      x402support: false,
      metadata: {},
      updatedAt: Math.floor(Date.now() / 1000),
    };
    return new Agent(this, registrationFile);
  }

  /**
   * Load an existing agent (hydrates from registration file if registered).
   * Supports loading agents from any chain; use the same SDK chain to update them.
   */
  async loadAgent(agentId: AgentId): Promise<Agent> {
    // Parse agent ID
    const { chainId, tokenId } = parseAgentId(agentId);

    const client = this.getChainClientForChain(chainId);
    const registry = this.getIdentityRegistryAddressForChain(chainId);

    // Get agent URI from contract
    let agentURI: string;
    try {
      agentURI = await client.readContract<string>({
        address: registry,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'tokenURI',
        args: [BigInt(tokenId)],
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load agent ${agentId}: ${errorMessage}`);
    }

    // Load registration file - handle empty URI (agent registered without URI yet)
    let registrationFile: RegistrationFile;
    if (!agentURI || agentURI === '') {
      // Agent registered but no URI set yet - create empty registration file
      registrationFile = this._createEmptyRegistrationFile();
    } else {
      registrationFile = await this._loadRegistrationFile(agentURI);
    }
    
    registrationFile.agentId = agentId;
    registrationFile.agentURI = agentURI || undefined;

    return new Agent(this, registrationFile);
  }

  /**
   * Get agent summary from subgraph (read-only)
   * Supports both default chain and explicit chain specification via chainId:tokenId format
   */
  async getAgent(agentId: AgentId): Promise<AgentSummary | null> {
    // Parse agentId to extract chainId if present
    // If no colon, assume it's just tokenId on default chain
    let parsedChainId: number;
    let formattedAgentId: string;
    
    if (agentId.includes(':')) {
      const parsed = parseAgentId(agentId);
      parsedChainId = parsed.chainId;
      formattedAgentId = agentId; // Already in correct format
    } else {
      // No colon - use default chain
      parsedChainId = this._chainId;
      formattedAgentId = formatAgentId(this._chainId, parseInt(agentId, 10));
    }
    
    // Determine which chain to query
    const targetChainId = parsedChainId !== this._chainId ? parsedChainId : undefined;
    
    // Get subgraph client for the target chain (or use default)
    const subgraphClient = targetChainId
      ? this.getSubgraphClient(targetChainId)
      : this._subgraphClient;
    
    if (!subgraphClient) {
      throw new Error(`Subgraph client required for getAgent on chain ${targetChainId || this._chainId}`);
    }
    
    return subgraphClient.getAgentById(formattedAgentId);
  }

  /**
   * Search agents with filters
   * Supports multi-chain search when chains parameter is provided
   */
  async searchAgents(
    filters: SearchFilters = {},
    options: SearchOptions = {}
  ): Promise<AgentSummary[]> {
    return this._indexer.searchAgents(filters, options);
  }

  /**
   * Create an A2A client from a loaded Agent or an AgentSummary.
   * When given an Agent, returns it as-is (Agent already has messageA2A, listTasks, loadTask).
   * When given an AgentSummary, returns an A2AClientFromSummary that resolves the agent card from summary.a2a on first use.
   * Use this to treat agents and summaries interchangeably for A2A.
   */
  createA2AClient(agentOrSummary: Agent | AgentSummary): Agent | A2AClientFromSummary {
    if (agentOrSummary instanceof Agent) {
      return agentOrSummary;
    }
    return new A2AClientFromSummary(this, agentOrSummary);
  }

  /**
   * Transfer agent ownership
   */
  async transferAgent(
    agentId: AgentId,
    newOwner: Address
  ): Promise<TransactionHandle<{ txHash: string; from: Address; to: Address; agentId: AgentId }>> {
    const agent = await this.loadAgent(agentId);
    return agent.transfer(newOwner);
  }

  /**
   * Check if address is agent owner
   */
  async isAgentOwner(agentId: AgentId, address: Address): Promise<boolean> {
    const { chainId, tokenId } = parseAgentId(agentId);
    const client = this.getChainClientForChain(chainId);
    const registry = this.getIdentityRegistryAddressForChain(chainId);
    const owner = await client.readContract<string>({
      address: registry,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'ownerOf',
      args: [BigInt(tokenId)],
    });
    return owner.toLowerCase() === address.toLowerCase();
  }

  /**
   * Get agent owner
   */
  async getAgentOwner(agentId: AgentId): Promise<Address> {
    const { chainId, tokenId } = parseAgentId(agentId);
    const client = this.getChainClientForChain(chainId);
    const registry = this.getIdentityRegistryAddressForChain(chainId);
    return await client.readContract<Address>({
      address: registry,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'ownerOf',
      args: [BigInt(tokenId)],
    });
  }

  // Feedback methods

  /**
   * Prepare an off-chain feedback file.
   *
   * This does NOT include on-chain fields like score/tag1/tag2/endpoint.
   */
  prepareFeedbackFile(input: FeedbackFileInput, extra?: Record<string, unknown>): FeedbackFileInput {
    return this._feedbackManager.prepareFeedbackFile(input, extra);
  }

  /**
   * Give feedback
   */
  async giveFeedback(
    agentId: AgentId,
    value: number | string,
    tag1?: string,
    tag2?: string,
    endpoint?: string,
    feedbackFile?: FeedbackFileInput
  ): Promise<TransactionHandle<Feedback>> {
    // Update feedback manager with registries
    this._feedbackManager.setReputationRegistryAddress(this.reputationRegistryAddress());
    this._feedbackManager.setIdentityRegistryAddress(this.identityRegistryAddress());

    return this._feedbackManager.giveFeedback(agentId, value, tag1, tag2, endpoint, feedbackFile);
  }

  /**
   * Read feedback
   */
  async getFeedback(agentId: AgentId, clientAddress: Address, feedbackIndex: number): Promise<Feedback> {
    return this._feedbackManager.getFeedback(agentId, clientAddress, feedbackIndex);
  }

  /**
   * Search feedback
   */
  async searchFeedback(
    filters: FeedbackSearchFilters,
    options: FeedbackSearchOptions = {}
  ): Promise<Feedback[]> {
    const mergedAgents = [
      ...(filters.agents ?? []),
      ...(filters.agentId ? [filters.agentId] : []),
    ];
    const agents = mergedAgents.length > 0 ? Array.from(new Set(mergedAgents)) : undefined;

    const hasAnyFilter =
      (agents?.length ?? 0) > 0 ||
      (filters.reviewers?.length ?? 0) > 0 ||
      (filters.tags?.length ?? 0) > 0 ||
      (filters.capabilities?.length ?? 0) > 0 ||
      (filters.skills?.length ?? 0) > 0 ||
      (filters.tasks?.length ?? 0) > 0 ||
      (filters.names?.length ?? 0) > 0 ||
      options.minValue !== undefined ||
      options.maxValue !== undefined;

    // Previously, `agentId` was required so a fully-empty search wasn't possible.
    // Keep behavior safe by rejecting empty searches that would otherwise return arbitrary global results.
    if (!hasAnyFilter) {
      throw new Error(
        'searchFeedback requires at least one filter (agentId/agents/reviewers/tags/capabilities/skills/tasks/names/minValue/maxValue).'
      );
    }

    const params: SearchFeedbackParams = {
      agents,
      tags: filters.tags,
      reviewers: filters.reviewers,
      capabilities: filters.capabilities,
      skills: filters.skills,
      tasks: filters.tasks,
      names: filters.names,
      includeRevoked: filters.includeRevoked,
      minValue: options.minValue,
      maxValue: options.maxValue,
    };
    return this._feedbackManager.searchFeedback(params);
  }

  /**
   * Append response to feedback
   */
  async appendResponse(
    agentId: AgentId,
    clientAddress: Address,
    feedbackIndex: number,
    response: { uri: URI; hash: string }
  ): Promise<TransactionHandle<Feedback>> {
    // Update feedback manager with registries
    this._feedbackManager.setReputationRegistryAddress(this.reputationRegistryAddress());

    return this._feedbackManager.appendResponse(agentId, clientAddress, feedbackIndex, response.uri, response.hash);
  }

  /**
   * Revoke feedback
   */
  async revokeFeedback(agentId: AgentId, feedbackIndex: number): Promise<TransactionHandle<Feedback>> {
    // Update feedback manager with registries
    this._feedbackManager.setReputationRegistryAddress(this.reputationRegistryAddress());

    return this._feedbackManager.revokeFeedback(agentId, feedbackIndex);
  }

  /**
   * Get reputation summary
   */
  async getReputationSummary(
    agentId: AgentId,
    tag1?: string,
    tag2?: string
  ): Promise<{ count: number; averageValue: number }> {
    // Update feedback manager with registries
    this._feedbackManager.setReputationRegistryAddress(this.reputationRegistryAddress());

    return this._feedbackManager.getReputationSummary(agentId, tag1, tag2);
  }

  /**
   * Create an empty registration file structure
   */
  private _createEmptyRegistrationFile(): RegistrationFile {
    return {
      name: '',
      description: '',
      endpoints: [],
      trustModels: [],
      owners: [],
      operators: [],
      active: false,
      x402support: false,
      metadata: {},
      updatedAt: Math.floor(Date.now() / 1000),
    };
  }

  /**
   * Private helper methods
   */
  private async _loadRegistrationFile(tokenUri: string): Promise<RegistrationFile> {
    try {
      // Fetch from IPFS or HTTP
      let rawData: unknown;
      if (tokenUri.startsWith('ipfs://')) {
        const cid = tokenUri.slice(7);
        if (this._ipfsClient) {
          // Use IPFS client if available
          rawData = await this._ipfsClient.getJson(cid);
        } else {
          // Fallback to HTTP gateways if no IPFS client configured
          const gateways = IPFS_GATEWAYS.map(gateway => `${gateway}${cid}`);
          
          let fetched = false;
          for (const gateway of gateways) {
            try {
              const response = await fetch(gateway, {
                signal: AbortSignal.timeout(TIMEOUTS.IPFS_GATEWAY),
              });
              if (response.ok) {
                rawData = await response.json();
                fetched = true;
                break;
              }
            } catch {
              continue;
            }
          }
          
          if (!fetched) {
            throw new Error('Failed to retrieve data from all IPFS gateways');
          }
        }
      } else if (tokenUri.startsWith('http://') || tokenUri.startsWith('https://')) {
        const response = await fetch(tokenUri);
        if (!response.ok) {
          throw new Error(`Failed to fetch registration file: HTTP ${response.status}`);
        }
        rawData = await response.json();
      } else if (tokenUri.startsWith('data:')) {
        if (!isErc8004JsonDataUri(tokenUri)) {
          throw new Error(
            `Unsupported data URI. Expected data:application/json;...;base64,... per ERC-8004, got: ${tokenUri.slice(0, 64)}...`
          );
        }
        rawData = decodeErc8004JsonDataUri(tokenUri, { maxBytes: this._registrationDataUriMaxBytes });
      } else if (!tokenUri || tokenUri.trim() === '') {
        // Empty URI - return empty registration file (agent registered without URI)
        return this._createEmptyRegistrationFile();
      } else {
        throw new Error(`Unsupported URI scheme: ${tokenUri}`);
      }

      // Validate rawData is an object before transformation
      if (typeof rawData !== 'object' || rawData === null || Array.isArray(rawData)) {
        throw new Error('Invalid registration file format: expected an object');
      }

      // Transform IPFS/HTTP file format to RegistrationFile format
      return this._transformRegistrationFile(rawData as Record<string, unknown>);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load registration file: ${errorMessage}`);
    }
  }

  /**
   * Transform raw registration file (from IPFS/HTTP) to RegistrationFile format
   * Accepts raw JSON data which may have legacy format or new format
   */
  private _transformRegistrationFile(rawData: Record<string, unknown>): RegistrationFile {
    const endpoints = this._transformEndpoints(rawData);
    const { walletAddress, walletChainId } = this._extractWalletInfo(rawData);
    
    // Extract trust models with proper type checking
    const trustModels: (TrustModel | string)[] = Array.isArray(rawData.supportedTrust)
      ? rawData.supportedTrust
      : Array.isArray(rawData.trustModels)
      ? rawData.trustModels
      : [];

    return {
      name: typeof rawData.name === 'string' ? rawData.name : '',
      description: typeof rawData.description === 'string' ? rawData.description : '',
      image: typeof rawData.image === 'string' ? rawData.image : undefined,
      endpoints,
      trustModels,
      owners: Array.isArray(rawData.owners) ? rawData.owners.filter((o): o is Address => typeof o === 'string') : [],
      operators: Array.isArray(rawData.operators) ? rawData.operators.filter((o): o is Address => typeof o === 'string') : [],
      active: typeof rawData.active === 'boolean' ? rawData.active : false,
      // Accept both `x402Support` (ERC-8004 registration key) and `x402support` (legacy SDK key).
      x402support:
        typeof rawData.x402support === 'boolean'
          ? rawData.x402support
          : (typeof (rawData as any).x402Support === 'boolean' ? (rawData as any).x402Support : false),
      metadata: typeof rawData.metadata === 'object' && rawData.metadata !== null && !Array.isArray(rawData.metadata) 
        ? rawData.metadata as Record<string, unknown>
        : {},
      updatedAt: typeof rawData.updatedAt === 'number' ? rawData.updatedAt : Math.floor(Date.now() / 1000),
      walletAddress,
      walletChainId,
    };
  }

  /**
   * Transform endpoints from old format { name, endpoint, version } to new format { type, value, meta }
   */
  private _transformEndpoints(rawData: Record<string, unknown>): Endpoint[] {
    const endpoints: Endpoint[] = [];
    
    const rawServices = Array.isArray(rawData.services)
      ? rawData.services
      : Array.isArray(rawData.endpoints)
      ? rawData.endpoints
      : null;

    if (!rawServices) {
      return endpoints;
    }
    
    for (const ep of rawServices) {
      // Check if it's already in the new format
      if (ep.type && ep.value !== undefined) {
        endpoints.push({
          type: ep.type as EndpointType,
          value: ep.value,
          meta: ep.meta,
        } as Endpoint);
      } else {
        // Transform from old format
        const transformed = this._transformEndpointLegacy(ep, rawData);
        if (transformed) {
          endpoints.push(transformed);
        }
      }
    }
    
    return endpoints;
  }

  /**
   * Transform a single endpoint from legacy format
   */
  private _transformEndpointLegacy(ep: Record<string, unknown>, rawData: Record<string, unknown>): Endpoint | null {
    const name = typeof ep.name === 'string' ? ep.name : '';
    const value = typeof ep.endpoint === 'string' ? ep.endpoint : '';
    const version = typeof ep.version === 'string' ? ep.version : undefined;

    // Map endpoint names to types using case-insensitive lookup
    const nameLower = name.toLowerCase();
    const ENDPOINT_TYPE_MAP: Record<string, EndpointType> = {
      'mcp': EndpointType.MCP,
      'a2a': EndpointType.A2A,
      'ens': EndpointType.ENS,
      'did': EndpointType.DID,
      'agentwallet': EndpointType.WALLET,
      'wallet': EndpointType.WALLET,
    };

    let type: string;
    if (ENDPOINT_TYPE_MAP[nameLower]) {
      type = ENDPOINT_TYPE_MAP[nameLower];
      
      // Special handling for wallet endpoints - parse eip155 format
      if (type === EndpointType.WALLET) {
        const walletMatch = value.match(/eip155:(\d+):(0x[a-fA-F0-9]{40})/);
        if (walletMatch) {
          rawData._walletAddress = walletMatch[2];
          rawData._walletChainId = parseInt(walletMatch[1], 10);
        }
      }
    } else {
      type = name; // Fallback to name as type
    }

    return {
      type: type as EndpointType,
      value,
      meta: version ? { version } : undefined,
    } as Endpoint;
  }

  /**
   * Extract wallet address and chain ID from raw data
   */
  private _extractWalletInfo(rawData: Record<string, unknown>): { walletAddress?: string; walletChainId?: number } {
    // Priority: extracted from endpoints > direct fields
    if (typeof rawData._walletAddress === 'string' && typeof rawData._walletChainId === 'number') {
      return {
        walletAddress: rawData._walletAddress,
        walletChainId: rawData._walletChainId,
      };
    }
    
    if (typeof rawData.walletAddress === 'string' && typeof rawData.walletChainId === 'number') {
      return {
        walletAddress: rawData.walletAddress,
        walletChainId: rawData.walletChainId,
      };
    }
    
    return {};
  }

  /**
   * Returns deps for x402-aware requests (fetch + buildPayment + checkBalance).
   * Used by A2A client so messageA2A and task methods can return 402 + pay() or payFirst() instead of throwing.
   */
  getX402RequestDeps(): X402RequestDeps {
    return {
      fetch: globalThis.fetch,
      buildPayment: (accept, snapshot) =>
        buildEvmPayment(accept, this.getChainClientForAccept(accept), snapshot),
      checkBalance: async (accept) => {
        try {
          const client = this.getChainClientForAccept(accept);
          return await checkEvmBalance(accept, client);
        } catch {
          return false;
        }
      },
    };
  }

  // Expose clients for advanced usage
  get chainClient(): ChainClient {
    return this._chainClient;
  }

  get ipfsClient(): IPFSClient | undefined {
    return this._ipfsClient;
  }

  get subgraphClient(): SubgraphClient | undefined {
    return this._subgraphClient;
  }
}

