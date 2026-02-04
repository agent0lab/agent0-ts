/**
 * Agent indexer for discovery and search functionality
 * Simplified version focused on subgraph queries (no local ML indexing)
 */

import type { AgentSummary, SearchFilters, SearchOptions } from '../models/interfaces.js';
import type { AgentId, ChainId } from '../models/types.js';
import { SubgraphClient } from './subgraph-client.js';
import { SemanticSearchClient } from './semantic-search-client.js';
import { normalizeAddress } from '../utils/validation.js';
import { DEFAULT_SUBGRAPH_URLS } from './contracts.js';

// Internal-only meta type kept temporarily while legacy helpers are being removed.
type SearchResultMeta = {
  chains: number[];
  successfulChains: number[];
  failedChains: number[];
  totalResults: number;
  timing?: { totalMs: number; averagePerChainMs?: number };
};

/**
 * Simplified indexer that primarily uses subgraph for queries
 * No local indexing or ML capabilities - all queries go through subgraph
 */
export class AgentIndexer {
  private static readonly BATCH_SIZE = 1000;

  constructor(
    private subgraphClient?: SubgraphClient,
    private subgraphUrlOverrides?: Record<ChainId, string>,
    private readonly defaultChainId?: ChainId
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
    params: SearchFilters = {},
    options: SearchOptions = {}
  ): Promise<AgentSummary[]> {
    const filters: SearchFilters = params || {};
    if (filters.keyword && filters.keyword.trim()) {
      const out = await this._searchUnifiedWithKeyword(filters, options as any);
      return out.items;
    }
    const out = await this._searchUnifiedNoKeyword(filters, options as any);
    return out.items;
  }

  private _parseSort(sort: string[] | undefined, keywordPresent: boolean): { field: string; direction: 'asc' | 'desc' } {
    const defaultSpec = keywordPresent ? 'semanticScore:desc' : 'updatedAt:desc';
    const spec = (sort && sort.length > 0 ? sort[0] : defaultSpec) || defaultSpec;
    const [fieldRaw, dirRaw] = spec.split(':', 2);
    const field = (fieldRaw || (keywordPresent ? 'semanticScore' : 'updatedAt')).trim();
    const direction = (dirRaw || 'desc').trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
    return { field, direction };
  }

  private _resolveChains(filters: SearchFilters, keywordPresent: boolean): ChainId[] {
    // If the caller supplied a chain filter, use it exactly (aside from de-duplication).
    if (filters.chains === 'all') return this._getAllConfiguredChains();
    if (Array.isArray(filters.chains) && filters.chains.length > 0) {
      const out: ChainId[] = [];
      for (const c of filters.chains) {
        const cid = Number(c);
        if (!Number.isFinite(cid)) continue;
        if (!out.includes(cid)) out.push(cid);
      }
      return out;
    }

    // Default behavior (keyword or not): query chain 1 + the SDK-initialized chainId.
    // Avoid looking into chain 1 twice if SDK is initialized with chainId=1.
    const out: ChainId[] = [];
    const sdkChain = this.defaultChainId;
    for (const c of [1, sdkChain] as Array<number | undefined>) {
      if (c === undefined) continue;
      if (!out.includes(c)) out.push(c);
    }
    return out;
  }

  // Pagination removed: cursor helpers deleted.

  private async _fetchAllAgentsV2(
    client: SubgraphClient,
    where: Record<string, unknown>,
    orderBy: string,
    orderDirection: 'asc' | 'desc'
  ): Promise<AgentSummary[]> {
    const out: AgentSummary[] = [];
    for (let skip = 0; ; skip += AgentIndexer.BATCH_SIZE) {
      const page = await client.searchAgentsV2({
        where,
        first: AgentIndexer.BATCH_SIZE,
        skip,
        orderBy,
        orderDirection,
      });
      out.push(...page);
      if (page.length < AgentIndexer.BATCH_SIZE) break;
    }
    return out;
  }

  private _normalizeAgentIds(filters: SearchFilters, chains: ChainId[]): Record<number, string[]> | undefined {
    const ids = filters.agentIds;
    if (!ids || ids.length === 0) return undefined;
    const byChain: Record<number, string[]> = {};
    for (const id of ids) {
      const s = String(id);
      if (s.includes(':')) {
        const [chainStr] = s.split(':', 1);
        const chainId = Number(chainStr);
        if (!Number.isFinite(chainId)) continue;
        (byChain[chainId] ||= []).push(s);
      } else {
        if (chains.length !== 1) {
          throw new Error('agentIds without chain prefix are only allowed when searching exactly one chain.');
        }
        (byChain[chains[0]] ||= []).push(`${chains[0]}:${s}`);
      }
    }
    return byChain;
  }

  private _toUnixSeconds(input: Date | string | number): number {
    if (input instanceof Date) return Math.floor(input.getTime() / 1000);
    if (typeof input === 'number') return Math.floor(input);
    const s = String(input).trim();
    const hasTz = /[zZ]|[+-]\d{2}:\d{2}$/.test(s);
    const normalized = hasTz ? s : `${s}Z`;
    const ms = Date.parse(normalized);
    if (!Number.isFinite(ms)) throw new Error(`Invalid date: ${input}`);
    return Math.floor(ms / 1000);
  }

  private _buildWhereV2(filters: SearchFilters, idsForChain?: string[]): Record<string, unknown> {
    const and: any[] = [];
    const base: any = {};

    // Default behavior: only agents with registration files.
    if (filters.hasRegistrationFile === false) {
      base.registrationFile = null;
    } else {
      base.registrationFile_not = null;
    }

    if (idsForChain && idsForChain.length > 0) {
      base.id_in = idsForChain;
    }

    if (filters.walletAddress) {
      base.agentWallet = filters.walletAddress.toLowerCase();
    }

    // Feedback existence filters can be pushed down via Agent.totalFeedback when they are the ONLY feedback constraint.
    const fb = filters.feedback;
    if (fb && (fb.hasFeedback || fb.hasNoFeedback)) {
      const hasThreshold =
        fb.minCount !== undefined || fb.maxCount !== undefined || fb.minValue !== undefined || fb.maxValue !== undefined;
      const hasAnyConstraint =
        fb.hasResponse === true ||
        (fb.fromReviewers?.length ?? 0) > 0 ||
        Boolean(fb.endpoint) ||
        Boolean(fb.tag) ||
        Boolean(fb.tag1) ||
        Boolean(fb.tag2);
      if (!hasThreshold && !hasAnyConstraint) {
        if (fb.hasFeedback) base.totalFeedback_gt = '0';
        if (fb.hasNoFeedback) base.totalFeedback = '0';
      }
    }

    if (filters.owners && filters.owners.length > 0) {
      const owners = filters.owners.map((o) => o.toLowerCase());
      base.owner_in = owners;
    }

    if (filters.operators && filters.operators.length > 0) {
      const ops = filters.operators.map((o) => o.toLowerCase());
      and.push({ or: ops.map((op) => ({ operators_contains: [op] })) });
    }

    if (filters.registeredAtFrom !== undefined) base.createdAt_gte = this._toUnixSeconds(filters.registeredAtFrom as any);
    if (filters.registeredAtTo !== undefined) base.createdAt_lte = this._toUnixSeconds(filters.registeredAtTo as any);
    if (filters.updatedAtFrom !== undefined) base.updatedAt_gte = this._toUnixSeconds(filters.updatedAtFrom as any);
    if (filters.updatedAtTo !== undefined) base.updatedAt_lte = this._toUnixSeconds(filters.updatedAtTo as any);

    const rf: any = {};
    if (filters.name) rf.name_contains_nocase = filters.name;
    if (filters.description) rf.description_contains_nocase = filters.description;
    if (filters.ensContains) rf.ens_contains_nocase = filters.ensContains;
    if (filters.didContains) rf.did_contains_nocase = filters.didContains;
    if (filters.active !== undefined) rf.active = filters.active;
    if (filters.x402support !== undefined) rf.x402Support = filters.x402support;

    if (filters.hasMCP !== undefined) rf[filters.hasMCP ? 'mcpEndpoint_not' : 'mcpEndpoint'] = null;
    if (filters.hasA2A !== undefined) rf[filters.hasA2A ? 'a2aEndpoint_not' : 'a2aEndpoint'] = null;
    if (filters.hasWeb !== undefined) rf[filters.hasWeb ? 'webEndpoint_not' : 'webEndpoint'] = null;
    // Exact semantics: true iff (oasfSkills OR oasfDomains) non-empty. Implemented by subgraph derived field.
    if (filters.hasOASF !== undefined) rf.hasOASF = filters.hasOASF;

    if (filters.mcpContains) rf.mcpEndpoint_contains_nocase = filters.mcpContains;
    if (filters.a2aContains) rf.a2aEndpoint_contains_nocase = filters.a2aContains;
    if (filters.webContains) rf.webEndpoint_contains_nocase = filters.webContains;

    if (Object.keys(rf).length > 0) {
      base.registrationFile_ = rf;
    }

    const anyOfList = (field: string, values?: string[]) => {
      if (!values || values.length === 0) return;
      and.push({
        or: values.map((v) => ({ registrationFile_: { [`${field}_contains`]: [v] } })),
      });
    };
    anyOfList('supportedTrusts', filters.supportedTrust);
    anyOfList('a2aSkills', filters.a2aSkills);
    anyOfList('mcpTools', filters.mcpTools);
    anyOfList('mcpPrompts', filters.mcpPrompts);
    anyOfList('mcpResources', filters.mcpResources);
    anyOfList('oasfSkills', filters.oasfSkills);
    anyOfList('oasfDomains', filters.oasfDomains);

    if (filters.hasEndpoints !== undefined) {
      if (filters.hasEndpoints) {
        and.push({
          or: [
            { registrationFile_: { webEndpoint_not: null } },
            { registrationFile_: { mcpEndpoint_not: null } },
            { registrationFile_: { a2aEndpoint_not: null } },
          ],
        });
      } else {
        and.push({
          registrationFile_: { webEndpoint: null, mcpEndpoint: null, a2aEndpoint: null },
        });
      }
    }

    if (and.length === 0) return base;
    return { and: [base, ...and] };
  }

  private _compareAgents(a: AgentSummary, b: AgentSummary, field: string, direction: 'asc' | 'desc'): number {
    const dir = direction === 'asc' ? 1 : -1;
    const num = (x: any) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
    switch (field) {
      case 'name': {
        const av = (a.name || '').toLowerCase();
        const bv = (b.name || '').toLowerCase();
        return av < bv ? -dir : av > bv ? dir : 0;
      }
      case 'chainId':
        return (a.chainId - b.chainId) * dir;
      case 'createdAt':
        return (num(a.createdAt) - num(b.createdAt)) * dir;
      case 'updatedAt':
        return (num(a.updatedAt) - num(b.updatedAt)) * dir;
      case 'lastActivity':
        return (num(a.lastActivity) - num(b.lastActivity)) * dir;
      case 'feedbackCount':
        return (num(a.feedbackCount) - num(b.feedbackCount)) * dir;
      case 'averageValue':
        return (num(a.averageValue) - num(b.averageValue)) * dir;
      case 'semanticScore':
        return (num(a.semanticScore) - num(b.semanticScore)) * dir;
      default:
        return (num(a.updatedAt) - num(b.updatedAt)) * dir;
    }
  }

  private _intersectIds(a?: string[], b?: string[]): string[] | undefined {
    if (!a && !b) return undefined;
    if (!a) return b && b.length > 0 ? b : [];
    if (!b) return a && a.length > 0 ? a : [];
    const bSet = new Set(b);
    return a.filter((x) => bSet.has(x));
  }

  private _utf8ToHex(s: string): string {
    const bytes = new TextEncoder().encode(s);
    let hex = '0x';
    for (const b of bytes) hex += b.toString(16).padStart(2, '0');
    return hex;
  }

  private async _prefilterByMetadata(filters: SearchFilters, chains: ChainId[]): Promise<Record<number, string[]> | undefined> {
    const key = filters.hasMetadataKey ?? filters.metadataValue?.key;
    if (!key) return undefined;
    const valueStr = filters.metadataValue?.value;
    const valueHex = valueStr !== undefined ? this._utf8ToHex(String(valueStr)) : undefined;

    const first = 1000;

    const perChain = await Promise.all(
      chains.map(async (chainId) => {
        const client =
          this.defaultChainId !== undefined && chainId === this.defaultChainId ? this.subgraphClient : this._getSubgraphClientForChain(chainId);
        if (!client) return { chainId, ids: [] as string[] };

        const ids: string[] = [];
        for (let skip = 0; ; skip += first) {
          const where: any = { key };
          if (valueHex !== undefined) where.value = valueHex;
          const rows = await client.queryAgentMetadata(where, first, skip);
          for (const r of rows) {
            if (r?.agent?.id) ids.push(r.agent.id);
          }
          if (rows.length < first) break;
        }
        return { chainId, ids: Array.from(new Set(ids)) };
      })
    );

    const out: Record<number, string[]> = {};
    for (const r of perChain) out[r.chainId] = r.ids;
    return out;
  }

  private async _prefilterByFeedback(
    filters: SearchFilters,
    chains: ChainId[],
    candidateIdsByChain?: Record<number, string[]>
  ): Promise<{ idsByChain?: Record<number, string[]>; statsById?: Record<string, { count: number; avg: number }> }> {
    const fb = filters.feedback;
    if (!fb) return {};

    const hasThreshold =
      fb.minCount !== undefined || fb.maxCount !== undefined || fb.minValue !== undefined || fb.maxValue !== undefined;
    const hasAnyConstraint =
      fb.hasResponse === true ||
      (fb.fromReviewers?.length ?? 0) > 0 ||
      Boolean(fb.endpoint) ||
      Boolean(fb.tag) ||
      Boolean(fb.tag1) ||
      Boolean(fb.tag2);

    const includeRevoked = fb.includeRevoked === true;

    // If hasNoFeedback is the ONLY feedback constraint, we push it down via Agent.totalFeedback == 0 in _buildWhereV2.
    if (fb.hasNoFeedback && !hasThreshold && !hasAnyConstraint) return {};
    // If hasFeedback is the ONLY feedback constraint, we push it down via Agent.totalFeedback_gt == 0 in _buildWhereV2.
    if (fb.hasFeedback && !hasThreshold && !hasAnyConstraint) return {};

    // Otherwise, hasNoFeedback requires a candidate set (we subtract matched agents from candidates).
    if (fb.hasNoFeedback) {
      const anyCandidates = candidateIdsByChain && Object.values(candidateIdsByChain).some((l) => (l?.length ?? 0) > 0);
      if (!anyCandidates) throw new Error('feedback.hasNoFeedback requires a pre-filtered candidate set (e.g. agentIds or keyword).');
    }

    const first = 1000;

    const statsById: Record<string, { sum: number; count: number }> = {};
    const matchedAgentsByChain: Record<number, Set<string>> = {};

    await Promise.all(
      chains.map(async (chainId) => {
        const client =
          this.defaultChainId !== undefined && chainId === this.defaultChainId ? this.subgraphClient : this._getSubgraphClientForChain(chainId);
        if (!client) return;

        const candidates = candidateIdsByChain?.[chainId];
        const baseAnd: any[] = [];
        const base: any = {};
        if (!includeRevoked) base.isRevoked = false;
        if (fb.fromReviewers && fb.fromReviewers.length > 0) {
          base.clientAddress_in = fb.fromReviewers.map((a) => a.toLowerCase());
        }
        if (fb.endpoint) base.endpoint_contains_nocase = fb.endpoint;
        if (candidates && candidates.length > 0) base.agent_in = candidates;

        if (fb.tag1) base.tag1 = fb.tag1;
        if (fb.tag2) base.tag2 = fb.tag2;
        if (fb.tag) {
          baseAnd.push({ or: [{ tag1: fb.tag }, { tag2: fb.tag }] });
        }

        const where = baseAnd.length > 0 ? { and: [base, ...baseAnd] } : base;

        for (let skip = 0; ; skip += first) {
          const rows = await client.queryFeedbacks(where, first, skip, 'createdAt', 'desc');
          for (const r of rows) {
            if (!r?.agent?.id) continue;
            if (fb.hasResponse && !(r.responses && r.responses.length > 0)) continue;

            const agentId = r.agent.id;
            const v = Number(r.value);
            if (!Number.isFinite(v)) continue;
            const s = (statsById[agentId] ||= { sum: 0, count: 0 });
            s.sum += v;
            s.count += 1;
            (matchedAgentsByChain[chainId] ||= new Set()).add(agentId);
          }
          if (rows.length < first) break;
        }
      })
    );

    const finalStats: Record<string, { count: number; avg: number }> = {};
    for (const [agentId, s] of Object.entries(statsById)) {
      const avg = s.count > 0 ? s.sum / s.count : 0;
      finalStats[agentId] = { count: s.count, avg };
    }

    // Build allowlist from stats.
    const passes = (st: { count: number; avg: number }): boolean => {
      if (fb.minCount !== undefined && st.count < fb.minCount) return false;
      if (fb.maxCount !== undefined && st.count > fb.maxCount) return false;
      if (fb.minValue !== undefined && st.avg < fb.minValue) return false;
      if (fb.maxValue !== undefined && st.avg > fb.maxValue) return false;
      return true;
    };

    const allowByChain: Record<number, string[]> = {};

    for (const chainId of chains) {
      const matched = matchedAgentsByChain[chainId] || new Set<string>();
      const candidates = candidateIdsByChain?.[chainId];

      if (fb.hasNoFeedback) {
        const baseList = candidates || [];
        allowByChain[chainId] = baseList.filter((id) => !matched.has(id));
        continue;
      }

      let ids = Array.from(matched);
      if (hasThreshold) {
        ids = ids.filter((id) => passes(finalStats[id] || { count: 0, avg: 0 }));
      } else if (hasAnyConstraint || fb.hasFeedback) {
        ids = ids.filter((id) => (finalStats[id]?.count ?? 0) > 0);
      }

      // If we had an explicit candidate set, intersect (important for keyword path).
      if (candidates && candidates.length > 0) {
        const cset = new Set(candidates);
        ids = ids.filter((id) => cset.has(id));
      }

      allowByChain[chainId] = ids;
    }

    return { idsByChain: allowByChain, statsById: Object.fromEntries(Object.entries(finalStats).map(([k, v]) => [k, v])) };
  }

  private async _searchUnifiedNoKeyword(
    filters: SearchFilters,
    options: SearchOptions
  ): Promise<{ items: AgentSummary[]; meta: SearchResultMeta }> {
    const { field, direction } = this._parseSort(options.sort, false);
    const chains = this._resolveChains(filters, false);
    if (chains.length === 0) {
          return {
            items: [],
        meta: { chains: [], successfulChains: [], failedChains: [], totalResults: 0, timing: { totalMs: 0 } },
      };
    }

    const agentIdsByChain = this._normalizeAgentIds(filters, chains);
    const metadataIdsByChain = await this._prefilterByMetadata(filters, chains);
    const candidateForFeedback: Record<number, string[]> = {};
    for (const c of chains) {
      const ids = this._intersectIds(agentIdsByChain?.[c], metadataIdsByChain?.[c]);
      if (ids && ids.length > 0) candidateForFeedback[c] = ids;
    }
    const feedbackPrefilter = await this._prefilterByFeedback(filters, chains, Object.keys(candidateForFeedback).length > 0 ? candidateForFeedback : undefined);
    const feedbackIdsByChain = feedbackPrefilter.idsByChain;
    const feedbackStatsById = feedbackPrefilter.statsById || {};

    const orderBy = ['createdAt', 'updatedAt', 'name', 'chainId', 'lastActivity', 'totalFeedback'].includes(field)
      ? (field === 'feedbackCount' ? 'totalFeedback' : field)
      : 'updatedAt';
    const orderDirection = direction;

    const fetchChain = async (chainId: ChainId): Promise<{ chainId: ChainId; status: 'success' | 'error' | 'unavailable'; items: AgentSummary[] }> => {
      try {
        const client =
          this.defaultChainId !== undefined && chainId === this.defaultChainId ? this.subgraphClient : this._getSubgraphClientForChain(chainId);
        if (!client) return { chainId, status: 'unavailable', items: [] };
        const ids0 = this._intersectIds(agentIdsByChain?.[chainId], metadataIdsByChain?.[chainId]);
        const ids = this._intersectIds(ids0, feedbackIdsByChain?.[chainId]);
        if (ids && ids.length === 0) return { chainId, status: 'success', items: [] };
        const where = this._buildWhereV2(filters, ids);
        const items = await this._fetchAllAgentsV2(client, where, orderBy, orderDirection);
        for (const a of items) {
          const st = feedbackStatsById[a.agentId];
          if (st) a.averageValue = st.avg;
        }
        return { chainId, status: 'success', items };
      } catch {
        return { chainId, status: 'error', items: [] };
      }
    };

    const results = await Promise.all(chains.map((c) => fetchChain(c)));
    const successfulChains = results.filter((r) => r.status === 'success').map((r) => r.chainId);
    const failedChains = results.filter((r) => r.status !== 'success').map((r) => r.chainId);

    const merged = results.flatMap((r) => r.items || []);
    merged.sort((a, b) => this._compareAgents(a, b, field, direction));

    return {
      items: merged,
            meta: {
        chains,
        successfulChains,
        failedChains,
              totalResults: merged.length,
              timing: { totalMs: 0 },
            },
          };
        }

  private async _searchUnifiedWithKeyword(
    filters: SearchFilters,
    options: SearchOptions
  ): Promise<{ items: AgentSummary[]; meta?: SearchResultMeta }> {
    const keyword = (filters.keyword || '').trim();
    const chains = this._resolveChains(filters, true);
    const { field, direction } = this._parseSort(options.sort, true);

    const semantic = new SemanticSearchClient();
    const results = await semantic.search(keyword, {
      minScore: options.semanticMinScore,
      topK: options.semanticTopK,
    });

    const allowedChains = new Set(chains);
    const filtered = results.filter((r) => allowedChains.has(r.chainId));

    const byChain: Record<number, string[]> = {};
    const scoreById: Record<string, number> = {};
    for (const r of filtered) {
      (byChain[r.chainId] ||= []).push(r.agentId);
      scoreById[r.agentId] = r.score;
    }

    const metadataIdsByChain = await this._prefilterByMetadata(filters, chains);
    const feedbackPrefilter = await this._prefilterByFeedback(filters, chains, byChain);
    const feedbackIdsByChain = feedbackPrefilter.idsByChain;
    const feedbackStatsById = feedbackPrefilter.statsById || {};

    const fetched: AgentSummary[] = [];
    const successfulChains: number[] = [];
    const failedChains: number[] = [];

    const orderBy = 'updatedAt';
    const orderDirection: 'asc' | 'desc' = 'desc';
    const chunkSize = 500;

    for (const chainId of chains) {
      const client =
        this.defaultChainId !== undefined && chainId === this.defaultChainId ? this.subgraphClient : this._getSubgraphClientForChain(chainId);
      const ids = byChain[chainId] || [];
      if (!client) {
        if (ids.length > 0) failedChains.push(chainId);
        continue;
      }
      try {
        successfulChains.push(chainId);
        for (let i = 0; i < ids.length; i += chunkSize) {
          const chunk = ids.slice(i, i + chunkSize);
          const ids2 = this._intersectIds(chunk, metadataIdsByChain?.[chainId]);
          const ids3 = this._intersectIds(ids2, feedbackIdsByChain?.[chainId]);
          if (ids3 && ids3.length === 0) continue;
          const where = this._buildWhereV2(filters, ids3);
          const agents = await client.searchAgentsV2({ where, first: (ids3 || []).length, skip: 0, orderBy, orderDirection });
          for (const a of agents) {
            a.semanticScore = scoreById[a.agentId];
            const st = feedbackStatsById[a.agentId];
            if (st) a.averageValue = st.avg;
            fetched.push(a);
          }
        }
      } catch {
        failedChains.push(chainId);
      }
    }

    // Default sort for keyword is semanticScore desc
    const sortField = options.sort && options.sort.length > 0 ? field : 'semanticScore';
    const sortDir = options.sort && options.sort.length > 0 ? direction : 'desc';
    fetched.sort((a, b) => this._compareAgents(a, b, sortField, sortDir));

    return {
      items: fetched,
      meta: {
        chains,
        successfulChains,
        failedChains,
        totalResults: fetched.length,
        timing: { totalMs: 0 },
      },
    };
  }

  private _filterAgents(agents: AgentSummary[], params: SearchFilters): AgentSummary[] {
    const {
      name,
      description,
      hasMCP,
      hasA2A,
      mcpContains,
      a2aContains,
      webContains,
      ensContains,
      didContains,
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

      // Filter by description substring
      if (description && !agent.description?.toLowerCase().includes(description.toLowerCase())) {
        return false;
      }

      // Endpoint existence filters
      if (hasMCP !== undefined) {
        const has = Boolean(agent.mcp);
        if (has !== hasMCP) return false;
      }
      if (hasA2A !== undefined) {
        const has = Boolean(agent.a2a);
        if (has !== hasA2A) return false;
      }

      // Endpoint substring filters
      if (mcpContains && !(agent.mcp || '').toLowerCase().includes(mcpContains.toLowerCase())) {
        return false;
      }
      if (a2aContains && !(agent.a2a || '').toLowerCase().includes(a2aContains.toLowerCase())) {
        return false;
      }
      if (webContains && !(agent.web || '').toLowerCase().includes(webContains.toLowerCase())) {
        return false;
      }

      // ENS/DID substring filters
      if (ensContains && !(agent.ens || '').toLowerCase().includes(ensContains.toLowerCase())) {
        return false;
      }
      if (didContains && !(agent.did || '').toLowerCase().includes(didContains.toLowerCase())) {
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

  // Pagination removed: legacy multi-chain cursor-based search path deleted.

  /**
   * (Removed) searchAgentsByReputation
   *
   * Unified search lives in `SDK.searchAgents()` with `filters.feedback` and related filter surfaces.
   */
}

