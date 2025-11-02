/**
 * Unit tests for Arweave tag generation utility
 * Tests comprehensive tagging for registration files uploaded to Arweave
 */

import { generateArweaveRegistrationTags } from '../src/utils/arweave-tags';
import type { RegistrationFile } from '../src/models/interfaces';
import { EndpointType, TrustModel } from '../src/models/enums';
import { SDK_VERSION } from '../src/utils/constants';

describe('generateArweaveRegistrationTags', () => {
  it('should generate essential tags for minimal registration file', () => {
    const registrationFile: RegistrationFile = {
      name: 'Test Agent',
      description: 'Test description',
      endpoints: [],
      trustModels: [],
      owners: [],
      operators: [],
      active: true,
      x402support: false,
      metadata: {},
      updatedAt: Date.now(),
    };

    const tags = generateArweaveRegistrationTags(registrationFile, 11155111);

    // Verify essential tags are present
    expect(tags).toContainEqual({ name: 'Content-Type', value: 'application/json' });
    expect(tags).toContainEqual({ name: 'App-Name', value: `Agent0-v${SDK_VERSION}` });
    expect(tags).toContainEqual({ name: 'Protocol', value: 'ERC-8004' });
    expect(tags).toContainEqual({ name: 'Data-Type', value: 'agent-registration' });
    expect(tags).toContainEqual({ name: 'Chain-Id', value: '11155111' });
    expect(tags).toContainEqual({ name: 'Schema-Version', value: '1.0' });

    // Verify capability flags are present and false
    expect(tags).toContainEqual({ name: 'Has-MCP', value: 'false' });
    expect(tags).toContainEqual({ name: 'Has-A2A', value: 'false' });
    expect(tags).toContainEqual({ name: 'Has-Wallet', value: 'false' });
    expect(tags).toContainEqual({ name: 'Active', value: 'true' });

    // Verify timestamp is present and valid ISO 8601
    const timestampTag = tags.find(tag => tag.name === 'Timestamp');
    expect(timestampTag).toBeDefined();
    expect(timestampTag?.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    // Verify Agent-Id is NOT present (no agentId in registration file)
    expect(tags.find(tag => tag.name === 'Agent-Id')).toBeUndefined();
  });

  it('should include Agent-Id tag when agent is already registered', () => {
    const registrationFile: RegistrationFile = {
      agentId: '11155111:123',
      name: 'Registered Agent',
      description: 'Agent with ID',
      endpoints: [],
      trustModels: [],
      owners: [],
      operators: [],
      active: true,
      x402support: false,
      metadata: {},
      updatedAt: Date.now(),
    };

    const tags = generateArweaveRegistrationTags(registrationFile, 11155111);

    expect(tags).toContainEqual({ name: 'Agent-Id', value: '11155111:123' });
  });

  it('should set Has-MCP to true when MCP endpoint exists', () => {
    const registrationFile: RegistrationFile = {
      name: 'MCP Agent',
      description: 'Agent with MCP',
      endpoints: [
        {
          type: EndpointType.MCP,
          value: 'https://mcp.example.com/',
          meta: { version: '2025-06-18' }
        }
      ],
      trustModels: [],
      owners: [],
      operators: [],
      active: true,
      x402support: false,
      metadata: {},
      updatedAt: Date.now(),
    };

    const tags = generateArweaveRegistrationTags(registrationFile, 11155111);

    expect(tags).toContainEqual({ name: 'Has-MCP', value: 'true' });
    expect(tags).toContainEqual({ name: 'Has-A2A', value: 'false' });
  });

  it('should set Has-A2A to true when A2A endpoint exists', () => {
    const registrationFile: RegistrationFile = {
      name: 'A2A Agent',
      description: 'Agent with A2A',
      endpoints: [
        {
          type: EndpointType.A2A,
          value: 'https://a2a.example.com/'
        }
      ],
      trustModels: [],
      owners: [],
      operators: [],
      active: true,
      x402support: false,
      metadata: {},
      updatedAt: Date.now(),
    };

    const tags = generateArweaveRegistrationTags(registrationFile, 11155111);

    expect(tags).toContainEqual({ name: 'Has-MCP', value: 'false' });
    expect(tags).toContainEqual({ name: 'Has-A2A', value: 'true' });
  });

  it('should set Has-MCP and Has-A2A to true when both endpoints exist', () => {
    const registrationFile: RegistrationFile = {
      name: 'Multi-Endpoint Agent',
      description: 'Agent with MCP and A2A',
      endpoints: [
        {
          type: EndpointType.MCP,
          value: 'https://mcp.example.com/'
        },
        {
          type: EndpointType.A2A,
          value: 'https://a2a.example.com/'
        }
      ],
      trustModels: [],
      owners: [],
      operators: [],
      active: true,
      x402support: false,
      metadata: {},
      updatedAt: Date.now(),
    };

    const tags = generateArweaveRegistrationTags(registrationFile, 11155111);

    expect(tags).toContainEqual({ name: 'Has-MCP', value: 'true' });
    expect(tags).toContainEqual({ name: 'Has-A2A', value: 'true' });
  });

  it('should set Has-Wallet to true when wallet address exists', () => {
    const registrationFile: RegistrationFile = {
      name: 'Wallet Agent',
      description: 'Agent with wallet',
      endpoints: [],
      trustModels: [],
      owners: [],
      operators: [],
      active: true,
      x402support: false,
      metadata: {},
      updatedAt: Date.now(),
      walletAddress: '0xabc123',
      walletChainId: 1
    };

    const tags = generateArweaveRegistrationTags(registrationFile, 11155111);

    expect(tags).toContainEqual({ name: 'Has-Wallet', value: 'true' });
  });

  it('should set Active to false when agent is inactive', () => {
    const registrationFile: RegistrationFile = {
      name: 'Inactive Agent',
      description: 'Agent inactive',
      endpoints: [],
      trustModels: [],
      owners: [],
      operators: [],
      active: false,
      x402support: false,
      metadata: {},
      updatedAt: Date.now(),
    };

    const tags = generateArweaveRegistrationTags(registrationFile, 11155111);

    expect(tags).toContainEqual({ name: 'Active', value: 'false' });
  });

  it('should handle different chain IDs correctly', () => {
    const registrationFile: RegistrationFile = {
      name: 'Mainnet Agent',
      description: 'Agent on mainnet',
      endpoints: [],
      trustModels: [],
      owners: [],
      operators: [],
      active: true,
      x402support: false,
      metadata: {},
      updatedAt: Date.now(),
    };

    // Test Ethereum mainnet
    const mainnetTags = generateArweaveRegistrationTags(registrationFile, 1);
    expect(mainnetTags).toContainEqual({ name: 'Chain-Id', value: '1' });

    // Test Sepolia testnet
    const sepoliaTags = generateArweaveRegistrationTags(registrationFile, 11155111);
    expect(sepoliaTags).toContainEqual({ name: 'Chain-Id', value: '11155111' });

    // Test Polygon
    const polygonTags = generateArweaveRegistrationTags(registrationFile, 137);
    expect(polygonTags).toContainEqual({ name: 'Chain-Id', value: '137' });
  });

  it('should generate complete tags for fully-featured registration file', () => {
    const registrationFile: RegistrationFile = {
      agentId: '11155111:456',
      name: 'Complete Agent',
      description: 'Agent with all features',
      image: 'https://example.com/image.png',
      endpoints: [
        {
          type: EndpointType.MCP,
          value: 'https://mcp.example.com/',
          meta: { version: '2025-06-18' }
        },
        {
          type: EndpointType.A2A,
          value: 'https://a2a.example.com/'
        },
        {
          type: EndpointType.ENS,
          value: 'agent.eth'
        }
      ],
      trustModels: [TrustModel.REPUTATION, TrustModel.CRYPTO_ECONOMIC],
      owners: [],
      operators: [],
      active: true,
      x402support: true,
      metadata: {},
      updatedAt: Date.now(),
      walletAddress: '0xwallet123',
      walletChainId: 1
    };

    const tags = generateArweaveRegistrationTags(registrationFile, 11155111);

    // Essential tags
    expect(tags).toContainEqual({ name: 'Content-Type', value: 'application/json' });
    expect(tags).toContainEqual({ name: 'App-Name', value: `Agent0-v${SDK_VERSION}` });
    expect(tags).toContainEqual({ name: 'Protocol', value: 'ERC-8004' });
    expect(tags).toContainEqual({ name: 'Data-Type', value: 'agent-registration' });
    expect(tags).toContainEqual({ name: 'Chain-Id', value: '11155111' });
    expect(tags).toContainEqual({ name: 'Schema-Version', value: '1.0' });

    // Agent-Id (present)
    expect(tags).toContainEqual({ name: 'Agent-Id', value: '11155111:456' });

    // Capability flags (all true)
    expect(tags).toContainEqual({ name: 'Has-MCP', value: 'true' });
    expect(tags).toContainEqual({ name: 'Has-A2A', value: 'true' });
    expect(tags).toContainEqual({ name: 'Has-Wallet', value: 'true' });
    expect(tags).toContainEqual({ name: 'Active', value: 'true' });

    // Timestamp
    const timestampTag = tags.find(tag => tag.name === 'Timestamp');
    expect(timestampTag).toBeDefined();
    expect(timestampTag?.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    // Verify total number of tags (11: 6 essential + 1 agentId + 4 capability flags + 1 timestamp)
    expect(tags).toHaveLength(12);
  });

  it('should handle ENS and DID endpoints without affecting Has-MCP or Has-A2A', () => {
    const registrationFile: RegistrationFile = {
      name: 'ENS+DID Agent',
      description: 'Agent with ENS and DID only',
      endpoints: [
        {
          type: EndpointType.ENS,
          value: 'agent.eth'
        },
        {
          type: EndpointType.DID,
          value: 'did:example:123'
        }
      ],
      trustModels: [],
      owners: [],
      operators: [],
      active: true,
      x402support: false,
      metadata: {},
      updatedAt: Date.now(),
    };

    const tags = generateArweaveRegistrationTags(registrationFile, 11155111);

    // ENS and DID should not trigger MCP or A2A flags
    expect(tags).toContainEqual({ name: 'Has-MCP', value: 'false' });
    expect(tags).toContainEqual({ name: 'Has-A2A', value: 'false' });
  });

  it('should handle multiple MCP endpoints (still true)', () => {
    const registrationFile: RegistrationFile = {
      name: 'Multi-MCP Agent',
      description: 'Agent with multiple MCP endpoints',
      endpoints: [
        {
          type: EndpointType.MCP,
          value: 'https://mcp1.example.com/'
        },
        {
          type: EndpointType.MCP,
          value: 'https://mcp2.example.com/'
        }
      ],
      trustModels: [],
      owners: [],
      operators: [],
      active: true,
      x402support: false,
      metadata: {},
      updatedAt: Date.now(),
    };

    const tags = generateArweaveRegistrationTags(registrationFile, 11155111);

    expect(tags).toContainEqual({ name: 'Has-MCP', value: 'true' });
  });

  it('should generate valid ISO 8601 timestamps with milliseconds', () => {
    const registrationFile: RegistrationFile = {
      name: 'Timestamp Test Agent',
      description: 'Testing timestamp format',
      endpoints: [],
      trustModels: [],
      owners: [],
      operators: [],
      active: true,
      x402support: false,
      metadata: {},
      updatedAt: Date.now(),
    };

    const beforeTime = new Date().getTime();
    const tags = generateArweaveRegistrationTags(registrationFile, 11155111);
    const afterTime = new Date().getTime();

    const timestampTag = tags.find(tag => tag.name === 'Timestamp');
    expect(timestampTag).toBeDefined();

    const timestamp = new Date(timestampTag!.value).getTime();

    // Verify timestamp is within reasonable range
    expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
    expect(timestamp).toBeLessThanOrEqual(afterTime);

    // Verify format includes milliseconds (3 digits before Z)
    expect(timestampTag!.value).toMatch(/\.\d{3}Z$/);
  });
});
