/**
 * Agent indexer for discovery and search functionality
 * Simplified version focused on subgraph queries (no local ML indexing)
 */

import type { AgentSummary, SearchParams, SearchResultMeta } from '../models/interfaces.js';
import type { AgentId, ChainId } from '../models/types.js';
import type { Web3Client } from './web3-client.js';
import { SubgraphClient } from './subgraph-client.js';
import { normalizeAddress } from '../utils/validation.js';
import { DEFAULT_SUBGRAPH_URLS } from './contracts.js';

/**
 * Simplified indexer that primarily uses subgraph for queries
 * No local indexing or ML capabilities - all queries go through subgraph
 */
export class AgentIndexer {
  constructor(
    private web3Client: Web3Client,
    private subgraphClient?: SubgraphClient,
    private subgraphUrlOverrides?: Record<ChainId, string>
  ) {}

  /**
   * Get agent summary from index/subgraph
   */
  async getAgent(agentId: AgentId): Promise<AgentSummary> {
    // Use subgraph if available (preferred)
    if (this.subgraphClient) {
      const agent = await this.subgraphClient.getAgentById(agentId);
      if (agent) {
        return agent;
      }
    }

    // Fallback: would need to query blockchain directly
    // For now, throw error if not in subgraph
    throw new Error(`Agent ${agentId} not found. Subgraph required for querying.`);
  }

  /**
   * Search agents with filters
   */
  async searchAgents(
    params: SearchParams = {},
    pageSize: number = 50,
    cursor?: string,
    sort: string[] = []
  ): Promise<{ items: AgentSummary[]; nextCursor?: string; meta?: SearchResultMeta }> {
    // Ensure params is always an object
    const searchParams: SearchParams = params || {};

    // Handle "all" chains shorthand
    if (searchParams.chains === 'all') {
      searchParams.chains = this._getAllConfiguredChains();
    }

    // If chains are explicitly specified (even a single chain), use multi-chain path
    if (searchParams.chains && Array.isArray(searchParams.chains) && searchParams.chains.length > 0) {
      // Validate chains are configured
      const availableChains = new Set(this._getAllConfiguredChains());
      const requestedChains = new Set(searchParams.chains);
      const invalidChains = [...requestedChains].filter(c => !availableChains.has(c));

      if (invalidChains.length > 0) {
        // Filter to valid chains only
        const validChains = searchParams.chains.filter(c => availableChains.has(c));
        if (validChains.length === 0) {
          return {
            items: [],
            nextCursor: undefined,
            meta: {
              chains: searchParams.chains,
              successfulChains: [],
              failedChains: searchParams.chains,
              totalResults: 0,
              timing: { totalMs: 0 },
            },
          };
        }
        searchParams.chains = validChains;
      }

      // Use multi-chain search if multiple chains or single chain different from default
      if (searchParams.chains.length > 1) {
        return this._searchAgentsAcrossChains(searchParams, sort, pageSize, cursor);
      }
    }

    // Single-chain search (existing logic)
    if (!this.subgraphClient) {
      throw new Error('Subgraph client required for agent search');
    }

    // Parse cursor for pagination
    const skip = cursor ? parseInt(cursor, 10) : 0;

    // Use subgraph search which pushes filters and pagination to subgraph level (much more efficient)
    // Fetch one extra record to check if there's a next page
    let agents = await this.subgraphClient.searchAgents(searchParams, pageSize + 1, skip);
    
    // Apply any remaining client-side filtering (for complex filters like array contains)
    agents = this._filterAgents(agents, searchParams);

    // Check if there are more results (we fetched pageSize + 1)
    const hasMore = agents.length > pageSize;
    const paginatedAgents = hasMore ? agents.slice(0, pageSize) : agents;

    // Return next cursor if we have more results
    const nextCursor = hasMore ? String(skip + pageSize) : undefined;

    return {
      items: paginatedAgents,
      nextCursor,
    };
  }

  private _filterAgents(agents: AgentSummary[], params: SearchParams): AgentSummary[] {
    const {
      name,
      mcp,
      a2a,
      ens,
      did,
      walletAddress,
      supportedTrust,
      a2aSkills,
      mcpTools,
      mcpPrompts,
      mcpResources,
      active,
      x402support,
      chains,
    } = params;

    return agents.filter(agent => {
      // Filter by name (flattened from registrationFile)
      if (name && !agent.name?.toLowerCase().includes(name.toLowerCase())) {
        return false;
      }

      // Filter by MCP endpoint (flattened to agent.mcp boolean)
      if (mcp !== undefined && agent.mcp !== mcp) {
        return false;
      }

      // Filter by A2A endpoint (flattened to agent.a2a boolean)
      if (a2a !== undefined && agent.a2a !== a2a) {
        return false;
      }

      // Filter by ENS (flattened from registrationFile)
      if (ens && agent.ens && normalizeAddress(agent.ens) !== normalizeAddress(ens)) {
        return false;
      }

      // Filter by DID (flattened from registrationFile)
      if (did && agent.did !== did) {
        return false;
      }

      // Filter by wallet address (flattened from registrationFile)
      if (walletAddress && agent.walletAddress && normalizeAddress(agent.walletAddress) !== normalizeAddress(walletAddress)) {
        return false;
      }

      // Filter by supported trusts (flattened from registrationFile)
      if (supportedTrust && supportedTrust.length > 0) {
        const agentTrusts = agent.supportedTrusts || [];
        if (!supportedTrust.some((trust: any) => agentTrusts.includes(trust))) {
          return false;
        }
      }

      // Filter by A2A skills (flattened from registrationFile)
      if (a2aSkills && a2aSkills.length > 0) {
        const agentSkills = agent.a2aSkills || [];
        if (!a2aSkills.some(skill => agentSkills.includes(skill))) {
          return false;
        }
      }

      // Filter by MCP tools (flattened from registrationFile)
      if (mcpTools && mcpTools.length > 0) {
        const agentTools = agent.mcpTools || [];
        if (!mcpTools.some(tool => agentTools.includes(tool))) {
          return false;
        }
      }

      // Filter by MCP prompts (flattened from registrationFile)
      if (mcpPrompts && mcpPrompts.length > 0) {
        const agentPrompts = agent.mcpPrompts || [];
        if (!mcpPrompts.some(prompt => agentPrompts.includes(prompt))) {
          return false;
        }
      }

      // Filter by MCP resources (flattened from registrationFile)
      if (mcpResources && mcpResources.length > 0) {
        const agentResources = agent.mcpResources || [];
        if (!mcpResources.some(resource => agentResources.includes(resource))) {
          return false;
        }
      }

      // Filter by active status (flattened from registrationFile)
      if (active !== undefined && agent.active !== active) {
        return false;
      }

      // Filter by x402support (flattened from registrationFile)
      if (x402support !== undefined && agent.x402support !== x402support) {
        return false;
      }

      // Filter by chain (only if chains is an array, not 'all')
      if (chains && Array.isArray(chains) && chains.length > 0 && !chains.includes(agent.chainId)) {
        return false;
      }

      return true;
    });
  }

  /**
   * Get all configured chains (chains with subgraph URLs)
   */
  private _getAllConfiguredChains(): ChainId[] {
    const chains: ChainId[] = [];
    
    // Add chains from overrides
    if (this.subgraphUrlOverrides) {
      chains.push(...Object.keys(this.subgraphUrlOverrides).map(Number));
    }
    
    // Add chains from defaults
    for (const chainId of Object.keys(DEFAULT_SUBGRAPH_URLS)) {
      const chainIdNum = Number(chainId);
      if (!chains.includes(chainIdNum)) {
        chains.push(chainIdNum);
      }
    }
    
    return chains.sort((a, b) => a - b);
  }

  /**
   * Get subgraph client for a specific chain
   */
  private _getSubgraphClientForChain(chainId: ChainId): SubgraphClient | null {
    // Check overrides first
    let subgraphUrl: string | undefined;
    if (this.subgraphUrlOverrides && chainId in this.subgraphUrlOverrides) {
      subgraphUrl = this.subgraphUrlOverrides[chainId];
    } else if (chainId in DEFAULT_SUBGRAPH_URLS) {
      subgraphUrl = DEFAULT_SUBGRAPH_URLS[chainId];
    }
    
    if (!subgraphUrl) {
      return null;
    }
    
    return new SubgraphClient(subgraphUrl);
  }

  /**
   * Parse multi-chain pagination cursor
   */
  private _parseMultiChainCursor(cursor?: string): { _global_offset: number } {
    if (!cursor) {
      return { _global_offset: 0 };
    }
    
    try {
      const parsed = JSON.parse(cursor);
      return {
        _global_offset: typeof parsed._global_offset === 'number' ? parsed._global_offset : 0,
      };
    } catch {
      // Fallback: try to parse as simple number
      const offset = parseInt(cursor, 10);
      return { _global_offset: isNaN(offset) ? 0 : offset };
    }
  }

  /**
   * Create multi-chain pagination cursor
   */
  private _createMultiChainCursor(globalOffset: number): string {
    return JSON.stringify({ _global_offset: globalOffset });
  }

  /**
   * Apply cross-chain filters (for fields not supported by subgraph WHERE clause)
   */
  private _applyCrossChainFilters(agents: AgentSummary[], params: SearchParams): AgentSummary[] {
    return this._filterAgents(agents, params);
  }

  /**
   * Deduplicate agents across chains (by name and description)
   */
  private _deduplicateAgentsCrossChain(agents: AgentSummary[], params: SearchParams): AgentSummary[] {
    // For now, return as-is (no deduplication)
    // Python SDK has deduplication logic but it's optional
    return agents;
  }

  /**
   * Sort agents across chains
   */
  private _sortAgentsCrossChain(agents: AgentSummary[], sort: string[]): AgentSummary[] {
    if (!sort || sort.length === 0) {
      return agents;
    }

    const sortField = sort[0].split(':');
    const field = sortField[0] || 'createdAt';
    const direction = (sortField[1] as 'asc' | 'desc') || 'desc';

    return [...agents].sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (field) {
        case 'createdAt':
          aVal = a.extras?.createdAt || 0;
          bVal = b.extras?.createdAt || 0;
          break;
        case 'name':
          aVal = a.name?.toLowerCase() || '';
          bVal = b.name?.toLowerCase() || '';
          break;
        case 'chainId':
          aVal = a.chainId;
          bVal = b.chainId;
          break;
        default:
          aVal = a.extras?.[field] || 0;
          bVal = b.extras?.[field] || 0;
      }

      if (aVal < bVal) return direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return direction === 'asc' ? 1 : -1;
      return 0;
    });
  }

  /**
   * Search agents across multiple chains in parallel
   */
  private async _searchAgentsAcrossChains(
    params: SearchParams,
    sort: string[],
    pageSize: number,
    cursor?: string,
    timeout: number = 30000
  ): Promise<{ items: AgentSummary[]; nextCursor?: string; meta: SearchResultMeta }> {
    const startTime = Date.now();

    // Step 1: Determine which chains to query
    const chainsToQuery = (params.chains && Array.isArray(params.chains) && params.chains.length > 0)
      ? params.chains
      : this._getAllConfiguredChains();

    if (chainsToQuery.length === 0) {
      return {
        items: [],
        nextCursor: undefined,
        meta: {
          chains: [],
          successfulChains: [],
          failedChains: [],
          totalResults: 0,
          timing: { totalMs: 0 },
        },
      };
    }

    // Step 2: Parse pagination cursor
    const chainCursors = this._parseMultiChainCursor(cursor);
    const globalOffset = chainCursors._global_offset;

    // Step 3: Define async function for querying a single chain
    const querySingleChain = async (chainId: ChainId): Promise<{
      chainId: ChainId;
      status: 'success' | 'error' | 'timeout' | 'unavailable';
      agents: AgentSummary[];
      error?: string;
    }> => {
      try {
        const subgraphClient = this._getSubgraphClientForChain(chainId);

        if (!subgraphClient) {
          return {
            chainId,
            status: 'unavailable',
            agents: [],
            error: `No subgraph configured for chain ${chainId}`,
          };
        }

        // Build search params for this chain (remove chains filter)
        const chainParams: SearchParams = { ...params };
        delete chainParams.chains;

        // Execute subgraph query (fetch extra to allow for filtering/sorting)
        const agents = await subgraphClient.searchAgents(chainParams, pageSize * 3, 0);

        return {
          chainId,
          status: 'success',
          agents,
        };
      } catch (error) {
        return {
          chainId,
          status: 'error',
          agents: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    };

    // Step 4: Execute all chain queries in parallel with timeout
    const chainPromises = chainsToQuery.map(chainId => {
      return Promise.race([
        querySingleChain(chainId),
        new Promise<{ chainId: ChainId; status: 'timeout'; agents: AgentSummary[] }>((resolve) => {
          setTimeout(() => {
            resolve({
              chainId,
              status: 'timeout',
              agents: [],
            });
          }, timeout);
        }),
      ]);
    });

    const chainResults = await Promise.allSettled(chainPromises);

    // Step 5: Extract successful results and track failures
    const allAgents: AgentSummary[] = [];
    const successfulChains: ChainId[] = [];
    const failedChains: ChainId[] = [];

    for (let i = 0; i < chainResults.length; i++) {
      const result = chainResults[i];
      const chainId = chainsToQuery[i];

      if (result.status === 'fulfilled') {
        const chainResult = result.value;

        if (chainResult.status === 'success') {
          successfulChains.push(chainId);
          allAgents.push(...chainResult.agents);
        } else {
          failedChains.push(chainId);
        }
      } else {
        // Promise rejected
        failedChains.push(chainId);
      }
    }

    // If ALL chains failed, return error metadata
    if (successfulChains.length === 0) {
      const queryTime = Date.now() - startTime;
      return {
        items: [],
        nextCursor: undefined,
        meta: {
          chains: chainsToQuery,
          successfulChains: [],
          failedChains,
          totalResults: 0,
          timing: { totalMs: queryTime },
        },
      };
    }

    // Step 6: Apply cross-chain filtering
    const filteredAgents = this._applyCrossChainFilters(allAgents, params);

    // Step 7: Deduplicate if requested
    const deduplicatedAgents = this._deduplicateAgentsCrossChain(filteredAgents, params);

    // Step 8: Sort across chains
    const sortedAgents = this._sortAgentsCrossChain(deduplicatedAgents, sort);

    // Step 9: Paginate
    const startIdx = globalOffset;
    const endIdx = startIdx + pageSize;
    const paginatedAgents = sortedAgents.slice(startIdx, endIdx);

    // Step 10: Calculate next cursor
    const nextCursor = sortedAgents.length > endIdx
      ? this._createMultiChainCursor(endIdx)
      : undefined;

    // Step 11: Build response with metadata
    const queryTime = Date.now() - startTime;

    return {
      items: paginatedAgents,
      nextCursor,
      meta: {
        chains: chainsToQuery,
        successfulChains,
        failedChains,
        totalResults: sortedAgents.length,
        timing: {
          totalMs: queryTime,
          averagePerChainMs: chainsToQuery.length > 0 ? Math.floor(queryTime / chainsToQuery.length) : undefined,
        },
      },
    };
  }

  /**
   * Search agents by reputation
   */
  async searchAgentsByReputation(
    agents?: string[],
    tags?: string[],
    reviewers?: string[],
    capabilities?: string[],
    skills?: string[],
    tasks?: string[],
    names?: string[],
    minAverageScore?: number,
    includeRevoked: boolean = false,
    first: number = 50,
    skip: number = 0,
    sort: string[] = ['createdAt:desc'],
    chains?: ChainId[] | 'all'
  ): Promise<{ items: AgentSummary[]; nextCursor?: string; meta?: SearchResultMeta }> {
    // Handle "all" chains shorthand
    let chainsToQuery: ChainId[] | undefined;
    if (chains === 'all') {
      chainsToQuery = this._getAllConfiguredChains();
    } else if (chains && Array.isArray(chains) && chains.length > 0) {
      chainsToQuery = chains;
    }

    // If chains are specified, use multi-chain search
    // Route to multi-chain if multiple chains OR if single chain is specified (to ensure correct subgraph client)
    if (chainsToQuery && chainsToQuery.length > 0) {
      return this._searchAgentsByReputationAcrossChains(
        agents,
        tags,
        reviewers,
        capabilities,
        skills,
        tasks,
        names,
        minAverageScore,
        includeRevoked,
        first,
        skip,
        sort,
        chainsToQuery
      );
    }

    // Single-chain search (existing logic)
    if (!this.subgraphClient) {
      throw new Error('Subgraph client required for reputation search');
    }

    // Parse sort parameter
    let orderBy = 'createdAt';
    let orderDirection: 'asc' | 'desc' = 'desc';
    if (sort && sort.length > 0) {
      const sortField = sort[0].split(':');
      orderBy = sortField[0] || orderBy;
      orderDirection = (sortField[1] as 'asc' | 'desc') || orderDirection;
    }

    try {
      const agentsData = await this.subgraphClient.searchAgentsByReputation(
        agents,
        tags,
        reviewers,
        capabilities,
        skills,
        tasks,
        names,
        minAverageScore,
        includeRevoked,
        first,
        skip,
        orderBy,
        orderDirection
      );

      // Transform to AgentSummary with averageScore in extras
      const items: AgentSummary[] = agentsData.map((agent) => {
        const regFile = agent.registrationFile;
        
        return {
          chainId: parseInt(agent.chainId?.toString() || '0', 10),
          agentId: agent.id || '',
          name: regFile?.name || '',
          image: regFile?.image || undefined,
          description: regFile?.description || '',
          owners: agent.owner ? [normalizeAddress(agent.owner)] : [],
          operators: (agent.operators || []).map((op: string) => normalizeAddress(op)),
          mcp: !!regFile?.mcpEndpoint,
          a2a: !!regFile?.a2aEndpoint,
          ens: regFile?.ens || undefined,
          did: regFile?.did || undefined,
          walletAddress: regFile?.agentWallet ? normalizeAddress(regFile.agentWallet) : undefined,
          supportedTrusts: regFile?.supportedTrusts || [],
          a2aSkills: regFile?.a2aSkills || [],
          mcpTools: regFile?.mcpTools || [],
          mcpPrompts: regFile?.mcpPrompts || [],
          mcpResources: regFile?.mcpResources || [],
          active: regFile?.active ?? false,
          x402support: regFile?.x402support ?? false,
          extras: {
            averageScore: agent.averageScore !== null ? agent.averageScore : undefined,
          },
        };
      });

      const nextCursor = items.length === first ? String(skip + items.length) : undefined;

      return {
        items,
        nextCursor,
      };
    } catch (error) {
      throw new Error(`Failed to search agents by reputation: ${error}`);
    }
  }

  /**
   * Search agents by reputation across multiple chains in parallel
   */
  private async _searchAgentsByReputationAcrossChains(
    agents?: string[],
    tags?: string[],
    reviewers?: string[],
    capabilities?: string[],
    skills?: string[],
    tasks?: string[],
    names?: string[],
    minAverageScore?: number,
    includeRevoked: boolean = false,
    pageSize: number = 50,
    skip: number = 0,
    sort: string[] = ['createdAt:desc'],
    chains: ChainId[] = [],
    timeout: number = 30000
  ): Promise<{ items: AgentSummary[]; nextCursor?: string; meta: SearchResultMeta }> {
    const startTime = Date.now();

    if (chains.length === 0) {
      return {
        items: [],
        nextCursor: undefined,
        meta: {
          chains: [],
          successfulChains: [],
          failedChains: [],
          totalResults: 0,
          timing: { totalMs: 0 },
        },
      };
    }

    // Parse sort parameter
    let orderBy = 'createdAt';
    let orderDirection: 'asc' | 'desc' = 'desc';
    if (sort && sort.length > 0) {
      const sortField = sort[0].split(':');
      orderBy = sortField[0] || orderBy;
      orderDirection = (sortField[1] as 'asc' | 'desc') || orderDirection;
    }

    // Define async function for querying a single chain
    const querySingleChain = async (chainId: ChainId): Promise<{
      chainId: ChainId;
      status: 'success' | 'error' | 'timeout' | 'unavailable';
      agents: Array<any>; // Will be transformed to AgentSummary later
      error?: string;
    }> => {
      try {
        const subgraphClient = this._getSubgraphClientForChain(chainId);

        if (!subgraphClient) {
          return {
            chainId,
            status: 'unavailable',
            agents: [],
            error: `No subgraph configured for chain ${chainId}`,
          };
        }

        // Execute reputation search query
        try {
          const agentsData = await subgraphClient.searchAgentsByReputation(
            agents,
            tags,
            reviewers,
            capabilities,
            skills,
            tasks,
            names,
            minAverageScore,
            includeRevoked,
            pageSize * 3, // Fetch extra to allow for filtering/sorting
            0, // We'll handle pagination after aggregation
            orderBy,
            orderDirection
          );

          return {
            chainId,
            status: 'success',
            agents: agentsData,
          };
        } catch (error) {
          return {
            chainId,
            status: 'error',
            agents: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      } catch (error) {
        return {
          chainId,
          status: 'error',
          agents: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    };

    // Execute all chain queries in parallel with timeout
    const chainPromises = chains.map(chainId => {
      return Promise.race([
        querySingleChain(chainId),
        new Promise<{ chainId: ChainId; status: 'timeout'; agents: any[] }>((resolve) => {
          setTimeout(() => {
            resolve({
              chainId,
              status: 'timeout',
              agents: [],
            });
          }, timeout);
        }),
      ]);
    });

    const chainResults = await Promise.allSettled(chainPromises);

    // Extract successful results and track failures
    const allAgents: Array<any> = []; // Will be transformed to AgentSummary later
    const successfulChains: ChainId[] = [];
    const failedChains: ChainId[] = [];

    for (let i = 0; i < chainResults.length; i++) {
      const result = chainResults[i];
      const chainId = chains[i];

      if (result.status === 'fulfilled') {
        const chainResult = result.value;

        if (chainResult.status === 'success') {
          successfulChains.push(chainId);
          allAgents.push(...chainResult.agents);
        } else {
          failedChains.push(chainId);
        }
      } else {
        failedChains.push(chainId);
      }
    }

    // If ALL chains failed, return error metadata
    if (successfulChains.length === 0) {
      const queryTime = Date.now() - startTime;
      return {
        items: [],
        nextCursor: undefined,
        meta: {
          chains,
          successfulChains: [],
          failedChains,
          totalResults: 0,
          timing: { totalMs: queryTime },
        },
      };
    }

    // Transform to AgentSummary with averageScore in extras
    const results: AgentSummary[] = allAgents.map((agent) => {
      const regFile = agent.registrationFile || {};
      
      return {
        chainId: parseInt(agent.chainId?.toString() || '0', 10),
        agentId: agent.id || '',
        name: regFile?.name || '',
        image: regFile?.image || undefined,
        description: regFile?.description || '',
        owners: agent.owner ? [normalizeAddress(agent.owner)] : [],
        operators: (agent.operators || []).map((op: string) => normalizeAddress(op)),
        mcp: !!regFile?.mcpEndpoint,
        a2a: !!regFile?.a2aEndpoint,
        ens: regFile?.ens || undefined,
        did: regFile?.did || undefined,
        walletAddress: regFile?.agentWallet ? normalizeAddress(regFile.agentWallet) : undefined,
        supportedTrusts: regFile?.supportedTrusts || [],
        a2aSkills: regFile?.a2aSkills || [],
        mcpTools: regFile?.mcpTools || [],
        mcpPrompts: regFile?.mcpPrompts || [],
        mcpResources: regFile?.mcpResources || [],
        active: regFile?.active ?? false,
        x402support: regFile?.x402support ?? false,
        extras: {
          averageScore: agent.averageScore !== null ? agent.averageScore : undefined,
        },
      };
    });

    // Sort by averageScore (descending) if available, otherwise by createdAt
    results.sort((a, b) => {
      const aScore = a.extras?.averageScore ?? 0;
      const bScore = b.extras?.averageScore ?? 0;
      if (aScore !== bScore) {
        return bScore - aScore; // Descending
      }
      // Secondary sort by chainId, then agentId
      if (a.chainId !== b.chainId) {
        return a.chainId - b.chainId;
      }
      return a.agentId.localeCompare(b.agentId);
    });

    // Apply pagination
    const paginatedResults = results.slice(skip, skip + pageSize);
    const nextCursor = results.length > skip + pageSize
      ? String(skip + pageSize)
      : undefined;

    // Build response with metadata
    const queryTime = Date.now() - startTime;

    return {
      items: paginatedResults,
      nextCursor,
      meta: {
        chains,
        successfulChains,
        failedChains,
        totalResults: results.length,
        timing: {
          totalMs: queryTime,
          averagePerChainMs: chains.length > 0 ? Math.floor(queryTime / chains.length) : undefined,
        },
      },
    };
  }
}

