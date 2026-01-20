/**
 * Smart contract ABIs and interfaces for ERC-8004
 */

import type { ChainId } from '../models/types.js';

// ERC-721 ABI (minimal required functions)
export const ERC721_ABI = [
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'ownerOf',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'owner', type: 'address' },
      { internalType: 'address', name: 'operator', type: 'address' },
    ],
    name: 'isApprovedForAll',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'getApproved',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'from', type: 'address' },
      { internalType: 'address', name: 'to', type: 'address' },
      { internalType: 'uint256', name: 'tokenId', type: 'uint256' },
    ],
    name: 'transferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'to', type: 'address' },
      { internalType: 'bool', name: 'approved', type: 'bool' },
    ],
    name: 'setApprovalForAll',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'tokenId', type: 'uint256' },
      { internalType: 'address', name: 'to', type: 'address' },
    ],
    name: 'approve',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

// ERC-721 URI Storage ABI
export const ERC721_URI_STORAGE_ABI = [
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'tokenURI',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Identity Registry ABI
export const IDENTITY_REGISTRY_ABI = [
  ...ERC721_ABI,
  ...ERC721_URI_STORAGE_ABI,
  {
    inputs: [],
    name: 'DOMAIN_SEPARATOR',
    outputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'eip712Domain',
    outputs: [
      { internalType: 'bytes1', name: 'fields', type: 'bytes1' },
      { internalType: 'string', name: 'name', type: 'string' },
      { internalType: 'string', name: 'version', type: 'string' },
      { internalType: 'uint256', name: 'chainId', type: 'uint256' },
      { internalType: 'address', name: 'verifyingContract', type: 'address' },
      { internalType: 'bytes32', name: 'salt', type: 'bytes32' },
      { internalType: 'uint256[]', name: 'extensions', type: 'uint256[]' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'register',
    outputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'string', name: 'agentURI', type: 'string' }],
    name: 'register',
    outputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'string', name: 'agentURI', type: 'string' },
      {
        components: [
          { internalType: 'string', name: 'metadataKey', type: 'string' },
          { internalType: 'bytes', name: 'metadataValue', type: 'bytes' },
        ],
        internalType: 'struct IdentityRegistryUpgradeable.MetadataEntry[]',
        name: 'metadata',
        type: 'tuple[]',
      },
    ],
    name: 'register',
    outputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'string', name: 'key', type: 'string' },
    ],
    name: 'getMetadata',
    outputs: [{ internalType: 'bytes', name: '', type: 'bytes' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'string', name: 'key', type: 'string' },
      { internalType: 'bytes', name: 'value', type: 'bytes' },
    ],
    name: 'setMetadata',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'string', name: 'newURI', type: 'string' },
    ],
    name: 'setAgentURI',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'address', name: 'newWallet', type: 'address' },
      { internalType: 'uint256', name: 'deadline', type: 'uint256' },
      { internalType: 'bytes', name: 'signature', type: 'bytes' },
    ],
    name: 'setAgentWallet',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    name: 'unsetAgentWallet',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    name: 'getAgentWallet',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { indexed: false, internalType: 'string', name: 'agentURI', type: 'string' },
      { indexed: true, internalType: 'address', name: 'owner', type: 'address' },
    ],
    name: 'Registered',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { indexed: false, internalType: 'string', name: 'newURI', type: 'string' },
      { indexed: true, internalType: 'address', name: 'updatedBy', type: 'address' },
    ],
    name: 'URIUpdated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { indexed: true, internalType: 'string', name: 'indexedMetadataKey', type: 'string' },
      { indexed: false, internalType: 'string', name: 'metadataKey', type: 'string' },
      { indexed: false, internalType: 'bytes', name: 'metadataValue', type: 'bytes' },
    ],
    name: 'MetadataSet',
    type: 'event',
  },
] as const;

// Reputation Registry ABI
export const REPUTATION_REGISTRY_ABI = [
  {
    inputs: [],
    name: 'getIdentityRegistry',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'int256', name: 'value', type: 'int256' },
      { internalType: 'uint8', name: 'valueDecimals', type: 'uint8' },
      { internalType: 'string', name: 'tag1', type: 'string' },
      { internalType: 'string', name: 'tag2', type: 'string' },
      { internalType: 'string', name: 'endpoint', type: 'string' },
      { internalType: 'string', name: 'feedbackURI', type: 'string' },
      { internalType: 'bytes32', name: 'feedbackHash', type: 'bytes32' },
    ],
    name: 'giveFeedback',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'uint64', name: 'feedbackIndex', type: 'uint64' },
    ],
    name: 'revokeFeedback',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'address', name: 'clientAddress', type: 'address' },
      { internalType: 'uint64', name: 'feedbackIndex', type: 'uint64' },
      { internalType: 'string', name: 'responseURI', type: 'string' },
      { internalType: 'bytes32', name: 'responseHash', type: 'bytes32' },
    ],
    name: 'appendResponse',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'address', name: 'clientAddress', type: 'address' },
    ],
    name: 'getLastIndex',
    outputs: [{ internalType: 'uint64', name: '', type: 'uint64' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'address', name: 'clientAddress', type: 'address' },
      { internalType: 'uint64', name: 'feedbackIndex', type: 'uint64' },
    ],
    name: 'readFeedback',
    outputs: [
      { internalType: 'int256', name: 'value', type: 'int256' },
      { internalType: 'uint8', name: 'valueDecimals', type: 'uint8' },
      { internalType: 'string', name: 'tag1', type: 'string' },
      { internalType: 'string', name: 'tag2', type: 'string' },
      { internalType: 'bool', name: 'isRevoked', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'address[]', name: 'clientAddresses', type: 'address[]' },
      { internalType: 'string', name: 'tag1', type: 'string' },
      { internalType: 'string', name: 'tag2', type: 'string' },
    ],
    name: 'getSummary',
    outputs: [
      { internalType: 'uint64', name: 'count', type: 'uint64' },
      { internalType: 'int256', name: 'summaryValue', type: 'int256' },
      { internalType: 'uint8', name: 'summaryValueDecimals', type: 'uint8' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'address[]', name: 'clientAddresses', type: 'address[]' },
      { internalType: 'string', name: 'tag1', type: 'string' },
      { internalType: 'string', name: 'tag2', type: 'string' },
      { internalType: 'bool', name: 'includeRevoked', type: 'bool' },
    ],
    name: 'readAllFeedback',
    outputs: [
      { internalType: 'address[]', name: 'clients', type: 'address[]' },
      { internalType: 'uint64[]', name: 'feedbackIndexes', type: 'uint64[]' },
      { internalType: 'int256[]', name: 'values', type: 'int256[]' },
      { internalType: 'uint8[]', name: 'valueDecimals', type: 'uint8[]' },
      { internalType: 'string[]', name: 'tag1s', type: 'string[]' },
      { internalType: 'string[]', name: 'tag2s', type: 'string[]' },
      { internalType: 'bool[]', name: 'revokedStatuses', type: 'bool[]' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
    ],
    name: 'getClients',
    outputs: [{ internalType: 'address[]', name: '', type: 'address[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { indexed: true, internalType: 'address', name: 'clientAddress', type: 'address' },
      { indexed: false, internalType: 'uint64', name: 'feedbackIndex', type: 'uint64' },
      { indexed: false, internalType: 'int256', name: 'value', type: 'int256' },
      { indexed: false, internalType: 'uint8', name: 'valueDecimals', type: 'uint8' },
      { indexed: true, internalType: 'string', name: 'indexedTag1', type: 'string' },
      { indexed: false, internalType: 'string', name: 'tag1', type: 'string' },
      { indexed: false, internalType: 'string', name: 'tag2', type: 'string' },
      { indexed: false, internalType: 'string', name: 'endpoint', type: 'string' },
      { indexed: false, internalType: 'string', name: 'feedbackURI', type: 'string' },
      { indexed: false, internalType: 'bytes32', name: 'feedbackHash', type: 'bytes32' },
    ],
    name: 'NewFeedback',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { indexed: true, internalType: 'address', name: 'clientAddress', type: 'address' },
      { indexed: true, internalType: 'uint64', name: 'feedbackIndex', type: 'uint64' },
    ],
    name: 'FeedbackRevoked',
    type: 'event',
  },
] as const;

// Validation Registry ABI
export const VALIDATION_REGISTRY_ABI = [
  {
    inputs: [],
    name: 'getIdentityRegistry',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'validatorAddress', type: 'address' },
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'string', name: 'requestUri', type: 'string' },
      { internalType: 'bytes32', name: 'requestHash', type: 'bytes32' },
    ],
    name: 'validationRequest',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'bytes32', name: 'requestHash', type: 'bytes32' },
      { internalType: 'uint8', name: 'response', type: 'uint8' },
      { internalType: 'string', name: 'responseURI', type: 'string' },
      { internalType: 'bytes32', name: 'responseHash', type: 'bytes32' },
      { internalType: 'string', name: 'tag', type: 'string' },
    ],
    name: 'validationResponse',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'bytes32', name: 'requestHash', type: 'bytes32' },
    ],
    name: 'getValidationStatus',
    outputs: [
      { internalType: 'address', name: 'validatorAddress', type: 'address' },
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'uint8', name: 'response', type: 'uint8' },
      { internalType: 'string', name: 'tag', type: 'string' },
      { internalType: 'uint256', name: 'lastUpdate', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'address[]', name: 'validatorAddresses', type: 'address[]' },
      { internalType: 'string', name: 'tag', type: 'string' },
    ],
    name: 'getSummary',
    outputs: [
      { internalType: 'uint64', name: 'count', type: 'uint64' },
      { internalType: 'uint8', name: 'avgResponse', type: 'uint8' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
    ],
    name: 'getAgentValidations',
    outputs: [{ internalType: 'bytes32[]', name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'validatorAddress', type: 'address' },
    ],
    name: 'getValidatorRequests',
    outputs: [{ internalType: 'bytes32[]', name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'validatorAddress', type: 'address' },
      { indexed: true, internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { indexed: true, internalType: 'bytes32', name: 'requestHash', type: 'bytes32' },
      { indexed: false, internalType: 'uint8', name: 'response', type: 'uint8' },
      { indexed: false, internalType: 'string', name: 'responseURI', type: 'string' },
      { indexed: false, internalType: 'bytes32', name: 'responseHash', type: 'bytes32' },
      { indexed: false, internalType: 'string', name: 'tag', type: 'string' },
    ],
    name: 'ValidationResponse',
    type: 'event',
  },
] as const;

/**
 * Contract registry for different chains
 */
export const DEFAULT_REGISTRIES: Record<ChainId, Record<string, string>> = {
  11155111: {
    // Ethereum Sepolia
    // Aligned with Python SDK (agent0-py) defaults
    IDENTITY: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    REPUTATION: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
    // VALIDATION: not deployed in Python defaults yet
  },
};

/**
 * Default subgraph URLs for different chains
 */
export const DEFAULT_SUBGRAPH_URLS: Record<ChainId, string> = {
  11155111:
    'https://gateway.thegraph.com/api/00a452ad3cd1900273ea62c1bf283f93/subgraphs/id/6wQRC7geo9XYAhckfmfo8kbMRLeWU8KQd3XsJqFKmZLT', // Ethereum Sepolia
};

