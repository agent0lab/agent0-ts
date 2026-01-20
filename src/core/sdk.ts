/**
 * Main SDK class for Agent0
 */
import type {
  AgentSummary,
  Feedback,
  SearchParams,
  SearchFeedbackParams,
  SearchResultMeta,
  RegistrationFile,
  Endpoint,
  FeedbackFileInput,
  SearchOptions,
  ReputationSearchFilters,
  ReputationSearchOptions,
  FeedbackSearchFilters,
  FeedbackSearchOptions,
} from '../models/interfaces.js';
import type { AgentId, ChainId, Address, URI } from '../models/types.js';
import { EndpointType, TrustModel } from '../models/enums.js';
import { formatAgentId, parseAgentId } from '../utils/id-format.js';
import { IPFS_GATEWAYS, TIMEOUTS } from '../utils/constants.js';
import type { ChainClient, EIP1193Provider as Eip1193Provider } from './chain-client.js';
import { ViemChainClient } from './viem-chain-client.js';
import { IPFSClient, type IPFSClientConfig } from './ipfs-client.js';
import { SubgraphClient } from './subgraph-client.js';
import { FeedbackManager } from './feedback-manager.js';
import { AgentIndexer } from './indexer.js';
import { Agent } from './agent.js';
import {
  DEFAULT_REGISTRIES,
  DEFAULT_SUBGRAPH_URLS,
  IDENTITY_REGISTRY_ABI,
  REPUTATION_REGISTRY_ABI,
} from './contracts.js';

export interface SDKConfig {
  chainId: ChainId;
  rpcUrl: string;
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
  ipfs?: 'node' | 'filecoinPin' | 'pinata';
  ipfsNodeUrl?: string;
  filecoinPrivateKey?: string;
  pinataJwt?: string;
  // Subgraph configuration
  subgraphUrl?: string;
  subgraphOverrides?: Record<ChainId, string>;
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
  private readonly _chainId: ChainId;
  private readonly _subgraphUrls: Record<ChainId, string> = {};
  private readonly _hasSignerConfig: boolean;

  constructor(config: SDKConfig) {
    this._chainId = config.chainId;

    // Initialize Chain client (viem-only)
    const privateKey = config.privateKey ?? config.signer;
    this._hasSignerConfig = Boolean(privateKey || config.walletProvider);
    this._chainClient = new ViemChainClient({
      chainId: config.chainId,
      rpcUrl: config.rpcUrl,
      privateKey,
      walletProvider: config.walletProvider,
    });

    // Resolve registry addresses
    const registryOverrides = config.registryOverrides || {};
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
    this._indexer = new AgentIndexer(this._subgraphClient, this._subgraphUrls);

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
      throw new Error(`Invalid ipfs value: ${config.ipfs}. Must be 'node', 'filecoinPin', or 'pinata'`);
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
      trustModels: [],
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
   * Load an existing agent (hydrates from registration file if registered)
   */
  async loadAgent(agentId: AgentId): Promise<Agent> {
    // Parse agent ID
    const { chainId, tokenId } = parseAgentId(agentId);

    const currentChainId = await this.chainId();
    if (chainId !== currentChainId) {
      throw new Error(`Agent ${agentId} is not on current chain ${currentChainId}`);
    }

    // Get agent URI from contract
    let agentURI: string;
    try {
      agentURI = await this._chainClient.readContract<string>({
        address: this.identityRegistryAddress(),
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
    filters: SearchParams = {},
    options: SearchOptions = {}
  ): Promise<{ items: AgentSummary[]; nextCursor?: string; meta?: SearchResultMeta }> {
    const pageSize = options.pageSize ?? 50;
    const cursor = options.cursor;
    const sort = options.sort ?? [];
    return this._indexer.searchAgents(filters, pageSize, cursor, sort);
  }

  /**
   * Search agents by reputation
   * Supports multi-chain search when chains parameter is provided
   */
  async searchAgentsByReputation(
    filters: ReputationSearchFilters = {},
    options: ReputationSearchOptions = {}
  ): Promise<{ items: AgentSummary[]; nextCursor?: string; meta?: SearchResultMeta }> {
    // Parse cursor to skip value
    let skip = 0;
    if (options.cursor) {
      try {
        skip = parseInt(options.cursor, 10);
      } catch {
        skip = 0;
      }
    }

    // Default sort
    const sort = options.sort ?? ['createdAt:desc'];
    const pageSize = options.pageSize ?? 50;
    const includeRevoked = options.includeRevoked ?? false;
    const chains = options.chains;

    return this._indexer.searchAgentsByReputation(
      filters.agents,
      filters.tags,
      filters.reviewers,
      filters.capabilities,
      filters.skills,
      filters.tasks,
      filters.names,
      filters.minAverageValue,
      includeRevoked,
      pageSize,
      skip,
      sort,
      chains
    );
  }

  /**
   * Transfer agent ownership
   */
  async transferAgent(agentId: AgentId, newOwner: Address): Promise<{
    txHash: string;
    from: Address;
    to: Address;
    agentId: AgentId;
  }> {
    const agent = await this.loadAgent(agentId);
    return agent.transfer(newOwner);
  }

  /**
   * Check if address is agent owner
   */
  async isAgentOwner(agentId: AgentId, address: Address): Promise<boolean> {
    const { tokenId } = parseAgentId(agentId);
    const owner = await this._chainClient.readContract<string>({
      address: this.identityRegistryAddress(),
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
    const { tokenId } = parseAgentId(agentId);
    return await this._chainClient.readContract<Address>({
      address: this.identityRegistryAddress(),
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
  ): Promise<Feedback> {
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
    const params: SearchFeedbackParams = {
      agents: [filters.agentId],
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
  ): Promise<string> {
    // Update feedback manager with registries
    this._feedbackManager.setReputationRegistryAddress(this.reputationRegistryAddress());

    return this._feedbackManager.appendResponse(agentId, clientAddress, feedbackIndex, response.uri, response.hash);
  }

  /**
   * Revoke feedback
   */
  async revokeFeedback(agentId: AgentId, feedbackIndex: number): Promise<string> {
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
        // Data URIs are not supported
        throw new Error(`Data URIs are not supported. Expected HTTP(S) or IPFS URI, got: ${tokenUri}`);
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
      x402support: typeof rawData.x402support === 'boolean' ? rawData.x402support : false,
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
    
    if (!rawData.endpoints || !Array.isArray(rawData.endpoints)) {
      return endpoints;
    }
    
    for (const ep of rawData.endpoints) {
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

