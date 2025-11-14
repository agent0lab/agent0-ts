/**
 * Subgraph client for querying The Graph network
 */

import { GraphQLClient } from 'graphql-request';
import type { AgentSummary, SearchParams } from '../models/interfaces.js';
import { normalizeAddress } from '../utils/validation.js';
import type { Agent, AgentRegistrationFile } from '../models/generated/subgraph-types.js';

export interface SubgraphQueryOptions {
  where?: Record<string, unknown>;
  first?: number;
  skip?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
  includeRegistrationFile?: boolean;
}

// Type representing the agent data returned from our queries
// Note: Queries return partial Agent objects (not all fields are queried)
export type QueryAgent = Pick<Agent, 'id' | 'chainId' | 'agentId' | 'owner' | 'operators' | 'agentURI' | 'createdAt' | 'updatedAt'> & {
  registrationFile?: AgentRegistrationFile | null;
};

/**
 * Client for querying the subgraph GraphQL API
 */
export class SubgraphClient {
  private client: GraphQLClient;

  constructor(subgraphUrl: string) {
    this.client = new GraphQLClient(subgraphUrl, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Execute a GraphQL query against the subgraph
   */
  async query<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
    try {
      const data = await this.client.request<T>(query, variables || {});
      return data;
    } catch (error) {
      throw new Error(`Failed to query subgraph: ${error}`);
    }
  }

  /**
   * Query agents from the subgraph
   */
  async getAgents(options: SubgraphQueryOptions = {}): Promise<AgentSummary[]> {
    const {
      where = {},
      first = 100,
      skip = 0,
      orderBy = 'createdAt',
      orderDirection = 'desc',
      includeRegistrationFile = true,
    } = options;

    // Support Agent-level filters and nested registrationFile filters
    const supportedWhere: Record<string, unknown> = {};
    if (where.agentId) supportedWhere.agentId = where.agentId;
    if (where.owner) supportedWhere.owner = where.owner;
    if (where.owner_in) supportedWhere.owner_in = where.owner_in;
    if (where.operators_contains) supportedWhere.operators_contains = where.operators_contains;
    if (where.agentURI) supportedWhere.agentURI = where.agentURI;
    if (where.registrationFile_not !== undefined) supportedWhere.registrationFile_not = where.registrationFile_not;

    // Support nested registrationFile filters (pushed to subgraph level)
    // Note: Python SDK uses "registrationFile_" (with underscore) for nested filters
    if (where.registrationFile) {
      supportedWhere.registrationFile_ = where.registrationFile;
    }
    if (where.registrationFile_) {
      supportedWhere.registrationFile_ = where.registrationFile_;
    }

    // Build WHERE clause with support for nested filters
    let whereClause = '';
    if (Object.keys(supportedWhere).length > 0) {
      const conditions: string[] = [];
      for (const [key, value] of Object.entries(supportedWhere)) {
        if ((key === 'registrationFile' || key === 'registrationFile_') && typeof value === 'object') {
          // Handle nested registrationFile filters
          // Python SDK uses "registrationFile_" (with underscore) for nested filters in GraphQL
          const nestedConditions: string[] = [];
          for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
            if (typeof nestedValue === 'boolean') {
              nestedConditions.push(`${nestedKey}: ${nestedValue.toString().toLowerCase()}`);
            } else if (typeof nestedValue === 'string') {
              nestedConditions.push(`${nestedKey}: "${nestedValue}"`);
            } else if (nestedValue === null) {
              if (nestedKey.endsWith('_not')) {
                nestedConditions.push(`${nestedKey}: null`);
              } else {
                nestedConditions.push(`${nestedKey}_not: null`);
              }
            }
          }
          if (nestedConditions.length > 0) {
            conditions.push(`registrationFile_: { ${nestedConditions.join(', ')} }`);
          }
        } else if (typeof value === 'boolean') {
          conditions.push(`${key}: ${value.toString().toLowerCase()}`);
        } else if (typeof value === 'string') {
          conditions.push(`${key}: "${value}"`);
        } else if (typeof value === 'number') {
          conditions.push(`${key}: ${value}`);
        } else if (Array.isArray(value)) {
          conditions.push(`${key}: ${JSON.stringify(value)}`);
        } else if (value === null) {
          // Don't add _not if the key already ends with _not (e.g., registrationFile_not)
          const filterKey = key.endsWith('_not') ? key : `${key}_not`;
          conditions.push(`${filterKey}: null`);
        }
      }
      if (conditions.length > 0) {
        whereClause = `where: { ${conditions.join(', ')} }`;
      }
    }

    // Build registration file fragment
    const regFileFragment = includeRegistrationFile
      ? `
          registrationFile {
            id
            agentId
            name
            description
            image
            active
            x402support
            supportedTrusts
            mcpEndpoint
            mcpVersion
            a2aEndpoint
            a2aVersion
            ens
            did
            agentWallet
            agentWalletChainId
            mcpTools
            mcpPrompts
            mcpResources
            a2aSkills
          }
    `
      : '';

    const query = `
      query GetAgents($first: Int!, $skip: Int!, $orderBy: Agent_orderBy!, $orderDirection: OrderDirection!) {
        agents(
          ${whereClause}
          first: $first
          skip: $skip
          orderBy: $orderBy
          orderDirection: $orderDirection
        ) {
          id
          chainId
          agentId
          owner
          operators
          agentURI
          createdAt
          updatedAt
          ${regFileFragment}
        }
      }
    `;

    // GraphQL enum expects lowercase
    const variables = {
      first,
      skip,
      orderBy,
      orderDirection: orderDirection.toLowerCase() as 'asc' | 'desc',
    };

    try {
      const data = await this.query<{ agents: QueryAgent[] }>(query, variables);
      return (data.agents || []).map((agent) => this._transformAgent(agent)) as AgentSummary[];
    } catch (error) {
      throw new Error(`Failed to get agents from subgraph: ${error}`);
    }
  }

  /**
   * Get a single agent by ID
   */
  async getAgentById(agentId: string): Promise<AgentSummary | null> {
    const query = `
      query GetAgent($agentId: String!) {
        agent(id: $agentId) {
          id
          chainId
          agentId
          owner
          operators
          agentURI
          createdAt
          updatedAt
          registrationFile {
            id
            agentId
            name
            description
            image
            active
            x402support
            supportedTrusts
            mcpEndpoint
            mcpVersion
            a2aEndpoint
            a2aVersion
            ens
            did
            agentWallet
            agentWalletChainId
            mcpTools
            mcpPrompts
            mcpResources
            a2aSkills
          }
        }
      }
    `;

    try {
      const data = await this.query<{ agent: QueryAgent | null }>(query, { agentId });
      if (!data.agent) {
        return null;
      }
      return this._transformAgent(data.agent) as AgentSummary;
    } catch (error) {
      throw new Error(`Failed to get agent from subgraph: ${error}`);
    }
  }

  /**
   * Transform raw subgraph agent data to AgentSummary
   */
  private _transformAgent(agent: QueryAgent): Partial<AgentSummary> {
    // Fields from Agent entity
    const chainId = parseInt(agent.chainId?.toString() || '0', 10);
    const agentIdStr = agent.id || `${chainId}:${agent.agentId?.toString() || '0'}`;
    
    // Fields from AgentRegistrationFile (registrationFile)
    const regFile = agent.registrationFile;
    
    // Transform operators from Bytes array to Address array
    const operators = (agent.operators || []).map((op: string) => 
      typeof op === 'string' ? normalizeAddress(op) : op
    );
    
    return {
      chainId,
      agentId: agentIdStr,
      name: regFile?.name || '',
      image: regFile?.image || undefined,
      description: regFile?.description || '',
      owners: agent.owner ? [normalizeAddress(agent.owner)] : [],
      operators,
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
      extras: {},
    };
  }

  /**
   * Search agents with filters (delegates to getAgents with WHERE clause)
   * @param params Search parameters
   * @param first Maximum number of results to return (default: 100)
   * @param skip Number of results to skip for pagination (default: 0)
   */
  async searchAgents(
    params: SearchParams,
    first: number = 100,
    skip: number = 0
  ): Promise<AgentSummary[]> {
    const where: Record<string, unknown> = {
      registrationFile_not: null  // Only get agents with registration files
    };

    // Note: Most search fields are in registrationFile, so we need to filter after fetching
    // For now, we'll do basic filtering on Agent fields and then filter on registrationFile fields
    if (params.active !== undefined || params.mcp !== undefined || params.a2a !== undefined ||
        params.x402support !== undefined || params.ens || params.walletAddress ||
        params.supportedTrust || params.a2aSkills || params.mcpTools || params.name ||
        params.owners || params.operators) {
      // Push basic filters to subgraph using nested registrationFile filters
      const registrationFileFilters: Record<string, unknown> = {};
      if (params.active !== undefined) registrationFileFilters.active = params.active;
      if (params.x402support !== undefined) registrationFileFilters.x402support = params.x402support;
      if (params.ens) registrationFileFilters.ens = params.ens.toLowerCase();
      if (params.walletAddress) registrationFileFilters.agentWallet = params.walletAddress.toLowerCase();
      if (params.mcp !== undefined) {
        registrationFileFilters[params.mcp ? 'mcpEndpoint_not' : 'mcpEndpoint'] = null;
      }
      if (params.a2a !== undefined) {
        registrationFileFilters[params.a2a ? 'a2aEndpoint_not' : 'a2aEndpoint'] = null;
      }

      const whereWithFilters: Record<string, unknown> = {};
      if (Object.keys(registrationFileFilters).length > 0) {
        // Python SDK uses "registrationFile_" (with underscore) for nested filters
        whereWithFilters.registrationFile_ = registrationFileFilters;
      }

      // Owner filtering (at Agent level, not registrationFile)
      if (params.owners && params.owners.length > 0) {
        // Normalize addresses to lowercase for case-insensitive matching
        const normalizedOwners = params.owners.map(owner => owner.toLowerCase());
        if (normalizedOwners.length === 1) {
          whereWithFilters.owner = normalizedOwners[0];
        } else {
          whereWithFilters.owner_in = normalizedOwners;
        }
      }

      // Operator filtering (at Agent level, not registrationFile)
      if (params.operators && params.operators.length > 0) {
        // Normalize addresses to lowercase for case-insensitive matching
        const normalizedOperators = params.operators.map(op => op.toLowerCase());
        // For operators (array field), use contains to check if any operator matches
        whereWithFilters.operators_contains = normalizedOperators;
      }

      // Fetch records with filters and pagination applied at subgraph level
      const allAgents = await this.getAgents({ where: whereWithFilters, first, skip });

      // Only filter client-side for fields that can't be filtered at subgraph level
      // Fields already filtered at subgraph level: active, x402support, mcp, a2a, ens, walletAddress, owners, operators
      return allAgents.filter((agent) => {
        // Name filtering (substring search - not supported at subgraph level)
        if (params.name && !agent.name.toLowerCase().includes(params.name.toLowerCase())) {
          return false;
        }
        // Array contains filtering (supportedTrust, a2aSkills, mcpTools) - these require array contains logic
        if (params.supportedTrust && params.supportedTrust.length > 0) {
          const hasAllTrusts = params.supportedTrust.every(trust =>
            agent.supportedTrusts.includes(trust)
          );
          if (!hasAllTrusts) return false;
        }
        if (params.a2aSkills && params.a2aSkills.length > 0) {
          const hasAllSkills = params.a2aSkills.every(skill =>
            agent.a2aSkills.includes(skill)
          );
          if (!hasAllSkills) return false;
        }
        if (params.mcpTools && params.mcpTools.length > 0) {
          const hasAllTools = params.mcpTools.every(tool =>
            agent.mcpTools.includes(tool)
          );
          if (!hasAllTools) return false;
        }
        return true;
      });
    }

    return this.getAgents({ where, first, skip });
  }

  /**
   * Search feedback with filters
   */
  async searchFeedback(
    params: {
      agents?: string[];
      reviewers?: string[];
      tags?: string[];
      capabilities?: string[];
      skills?: string[];
      tasks?: string[];
      names?: string[];
      minScore?: number;
      maxScore?: number;
      includeRevoked?: boolean;
    },
    first: number = 100,
    skip: number = 0,
    orderBy: string = 'createdAt',
    orderDirection: 'asc' | 'desc' = 'desc'
  ): Promise<any[]> {
    // Build WHERE clause from params
    const whereConditions: string[] = [];

    if (params.agents && params.agents.length > 0) {
      const agentIds = params.agents.map((aid) => `"${aid}"`).join(', ');
      whereConditions.push(`agent_in: [${agentIds}]`);
    }

    if (params.reviewers && params.reviewers.length > 0) {
      const reviewers = params.reviewers.map((addr) => `"${addr}"`).join(', ');
      whereConditions.push(`clientAddress_in: [${reviewers}]`);
    }

    if (!params.includeRevoked) {
      whereConditions.push('isRevoked: false');
    }

    // Build all non-tag conditions first
    const nonTagConditions = [...whereConditions];

    // Handle tag filtering separately - it needs to be at the top level
    let tagFilterCondition: string | null = null;
    if (params.tags && params.tags.length > 0) {
      // Tag search: any of the tags must match in tag1 OR tag2
      // Build complete condition with all filters for each tag alternative
      const tagWhereItems: string[] = [];
      for (const tag of params.tags) {
        // For tag1 match
        const allConditionsTag1 = [...nonTagConditions, `tag1: "${tag}"`];
        tagWhereItems.push(`{ ${allConditionsTag1.join(', ')} }`);
        // For tag2 match
        const allConditionsTag2 = [...nonTagConditions, `tag2: "${tag}"`];
        tagWhereItems.push(`{ ${allConditionsTag2.join(', ')} }`);
      }
      // Join all tag alternatives
      tagFilterCondition = tagWhereItems.join(', ');
    }

    if (params.minScore !== undefined) {
      whereConditions.push(`score_gte: ${params.minScore}`);
    }

    if (params.maxScore !== undefined) {
      whereConditions.push(`score_lte: ${params.maxScore}`);
    }

    // Feedback file filters
    const feedbackFileFilters: string[] = [];

    if (params.capabilities && params.capabilities.length > 0) {
      const capabilities = params.capabilities.map((cap) => `"${cap}"`).join(', ');
      feedbackFileFilters.push(`capability_in: [${capabilities}]`);
    }

    if (params.skills && params.skills.length > 0) {
      const skills = params.skills.map((skill) => `"${skill}"`).join(', ');
      feedbackFileFilters.push(`skill_in: [${skills}]`);
    }

    if (params.tasks && params.tasks.length > 0) {
      const tasks = params.tasks.map((task) => `"${task}"`).join(', ');
      feedbackFileFilters.push(`task_in: [${tasks}]`);
    }

    if (params.names && params.names.length > 0) {
      const names = params.names.map((name) => `"${name}"`).join(', ');
      feedbackFileFilters.push(`name_in: [${names}]`);
    }

    if (feedbackFileFilters.length > 0) {
      whereConditions.push(`feedbackFile_: { ${feedbackFileFilters.join(', ')} }`);
    }

    // Use tag_filter_condition if tags were provided, otherwise use standard where clause
    let whereClause = '';
    if (tagFilterCondition) {
      // tagFilterCondition already contains properly formatted items
      whereClause = `where: { or: [${tagFilterCondition}] }`;
    } else if (whereConditions.length > 0) {
      whereClause = `where: { ${whereConditions.join(', ')} }`;
    }

    const query = `
      {
        feedbacks(
          ${whereClause}
          first: ${first}
          skip: ${skip}
          orderBy: ${orderBy}
          orderDirection: ${orderDirection}
        ) {
          id
          agent { id agentId chainId }
          clientAddress
          score
          tag1
          tag2
          feedbackUri
          feedbackURIType
          feedbackHash
          isRevoked
          createdAt
          revokedAt
          feedbackFile {
            id
            feedbackId
            text
            capability
            name
            skill
            task
            context
            proofOfPaymentFromAddress
            proofOfPaymentToAddress
            proofOfPaymentChainId
            proofOfPaymentTxHash
            tag1
            tag2
            createdAt
          }
          responses {
            id
            responder
            responseUri
            responseHash
            createdAt
          }
        }
      }
    `;

    const result = await this.query<{ feedbacks: any[] }>(query);
    return result.feedbacks || [];
  }

  /**
   * Search agents filtered by reputation criteria
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
    first: number = 100,
    skip: number = 0,
    orderBy: string = 'createdAt',
    orderDirection: 'asc' | 'desc' = 'desc'
  ): Promise<Array<QueryAgent & { averageScore?: number | null }>> {
    // Build feedback filters
    const feedbackFilters: string[] = [];

    if (!includeRevoked) {
      feedbackFilters.push('isRevoked: false');
    }

    if (tags && tags.length > 0) {
      const tagFilterItems: string[] = [];
      for (const tag of tags) {
        tagFilterItems.push(`{or: [{tag1: "${tag}"}, {tag2: "${tag}"}]}`);
      }
      feedbackFilters.push(`or: [${tagFilterItems.join(', ')}]`);
    }

    if (reviewers && reviewers.length > 0) {
      const reviewersList = reviewers.map((addr) => `"${addr}"`).join(', ');
      feedbackFilters.push(`clientAddress_in: [${reviewersList}]`);
    }

    // Feedback file filters
    const feedbackFileFilters: string[] = [];

    if (capabilities && capabilities.length > 0) {
      const capabilitiesList = capabilities.map((cap) => `"${cap}"`).join(', ');
      feedbackFileFilters.push(`capability_in: [${capabilitiesList}]`);
    }

    if (skills && skills.length > 0) {
      const skillsList = skills.map((skill) => `"${skill}"`).join(', ');
      feedbackFileFilters.push(`skill_in: [${skillsList}]`);
    }

    if (tasks && tasks.length > 0) {
      const tasksList = tasks.map((task) => `"${task}"`).join(', ');
      feedbackFileFilters.push(`task_in: [${tasksList}]`);
    }

    if (names && names.length > 0) {
      const namesList = names.map((name) => `"${name}"`).join(', ');
      feedbackFileFilters.push(`name_in: [${namesList}]`);
    }

    if (feedbackFileFilters.length > 0) {
      feedbackFilters.push(`feedbackFile_: { ${feedbackFileFilters.join(', ')} }`);
    }

    // If we have feedback filters, first query feedback to get agent IDs
    let agentWhere = '';
    if (tags || capabilities || skills || tasks || names || reviewers) {
      const feedbackWhere = feedbackFilters.length > 0 
        ? `{ ${feedbackFilters.join(', ')} }`
        : '{}';

      const feedbackQuery = `
        {
          feedbacks(
            where: ${feedbackWhere}
            first: 1000
            skip: 0
          ) {
            agent {
              id
            }
          }
        }
      `;

      try {
        const feedbackResult = await this.query<{ feedbacks: Array<{ agent: { id: string } | null }> }>(feedbackQuery);
        const feedbacksData = feedbackResult.feedbacks || [];

        // Extract unique agent IDs
        const agentIdsSet = new Set<string>();
        for (const fb of feedbacksData) {
          const agentId = fb.agent?.id;
          if (agentId) {
            agentIdsSet.add(agentId);
          }
        }

        if (agentIdsSet.size === 0) {
          // No agents have matching feedback
          return [];
        }

        // Apply agent filter if specified
        let agentIdsList = Array.from(agentIdsSet);
        if (agents && agents.length > 0) {
          agentIdsList = agentIdsList.filter((aid) => agents.includes(aid));
          if (agentIdsList.length === 0) {
            return [];
          }
        }

        const agentIdsStr = agentIdsList.map((aid) => `"${aid}"`).join(', ');
        agentWhere = `where: { id_in: [${agentIdsStr}] }`;
      } catch (error) {
        // If feedback query fails, return empty
        return [];
      }
    } else {
      // No feedback filters - query agents directly
      const agentFilters: string[] = [];
      if (agents && agents.length > 0) {
        const agentIds = agents.map((aid) => `"${aid}"`).join(', ');
        agentFilters.push(`id_in: [${agentIds}]`);
      }

      if (agentFilters.length > 0) {
        agentWhere = `where: { ${agentFilters.join(', ')} }`;
      }
    }

    // Build feedback where for agent query (to calculate scores)
    const feedbackWhereForAgents = feedbackFilters.length > 0
      ? `{ ${feedbackFilters.join(', ')} }`
      : '{}';

    const query = `
      {
        agents(
          ${agentWhere}
          first: ${first}
          skip: ${skip}
          orderBy: ${orderBy}
          orderDirection: ${orderDirection}
        ) {
          id
          chainId
          agentId
          agentURI
          agentURIType
          owner
          operators
          createdAt
          updatedAt
          totalFeedback
          lastActivity
          registrationFile {
            id
            name
            description
            image
            active
            x402support
            supportedTrusts
            mcpEndpoint
            mcpVersion
            a2aEndpoint
            a2aVersion
            ens
            did
            agentWallet
            agentWalletChainId
            mcpTools
            mcpPrompts
            mcpResources
            a2aSkills
            createdAt
          }
          feedback(where: ${feedbackWhereForAgents}) {
            score
            isRevoked
            feedbackFile {
              capability
              skill
              task
              name
            }
          }
        }
      }
    `;

    try {
      const result = await this.query<{ agents: Array<QueryAgent & { feedback: Array<{ score: number; isRevoked: boolean }> }> }>(query);
      const agentsResult = result.agents || [];

      // Calculate average scores
      const agentsWithScores = agentsResult.map((agent) => {
        const feedbacks = agent.feedback || [];
        let averageScore: number | null = null;
        
        if (feedbacks.length > 0) {
          const scores = feedbacks
            .filter((fb) => fb.score > 0)
            .map((fb) => fb.score);
          
          if (scores.length > 0) {
            averageScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
          }
        }

        // Remove feedback array from result (not part of QueryAgent)
        const { feedback, ...agentData } = agent;
        return {
          ...agentData,
          averageScore,
        };
      });

      // Filter by minAverageScore
      let filteredAgents = agentsWithScores;
      if (minAverageScore !== undefined) {
        filteredAgents = agentsWithScores.filter(
          (agent) => agent.averageScore !== null && agent.averageScore >= minAverageScore
        );
      }

      return filteredAgents;
    } catch (error) {
      throw new Error(`Subgraph reputation search failed: ${error}`);
    }
  }
}

