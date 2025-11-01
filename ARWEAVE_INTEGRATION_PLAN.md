# Arweave Storage Integration - Final Implementation Plan

## Executive Summary

Add Arweave permanent storage to Agent0 SDK via separate `ArweaveClient` class, using ArDrive Turbo SDK for uploads and parallel gateway fallback for resilient retrieval. Zero breaking changes, immediate data availability, production-ready resilience with architectural consistency to IPFS implementation.

---

## Core Principles

1. **No Code Duplication** - Extract shared ERC-8004 formatting utility
2. **Clear Separation** - ArweaveClient parallel to IPFSClient, not mixed
3. **Parallel Gateway Pattern** - Match IPFS implementation for consistency
4. **Resilient by Design** - Multi-gateway fallback with immediate availability
5. **Developer Clarity** - "Arweave" naming, implementation details abstracted

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
 * Arweave client for permanent storage using Turbo SDK and parallel gateway retrieval.
 * Uploads via ArDrive Turbo SDK, retrieves via multiple AR.IO gateways with parallel fallback.
 * Uses the same pattern as IPFSClient for architectural consistency.
 */

import { TurboFactory, EthereumSigner } from '@ardrive/turbo-sdk';
import type { RegistrationFile } from '../models/interfaces';
import { formatRegistrationFileForStorage } from '../utils/registration-format';
import { ARWEAVE_GATEWAYS, TIMEOUTS } from '../utils/constants';

export interface ArweaveClientConfig {
  privateKey: string;              // EVM private key (NOT Arweave JWK)
  token?: string;                  // Payment token: 'ethereum' | 'pol' | 'solana' | 'base-eth'
  testnet?: boolean;               // Use testnet endpoints for development
}

export class ArweaveClient {
  private config: ArweaveClientConfig;
  private turbo: any;              // TurboFactory authenticated instance

  constructor(config: ArweaveClientConfig) {
    this.config = config;
    this._initializeTurbo();
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
      // Error handling for upload failures
      // Note: Turbo provides free uploads for files <100KB, so typical agent
      // registrations (1-10KB) and feedback (<1KB) won't require credits
      if (error.message?.includes('credit') ||
          error.message?.includes('balance') ||
          error.message?.includes('insufficient')) {
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

    const gateways = ARWEAVE_GATEWAYS.map(gateway => `${gateway}/${txId}`);

    // Try all gateways in parallel - use the first successful response
    // (Same pattern as IPFSClient.get() for consistency)
    const promises = gateways.map(async (gateway) => {
      try {
        const response = await fetch(gateway, {
          redirect: 'follow',  // Required for Arweave security sandboxing
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

    throw new Error(
      `Failed to retrieve data from all Arweave gateways. Transaction ID: ${txId}`
    );
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
  arweave?: boolean;              // Enable Arweave storage
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
        // Use Arweave client if available (parallel gateway fallback)
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
 * Data is immediately available via Turbo's optimistic caching
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
      'Set arweave: true in SDK config.'
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
 * Arweave gateway URLs for parallel fallback retrieval
 */
export const ARWEAVE_GATEWAYS = [
  'https://arweave.net',
  'https://turbo-gateway.com',
  'https://ario-gateway.nethermind.dev',
  'https://ar-io-gateway.svc.blacksand.xyz',
] as const;

/**
 * Timeout values in milliseconds
 */
export const TIMEOUTS = {
  IPFS_GATEWAY: 10000,       // 10 seconds
  PINATA_UPLOAD: 80000,      // 80 seconds
  ARWEAVE_GATEWAY: 10000,    // 10 seconds (parallel gateway requests)
  ARWEAVE_UPLOAD: 100000,    // 100 seconds (Turbo upload + settlement)
  TRANSACTION_WAIT: 30000,   // 30 seconds
  ENDPOINT_CRAWLER_DEFAULT: 5000, // 5 seconds
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
    // Mock fetch for gateway requests
    // Test that ar:// prefix is stripped correctly
  });

  it('should use parallel gateway fallback on retrieval', async () => {
    // Mock fetch to simulate multiple gateways
    // Verify Promise.allSettled pattern is used
  });
});
```

**7.3 Integration Tests**

**New file**: `tests/registration-arweave.test.ts`

```typescript
import { SDK } from '../src/index';
import { CHAIN_ID, RPC_URL, AGENT_PRIVATE_KEY } from './config';

describe('Agent Registration with Arweave', () => {
  let sdk: SDK;
  let agentId: string;

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
      'Testing permanent Arweave storage',
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
    expect(reloadedAgent.description).toBe('Testing permanent Arweave storage');
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
npm test   # All tests including integration (agent files are <100KB, no cost)
```

**Note**: Agent registration files are typically 1-4KB, well under Turbo's 100KB free tier. Integration tests can run in CI without cost concerns.

---

### Phase 8: Documentation

**8.1 Update README.md**

Add new section after IPFS documentation:

```markdown
## Arweave Permanent Storage

Agent0 SDK supports permanent Arweave storage using ArDrive Turbo SDK for uploads and parallel gateway fallback for resilient data retrieval.

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

### Usage Example

```typescript
// Create agent
const agent = sdk.createAgent(
  'My AI Agent',
  'Agent with permanent Arweave storage'
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

### Storage Characteristics

**Data Availability:**
1. **Upload**: Turbo SDK uploads to Arweave, returns transaction ID
2. **Immediate Cache**: Data cached for instant access
3. **Background Settlement**: Data settles to Arweave network (~2-5 min, transparent)
4. **Retrieval**: Parallel gateway fallback ensures resilience

**File Sizes:**
- Agent registrations: 1-4 KB (typical), up to ~10 KB (large MCP servers)
- Feedback files: 0.5-1 KB (typical)
- Turbo provides free uploads for files <100 KB (covers typical agent use cases)

**For Large Files or High Volume:**
Credits can be purchased at [turbo.ardrive.io](https://turbo.ardrive.io) with ETH, MATIC, SOL, or other supported tokens.

### Storage Model Comparison

| Aspect | IPFS | Arweave |
|--------|------|---------|
| **Permanence** | Requires active pinning | Native to protocol |
| **Cost Structure** | Recurring (pinning service) | Per-upload (under 100KB free via Turbo) |
| **Retrieval** | Gateway-dependent | Multi-gateway parallel fallback |
| **Mutability** | Content-addressed (immutable) | Transaction-based (immutable) |
| **Registration Method** | `registerIPFS()` | `registerArweave()` |
| **URI Format** | `ipfs://{cid}` | `ar://{txId}` |
```

**8.2 Update CLAUDE.md**

Add section on Arweave integration:

```markdown
## Arweave Storage Integration

### Architecture Decision: Separate ArweaveClient

Created `ArweaveClient` as separate class parallel to `IPFSClient` to maintain clear protocol separation. Arweave is a fundamentally different storage layer (permanent blockchain) vs IPFS (distributed pinning).

### Key Components

- **ArweaveClient** (`src/core/arweave-client.ts`) - Handles Arweave uploads and retrieval
- **Turbo SDK** - Uploads with immediate availability via optimistic caching
- **Parallel Gateway Fallback** - Same pattern as IPFS for architectural consistency
- **Shared Utility** (`src/utils/registration-format.ts`) - DRY principle for ERC-8004 formatting

### Retrieval Pattern: Parallel Gateway Fallback

Uses the same pattern as `IPFSClient.get()` for consistency:
- Tries all 4 gateways simultaneously with `Promise.allSettled()`
- Returns first successful response
- 10-second timeout per gateway (parallel, so max 10s total)
- Gateways: arweave.net, turbo-gateway.com, ario-gateway.nethermind.dev, ar-io-gateway.svc.blacksand.xyz

**Why parallel instead of sequential:**
- Architectural consistency with IPFS implementation
- Fastest possible response (cached gateways win automatically)
- Simple, proven pattern (no new abstractions)
- Easy for contributors to understand

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

### File Size Characteristics

**Typical agent registration files:**
- Basic agent (name, description, 2-3 endpoints): ~1 KB
- Agent with MCP tools (10-20 tools): ~1-2 KB
- Large MCP server (50+ tools): ~3-4 KB
- Maximum realistic size (100+ tools, extensive metadata): ~10 KB

**Feedback files:**
- Basic feedback (score + tags): ~0.3-0.5 KB
- Rich feedback (with context, proof of payment): ~0.5-1 KB

**Cost Implications:**
- Turbo SDK provides free uploads for files <100 KB
- Agent registrations and feedback are typically well under this limit
- Credits only needed for edge cases (files >100 KB) or high volume operations
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
- [ ] Implement parallel gateway fallback (matching IPFS pattern)
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
- [ ] Update `src/utils/constants.ts` with gateways and timeouts
- [ ] Update `src/index.ts` exports
- [ ] Update `src/utils/index.ts` exports
- [ ] Update `package.json` dependencies
- [ ] Run `npm install`

### Testing
- [ ] Write unit tests for `registration-format.ts`
- [ ] Write unit tests for `ArweaveClient` (mocked)
- [ ] Write integration tests (optional, requires Turbo setup)
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
- [ ] Manual integration test (optional, with Turbo)

---

## Summary

### Files Created (3)
- `src/utils/registration-format.ts` - Shared ERC-8004 formatting
- `src/core/arweave-client.ts` - Arweave storage client
- `tests/registration-arweave.test.ts` - Integration tests

### Files Modified (7)
- `src/core/ipfs-client.ts` - Use shared utility
- `src/core/sdk.ts` - Arweave config and ar:// handling
- `src/core/agent.ts` - Add registerArweave() method
- `src/utils/constants.ts` - Add Arweave gateways and timeouts
- `src/index.ts` - Export ArweaveClient
- `src/utils/index.ts` - Export registration-format
- `package.json` - Add dependency

### Dependencies Added (1)
- `@ardrive/turbo-sdk` - Arweave uploads with immediate availability

### Breaking Changes
**None** - All changes are additive and optional

### Key Benefits
✅ Permanent storage with immediate availability
✅ Parallel gateway fallback for resilience
✅ Zero code duplication (shared utility)
✅ Architectural consistency with IPFS
✅ Simple, proven pattern (no new abstractions)
✅ Only 1 new dependency

### Trade-offs
- Parallel requests use more bandwidth (4 concurrent requests per retrieval)
- For 1-10KB files, this is negligible
- Can optimize to sequential if telemetry shows it's needed

---

## Next Steps

After approval, implementation will proceed in the order outlined above, starting with the shared utility to eliminate duplication before adding new functionality.
