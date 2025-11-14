# Release Notes - Agent0 TypeScript SDK v0.3rc1

## 🎉 Multi-Chain Support

This release introduces comprehensive multi-chain support, allowing you to query and interact with agents across multiple blockchain networks simultaneously.

## What's New

### Multi-Chain Functionality

The SDK now supports querying agents across multiple chains in a single operation. This enables:
- **Cross-chain agent discovery**: Find agents deployed on different networks
- **Unified search interface**: Search across all supported chains with one call
- **Chain-agnostic agent IDs**: Use `chainId:agentId` format to specify which chain an agent is on

### Supported Networks

The SDK currently supports the following testnet networks:

- **Ethereum Sepolia** (Chain ID: `11155111`)
- **Base Sepolia** (Chain ID: `84532`)
- **Polygon Amoy** (Chain ID: `80002`)

Each network has its own subgraph endpoint and contract addresses configured automatically.

## Default Chain

When you initialize the SDK, you specify a **default chain**:

```typescript
import { SDK } from 'agent0-sdk';

// Initialize SDK with Ethereum Sepolia as default chain
const sdk = new SDK({
  chainId: 11155111,  // This becomes the default chain
  rpcUrl: 'https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY'
});
```

The default chain is used when:
1. You provide an `agentId` without a `chainId` prefix (e.g., `"1234"` instead of `"11155111:1234"`)
2. You call functions without specifying a chain parameter
3. The SDK needs to determine which chain to query for operations

**Example:**
```typescript
// Uses default chain (11155111)
const agent = await sdk.getAgent('1234');  // Equivalent to "11155111:1234"

// Explicitly specify a different chain
const agent = await sdk.getAgent('84532:1234');  // Base Sepolia
```

## Multi-Chain Functions

The following functions now support multi-chain operations:

### 1. `getAgent(agentId)`

Retrieves a single agent by ID, supporting both default chain and explicit chain specification.

**Usage:**
```typescript
// Using default chain
const agent = await sdk.getAgent('1234');  // Uses SDK's default chain

// Explicitly specify chain
const agent = await sdk.getAgent('84532:1234');  // Base Sepolia
const agent = await sdk.getAgent('80002:5678');  // Polygon Amoy
```

**Agent ID Format:**
- `"agentId"` - Uses SDK's default chain
- `"chainId:agentId"` - Uses the specified chain (e.g., `"84532:1234"`)

### 2. `searchAgents(params, sort, pageSize, cursor)`

Searches for agents across one or more chains with filters.

**Usage:**
```typescript
// Single chain (uses SDK's default chain)
const result = await sdk.searchAgents({ active: true });

// Single specific chain
const result = await sdk.searchAgents({ 
  active: true, 
  chains: [84532]  // Base Sepolia
});

// Multiple chains
const result = await sdk.searchAgents({ 
  active: true, 
  chains: [11155111, 84532]  // ETH Sepolia and Base Sepolia
});

// All supported chains
const result = await sdk.searchAgents({ 
  active: true, 
  chains: 'all'  // Searches all configured chains
});
```

**Response Format:**
```typescript
{
  items: AgentSummary[],  // Agents from all requested chains
  nextCursor?: string,     // Pagination cursor
  meta?: {                  // Only present for multi-chain queries
    chains: number[],       // Chains that were queried
    successfulChains: number[],  // Chains that returned results
    failedChains: number[],      // Chains that failed (if any)
    totalResults: number,    // Total agents found
    timing: {
      totalMs: number,      // Total query time in milliseconds
      averagePerChainMs?: number  // Average time per chain
    }
  }
}
```

**Parameters:**
- `params.chains`: 
  - `undefined` (default) - Uses SDK's default chain
  - `[chainId1, chainId2, ...]` - List of specific chain IDs to search
  - `"all"` - Searches all configured chains in parallel

### 3. `searchAgentsByReputation(..., chains?)`

Searches for agents filtered by reputation criteria across one or more chains.

**Usage:**
```typescript
// Single chain (uses SDK's default chain)
const result = await sdk.searchAgentsByReputation(
  undefined, // agents
  undefined, // tags
  undefined, // reviewers
  undefined, // capabilities
  undefined, // skills
  undefined, // tasks
  undefined, // names
  80, // minAverageScore
  false, // includeRevoked
  20, // pageSize
  undefined, // cursor
  undefined, // sort
  undefined // chains - uses default
);

// Single specific chain
const result = await sdk.searchAgentsByReputation(
  undefined, undefined, undefined, undefined, undefined, undefined, undefined,
  80, false, 20, undefined, undefined,
  [84532]  // Base Sepolia
);

// Multiple chains
const result = await sdk.searchAgentsByReputation(
  undefined, undefined, undefined, undefined, undefined, undefined, undefined,
  80, false, 20, undefined, undefined,
  [11155111, 84532]  // ETH Sepolia and Base Sepolia
);

// All supported chains
const result = await sdk.searchAgentsByReputation(
  undefined, undefined, undefined, undefined, undefined, undefined, undefined,
  80, false, 20, undefined, undefined,
  'all'  // Searches all configured chains
);
```

**Response Format:**
```typescript
{
  items: AgentSummary[],  // Agents from all requested chains
  nextCursor?: string,     // Pagination cursor
  meta?: {                  // Only present for multi-chain queries
    chains: number[],       // Chains that were queried
    successfulChains: number[],  // Chains that returned results
    failedChains: number[],      // Chains that failed (if any)
    totalResults: number,    // Total agents found
    timing: {
      totalMs: number,      // Total query time in milliseconds
      averagePerChainMs?: number  // Average time per chain
    }
  }
}
```

**Parameters:**
- `chains`: 
  - `undefined` (default) - Uses SDK's default chain
  - `[chainId1, chainId2, ...]` - List of specific chain IDs to search
  - `"all"` - Searches all configured chains in parallel

### 4. `searchFeedback(agentId, ...)`

Searches for feedback entries for a specific agent, supporting both default chain and explicit chain specification.

**Usage:**
```typescript
// Using default chain
const feedbacks = await sdk.searchFeedback('1234');

// Explicitly specify chain
const feedbacks = await sdk.searchFeedback('84532:1234');  // Base Sepolia
```

**Parameters:**
- `agentId`: Agent ID in format `"agentId"` (default chain) or `"chainId:agentId"` (specific chain)
- All other parameters work the same as before

### 5. `getReputationSummary(agentId, tag1?, tag2?)`

Gets reputation summary for an agent, supporting both default chain and explicit chain specification.

**Usage:**
```typescript
// Using default chain
const summary = await sdk.getReputationSummary('1234');

// Explicitly specify chain
const summary = await sdk.getReputationSummary('84532:1234');  // Base Sepolia
```

**Response:**
```typescript
{
  count: number,        // Number of feedback entries
  averageScore: number  // Average score (0-100)
}
```

### 6. `getSubgraphClient(chainId?)`

Get a subgraph client for a specific chain. Useful for advanced use cases.

**Usage:**
```typescript
// Get client for default chain
const client = sdk.getSubgraphClient();

// Get client for specific chain
const baseClient = sdk.getSubgraphClient(84532);
```

## Technical Details

### Parallel Query Execution

When searching across multiple chains, the SDK:
1. Executes subgraph queries for all chains in parallel using `Promise.allSettled()`
2. Applies a 30-second timeout per chain query
3. Aggregates results from successful chains
4. Applies cross-chain filtering and sorting
5. Returns metadata about which chains succeeded or failed

### Error Handling

- If some chains fail, the SDK returns results from successful chains
- If all chains fail, an error is returned with metadata about failures
- Timeout errors are handled gracefully, allowing other chains to complete

### Backward Compatibility

✅ **100% Backward Compatible** - All existing code continues to work unchanged:
- Single-chain queries work exactly as before
- Agent IDs without `chainId:` prefix use the SDK's default chain
- No breaking changes to existing APIs

## Files Modified

1. **src/core/contracts.ts** - Added Polygon Amoy and Base Sepolia registry addresses and subgraph URLs
2. **src/models/interfaces.ts** - Updated `SearchParams` to support `chains?: ChainId[] | 'all'` and added `SearchResultMeta` interface
3. **src/core/indexer.ts** - Added multi-chain search logic with parallel query execution, including `_searchAgentsByReputationAcrossChains()` method
4. **src/core/sdk.ts** - Added `getSubgraphClient()` method and updated `getAgent()`, `searchAgents()`, and `searchAgentsByReputation()` for multi-chain support
5. **src/core/feedback-manager.ts** - Updated `searchFeedback()` and `getReputationSummary()` to support `chainId:agentId` format
6. **tests/multi-chain.test.ts** - Comprehensive test suite matching Python SDK's test coverage

## Upgrade Instructions

```bash
npm install agent0-sdk@0.3.0-rc.1
```

## Migration Guide

### From v0.2.4 to v0.3rc1

**No breaking changes!** All existing code continues to work without modification.

**New capabilities:**
1. Use `chainId:agentId` format for any function that accepts `agentId`
2. Use `chains` parameter in `searchAgentsByReputation()` to search multiple chains
3. Use `chains="all"` to search all configured chains
4. Use `chainId:agentId` format in `searchFeedback()` and `getReputationSummary()`

**Example migration:**
```typescript
// Before (v0.2.4) - only default chain
const agent = await sdk.getAgent('1234');
const result = await sdk.searchAgentsByReputation(undefined, undefined, undefined, undefined, undefined, undefined, undefined, 80);

// After (v0.3rc1) - multi-chain support
const agent = await sdk.getAgent('84532:1234');  // Explicit chain
const result = await sdk.searchAgentsByReputation(
  undefined, undefined, undefined, undefined, undefined, undefined, undefined,
  80, false, 20, undefined, undefined,
  [11155111, 84532]  // Multiple chains
);
```

## Known Limitations

- Deduplication across chains is currently disabled (can be enabled in future versions)
- Timeout is fixed at 30 seconds (configurable timeout may be added in future)

## Testing

A comprehensive test suite is included in `tests/multi-chain.test.ts` that covers:
- Multi-chain agent retrieval
- Multi-chain feedback search
- Multi-chain reputation search (single, multiple, and "all" chains)
- Reputation summary across chains
- Chain-agnostic agent ID format support

Run tests with:
```bash
npm test -- tests/multi-chain.test.ts
```

## Next Steps

- Test multi-chain queries with your use case
- Report any issues or feedback
- All multi-chain features are now fully implemented and tested

