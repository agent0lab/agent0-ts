/**
 * IPFS client for decentralized storage with support for multiple providers:
 * - Remote Kubo/IPFS daemon (via kubo-rpc-client)
 * - Embedded Helia node (via helia + @helia/unixfs)
 * - Pinata IPFS pinning service
 * - Filecoin Pin service
 */

import type { Helia } from 'helia';
import type { UnixFS } from '@helia/unixfs';
import type { CID as CIDType } from 'multiformats/cid';
import type { create as createKuboClient } from 'kubo-rpc-client';
import type { RegistrationFile } from '../models/interfaces.js';
import { IPFS_GATEWAYS, TIMEOUTS } from '../utils/constants.js';
import { buildErc8004RegistrationJson } from '../utils/registration-json.js';

export interface IPFSClientConfig {
  /**
   * URL for a running Kubo daemon HTTP RPC API.
   *
   * Examples:
   * - "http://localhost:5001" (default path will be resolved)
   * - "http://localhost:5001/api/v0"
   */
  url?: string;
  /**
   * If true, run an embedded Helia node in-process (no daemon required).
   */
  embeddedHeliaEnabled?: boolean;
  filecoinPinEnabled?: boolean;
  filecoinPrivateKey?: string;
  pinataEnabled?: boolean;
  pinataJwt?: string;
}

/**
 * Client for IPFS operations supporting multiple providers
 */
export class IPFSClient {
  private provider: 'pinata' | 'filecoinPin' | 'kubo' | 'helia';
  private config: IPFSClientConfig;
  private kubo?: ReturnType<typeof createKuboClient>;
  private helia?: Helia;
  private heliaFs?: UnixFS;
  private CID?: { parse: (input: string) => CIDType };

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
    } else if (config.embeddedHeliaEnabled) {
      this.provider = 'helia';
      // Lazy initialization - Helia node will be created on first use
    } else if (config.url) {
      this.provider = 'kubo';
      // Lazy initialization - client will be created on first use
    } else {
      throw new Error(
        'No IPFS provider configured. Specify url (Kubo RPC), embeddedHeliaEnabled, pinataEnabled, or filecoinPinEnabled.'
      );
    }
  }

  /**
   * Initialize Kubo RPC client (lazy, only when needed)
   */
  private async _ensureKubo(): Promise<void> {
    if (this.provider === 'kubo' && !this.kubo && this.config.url) {
      const { create } = await import('kubo-rpc-client');
      // `create` accepts a URL string (e.g., "http://localhost:5001") and resolves the API path.
      this.kubo = create(this.config.url);
    }
  }

  /**
   * Initialize embedded Helia node (lazy, only when needed)
   */
  private async _ensureHelia(): Promise<void> {
    if (this.provider === 'helia' && !this.helia) {
      const [{ createHelia }, { unixfs }, { CID }] = await Promise.all([
        import('helia'),
        import('@helia/unixfs'),
        import('multiformats/cid'),
      ]);

      this.helia = await createHelia();
      this.heliaFs = unixfs(this.helia);
      this.CID = CID;
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
  private async _pinToPinata(data: string, fileName: string = 'file.json'): Promise<string> {
    const url = 'https://uploads.pinata.cloud/v3/files';
    const headers = {
      Authorization: `Bearer ${this.config.pinataJwt}`,
    };

    // Create a Blob from the data
    const blob = new Blob([data], { type: 'application/json' });
    const formData = new FormData();
    formData.append('file', blob, fileName);
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
  private async _pinToKubo(data: string): Promise<string> {
    await this._ensureKubo();
    if (!this.kubo) throw new Error('No Kubo RPC client available');
    const result = await this.kubo.add(data);
    return result.cid.toString();
  }

  private async _addToHelia(data: string): Promise<string> {
    await this._ensureHelia();
    if (!this.heliaFs) throw new Error('No Helia UnixFS available');
    const bytes = new TextEncoder().encode(data);
    const cid = await this.heliaFs.addBytes(bytes);
    return cid.toString();
  }

  /**
   * Add data to IPFS and return CID
   */
  async add(data: string, fileName?: string): Promise<string> {
    try {
      if (this.provider === 'pinata') {
        return await this._pinToPinata(data, fileName);
      } else if (this.provider === 'filecoinPin') {
        return await this._pinToFilecoin(data);
      } else if (this.provider === 'kubo') {
        return await this._pinToKubo(data);
      } else {
        return await this._addToHelia(data);
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Add file to IPFS and return CID
   * Note: This method works in Node.js environments. For browser, use add() with file content directly.
   */
  async addFile(filepath: string, fileName?: string): Promise<string> {
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
      return this._pinToPinata(data, fileName);
    } else if (this.provider === 'filecoinPin') {
      return this._pinToFilecoin(filepath);
    } else if (this.provider === 'kubo') {
      await this._ensureKubo();
      if (!this.kubo) throw new Error('No Kubo RPC client available');
      const fileContent = fs.readFileSync(filepath);
      const result = await this.kubo.add(fileContent);
      return result.cid.toString();
    } else {
      await this._ensureHelia();
      if (!this.heliaFs) throw new Error('No Helia UnixFS available');
      const fileContent = fs.readFileSync(filepath);
      const cid = await this.heliaFs.addBytes(fileContent);
      return cid.toString();
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
    }

    if (this.provider === 'kubo') {
      await this._ensureKubo();
      if (!this.kubo) throw new Error('No Kubo RPC client available');

      const chunks: Uint8Array[] = [];
      for await (const chunk of this.kubo.cat(cid) as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      return this._decodeChunks(chunks);
    }

    await this._ensureHelia();
    if (!this.heliaFs || !this.CID) throw new Error('No Helia UnixFS available');
    const parsed = this.CID.parse(cid);
    const chunks: Uint8Array[] = [];
    for await (const chunk of this.heliaFs.cat(parsed) as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return this._decodeChunks(chunks);
  }

  private _decodeChunks(chunks: Uint8Array[]): string {
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder().decode(result);
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
    }

    if (this.provider === 'kubo') {
      await this._ensureKubo();
      if (!this.kubo) throw new Error('No Kubo RPC client available');
      const maybe = this.kubo.pin.add(cid) as unknown;
      if (maybe && typeof maybe === 'object' && Symbol.asyncIterator in (maybe as any)) {
        for await (const _ of maybe as AsyncIterable<unknown>) {
          // drain
        }
      } else {
        await maybe;
      }
      return { pinned: [cid] };
    }

    await this._ensureHelia();
    if (!this.helia || !this.CID) throw new Error('No Helia node available');
    for await (const _ of this.helia.pins.add(this.CID.parse(cid))) {
      // drain
    }
    return { pinned: [cid] };
  }

  /**
   * Unpin a CID from local node
   */
  async unpin(cid: string): Promise<{ unpinned: string[] }> {
    if (this.provider === 'filecoinPin') {
      // Filecoin Pin doesn't support unpinning in the same way
      return { unpinned: [cid] };
    }

    if (this.provider === 'kubo') {
      await this._ensureKubo();
      if (!this.kubo) throw new Error('No Kubo RPC client available');
      const maybe = this.kubo.pin.rm(cid) as unknown;
      if (maybe && typeof maybe === 'object' && Symbol.asyncIterator in (maybe as any)) {
        for await (const _ of maybe as AsyncIterable<unknown>) {
          // drain
        }
      } else {
        await maybe;
      }
      return { unpinned: [cid] };
    }

    await this._ensureHelia();
    if (!this.helia || !this.CID) throw new Error('No Helia node available');
    for await (const _ of this.helia.pins.rm(this.CID.parse(cid))) {
      // drain
    }
    return { unpinned: [cid] };
  }

  /**
   * Add JSON data to IPFS and return CID
   */
  async addJson(data: Record<string, unknown>, fileName?: string): Promise<string> {
    const jsonStr = JSON.stringify(data, null, 2);
    return this.add(jsonStr, fileName);
  }

  /**
   * Add registration file to IPFS and return CID
   */
  async addRegistrationFile(
    registrationFile: RegistrationFile,
    chainId?: number,
    identityRegistryAddress?: string
  ): Promise<string> {
    const data = buildErc8004RegistrationJson(registrationFile, {
      chainId,
      identityRegistryAddress,
    });
    return this.addJson(data, 'agent-registration.json');
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
    if (this.helia) {
      await this.helia.stop();
    }
    this.kubo = undefined;
    this.heliaFs = undefined;
    this.helia = undefined;
    this.CID = undefined;
  }
}

