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
  token?: string; // Payment token: 'ethereum' | 'pol' | 'solana' | 'base-eth'
  testnet?: boolean; // Use testnet endpoints for development
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
      token: this.config.token || 'ethereum',
      ...(this.config.testnet && {
        paymentServiceConfig: { url: 'https://payment.ardrive.dev' },
        uploadServiceConfig: { url: 'https://upload.ardrive.dev' },
      }),
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
          'Turbo upload failed due to service limits. ' +
            'Files under 100KB are typically free. ' +
            'For larger files or high volume, visit https://turbo.ardrive.io. ' +
            `Details: ${error.message}`
        );
      }
      throw new Error(`Arweave upload failed: ${error.message}`);
    }
  }

  /**
   * Upload JSON data to Arweave
   */
  async addJson(
    data: Record<string, unknown>,
    tags?: Array<{ name: string; value: string }>
  ): Promise<string> {
    const jsonStr = JSON.stringify(data, null, 2);
    return this.add(jsonStr, tags);
  }

  /**
   * Upload registration file to Arweave with ERC-8004 format.
   * Uses shared formatting utility to ensure consistency with IPFS.
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
   * Get JSON data from Arweave by transaction ID
   */
  async getJson<T = Record<string, unknown>>(txId: string): Promise<T> {
    const data = await this.get(txId);
    return JSON.parse(data) as T;
  }

  /**
   * Get registration file from Arweave by transaction ID
   */
  async getRegistrationFile(txId: string): Promise<RegistrationFile> {
    return await this.getJson<RegistrationFile>(txId);
  }

  /**
   * Close client connections (for API consistency with IPFSClient)
   */
  async close(): Promise<void> {
    // No explicit cleanup needed for Turbo
    // Included for API consistency
  }
}
