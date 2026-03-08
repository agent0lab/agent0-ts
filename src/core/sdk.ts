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
import type { TransactionHandle } from './transaction-handle.js';
import {
  DEFAULT_REGISTRIES,
  DEFAULT_SUBGRAPH_URLS,
  IDENTITY_REGISTRY_ABI,
  REPUTATION_REGISTRY_ABI,
} from './contracts.js';
import { TelemetryClient, categorizeError, type TelemetryEvent } from './telemetry.js';

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
   * Optional API key for telemetry. When set, SDK methods emit events to the ingest endpoint.
   */
  apiKey?: string;
  /**
   * Optional telemetry ingest URL. Defaults to production Supabase edge function.
   */
  telemetryEndpoint?: string;
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
  private readonly _chainId: ChainId;
  private readonly _subgraphUrls: Record<ChainId, string> = {};
  private readonly _hasSignerConfig: boolean;
  private readonly _telemetry?: TelemetryClient;
  private readonly _registrationDataUriMaxBytes: number;

  constructor(config: SDKConfig) {
    this._chainId = config.chainId;
    this._registrationDataUriMaxBytes = config.registrationDataUriMaxBytes ?? 256 * 1024;

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

    if (config.apiKey) {
      this._telemetry = new TelemetryClient({
        apiKey: config.apiKey,
        endpoint: config.telemetryEndpoint,
      });
    }
  }

  /**
   * Emit a single telemetry event (for use by Agent and SDK methods). No-op if telemetry is disabled.
   */
  emitTelemetryEvent(event: TelemetryEvent): void {
    this._telemetry?.emit([event]);
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
   * Load an existing agent (hydrates from registration file if registered)
   */
  async loadAgent(agentId: AgentId): Promise<Agent> {
    const start = Date.now();
    try {
      const { chainId, tokenId } = parseAgentId(agentId);
      const currentChainId = await this.chainId();
      if (chainId !== currentChainId) {
        throw new Error(`Agent ${agentId} is not on current chain ${currentChainId}`);
      }
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
      let registrationFile: RegistrationFile;
      if (!agentURI || agentURI === '') {
        registrationFile = this._createEmptyRegistrationFile();
      } else {
        registrationFile = await this._loadRegistrationFile(agentURI);
      }
      registrationFile.agentId = agentId;
      registrationFile.agentURI = agentURI || undefined;
      const agent = new Agent(this, registrationFile);
      this.emitTelemetryEvent({
        eventType: 'agent.loaded',
        success: true,
        durationMs: Date.now() - start,
        timestamp: Date.now(),
        payload: this.getAgentSnapshotForTelemetry(chainId, agentId, registrationFile),
      });
      return agent;
    } catch (err) {
      const { chainId } = parseAgentId(agentId);
      this.emitTelemetryEvent({
        eventType: 'agent.loaded',
        success: false,
        errorType: categorizeError(err),
        durationMs: Date.now() - start,
        timestamp: Date.now(),
        payload: { chainId, agentId },
      });
      throw err;
    }
  }

  /**
   * Get agent summary from subgraph (read-only)
   * Supports both default chain and explicit chain specification via chainId:tokenId format
   */
  async getAgent(agentId: AgentId): Promise<AgentSummary | null> {
    const start = Date.now();
    let parsedChainId: number;
    let formattedAgentId: string;
    if (agentId.includes(':')) {
      const parsed = parseAgentId(agentId);
      parsedChainId = parsed.chainId;
      formattedAgentId = agentId;
    } else {
      parsedChainId = this._chainId;
      formattedAgentId = formatAgentId(this._chainId, parseInt(agentId, 10));
    }
    const targetChainId = parsedChainId !== this._chainId ? parsedChainId : undefined;
    const subgraphClient = targetChainId
      ? this.getSubgraphClient(targetChainId)
      : this._subgraphClient;
    if (!subgraphClient) {
      const err = new Error(`Subgraph client required for getAgent on chain ${targetChainId ?? this._chainId}`);
      this.emitTelemetryEvent({
        eventType: 'agent.fetched',
        success: false,
        errorType: categorizeError(err),
        durationMs: Date.now() - start,
        timestamp: Date.now(),
        payload: { chainId: parsedChainId, agentId: formattedAgentId, found: false },
      });
      throw err;
    }
    try {
      const result = await subgraphClient.getAgentById(formattedAgentId);
      this.emitTelemetryEvent({
        eventType: 'agent.fetched',
        success: true,
        durationMs: Date.now() - start,
        timestamp: Date.now(),
        payload: { chainId: parsedChainId, agentId: formattedAgentId, found: result != null },
      });
      return result;
    } catch (err) {
      this.emitTelemetryEvent({
        eventType: 'agent.fetched',
        success: false,
        errorType: categorizeError(err),
        durationMs: Date.now() - start,
        timestamp: Date.now(),
        payload: { chainId: parsedChainId, agentId: formattedAgentId, found: false },
      });
      throw err;
    }
  }

  /**
   * Search agents with filters
   * Supports multi-chain search when chains parameter is provided
   */
  async searchAgents(
    filters: SearchFilters = {},
    options: SearchOptions = {}
  ): Promise<AgentSummary[]> {
    const start = Date.now();
    try {
      const results = await this._indexer.searchAgents(filters, options);
      const payload: Record<string, unknown> = this._telemetrySearchPayload(filters, options, results);
      payload.results = results.slice(0, 100).map((a) => a.agentId);
      this.emitTelemetryEvent({
        eventType: 'search.query',
        success: true,
        durationMs: Date.now() - start,
        timestamp: Date.now(),
        payload,
      });
      return results;
    } catch (err) {
      const payload: Record<string, unknown> = this._telemetrySearchPayload(filters, options, []);
      payload.results = [];
      this.emitTelemetryEvent({
        eventType: 'search.query',
        success: false,
        errorType: categorizeError(err),
        durationMs: Date.now() - start,
        timestamp: Date.now(),
        payload,
      });
      throw err;
    }
  }

  private _telemetrySearchPayload(
    filters: SearchFilters,
    options: SearchOptions,
    _results: AgentSummary[]
  ): Record<string, unknown> {
    const toUnix = (v: Date | string | number | undefined): number | undefined => {
      if (v === undefined) return undefined;
      if (typeof v === 'number') return v < 1e12 ? v : Math.floor(v / 1000);
      const d = typeof v === 'string' ? new Date(v) : v;
      return Math.floor(d.getTime() / 1000);
    };
    const p: Record<string, unknown> = {};
    if (filters.chains !== undefined) p.chains = filters.chains;
    if (filters.agentIds?.length) p.agentIds = filters.agentIds;
    if (filters.name !== undefined) p.name = filters.name;
    if (filters.description !== undefined) p.description = filters.description;
    if (filters.keyword !== undefined) p.keyword = filters.keyword;
    if (filters.owners?.length) p.owners = filters.owners;
    if (filters.operators?.length) p.operators = filters.operators;
    if (filters.hasRegistrationFile !== undefined) p.hasRegistrationFile = filters.hasRegistrationFile;
    if (filters.hasWeb !== undefined) p.hasWeb = filters.hasWeb;
    if (filters.hasMCP !== undefined) p.hasMCP = filters.hasMCP;
    if (filters.hasA2A !== undefined) p.hasA2A = filters.hasA2A;
    if (filters.hasOASF !== undefined) p.hasOASF = filters.hasOASF;
    if (filters.hasEndpoints !== undefined) p.hasEndpoints = filters.hasEndpoints;
    if (filters.webContains !== undefined) p.webContains = filters.webContains;
    if (filters.mcpContains !== undefined) p.mcpContains = filters.mcpContains;
    if (filters.a2aContains !== undefined) p.a2aContains = filters.a2aContains;
    if (filters.ensContains !== undefined) p.ensContains = filters.ensContains;
    if (filters.didContains !== undefined) p.didContains = filters.didContains;
    if (filters.walletAddress !== undefined) p.agentWallet = { address: filters.walletAddress };
    if (filters.supportedTrust?.length) p.supportedTrust = filters.supportedTrust;
    if (filters.a2aSkills?.length) p.a2aSkills = filters.a2aSkills;
    if (filters.mcpTools?.length) p.mcpTools = filters.mcpTools;
    if (filters.mcpPrompts?.length) p.mcpPrompts = filters.mcpPrompts;
    if (filters.mcpResources?.length) p.mcpResources = filters.mcpResources;
    if (filters.oasfSkills?.length) p.oasfSkills = filters.oasfSkills;
    if (filters.oasfDomains?.length) p.oasfDomains = filters.oasfDomains;
    if (filters.active !== undefined) p.active = filters.active;
    if (filters.x402support !== undefined) p.x402support = filters.x402support;
    const rFrom = toUnix(filters.registeredAtFrom);
    const rTo = toUnix(filters.registeredAtTo);
    const uFrom = toUnix(filters.updatedAtFrom);
    const uTo = toUnix(filters.updatedAtTo);
    if (rFrom !== undefined) p.registeredAtFrom = rFrom;
    if (rTo !== undefined) p.registeredAtTo = rTo;
    if (uFrom !== undefined) p.updatedAtFrom = uFrom;
    if (uTo !== undefined) p.updatedAtTo = uTo;
    if (filters.hasMetadataKey !== undefined) p.hasMetadataKey = filters.hasMetadataKey;
    if (filters.metadataValue !== undefined) p.metadataValue = filters.metadataValue;
    if (filters.feedback !== undefined) p.feedback = filters.feedback;
    if (options.sort?.length) p.sort = options.sort;
    if (options.semanticMinScore !== undefined) p.semanticMinScore = options.semanticMinScore;
    if (options.semanticTopK !== undefined) p.semanticTopK = options.semanticTopK;
    return p;
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
  ): Promise<TransactionHandle<Feedback>> {
    const start = Date.now();
    this._feedbackManager.setReputationRegistryAddress(this.reputationRegistryAddress());
    this._feedbackManager.setIdentityRegistryAddress(this.identityRegistryAddress());
    const valueNum = typeof value === 'string' ? parseInt(value, 10) : value;
    try {
      const result = await this._feedbackManager.giveFeedback(agentId, value, tag1, tag2, endpoint, feedbackFile);
      this.emitTelemetryEvent({
        eventType: 'feedback.given',
        success: true,
        durationMs: Date.now() - start,
        timestamp: Date.now(),
        payload: {
          chainId: this._chainId,
          agentId,
          value: valueNum,
          tag1,
          tag2,
          hasEndpoint: endpoint != null && endpoint !== '',
          endpoint: endpoint ?? undefined,
          hasOffchainFile: feedbackFile != null,
          hasText: feedbackFile?.text != null,
          hasContext: feedbackFile?.context != null,
          hasProofOfPayment: feedbackFile?.proofOfPayment != null,
          // Spec-aligned feedback file fields (1.6+)
          mcpTool: feedbackFile?.mcpTool,
          mcpPrompt: feedbackFile?.mcpPrompt,
          mcpResource: feedbackFile?.mcpResource,
          a2aSkills: feedbackFile?.a2aSkills,
          a2aContextId: feedbackFile?.a2aContextId,
          a2aTaskId: feedbackFile?.a2aTaskId,
          oasfSkills: feedbackFile?.oasfSkills,
          oasfDomains: feedbackFile?.oasfDomains,
        },
      });
      return result;
    } catch (err) {
      this.emitTelemetryEvent({
        eventType: 'feedback.given',
        success: false,
        errorType: categorizeError(err),
        durationMs: Date.now() - start,
        timestamp: Date.now(),
        payload: { chainId: this._chainId, agentId, value: valueNum, tag1, tag2 },
      });
      throw err;
    }
  }

  /**
   * Read feedback
   */
  async getFeedback(agentId: AgentId, clientAddress: Address, feedbackIndex: number): Promise<Feedback> {
    const start = Date.now();
    try {
      const result = await this._feedbackManager.getFeedback(agentId, clientAddress, feedbackIndex);
      this.emitTelemetryEvent({
        eventType: 'feedback.fetched',
        success: true,
        durationMs: Date.now() - start,
        timestamp: Date.now(),
        payload: { chainId: this._chainId, agentId, feedbackIndex, found: true },
      });
      return result;
    } catch (err) {
      this.emitTelemetryEvent({
        eventType: 'feedback.fetched',
        success: false,
        errorType: categorizeError(err),
        durationMs: Date.now() - start,
        timestamp: Date.now(),
        payload: { chainId: this._chainId, agentId, feedbackIndex, found: false },
      });
      throw err;
    }
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
    const start = Date.now();
    try {
      const result = await this._feedbackManager.searchFeedback(params);
      const singleAgentId = agents?.length === 1 ? agents[0] : filters.agentId;
      this.emitTelemetryEvent({
        eventType: 'feedback.searched',
        success: true,
        durationMs: Date.now() - start,
        timestamp: Date.now(),
        payload: {
          chainId: this._chainId,
          agentId: singleAgentId,
          agentCount: agents?.length,
          tags: filters.tags,
          reviewers: filters.reviewers,
          capabilities: filters.capabilities,
          skills: filters.skills,
          tasks: filters.tasks,
          names: filters.names,
          includeRevoked: filters.includeRevoked,
          minValue: options.minValue,
          maxValue: options.maxValue,
          resultCount: result.length,
          isZeroResults: result.length === 0,
        },
      });
      return result;
    } catch (err) {
      this.emitTelemetryEvent({
        eventType: 'feedback.searched',
        success: false,
        errorType: categorizeError(err),
        durationMs: Date.now() - start,
        timestamp: Date.now(),
        payload: { chainId: this._chainId, agentId: filters.agentId, agentCount: agents?.length },
      });
      throw err;
    }
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
    const start = Date.now();
    this._feedbackManager.setReputationRegistryAddress(this.reputationRegistryAddress());
    try {
      const result = await this._feedbackManager.appendResponse(
        agentId,
        clientAddress,
        feedbackIndex,
        response.uri,
        response.hash
      );
      this.emitTelemetryEvent({
        eventType: 'feedback.response.appended',
        success: true,
        durationMs: Date.now() - start,
        timestamp: Date.now(),
        payload: {
          chainId: this._chainId,
          agentId,
          clientAddress,
          feedbackIndex,
          responseUri: response.uri,
        },
      });
      return result;
    } catch (err) {
      this.emitTelemetryEvent({
        eventType: 'feedback.response.appended',
        success: false,
        errorType: categorizeError(err),
        durationMs: Date.now() - start,
        timestamp: Date.now(),
        payload: { chainId: this._chainId, agentId, clientAddress, feedbackIndex },
      });
      throw err;
    }
  }

  /**
   * Revoke feedback
   */
  async revokeFeedback(agentId: AgentId, feedbackIndex: number): Promise<TransactionHandle<Feedback>> {
    const start = Date.now();
    this._feedbackManager.setReputationRegistryAddress(this.reputationRegistryAddress());
    try {
      const result = await this._feedbackManager.revokeFeedback(agentId, feedbackIndex);
      this.emitTelemetryEvent({
        eventType: 'feedback.revoked',
        success: true,
        durationMs: Date.now() - start,
        timestamp: Date.now(),
        payload: { chainId: this._chainId, agentId, feedbackIndex },
      });
      return result;
    } catch (err) {
      this.emitTelemetryEvent({
        eventType: 'feedback.revoked',
        success: false,
        errorType: categorizeError(err),
        durationMs: Date.now() - start,
        timestamp: Date.now(),
        payload: { chainId: this._chainId, agentId, feedbackIndex },
      });
      throw err;
    }
  }

  /**
   * Get reputation summary
   */
  async getReputationSummary(
    agentId: AgentId,
    tag1?: string,
    tag2?: string
  ): Promise<{ count: number; averageValue: number }> {
    const start = Date.now();
    this._feedbackManager.setReputationRegistryAddress(this.reputationRegistryAddress());
    try {
      const result = await this._feedbackManager.getReputationSummary(agentId, tag1, tag2);
      this.emitTelemetryEvent({
        eventType: 'reputation.summary.fetched',
        success: true,
        durationMs: Date.now() - start,
        timestamp: Date.now(),
        payload: {
          chainId: this._chainId,
          agentId,
          tag1,
          tag2,
          count: result.count,
          averageValue: result.averageValue,
        },
      });
      return result;
    } catch (err) {
      this.emitTelemetryEvent({
        eventType: 'reputation.summary.fetched',
        success: false,
        errorType: categorizeError(err),
        durationMs: Date.now() - start,
        timestamp: Date.now(),
        payload: { chainId: this._chainId, agentId, tag1, tag2 },
      });
      throw err;
    }
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

  /** Build v2 agent snapshot payload for telemetry (chainId, agentId, name, description, endpoints, etc.). Public for use by Agent. */
  getAgentSnapshotForTelemetry(chainId: number, agentId: AgentId, reg: RegistrationFile): Record<string, unknown> {
    const metadata =
      reg.metadata && typeof reg.metadata === 'object' && !Array.isArray(reg.metadata)
        ? Object.entries(reg.metadata).map(([key, value]) => ({ key, value: String(value) }))
        : [];
    const payload: Record<string, unknown> = {
      chainId,
      agentId,
      name: reg.name,
      description: reg.description,
      endpoints: reg.endpoints,
      trustModels: reg.trustModels,
      owners: reg.owners,
      operators: reg.operators,
      active: reg.active,
      x402support: reg.x402support,
      metadata,
      updatedAt: reg.updatedAt,
    };
    if (reg.image !== undefined) payload.image = reg.image;
    if (reg.walletAddress !== undefined || reg.walletChainId !== undefined) {
      payload.agentWallet = {
        ...(reg.walletAddress !== undefined && { address: reg.walletAddress }),
        ...(reg.walletChainId !== undefined && { chainId: reg.walletChainId }),
      };
    }
    return payload;
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

