# Agent0 SDK

Agent0 is the TypeScript SDK for agentic economies. It enables agents to register, advertise their capabilities and how to communicate with them, and give each other feedback and reputation signals. All this using blockchain infrastructure (ERC-8004) and decentralized storage, enabling permissionless discovery without relying on proprietary catalogues or intermediaries.

## What Does Agent0 SDK Do?

Agent0 SDK v0.31 enables you to:

- **Create and manage agent identities** - Register your AI agent on-chain with a unique identity, configure presentation fields (name, description, image), set wallet addresses, and manage trust models with x402 support
- **Advertise agent capabilities** - Publish MCP and A2A endpoints, with automated extraction of MCP tools and A2A skills from endpoints
- **OASF taxonomies** - Advertise standardized skills and domains using the Open Agentic Schema Framework (OASF) taxonomies for better discovery and interoperability
- **Enable permissionless discovery** - Make your agent discoverable by other agents and platforms using rich search by attributes, capabilities, skills, tools, tasks, and x402 support
- **Build reputation** - Give and receive feedback, retrieve feedback history, and search agents by reputation with cryptographic authentication
- **Cross-chain registration** - One-line registration with IPFS nodes, Pinata, Filecoin, or HTTP URIs
- **Public indexing** - Subgraph indexing both on-chain and IPFS data for fast search and retrieval

## ⚠️ Alpha Release

Agent0 SDK v0.31 is in **alpha** with bugs and is not production ready. We're actively testing and improving it.

**Bug reports & feedback:** GitHub: [Report issues](https://github.com/agent0lab/agent0-ts/issues) | Telegram: [@marcoderossi](https://t.me/marcoderossi) | Email: marco.derossi@consensys.net

## Installation

### Prerequisites

- Node.js 18 or higher
- npm or yarn package manager
- Private key for signing transactions (or run in read-only mode)
- Access to an Ethereum RPC endpoint (e.g., Alchemy, Infura)
- (Optional) IPFS provider account (Pinata, Filecoin, or local IPFS node)

### Install from npm

```bash
npm install agent0-sdk
```

**Note:** This package is an ESM (ECMAScript Module) package. Use `import` statements in your code:

```typescript
import { SDK } from 'agent0-sdk';
```

### Install from Source

```bash
git clone https://github.com/agent0lab/agent0-ts.git
cd agent0-ts
npm install
npm run build
```

**Note:** The generated TypeScript types are created automatically during `npm install` (via `postinstall` hook) or manually with `npm run codegen`. Always use `npm run build` instead of running `tsc` directly.

## Quick Start

### 1. Initialize SDK

```typescript
import { SDK } from 'agent0-sdk';

// Initialize SDK with IPFS and subgraph
const sdk = new SDK({
  chainId: 11155111, // Ethereum Sepolia testnet
  rpcUrl: process.env.RPC_URL!,
  signer: process.env.PRIVATE_KEY, // Optional: for write operations
  ipfs: 'pinata', // Options: 'pinata', 'filecoinPin', 'node'
  pinataJwt: process.env.PINATA_JWT // For Pinata
  // Subgraph URL auto-defaults from DEFAULT_SUBGRAPH_URLS
});
```

### 2. Create and Register Agent

```typescript
// Create agent
const agent = sdk.createAgent(
  'My AI Agent',
  'An intelligent assistant for various tasks. Skills: data analysis, code generation.',
  'https://example.com/agent-image.png'
);

// Configure endpoints (automatically extracts capabilities)
await agent.setMCP('https://mcp.example.com/'); // Extracts tools, prompts, resources
await agent.setA2A('https://a2a.example.com/agent-card.json'); // Extracts skills
agent.setENS('myagent.eth');

// Add OASF skills and domains (standardized taxonomies)
agent.addSkill('data_engineering/data_transformation_pipeline', true);
agent.addSkill('natural_language_processing/summarization', true);
agent.addDomain('finance_and_business/investment_services', true);
agent.addDomain('technology/data_science', true);

// Configure wallet and trust
agent.setAgentWallet('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb', 11155111);
agent.setTrust(true, true, false); // reputation, cryptoEconomic, teeAttestation

// Add metadata and set status
agent.setMetadata({ version: '1.0.0', category: 'ai-assistant' });
agent.setActive(true);

// Register on-chain with IPFS
const registrationFile = await agent.registerIPFS();
console.log(`Agent registered: ${registrationFile.agentId}`); // e.g., "11155111:123"
console.log(`Agent URI: ${registrationFile.agentURI}`); // e.g., "ipfs://Qm..."
```

### 3. Load and Edit Agent

```typescript
// Load existing agent for editing
const agent = await sdk.loadAgent('11155111:123'); // Format: "chainId:agentId"

// Edit agent properties
agent.updateInfo(undefined, 'Updated description with new capabilities', undefined);
await agent.setMCP('https://new-mcp.example.com/');

// Re-register to update on-chain
await agent.registerIPFS();
console.log(`Updated: ${agent.agentURI}`);
```

### 4. Search Agents

```typescript
// Search by name, capabilities, or attributes (single chain)
const results = await sdk.searchAgents({
  name: 'AI', // Substring search
  mcpTools: ['code_generation'], // Specific MCP tools
  a2aSkills: ['python'], // Specific A2A skills
  active: true, // Only active agents
  x402support: true // Payment support
});

for (const agent of results.items) {
  console.log(`${agent.name}: ${agent.description}`);
  console.log(`  Tools: ${agent.mcpTools?.join(', ')}`);
  console.log(`  Skills: ${agent.a2aSkills?.join(', ')}`);
}

// Multi-chain search
const multiChainResults = await sdk.searchAgents({
  active: true,
  chains: [11155111, 84532, 80002] // ETH Sepolia, Base Sepolia, Polygon Amoy
  // Or use 'all' to search all configured chains: chains: 'all'
});

console.log(`Found ${multiChainResults.items.length} agents across chains`);
if (multiChainResults.meta) {
  console.log(`Successful chains: ${multiChainResults.meta.successfulChains.join(', ')}`);
}

// Get single agent (read-only, faster)
// Supports chainId:agentId format
const agentSummary = await sdk.getAgent('11155111:123'); // Default chain
const baseAgent = await sdk.getAgent('84532:123'); // Base Sepolia
```

### 4a. Multi-Chain Search

```typescript
// Search across multiple chains
const results = await sdk.searchAgents({
  active: true,
  chains: [11155111, 84532] // ETH Sepolia and Base Sepolia
});

// Search all configured chains
const allResults = await sdk.searchAgents({
  active: true,
  chains: 'all' // Searches all configured chains
});

// Search agents by reputation across chains
const reputationResults = await sdk.searchAgentsByReputation(
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
  [11155111, 84532] // chains
);

// Get agent from specific chain
const agent = await sdk.getAgent('84532:123'); // Base Sepolia

// Search feedback for agent on specific chain
const feedbacks = await sdk.searchFeedback('84532:123'); // Base Sepolia

// Get reputation summary for agent on specific chain
const summary = await sdk.getReputationSummary('84532:123'); // Base Sepolia
```

### 5. Give and Retrieve Feedback

```typescript
// Prepare feedback (only score is mandatory)
const feedbackFile = sdk.prepareFeedback(
  '11155111:123',
  85, // 0-100 (mandatory)
  ['data_analyst', 'finance'], // Optional: tags
  undefined, // Optional: text
  'tools', // Optional: capability (MCP capability)
  'code_generation', // Optional: name (MCP tool name)
  'python' // Optional: skill (A2A skill)
);

// Give feedback
const feedback = await sdk.giveFeedback('11155111:123', feedbackFile);

// Search feedback
const feedbackResults = await sdk.searchFeedback(
  '11155111:123',
  undefined, // tags
  ['tools'], // capabilities
  undefined, // skills
  80, // minScore
  100 // maxScore
);

// Get reputation summary
const summary = await sdk.getReputationSummary('11155111:123');
console.log(`Average score: ${summary.averageScore}`);
```

## IPFS Configuration Options

```typescript
// Option 1: Filecoin Pin (free for ERC-8004 agents)
const sdk = new SDK({
  chainId: 11155111,
  rpcUrl: '...',
  signer: privateKey,
  ipfs: 'filecoinPin',
  filecoinPrivateKey: 'your-filecoin-private-key'
});

// Option 2: IPFS Node
const sdk = new SDK({
  chainId: 11155111,
  rpcUrl: '...',
  signer: privateKey,
  ipfs: 'node',
  ipfsNodeUrl: 'https://ipfs.infura.io:5001'
});

// Option 3: Pinata (free for ERC-8004 agents)
const sdk = new SDK({
  chainId: 11155111,
  rpcUrl: '...',
  signer: privateKey,
  ipfs: 'pinata',
  pinataJwt: 'your-pinata-jwt-token'
});

// Option 4: HTTP registration (no IPFS)
const sdk = new SDK({ chainId: 11155111, rpcUrl: '...', signer: privateKey });
await agent.registerHTTP('https://example.com/agent-registration.json');
```

## Multi-Chain Support

The SDK supports querying agents across multiple blockchain networks:

- **Ethereum Sepolia** (Chain ID: `11155111`)
- **Base Sepolia** (Chain ID: `84532`)
- **Polygon Amoy** (Chain ID: `80002`)

### Chain-Agnostic Agent IDs

Use `chainId:agentId` format to specify which chain an agent is on:

```typescript
// Get agent from specific chain
const agent = await sdk.getAgent('84532:1234');  // Base Sepolia

// Search feedback for agent on specific chain
const feedbacks = await sdk.searchFeedback('84532:1234');  // Base Sepolia
const feedbacksDefault = await sdk.searchFeedback('1234');  // Uses default chain

// Get reputation summary for agent on specific chain
const summary = await sdk.getReputationSummary('84532:1234');  // Base Sepolia
const summaryDefault = await sdk.getReputationSummary('1234');  // Uses default chain
```

### Multi-Chain Search

Search across multiple chains simultaneously:

```typescript
// Search across multiple chains
const result = await sdk.searchAgents({
  active: true,
  chains: [11155111, 84532]  // ETH Sepolia and Base Sepolia
});

// Search all configured chains
const allChainsResult = await sdk.searchAgents({
  active: true,
  chains: 'all'  // Searches all configured chains
});

// Multi-chain reputation search
const reputationResult = await sdk.searchAgentsByReputation(
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
  [11155111, 84532]  // Multiple chains
);

// Search all chains for agents with reputation
const allChainsReputation = await sdk.searchAgentsByReputation(
  undefined, undefined, undefined, undefined, undefined, undefined, undefined,
  80, false, 20, undefined, undefined,
  'all'  // All configured chains
);

// Access metadata about queried chains
if (result.meta) {
  console.log(`Queried chains: ${result.meta.chains.join(', ')}`);
  console.log(`Successful: ${result.meta.successfulChains.join(', ')}`);
  console.log(`Failed: ${result.meta.failedChains.join(', ')}`);
  console.log(`Total results: ${result.meta.totalResults}`);
  console.log(`Query time: ${result.meta.timing.totalMs}ms`);
}
```

### Default Chain Behavior

When you initialize the SDK, you specify a default chain. Agent IDs without a `chainId:` prefix use the default chain:

```typescript
const sdk = new SDK({
  chainId: 11155111,  // Default chain
  rpcUrl: 'https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY'
});

// Uses default chain (11155111)
const agent = await sdk.getAgent('1234');  // Equivalent to "11155111:1234"

// Explicitly specify different chain
const agent = await sdk.getAgent('84532:1234');  // Base Sepolia
```

## OASF Taxonomies

The SDK includes support for the **Open Agentic Schema Framework (OASF)** taxonomies, enabling agents to advertise standardized skills and domains. This improves discoverability and interoperability across agent platforms.

### Adding Skills and Domains

```typescript
// Add OASF skills (with optional validation)
agent.addSkill('advanced_reasoning_planning/strategic_planning', true);
agent.addSkill('data_engineering/data_transformation_pipeline', true);

// Add OASF domains (with optional validation)
agent.addDomain('finance_and_business/investment_services', true);
agent.addDomain('technology/data_science/data_visualization', true);

// Remove skills/domains
agent.removeSkill('old_skill');
agent.removeDomain('old_domain');
```

### OASF in Registration Files

OASF skills and domains appear in your agent's registration file:

```json
{
  "endpoints": [
    {
      "name": "OASF",
      "endpoint": "https://github.com/agntcy/oasf/",
      "version": "v0.8.0",
      "skills": [
        "advanced_reasoning_planning/strategic_planning",
        "data_engineering/data_transformation_pipeline"
      ],
      "domains": [
        "finance_and_business/investment_services",
        "technology/data_science"
      ]
    }
  ]
}
```

### Taxonomy Files

The SDK includes complete OASF v0.8.0 taxonomy files:
- **Skills**: `src/taxonomies/all_skills.json` (136 skills)
- **Domains**: `src/taxonomies/all_domains.json` (204 domains)

Browse these files to find appropriate skill and domain slugs. For more information, see the [OASF specification](https://github.com/agntcy/oasf) and [Release Notes v0.31](RELEASE_NOTES_0.31.md).

## 🚀 Coming Soon

- Support for validations
- Enhanced x402 payments
- Semantic/Vectorial search
- Advanced reputation aggregation
- Import/Export to centralized catalogues

## Examples

Complete working examples are available in the `examples/` directory:

- `quick-start.ts` - Basic agent creation and registration
- `agent-update.ts` - Agent registration with IPFS
- `feedback-usage.ts` - Complete feedback flow with IPFS storage
- `search-agents.ts` - Agent search and discovery
- `transfer-agent.ts` - Agent ownership transfer

## Documentation

Full documentation is available at [sdk.ag0.xyz](https://sdk.ag0.xyz), including:

- [Installation Guide](https://sdk.ag0.xyz/2-usage/2-1-install/)
- [Agent Configuration](https://sdk.ag0.xyz/2-usage/2-2-configure-agents/)
- [Registration](https://sdk.ag0.xyz/2-usage/2-3-registration-ipfs/)
- [Search](https://sdk.ag0.xyz/2-usage/2-5-search/)
- [Feedback](https://sdk.ag0.xyz/2-usage/2-6-use-feedback/)
- [Key Concepts](https://sdk.ag0.xyz/1-welcome/1-2-key-concepts/)
- [API Reference](https://sdk.ag0.xyz/5-reference/5-1-sdk/)

## License

Agent0 SDK is MIT-licensed public good brought to you by Marco De Rossi in collaboration with Consensys, 🦊 MetaMask and Agent0, Inc. We are looking for co-maintainers. Please reach out if you want to help.

Thanks also to Edge & Node (The Graph), Protocol Labs and Pinata for their support.
