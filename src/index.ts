/**
 * Agent0 TypeScript SDK
 * Main entry point - exports public API
 */

// Export models
export * from './models/index.js';

// Export utilities
export * from './utils/index.js';

// Export core classes
export { SDK } from './core/sdk.js';
export type { SDKConfig } from './core/sdk.js';
export { Agent } from './core/agent.js';
export { Web3Client } from './core/web3-client.js';
export type { TransactionOptions } from './core/web3-client.js';
export { IPFSClient } from './core/ipfs-client.js';
export type { IPFSClientConfig } from './core/ipfs-client.js';
export { ArweaveClient } from './core/arweave-client.js';
export type { ArweaveClientConfig } from './core/arweave-client.js';
export { SubgraphClient } from './core/subgraph-client.js';
export { FeedbackManager } from './core/feedback-manager.js';
export { EndpointCrawler } from './core/endpoint-crawler.js';
export type { McpCapabilities, A2aCapabilities } from './core/endpoint-crawler.js';
export { AgentIndexer } from './core/indexer.js';

// Export contract definitions
export * from './core/contracts.js';

