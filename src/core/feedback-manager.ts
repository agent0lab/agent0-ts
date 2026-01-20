/**
 * Feedback management system for Agent0 SDK
 */

import type {
  Feedback,
  SearchFeedbackParams,
  FeedbackIdTuple,
  FeedbackFileInput,
} from '../models/interfaces.js';
import type { AgentId, Address, URI, Timestamp, IdemKey } from '../models/types.js';
import type { ChainClient } from './chain-client.js';
import type { IPFSClient } from './ipfs-client.js';
import type { SubgraphClient } from './subgraph-client.js';
import { parseAgentId, formatAgentId, formatFeedbackId, parseFeedbackId } from '../utils/id-format.js';
import { DEFAULTS } from '../utils/constants.js';
import { REPUTATION_REGISTRY_ABI } from './contracts.js';
import { encodeReputationValue, decodeReputationValue } from '../utils/value-encoding.js';
import { decodeEventLog, type Hex } from 'viem';

/**
 * Manages feedback operations for the Agent0 SDK
 */
export class FeedbackManager {
  private getSubgraphClientForChain?: (chainId?: number) => SubgraphClient | undefined;
  private defaultChainId?: number;

  constructor(
    private chainClient: ChainClient,
    private ipfsClient?: IPFSClient,
    private reputationRegistryAddress?: Address,
    private identityRegistryAddress?: Address,
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
  setReputationRegistryAddress(address: Address): void {
    this.reputationRegistryAddress = address;
  }

  /**
   * Set identity registry contract (for lazy initialization)
   */
  setIdentityRegistryAddress(address: Address): void {
    this.identityRegistryAddress = address;
  }

  /**
   * Prepare an off-chain feedback file.
   *
   * This does NOT include on-chain fields (value/tag1/tag2/endpoint). Those are passed
   * directly to giveFeedback(...) and stored on-chain.
   */
  prepareFeedbackFile(
    input: FeedbackFileInput,
    extra?: Record<string, unknown>
  ): FeedbackFileInput {
    const createdAt = new Date().toISOString();

    const cleaned: FeedbackFileInput = {};
    for (const [key, value] of Object.entries(input || {})) {
      if (value !== undefined && value !== null) {
        (cleaned as any)[key] = value;
      }
    }

    // Include a timestamp by default; harmless and useful for debugging/off-chain indexing.
    if (!(cleaned as any).createdAt) {
      (cleaned as any).createdAt = createdAt;
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
    value: number | string,
    tag1?: string,
    tag2?: string,
    endpoint?: string,
    feedbackFile?: FeedbackFileInput,
    idem?: IdemKey
  ): Promise<Feedback> {
    // Parse agent ID
    const { tokenId, chainId: agentChainId } = parseAgentId(agentId);

    // Get client address (the one giving feedback)
    const clientAddress = await this.chainClient.ensureAddress();

    // Ensure the SDK/provider is configured for the same chain as the agentId we are targeting.
    // (giveFeedback is an on-chain tx, so we must settle on the agent's chain).
    if (this.chainClient.chainId !== agentChainId) {
      throw new Error(
        `Chain mismatch for giveFeedback: agentId=${agentId} targets chainId=${agentChainId}, ` +
          `but the SDK is configured for chainId=${this.chainClient.chainId}. ` +
          `Initialize SDK with chainId=${agentChainId} and the correct rpcUrl.`
      );
    }

    // Get current feedback index for this client-agent pair
    let feedbackIndex: number;
    try {
      if (!this.reputationRegistryAddress) {
        throw new Error('Reputation registry not available');
      }
      const lastIndex = await this.chainClient.readContract<bigint>({
        address: this.reputationRegistryAddress,
        abi: REPUTATION_REGISTRY_ABI,
        functionName: 'getLastIndex',
        args: [BigInt(tokenId), clientAddress],
      });
      feedbackIndex = Number(lastIndex) + 1;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get feedback index: ${errorMessage}`);
    }

    // Prepare on-chain data
    const encoded = encodeReputationValue(value);
    const rawValue = encoded.value;
    const valueDecimals = encoded.valueDecimals;
    const tag1OnChain = tag1 || '';
    const tag2OnChain = tag2 || '';
    const endpointOnChain = endpoint || '';

    const hasOffchainFile = Boolean(feedbackFile && Object.keys(feedbackFile).length > 0);

    // Handle off-chain file storage
    let feedbackUri = '';
    let feedbackHash = '0x' + '00'.repeat(32); // Default empty hash

    if (this.ipfsClient && hasOffchainFile) {
      // Store feedback file on IPFS
      try {
        // Build an ERC-8004 compliant off-chain feedback file:
        // include MUST fields from the spec + optional on-chain fields, then append rich off-chain fields.
        const identityRegistryAddress = this.identityRegistryAddress || '0x0000000000000000000000000000000000000000';

        const createdAt =
          typeof (feedbackFile as any)?.createdAt === 'string'
            ? (feedbackFile as any).createdAt
            : new Date().toISOString();

        const fileForStorage: Record<string, unknown> = {
          // MUST fields (spec)
          agentRegistry: `eip155:${agentChainId}:${identityRegistryAddress}`,
          agentId: tokenId,
          clientAddress: `eip155:${agentChainId}:${clientAddress}`,
          createdAt,
          value: encoded.normalized,

          // OPTIONAL fields that mirror on-chain (spec)
          ...(tag1OnChain ? { tag1: tag1OnChain } : {}),
          ...(tag2OnChain ? { tag2: tag2OnChain } : {}),
          ...(endpointOnChain ? { endpoint: endpointOnChain } : {}),

          // Rich/off-chain fields (capability/name/skill/task/context/proofOfPayment/etc)
          ...(feedbackFile || {}),
        };

        const cid = await this.ipfsClient.addJson(fileForStorage, 'feedback.json');
        feedbackUri = `ipfs://${cid}`;
        // Calculate hash of sorted JSON
        const sortedJson = JSON.stringify(fileForStorage, Object.keys(fileForStorage).sort());
        feedbackHash = this.chainClient.keccak256Utf8(sortedJson);
      } catch (error) {
        // Failed to store on IPFS - log error but continue without IPFS storage
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[Feedback] Failed to store feedback file on IPFS: ${errorMessage}`);
        // Continue without IPFS storage - feedback will be stored on-chain only
      }
    } else if (!this.ipfsClient && hasOffchainFile) {
      // If the caller provided an off-chain file but no IPFS backend is configured,
      // we should not silently drop it.
      throw new Error('feedbackFile provided, but no IPFS backend is configured (pinata/filecoinPin/node).');
    }

    // Submit to blockchain
    if (!this.reputationRegistryAddress) {
      throw new Error('Reputation registry not available');
    }

    try {
      const txHash = await this.chainClient.writeContract({
        address: this.reputationRegistryAddress,
        abi: REPUTATION_REGISTRY_ABI,
        functionName: 'giveFeedback',
        args: [
          BigInt(tokenId),
          rawValue,
          valueDecimals,
          tag1OnChain,
          tag2OnChain,
          endpointOnChain,
          feedbackUri,
          feedbackHash,
        ],
      });

      await this.chainClient.waitForTransaction({ hash: txHash });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to submit feedback to blockchain: ${errorMessage}`);
    }

    // Create feedback object
    const parsedId = parseFeedbackId(formatFeedbackId(agentId, clientAddress, feedbackIndex));

    // Extract typed values from the optional off-chain file
    const textValue = feedbackFile && typeof feedbackFile.text === 'string' ? feedbackFile.text : undefined;
    const contextValue =
      feedbackFile &&
      feedbackFile.context &&
      typeof feedbackFile.context === 'object' &&
      !Array.isArray(feedbackFile.context)
        ? (feedbackFile.context as Record<string, any>)
      : undefined;
    const proofOfPaymentValue =
      feedbackFile &&
      feedbackFile.proofOfPayment &&
      typeof feedbackFile.proofOfPayment === 'object' &&
      !Array.isArray(feedbackFile.proofOfPayment)
        ? (feedbackFile.proofOfPayment as Record<string, any>)
      : undefined;

    return {
      id: [parsedId.agentId, parsedId.clientAddress, parsedId.feedbackIndex] as FeedbackIdTuple,
      agentId,
      reviewer: clientAddress,
      value: decodeReputationValue(rawValue, valueDecimals),
      tags: [tag1OnChain || undefined, tag2OnChain || undefined].filter(Boolean) as string[],
      endpoint: endpointOnChain || undefined,
      text: textValue,
      context: contextValue,
      proofOfPayment: proofOfPaymentValue,
      fileURI: feedbackUri || undefined,
      createdAt: Math.floor(Date.now() / 1000),
      answers: [],
      isRevoked: false,
      // Off-chain only fields
      capability: feedbackFile && typeof feedbackFile.capability === 'string' ? feedbackFile.capability : undefined,
      name: feedbackFile && typeof feedbackFile.name === 'string' ? feedbackFile.name : undefined,
      skill: feedbackFile && typeof feedbackFile.skill === 'string' ? feedbackFile.skill : undefined,
      task: feedbackFile && typeof feedbackFile.task === 'string' ? feedbackFile.task : undefined,
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
    if (!this.reputationRegistryAddress) {
      throw new Error('Reputation registry not available');
    }

    const { tokenId } = parseAgentId(agentId);

    try {
      const [rawValue, valueDecimals, tag1, tag2, isRevoked] = await this.chainClient.readContract<
        readonly [bigint, number, string, string, boolean]
      >({
        address: this.reputationRegistryAddress,
        abi: REPUTATION_REGISTRY_ABI,
        functionName: 'readFeedback',
        args: [BigInt(tokenId), clientAddress, BigInt(feedbackIndex)],
      });

      const tags = [tag1, tag2].filter((t) => t && t !== '') as string[];

      // Best-effort: fetch endpoint + feedbackURI from the NewFeedback event (these are on-chain).
      let endpoint: string | undefined;
      let fileURI: string | undefined;
      try {
        const latestBlock = await this.chainClient.getBlockNumber();
        const fromBlock = latestBlock > 200_000n ? latestBlock - 200_000n : 0n;
        const logs = await this.chainClient.getEventLogs({
          address: this.reputationRegistryAddress,
          abi: REPUTATION_REGISTRY_ABI,
          eventName: 'NewFeedback',
          eventArgs: {
            agentId: BigInt(tokenId),
            clientAddress,
          },
          fromBlock,
          toBlock: latestBlock,
        });

        for (const log of logs) {
          try {
            if (!log.topics || log.topics.length === 0) continue;
            const parsed = decodeEventLog({
              abi: REPUTATION_REGISTRY_ABI as any,
              data: log.data as Hex,
              topics: log.topics as [Hex, ...Hex[]],
            }) as any;
            if (parsed.eventName !== 'NewFeedback') continue;
            const idx = parsed.args?.feedbackIndex;
            if (idx !== undefined && Number(idx) === feedbackIndex) {
              const ep = parsed.args?.endpoint;
              const uri = parsed.args?.feedbackURI ?? parsed.args?.feedbackUri;
              if (typeof ep === 'string' && ep.length > 0) endpoint = ep;
              if (typeof uri === 'string' && uri.length > 0) fileURI = uri;
              break;
            }
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore - still return core on-chain fields
      }

      // Fallback: if endpoint wasn't present on-chain, try reading it from the off-chain file.
      if ((!endpoint || endpoint === '') && fileURI && this.ipfsClient && fileURI.startsWith('ipfs://')) {
        try {
          const cid = fileURI.replace('ipfs://', '');
          const file = await this.ipfsClient.getJson<Record<string, unknown>>(cid);
          const ep = (file as any)?.endpoint;
          if (typeof ep === 'string' && ep.length > 0) {
            endpoint = ep;
          }
        } catch {
          // ignore
        }
      }

      return {
        id: [agentId, clientAddress.toLowerCase(), feedbackIndex] as FeedbackIdTuple,
        agentId,
        reviewer: clientAddress,
        value: decodeReputationValue(rawValue, Number(valueDecimals)),
        tags,
        endpoint,
        fileURI,
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
        minValue: params.minValue,
        maxValue: params.maxValue,
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

    // Map tags (now strings in new spec)
    const tags: string[] = [];
    const tag1 = feedbackData.tag1 || feedbackFile.tag1;
    const tag2 = feedbackData.tag2 || feedbackFile.tag2;

    // Tags are now strings, just filter out empty ones
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
      value: feedbackData.value !== undefined && feedbackData.value !== null ? Number(feedbackData.value) : undefined,
      tags,
      endpoint:
        typeof feedbackData.endpoint === 'string'
          ? (feedbackData.endpoint || undefined)
          : (typeof feedbackFile.endpoint === 'string' ? (feedbackFile.endpoint || undefined) : undefined),
      text: feedbackFile.text || undefined,
      context,
      proofOfPayment,
      fileURI: feedbackData.feedbackURI || feedbackData.feedbackUri || undefined,
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
   * Convert tag strings to array, filtering out empty values
   * Tags are now strings (not bytes32) in the new spec
   */
  private _hexBytes32ToTags(tag1: string, tag2: string): string[] {
    const tags: string[] = [];

    if (tag1 && tag1.trim() !== '') {
          tags.push(tag1);
        }

    if (tag2 && tag2.trim() !== '') {
          tags.push(tag2);
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
    if (!this.reputationRegistryAddress) {
      throw new Error('Reputation registry not available');
    }

    const { tokenId } = parseAgentId(agentId);

    try {
      const txHash = await this.chainClient.writeContract({
        address: this.reputationRegistryAddress,
        abi: REPUTATION_REGISTRY_ABI,
        functionName: 'appendResponse',
        args: [BigInt(tokenId), clientAddress, BigInt(feedbackIndex), responseUri, responseHash],
      });
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
    if (!this.reputationRegistryAddress) {
      throw new Error('Reputation registry not available');
    }

    const { tokenId } = parseAgentId(agentId);

    // Get client address (the one revoking - must be the reviewer)
    await this.chainClient.ensureAddress();

    try {
      const txHash = await this.chainClient.writeContract({
        address: this.reputationRegistryAddress,
        abi: REPUTATION_REGISTRY_ABI,
        functionName: 'revokeFeedback',
        args: [BigInt(tokenId), BigInt(feedbackIndex)],
      });
      return txHash;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to revoke feedback: ${errorMessage}`);
    }
  }


  /**
   * Get reputation summary
   * Supports chainId:agentId format
   */
  async getReputationSummary(
    agentId: AgentId,
    tag1?: string,
    tag2?: string
  ): Promise<{ count: number; averageValue: number }> {
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
            const values = validFeedbacks
              .map((fb: any) => fb.value)
              .filter((v: any) => v !== null && v !== undefined);
            
            if (values.length > 0) {
              const sum = values.reduce((a: number, b: number) => a + Number(b), 0);
              const averageValue = sum / values.length;
              return {
                count: validFeedbacks.length,
                averageValue: Math.round(averageValue * 100) / 100, // Round to 2 decimals
              };
            }
          }

        return { count: 0, averageValue: 0 };
      } catch (error) {
        // Fall through to blockchain query if subgraph fails
      }
    }

    // Fallback to blockchain query (requires matching chain)
    if (!this.reputationRegistryAddress) {
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
      const clients = await this.chainClient.readContract<readonly Address[]>({
        address: this.reputationRegistryAddress,
        abi: REPUTATION_REGISTRY_ABI,
        functionName: 'getClients',
        args: [BigInt(tokenId)],
      });

      if (!clients || clients.length === 0) {
        return { count: 0, averageValue: 0 };
      }

      const [count, summaryValue, summaryValueDecimals] = await this.chainClient.readContract<
        readonly [bigint, bigint, number]
      >({
        address: this.reputationRegistryAddress,
        abi: REPUTATION_REGISTRY_ABI,
        functionName: 'getSummary',
        args: [BigInt(tokenId), clients, tag1 || '', tag2 || ''],
      });

      return {
        count: Number(count),
        averageValue: decodeReputationValue(summaryValue, Number(summaryValueDecimals)),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get reputation summary: ${errorMessage}`);
    }
  }
}

