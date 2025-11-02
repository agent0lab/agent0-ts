/**
 * Agent0 TypeScript SDK
 * Main entry point - exports public API
 */

// Export models
export * from './models/index';

// Export utilities
export * from './utils/index';

// Export core classes
export { SDK } from './core/sdk';
export type { SDKConfig } from './core/sdk';
export { Agent } from './core/agent';
export { Web3Client } from './core/web3-client';
export type { TransactionOptions } from './core/web3-client';
export { IPFSClient } from './core/ipfs-client';
export type { IPFSClientConfig } from './core/ipfs-client';
export { ArweaveClient } from './core/arweave-client';
export type { ArweaveClientConfig } from './core/arweave-client';
export { SubgraphClient } from './core/subgraph-client';
export { FeedbackManager } from './core/feedback-manager';
export { EndpointCrawler } from './core/endpoint-crawler';
export type { McpCapabilities, A2aCapabilities } from './core/endpoint-crawler';
export { AgentIndexer } from './core/indexer';

// Export contract definitions
export * from './core/contracts';

