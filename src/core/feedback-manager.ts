/**
 * Feedback management system for Agent0 SDK
 */

import { ethers } from 'ethers';
import type {
  Feedback,
  SearchFeedbackParams,
  FeedbackIdTuple,
} from '../models/interfaces.js';
import type { AgentId, Address, URI, Timestamp, IdemKey } from '../models/types.js';
import type { Web3Client } from './web3-client.js';
import type { IPFSClient } from './ipfs-client.js';
import type { SubgraphClient } from './subgraph-client.js';
import { parseAgentId, formatAgentId, formatFeedbackId, parseFeedbackId } from '../utils/id-format.js';
import { DEFAULTS } from '../utils/constants.js';

export interface FeedbackAuth {
  agentId: bigint;
  clientAddress: Address;
  indexLimit: bigint;
  expiry: bigint;
  chainId: bigint;
  identityRegistry: Address;
  signerAddress: Address;
}

/**
 * Manages feedback operations for the Agent0 SDK
 */
export class FeedbackManager {
  private getSubgraphClientForChain?: (chainId?: number) => SubgraphClient | undefined;
  private defaultChainId?: number;

  constructor(
    private web3Client: Web3Client,
    private ipfsClient?: IPFSClient,
    private reputationRegistry?: ethers.Contract,
    private identityRegistry?: ethers.Contract,
    private subgraphClient?: SubgraphClient
  ) {}

  /**
   * Set function to get subgraph client for a specific chain (for multi-chain support)
   */
  setSubgraphClientGetter(
    getter: (chainId?: number) => SubgraphClient | undefined,
    defaultChainId: number
  ): void {
    this.getSubgraphClientForChain = getter;
    this.defaultChainId = defaultChainId;
  }

  /**
   * Set reputation registry contract (for lazy initialization)
   */
  setReputationRegistry(registry: ethers.Contract): void {
    this.reputationRegistry = registry;
  }

  /**
   * Set identity registry contract (for lazy initialization)
   */
  setIdentityRegistry(registry: ethers.Contract): void {
    this.identityRegistry = registry;
  }

  /**
   * Sign feedback authorization for a client
   */
  async signFeedbackAuth(
    agentId: AgentId,
    clientAddress: Address,
    indexLimit?: number,
    expiryHours: number = DEFAULTS.FEEDBACK_EXPIRY_HOURS
  ): Promise<string> {
    // Parse agent ID to get token ID
    const { tokenId } = parseAgentId(agentId);

    // Get current feedback index if not provided
    let indexLimitValue = indexLimit;
    if (indexLimitValue === undefined && this.reputationRegistry) {
      try {
        const lastIndex = await this.web3Client.callContract(
          this.reputationRegistry,
          'getLastIndex',
          BigInt(tokenId),
          clientAddress
        );
        indexLimitValue = Number(lastIndex) + 1;
      } catch {
        // If we can't get the index, default to 1 (for first feedback)
        indexLimitValue = 1;
      }
    } else if (indexLimitValue === undefined) {
      indexLimitValue = 1;
    }

    // Calculate expiry timestamp
    const expiry = BigInt(Math.floor(Date.now() / 1000) + expiryHours * 3600);

    // Get chain ID (await if needed)
    let chainId: bigint;
    if (this.web3Client.chainId === 0n) {
      await this.web3Client.initialize();
      chainId = this.web3Client.chainId;
    } else {
      chainId = this.web3Client.chainId;
    }

    const identityRegistryAddress = this.identityRegistry
      ? await this.identityRegistry.getAddress()
      : '0x0';
    const signerAddress = this.web3Client.address || '0x0';

    if (!signerAddress || signerAddress === '0x0') {
      throw new Error('No signer available for feedback authorization');
    }

    // Encode feedback auth data
    const authData = this.web3Client.encodeFeedbackAuth(
      BigInt(tokenId),
      clientAddress,
      BigInt(indexLimitValue),
      expiry,
      chainId,
      identityRegistryAddress,
      signerAddress
    );

    // Hash the encoded data (matching contract's keccak256(abi.encode(...)))
    // The contract expects: keccak256(abi.encode(...)) then signed with Ethereum message prefix
    const messageHash = ethers.keccak256(ethers.getBytes(authData));

    // Sign the hash (ethers.js will add the Ethereum signed message prefix automatically)
    const signature = await this.web3Client.signMessage(ethers.getBytes(messageHash));

    // Combine auth data and signature
    // Both are hex strings, combine them
    const authDataNoPrefix = authData.startsWith('0x') ? authData.slice(2) : authData;
    const sigNoPrefix = signature.startsWith('0x') ? signature.slice(2) : signature;
    return '0x' + authDataNoPrefix + sigNoPrefix;
  }

  /**
   * Prepare feedback file (local file/object) according to spec
   */
  prepareFeedback(
    agentId: AgentId,
    score?: number, // 0-100
    tags?: string[],
    text?: string,
    capability?: string,
    name?: string,
    skill?: string,
    task?: string,
    context?: Record<string, unknown>,
    proofOfPayment?: Record<string, unknown>,
    extra?: Record<string, unknown>
  ): Record<string, unknown> {
    const tagsArray = tags || [];

    // Parse agent ID to get token ID
    const { tokenId } = parseAgentId(agentId);

    // Get current timestamp in ISO format
    const createdAt = new Date().toISOString();

    // Determine chain ID and registry address
    const chainId = this.web3Client.chainId;
    const identityRegistryAddress = this.identityRegistry
      ? (this.identityRegistry.target as string)
      : '0x0';
    const clientAddress = this.web3Client.address || '0x0';

    // Build feedback data according to spec
    const feedbackData: Record<string, unknown> = {
      // MUST FIELDS
      agentRegistry: `eip155:${chainId}:${identityRegistryAddress}`,
      agentId: tokenId,
      clientAddress: `eip155:${chainId}:${clientAddress}`,
      createdAt,
      feedbackAuth: '', // Will be filled when giving feedback
      score: score !== undefined ? Math.round(score) : 0, // Score as integer (0-100)

      // MAY FIELDS
      tag1: tagsArray[0] || undefined,
      tag2: tagsArray.length > 1 ? tagsArray[1] : undefined,
      skill,
      context,
      task,
      capability,
      name,
      proofOfPayment: proofOfPayment,
    };

    // Remove undefined values to keep the structure clean
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(feedbackData)) {
      if (value !== undefined && value !== null) {
        cleaned[key] = value;
      }
    }

    if (extra) {
      Object.assign(cleaned, extra);
    }

    return cleaned;
  }

  /**
   * Give feedback (maps 8004 endpoint)
   */
  async giveFeedback(
    agentId: AgentId,
    feedbackFile: Record<string, unknown>,
    idem?: IdemKey,
    feedbackAuth?: string
  ): Promise<Feedback> {
    // Parse agent ID
    const { tokenId } = parseAgentId(agentId);

    // Get client address (the one giving feedback)
    const clientAddress = this.web3Client.address;
    if (!clientAddress) {
      throw new Error('No signer available. Cannot give feedback without a wallet.');
    }

    // Get current feedback index for this client-agent pair
    let feedbackIndex: number;
    try {
      if (!this.reputationRegistry) {
        throw new Error('Reputation registry not available');
      }
      const lastIndex = await this.web3Client.callContract(
        this.reputationRegistry,
        'getLastIndex',
        BigInt(tokenId),
        clientAddress
      );
      feedbackIndex = Number(lastIndex) + 1;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get feedback index: ${errorMessage}`);
    }

    // Prepare feedback auth (use provided auth or create new one)
    let authBytes: string;
    if (feedbackAuth) {
      authBytes = feedbackAuth;
    } else {
      const authHex = await this.signFeedbackAuth(agentId, clientAddress, feedbackIndex, 24);
      authBytes = authHex;
    }

    // Update feedback file with auth
    feedbackFile.feedbackAuth = authBytes.startsWith('0x') ? authBytes : '0x' + authBytes;

    // Prepare on-chain data (only basic fields, no capability/endpoint)
    const score = feedbackFile.score !== undefined ? Number(feedbackFile.score) : 0;
    const tag1Str = typeof feedbackFile.tag1 === 'string' ? feedbackFile.tag1 : '';
    const tag2Str = typeof feedbackFile.tag2 === 'string' ? feedbackFile.tag2 : '';
    const tag1 = this._stringToBytes32(tag1Str);
    const tag2 = this._stringToBytes32(tag2Str);

    // Handle off-chain file storage
    let feedbackUri = '';
    let feedbackHash = '0x' + '00'.repeat(32); // Default empty hash

    if (this.ipfsClient) {
      // Store feedback file on IPFS
      try {
        const cid = await this.ipfsClient.addJson(feedbackFile);
        feedbackUri = `ipfs://${cid}`;
        // Calculate hash of sorted JSON
        const sortedJson = JSON.stringify(feedbackFile, Object.keys(feedbackFile).sort());
        feedbackHash = this.web3Client.keccak256(sortedJson);
      } catch (error) {
        // Failed to store on IPFS - log error but continue without IPFS storage
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[Feedback] Failed to store feedback file on IPFS: ${errorMessage}`);
        // Continue without IPFS storage - feedback will be stored on-chain only
      }
    } else if (feedbackFile.context || feedbackFile.capability || feedbackFile.name) {
      // If we have rich data but no IPFS, we need to store it somewhere
      throw new Error('Rich feedback data requires IPFS client for storage');
    }

    // Submit to blockchain
    if (!this.reputationRegistry) {
      throw new Error('Reputation registry not available');
    }

    try {
      const txHash = await this.web3Client.transactContract(
        this.reputationRegistry,
        'giveFeedback',
        {},
        BigInt(tokenId),
        score,
        tag1,
        tag2,
        feedbackUri,
        feedbackHash,
        ethers.getBytes(authBytes.startsWith('0x') ? authBytes : '0x' + authBytes)
      );

      // Wait for transaction confirmation
      await this.web3Client.waitForTransaction(txHash);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to submit feedback to blockchain: ${errorMessage}`);
    }

    // Create feedback object
    const parsedId = parseFeedbackId(formatFeedbackId(agentId, clientAddress, feedbackIndex));

    // Extract typed values from feedbackFile (Record<string, unknown>)
    const tag1Value = typeof feedbackFile.tag1 === 'string' ? feedbackFile.tag1 : undefined;
    const tag2Value = typeof feedbackFile.tag2 === 'string' ? feedbackFile.tag2 : undefined;
    const textValue = typeof feedbackFile.text === 'string' ? feedbackFile.text : undefined;
    const contextValue = feedbackFile.context && typeof feedbackFile.context === 'object' && !Array.isArray(feedbackFile.context)
      ? feedbackFile.context as Record<string, any>
      : undefined;
    const proofOfPaymentValue = feedbackFile.proofOfPayment && typeof feedbackFile.proofOfPayment === 'object' && !Array.isArray(feedbackFile.proofOfPayment)
      ? feedbackFile.proofOfPayment as Record<string, any>
      : undefined;

    return {
      id: [parsedId.agentId, parsedId.clientAddress, parsedId.feedbackIndex] as FeedbackIdTuple,
      agentId,
      reviewer: clientAddress,
      score: score > 0 ? score : undefined,
      tags: [tag1Value, tag2Value].filter(Boolean) as string[],
      text: textValue,
      context: contextValue,
      proofOfPayment: proofOfPaymentValue,
      fileURI: feedbackUri || undefined,
      createdAt: Math.floor(Date.now() / 1000),
      answers: [],
      isRevoked: false,
      // Off-chain only fields
      capability: typeof feedbackFile.capability === 'string' ? feedbackFile.capability : undefined,
      name: typeof feedbackFile.name === 'string' ? feedbackFile.name : undefined,
      skill: typeof feedbackFile.skill === 'string' ? feedbackFile.skill : undefined,
      task: typeof feedbackFile.task === 'string' ? feedbackFile.task : undefined,
    };
  }

  /**
   * Get single feedback with responses
   * Currently only supports blockchain query - subgraph support coming soon
   */
  async getFeedback(
    agentId: AgentId,
    clientAddress: Address,
    feedbackIndex: number
  ): Promise<Feedback> {
    return await this._getFeedbackFromBlockchain(agentId, clientAddress, feedbackIndex);
  }

  /**
   * Get feedback from blockchain
   */
  private async _getFeedbackFromBlockchain(
    agentId: AgentId,
    clientAddress: Address,
    feedbackIndex: number
  ): Promise<Feedback> {
    if (!this.reputationRegistry) {
      throw new Error('Reputation registry not available');
    }

    const { tokenId } = parseAgentId(agentId);

    try {
      const [score, tag1Bytes, tag2Bytes, isRevoked] = await this.web3Client.callContract(
        this.reputationRegistry,
        'readFeedback',
        BigInt(tokenId),
        clientAddress,
        BigInt(feedbackIndex)
      );

      const tags = this._bytes32ToTags(tag1Bytes, tag2Bytes);

      return {
        id: [agentId, clientAddress.toLowerCase(), feedbackIndex] as FeedbackIdTuple,
        agentId,
        reviewer: clientAddress,
        score: Number(score),
        tags,
        createdAt: Math.floor(Date.now() / 1000), // Approximate, could be improved
        answers: [],
        isRevoked: Boolean(isRevoked),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read feedback from blockchain: ${errorMessage}`);
    }
  }

  /**
   * Search feedback with filters
   * Uses subgraph if available, otherwise returns empty array
   * Supports chainId:agentId format in params.agents
   */
  async searchFeedback(params: SearchFeedbackParams): Promise<Feedback[]> {
    // Determine which subgraph client to use based on agentId chainId
    let subgraphClientToUse = this.subgraphClient;
    let formattedAgents: string[] | undefined;
    
    // If agents are specified, check if they have chainId prefixes
    if (params.agents && params.agents.length > 0 && this.getSubgraphClientForChain) {
      // Parse first agentId to determine chain
      const firstAgentId = params.agents[0];
      let chainId: number | undefined;
      let fullAgentId: string;
      
      if (firstAgentId.includes(':')) {
        const parsed = parseAgentId(firstAgentId);
        chainId = parsed.chainId;
        fullAgentId = firstAgentId;
        // Get subgraph client for the specified chain
        subgraphClientToUse = this.getSubgraphClientForChain(chainId);
        // Format all agentIds to ensure they have chainId prefix
        formattedAgents = params.agents.map(agentId => {
          if (agentId.includes(':')) {
            return agentId;
          } else {
            // Format with the same chainId as the first agent
            return formatAgentId(chainId!, parseInt(agentId, 10));
          }
        });
      } else {
        // Use default chain - format agentIds with default chainId
        chainId = this.defaultChainId;
        if (this.defaultChainId !== undefined) {
          formattedAgents = params.agents.map(agentId => {
            if (agentId.includes(':')) {
              return agentId;
            } else {
              return formatAgentId(this.defaultChainId!, parseInt(agentId, 10));
            }
          });
        } else {
          formattedAgents = params.agents;
        }
        // Don't change subgraphClientToUse - use the default one
      }
    } else {
      formattedAgents = params.agents;
    }

    if (!subgraphClientToUse) {
      // Fallback not implemented (would require blockchain queries)
      // For now, return empty if subgraph unavailable
      return [];
    }

    // Query subgraph
    const feedbacksData = await subgraphClientToUse.searchFeedback(
      {
        agents: formattedAgents || params.agents,
        reviewers: params.reviewers,
        tags: params.tags,
        capabilities: params.capabilities,
        skills: params.skills,
        tasks: params.tasks,
        names: params.names,
        minScore: params.minScore,
        maxScore: params.maxScore,
        includeRevoked: params.includeRevoked || false,
      },
      100, // first
      0, // skip
      'createdAt',
      'desc'
    );

    // Map to Feedback objects
    const feedbacks: Feedback[] = [];
    for (const fbData of feedbacksData) {
      // Parse agentId from feedback ID
      const feedbackId = fbData.id;
      const parts = feedbackId.split(':');
      let agentIdStr: string;
      let clientAddr: string;
      let feedbackIdx: number;

      if (parts.length >= 2) {
        agentIdStr = `${parts[0]}:${parts[1]}`;
        clientAddr = parts.length > 2 ? parts[2] : '';
        feedbackIdx = parts.length > 3 ? parseInt(parts[3], 10) : 1;
      } else {
        agentIdStr = feedbackId;
        clientAddr = '';
        feedbackIdx = 1;
      }

      const feedback = this._mapSubgraphFeedbackToModel(fbData, agentIdStr, clientAddr, feedbackIdx);
      feedbacks.push(feedback);
    }

    return feedbacks;
  }

  /**
   * Map subgraph feedback data to Feedback model
   */
  private _mapSubgraphFeedbackToModel(
    feedbackData: any,
    agentId: AgentId,
    clientAddress: Address,
    feedbackIndex: number
  ): Feedback {
    const feedbackFile = feedbackData.feedbackFile || {};

    // Map responses
    const responsesData = feedbackData.responses || [];
    const answers = responsesData.map((resp: any) => ({
      responder: resp.responder,
      responseUri: resp.responseUri,
      responseHash: resp.responseHash,
      createdAt: resp.createdAt ? parseInt(resp.createdAt, 10) : undefined,
    }));

    // Map tags - check if they're hex bytes32 or plain strings
    const tags: string[] = [];
    const tag1 = feedbackData.tag1 || feedbackFile.tag1;
    const tag2 = feedbackData.tag2 || feedbackFile.tag2;

    // Convert hex bytes32 to readable tags
    if (tag1 || tag2) {
      tags.push(...this._hexBytes32ToTags(tag1 || '', tag2 || ''));
    }

    // Build proof of payment object if available
    let proofOfPayment: Record<string, any> | undefined;
    if (feedbackFile.proofOfPaymentFromAddress) {
      proofOfPayment = {
        fromAddress: feedbackFile.proofOfPaymentFromAddress,
        toAddress: feedbackFile.proofOfPaymentToAddress,
        chainId: feedbackFile.proofOfPaymentChainId,
        txHash: feedbackFile.proofOfPaymentTxHash,
      };
    }

    // Build context object if available
    let context: Record<string, any> | undefined;
    if (feedbackFile.context) {
      try {
        context = typeof feedbackFile.context === 'string'
          ? JSON.parse(feedbackFile.context)
          : feedbackFile.context;
      } catch {
        context = { raw: feedbackFile.context };
      }
    }

    const id: FeedbackIdTuple = [agentId, clientAddress, feedbackIndex];

    return {
      id,
      agentId,
      reviewer: clientAddress,
      score: feedbackData.score !== undefined && feedbackData.score !== null ? Number(feedbackData.score) : undefined,
      tags,
      text: feedbackFile.text || undefined,
      context,
      proofOfPayment,
      fileURI: feedbackData.feedbackUri || undefined,
      createdAt: feedbackData.createdAt ? parseInt(feedbackData.createdAt, 10) : Math.floor(Date.now() / 1000),
      answers,
      isRevoked: feedbackData.isRevoked || false,
      capability: feedbackFile.capability || undefined,
      name: feedbackFile.name || undefined,
      skill: feedbackFile.skill || undefined,
      task: feedbackFile.task || undefined,
    };
  }

  /**
   * Convert hex bytes32 tags back to strings, or return plain strings as-is
   * The subgraph now stores tags as human-readable strings (not hex),
   * so this method handles both formats for backwards compatibility
   */
  private _hexBytes32ToTags(tag1: string, tag2: string): string[] {
    const tags: string[] = [];

    if (tag1 && tag1 !== '0x' + '00'.repeat(32)) {
      // If it's already a plain string (from subgraph), use it directly
      if (!tag1.startsWith('0x')) {
        if (tag1) {
          tags.push(tag1);
        }
      } else {
        // Try to convert from hex bytes32 (on-chain format)
        try {
          const hexBytes = ethers.getBytes(tag1);
          const tag1Str = new TextDecoder('utf-8', { fatal: false }).decode(
            hexBytes.filter((b) => b !== 0)
          );
          if (tag1Str) {
            tags.push(tag1Str);
          }
        } catch {
          // Ignore invalid hex strings
        }
      }
    }

    if (tag2 && tag2 !== '0x' + '00'.repeat(32)) {
      // If it's already a plain string (from subgraph), use it directly
      if (!tag2.startsWith('0x')) {
        if (tag2) {
          tags.push(tag2);
        }
      } else {
        // Try to convert from hex bytes32 (on-chain format)
        try {
          const hexBytes = ethers.getBytes(tag2);
          const tag2Str = new TextDecoder('utf-8', { fatal: false }).decode(
            hexBytes.filter((b) => b !== 0)
          );
          if (tag2Str) {
            tags.push(tag2Str);
          }
        } catch {
          // Ignore invalid hex strings
        }
      }
    }

    return tags;
  }

  /**
   * Append response to feedback
   */
  async appendResponse(
    agentId: AgentId,
    clientAddress: Address,
    feedbackIndex: number,
    responseUri: URI,
    responseHash: string
  ): Promise<string> {
    if (!this.reputationRegistry) {
      throw new Error('Reputation registry not available');
    }

    const { tokenId } = parseAgentId(agentId);

    try {
      const txHash = await this.web3Client.transactContract(
        this.reputationRegistry,
        'appendResponse',
        {},
        BigInt(tokenId),
        clientAddress,
        BigInt(feedbackIndex),
        responseUri,
        responseHash
      );

      return txHash;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to append response: ${errorMessage}`);
    }
  }

  /**
   * Revoke feedback
   */
  async revokeFeedback(agentId: AgentId, feedbackIndex: number): Promise<string> {
    if (!this.reputationRegistry) {
      throw new Error('Reputation registry not available');
    }

    const { tokenId } = parseAgentId(agentId);

    // Get client address (the one revoking - must be the reviewer)
    const clientAddress = this.web3Client.address;
    if (!clientAddress) {
      throw new Error('No signer available');
    }

    try {
      const txHash = await this.web3Client.transactContract(
        this.reputationRegistry,
        'revokeFeedback',
        {},
        BigInt(tokenId),
        BigInt(feedbackIndex)
      );

      return txHash;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to revoke feedback: ${errorMessage}`);
    }
  }

  /**
   * Convert string to bytes32 for blockchain storage
   */
  private _stringToBytes32(text: string): string {
    if (!text) {
      return '0x' + '00'.repeat(32);
    }

    // Encode as UTF-8 and pad/truncate to 32 bytes
    const encoder = new TextEncoder();
    const encoded = encoder.encode(text);
    const padded = new Uint8Array(32);
    const length = Math.min(encoded.length, 32);
    padded.set(encoded.slice(0, length), 0);

    return ethers.hexlify(padded);
  }

  /**
   * Convert bytes32 tags back to strings
   */
  private _bytes32ToTags(tag1Bytes: string, tag2Bytes: string): string[] {
    const tags: string[] = [];

    if (tag1Bytes && tag1Bytes !== '0x' + '00'.repeat(32)) {
      try {
        const tag1 = ethers.toUtf8String(tag1Bytes).replace(/\0/g, '').trim();
        if (tag1) {
          tags.push(tag1);
        }
      } catch {
        // If UTF-8 decode fails, skip this tag
      }
    }

    if (tag2Bytes && tag2Bytes !== '0x' + '00'.repeat(32)) {
      try {
        const tag2 = ethers.toUtf8String(tag2Bytes).replace(/\0/g, '').trim();
        if (tag2) {
          tags.push(tag2);
        }
      } catch {
        // If UTF-8 decode fails, skip this tag
      }
    }

    return tags;
  }

  /**
   * Get reputation summary
   * Supports chainId:agentId format
   */
  async getReputationSummary(
    agentId: AgentId,
    tag1?: string,
    tag2?: string
  ): Promise<{ count: number; averageScore: number }> {
    // Parse chainId from agentId
    let chainId: number | undefined;
    let fullAgentId: string;
    let tokenId: number;
    
    let subgraphClient: SubgraphClient | undefined;
    
    if (agentId.includes(':')) {
      const parsed = parseAgentId(agentId);
      chainId = parsed.chainId;
      tokenId = parsed.tokenId;
      fullAgentId = agentId;
      // Get subgraph client for the specified chain
      if (this.getSubgraphClientForChain) {
        subgraphClient = this.getSubgraphClientForChain(chainId);
      }
    } else {
      // Use default chain
      chainId = this.defaultChainId;
      tokenId = parseInt(agentId, 10);
      if (this.defaultChainId !== undefined) {
        fullAgentId = formatAgentId(this.defaultChainId, tokenId);
      } else {
        // Fallback: use agentId as-is if no default chain
        fullAgentId = agentId;
      }
      // Use default subgraph client
      subgraphClient = this.subgraphClient;
    }

    // Try subgraph first if available
    if (subgraphClient) {
      try {
        // Use subgraph to calculate reputation
        // Query feedback for this agent
        const feedbacksData = await subgraphClient.searchFeedback(
            {
              agents: [fullAgentId],
            },
            1000, // first
            0, // skip
            'createdAt',
            'desc'
          );

          // Filter by tags if provided
          let filteredFeedbacks = feedbacksData;
          if (tag1 || tag2) {
            filteredFeedbacks = feedbacksData.filter((fb: any) => {
              const fbTag1 = fb.tag1 || '';
              const fbTag2 = fb.tag2 || '';
              if (tag1 && tag2) {
                return (fbTag1 === tag1 && fbTag2 === tag2) || (fbTag1 === tag2 && fbTag2 === tag1);
              } else if (tag1) {
                return fbTag1 === tag1 || fbTag2 === tag1;
              } else if (tag2) {
                return fbTag1 === tag2 || fbTag2 === tag2;
              }
              return true;
            });
          }

          // Filter out revoked feedback
          const validFeedbacks = filteredFeedbacks.filter((fb: any) => !fb.isRevoked);

          if (validFeedbacks.length > 0) {
            const scores = validFeedbacks
              .map((fb: any) => fb.score)
              .filter((score: any) => score !== null && score !== undefined && score > 0);
            
            if (scores.length > 0) {
              const sum = scores.reduce((a: number, b: number) => a + b, 0);
              const averageScore = sum / scores.length;
              return {
                count: validFeedbacks.length,
                averageScore: Math.round(averageScore * 100) / 100, // Round to 2 decimals
              };
            }
          }

        return { count: 0, averageScore: 0 };
      } catch (error) {
        // Fall through to blockchain query if subgraph fails
      }
    }

    // Fallback to blockchain query (requires matching chain)
    if (!this.reputationRegistry) {
      throw new Error('Reputation registry not available');
    }

    // For blockchain query, we need the chain to match the SDK's default chain
    // If chainId is specified and different, we can't use blockchain query
    if (chainId !== undefined && this.defaultChainId !== undefined && chainId !== this.defaultChainId) {
      throw new Error(
        `Blockchain reputation summary not supported for chain ${chainId}. ` +
        `SDK is configured for chain ${this.defaultChainId}. ` +
        `Use subgraph-based summary instead.`
      );
    }

    try {
      const tag1Bytes = tag1 ? this._stringToBytes32(tag1) : '0x' + '00'.repeat(32);
      const tag2Bytes = tag2 ? this._stringToBytes32(tag2) : '0x' + '00'.repeat(32);

      // Get all clients who gave feedback
      const clients = await this.web3Client.callContract(
        this.reputationRegistry,
        'getClients',
        BigInt(tokenId)
      );

      if (!Array.isArray(clients) || clients.length === 0) {
        return { count: 0, averageScore: 0 };
      }

      const [count, averageScore] = await this.web3Client.callContract(
        this.reputationRegistry,
        'getSummary',
        BigInt(tokenId),
        clients,
        tag1Bytes,
        tag2Bytes
      );

      return {
        count: Number(count),
        averageScore: Number(averageScore),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get reputation summary: ${errorMessage}`);
    }
  }
}

