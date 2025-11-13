import { promises as fs } from 'fs';
import { mkdtempSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import {
  FileSemanticSyncStateStore,
  InMemorySemanticSyncStateStore,
  SemanticSyncRunner,
} from '../src/semantic-search/index.js';
import type { SemanticSyncState } from '../src/semantic-search/sync-state.js';
import type { SubgraphClient } from '../src/core/subgraph-client.js';
import type { SDK } from '../src/core/sdk.js';

describe('FileSemanticSyncStateStore', () => {
  test('persists and clears state on disk', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'semantic-sync-'));
    const file = path.join(dir, 'state.json');
    const store = new FileSemanticSyncStateStore({ filepath: file });

    expect(await store.load()).toBeNull();

    const state: SemanticSyncState = {
      chains: {
        '42': {
          lastUpdatedAt: '100',
          agentHashes: { foo: 'abc' },
        },
      },
    };
    await store.save(state);

    const reloaded = await store.load();
    expect(reloaded).toEqual(state);

    await store.clear();
    expect(await store.load()).toBeNull();
  });
});

describe('SemanticSyncRunner', () => {
  interface TestAgent {
    id: string;
    chainId: string;
    agentId: string;
    updatedAt: string;
    registrationFile: any;
  }

  class FakeSubgraphClient {
    private data: TestAgent[] = [];

    constructor(initialData: TestAgent[]) {
      this.data = initialData;
    }

    setData(data: TestAgent[]) {
      this.data = data;
    }

    append(agent: TestAgent) {
      this.data.push(agent);
    }

    async query(): Promise<{ agents: TestAgent[] }> {
      throw new Error('query() signature with variables should be used.');
    }

    async queryWithVariables(
      _query: string,
      variables: { updatedAfter: string; first: number }
    ): Promise<{ agents: TestAgent[] }> {
      const updatedAfter = BigInt(variables.updatedAfter);
      const filtered = this.data
        .filter(agent => BigInt(agent.updatedAt) > updatedAfter)
        .sort((a, b) => Number(BigInt(a.updatedAt) - BigInt(b.updatedAt)))
        .slice(0, variables.first);
      return { agents: filtered };
    }

    // Proxy handler for the runner which calls subgraphClient.query(...)
    async queryProxy(query: string, variables: { updatedAfter: string; first: number }) {
      return this.queryWithVariables(query, variables);
    }
  }

  function createRunnerTestSdk(
    subgraphClient: FakeSubgraphClient,
    overrides: Partial<SDK> = {},
    chainId: number = 11155111
  ) {
    const indexAgent = jest.fn();
    const indexAgentsBatch = jest.fn();
    const deleteAgentsBatch = jest.fn();

    const semanticSearchManager = {
      indexAgent,
      indexAgentsBatch,
    };

    const sdk = {
      semanticSearch: semanticSearchManager,
      semanticDeleteAgentsBatch: deleteAgentsBatch,
      subgraphClient: {
        query: subgraphClient.queryProxy.bind(subgraphClient),
      },
      chainId: jest.fn().mockResolvedValue(chainId),
    } as unknown as SDK;

    Object.assign(sdk, overrides);

    return {
      sdk,
      indexAgent,
      indexAgentsBatch,
      deleteAgentsBatch,
    };
  }

  test('indexes new agents and persists state', async () => {
    const agents: TestAgent[] = [
      {
        id: '11155111:1',
        chainId: '11155111',
        agentId: '1',
        updatedAt: '10',
        registrationFile: {
          name: 'Alpha',
          description: 'Agent Alpha',
          supportedTrusts: [],
          mcpTools: [],
          mcpPrompts: [],
          mcpResources: [],
          a2aSkills: [],
        },
      },
      {
        id: '11155111:2',
        chainId: '11155111',
        agentId: '2',
        updatedAt: '20',
        registrationFile: {
          name: 'Beta',
          description: 'Agent Beta',
          supportedTrusts: [],
          mcpTools: ['tool'],
          mcpPrompts: [],
          mcpResources: [],
          a2aSkills: [],
        },
      },
      {
        id: '11155111:3',
        chainId: '11155111',
        agentId: '3',
        updatedAt: '25',
        registrationFile: null,
      },
    ];

    const subgraph = new FakeSubgraphClient(agents);
    const store = new InMemorySemanticSyncStateStore();
    const { sdk, indexAgent, indexAgentsBatch, deleteAgentsBatch } = createRunnerTestSdk(subgraph);

    const runner = new SemanticSyncRunner(sdk, {
      batchSize: 10,
      stateStore: store,
      targets: [
        {
          chainId: 11155111,
          subgraphClient: {
            query: subgraph.queryProxy.bind(subgraph),
          } as unknown as SubgraphClient,
        },
      ],
    });

    await runner.run();

    expect(indexAgentsBatch).toHaveBeenCalledTimes(1);
    const indexedPayload = indexAgentsBatch.mock.calls[0][0];
    expect(indexedPayload).toHaveLength(2);
    expect(deleteAgentsBatch).toHaveBeenCalledTimes(1);
    expect(deleteAgentsBatch.mock.calls[0][0]).toEqual([
      { chainId: 11155111, agentId: '11155111:3' },
    ]);

    const saved = await store.load();
    const chainState = saved?.chains['11155111'];
    expect(chainState?.lastUpdatedAt).toBe('25');
    expect(Object.keys(chainState?.agentHashes ?? {})).toEqual(['11155111:1', '11155111:2']);

    indexAgent.mockClear();
    indexAgentsBatch.mockClear();
    deleteAgentsBatch.mockClear();

    // Second run with no changes should be a no-op.
    await runner.run();
    expect(indexAgent).not.toHaveBeenCalled();
    expect(indexAgentsBatch).not.toHaveBeenCalled();
    expect(deleteAgentsBatch).not.toHaveBeenCalled();

    // Introduce an updated agent (with higher updatedAt) and run again.
    subgraph.append({
      id: '11155111:2',
      chainId: '11155111',
      agentId: '2',
      updatedAt: '30',
      registrationFile: {
        name: 'Beta',
        description: 'Agent Beta updated',
        supportedTrusts: [],
        mcpTools: ['tool'],
        mcpPrompts: [],
        mcpResources: [],
        a2aSkills: ['skill'],
      },
    });

    await runner.run();
    expect(indexAgent).toHaveBeenCalledTimes(1);
    expect(indexAgent.mock.calls[0][0].agentId).toBe('11155111:2');

    const savedAfterUpdate = await store.load();
    expect(savedAfterUpdate?.chains['11155111'].lastUpdatedAt).toBe('30');
  });

  test('supports multiple chains with independent checkpoints', async () => {
    const chainAAgents: TestAgent[] = [
      {
        id: '11155111:a1',
        chainId: '11155111',
        agentId: 'a1',
        updatedAt: '10',
        registrationFile: { name: 'AlphaA', supportedTrusts: [], mcpTools: [], mcpPrompts: [], mcpResources: [], a2aSkills: [] },
      },
      {
        id: '11155111:a2',
        chainId: '11155111',
        agentId: 'a2',
        updatedAt: '20',
        registrationFile: { name: 'BetaA', supportedTrusts: [], mcpTools: [], mcpPrompts: [], mcpResources: [], a2aSkills: [] },
      },
    ];

    const chainBAgents: TestAgent[] = [
      {
        id: '59141:b1',
        chainId: '59141',
        agentId: 'b1',
        updatedAt: '15',
        registrationFile: { name: 'GammaB', supportedTrusts: [], mcpTools: [], mcpPrompts: [], mcpResources: [], a2aSkills: [] },
      },
    ];

    const chainCAgents: TestAgent[] = [
      {
        id: '84532:c1',
        chainId: '84532',
        agentId: 'c1',
        updatedAt: '12',
        registrationFile: { name: 'EpsilonC', supportedTrusts: [], mcpTools: [], mcpPrompts: [], mcpResources: [], a2aSkills: [] },
      },
    ];

    const subgraphA = new FakeSubgraphClient(chainAAgents);
    const subgraphB = new FakeSubgraphClient(chainBAgents);
    const subgraphC = new FakeSubgraphClient(chainCAgents);

    const store = new InMemorySemanticSyncStateStore();
    const { sdk, indexAgent, indexAgentsBatch, deleteAgentsBatch } = createRunnerTestSdk(subgraphA);

    const runner = new SemanticSyncRunner(sdk, {
      batchSize: 10,
      stateStore: store,
      targets: [
        { chainId: 11155111, subgraphClient: { query: subgraphA.queryProxy.bind(subgraphA) } as unknown as SubgraphClient },
        { chainId: 59141, subgraphClient: { query: subgraphB.queryProxy.bind(subgraphB) } as unknown as SubgraphClient },
        { chainId: 84532, subgraphClient: { query: subgraphC.queryProxy.bind(subgraphC) } as unknown as SubgraphClient },
      ],
    });

    await runner.run();

    expect(indexAgentsBatch).toHaveBeenCalledTimes(1);
    expect(indexAgent).toHaveBeenCalledTimes(2);
    expect(deleteAgentsBatch).not.toHaveBeenCalled();

    let saved = await store.load();
    expect(saved?.chains['11155111'].lastUpdatedAt).toBe('20');
    expect(saved?.chains['59141'].lastUpdatedAt).toBe('15');
    expect(saved?.chains['84532'].lastUpdatedAt).toBe('12');

    indexAgent.mockClear();
    indexAgentsBatch.mockClear();

    subgraphB.append({
      id: '59141:b2',
      chainId: '59141',
      agentId: 'b2',
      updatedAt: '25',
      registrationFile: { name: 'DeltaB', supportedTrusts: [], mcpTools: [], mcpPrompts: [], mcpResources: [], a2aSkills: [] },
    });

    subgraphC.append({
      id: '84532:c2',
      chainId: '84532',
      agentId: 'c2',
      updatedAt: '18',
      registrationFile: { name: 'ZetaC', supportedTrusts: [], mcpTools: [], mcpPrompts: [], mcpResources: [], a2aSkills: [] },
    });

    await runner.run();

    expect(indexAgent).toHaveBeenCalledTimes(2);
    expect(indexAgentsBatch).not.toHaveBeenCalled();

    saved = await store.load();
    expect(saved?.chains['59141'].lastUpdatedAt).toBe('25');
    expect(saved?.chains['11155111'].lastUpdatedAt).toBe('20');
  });
});

