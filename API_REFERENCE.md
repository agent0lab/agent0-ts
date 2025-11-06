# TypeScript SDK API Reference

Complete function signature reference for the Agent0 TypeScript SDK.

## SDK Class (`SDK`)

### Constructor
```typescript
constructor(config: SDKConfig)

interface SDKConfig {
  chainId: ChainId;
  rpcUrl: string;
  signer?: string; // Private key for signing transactions (optional for read-only operations)
  registryOverrides?: Record<ChainId, Record<string, Address>>;
  // IPFS configuration
  ipfs?: 'node' | 'filecoinPin' | 'pinata';
  ipfsNodeUrl?: string;
  filecoinPrivateKey?: string;
  pinataJwt?: string;
  // Arweave configuration
  arweave?: boolean;
  arweavePrivateKey?: string;
  // Subgraph configuration
  subgraphUrl?: string;
  subgraphOverrides?: Record<ChainId, string>;
}
```

### Chain & Registry Methods
```typescript
async chainId(): Promise<ChainId>
registries(): Record<string, Address>
getIdentityRegistry(): ethers.Contract
getReputationRegistry(): ethers.Contract
getValidationRegistry(): ethers.Contract
get isReadOnly(): boolean
```

### Agent Lifecycle Methods
```typescript
createAgent(name: string, description: string, image?: URI): Agent
async loadAgent(agentId: AgentId): Promise<Agent>
async getAgent(agentId: AgentId): Promise<AgentSummary | null>
```

### Discovery Methods
```typescript
async searchAgents(
  params?: SearchParams | Record<string, any>,
  sort?: string[],
  pageSize: number = 50,
  cursor?: string
): Promise<{ items: AgentSummary[]; nextCursor?: string }>

async searchAgentsByReputation(
  minAverageScore?: number,
  tags?: string[],
  capabilities?: string[],
  skills?: string[]
): Promise<{ items: AgentSummary[] }>
```

### Ownership Methods
```typescript
async transferAgent(agentId: AgentId, newOwner: Address): Promise<{
  txHash: string;
  from: Address;
  to: Address;
  agentId: AgentId;
}>

async isAgentOwner(agentId: AgentId, addressSearchParams: Address): Promise<boolean>
async getAgentOwner(agentId: AgentId): Promise<Address>
```

### Feedback Methods
```typescript
async signFeedbackAuth(
  agentId: AgentId,
  clientAddress: Address,
  indexLimit?: number,
  expiryHours: number = 24
): Promise<string>

prepareFeedback(
  agentId: AgentId,
  score?: number,
  tags?: string[],
  text?: string,
  capability?: string,
  name?: string,
  skill?: string,
  task?: string,
  context?: Record<string, any>,
  proofOfPayment?: Record<string, any>,
  extra?: Record<string, any>
): Record<string, any>

async giveFeedback(
  agentId: AgentId,
  feedbackFile: Record<string, any>,
  feedbackAuth?: string
): Promise<Feedback>

async getFeedback(agentId: AgentId, clientAddress: Address, feedbackIndex: number): Promise<Feedback>

async searchFeedback(
  agentId: AgentId,
  tags?: string[],
  capabilities?: string[],
  skills?: string[],
  minScore?: number,
  maxScore?: number
): Promise<Feedback[]>

async appendResponse(
  agentId: AgentId,
  clientAddress: Address,
  feedbackIndex: number,
  response: { uri: URI; hash: string }
): Promise<string>

async revokeFeedback(agentId: AgentId, feedbackIndex: number): Promise<string>

async getReputationSummary(
  agentId: AgentId,
  tag1?: string,
  tag2?: string
): Promise<{ count: number; averageScore: number }>
```

### Client Accessors
```typescript
get web3Client(): Web3Client
get ipfsClient(): IPFSClient | undefined
get arweaveClient(): ArweaveClient | undefined
get subgraphClient(): SubgraphClient | undefined
```

---

## Agent Class (`Agent`)

### Read-Only Properties (Getters)
```typescript
get agentId(): AgentId | undefined
get agentURI(): URI | undefined
get name(): string
get description(): string
get image(): URI | undefined
get mcpEndpoint(): string | undefined
get a2aEndpoint(): string | undefined
get ensEndpoint(): string | undefined
get walletAddress(): Address | undefined
get mcpTools(): string[] | undefined
get mcpPrompts(): string[] | undefined
get mcpResources(): string[] | undefined
get a2aSkills(): string[] | undefined
```

### Endpoint Management
```typescript
async setMCP(endpoint: string, version: string = '2025-06-18', autoFetch: boolean = true): Promise<this>
async setA2A(agentcard: string, version: string = '0.30', autoFetch: boolean = true): Promise<this>
setENS(name: string, version: string = '1.0'): this
setAgentWallet(address: Address, chainId: number): this
```

### Status & Configuration
```typescript
setActive(active: boolean): this
setX402Support(x402Support: boolean): this
setTrust(
  reputation: boolean = false,
  cryptoEconomic: boolean = false,
  teeAttestation: boolean = false
): this
```

### Metadata Management
```typescript
setMetadata(kv: Record<string, any>): this
getMetadata(): Record<string, any>
delMetadata(key: string): this
```

### Agent Information
```typescript
updateInfo(name?: string, description?: string, image?: URI): this
getRegistrationFile(): RegistrationFile
```

### Registration Methods
```typescript
async registerIPFS(): Promise<RegistrationFile>
async registerArweave(): Promise<RegistrationFile>
async registerHTTP(agentUri: string): Promise<RegistrationFile>
async setAgentUri(agentUri: string): Promise<void>
```

### Transfer
```typescript
async transfer(newOwner: Address): Promise<{
  txHash: string;
  from: Address;
  to: Address;
  agentId: AgentId;
}>
```

---

## Utility Functions

### ID Format Utilities (`utils/id-format.ts`)
```typescript
function parseAgentId(agentId: string | null | undefined): { chainId: number informe; tokenId: number }
function formatAgentId(chainId: number, tokenId: number): string
function parseFeedbackId(feedbackId: string): {
  agentId: string;
  clientAddress: string;
  feedbackIndex: number;
}
function formatFeedbackId(
  agentId: string,
  clientAddress: string,
  feedbackIndex: number
): string
```

---

## Type Definitions

### Core Types (`models/types.ts`)
```typescript
type AgentId = string; // Format: "chainId:tokenId"
type ChainId = number;
type Address = string; // Ethereum address (0x-hex format)
type URI = string; // https://..., ipfs://..., or ar://...
type CID = string; // IPFS CID
type Timestamp = number; // Unix timestamp in seconds
type IdemKey = string; // Idempotency key for write operations
```

### Enums (`models/enums.ts`)
```typescript
enum EndpointType {
  MCP = 'MCP',
  A2A = 'A2A',
  ENS = 'ENS',
  DID = 'DID',
  WALLET = 'wallet',
}

enum TrustModel {
  REPUTATION = 'reputation',
  CRYPTO_ECONOMIC = 'crypto-economic',
  TEE_ATTESTATION = 'tee-attestation',
那一
```

### Interfaces (`models/interfaces.ts`)
```typescript
interface Endpoint {
  type: EndpointType;
  value: string;
  meta?: Record<string, any>;
}

interface RegistrationFile {
  agentId?: AgentId;
  agentURI?: URI;
  name: string;
  description: string;
  image?: URI;
  walletAddress?: Address;
  walletChainId?: number;
  endpoints: Endpoint[];
  trustModels: (TrustModel | string)[];
  owners: Address[];
  operators: Address[];
  active: boolean;
  x402support: boolean;
  metadata: Record<string, any>;
  updatedAt: Timestamp;
}

interface AgentSummary {
  chainId: number;
  agentId: AgentId;
  name: string;
  image?: URI;
  description: string;
  owners: Address[];
  operators: Address[];
  mcp: boolean;
  a2a: boolean;
  ens?: string;
  did?: string;
  walletAddress?: Address;
  supportedTrusts: string[];
  a2aSkills: string[];
  mcpTools: string[];
  mcpPrompts: string[];
  mcpResources: string[];
  active: boolean;
  x402support: boolean;
  extras: Record<string, any>;
}

interface Feedback {
  id: FeedbackIdTuple; // [AgentId, Address, number]
  agentId: AgentId;
  reviewer: Address;
  score?: number; // 0-100
  tags: string[];
  text?: string;
  context?: Record<string, any>;
  proofOfPayment?: Record<string, any>;
  fileURI?: URI;
  createdAt: Timestamp;
  answers: Array<Record<string, any>>;
  isRevoked: boolean;
  // Off-chain only fields
  capability?: string;
  name?: string;
  skill?: string;
  task?: string;
}

type FeedbackIdTuple = [AgentId, Address, number];
type FeedbackId = string; // Format: "agentId:clientAddress:feedbackIndex"

interface SearchParams {
  chains?: number[];
  name?: string;
  description?: string;
  owners?: Address[];
  operators?: Address[];
  mcp?: boolean;
  a2a?: boolean;
  ens?: string;
  did?: string;
  walletAddress?: Address;
  supportedTrust?: string[];
  a2aSkills?: string[];
  mcpTools?: string[];
  mcpPrompts?: string[];
  mcpResources?: string[];
  active?: boolean;
  x402support?: boolean;
}

interface SearchFeedbackParams {
  agents?: AgentId[];
  tags?: string[];
  reviewers?: Address[];
  capabilities?: string[];
  skills?: string[];
  tasks?: string[];
  names?: string[];
  minScore?: number;
  maxScore?: number;
  includeRevoked?: boolean;
}
```

---

## Notes

- All methods marked with `async` return `Promise<T>` and must be awaited
- `Agent` methods that return `this` support method chaining
- `getAgent()` returns `null` if agent not found (requires subgraph)
- `revokeFeedback()` automatically uses the signer's address as the client address
- `getReputationSummary()` returns only `count` and `averageScore` (no `totalFeedback` or `scoreDistribution`)
- `searchAgentsByReputation()` has different signature than Python - uses positional params instead of named params

