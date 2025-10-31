# Arweave Storage Integration - Final Implementation Plan

## Executive Summary

Add Arweave permanent storage to Agent0 SDK via separate `ArweaveClient` class, using ArDrive Turbo SDK for uploads and AR.IO Wayfinder for resilient retrieval. Zero breaking changes, immediate data availability, production-ready resilience.

---

## Core Principles

1. **No Code Duplication** - Extract shared ERC-8004 formatting utility
2. **Clear Separation** - ArweaveClient parallel to IPFSClient, not mixed
3. **Optimize for Turbo** - Prefer arweave.net (optimistic cache) via Wayfinder
4. **Resilient by Design** - Wayfinder + emergency fallback
5. **Developer Clarity** - "Arweave" naming, AR.IO as implementation detail

---

## Implementation Phases

### Phase 1: Foundation - Shared Utility (DRY Principle)

**1.1 Create Shared Utility**

**New file**: `src/utils/registration-format.ts`

```typescript
import type { RegistrationFile, Endpoint } from '../models/interfaces';

/**
 * Format RegistrationFile to ERC-8004 compliant storage format.
 * Used by both IPFSClient and ArweaveClient to ensure consistency.
 */
export function formatRegistrationFileForStorage(
  registrationFile: RegistrationFile,
  chainId?: number,
  identityRegistryAddress?: string
): Record<string, unknown> {
  // Transform endpoints to ERC-8004 format
  const endpoints: Array<Record<string, unknown>> = [];
  for (const ep of registrationFile.endpoints) {
    const endpointDict: Record<string, unknown> = {
      name: ep.type,
      endpoint: ep.value,
    };

    if (ep.meta) {
      Object.assign(endpointDict, ep.meta);
    }

    endpoints.push(endpointDict);
  }

  // Add wallet as endpoint if present
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

  // Build ERC-8004 compliant data
  return {
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
}
```

**1.2 Refactor IPFSClient to Use Utility**

**Modify**: `src/core/ipfs-client.ts`

Replace the logic in `addRegistrationFile()` method (lines ~305-362) with:

```typescript
import { formatRegistrationFileForStorage } from '../utils/registration-format';

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

  return this.addJson(data);
}
```

**Validation**: Run existing tests to ensure refactor doesn't break IPFS functionality.

---

### Phase 2: ArweaveClient Implementation

**New file**: `src/core/arweave-client.ts`

```typescript
/**
 * Arweave client for permanent storage using Turbo SDK and AR.IO Network.
 * Uploads via ArDrive Turbo SDK, retrieves via AR.IO Wayfinder with intelligent routing.
 */

import { TurboFactory, EthereumSigner } from '@ardrive/turbo-sdk';
import {
  createWayfinderClient,
  PreferredWithFallbackRoutingStrategy,
  TrustedPeersRoutingStrategy
} from '@ar.io/wayfinder-core';
import type { RegistrationFile } from '../models/interfaces';
import { formatRegistrationFileForStorage } from '../utils/registration-format';
import { TIMEOUTS } from '../utils/constants';

export interface ArweaveClientConfig {
  privateKey: string;              // EVM private key (NOT Arweave JWK)
  token?: string;                  // Payment token: 'ethereum' | 'pol' | 'solana' | 'base-eth'
  testnet?: boolean;               // Use testnet endpoints for development
}

export class ArweaveClient {
  private config: ArweaveClientConfig;
  private turbo: any;              // TurboFactory authenticated instance
  private wayfinder: any;          // Wayfinder client

  constructor(config: ArweaveClientConfig) {
    this.config = config;
    this._initializeTurbo();
    this._initializeWayfinder();
  }

  /**
   * Initialize Turbo SDK with EVM signer for uploads
   */
  private async _initializeTurbo() {
    const signer = new EthereumSigner(this.config.privateKey);

    const turboConfig = {
      signer,
      token: this.config.token || 'ethereum',
      ...(this.config.testnet && {
        paymentServiceConfig: { url: 'https://payment.ardrive.dev' },
        uploadServiceConfig: { url: 'https://upload.ardrive.dev' }
      })
    };

    this.turbo = TurboFactory.authenticated(turboConfig);
  }

  /**
   * Initialize Wayfinder with PreferredWithFallback strategy.
   * Prefers arweave.net (where Turbo uploads are cached) with fallback to AR.IO Network peers.
   */
  private _initializeWayfinder() {
    this.wayfinder = createWayfinderClient({
      routingStrategy: new PreferredWithFallbackRoutingStrategy({
        preferred: 'https://arweave.net',  // Turbo's optimistic cache
        fallback: new TrustedPeersRoutingStrategy()  // AR.IO Network gateways
      })
    });
  }

  /**
   * Upload data to Arweave via Turbo SDK.
   * Data is immediately available on arweave.net via optimistic caching
   * while settling to Arweave network in the background.
   *
   * @param data - String data to upload
   * @returns Arweave transaction ID
   */
  async add(data: string): Promise<string> {
    try {
      const result = await this.turbo.upload({
        data: Buffer.from(data, 'utf-8')
      });
      return result.id; // Arweave transaction ID
    } catch (error: any) {
      // Enhanced error handling for credit/payment failures
      if (error.message?.includes('credit') ||
          error.message?.includes('balance') ||
          error.message?.includes('insufficient')) {
        throw new Error(
          'Insufficient Turbo credits for Arweave upload. ' +
          'Please top up at https://turbo.ardrive.io. ' +
          `Details: ${error.message}`
        );
      }
      throw new Error(`Arweave upload failed: ${error.message}`);
    }
  }

  /**
   * Upload JSON data to Arweave
   */
  async addJson(data: Record<string, unknown>): Promise<string> {
    const jsonStr = JSON.stringify(data, null, 2);
    return this.add(jsonStr);
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

    return this.addJson(data);
  }

  /**
   * Retrieve data from Arweave using AR.IO Network.
   * Uses Wayfinder to route requests to healthy gateways, preferring arweave.net
   * (where Turbo uploads are optimistically cached).
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

    try {
      // Primary: Wayfinder with PreferredWithFallback routing
      const response = await this.wayfinder.request(`ar://${txId}`);
      return await response.text();
    } catch (error: any) {
      // Emergency fallback: Direct arweave.net fetch
      // Only reached if Wayfinder itself fails (rare)
      try {
        const response = await fetch(`https://arweave.net/${txId}`, {
          redirect: 'follow',  // Required for Arweave security sandboxing
          signal: AbortSignal.timeout(TIMEOUTS.ARWEAVE_GATEWAY)
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return await response.text();
      } catch (fallbackError: any) {
        throw new Error(
          `Failed to retrieve data from Arweave. Transaction ID: ${txId}. ` +
          `Wayfinder error: ${error.message}. ` +
          `Fallback error: ${fallbackError.message}`
        );
      }
    }
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
    // No explicit cleanup needed for Turbo or Wayfinder
    // Included for API consistency
  }
}
```

---

### Phase 3: SDK Integration

**3.1 Update SDK Configuration**

**Modify**: `src/core/sdk.ts`

Add to SDKConfig interface:
```typescript
export interface SDKConfig {
  chainId: ChainId;
  rpcUrl: string;
  signer?: string;
  registryOverrides?: Record<ChainId, Record<string, Address>>;

  // IPFS configuration
  ipfs?: 'node' | 'filecoinPin' | 'pinata';
  ipfsNodeUrl?: string;
  filecoinPrivateKey?: string;
  pinataJwt?: string;

  // Arweave configuration (NEW)
  arweave?: boolean;              // Enable Arweave/AR.IO storage
  arweavePrivateKey?: string;     // Optional separate EVM key (defaults to signer)
  arweaveToken?: string;          // Payment token (default: 'ethereum')
  arweaveTestnet?: boolean;       // Use testnet endpoints

  // Subgraph configuration
  subgraphUrl?: string;
  subgraphOverrides?: Record<ChainId, string>;
}
```

**3.2 Update SDK Class**

Add ArweaveClient to SDK:
```typescript
import { ArweaveClient } from './arweave-client';

export class SDK {
  private readonly _web3Client: Web3Client;
  private _ipfsClient?: IPFSClient;
  private _arweaveClient?: ArweaveClient;  // NEW
  private _subgraphClient?: SubgraphClient;
  // ... rest unchanged

  constructor(config: SDKConfig) {
    this._chainId = config.chainId;
    this._web3Client = new Web3Client(config.rpcUrl, config.signer);

    // ... existing initialization

    // Initialize IPFS client (unchanged)
    if (config.ipfs) {
      this._ipfsClient = this._initializeIpfsClient(config);
    }

    // Initialize Arweave client (NEW)
    if (config.arweave) {
      this._arweaveClient = this._initializeArweaveClient(config);
    }

    // ... rest unchanged
  }

  /**
   * Initialize Arweave client with EVM signer
   */
  private _initializeArweaveClient(config: SDKConfig): ArweaveClient {
    const privateKey = config.arweavePrivateKey || config.signer;

    if (!privateKey) {
      throw new Error(
        'Arweave storage requires an EVM private key. ' +
        'Provide signer or arweavePrivateKey in SDK config.'
      );
    }

    return new ArweaveClient({
      privateKey,
      token: config.arweaveToken,
      testnet: config.arweaveTestnet
    });
  }

  /**
   * Get Arweave client (if configured)
   */
  get arweaveClient(): ArweaveClient | undefined {
    return this._arweaveClient;
  }
}
```

**3.3 Add ar:// URI Handler**

Update `_loadRegistrationFile()` method in SDK:
```typescript
private async _loadRegistrationFile(tokenUri: string): Promise<RegistrationFile> {
  try {
    let rawData: unknown;

    if (tokenUri.startsWith('ipfs://')) {
      // ... existing IPFS handling unchanged

    } else if (tokenUri.startsWith('ar://')) {
      // NEW: Handle Arweave URIs
      const txId = tokenUri.slice(5);

      if (this._arweaveClient) {
        // Use Arweave client if available
        rawData = await this._arweaveClient.getJson(txId);
      } else {
        // Fallback: Direct gateway access without client
        const response = await fetch(`https://arweave.net/${txId}`, {
          redirect: 'follow',
          signal: AbortSignal.timeout(TIMEOUTS.ARWEAVE_GATEWAY)
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch from Arweave: HTTP ${response.status}`);
        }

        rawData = await response.json();
      }

    } else if (tokenUri.startsWith('http://') || tokenUri.startsWith('https://')) {
      // ... existing HTTP handling unchanged

    } else if (tokenUri.startsWith('data:')) {
      // ... existing error unchanged

    } else if (!tokenUri || tokenUri.trim() === '') {
      // ... existing empty handling unchanged

    } else {
      throw new Error(`Unsupported URI scheme: ${tokenUri}`);
    }

    // ... rest unchanged (validation and transformation)
  }
}
```

---

### Phase 4: Agent Registration Method

**Modify**: `src/core/agent.ts`

Add new `registerArweave()` method:

```typescript
/**
 * Register agent on-chain with Arweave permanent storage.
 * Data is immediately available via Turbo's optimistic caching on arweave.net
 * while settling to Arweave network in the background.
 *
 * @returns Updated registration file with ar:// URI
 */
async registerArweave(): Promise<RegistrationFile> {
  // Validate basic requirements
  if (!this.registrationFile.name || !this.registrationFile.description) {
    throw new Error('Agent must have name and description before registration');
  }

  if (!this.sdk.arweaveClient) {
    throw new Error(
      'Arweave client not configured. ' +
      'Set arweave: true in SDK config and ensure you have Turbo credits.'
    );
  }

  if (this.registrationFile.agentId) {
    // Update existing agent
    const chainId = await this.sdk.chainId();
    const identityRegistryAddress = await this.sdk.getIdentityRegistry().getAddress();

    // Upload to Arweave
    const txId = await this.sdk.arweaveClient.addRegistrationFile(
      this.registrationFile,
      chainId,
      identityRegistryAddress
    );

    // Update metadata on-chain if changed
    if (this._dirtyMetadata.size > 0) {
      try {
        await this._updateMetadataOnChain();
      } catch (error) {
        // Transaction sent, will eventually confirm - continue
      }
    }

    // Update agent URI on-chain to ar://{txId}
    const { tokenId } = parseAgentId(this.registrationFile.agentId);
    const txHash = await this.sdk.web3Client.transactContract(
      this.sdk.getIdentityRegistry(),
      'setAgentUri',
      {},
      BigInt(tokenId),
      `ar://${txId}`
    );

    try {
      await this.sdk.web3Client.waitForTransaction(txHash, TIMEOUTS.TRANSACTION_WAIT);
    } catch (error) {
      // Transaction sent, will eventually confirm - continue
    }

    // Clear dirty flags
    this._lastRegisteredWallet = this.walletAddress;
    this._lastRegisteredEns = this.ensEndpoint;
    this._dirtyMetadata.clear();

    this.registrationFile.agentURI = `ar://${txId}`;
    return this.registrationFile;

  } else {
    // First time registration
    await this._registerWithoutUri();

    const chainId = await this.sdk.chainId();
    const identityRegistryAddress = await this.sdk.getIdentityRegistry().getAddress();

    // Upload to Arweave
    const txId = await this.sdk.arweaveClient.addRegistrationFile(
      this.registrationFile,
      chainId,
      identityRegistryAddress
    );

    // Set agent URI on-chain
    const { tokenId } = parseAgentId(this.registrationFile.agentId!);
    const txHash = await this.sdk.web3Client.transactContract(
      this.sdk.getIdentityRegistry(),
      'setAgentUri',
      {},
      BigInt(tokenId),
      `ar://${txId}`
    );

    await this.sdk.web3Client.waitForTransaction(txHash);

    // Clear dirty flags
    this._lastRegisteredWallet = this.walletAddress;
    this._lastRegisteredEns = this.ensEndpoint;
    this._dirtyMetadata.clear();

    this.registrationFile.agentURI = `ar://${txId}`;
    return this.registrationFile;
  }
}
```

---

### Phase 5: Constants and Exports

**5.1 Update Constants**

**Modify**: `src/utils/constants.ts`

```typescript
/**
 * Timeout values in milliseconds
 */
export const TIMEOUTS = {
  IPFS_GATEWAY: 10000,
  PINATA_UPLOAD: 80000,
  ARWEAVE_GATEWAY: 15000,    // NEW: 15 seconds for Arweave gateway fetch
  ARWEAVE_UPLOAD: 120000,    // NEW: 2 minutes for Arweave upload
  TRANSACTION_WAIT: 30000,
  ENDPOINT_CRAWLER_DEFAULT: 5000,
} as const;
```

**5.2 Update Exports**

**Modify**: `src/index.ts`

```typescript
// Export core classes
export { SDK } from './core/sdk';
export type { SDKConfig } from './core/sdk';
export { Agent } from './core/agent';
export { Web3Client } from './core/web3-client';
export type { TransactionOptions } from './core/web3-client';
export { IPFSClient } from './core/ipfs-client';
export type { IPFSClientConfig } from './core/ipfs-client';
export { ArweaveClient } from './core/arweave-client';  // NEW
export type { ArweaveClientConfig } from './core/arweave-client';  // NEW
export { SubgraphClient } from './core/subgraph-client';
// ... rest unchanged
```

**Modify**: `src/utils/index.ts`

```typescript
export * from './constants';
export * from './id-format';
export * from './validation';
export * from './registration-format';  // NEW
```

---

### Phase 6: Dependencies

**Modify**: `package.json`

```json
{
  "dependencies": {
    "@ardrive/turbo-sdk": "^1.23.0",
    "@ar.io/wayfinder-core": "^1.0.0",
    "dotenv": "^16.3.1",
    "ethers": "^6.9.0",
    "graphql-request": "^6.1.0",
    "ipfs-http-client": "^60.0.1"
  }
}
```

Run: `npm install`

---

### Phase 7: Testing

**7.1 Unit Tests for Shared Utility**

**New file**: `tests/registration-format.test.ts`

```typescript
import { formatRegistrationFileForStorage } from '../src/utils/registration-format';
import type { RegistrationFile } from '../src/models/interfaces';
import { EndpointType, TrustModel } from '../src/models/enums';

describe('formatRegistrationFileForStorage', () => {
  it('should format registration file to ERC-8004 format', () => {
    const registrationFile: RegistrationFile = {
      agentId: '11155111:123',
      name: 'Test Agent',
      description: 'Test description',
      image: 'https://example.com/image.png',
      endpoints: [
        { type: EndpointType.MCP, value: 'https://mcp.example.com/', meta: { version: '2025-06-18' } }
      ],
      trustModels: [TrustModel.REPUTATION],
      owners: [],
      operators: [],
      active: true,
      x402support: false,
      metadata: {},
      updatedAt: 1234567890,
      walletAddress: '0xabc123',
      walletChainId: 1
    };

    const result = formatRegistrationFileForStorage(registrationFile, 11155111, '0xregistry');

    expect(result.type).toBe('https://eips.ethereum.org/EIPS/eip-8004#registration-v1');
    expect(result.name).toBe('Test Agent');
    expect(result.endpoints).toHaveLength(2); // MCP + wallet
    expect(result.supportedTrusts).toEqual([TrustModel.REPUTATION]);
  });
});
```

**7.2 Unit Tests for ArweaveClient** (mocked)

**New file**: `tests/arweave-client.unit.test.ts`

```typescript
import { ArweaveClient } from '../src/core/arweave-client';

// Mock external dependencies
jest.mock('@ardrive/turbo-sdk');
jest.mock('@ar.io/wayfinder-core');

describe('ArweaveClient - Unit Tests', () => {
  it('should initialize with EVM private key', () => {
    const client = new ArweaveClient({
      privateKey: '0x' + '1'.repeat(64),
      testnet: true
    });

    expect(client).toBeDefined();
  });

  it('should throw clear error for insufficient credits', async () => {
    // Mock Turbo SDK to throw credit error
    // Test that our error message enhancement works
  });

  it('should handle ar:// prefix in get()', async () => {
    // Mock Wayfinder
    // Test that ar:// prefix is stripped correctly
  });
});
```

**7.3 Integration Tests** (optional, requires credits)

**New file**: `tests/registration-arweave.test.ts`

```typescript
import { SDK } from '../src/index';
import { CHAIN_ID, RPC_URL, AGENT_PRIVATE_KEY } from './config';

describe('Agent Registration with Arweave', () => {
  let sdk: SDK;
  let agentId: string;

  beforeAll(() => {
    // Skip if no credits available
    if (!process.env.ARWEAVE_INTEGRATION_TESTS) {
      test.skip('Arweave integration tests require ARWEAVE_INTEGRATION_TESTS=true');
    }
  });

  it('should register new agent with Arweave storage', async () => {
    sdk = new SDK({
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
      signer: AGENT_PRIVATE_KEY,
      arweave: true,
      arweaveTestnet: true
    });

    const agent = sdk.createAgent(
      'Arweave Test Agent',
      'Testing permanent Arweave storage via AR.IO',
      'https://example.com/image.png'
    );

    await agent.setMCP('https://mcp.example.com/', '2025-06-18', false);
    agent.setActive(true);

    const registrationFile = await agent.registerArweave();
    agentId = registrationFile.agentId!;

    expect(agentId).toBeTruthy();
    expect(registrationFile.agentURI).toBeTruthy();
    expect(registrationFile.agentURI!.startsWith('ar://')).toBe(true);

    console.log('Agent registered:', agentId);
    console.log('Arweave URI:', registrationFile.agentURI);
  });

  it('should retrieve agent immediately from Arweave', async () => {
    // Data should be immediately available via Turbo optimistic caching
    const reloadedAgent = await sdk.loadAgent(agentId);

    expect(reloadedAgent.name).toBe('Arweave Test Agent');
    expect(reloadedAgent.description).toBe('Testing permanent Arweave storage via AR.IO');
  });

  it('should update agent on Arweave', async () => {
    const agent = await sdk.loadAgent(agentId);

    agent.updateInfo('Updated Arweave Agent', 'Updated description');
    const updated = await agent.registerArweave();

    expect(updated.agentURI!.startsWith('ar://')).toBe(true);
    expect(updated.name).toBe('Updated Arweave Agent');
  });
});
```

Run tests:
```bash
npm test                                    # Unit tests (always)
ARWEAVE_INTEGRATION_TESTS=true npm test   # Integration tests (manual)
```

---

### Phase 8: Documentation

**8.1 Update README.md**

Add new section after IPFS documentation:

```markdown
## Arweave Permanent Storage via AR.IO Network

Agent0 SDK supports permanent Arweave storage using ArDrive Turbo SDK for uploads and AR.IO Network for resilient data retrieval.

### Features

- ✅ **Permanent, immutable storage** - Pay once, store forever on Arweave
- ✅ **Immediate availability** - Data accessible instantly via Turbo's optimistic caching
- ✅ **Resilient retrieval** - Wayfinder routes to healthy AR.IO gateways automatically
- ✅ **No recurring fees** - One-time payment, no ongoing pinning costs

### Configuration

```typescript
import { SDK } from 'agent0-sdk';

const sdk = new SDK({
  chainId: 11155111,               // Ethereum Sepolia
  rpcUrl: process.env.RPC_URL!,
  signer: process.env.PRIVATE_KEY, // EVM private key (used for both web3 and Arweave)
  arweave: true,                   // Enable Arweave storage
  arweaveTestnet: true             // Use testnet for development
});
```

### Getting Turbo Credits

Turbo SDK requires credits for permanent Arweave uploads:

1. Visit [turbo.ardrive.io](https://turbo.ardrive.io)
2. Top up with ETH, MATIC, SOL, or other supported tokens
3. Credits are used for permanent Arweave storage (pay once, store forever)

### Usage Example

```typescript
// Create agent
const agent = sdk.createAgent(
  'My AI Agent',
  'Permanent agent with Arweave storage'
);

// Configure endpoints
await agent.setMCP('https://mcp.example.com/');
agent.setActive(true);

// Register on Arweave - data immediately available
const registration = await agent.registerArweave();
console.log('Agent URI:', registration.agentURI); // ar://{txId}

// Data is immediately accessible
const reloaded = await sdk.loadAgent(registration.agentId!);
console.log('Retrieved:', reloaded.name);
```

### How It Works

1. **Upload**: Turbo SDK uploads data to Arweave and returns transaction ID
2. **Immediate Cache**: Data optimistically cached on arweave.net for instant access
3. **Background Settlement**: Data settles to Arweave network (transparent, ~2-5 min)
4. **Resilient Retrieval**: Wayfinder routes to healthy AR.IO gateways (prefers arweave.net)

### IPFS vs Arweave Comparison

| Feature | IPFS (Pinata/Filecoin) | Arweave (via Turbo) |
|---------|----------------------|---------------------|
| **Storage Model** | Pinning service | Permanent blockchain |
| **Cost Model** | Recurring fees | One-time payment |
| **Availability** | Depends on pinning | Immediate via cache |
| **Permanence** | Requires active pinning | Guaranteed permanent |
| **Registration Method** | `registerIPFS()` | `registerArweave()` |
| **URI Format** | `ipfs://{cid}` | `ar://{txId}` |
```

**8.2 Update CLAUDE.md**

Add section on Arweave integration:

```markdown
## Arweave Storage Integration (via AR.IO Network)

### Architecture Decision: Separate ArweaveClient

Created `ArweaveClient` as separate class parallel to `IPFSClient` to maintain clear protocol separation. Arweave is a fundamentally different storage layer (permanent blockchain) vs IPFS (distributed pinning).

### Key Components

- **ArweaveClient** (`src/core/arweave-client.ts`) - Handles Arweave uploads and retrieval
- **Turbo SDK** - Uploads with immediate availability via optimistic caching
- **Wayfinder** - Intelligent gateway routing via AR.IO Network
- **Shared Utility** (`src/utils/registration-format.ts`) - DRY principle for ERC-8004 formatting

### Wayfinder Strategy: PreferredWithFallback

Uses `PreferredWithFallbackRoutingStrategy`:
- **Preferred**: arweave.net (where Turbo uploads are optimistically cached)
- **Fallback**: TrustedPeersRoutingStrategy (other AR.IO gateways)
- **Emergency**: Direct arweave.net fetch if Wayfinder fails

### URI Format

Arweave data uses `ar://{txId}` format:
- Transaction IDs are permanent, immutable
- ArNS not used for registration files (would be mutable)
- Parsed in SDK._loadRegistrationFile() when starts with `ar://`

### Authentication

Uses EVM private keys only (via Turbo's EthereumSigner):
- Consistent with SDK's Ethereum focus
- Reuses existing signer or allows separate key
- No Arweave JWK support needed

### Immediate Availability

Turbo SDK provides immediate data availability:
- Uploads cached optimistically on arweave.net with final TxID
- Background settlement to Arweave (transparent, ~2-5 minutes)
- No waiting required - data accessible immediately after upload
```

**8.3 Add JSDoc Comments**

Ensure all new methods have comprehensive JSDoc:
- Purpose and behavior
- Parameters with types
- Return values
- Error conditions
- Example usage
- Performance notes (immediate availability)

---

## Implementation Checklist

### Foundation
- [ ] Create `src/utils/registration-format.ts` utility
- [ ] Refactor `IPFSClient.addRegistrationFile()` to use utility
- [ ] Run tests to validate refactor

### Core Implementation
- [ ] Create `src/core/arweave-client.ts`
- [ ] Implement Turbo SDK integration
- [ ] Implement Wayfinder integration
- [ ] Add error handling for credits

### SDK Integration
- [ ] Update `SDKConfig` interface
- [ ] Add `_arweaveClient` to SDK class
- [ ] Add `_initializeArweaveClient()` method
- [ ] Update `_loadRegistrationFile()` for `ar://` URIs
- [ ] Expose `arweaveClient` getter

### Agent Method
- [ ] Add `registerArweave()` to Agent class
- [ ] Follow same structure as `registerIPFS()`
- [ ] Add clear error messages

### Infrastructure
- [ ] Update `src/utils/constants.ts` with timeouts
- [ ] Update `src/index.ts` exports
- [ ] Update `src/utils/index.ts` exports
- [ ] Update `package.json` dependencies
- [ ] Run `npm install`

### Testing
- [ ] Write unit tests for `registration-format.ts`
- [ ] Write unit tests for `ArweaveClient` (mocked)
- [ ] Write integration tests (optional, requires credits)
- [ ] Document test setup in README

### Documentation
- [ ] Update README.md with Arweave section
- [ ] Update CLAUDE.md with architecture notes
- [ ] Add JSDoc to all new methods
- [ ] Add inline code comments for critical sections

### Validation
- [ ] Run `npm run build` (verify compilation)
- [ ] Run `npm test` (unit tests pass)
- [ ] Run `npm run lint` (no linting errors)
- [ ] Manual integration test (with credits)

---

## Summary

### Files Created (3)
- `src/utils/registration-format.ts` - Shared ERC-8004 formatting
- `src/core/arweave-client.ts` - Arweave storage client
- `tests/registration-arweave.test.ts` - Integration tests

### Files Modified (6)
- `src/core/ipfs-client.ts` - Use shared utility
- `src/core/sdk.ts` - Arweave config and ar:// handling
- `src/core/agent.ts` - Add registerArweave() method
- `src/utils/constants.ts` - Add Arweave timeouts
- `src/index.ts` - Export ArweaveClient
- `package.json` - Add dependencies

### Dependencies Added (2)
- `@ardrive/turbo-sdk` - Arweave uploads
- `@ar.io/wayfinder-core` - Gateway routing

### Breaking Changes
**None** - All changes are additive and optional

### Key Benefits
✅ Permanent storage with immediate availability
✅ Intelligent gateway routing via AR.IO
✅ Zero code duplication (shared utility)
✅ Clear developer experience
✅ Production-ready resilience

---

## Next Steps

After approval, implementation will proceed in the order outlined above, starting with the shared utility to eliminate duplication before adding new functionality.
