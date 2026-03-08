/**
 * Integration tests: SDK telemetry (Telemetry-Events-Specs-v2.md).
 *
 * Set in .env: AGENT0_API_KEY, optionally AGENT0_TELEMETRY_ENDPOINT (defaults to prod).
 * Run: npm test -- telemetry-sdk
 *
 * Tests that require local Supabase (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) and
 * ingest-telemetry running (e.g. in agent0-dashboard: npx supabase functions serve):
 *   - searchAgents returns array and emits telemetry (DB check: search.query)
 *   - getAgent returns agent or null and emits telemetry (DB check: agent.fetched)
 *   - loadAgent returns Agent and emits telemetry (DB check: agent.loaded, only when agent URI is HTTP/IPFS)
 *   - searchFeedback emits telemetry (DB check: feedback.searched)
 *   - getReputationSummary emits telemetry (DB check: reputation.summary.fetched)
 *   - telemetry events are written to the database (spec coverage)
 * Apply seed-telemetry-test-user.sql so the test API key exists.
 *
 * Spec coverage (read-only, no signer):
 *   search.query, agent.fetched, agent.loaded, feedback.searched, reputation.summary.fetched
 * Write/lifecycle events (agent.registered, feedback.given, etc.) require signer/agent and are not covered here.
 */

import { createClient } from '@supabase/supabase-js';
import { SDK } from '../src/index.js';
import {
  CHAIN_ID,
  RPC_URL,
  SUBGRAPH_URL,
  AGENT_ID,
  AGENT0_API_KEY,
  AGENT0_TELEMETRY_ENDPOINT,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  printConfig,
} from './config.js';

const HAS_API_KEY = Boolean(AGENT0_API_KEY && AGENT0_API_KEY.trim() !== '');
const HAS_SUPABASE =
  Boolean(SUPABASE_URL && SUPABASE_URL.trim() !== '') &&
  Boolean(SUPABASE_SERVICE_ROLE_KEY && SUPABASE_SERVICE_ROLE_KEY.trim() !== '');
const describeMaybe = HAS_API_KEY ? describe : describe.skip;
const itMaybe = HAS_API_KEY ? it : it.skip;
const itDb = HAS_API_KEY && HAS_SUPABASE ? it : it.skip;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Asserts that at least one telemetry event of type exists in DB after since. Only runs when HAS_SUPABASE. */
async function assertEventInDb(eventType: string, since: string): Promise<void> {
  if (!HAS_SUPABASE || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  await delay(6000);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await supabase
    .from('telemetry_events')
    .select('event_type')
    .gte('timestamp', since)
    .eq('event_type', eventType)
    .limit(1);
  expect(error).toBeNull();
  if (!data || data.length === 0) {
    throw new Error(
      `No telemetry event "${eventType}" found. Ensure Supabase and ingest-telemetry are running (e.g. in agent0-dashboard: npx supabase functions serve).`
    );
  }
}

describeMaybe('SDK with telemetry (apiKey + telemetryEndpoint)', () => {
  let sdk: SDK;

  beforeAll(() => {
    printConfig();
    sdk = new SDK({
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
      subgraphUrl: SUBGRAPH_URL,
      apiKey: AGENT0_API_KEY,
      telemetryEndpoint: AGENT0_TELEMETRY_ENDPOINT || undefined,
    });
  });

  itMaybe('searchAgents returns array and emits telemetry', async () => {
    const since = new Date().toISOString();
    const result = await sdk.searchAgents({}, { sort: ['updatedAt:desc'] });
    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      expect(typeof result[0].chainId).toBe('number');
      expect(typeof result[0].agentId).toBe('string');
      expect(result[0].agentId).toMatch(/^\d+:\d+$/);
    }
    await assertEventInDb('search.query', since);
  }, 15_000);

  itMaybe('getAgent returns agent or null and emits telemetry', async () => {
    const since = new Date().toISOString();
    const agent = await sdk.getAgent(AGENT_ID);
    if (agent) {
      expect(agent.agentId).toBe(AGENT_ID);
      expect(typeof agent.chainId).toBe('number');
      expect(typeof agent.name).toBe('string');
    }
    await assertEventInDb('agent.fetched', since);
  }, 15_000);

  itMaybe('loadAgent returns Agent and emits telemetry (when agent URI is HTTP/IPFS)', async () => {
    const since = new Date().toISOString();
    let emitted = false;
    try {
      const agent = await sdk.loadAgent(AGENT_ID);
      expect(agent).toBeDefined();
      expect(agent.agentId).toBe(AGENT_ID);
      expect(typeof agent.name).toBe('string');
      emitted = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Skip if test agent uses data: URI that we don't support or that is malformed
      if (msg.includes('Data URIs are not supported') || msg.includes('Invalid base64 payload in data URI')) {
        return;
      }
      throw e;
    }
    if (emitted) await assertEventInDb('agent.loaded', since);
  }, 15_000);

  itMaybe('searchFeedback emits telemetry', async () => {
    const since = new Date().toISOString();
    const result = await sdk.searchFeedback({ agentId: AGENT_ID });
    expect(Array.isArray(result)).toBe(true);
    await assertEventInDb('feedback.searched', since);
  }, 15_000);

  itMaybe('getReputationSummary emits telemetry', async () => {
    const since = new Date().toISOString();
    const summary = await sdk.getReputationSummary(AGENT_ID);
    expect(summary).toBeDefined();
    expect(typeof summary.count).toBe('number');
    expect(typeof summary.averageValue).toBe('number');
    await assertEventInDb('reputation.summary.fetched', since);
  }, 15_000);

  itDb('telemetry events are written to the database (spec coverage)', async () => {
    const since = new Date(Date.now() - 120_000).toISOString();
    await sdk.searchAgents({}, { sort: ['updatedAt:desc'] });
    await sdk.getAgent(AGENT_ID);
    let loadAgentEmitted = false;
    try {
      await sdk.loadAgent(AGENT_ID);
      loadAgentEmitted = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('Data URIs are not supported') && !msg.includes('Invalid base64 payload in data URI')) throw e;
    }
    await sdk.searchFeedback({ agentId: AGENT_ID });
    await sdk.getReputationSummary(AGENT_ID);
    await delay(6000);

    const expectedTypes = [
      'search.query',
      'agent.fetched',
      'feedback.searched',
      'reputation.summary.fetched',
    ];
    if (loadAgentEmitted) expectedTypes.push('agent.loaded');

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: events, error } = await supabase
      .from('telemetry_events')
      .select('event_type, payload, timestamp')
      .gte('timestamp', since)
      .in('event_type', expectedTypes)
      .order('timestamp', { ascending: false });

    expect(error).toBeNull();
    expect(events).toBeDefined();
    const types = (events || []).map((e) => e.event_type);
    if (types.length === 0) {
      throw new Error(
        'No telemetry events found. Ensure Edge Functions are served (e.g. in agent0-dashboard run: npx supabase functions serve) and ingest-telemetry is reachable at AGENT0_TELEMETRY_ENDPOINT.'
      );
    }
    for (const t of expectedTypes) {
      expect(types).toContain(t);
    }

    const searchEvent = (events || []).find((e) => e.event_type === 'search.query');
    if (searchEvent?.payload && typeof searchEvent.payload === 'object') {
      expect(Array.isArray((searchEvent.payload as { results?: unknown }).results)).toBe(true);
    }
  }, 25_000);
});

describe('SDK without apiKey (no telemetry)', () => {
  it('constructs and searchAgents works', async () => {
    const sdk = new SDK({
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
      subgraphUrl: SUBGRAPH_URL,
    });
    const result = await sdk.searchAgents({}, { sort: ['updatedAt:desc'] });
    expect(Array.isArray(result)).toBe(true);
  });
});
