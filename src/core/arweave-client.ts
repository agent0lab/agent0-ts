/**
 * Arweave client for permanent storage using Turbo SDK and parallel gateway retrieval.
 * Uploads via ArDrive Turbo SDK, retrieves via multiple AR.IO gateways with parallel fallback.
 * Uses the same pattern as IPFSClient for architectural consistency.
 */

import { TurboFactory, EthereumSigner } from '@ardrive/turbo-sdk';
import type { RegistrationFile } from '../models/interfaces';
import { formatRegistrationFileForStorage } from '../utils/registration-format';
import { generateArweaveRegistrationTags } from '../utils/arweave-tags';
import { ARWEAVE_GATEWAYS, TIMEOUTS } from '../utils/constants';

export interface ArweaveClientConfig {
  privateKey: string; // EVM private key (NOT Arweave JWK)
}

export class ArweaveClient {
  private config: ArweaveClientConfig;
  private turbo: any; // TurboFactory authenticated instance

  constructor(config: ArweaveClientConfig) {
    this.config = config;
    this._initializeTurbo();
  }

  /**
   * Initialize Turbo SDK with EVM signer for uploads
   */
  private _initializeTurbo() {
    const signer = new EthereumSigner(this.config.privateKey);

    const turboConfig: any = {
      signer,
      token: 'ethereum',
    };

    this.turbo = TurboFactory.authenticated(turboConfig);
  }

  /**
   * Upload data to Arweave via Turbo SDK.
   * Data is immediately available on arweave.net via optimistic caching
   * while settling to Arweave network in the background.
   *
   * @param data - String data to upload
   * @returns Arweave transaction ID
   */
  async add(data: string, tags?: Array<{ name: string; value: string }>): Promise<string> {
    try {
      const result = await this.turbo.upload({
        data,
        ...(tags && { dataItemOpts: { tags } }), // Include tags if provided
      });
      return result.id; // Arweave transaction ID
    } catch (error: any) {
      // Error handling for upload failures
      // Note: Turbo provides free uploads for files <100KB, so typical agent
      // registrations (1-10KB) and feedback (<1KB) won't require credits
      if (
        error.message?.includes('credit') ||
        error.message?.includes('balance') ||
        error.message?.includes('insufficient')
      ) {
        throw new Error(
          'Arweave upload failed: Insufficient Turbo credits. ' +
            'Files under 100KB are typically free. For larger files or if you have ' +
            'exceeded the free tier, purchase credits at https://turbo.ar.io. ' +
            `Details: ${error.message}`
        );
      }
      throw new Error(`Arweave upload failed: ${error.message}`);
    }
  }

  /**
   * Upload JSON data to Arweave via Turbo SDK.
   * Automatically stringifies the data and uploads with optional tags.
   * Data is immediately available via optimistic caching.
   *
   * @param data - JavaScript object to upload as JSON
   * @param tags - Optional array of Arweave tags for metadata and searchability
   * @returns Arweave transaction ID
   */
  async addJson(
    data: Record<string, unknown>,
    tags?: Array<{ name: string; value: string }>
  ): Promise<string> {
    const jsonStr = JSON.stringify(data, null, 2);
    return this.add(jsonStr, tags);
  }

  /**
   * Upload agent registration file to Arweave with ERC-8004 formatting.
   * Uses shared formatting utility to ensure consistency with IPFS implementation.
   * Automatically generates comprehensive Arweave tags for searchability when chainId is provided.
   *
   * Tags include: Content-Type, App-Name, Protocol, Data-Type, Chain-Id, Agent-Id,
   * Schema-Version, capability flags (Has-MCP, Has-A2A, Has-Wallet, Active), and timestamp.
   * All tags are cryptographically signed via Turbo's EthereumSigner.
   *
   * @param registrationFile - Agent registration data to upload
   * @param chainId - Optional blockchain network ID (enables tag generation)
   * @param identityRegistryAddress - Optional registry contract address (included in formatted data)
   * @returns Arweave transaction ID (permanent, immutable)
   */
  async addRegistrationFile(
    registrationFile: RegistrationFile,
    chainId?: number,
    identityRegistryAddress?: string
  ): Promise<string> {
    const data = formatRegistrationFileForStorage(
      registrationFile,
      chainId,
      identityRegistryAddress
    );

    // Generate tags if chainId is provided
    const tags = chainId ? generateArweaveRegistrationTags(registrationFile, chainId) : undefined;

    return this.addJson(data, tags);
  }

  /**
   * Retrieve data from Arweave using parallel gateway fallback.
   * Tries all gateways simultaneously and returns the first successful response.
   * This matches the IPFS implementation pattern for architectural consistency.
   *
   * @param txId - Arweave transaction ID (with or without ar:// prefix)
   * @returns Retrieved data as string
   */
  async get(txId: string): Promise<string> {
    // Remove ar:// prefix if present
    if (txId.startsWith('ar://')) {
      txId = txId.slice(5);
    }

    if (!txId || txId.trim() === '') {
      throw new Error('Invalid transaction ID: empty or undefined');
    }

    const gateways = ARWEAVE_GATEWAYS.map((gateway) => `${gateway}/${txId}`);

    // Try all gateways in parallel - use the first successful response
    // (Same pattern as IPFSClient.get() for consistency)
    const promises = gateways.map(async (gateway) => {
      try {
        const response = await fetch(gateway, {
          redirect: 'follow', // Required for Arweave security sandboxing
          signal: AbortSignal.timeout(TIMEOUTS.ARWEAVE_GATEWAY),
        });
        if (response.ok) {
          return await response.text();
        }
        throw new Error(`HTTP ${response.status}`);
      } catch (error) {
        throw error;
      }
    });

    // Use Promise.allSettled to get the first successful result
    const results = await Promise.allSettled(promises);
    for (const result of results) {
      if (result.status === 'fulfilled') {
        return result.value;
      }
    }

    throw new Error(`Failed to retrieve data from all Arweave gateways. Transaction ID: ${txId}`);
  }

  /**
   * Retrieve and parse JSON data from Arweave using parallel gateway fallback.
   * Automatically parses the retrieved string data as JSON.
   *
   * @param txId - Arweave transaction ID (with or without ar:// prefix)
   * @returns Parsed JSON data typed as T
   * @throws Error if retrieval fails from all gateways or if JSON parsing fails
   */
  async getJson<T = Record<string, unknown>>(txId: string): Promise<T> {
    const data = await this.get(txId);
    return JSON.parse(data) as T;
  }

  /**
   * Retrieve and parse agent registration file from Arweave.
   * Returns a typed RegistrationFile object with full agent metadata, endpoints,
   * trust models, and capabilities.
   *
   * @param txId - Arweave transaction ID (with or without ar:// prefix)
   * @returns Typed RegistrationFile object
   * @throws Error if retrieval fails from all gateways or if data doesn't match expected format
   */
  async getRegistrationFile(txId: string): Promise<RegistrationFile> {
    return await this.getJson<RegistrationFile>(txId);
  }

  /**
   * Close client connections and release resources.
   * Included for API consistency with IPFSClient, though Turbo SDK
   * does not require explicit cleanup.
   *
   * @returns Promise that resolves when cleanup is complete
   */
  async close(): Promise<void> {
    // No explicit cleanup needed for Turbo
    // Included for API consistency
  }
}
