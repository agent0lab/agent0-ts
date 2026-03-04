/**
 * Integration tests: SDK with API key and telemetry endpoint.
 * Requires local Supabase + ingest-telemetry running and seed-telemetry-test-user.sql applied.
 *
 * Set in .env: AGENT0_API_KEY, optionally AGENT0_TELEMETRY_ENDPOINT (defaults to prod).
 * For DB assertion test: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (from supabase start).
 * Run: npm test -- telemetry-sdk
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
    const result = await sdk.searchAgents({}, { sort: ['updatedAt:desc'] });
    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      expect(typeof result[0].chainId).toBe('number');
      expect(typeof result[0].agentId).toBe('string');
      expect(result[0].agentId).toMatch(/^\d+:\d+$/);
    }
  });

  itMaybe('getAgent returns agent or null and emits telemetry', async () => {
    const agent = await sdk.getAgent(AGENT_ID);
    if (agent) {
      expect(agent.agentId).toBe(AGENT_ID);
      expect(typeof agent.chainId).toBe('number');
      expect(typeof agent.name).toBe('string');
    }
  });

  itDb('telemetry events are written to the database', async () => {
    const since = new Date(Date.now() - 120_000).toISOString();
    await sdk.searchAgents({}, { sort: ['updatedAt:desc'] });
    await sdk.getAgent(AGENT_ID);
    await delay(6000);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: events, error } = await supabase
      .from('telemetry_events')
      .select('event_type, timestamp')
      .gte('timestamp', since)
      .in('event_type', ['search.query', 'agent.fetched'])
      .order('timestamp', { ascending: false });

    expect(error).toBeNull();
    expect(events).toBeDefined();
    const types = (events || []).map((e) => e.event_type);
    if (types.length === 0) {
      throw new Error(
        'No telemetry events found. Ensure Edge Functions are served (e.g. in agent0-dashboard run: npx supabase functions serve) and ingest-telemetry is reachable at AGENT0_TELEMETRY_ENDPOINT.'
      );
    }
    expect(types).toContain('search.query');
    expect(types).toContain('agent.fetched');
  }, 20_000);
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
