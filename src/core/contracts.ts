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
  {
    inputs: [
      { internalType: 'uint256', name: 'tokenId', type: 'uint256' },
      { internalType: 'string', name: '_tokenURI', type: 'string' },
    ],
    name: 'setTokenURI',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

// Identity Registry ABI
export const IDENTITY_REGISTRY_ABI = [
  ...ERC721_ABI,
  ...ERC721_URI_STORAGE_ABI,
  {
    inputs: [],
    name: 'register',
    outputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'string', name: 'tokenUri', type: 'string' }],
    name: 'register',
    outputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'string', name: 'tokenUri', type: 'string' },
      {
        components: [
          { internalType: 'string', name: 'key', type: 'string' },
          { internalType: 'bytes', name: 'value', type: 'bytes' },
        ],
        internalType: 'struct IdentityRegistry.MetadataEntry[]',
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
      { internalType: 'string', name: 'newUri', type: 'string' },
    ],
    name: 'setAgentUri',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { indexed: false, internalType: 'string', name: 'tokenURI', type: 'string' },
      { indexed: true, internalType: 'address', name: 'owner', type: 'address' },
    ],
    name: 'Registered',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { indexed: true, internalType: 'string', name: 'indexedKey', type: 'string' },
      { indexed: false, internalType: 'string', name: 'key', type: 'string' },
      { indexed: false, internalType: 'bytes', name: 'value', type: 'bytes' },
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
      { internalType: 'uint8', name: 'score', type: 'uint8' },
      { internalType: 'bytes32', name: 'tag1', type: 'bytes32' },
      { internalType: 'bytes32', name: 'tag2', type: 'bytes32' },
      { internalType: 'string', name: 'feedbackUri', type: 'string' },
      { internalType: 'bytes32', name: 'feedbackHash', type: 'bytes32' },
      { internalType: 'bytes', name: 'feedbackAuth', type: 'bytes' },
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
      { internalType: 'string', name: 'responseUri', type: 'string' },
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
      { internalType: 'uint64', name: 'index', type: 'uint64' },
    ],
    name: 'readFeedback',
    outputs: [
      { internalType: 'uint8', name: 'score', type: 'uint8' },
      { internalType: 'bytes32', name: 'tag1', type: 'bytes32' },
      { internalType: 'bytes32', name: 'tag2', type: 'bytes32' },
      { internalType: 'bool', name: 'isRevoked', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'address[]', name: 'clientAddresses', type: 'address[]' },
      { internalType: 'bytes32', name: 'tag1', type: 'bytes32' },
      { internalType: 'bytes32', name: 'tag2', type: 'bytes32' },
    ],
    name: 'getSummary',
    outputs: [
      { internalType: 'uint64', name: 'count', type: 'uint64' },
      { internalType: 'uint8', name: 'averageScore', type: 'uint8' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { indexed: true, internalType: 'address', name: 'clientAddress', type: 'address' },
      { indexed: false, internalType: 'uint8', name: 'score', type: 'uint8' },
      { indexed: true, internalType: 'bytes32', name: 'tag1', type: 'bytes32' },
      { indexed: false, internalType: 'bytes32', name: 'tag2', type: 'bytes32' },
      { indexed: false, internalType: 'string', name: 'feedbackUri', type: 'string' },
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
      { internalType: 'string', name: 'responseUri', type: 'string' },
      { internalType: 'bytes32', name: 'responseHash', type: 'bytes32' },
      { internalType: 'bytes32', name: 'tag', type: 'bytes32' },
    ],
    name: 'validationResponse',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

/**
 * Contract registry for different chains
 */
export const DEFAULT_REGISTRIES: Record<ChainId, Record<string, string>> = {
  11155111: {
    // Ethereum Sepolia
    IDENTITY: '0x8004a6090Cd10A7288092483047B097295Fb8847',
    REPUTATION: '0x8004B8FD1A363aa02fDC07635C0c5F94f6Af5B7E',
    VALIDATION: '0x8004CB39f29c09145F24Ad9dDe2A108C1A2cdfC5',
  },
  84532: {
    // Base Sepolia
    IDENTITY: '0x8004AA63c570c570eBF15376c0dB199918BFe9Fb',
    REPUTATION: '0x8004bd8daB57f14Ed299135749a5CB5c42d341BF',
    VALIDATION: '0x8004C269D0A5647E51E121FeB226200ECE932d55',
  },
  59141: {
    // Linea Sepolia
    IDENTITY: '0x8004aa7C931bCE1233973a0C6A667f73F66282e7',
    REPUTATION: '0x8004bd8483b99310df121c46ED8858616b2Bba02',
    VALIDATION: '0x8004c44d1EFdd699B2A26e781eF7F77c56A9a4EB',
  },
  80002: {
    // Polygon Amoy
    IDENTITY: '0x8004ad19E14B9e0654f73353e8a0B600D46C2898',
    REPUTATION: '0x8004B12F4C2B42d00c46479e859C92e39044C930',
    VALIDATION: '0x8004C11C213ff7BaD36489bcBDF947ba5eee289B',
  },
};

/**
 * Default subgraph URLs for different chains
 */
export const DEFAULT_SUBGRAPH_URLS: Record<ChainId, string> = {
  11155111:
    'https://gateway.thegraph.com/api/00a452ad3cd1900273ea62c1bf283f93/subgraphs/id/6wQRC7geo9XYAhckfmfo8kbMRLeWU8KQd3XsJqFKmZLT', // Ethereum Sepolia
  84532:
    'https://gateway.thegraph.com/api/00a452ad3cd1900273ea62c1bf283f93/subgraphs/id/GjQEDgEKqoh5Yc8MUgxoQoRATEJdEiH7HbocfR1aFiHa', // Base Sepolia
  80002:
    'https://gateway.thegraph.com/api/00a452ad3cd1900273ea62c1bf283f93/subgraphs/id/2A1JB18r1mF2VNP4QBH4mmxd74kbHoM6xLXC8ABAKf7j', // Polygon Amoy
};

