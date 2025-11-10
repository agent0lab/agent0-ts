/**
 * IPFS client for decentralized storage with support for multiple providers:
 * - Local IPFS nodes (via ipfs-http-client)
 * - Pinata IPFS pinning service
 * - Filecoin Pin service
 */

import type { IPFSHTTPClient } from 'ipfs-http-client';
import type { RegistrationFile } from '../models/interfaces.js';
import { IPFS_GATEWAYS, TIMEOUTS } from '../utils/constants.js';

export interface IPFSClientConfig {
  url?: string; // IPFS node URL (e.g., "http://localhost:5001")
  filecoinPinEnabled?: boolean;
  filecoinPrivateKey?: string;
  pinataEnabled?: boolean;
  pinataJwt?: string;
}

/**
 * Client for IPFS operations supporting multiple providers
 */
export class IPFSClient {
  private provider: 'pinata' | 'filecoinPin' | 'node';
  private config: IPFSClientConfig;
  private client?: IPFSHTTPClient;

  constructor(config: IPFSClientConfig) {
    this.config = config;

    // Determine provider
    if (config.pinataEnabled) {
      this.provider = 'pinata';
      this._verifyPinataJwt();
    } else if (config.filecoinPinEnabled) {
      this.provider = 'filecoinPin';
      // Note: Filecoin Pin in TypeScript requires external CLI or API
      // We'll use HTTP API if available, otherwise throw error
    } else if (config.url) {
      this.provider = 'node';
      // Lazy initialization - client will be created on first use
    } else {
      throw new Error('No IPFS provider configured. Specify url, pinataEnabled, or filecoinPinEnabled.');
    }
  }

  /**
   * Initialize IPFS HTTP client (lazy, only when needed)
   */
  private async _ensureClient(): Promise<void> {
    if (this.provider === 'node' && !this.client && this.config.url) {
      const { create } = await import('ipfs-http-client');
      this.client = create({ url: this.config.url });
    }
  }

  private _verifyPinataJwt(): void {
    if (!this.config.pinataJwt) {
      throw new Error('pinataJwt is required when pinataEnabled=true');
    }
  }

  /**
   * Pin data to Pinata using v3 API
   */
  private async _pinToPinata(data: string): Promise<string> {
    const url = 'https://uploads.pinata.cloud/v3/files';
    const headers = {
      Authorization: `Bearer ${this.config.pinataJwt}`,
    };

    // Create a Blob from the data
    const blob = new Blob([data], { type: 'application/json' });
    const formData = new FormData();
    formData.append('file', blob, 'registration.json');
    formData.append('network', 'public');

    try {
      // Add timeout to fetch
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUTS.PINATA_UPLOAD);
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: formData,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to pin to Pinata: HTTP ${response.status} - ${errorText}`);
      }

      const result = await response.json();

      // v3 API returns CID in data.cid
      const cid = result?.data?.cid || result?.cid || result?.IpfsHash;
      if (!cid) {
        throw new Error(`No CID returned from Pinata. Response: ${JSON.stringify(result)}`);
      }

      // Verify CID is accessible on Pinata gateway (with short timeout since we just uploaded)
      // This catches cases where Pinata returns a CID but the upload actually failed
      // Note: We treat HTTP 429 (rate limit) and timeouts as non-fatal since content may propagate with delay
      try {
        const verifyUrl = `https://gateway.pinata.cloud/ipfs/${cid}`;
        const verifyResponse = await fetch(verifyUrl, {
          signal: AbortSignal.timeout(5000), // 5 second timeout for verification
        });
        if (!verifyResponse.ok) {
          // HTTP 429 (rate limit) is not a failure - gateway is just rate limiting
          if (verifyResponse.status === 429) {
            console.warn(
              `[IPFS] Pinata returned CID ${cid} but gateway is rate-limited (HTTP 429). ` +
              `Content is likely available but verification skipped due to rate limiting.`
            );
          } else {
            // Other HTTP errors might indicate a real problem
            throw new Error(
              `Pinata returned CID ${cid} but content is not accessible on gateway (HTTP ${verifyResponse.status}). ` +
              `This may indicate the upload failed. Full Pinata response: ${JSON.stringify(result)}`
            );
          }
        }
      } catch (verifyError) {
        // If verification fails, check if it's a timeout or rate limit (non-fatal)
        if (verifyError instanceof Error) {
          // Timeout or network errors are non-fatal - content may propagate with delay
          if (verifyError.message.includes('timeout') || verifyError.message.includes('aborted')) {
            console.warn(
              `[IPFS] Pinata returned CID ${cid} but verification timed out. ` +
              `Content may propagate with delay. Full Pinata response: ${JSON.stringify(result)}`
            );
          } else if (verifyError.message.includes('429')) {
            // Rate limit is non-fatal
            console.warn(
              `[IPFS] Pinata returned CID ${cid} but gateway is rate-limited. ` +
              `Content is likely available but verification skipped.`
            );
          } else {
            // Other errors might indicate a real problem, but we'll still continue
            // since Pinata API returned success - content might just need time to propagate
            console.warn(
              `[IPFS] Pinata returned CID ${cid} but verification failed: ${verifyError.message}. ` +
              `Content may propagate with delay. Full Pinata response: ${JSON.stringify(result)}`
            );
          }
        }
      }

      return cid;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Pinata upload timed out after ${TIMEOUTS.PINATA_UPLOAD / 1000} seconds`);
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to pin to Pinata: ${errorMessage}`);
    }
  }

  /**
   * Pin data to Filecoin Pin
   * Note: This requires the Filecoin Pin API or CLI to be available
   * For now, we'll throw an error directing users to use the CLI
   */
  private async _pinToFilecoin(data: string): Promise<string> {
    // Filecoin Pin typically requires CLI or API access
    // This is a placeholder - in production, you'd call the Filecoin Pin API
    throw new Error(
      'Filecoin Pin via TypeScript SDK not yet fully implemented. ' +
        'Please use the filecoin-pin CLI or implement the Filecoin Pin API integration.'
    );
  }

  /**
   * Pin data to local IPFS node
   */
  private async _pinToLocalIpfs(data: string): Promise<string> {
    await this._ensureClient();
    if (!this.client) {
      throw new Error('No IPFS client available');
    }

    const result = await this.client.add(data);
    return result.cid.toString();
  }

  /**
   * Add data to IPFS and return CID
   */
  async add(data: string): Promise<string> {
    try {
      if (this.provider === 'pinata') {
        return await this._pinToPinata(data);
      } else if (this.provider === 'filecoinPin') {
        return await this._pinToFilecoin(data);
      } else {
        return await this._pinToLocalIpfs(data);
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Add file to IPFS and return CID
   * Note: This method works in Node.js environments. For browser, use add() with file content directly.
   */
  async addFile(filepath: string): Promise<string> {
    // Check if we're in Node.js environment
    if (typeof process === 'undefined' || !process.versions?.node) {
      throw new Error(
        'addFile() is only available in Node.js environments. ' +
          'For browser environments, use add() with file content directly.'
      );
    }

    const fs = await import('fs');
    const data = fs.readFileSync(filepath, 'utf-8');

    if (this.provider === 'pinata') {
      return this._pinToPinata(data);
    } else if (this.provider === 'filecoinPin') {
      return this._pinToFilecoin(filepath);
    } else {
      await this._ensureClient();
      if (!this.client) {
        throw new Error('No IPFS client available');
      }
      // For local IPFS, add file directly
      const fileContent = fs.readFileSync(filepath);
      const result = await this.client.add(fileContent);
      return result.cid.toString();
    }
  }

  /**
   * Get data from IPFS by CID
   */
  async get(cid: string): Promise<string> {
    // Extract CID from IPFS URL if needed
    if (cid.startsWith('ipfs://')) {
      cid = cid.slice(7); // Remove "ipfs://" prefix
    }

    // For Pinata and Filecoin Pin, use IPFS gateways
    if (this.provider === 'pinata' || this.provider === 'filecoinPin') {
      const gateways = IPFS_GATEWAYS.map(gateway => `${gateway}${cid}`);

      // Try all gateways in parallel - use the first successful response
      const promises = gateways.map(async (gateway) => {
        try {
          const response = await fetch(gateway, {
            signal: AbortSignal.timeout(TIMEOUTS.IPFS_GATEWAY),
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

      throw new Error('Failed to retrieve data from all IPFS gateways');
    } else {
      await this._ensureClient();
      if (!this.client) {
        throw new Error('No IPFS client available');
      }

      const chunks: Uint8Array[] = [];
      for await (const chunk of this.client.cat(cid)) {
        chunks.push(chunk);
      }

      // Concatenate chunks and convert to string
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }

      return new TextDecoder().decode(result);
    }
  }

  /**
   * Get JSON data from IPFS by CID
   */
  async getJson<T = Record<string, unknown>>(cid: string): Promise<T> {
    const data = await this.get(cid);
    return JSON.parse(data) as T;
  }

  /**
   * Pin a CID to local node
   */
  async pin(cid: string): Promise<{ pinned: string[] }> {
    if (this.provider === 'filecoinPin') {
      // Filecoin Pin automatically pins data, so this is a no-op
      return { pinned: [cid] };
    } else {
      await this._ensureClient();
      if (!this.client) {
        throw new Error('No IPFS client available');
      }
      await this.client.pin.add(cid);
      return { pinned: [cid] };
    }
  }

  /**
   * Unpin a CID from local node
   */
  async unpin(cid: string): Promise<{ unpinned: string[] }> {
    if (this.provider === 'filecoinPin') {
      // Filecoin Pin doesn't support unpinning in the same way
      return { unpinned: [cid] };
    } else {
      await this._ensureClient();
      if (!this.client) {
        throw new Error('No IPFS client available');
      }
      await this.client.pin.rm(cid);
      return { unpinned: [cid] };
    }
  }

  /**
   * Add JSON data to IPFS and return CID
   */
  async addJson(data: Record<string, unknown>): Promise<string> {
    const jsonStr = JSON.stringify(data, null, 2);
    return this.add(jsonStr);
  }

  /**
   * Add registration file to IPFS and return CID
   */
  async addRegistrationFile(
    registrationFile: RegistrationFile,
    chainId?: number,
    identityRegistryAddress?: string
  ): Promise<string> {
    // Convert from internal format { type, value, meta } to ERC-8004 format { name, endpoint, version }
    const endpoints: Array<Record<string, unknown>> = [];
    for (const ep of registrationFile.endpoints) {
      const endpointDict: Record<string, unknown> = {
        name: ep.type, // EndpointType enum value (e.g., "MCP", "A2A")
        endpoint: ep.value,
      };
      
      // Spread meta fields (version, mcpTools, mcpPrompts, etc.) into the endpoint dict
      if (ep.meta) {
        Object.assign(endpointDict, ep.meta);
      }
      
      endpoints.push(endpointDict);
    }
    
    // Add walletAddress as an endpoint if present
    if (registrationFile.walletAddress) {
      const walletChainId = registrationFile.walletChainId || chainId || 1;
      endpoints.push({
        name: 'agentWallet',
        endpoint: `eip155:${walletChainId}:${registrationFile.walletAddress}`,
      });
    }
    
    // Build registrations array
    const registrations: Array<Record<string, unknown>> = [];
    if (registrationFile.agentId) {
      const [, , tokenId] = registrationFile.agentId.split(':');
      const agentRegistry = chainId && identityRegistryAddress
        ? `eip155:${chainId}:${identityRegistryAddress}`
        : `eip155:1:{identityRegistry}`;
      registrations.push({
        agentId: parseInt(tokenId, 10),
        agentRegistry,
      });
    }
    
    // Build ERC-8004 compliant registration file
    const data = {
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: registrationFile.name,
      description: registrationFile.description,
      ...(registrationFile.image && { image: registrationFile.image }),
      endpoints,
      ...(registrations.length > 0 && { registrations }),
      ...(registrationFile.trustModels.length > 0 && {
        supportedTrusts: registrationFile.trustModels,
      }),
      active: registrationFile.active,
      x402support: registrationFile.x402support,
    };
    
    return this.addJson(data);
  }

  /**
   * Get registration file from IPFS by CID
   */
  async getRegistrationFile(cid: string): Promise<RegistrationFile> {
    const data = await this.getJson<RegistrationFile>(cid);
    return data;
  }

  /**
   * Close IPFS client connection
   */
  async close(): Promise<void> {
    if (this.client) {
      // IPFS HTTP client doesn't have a close method in the same way
      // But we can clear the reference
      this.client = undefined;
    }
  }
}

