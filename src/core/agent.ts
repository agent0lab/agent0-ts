/**
 * Agent class for managing individual agents
 */

import { decodeEventLog, getAddress, hashDomain, toHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
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
import type { ChainReceipt } from './chain-client.js';
import { IDENTITY_REGISTRY_ABI } from './contracts.js';
import { normalizeEcdsaSignature, recoverTypedDataSigner } from '../utils/signatures.js';
import { buildErc8004RegistrationJson } from '../utils/registration-json.js';
import { encodeErc8004JsonDataUri } from '../utils/data-uri.js';
import { TransactionHandle } from './transaction-handle.js';

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

  private async _waitForTransactionWithRetry(hash: `0x${string}`, timeoutMs: number): Promise<ChainReceipt> {
    try {
      return await this.sdk.chainClient.waitForTransaction({ hash, timeoutMs });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes('timed out')) {
        return await this.sdk.chainClient.waitForTransaction({ hash, timeoutMs: timeoutMs * 2 });
      }
      throw err;
    }
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

  /**
   * Read the verified agent wallet from the Identity Registry (on-chain).
   *
   * Internally calls the contract function `getAgentWallet(agentId)`.
   * Returns `undefined` if unset/cleared (zero address).
   */
  async getWallet(): Promise<Address | undefined> {
    if (!this.registrationFile.agentId) {
      throw new Error('Agent must be registered before reading wallet from chain.');
    }

    const { tokenId } = parseAgentId(this.registrationFile.agentId);
    const identityRegistryAddress = this.sdk.identityRegistryAddress();

    const wallet = await this.sdk.chainClient.readContract<Address>({
      address: identityRegistryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getAgentWallet',
      args: [BigInt(tokenId)],
    });

    if (wallet.toLowerCase() === '0x0000000000000000000000000000000000000000') return undefined;
    return wallet;
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

  /**
   * Remove endpoint(s) with wildcard semantics (parity with Python SDK).
   *
   * - If no args are provided, removes all endpoints.
   * - If only `type` is provided, removes all endpoints of that type.
   * - If only `value` is provided, removes all endpoints with that value.
   * - If both are provided, removes endpoints that match both.
   */
  removeEndpoint(): this;
  removeEndpoint(opts: { type?: EndpointType; value?: string }): this;
  removeEndpoint(type?: EndpointType, value?: string): this;
  removeEndpoint(
    arg1?: EndpointType | { type?: EndpointType; value?: string },
    arg2?: string
  ): this {
    const { type, value } =
      arg1 && typeof arg1 === 'object'
        ? { type: arg1.type, value: arg1.value }
        : { type: arg1 as EndpointType | undefined, value: arg2 };

    if (type === undefined && value === undefined) {
      // Remove all endpoints
      this.registrationFile.endpoints = [];
    } else {
      // Remove matching endpoints (wildcard semantics)
      this.registrationFile.endpoints = this.registrationFile.endpoints.filter((ep) => {
        const typeMatches = type === undefined || ep.type === type;
        const valueMatches = value === undefined || ep.value === value;
        return !(typeMatches && valueMatches);
      });
    }

    this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  /**
   * Remove all endpoints.
   */
  removeEndpoints(): this {
    return this.removeEndpoint();
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

  /**
   * Set agent wallet on-chain with EIP-712 signature verification.
   *
   * This is on-chain only.
   * If the agent is not registered yet, this throws.
   */
  async setWallet(
    newWallet: Address,
    opts?: {
      deadline?: number;
      /**
       * If the new wallet is not the same as the SDK signer, pass a private key for the new wallet
       * (or pass `signature` directly from an external signer).
       */
      newWalletPrivateKey?: string;
      signature?: string | Uint8Array;
    }
  ): Promise<TransactionHandle<RegistrationFile> | undefined> {
    const start = Date.now();
    if (!this.registrationFile.agentId) {
      throw new Error(
        'Agent must be registered before setting agentWallet on-chain. ' +
          'Register the agent first, then call setWallet().'
      );
    }

    if (this.sdk.isReadOnly) {
      throw new Error('No signer configured to submit setWallet transaction');
    }

    // Validate newWallet address
    if (!this.sdk.chainClient.isAddress(newWallet)) {
      throw new Error(`Invalid newWallet address: ${newWallet}`);
    }

    const { tokenId } = parseAgentId(this.registrationFile.agentId);
    const identityRegistryAddress = this.sdk.identityRegistryAddress();

    // Optional short-circuit if already set
    try {
      const currentWallet = await this.getWallet();
      if (currentWallet && currentWallet.toLowerCase() === newWallet.toLowerCase()) {
        const chainId = await this.sdk.chainId();
        this.registrationFile.walletAddress = newWallet;
        this.registrationFile.walletChainId = chainId;
        this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);
        const payload = this.sdk.getAgentSnapshotForTelemetry(chainId, this.registrationFile.agentId!, this.registrationFile);
        this.sdk.emitTelemetryEvent({
          eventType: 'agent.wallet.set',
          success: true,
          durationMs: Date.now() - start,
          timestamp: Date.now(),
          payload,
        });
        return undefined;
      }
    } catch {
      // ignore and proceed
    }

    // Deadline: contract enforces a short window. Use chain time (latest block timestamp)
    // rather than local system time to avoid clock skew causing reverts.
    const chainNow = Number(await this.sdk.chainClient.getBlockTimestamp('latest'));
    const deadlineValue = opts?.deadline ?? chainNow + 60;
    if (deadlineValue < chainNow) {
      throw new Error(`Invalid deadline: ${deadlineValue} is in the past (chain time: ${chainNow})`);
    }
    if (deadlineValue > chainNow + 300) {
      throw new Error(`Invalid deadline: ${deadlineValue} is too far in the future. Must be <= chainTime + 300s. (chain time: ${chainNow})`);
    }

    const chainId = await this.sdk.chainId();
    const verifyingContract = identityRegistryAddress;
    const owner = await this.sdk.chainClient.readContract<Address>({
      address: identityRegistryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'ownerOf',
      args: [BigInt(tokenId)],
    });
    
    // Prefer reading the actual EIP-712 domain from the contract (if supported)
    // to avoid any future divergence in name/version.
    let domainName: string | undefined;
    let domainVersion: string | undefined;
    try {
      const domainInfo = await this.sdk.chainClient.readContract<any>({
        address: identityRegistryAddress,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'eip712Domain',
        args: [],
      });
      // eip712Domain() returns: (fields, name, version, chainId, verifyingContract, salt, extensions)
      domainName = domainInfo?.name ?? domainInfo?.[1];
      domainVersion = domainInfo?.version ?? domainInfo?.[2];
    } catch {
      // ignore and use defaults
    }

    // If the contract exposes a domain separator, try to select a matching (name, version)
    // deterministically from common candidates.
    let domainSeparatorOnChain: string | undefined;
    try {
      domainSeparatorOnChain = await this.sdk.chainClient.readContract<string>({
        address: identityRegistryAddress,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'DOMAIN_SEPARATOR',
        args: [],
      });
    } catch {
      // ignore
    }

    // Determine signature
    let signature: `0x${string}` | undefined;
    if (opts?.signature) {
      const sig =
        typeof opts.signature === 'string'
          ? (opts.signature.startsWith('0x') ? opts.signature : `0x${opts.signature}`)
          : (() => {
              let hex = '0x';
              for (const b of opts.signature as Uint8Array) {
                hex += b.toString(16).padStart(2, '0');
              }
              return hex;
            })();
      signature = normalizeEcdsaSignature(sig as Hex) as `0x${string}`;
    } else {
      // The new wallet MUST sign (EOA path). Support a few domain/type variants to match deployed registries.
      const sdkSignerAddress = await this.sdk.chainClient.getAddress();

      // If no explicit signer was provided, allow the one-wallet case (SDK signer == newWallet)
      if (!opts?.newWalletPrivateKey) {
        if (!sdkSignerAddress || sdkSignerAddress.toLowerCase() !== newWallet.toLowerCase()) {
          throw new Error(
            `The new wallet must sign the EIP-712 message. ` +
              `Pass opts.newWalletPrivateKey or opts.signature. ` +
              `SDK signer is ${sdkSignerAddress || 'unknown'}, newWallet is ${newWallet}.`
          );
        }
      }

      const domainNames: string[] = [];
      if (domainName) domainNames.push(domainName);
      // Common known names across deployments/spec revisions
      domainNames.push('ERC8004IdentityRegistry', 'IdentityRegistry', 'ERC8004IdentityRegistryUpgradeable', 'IdentityRegistryUpgradeable');
      const domainVersions = [domainVersion || '1', '1'];

      // If we have a domain separator, prefer the (name, version) that matches it.
      if (domainSeparatorOnChain) {
        const match = domainNames.flatMap((dn) =>
          domainVersions.map((dv) => ({ dn, dv }))
        ).find(({ dn, dv }) => {
          try {
            const computed = hashDomain({
              name: dn,
              version: dv,
              chainId,
              verifyingContract: verifyingContract,
            } as any);
            return computed.toLowerCase() === String(domainSeparatorOnChain).toLowerCase();
          } catch {
            return false;
          }
        });
        if (match) {
          domainNames.unshift(match.dn);
          domainVersions.unshift(match.dv);
        }
      }

      // Try (with owner) first, then (no owner) legacy; and try each domain name.
      const variants: Array<{ domain: any; types: any; primaryType: string; message: any }> = [];
      for (const dn of domainNames) {
        for (const dv of domainVersions) {
          const domain = {
            name: dn,
            version: dv,
            chainId,
            verifyingContract,
          };
          variants.push({
            domain,
            primaryType: 'AgentWalletSet',
            types: {
              AgentWalletSet: [
                { name: 'agentId', type: 'uint256' },
                { name: 'newWallet', type: 'address' },
                { name: 'owner', type: 'address' },
                { name: 'deadline', type: 'uint256' },
              ],
            },
            message: {
              agentId: BigInt(tokenId),
              newWallet,
              owner,
              deadline: BigInt(deadlineValue),
            },
          });
          variants.push({
            domain,
            primaryType: 'AgentWalletSet',
            types: {
              AgentWalletSet: [
                { name: 'agentId', type: 'uint256' },
                { name: 'newWallet', type: 'address' },
                { name: 'deadline', type: 'uint256' },
              ],
            },
            message: {
              agentId: BigInt(tokenId),
              newWallet,
              deadline: BigInt(deadlineValue),
            },
          });
        }
      }

      let lastError: unknown;
      for (const v of variants) {
        try {
          let sig: `0x${string}`;
          if (opts?.newWalletPrivateKey) {
            const acc = privateKeyToAccount(
              (opts.newWalletPrivateKey.startsWith('0x')
                ? opts.newWalletPrivateKey
                : `0x${opts.newWalletPrivateKey}`) as Hex
            );
            sig = normalizeEcdsaSignature(
              (await acc.signTypedData({
                domain: v.domain,
                types: v.types,
                primaryType: v.primaryType,
                message: v.message,
              })) as Hex
            ) as `0x${string}`;
          } else {
            sig = await this.sdk.chainClient.signTypedData({
              domain: v.domain,
              types: v.types,
              primaryType: v.primaryType,
              message: v.message,
            });
          }

          const recovered = await recoverTypedDataSigner({
            domain: v.domain,
            types: v.types,
            primaryType: v.primaryType,
            message: v.message,
            signature: sig as Hex,
          });
          if (recovered.toLowerCase() !== getAddress(newWallet).toLowerCase()) {
            throw new Error(`EIP-712 recovery mismatch: recovered ${recovered}, expected ${newWallet}`);
          }

          signature = sig;
          break;
        } catch (e) {
          lastError = e;
        }
      }

      if (!signature) {
        const msg = lastError instanceof Error ? lastError.message : String(lastError);
        throw new Error(`Failed to produce a valid wallet signature for this registry: ${msg}`);
      }
    }

    // Call contract function (tx sender is SDK signer: owner/operator)
    const txHash = await this.sdk.chainClient.writeContract({
      address: identityRegistryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'setAgentWallet',
      args: [BigInt(tokenId), newWallet, BigInt(deadlineValue), signature],
    });

    return new TransactionHandle(txHash as Hex, this.sdk.chainClient, async () => {
      this.registrationFile.walletAddress = newWallet;
      this.registrationFile.walletChainId = chainId;
      this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);
      const payload = this.sdk.getAgentSnapshotForTelemetry(chainId, this.registrationFile.agentId!, this.registrationFile);
      this.sdk.emitTelemetryEvent({
        eventType: 'agent.wallet.set',
        success: true,
        durationMs: Date.now() - start,
        timestamp: Date.now(),
        payload,
      });
      return this.registrationFile;
    });
  }

  /**
   * Unset agent wallet on-chain (ERC-8004 Jan 2026).
   *
   * This is on-chain only and requires the agent to be registered.
   * Returns txHash (or "" if it was already unset).
   */
  async unsetWallet(): Promise<TransactionHandle<RegistrationFile> | undefined> {
    const start = Date.now();
    if (!this.registrationFile.agentId) {
      throw new Error(
        'Agent must be registered before unsetting agentWallet on-chain. ' +
          'Register the agent first, then call unsetWallet().'
      );
    }

    if (this.sdk.isReadOnly) {
      throw new Error('No signer configured to submit unsetWallet transaction');
    }

    const { tokenId } = parseAgentId(this.registrationFile.agentId);
    const identityRegistryAddress = this.sdk.identityRegistryAddress();

    try {
      const currentWallet = await this.getWallet();
      if (!currentWallet) {
        this.registrationFile.walletAddress = undefined;
        this.registrationFile.walletChainId = undefined;
        this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);
        const chainId = await this.sdk.chainId();
        const payload = this.sdk.getAgentSnapshotForTelemetry(chainId, this.registrationFile.agentId!, this.registrationFile);
        this.sdk.emitTelemetryEvent({
          eventType: 'agent.wallet.unset',
          success: true,
          durationMs: Date.now() - start,
          timestamp: Date.now(),
          payload,
        });
        return undefined;
      }
    } catch {
      // ignore and proceed
    }

    const txHash = await this.sdk.chainClient.writeContract({
      address: identityRegistryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'unsetAgentWallet',
      args: [BigInt(tokenId)],
    });

    return new TransactionHandle(txHash as Hex, this.sdk.chainClient, async () => {
      this.registrationFile.walletAddress = undefined;
      this.registrationFile.walletChainId = undefined;
      this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);
      const chainId = await this.sdk.chainId();
      const payload = this.sdk.getAgentSnapshotForTelemetry(chainId, this.registrationFile.agentId!, this.registrationFile);
      this.sdk.emitTelemetryEvent({
        eventType: 'agent.wallet.unset',
        success: true,
        durationMs: Date.now() - start,
        timestamp: Date.now(),
        payload,
      });
      return this.registrationFile;
    });
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
   * Register agent on-chain with a fully on-chain ERC-8004 registration file (data URI).
   *
   * This encodes the registration JSON as:
   *   data:application/json;base64,...
   *
   * Backwards compatible: does not change `registerIPFS()` / `registerHTTP()`.
   */
  async registerOnChain(): Promise<TransactionHandle<RegistrationFile>> {
    // Validate basic info
    if (!this.registrationFile.name || !this.registrationFile.description) {
      throw new Error('Agent must have name and description before registration');
    }

    const chainId = await this.sdk.chainId();
    const identityRegistryAddress = this.sdk.identityRegistryAddress();
    const erc8004Json = buildErc8004RegistrationJson(this.registrationFile, {
      chainId,
      identityRegistryAddress,
    });
    const dataUri = encodeErc8004JsonDataUri(erc8004Json as Record<string, unknown>);

    // Delegate to existing write paths to preserve receipt parsing + state updates.
    return this.registerHTTP(dataUri);
  }

  /**
   * Register agent on-chain with IPFS flow
   */
  async registerIPFS(): Promise<TransactionHandle<RegistrationFile>> {
    const start = Date.now();
    if (!this.registrationFile.name || !this.registrationFile.description) {
      throw new Error('Agent must have name and description before registration');
    }

    if (!this.sdk.ipfsClient) {
      throw new Error('IPFS client not configured. Initialize SDK with ipfs config to use registerIPFS().');
    }

    if (this.registrationFile.agentId) {
      // Agent already registered - update registration file and redeploy
      const chainId = await this.sdk.chainId();
      const identityRegistryAddress = this.sdk.identityRegistryAddress();
      
      const ipfsCid = await this.sdk.ipfsClient.addRegistrationFile(
        this.registrationFile,
        chainId,
        identityRegistryAddress
      );

      // Update agent URI on-chain
      const { tokenId } = parseAgentId(this.registrationFile.agentId);
      
      const txHash = await this.sdk.chainClient.writeContract({
        address: identityRegistryAddress,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'setAgentURI',
        args: [BigInt(tokenId), `ipfs://${ipfsCid}`],
      });

      return new TransactionHandle(txHash as Hex, this.sdk.chainClient, async () => {
        if (this._dirtyMetadata.size > 0) {
          try {
            await this._updateMetadataOnChain();
          } catch {
            // ignore
          }
        }
        this._lastRegisteredWallet = this.walletAddress;
        this._lastRegisteredEns = this.ensEndpoint;
        this._dirtyMetadata.clear();
        this.registrationFile.agentURI = `ipfs://${ipfsCid}`;
        this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);
        const payload = this.sdk.getAgentSnapshotForTelemetry(chainId, this.registrationFile.agentId!, this.registrationFile) as Record<string, unknown>;
        payload.fieldsChanged = ['agentURI'];
        this.sdk.emitTelemetryEvent({
          eventType: 'agent.updated',
          success: true,
          durationMs: Date.now() - start,
          timestamp: Date.now(),
          payload,
        });
        return this.registrationFile;
      });
    } else {
      // First time registration: tx1 = register (no URI), then (after confirmation) upload + tx2 = setAgentURI
      const metadataEntries = this._collectMetadataForRegistration();
      const identityRegistryAddress = this.sdk.identityRegistryAddress();

      const txHash: `0x${string}` = await this.sdk.chainClient.writeContract({
        address: identityRegistryAddress,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'register',
        args: ['', metadataEntries],
      });

      return new TransactionHandle(txHash as Hex, this.sdk.chainClient, async (receipt) => {
        // Extract agent ID from events
        const agentId = this._extractAgentIdFromReceipt(receipt);

        // Update registration file with minted id
        const chainId = await this.sdk.chainId();
        this.registrationFile.agentId = `${chainId}:${agentId}`;
        this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);

        // Upload to IPFS (requires agentId in file)
        const ipfsCid = await this.sdk.ipfsClient!.addRegistrationFile(
          this.registrationFile,
          chainId,
          identityRegistryAddress
        );

        // tx2: setAgentURI
        const { tokenId } = parseAgentId(this.registrationFile.agentId);
        const txHash2 = await this.sdk.chainClient.writeContract({
          address: identityRegistryAddress,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'setAgentURI',
          args: [BigInt(tokenId), `ipfs://${ipfsCid}`],
        });

        await this._waitForTransactionWithRetry(txHash2, TIMEOUTS.TRANSACTION_WAIT);

        // Clear dirty flags
        this._lastRegisteredWallet = this.walletAddress;
        this._lastRegisteredEns = this.ensEndpoint;
        this._dirtyMetadata.clear();

        this.registrationFile.agentURI = `ipfs://${ipfsCid}`;
        this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);
        const payload = this.sdk.getAgentSnapshotForTelemetry(chainId, this.registrationFile.agentId!, this.registrationFile) as Record<string, unknown>;
        payload.registrationType = 'ipfs';
        this.sdk.emitTelemetryEvent({
          eventType: 'agent.registered',
          success: true,
          durationMs: Date.now() - start,
          timestamp: Date.now(),
          payload,
        });
        return this.registrationFile;
      });
    }
  }

  /**
   * Register agent on-chain with HTTP URI
   */
  async registerHTTP(agentUri: string): Promise<TransactionHandle<RegistrationFile>> {
    // Validate basic info
    if (!this.registrationFile.name || !this.registrationFile.description) {
      throw new Error('Agent must have name and description before registration');
    }

    if (this.registrationFile.agentId) {
      // Agent already registered - update agent URI
      return await this.setAgentURI(agentUri);
    } else {
      // First time registration
      const metadataEntries = this._collectMetadataForRegistration();
      const identityRegistryAddress = this.sdk.identityRegistryAddress();
      const txHash: `0x${string}` = await this.sdk.chainClient.writeContract({
        address: identityRegistryAddress,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'register',
        args: [agentUri, metadataEntries],
      });

      return new TransactionHandle(txHash as Hex, this.sdk.chainClient, async (receipt) => {
        const agentId = this._extractAgentIdFromReceipt(receipt);
        const chainId = await this.sdk.chainId();
        this.registrationFile.agentId = `${chainId}:${agentId}`;
        this.registrationFile.agentURI = agentUri;
        this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);
        this._dirtyMetadata.clear();
        return this.registrationFile;
      });
    }
  }

  /**
   * Set agent URI (for updates)
   */
  async setAgentURI(agentURI: string): Promise<TransactionHandle<RegistrationFile>> {
    if (!this.registrationFile.agentId) {
      throw new Error('Agent must be registered before setting URI');
    }

    const { tokenId } = parseAgentId(this.registrationFile.agentId);
    const identityRegistryAddress = this.sdk.identityRegistryAddress();
    const txHash = await this.sdk.chainClient.writeContract({
      address: identityRegistryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'setAgentURI',
      args: [BigInt(tokenId), agentURI],
    });
    return new TransactionHandle(txHash as Hex, this.sdk.chainClient, async () => {
      this.registrationFile.agentURI = agentURI;
      this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);
      return this.registrationFile;
    });
  }

  /**
   * Transfer agent ownership
   */
  async transfer(
    newOwner: Address
  ): Promise<TransactionHandle<{ txHash: string; from: Address; to: Address; agentId: AgentId }>> {
    const start = Date.now();
    if (!this.registrationFile.agentId) {
      throw new Error('Agent must be registered before transfer');
    }

    const { tokenId } = parseAgentId(this.registrationFile.agentId);
    const currentOwner = await this.sdk.chainClient.ensureAddress();

    // Validate address - normalize to lowercase first
    const normalizedAddress = newOwner.toLowerCase();
    if (!this.sdk.chainClient.isAddress(normalizedAddress)) {
      throw new Error(`Invalid address: ${newOwner}`);
    }

    // Validate not zero address (check before expensive operations)
    if (normalizedAddress === '0x0000000000000000000000000000000000000000') {
      throw new Error('Cannot transfer agent to zero address');
    }

    // Convert to checksum format
    const checksumAddress = this.sdk.chainClient.toChecksumAddress(normalizedAddress);

    // Validate not transferring to self
    if (checksumAddress.toLowerCase() === currentOwner.toLowerCase()) {
      throw new Error('Cannot transfer agent to yourself');
    }

    const identityRegistryAddress = this.sdk.identityRegistryAddress();
    const txHash = await this.sdk.chainClient.writeContract({
      address: identityRegistryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'transferFrom',
      args: [currentOwner, checksumAddress, BigInt(tokenId)],
    });
    return new TransactionHandle(txHash as Hex, this.sdk.chainClient, async () => {
      this.registrationFile.walletAddress = undefined;
      this.registrationFile.walletChainId = undefined;
      this.registrationFile.updatedAt = Math.floor(Date.now() / 1000);
      const chainId = await this.sdk.chainId();
      const payload = this.sdk.getAgentSnapshotForTelemetry(chainId, this.registrationFile.agentId!, this.registrationFile);
      this.sdk.emitTelemetryEvent({
        eventType: 'agent.transferred',
        success: true,
        durationMs: Date.now() - start,
        timestamp: Date.now(),
        payload,
      });
      return {
        txHash,
        from: currentOwner,
        to: checksumAddress,
        agentId: this.registrationFile.agentId!,
      };
    });
  }

  /**
   * Private helper methods
   */
  private async _registerWithoutUri(): Promise<void> {
    // Collect metadata for registration
    const metadataEntries = this._collectMetadataForRegistration();

    const identityRegistryAddress = this.sdk.identityRegistryAddress();
    
    // If we have metadata, use register(string, tuple[])
    // Otherwise use register() with no args
    let txHash: `0x${string}`;
    if (metadataEntries.length > 0) {
      txHash = await this.sdk.chainClient.writeContract({
        address: identityRegistryAddress,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'register',
        args: ['', metadataEntries],
      });
    } else {
      txHash = await this.sdk.chainClient.writeContract({
        address: identityRegistryAddress,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'register',
        args: [],
      });
    }

    // Wait for transaction (with timeout + retry for slow testnets)
    const receipt = await this._waitForTransactionWithRetry(txHash, TIMEOUTS.TRANSACTION_WAIT);

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

    const identityRegistryAddress = this.sdk.identityRegistryAddress();
    const txHash: `0x${string}` = await this.sdk.chainClient.writeContract({
      address: identityRegistryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'register',
      args: [agentUri, metadataEntries],
    });

    // Wait for transaction (with timeout + retry for slow testnets)
    const receipt = await this._waitForTransactionWithRetry(txHash, TIMEOUTS.TRANSACTION_WAIT);

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
    const identityRegistryAddress = this.sdk.identityRegistryAddress();

    // Update metadata one by one (like Python SDK)
    // Only send transactions for dirty (changed) metadata keys
    for (const entry of metadataEntries) {
      if (this._dirtyMetadata.has(entry.metadataKey)) {
        const txHash: `0x${string}` = await this.sdk.chainClient.writeContract({
          address: identityRegistryAddress,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'setMetadata',
          args: [BigInt(tokenId), entry.metadataKey, entry.metadataValue],
        });

        // Wait with 30 second timeout (like Python SDK)
        // If timeout, log warning but continue - transaction was sent and will eventually confirm
        try {
          await this._waitForTransactionWithRetry(txHash, TIMEOUTS.TRANSACTION_WAIT);
        } catch (error) {
          // Transaction was sent and will eventually confirm - continue silently
        }
      }
    }
  }

  private _collectMetadataForRegistration(): Array<{ metadataKey: string; metadataValue: Hex }> {
    const entries: Array<{ metadataKey: string; metadataValue: Hex }> = [];

    // Note: agentWallet is now a reserved metadata key that cannot be set via setMetadata()
    // It must be set using setWallet() with signature verification
    // We do not include it in metadata entries here

    // Collect custom metadata
    for (const [key, value] of Object.entries(this.registrationFile.metadata)) {
      // Skip agentWallet if it somehow got into metadata
      if (key === 'agentWallet') {
        continue;
      }

      let valueBytes: Uint8Array;
      if (typeof value === 'string') {
        valueBytes = new TextEncoder().encode(value);
      } else if (typeof value === 'number') {
        valueBytes = new TextEncoder().encode(value.toString());
      } else {
        valueBytes = new TextEncoder().encode(JSON.stringify(value));
      }

      // viem expects Solidity `bytes` values as hex strings (`0x...`), not Uint8Array
      entries.push({ metadataKey: key, metadataValue: toHex(valueBytes) });
    }

    return entries;
  }

  private _extractAgentIdFromReceipt(receipt: ChainReceipt): bigint {
    const transferEventTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'; // Transfer(address,address,uint256)

    // Find the event in the logs
    for (const log of receipt.logs || []) {
      try {
        if (!log.topics || log.topics.length === 0) {
          continue;
        }
        const parsed = decodeEventLog({
          abi: IDENTITY_REGISTRY_ABI as any,
          data: log.data as Hex,
          topics: log.topics as [Hex, ...Hex[]],
        }) as any;
        if (parsed && parsed.eventName === 'Registered') {
          const agentId = parsed.args?.agentId;
          if (agentId !== undefined) return BigInt(agentId);
        }
      } catch {
        // Not a Registered event, try Transfer event MP (ERC-721)
        try {
          const topics = Array.isArray(log.topics) ? log.topics : [];
          // Transfer event has topic[0] = Transfer signature, topic[3] = tokenId (if 4 topics)
          if (topics.length >= 4) {
            const topic0 = String(topics[0]);
            if (topic0 === transferEventTopic || topic0.toLowerCase() === transferEventTopic.toLowerCase()) {
              // Extract tokenId from topic[3]
              const tokenIdHex = String(topics[3]);
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

