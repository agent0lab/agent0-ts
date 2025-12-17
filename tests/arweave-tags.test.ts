/**
 * Unit tests for Arweave tag generation utility
 * Tests comprehensive tagging for registration and feedback files uploaded to Arweave
 */

import { generateArweaveRegistrationTags, generateArweaveFeedbackTags } from '../src/utils/arweave-tags';
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

describe('generateArweaveFeedbackTags', () => {
  it('should generate essential tags for minimal feedback file', () => {
    const feedbackFile = {
      score: 85,
      tags: ['helpful'],
      text: 'Great agent!',
    };

    const tags = generateArweaveFeedbackTags(feedbackFile, 11155111);

    // Verify essential tags are present
    expect(tags).toContainEqual({ name: 'Content-Type', value: 'application/json' });
    expect(tags).toContainEqual({ name: 'App-Name', value: `Agent0-v${SDK_VERSION}` });
    expect(tags).toContainEqual({ name: 'Protocol', value: 'ERC-8004' });
    expect(tags).toContainEqual({ name: 'Data-Type', value: 'agent-feedback' });
    expect(tags).toContainEqual({ name: 'Chain-Id', value: '11155111' });
    expect(tags).toContainEqual({ name: 'Schema-Version', value: '1.0' });

    // Verify timestamp is present and valid ISO 8601
    const timestampTag = tags.find(tag => tag.name === 'Timestamp');
    expect(timestampTag).toBeDefined();
    expect(timestampTag?.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    // Should have score but no agent-specific tags
    expect(tags).toContainEqual({ name: 'Score', value: '85' });
    expect(tags.find(tag => tag.name === 'Agent-Id')).toBeUndefined();
    expect(tags.find(tag => tag.name === 'Reviewer')).toBeUndefined();
  });

  it('should include Agent-Id tag when agentId is provided', () => {
    const feedbackFile = {
      score: 90,
      tags: ['excellent'],
      text: 'Amazing work!',
    };

    const tags = generateArweaveFeedbackTags(feedbackFile, 11155111, '11155111:123');

    expect(tags).toContainEqual({ name: 'Agent-Id', value: '11155111:123' });
  });

  it('should include Reviewer tag when clientAddress is provided', () => {
    const feedbackFile = {
      score: 75,
      tags: ['good'],
      text: 'Solid performance',
    };

    const clientAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb';
    const tags = generateArweaveFeedbackTags(feedbackFile, 11155111, undefined, clientAddress);

    expect(tags).toContainEqual({ name: 'Reviewer', value: clientAddress });
  });

  it('should include both Agent-Id and Reviewer when both are provided', () => {
    const feedbackFile = {
      score: 95,
      tags: ['perfect'],
      text: 'Outstanding!',
    };

    const agentId = '11155111:456';
    const clientAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb';
    const tags = generateArweaveFeedbackTags(feedbackFile, 11155111, agentId, clientAddress);

    expect(tags).toContainEqual({ name: 'Agent-Id', value: agentId });
    expect(tags).toContainEqual({ name: 'Reviewer', value: clientAddress });
  });

  it('should include Score tag when score is present', () => {
    const feedbackFile = {
      score: 42,
      tags: [],
      text: 'Needs improvement',
    };

    const tags = generateArweaveFeedbackTags(feedbackFile, 11155111);

    expect(tags).toContainEqual({ name: 'Score', value: '42' });
  });

  it('should not include Score tag when score is missing', () => {
    const feedbackFile = {
      tags: ['helpful'],
      text: 'No score provided',
    };

    const tags = generateArweaveFeedbackTags(feedbackFile, 11155111);

    expect(tags.find(tag => tag.name === 'Score')).toBeUndefined();
  });

  it('should include Tag1 when tag1 is present', () => {
    const feedbackFile = {
      score: 80,
      tag1: 'helpful',
      tags: [],
    };

    const tags = generateArweaveFeedbackTags(feedbackFile, 11155111);

    expect(tags).toContainEqual({ name: 'Tag1', value: 'helpful' });
  });

  it('should include Tag2 when tag2 is present', () => {
    const feedbackFile = {
      score: 85,
      tag2: 'accurate',
      tags: [],
    };

    const tags = generateArweaveFeedbackTags(feedbackFile, 11155111);

    expect(tags).toContainEqual({ name: 'Tag2', value: 'accurate' });
  });

  it('should include both Tag1 and Tag2 when both are present', () => {
    const feedbackFile = {
      score: 90,
      tag1: 'helpful',
      tag2: 'accurate',
      tags: [],
    };

    const tags = generateArweaveFeedbackTags(feedbackFile, 11155111);

    expect(tags).toContainEqual({ name: 'Tag1', value: 'helpful' });
    expect(tags).toContainEqual({ name: 'Tag2', value: 'accurate' });
  });

  it('should not include Tag1 when tag1 is empty string', () => {
    const feedbackFile = {
      score: 70,
      tag1: '',
      tags: [],
    };

    const tags = generateArweaveFeedbackTags(feedbackFile, 11155111);

    expect(tags.find(tag => tag.name === 'Tag1')).toBeUndefined();
  });

  it('should include Capability tag when capability is present', () => {
    const feedbackFile = {
      score: 88,
      capability: 'tools',
      tags: [],
    };

    const tags = generateArweaveFeedbackTags(feedbackFile, 11155111);

    expect(tags).toContainEqual({ name: 'Capability', value: 'tools' });
  });

  it('should include Skill tag when skill is present', () => {
    const feedbackFile = {
      score: 92,
      skill: 'code_generation',
      tags: [],
    };

    const tags = generateArweaveFeedbackTags(feedbackFile, 11155111);

    expect(tags).toContainEqual({ name: 'Skill', value: 'code_generation' });
  });

  it('should include both Capability and Skill when both are present', () => {
    const feedbackFile = {
      score: 95,
      capability: 'prompts',
      skill: 'image_generation',
      tags: [],
    };

    const tags = generateArweaveFeedbackTags(feedbackFile, 11155111);

    expect(tags).toContainEqual({ name: 'Capability', value: 'prompts' });
    expect(tags).toContainEqual({ name: 'Skill', value: 'image_generation' });
  });

  it('should generate comprehensive tags for complete feedback file', () => {
    const feedbackFile = {
      score: 95,
      tag1: 'helpful',
      tag2: 'accurate',
      text: 'Excellent code generation!',
      capability: 'tools',
      skill: 'code_generation',
      context: { taskId: '123' },
      proofOfPayment: { txHash: '0xabc...' },
    };

    const agentId = '11155111:789';
    const clientAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb';
    const tags = generateArweaveFeedbackTags(feedbackFile, 11155111, agentId, clientAddress);

    // Essential tags
    expect(tags).toContainEqual({ name: 'Content-Type', value: 'application/json' });
    expect(tags).toContainEqual({ name: 'App-Name', value: `Agent0-v${SDK_VERSION}` });
    expect(tags).toContainEqual({ name: 'Protocol', value: 'ERC-8004' });
    expect(tags).toContainEqual({ name: 'Data-Type', value: 'agent-feedback' });
    expect(tags).toContainEqual({ name: 'Chain-Id', value: '11155111' });
    expect(tags).toContainEqual({ name: 'Schema-Version', value: '1.0' });

    // Identification tags
    expect(tags).toContainEqual({ name: 'Agent-Id', value: agentId });
    expect(tags).toContainEqual({ name: 'Reviewer', value: clientAddress });

    // Content tags
    expect(tags).toContainEqual({ name: 'Score', value: '95' });
    expect(tags).toContainEqual({ name: 'Tag1', value: 'helpful' });
    expect(tags).toContainEqual({ name: 'Tag2', value: 'accurate' });
    expect(tags).toContainEqual({ name: 'Capability', value: 'tools' });
    expect(tags).toContainEqual({ name: 'Skill', value: 'code_generation' });

    // Timestamp
    const timestampTag = tags.find(tag => tag.name === 'Timestamp');
    expect(timestampTag).toBeDefined();
    expect(timestampTag?.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    // Count total tags (6 essential + 2 identification + 5 content + 1 timestamp = 14)
    expect(tags.length).toBe(14);
  });

  it('should handle different chain IDs correctly', () => {
    const feedbackFile = {
      score: 80,
      tags: ['good'],
    };

    // Ethereum mainnet
    const tagsMainnet = generateArweaveFeedbackTags(feedbackFile, 1);
    expect(tagsMainnet).toContainEqual({ name: 'Chain-Id', value: '1' });

    // Base
    const tagsBase = generateArweaveFeedbackTags(feedbackFile, 8453);
    expect(tagsBase).toContainEqual({ name: 'Chain-Id', value: '8453' });

    // Sepolia
    const tagsSepolia = generateArweaveFeedbackTags(feedbackFile, 11155111);
    expect(tagsSepolia).toContainEqual({ name: 'Chain-Id', value: '11155111' });
  });

  it('should not include optional tags when fields are missing', () => {
    const feedbackFile = {
      // Only required fields
      tags: [],
      text: 'Minimal feedback',
    };

    const tags = generateArweaveFeedbackTags(feedbackFile, 11155111);

    // Should NOT have these optional tags
    expect(tags.find(tag => tag.name === 'Agent-Id')).toBeUndefined();
    expect(tags.find(tag => tag.name === 'Reviewer')).toBeUndefined();
    expect(tags.find(tag => tag.name === 'Score')).toBeUndefined();
    expect(tags.find(tag => tag.name === 'Tag1')).toBeUndefined();
    expect(tags.find(tag => tag.name === 'Tag2')).toBeUndefined();
    expect(tags.find(tag => tag.name === 'Capability')).toBeUndefined();
    expect(tags.find(tag => tag.name === 'Skill')).toBeUndefined();

    // Should only have essential tags + timestamp (7 total)
    expect(tags.length).toBe(7);
  });

  it('should handle zero score correctly', () => {
    const feedbackFile = {
      score: 0,
      tags: [],
      text: 'Poor performance',
    };

    const tags = generateArweaveFeedbackTags(feedbackFile, 11155111);

    // Zero is a valid score and should be included
    expect(tags).toContainEqual({ name: 'Score', value: '0' });
  });

  it('should handle maximum score correctly', () => {
    const feedbackFile = {
      score: 100,
      tags: [],
      text: 'Perfect!',
    };

    const tags = generateArweaveFeedbackTags(feedbackFile, 11155111);

    expect(tags).toContainEqual({ name: 'Score', value: '100' });
  });

  it('should generate valid ISO 8601 timestamps with milliseconds', () => {
    const feedbackFile = {
      score: 85,
      tags: ['helpful'],
    };

    const beforeTime = new Date().getTime();
    const tags = generateArweaveFeedbackTags(feedbackFile, 11155111);
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
