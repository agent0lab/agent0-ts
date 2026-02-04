# Release Notes — 1.5.2 (stable)

This is the first **stable** release of the Unified SDK Search refactor that previously shipped as `1.5.0-beta.1` + `1.5.1-beta.1`.

## Highlights

- **One authoritative discovery API**: use `SDK.searchAgents()` for all agent discovery and feedback/reputation-based filtering.
- **Semantic keyword search**: optional semantic prefilter via the external semantic endpoint.
- **Correct filtering**: fixes “pagination-before-filtering” by pushing supported filters down to the subgraph and using two-phase prefilters where needed.
- **Multi-chain capable**: supports multi-chain search with consistent default chain selection.

## Breaking / API Changes (vs 1.4.x)

- **`searchAgentsByReputation` removed**
  - Use `searchAgents(filters, options)` with `filters.feedback`.

- **`searchAgents()` is the unified entry point**
  - Signature: `searchAgents(filters?: SearchFilters, options?: SearchOptions)`.
  - `SearchParams` was replaced by `SearchFilters` + `SearchOptions`.

- **Return type (from 1.5.1-beta.1 onward)**
  - `searchAgents()` returns `AgentSummary[]` (pagination removed from the public API).

- **AgentSummary endpoint semantics**
  - `mcp` / `a2a` are **endpoint strings** (not booleans).
  - Additional optional endpoints may be present: `web`, `email`.

## Changes Included from 1.5.0-beta.1 + 1.5.1-beta.1

- **Unified search + feedback filters**
  - Combines agent filters with feedback/reputation filters in one call.
  - Sorting keys include `updatedAt`, `createdAt`, `lastActivity`, `feedbackCount`, `averageValue`, `semanticScore`.

- **Expanded filters**
  - Supports filters for chains, agentIds, owners/operators, endpoint existence + substring, status/time filters, capability arrays, metadata filters, and rich feedback filters.

- **Semantic keyword search**
  - Uses the semantic endpoint `https://semantic-search.ag0.xyz/api/v1/search`.
  - Defaults when not provided:
    - `semanticMinScore = 0.5`
    - `semanticTopK = 5000` (sent as `limit` to the semantic endpoint)

- **Internal “fetch all” batching**
  - Subgraph pagination (`first` / `skip`) is used internally but is not exposed as a public cursor API.

- **Subgraph compatibility improvements**
  - Agent metadata query name fallback (`agentMetadatas` vs `agentMetadata_collection`) where applicable.
  - `hasOASF` compatibility fallbacks for deployments with older filter input support.

## Changes in 1.5.2 (since 1.5.1-beta.1)

- **Consistent default chains for `searchAgents()`**
  - If `filters.chains` is provided, it is used as-is.
  - If `filters.chains` is not provided, the SDK defaults to searching **chain `1` plus the SDK-initialized chain**, de-duplicated (so chain `1` is never searched twice).
  - This default is applied **both** for keyword (semantic) and non-keyword search paths.

## Notes

- Live integration tests remain **opt-in** via `RUN_LIVE_TESTS=1`.

