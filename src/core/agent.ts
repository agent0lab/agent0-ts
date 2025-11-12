/**
 * Agent class for managing individual agents
 */

import { ethers } from 'ethers';
import type {
  RegistrationFile,
  Endpoint,
} from '../models/interfaces.js';
import type { AgentId, Address, URI } from '../models/types.js';
import { EndpointType, TrustModel } from '../models/enums.js';
import type { SDK } from './sdk.js';
import { EndpointCrawler } from './endpoint-crawler.js';
import { parseAgentId } from '../utils/id-format.js';
import { TIMEOUTS } from '../utils/constants.js';
import { validateSkill, validateDomain } from './oasf-validator.js';

/**
 * Agent class for managing individual agents
 */
export class Agent {
  private registrationFile: RegistrationFile;
  private _endpointCrawler: EndpointCrawler;
  private _dirtyMetadata = new Set<string>();
  private _lastRegisteredWallet?: Address;
  private _lastRegisteredEns?: string;

  constructor(private sdk: SDK, registrationFile: RegistrationFile) {
    this.registrationFile = registrationFile;
    this._endpointCrawler = new EndpointCrawler(5000);
  }

  // Read-only properties
  get agentId(): AgentId | undefined {
    return this.registrationFile.agentId;
  }

  get agentURI(): URI | undefined {
    return this.registrationFile.agentURI;
  }

  get name(): string {
    return this.registrationFile.name;
  }

  get description(): string {
    return this.registrationFile.description;
  }

  get image(): URI | undefined {
    return this.registrationFile.image;
  }

  get mcpEndpoint(): string | undefined {
    const ep = this.registrationFile.endpoints.find((e) => e.type === EndpointType.MCP);
    return ep?.value;
  }

  get a2aEndpoint(): string | undefined {
    const ep = this.registrationFile.endpoints.find((e) => e.type === EndpointType.A2A);
    return ep?.value;
  }

  get ensEndpoint(): string | undefined {
    const ep = this.registrationFile.endpoints.find((e) => e.type === EndpointType.ENS);
    return ep?.value;
  }

  get walletAddress(): Address | undefined {
    return this.registrationFile.walletAddress;
  }

  get mcpTools(): string[] | undefined {
    const ep = this.registrationFile.endpoints.find((e) => e.type === EndpointType.MCP);
    return ep?.meta?.mcpTools;
  }

  get mcpPrompts(): string[] | undefined {
    const ep = this.registrationFile.endpoints.find((e) => e.type === EndpointType.MCP);
    return ep?.meta?.mcpPrompts;
  }

  get mcpResources(): string[] | undefined {
    const ep = this.registrationFile.endpoints.find((e) => e.type === EndpointType.MCP);
    return ep?.meta?.mcpResources;
  }

  get a2aSkills(): string[] | undefined {
    const ep = this.registrationFile.endpoints.find((e) => e.type === EndpointType.A2A);
    return ep?.meta?.a2aSkills;
  }

  // Endpoint management
  async setMCP(endpoint: string, version: string = '2025-06-18', autoFetch: boolean = true): Promise<this> {
    // Remove existing MCP endpoint if any
    this.registrationFile.endpoints = this.registrationFile.endpoints.filter(
      (ep) => ep.type !== EndpointType.MCP
    );

    // Try to fetch capabilities from the endpoint (soft fail)
    const meta: Record<string, unknown> = { version };
    if (autoFetch) {
      try {
        const capabilities = await this._endpointCrawler.fetchMcpCapabilities(endpoint);
        if (capabilities) {
          if (capabilities.mcpTools) meta.mcpTools = capabilities.mcpTools;
          if (capabilities.mcpPrompts) meta.mcpPrompts = capabilities.mcpPrompts;
          if (capabilities.mcpResources) meta.mcpResources = capabilities.mcpResources;
        }
      } catch (error) {
        // Soft fail - continue without capabilities
      }
    }

    // Add new MCP endpoint
    const mcpEndpoint: Endpoint = {
      type: EndpointType.MCP,
      value: endpoint,
      meta,
    };
    this.registrationFile.endpoints.push(mcpEndpoint);
    this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);

    return this;
  }

  async setA2A(agentcard: string, version: string = '0.30', autoFetch: boolean = true): Promise<this> {
    // Remove existing A2A endpoint if any
    this.registrationFile.endpoints = this.registrationFile.endpoints.filter(
      (ep) => ep.type !== EndpointType.A2A
    );

    // Try to fetch capabilities from the endpoint (soft fail)
    const meta: Record<string, unknown> = { version };
    if (autoFetch) {
      try {
        const capabilities = await this._endpointCrawler.fetchA2aCapabilities(agentcard);
        if (capabilities?.a2aSkills) {
          meta.a2aSkills = capabilities.a2aSkills;
        }
      } catch (error) {
        // Soft fail - continue without capabilities
      }
    }

    // Add new A2A endpoint
    const a2aEndpoint: Endpoint = {
      type: EndpointType.A2A,
      value: agentcard,
      meta,
    };
    this.registrationFile.endpoints.push(a2aEndpoint);
    this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);

    return this;
  }

  setENS(name: string, version: string = '1.0'): this {
    // Remove existing ENS endpoints
    this.registrationFile.endpoints = this.registrationFile.endpoints.filter(
      (ep) => ep.type !== EndpointType.ENS
    );

    // Check if ENS changed
    if (name !== this._lastRegisteredEns) {
      this._dirtyMetadata.add('agentName');
    }

    // Add new ENS endpoint
    const ensEndpoint: Endpoint = {
      type: EndpointType.ENS,
      value: name,
      meta: { version },
    };
    this.registrationFile.endpoints.push(ensEndpoint);
    this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);

    return this;
  }

  // OASF endpoint management
  private _getOrCreateOasfEndpoint(): Endpoint {
    // Find existing OASF endpoint
    const existing = this.registrationFile.endpoints.find(
      (ep) => ep.type === EndpointType.OASF
    );
    if (existing) {
      return existing;
    }

    // Create new OASF endpoint with default values
    const oasfEndpoint: Endpoint = {
      type: EndpointType.OASF,
      value: 'https://github.com/agntcy/oasf/',
      meta: { version: 'v0.8.0', skills: [], domains: [] },
    };
    this.registrationFile.endpoints.push(oasfEndpoint);
    return oasfEndpoint;
  }

  addSkill(slug: string, validateOASF: boolean = false): this {
    /**
     * Add a skill to the OASF endpoint.
     * @param slug The skill slug to add (e.g., "natural_language_processing/summarization")
     * @param validateOASF If true, validate the slug against the OASF taxonomy (default: false)
     * @returns this for method chaining
     * @throws Error if validateOASF=true and the slug is not valid
     */
    if (validateOASF) {
      if (!validateSkill(slug)) {
        throw new Error(
          `Invalid OASF skill slug: ${slug}. ` +
            'Use validateOASF=false to skip validation.'
        );
      }
    }

    const oasfEndpoint = this._getOrCreateOasfEndpoint();

    // Initialize skills array if missing
    if (!oasfEndpoint.meta) {
      oasfEndpoint.meta = {};
    }
    if (!Array.isArray(oasfEndpoint.meta.skills)) {
      oasfEndpoint.meta.skills = [];
    }

    // Add slug if not already present (avoid duplicates)
    const skills = oasfEndpoint.meta.skills as string[];
    if (!skills.includes(slug)) {
      skills.push(slug);
    }

    this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  removeSkill(slug: string): this {
    /**
     * Remove a skill from the OASF endpoint.
     * @param slug The skill slug to remove
     * @returns this for method chaining
     */
    // Find OASF endpoint
    const oasfEndpoint = this.registrationFile.endpoints.find(
      (ep) => ep.type === EndpointType.OASF
    );

    if (oasfEndpoint && oasfEndpoint.meta) {
      const skills = oasfEndpoint.meta.skills;
      if (Array.isArray(skills)) {
        const index = skills.indexOf(slug);
        if (index !== -1) {
          skills.splice(index, 1);
        }
      }
      this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    }

    return this;
  }

  addDomain(slug: string, validateOASF: boolean = false): this {
    /**
     * Add a domain to the OASF endpoint.
     * @param slug The domain slug to add (e.g., "finance_and_business/investment_services")
     * @param validateOASF If true, validate the slug against the OASF taxonomy (default: false)
     * @returns this for method chaining
     * @throws Error if validateOASF=true and the slug is not valid
     */
    if (validateOASF) {
      if (!validateDomain(slug)) {
        throw new Error(
          `Invalid OASF domain slug: ${slug}. ` +
            'Use validateOASF=false to skip validation.'
        );
      }
    }

    const oasfEndpoint = this._getOrCreateOasfEndpoint();

    // Initialize domains array if missing
    if (!oasfEndpoint.meta) {
      oasfEndpoint.meta = {};
    }
    if (!Array.isArray(oasfEndpoint.meta.domains)) {
      oasfEndpoint.meta.domains = [];
    }

    // Add slug if not already present (avoid duplicates)
    const domains = oasfEndpoint.meta.domains as string[];
    if (!domains.includes(slug)) {
      domains.push(slug);
    }

    this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  removeDomain(slug: string): this {
    /**
     * Remove a domain from the OASF endpoint.
     * @param slug The domain slug to remove
     * @returns this for method chaining
     */
    // Find OASF endpoint
    const oasfEndpoint = this.registrationFile.endpoints.find(
      (ep) => ep.type === EndpointType.OASF
    );

    if (oasfEndpoint && oasfEndpoint.meta) {
      const domains = oasfEndpoint.meta.domains;
      if (Array.isArray(domains)) {
        const index = domains.indexOf(slug);
        if (index !== -1) {
          domains.splice(index, 1);
        }
      }
      this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    }

    return this;
  }

  setAgentWallet(address: Address, chainId: number): this {
    this.registrationFile.walletAddress = address;
    this.registrationFile.walletChainId = chainId;

    // Check if wallet changed
    if (address !== this._lastRegisteredWallet) {
      this._dirtyMetadata.add('agentWallet');
    }

    this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  setActive(active: boolean): this {
    this.registrationFile.active = active;
    this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  setX402Support(x402Support: boolean): this {
    this.registrationFile.x402support = x402Support;
    this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  setTrust(
    reputation: boolean = false,
    cryptoEconomic: boolean = false,
    teeAttestation: boolean = false
  ): this {
    const trustModels: (TrustModel | string)[] = [];
    if (reputation) trustModels.push(TrustModel.REPUTATION);
    if (cryptoEconomic) trustModels.push(TrustModel.CRYPTO_ECONOMIC);
    if (teeAttestation) trustModels.push(TrustModel.TEE_ATTESTATION);

    this.registrationFile.trustModels = trustModels;
    this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  setMetadata(kv: Record<string, unknown>): this {
    // Mark all provided keys as dirty
    for (const key of Object.keys(kv)) {
      this._dirtyMetadata.add(key);
    }

    Object.assign(this.registrationFile.metadata, kv);
    this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  getMetadata(): Record<string, unknown> {
    return { ...this.registrationFile.metadata };
  }

  delMetadata(key: string): this {
    if (key in this.registrationFile.metadata) {
      delete this.registrationFile.metadata[key];
      this._dirtyMetadata.delete(key);
      this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    }
    return this;
  }

  getRegistrationFile(): RegistrationFile {
    return this.registrationFile;
  }

  /**
   * Update basic agent information
   */
  updateInfo(name?: string, description?: string, image?: URI): this {
    if (name !== undefined) {
      this.registrationFile.name = name;
    }
    if (description !== undefined) {
      this.registrationFile.description = description;
    }
    if (image !== undefined) {
      this.registrationFile.image = image;
    }

    this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  /**
   * Register agent on-chain with IPFS flow
   */
  async registerIPFS(): Promise<RegistrationFile> {
    // Validate basic info
    if (!this.registrationFile.name || !this.registrationFile.description) {
      throw new Error('Agent must have name and description before registration');
    }

    if (this.registrationFile.agentId) {
      // Agent already registered - update registration file and redeploy
      // Option 2D: Add logging and timeout handling
      const chainId = await this.sdk.chainId();
      const identityRegistryAddress = await this.sdk.getIdentityRegistry().getAddress();
      
      const ipfsCid = await this.sdk.ipfsClient!.addRegistrationFile(
        this.registrationFile,
        chainId,
        identityRegistryAddress
      );

      // Update metadata on-chain if changed
      // Only send transactions for dirty (changed) metadata to save gas
      if (this._dirtyMetadata.size > 0) {
        try {
          await this._updateMetadataOnChain();
        } catch (error) {
          // Transaction was sent and will eventually confirm - continue silently
        }
      }

      // Update agent URI on-chain
      const { tokenId } = parseAgentId(this.registrationFile.agentId);
      
      const txHash = await this.sdk.web3Client.transactContract(
        this.sdk.getIdentityRegistry(),
        'setAgentUri',
        {},
        BigInt(tokenId),
        `ipfs://${ipfsCid}`
      );
      
      // Wait for transaction to be confirmed (30 second timeout like Python)
      // If timeout, continue - transaction was sent and will eventually confirm
      try {
        await this.sdk.web3Client.waitForTransaction(txHash, TIMEOUTS.TRANSACTION_WAIT);
      } catch (error) {
        // Transaction was sent and will eventually confirm - continue silently
      }

      // Clear dirty flags
      this._lastRegisteredWallet = this.walletAddress;
      this._lastRegisteredEns = this.ensEndpoint;
      this._dirtyMetadata.clear();

      this.registrationFile.agentURI = `ipfs://${ipfsCid}`;
      return this.registrationFile;
    } else {
      // First time registration
      // Step 1: Register on-chain without URI
      await this._registerWithoutUri();

      // Step 2: Upload to IPFS
      const chainId = await this.sdk.chainId();
      const identityRegistryAddress = await this.sdk.getIdentityRegistry().getAddress();
      const ipfsCid = await this.sdk.ipfsClient!.addRegistrationFile(
        this.registrationFile,
        chainId,
        identityRegistryAddress
      );

      // Step 3: Set agent URI on-chain
      const { tokenId } = parseAgentId(this.registrationFile.agentId!);
      const txHash = await this.sdk.web3Client.transactContract(
        this.sdk.getIdentityRegistry(),
        'setAgentUri',
        {},
        BigInt(tokenId),
        `ipfs://${ipfsCid}`
      );
      
      // Wait for transaction to be confirmed
      await this.sdk.web3Client.waitForTransaction(txHash);

      // Clear dirty flags
      this._lastRegisteredWallet = this.walletAddress;
      this._lastRegisteredEns = this.ensEndpoint;
      this._dirtyMetadata.clear();

      this.registrationFile.agentURI = `ipfs://${ipfsCid}`;
      return this.registrationFile;
    }
  }

  /**
   * Register agent on-chain with HTTP URI
   */
  async registerHTTP(agentUri: string): Promise<RegistrationFile> {
    // Validate basic info
    if (!this.registrationFile.name || !this.registrationFile.description) {
      throw new Error('Agent must have name and description before registration');
    }

    if (this.registrationFile.agentId) {
      // Agent already registered - update agent URI
      await this.setAgentUri(agentUri);
      return this.registrationFile;
    } else {
      // First time registration
      return await this._registerWithUri(agentUri);
    }
  }

  /**
   * Set agent URI (for updates)
   */
  async setAgentUri(agentUri: string): Promise<void> {
    if (!this.registrationFile.agentId) {
      throw new Error('Agent must be registered before setting URI');
    }

    const { tokenId } = parseAgentId(this.registrationFile.agentId);
    await this.sdk.web3Client.transactContract(
      this.sdk.getIdentityRegistry(),
      'setAgentUri',
      {},
      BigInt(tokenId),
      agentUri
    );

    this.registrationFile.agentURI = agentUri;
    this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);
  }

  /**
   * Transfer agent ownership
   */
  async transfer(newOwner: Address): Promise<{ txHash: string; from: Address; to: Address; agentId: AgentId }> {
    if (!this.registrationFile.agentId) {
      throw new Error('Agent must be registered before transfer');
    }

    const { tokenId } = parseAgentId(this.registrationFile.agentId);
    const currentOwner = this.sdk.web3Client.address;
    if (!currentOwner) {
      throw new Error('No signer available');
    }

    // Validate address - normalize to lowercase first
    const normalizedAddress = newOwner.toLowerCase();
    if (!this.sdk.web3Client.isAddress(normalizedAddress)) {
      throw new Error(`Invalid address: ${newOwner}`);
    }

    // Validate not zero address (check before expensive operations)
    if (normalizedAddress === '0x0000000000000000000000000000000000000000') {
      throw new Error('Cannot transfer agent to zero address');
    }

    // Convert to checksum format
    const checksumAddress = this.sdk.web3Client.toChecksumAddress(normalizedAddress);

    // Validate not transferring to self
    if (checksumAddress.toLowerCase() === currentOwner.toLowerCase()) {
      throw new Error('Cannot transfer agent to yourself');
    }

    const identityRegistry = this.sdk.getIdentityRegistry();
    const txHash = await this.sdk.web3Client.transactContract(
      identityRegistry,
      'transferFrom',
      {},
      currentOwner,
      checksumAddress,
      BigInt(tokenId)
    );

    return {
      txHash,
      from: currentOwner,
      to: checksumAddress,
      agentId: this.registrationFile.agentId,
    };
  }

  /**
   * Private helper methods
   */
  private async _registerWithoutUri(): Promise<void> {
    // Collect metadata for registration
    const metadataEntries = this._collectMetadataForRegistration();

    // Mint agent with metadata
    const identityRegistry = this.sdk.getIdentityRegistry();
    
    // If we have metadata, use register(string, tuple[])
    // Otherwise use register() with no args
    let txHash: string;
    if (metadataEntries.length > 0) {
      txHash = await this.sdk.web3Client.transactContract(
        identityRegistry,
        'register',
        {}, // Transaction options
        '', // Empty tokenUri
        metadataEntries
      );
    } else {
      txHash = await this.sdk.web3Client.transactContract(
        identityRegistry,
        'register',
        {} // Transaction options
        // No arguments - calls register()
      );
    }

    // Wait for transaction
    const receipt = await this.sdk.web3Client.waitForTransaction(txHash);

    // Extract agent ID from events
    const agentId = this._extractAgentIdFromReceipt(receipt);

    // Update registration file
    const chainId = await this.sdk.chainId();
    this.registrationFile.agentId = `${chainId}:${agentId}`;
    this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);
  }

  private async _registerWithUri(agentUri: string): Promise<RegistrationFile> {
    // Collect metadata for registration
    const metadataEntries = this._collectMetadataForRegistration();

    // Register with URI and metadata
    const identityRegistry = this.sdk.getIdentityRegistry();
    const txHash = await this.sdk.web3Client.transactContract(
      identityRegistry,
      'register',
      {},
      agentUri,
      metadataEntries
    );

    // Wait for transaction
    const receipt = await this.sdk.web3Client.waitForTransaction(txHash);

    // Extract agent ID from events
    const agentId = this._extractAgentIdFromReceipt(receipt);

    // Update registration file
    const chainId = await this.sdk.chainId();
    this.registrationFile.agentId = `${chainId}:${agentId}`;
    this.registrationFile.agentURI = agentUri;
    this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);

    return this.registrationFile;
  }

  private async _updateMetadataOnChain(): Promise<void> {
    const metadataEntries = this._collectMetadataForRegistration();
    const { tokenId } = parseAgentId(this.registrationFile.agentId!);
    const identityRegistry = this.sdk.getIdentityRegistry();

    // Update metadata one by one (like Python SDK)
    // Only send transactions for dirty (changed) metadata keys
    for (const entry of metadataEntries) {
      if (this._dirtyMetadata.has(entry.key)) {
        const txHash = await this.sdk.web3Client.transactContract(
          identityRegistry,
          'setMetadata',
          {},
          BigInt(tokenId),
          entry.key,
          entry.value
        );

        // Wait with 30 second timeout (like Python SDK)
        // If timeout, log warning but continue - transaction was sent and will eventually confirm
        try {
          await this.sdk.web3Client.waitForTransaction(txHash, TIMEOUTS.TRANSACTION_WAIT);
        } catch (error) {
          // Transaction was sent and will eventually confirm - continue silently
        }
      }
    }
  }

  private _collectMetadataForRegistration(): Array<{ key: string; value: Uint8Array }> {
    const entries: Array<{ key: string; value: Uint8Array }> = [];

    // Collect wallet address if set
    if (this.registrationFile.walletAddress && this.registrationFile.walletChainId) {
      const walletValue = `eip155:${this.registrationFile.walletChainId}:${this.registrationFile.walletAddress}`;
      entries.push({
        key: 'agentWallet',
        value: new TextEncoder().encode(walletValue),
      });
    }

    // Collect custom metadata
    for (const [key, value] of Object.entries(this.registrationFile.metadata)) {
      let valueBytes: Uint8Array;
      if (typeof value === 'string') {
        valueBytes = new TextEncoder().encode(value);
      } else if (typeof value === 'number') {
        valueBytes = new TextEncoder().encode(value.toString());
      } else {
        valueBytes = new TextEncoder().encode(JSON.stringify(value));
      }

      entries.push({ key, value: valueBytes });
    }

    return entries;
  }

  private _extractAgentIdFromReceipt(receipt: ethers.ContractTransactionReceipt): bigint {
    // Parse events from receipt to find Registered event
    const identityRegistry = this.sdk.getIdentityRegistry();
    const transferEventTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'; // Transfer(address,address,uint256)

    // Find the event in the logs
    for (const log of receipt.logs || []) {
      try {
        // Try parsing as Registered event
        const parsed = identityRegistry.interface.parseLog({
          topics: Array.isArray(log.topics) ? log.topics.map((t: string | ethers.BytesLike) => typeof t === 'string' ? t : ethers.hexlify(t)) : log.topics || [],
          data: typeof log.data === 'string' ? log.data : ethers.hexlify(log.data || '0x'),
        });
        if (parsed && parsed.name === 'Registered') {
          return BigInt(parsed.args.agentId.toString());
        }
      } catch {
        // Not a Registered event, try Transfer event MP (ERC-721)
        try {
          const topics = Array.isArray(log.topics) ? log.topics : [];
          // Transfer event has topic[0] = Transfer signature, topic[3] = tokenId (if 4 topics)
          if (topics.length >= 4) {
            const topic0 = typeof topics[0] === 'string' ? topics[0] : topics[0].toString();
            if (topic0 === transferEventTopic || topic0.toLowerCase() === transferEventTopic.toLowerCase()) {
              // Extract tokenId from topic[3]
              const tokenIdHex = typeof topics[3] === 'string' ? topics[3] : topics[3].toString();
              // Remove 0x prefix if present and convert
              const tokenIdStr = tokenIdHex.startsWith('0x') ? tokenIdHex.slice(2) : tokenIdHex;
              return BigInt('0x' + tokenIdStr);
            }
          }
        } catch {
          // Continue searching
        }
      }
    }

    // Fallback: try to get total supply and use latest token ID
    // Note: This is async but we're in a sync method, so we'll try to call but it might not work
    // Better to throw error and let caller handle

    throw new Error('Could not extract agent ID from transaction receipt - no Registered or Transfer event found');
  }
}

