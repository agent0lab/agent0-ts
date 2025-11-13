# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent0 SDK is a TypeScript SDK for agentic economies, enabling agents to register on-chain (using ERC-8004), advertise capabilities, and exchange reputation signals. It uses blockchain infrastructure (Ethereum), decentralized storage (IPFS via Pinata/Filecoin), and subgraph indexing (The Graph) for permissionless discovery.

**Current Status:** Alpha v0.21 - not production ready, actively being tested and improved.

## Common Commands

### Build & Development
```bash
npm run build              # Compile TypeScript (runs codegen first)
npm run build:watch        # Watch mode for development
npm run codegen            # Generate TypeScript types from GraphQL schema (requires ../subgraph/schema.graphql)
npm run clean              # Remove dist directory
```

### Testing
```bash
npm test                   # Run all tests with Jest
npm run test:watch         # Run tests in watch mode
npm run test:coverage      # Generate coverage report
```

**Test Configuration Notes:**
- Tests run sequentially (`maxWorkers: 1`) to avoid nonce conflicts during blockchain operations
- Test timeout is 120 seconds (blockchain operations can be slow)
- Tests require environment variables in `.env` file (see tests/config.ts)
- Test setup is in `tests/setup.ts`

### Code Quality
```bash
npm run lint               # Lint source code with ESLint
npm run format             # Format code with Prettier
```

## Storage Options

The SDK supports three storage backends for agent registrations and feedback:

### IPFS (Decentralized Storage)
- **When to use:** Default choice, good for temporary/updatable data
- **Enable:** Configure `ipfs` in SDK config (Pinata, Filecoin Pin, or local node)
- **URI format:** `ipfs://Qm...`
- **Pros:** Flexible, widely supported, can update via re-pinning
- **Cons:** Requires pinning service or local node maintenance

### Arweave (Permanent Storage)
- **When to use:** Feedback, reputation data, permanent agent records
- **Enable:** Set `arweave: true` in SDK config
- **URI format:** `ar://txId`
- **Pros:**
  - Permanent, immutable storage (no re-pinning needed)
  - Free for files <100KB (typical agent registrations are 1-10KB)
  - Cryptographically signed tags enable rich queries
  - Immediate availability via Turbo optimistic caching
- **Cons:** Immutable (cannot update, must upload new version)
- **Use:** `await agent.registerArweave()` instead of `agent.registerIPFS()`

### HTTP/HTTPS (Centralized Storage)
- **When to use:** Custom hosting, enterprise deployments
- **Enable:** Use `agent.registerHTTP(customUri)`
- **URI format:** `https://example.com/agent.json`

### Storage Priority for Feedback

When both Arweave and IPFS are configured, **Arweave takes priority** for feedback storage:
1. **Arweave** (tried first) - Permanent storage for reputation data
2. **IPFS** (fallback) - If Arweave fails
3. **On-chain only** - If no storage clients configured

This ensures feedback is permanently stored and immutable.

## Architecture

### Core Module Structure

The SDK follows a layered architecture centered around the `SDK` class (src/core/sdk.ts):

**1. SDK (Main Entry Point)**
- Orchestrates all operations
- Manages lazy initialization of registry contracts (Identity, Reputation, Validation)
- Handles IPFS client setup (Pinata, Filecoin, or local node)
- Coordinates between Web3, IPFS, and Subgraph clients

**2. Agent (src/core/agent.ts)**
- Represents individual agent instances with mutable state
- Manages agent lifecycle: create → configure endpoints → register on-chain
- Handles two registration flows:
  - **IPFS flow**: Register without URI → upload to IPFS → set URI on-chain (preferred)
  - **HTTP flow**: Register with custom HTTP URI
- Tracks "dirty" metadata to optimize gas usage (only update changed fields)
- Auto-crawls MCP/A2A endpoints to extract capabilities

**3. Client Layer**
- **Web3Client** (src/core/web3-client.ts): Ethereum interactions, contract calls, transaction handling
- **IPFSClient** (src/core/ipfs-client.ts): IPFS operations via Pinata, Filecoin, or local node
- **ArweaveClient** (src/core/arweave-client.ts): Arweave operations via ArDrive Turbo SDK (permanent storage)
- **SubgraphClient** (src/core/subgraph-client.ts): Query The Graph for agent discovery and search

**4. Supporting Components**
- **EndpointCrawler** (src/core/endpoint-crawler.ts): Fetches MCP tools/prompts/resources and A2A skills from endpoints (JSON-RPC + fallback to agentcard.json)
- **FeedbackManager** (src/core/feedback-manager.ts): Handles reputation/feedback operations
- **AgentIndexer** (src/core/indexer.ts): Advanced search combining on-chain and off-chain data

### Key Concepts

**Agent Registration Flow:**
1. Create agent in memory with `sdk.createAgent()`
2. Configure endpoints: `setMCP()`, `setA2A()`, `setENS()`, `setAgentWallet()`
3. Set trust models and metadata
4. Register on-chain:
   - `agent.registerIPFS()` - IPFS storage (default)
   - `agent.registerArweave()` - Permanent Arweave storage
   - `agent.registerHTTP(uri)` - Custom HTTP URI

**RegistrationFile vs AgentSummary:**
- `RegistrationFile`: Mutable off-chain agent configuration (name, description, endpoints, metadata)
- `AgentSummary`: Read-only indexed agent data from subgraph (for discovery/search)

**Endpoint Types:**
- MCP: Model Context Protocol servers (tools, prompts, resources)
- A2A: Agent-to-Agent protocol (skills via agentcard.json)
- ENS: Ethereum Name Service
- WALLET: Agent wallet addresses in eip155 format

**Agent ID Format:** `chainId:tokenId` (e.g., "11155111:123")

### Data Flow Patterns

**Write Operations (require signer):**
SDK → Web3Client → Smart Contract → Transaction → Receipt

**Read Operations (subgraph preferred):**
SDK → SubgraphClient → The Graph API → Indexed data

**IPFS Operations:**
SDK → IPFSClient → Pinata/Filecoin/Node → CID → ipfs:// URI

**Arweave Operations:**
SDK → ArweaveClient → Turbo SDK → EthereumSigner → ar://txId URI
- Parallel gateway retrieval on read (4 gateways queried simultaneously)
- Automatic tagging for searchability (12+ metadata tags per upload)

### Contract Registries (ERC-8004)

Three main registries (addresses in src/core/contracts.ts):
- **IdentityRegistry**: Agent minting, ownership, metadata
- **ReputationRegistry**: Feedback and reputation signals
- **ValidationRegistry**: Future validation support

Contracts are lazily initialized when first accessed via `sdk.getIdentityRegistry()`, etc.

## Development Patterns

**Endpoint Crawling:**
When setting MCP or A2A endpoints with `autoFetch: true` (default), the SDK automatically crawls the endpoint to extract capabilities. This uses soft-fail pattern - failures don't block registration.

**Transaction Handling:**
- Default 30-second timeout for transaction confirmation
- Timeouts don't fail operations - transaction is sent and will eventually confirm
- Use `sdk.web3Client.waitForTransaction(txHash, timeout)` for custom timeout

**Metadata Updates:**
Agent class tracks "dirty" metadata fields to minimize gas costs. Only changed metadata is sent on-chain during updates.

**URI Loading:**
The SDK supports multiple URI schemes with automatic protocol detection:
- `ipfs://` - Loaded via IPFS client or HTTP gateways (parallel fallback)
- `ar://` - Loaded via Arweave client or HTTP gateways (parallel fallback)
- `http://` / `https://` - Direct HTTP fetch
- Empty URI - Agent registered but not yet configured

All storage protocols use **parallel gateway fetching** for resilience - the first successful response is returned.

## Environment Configuration

Tests and examples require environment variables (create `.env` in project root):

```bash
CHAIN_ID=11155111                    # Ethereum Sepolia testnet
RPC_URL=https://...                  # Ethereum RPC endpoint
AGENT_PRIVATE_KEY=0x...             # Private key for agent operations (also used for Arweave by default)
ARWEAVE_PRIVATE_KEY=0x...           # Optional: Separate EVM key for Arweave (defaults to AGENT_PRIVATE_KEY)
PINATA_JWT=eyJ...                   # Optional: Pinata JWT for IPFS
SUBGRAPH_URL=https://...            # The Graph subgraph endpoint
```

See `tests/config.ts` for configuration loading and defaults.

**Note:** Arweave uses EVM private keys (not Arweave JWK) via the ArDrive Turbo SDK's EthereumSigner.

## Code Generation

GraphQL types are generated from subgraph schema:
- **Source:** `../subgraph/schema.graphql` (subgraph repo must be cloned at `../subgraph`)
- **Output:** `src/models/generated/subgraph-types.ts`
- **Command:** `npm run codegen` (automatically runs before build)
- **Configuration:** `codegen.yml`
- **Required:** Subgraph repo must be present for codegen to work

If you see codegen errors, ensure:
```bash
# Subgraph repo should be one directory up
ls ../subgraph/schema.graphql
# Should show the schema file
```

## Important Notes

- SDK works in read-only mode without signer (search, getAgent, etc.)
- Write operations require private key in SDK config
- Currently supports Ethereum Sepolia only (chainId: 11155111)
- Agent ownership is based on ERC-721 token ownership
- Feedback storage priority: Arweave → IPFS → on-chain only
- Arweave uploads <100KB are free (typical agent files are 1-10KB)
- All gateways use parallel fetching for resilience (first successful response wins)

## Arweave Integration Details

### Tagging System

Every Arweave upload includes 12+ cryptographically signed tags:
- `Content-Type`: application/json
- `App-Name`: Agent0-v0.2.1
- `Protocol`: ERC-8004
- `Data-Type`: agent-registration or agent-feedback
- `Chain-Id`: 11155111
- `Agent-Id`: chainId:tokenId (if registered)
- `Has-MCP`: true/false
- `Has-A2A`: true/false
- `Has-Wallet`: true/false
- `Active`: true/false
- `Timestamp`: ISO 8601 with milliseconds
- `Schema-Version`: 1.0

These tags enable Arweave-native GraphQL queries for discovery.

### Gateway Configuration

Four Arweave gateways are queried in parallel (see `src/utils/constants.ts`):
- arweave.net (official)
- turbo-gateway.com (Turbo optimistic caching)
- ar-io-gateway.nethermind.dev
- ar-io-gateway.svc.blacksand.xyz

The SDK returns the first successful response for speed and reliability.

### Race Condition Prevention

The SDK prevents concurrent registrations via `_registrationInProgress` guard:
```typescript
const p1 = agent.registerArweave();
const p2 = agent.registerArweave(); // ← Throws error immediately
// Error: Registration already in progress
```

This prevents double uploads and wasted Arweave credits.
