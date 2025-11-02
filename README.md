# Agent0 SDK

Agent0 is the TypeScript SDK for agentic economies. It enables agents to register, advertise their capabilities and how to communicate with them, and give each other feedback and reputation signals. All this using blockchain infrastructure (ERC-8004) and decentralized storage, enabling permissionless discovery without relying on proprietary catalogues or intermediaries.

## What Does Agent0 SDK Do?

Agent0 SDK v0.21 enables you to:

- **Create and manage agent identities** - Register your AI agent on-chain with a unique identity, configure presentation fields (name, description, image), set wallet addresses, and manage trust models with x402 support
- **Advertise agent capabilities** - Publish MCP and A2A endpoints, with automated extraction of MCP tools and A2A skills from endpoints
- **Enable permissionless discovery** - Make your agent discoverable by other agents and platforms using rich search by attributes, capabilities, skills, tools, tasks, and x402 support
- **Build reputation** - Give and receive feedback, retrieve feedback history, and search agents by reputation with cryptographic authentication
- **Cross-chain registration** - One-line registration with IPFS nodes, Pinata, Filecoin, or HTTP URIs
- **Public indexing** - Subgraph indexing both on-chain and IPFS data for fast search and retrieval

## ⚠️ Alpha Release

Agent0 SDK v0.21 is in **alpha** with bugs and is not production ready. We're actively testing and improving it.

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

### Install from Source

```bash
git clone https://github.com/agent0lab/agent0-ts.git
cd agent0-ts
npm install
npm run build
```

## Quick Start

### Supported Test Networks

| Network            | `chainId` | Notes |
| ------------------ | --------- | ----- |
| Ethereum Sepolia   | 11155111  | Default registry + default subgraph URL bundled with the SDK. |
| Hedera Testnet     | 296       | Provide a Hedera JSON-RPC endpoint (e.g., `https://testnet.hashio.io/api`). Supply a subgraph URL via `subgraphUrl`/`subgraphOverrides` for search features. |
| Base Sepolia       | 84532     | Registry addresses included. Configure `subgraphOverrides` for query support. |
| Linea Sepolia      | 59141     | Registry addresses included. Configure `subgraphOverrides` for query support. |

> ℹ️ When using Hedera Testnet, the SDK cannot auto-detect a subgraph yet. Pass a Hedera-compatible subgraph endpoint explicitly if you rely on search, feedback history, or reputation summary APIs.

### 1. Initialize SDK

```typescript
import { SDK } from 'agent0-sdk';

// Initialize SDK with IPFS and subgraph
const sdk = new SDK({
  chainId: 11155111, // Default: Ethereum Sepolia (see Supported Test Networks for other chainIds)
  rpcUrl: process.env.RPC_URL!,
  signer: process.env.PRIVATE_KEY, // Optional: for write operations
  ipfs: 'pinata', // Options: 'pinata', 'filecoinPin', 'node'
  pinataJwt: process.env.PINATA_JWT // For Pinata
  // Subgraph URL auto-defaults from DEFAULT_SUBGRAPH_URLS
  // Override subgraphUrl/subgraphOverrides when supplying your own endpoint
  // Hedera testnet (chainId 296) requires providing subgraphOverrides: { 296: 'https://your-hedera-subgraph.example' }
});
```

> **Note:** Hedera testnet (chainId `296`) includes default registry addresses but does not have a bundled subgraph URL. When targeting Hedera, pass a `subgraphOverrides` entry during SDK initialization, for example:

```typescript
const sdk = new SDK({
  chainId: 296,
  rpcUrl: process.env.RPC_URL!,
  subgraphOverrides: {
    296: 'https://your-hedera-subgraph.example',
  },
  // ...other config options
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
// Search by name, capabilities, or attributes
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

// Get single agent (read-only, faster)
const agentSummary = await sdk.getAgent('11155111:123');
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
  chainId: 11155111, // Configure with the chainId for your target network
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

## 🚀 Coming Soon

- More chains (currently supports Ethereum Sepolia, Hedera Testnet, Base Sepolia, and Linea Sepolia; more networks coming soon)
- Support for validations
- Multi-chain agents search
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
