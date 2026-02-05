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
export { ViemChainClient } from './core/viem-chain-client.js';
export type { ChainClient, TransactionOptions } from './core/chain-client.js';
export { IPFSClient } from './core/ipfs-client.js';
export type { IPFSClientConfig } from './core/ipfs-client.js';
export { SubgraphClient } from './core/subgraph-client.js';
export { FeedbackManager } from './core/feedback-manager.js';
export { EndpointCrawler } from './core/endpoint-crawler.js';
export type { McpCapabilities, A2aCapabilities } from './core/endpoint-crawler.js';
export { AgentIndexer } from './core/indexer.js';
export { TransactionHandle } from './core/transaction-handle.js';
export type { TransactionMined, TransactionWaitOptions } from './core/transaction-handle.js';

// Export contract definitions
export * from './core/contracts.js';

// Export OASF taxonomies
export {
  OASF_SKILLS,
  OASF_DOMAINS,
  OASF_SKILL_SLUGS,
  OASF_DOMAIN_SLUGS,
  OASF_VERSION,
} from './taxonomies/index.js';
