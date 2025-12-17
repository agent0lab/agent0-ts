/**
 * Unit tests for formatRegistrationFileForStorage utility
 * Tests ERC-8004 compliant formatting shared by IPFSClient and ArweaveClient
 */

import { formatRegistrationFileForStorage } from '../src/utils/registration-format';
import type { RegistrationFile } from '../src/models/interfaces';
import { EndpointType, TrustModel } from '../src/models/enums';

describe('formatRegistrationFileForStorage', () => {
  it('should format minimal registration file to ERC-8004 format', () => {
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

    const result = formatRegistrationFileForStorage(registrationFile);

    expect(result.type).toBe('https://eips.ethereum.org/EIPS/eip-8004#registration-v1');
    expect(result.name).toBe('Test Agent');
    expect(result.description).toBe('Test description');
    expect(result.active).toBe(true);
    expect(result.x402support).toBe(false);
    expect(result.endpoints).toEqual([]);
    expect(result.registrations).toBeUndefined();
    expect(result.supportedTrusts).toBeUndefined();
  });

  it('should format registration file with MCP endpoint', () => {
    const registrationFile: RegistrationFile = {
      name: 'MCP Agent',
      description: 'Agent with MCP endpoint',
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

    const result = formatRegistrationFileForStorage(registrationFile);

    expect(result.endpoints).toHaveLength(1);
    expect(result.endpoints).toEqual([
      {
        name: EndpointType.MCP,
        endpoint: 'https://mcp.example.com/',
        version: '2025-06-18'
      }
    ]);
  });

  it('should format registration file with wallet address', () => {
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

    const result = formatRegistrationFileForStorage(registrationFile);

    expect(result.endpoints).toHaveLength(1);
    expect(result.endpoints).toEqual([
      {
        name: 'agentWallet',
        endpoint: 'eip155:1:0xabc123'
      }
    ]);
  });

  it('should format registration file with wallet using default chainId', () => {
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
    };

    const result = formatRegistrationFileForStorage(registrationFile, 11155111);

    expect(result.endpoints).toHaveLength(1);
    expect(result.endpoints).toEqual([
      {
        name: 'agentWallet',
        endpoint: 'eip155:11155111:0xabc123'
      }
    ]);
  });

  it('should format registration file with agentId and registry', () => {
    const registrationFile: RegistrationFile = {
      agentId: '11155111:0:123',
      name: 'Registered Agent',
      description: 'Agent with agentId',
      endpoints: [],
      trustModels: [],
      owners: [],
      operators: [],
      active: true,
      x402support: false,
      metadata: {},
      updatedAt: Date.now(),
    };

    const result = formatRegistrationFileForStorage(
      registrationFile,
      11155111,
      '0xregistry'
    );

    expect(result.registrations).toBeDefined();
    expect(result.registrations).toHaveLength(1);
    expect(result.registrations).toEqual([
      {
        agentId: 123,
        agentRegistry: 'eip155:11155111:0xregistry'
      }
    ]);
  });

  it('should format registration file with agentId but no registry', () => {
    const registrationFile: RegistrationFile = {
      agentId: '11155111:0:456',
      name: 'Registered Agent',
      description: 'Agent with agentId',
      endpoints: [],
      trustModels: [],
      owners: [],
      operators: [],
      active: true,
      x402support: false,
      metadata: {},
      updatedAt: Date.now(),
    };

    const result = formatRegistrationFileForStorage(registrationFile);

    expect(result.registrations).toBeDefined();
    expect(result.registrations).toHaveLength(1);
    expect(result.registrations).toEqual([
      {
        agentId: 456,
        agentRegistry: 'eip155:1:{identityRegistry}'
      }
    ]);
  });

  it('should format registration file with trust models', () => {
    const registrationFile: RegistrationFile = {
      name: 'Trusted Agent',
      description: 'Agent with trust models',
      endpoints: [],
      trustModels: [TrustModel.REPUTATION, TrustModel.CRYPTO_ECONOMIC],
      owners: [],
      operators: [],
      active: true,
      x402support: false,
      metadata: {},
      updatedAt: Date.now(),
    };

    const result = formatRegistrationFileForStorage(registrationFile);

    expect(result.supportedTrusts).toBeDefined();
    expect(result.supportedTrusts).toEqual([
      TrustModel.REPUTATION,
      TrustModel.CRYPTO_ECONOMIC
    ]);
  });

  it('should format registration file with image', () => {
    const registrationFile: RegistrationFile = {
      name: 'Image Agent',
      description: 'Agent with image',
      image: 'https://example.com/image.png',
      endpoints: [],
      trustModels: [],
      owners: [],
      operators: [],
      active: true,
      x402support: false,
      metadata: {},
      updatedAt: Date.now(),
    };

    const result = formatRegistrationFileForStorage(registrationFile);

    expect(result.image).toBe('https://example.com/image.png');
  });

  it('should format complete registration file with all features', () => {
    const registrationFile: RegistrationFile = {
      agentId: '11155111:0:789',
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
        }
      ],
      trustModels: [TrustModel.REPUTATION],
      owners: [],
      operators: [],
      active: true,
      x402support: true,
      metadata: {},
      updatedAt: Date.now(),
      walletAddress: '0xwallet123',
      walletChainId: 1
    };

    const result = formatRegistrationFileForStorage(
      registrationFile,
      11155111,
      '0xregistry'
    );

    expect(result.type).toBe('https://eips.ethereum.org/EIPS/eip-8004#registration-v1');
    expect(result.name).toBe('Complete Agent');
    expect(result.description).toBe('Agent with all features');
    expect(result.image).toBe('https://example.com/image.png');
    expect(result.active).toBe(true);
    expect(result.x402support).toBe(true);

    // Should have 3 endpoints: MCP, A2A, and wallet
    expect(result.endpoints).toHaveLength(3);
    const endpoints = result.endpoints as Array<Record<string, unknown>>;
    expect(endpoints[0]).toEqual({
      name: EndpointType.MCP,
      endpoint: 'https://mcp.example.com/',
      version: '2025-06-18'
    });
    expect(endpoints[1]).toEqual({
      name: EndpointType.A2A,
      endpoint: 'https://a2a.example.com/'
    });
    expect(endpoints[2]).toEqual({
      name: 'agentWallet',
      endpoint: 'eip155:1:0xwallet123'
    });

    expect(result.registrations).toHaveLength(1);
    const registrations = result.registrations as Array<Record<string, unknown>>;
    expect(registrations[0]).toEqual({
      agentId: 789,
      agentRegistry: 'eip155:11155111:0xregistry'
    });

    expect(result.supportedTrusts).toEqual([TrustModel.REPUTATION]);
  });

  it('should handle endpoint without meta', () => {
    const registrationFile: RegistrationFile = {
      name: 'Simple Endpoint Agent',
      description: 'Agent with endpoint without meta',
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

    const result = formatRegistrationFileForStorage(registrationFile);

    expect(result.endpoints).toHaveLength(1);
    const endpoints = result.endpoints as Array<Record<string, unknown>>;
    expect(endpoints[0]).toEqual({
      name: EndpointType.A2A,
      endpoint: 'https://a2a.example.com/'
    });
  });
});
