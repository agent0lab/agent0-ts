/**
 * Unit test for A2A skills extraction fix
 * Tests the _extractA2aSkills method directly
 */

import { EndpointCrawler } from '../src/core/endpoint-crawler.js';

describe('A2A Skills Extraction', () => {
  let crawler: EndpointCrawler;

  beforeEach(() => {
    crawler = new EndpointCrawler(5000);
  });

  test('should extract skills from spec-compliant agent card', async () => {
    // Mock agent card following A2A Protocol spec v0.3.0
    const mockAgentCard = {
      skills: [
        {
          id: 'cryptocurrency-intelligence',
          name: 'Cryptocurrency Intelligence',
          tags: ['blockchain', 'cryptocurrency', 'defi'],
        },
      ],
    };

    // Use private method accessor trick for testing
    const skills = (crawler as any)._extractA2aSkills(mockAgentCard);

    expect(skills).toEqual(['blockchain', 'cryptocurrency', 'defi']);
  });

  test('should extract skills from multiple skill objects', async () => {
    const mockAgentCard = {
      skills: [
        {
          id: 'skill-1',
          tags: ['blockchain', 'cryptocurrency'],
        },
        {
          id: 'skill-2',
          tags: ['defi', 'trading'],
        },
      ],
    };

    const skills = (crawler as any)._extractA2aSkills(mockAgentCard);

    expect(skills).toEqual(['blockchain', 'cryptocurrency', 'defi', 'trading']);
  });

  test('should return empty array for non-object skills', async () => {
    const mockAgentCard = {
      skills: ['blockchain', 'cryptocurrency', 'defi'], // Invalid format
    };

    const skills = (crawler as any)._extractA2aSkills(mockAgentCard);

    expect(skills).toEqual([]);
  });

  test('should remove duplicate tags', async () => {
    const mockAgentCard = {
      skills: [
        {
          id: 'skill-1',
          tags: ['blockchain', 'cryptocurrency', 'blockchain'], // duplicate
        },
        {
          id: 'skill-2',
          tags: ['cryptocurrency', 'defi'], // cryptocurrency is duplicate
        },
      ],
    };

    const skills = (crawler as any)._extractA2aSkills(mockAgentCard);

    expect(skills).toEqual(['blockchain', 'cryptocurrency', 'defi']);
  });

  test('should return empty array for missing skills', async () => {
    const mockAgentCard = {
      name: 'Test Agent',
      description: 'An agent without skills',
    };

    const skills = (crawler as any)._extractA2aSkills(mockAgentCard);

    expect(skills).toEqual([]);
  });

  test('should skip skills without tags field', async () => {
    const mockAgentCard = {
      skills: [
        {
          id: 'skill-1',
          tags: ['blockchain'],
        },
        {
          id: 'skill-2',
          name: 'No tags here', // Missing tags field
        },
        {
          id: 'skill-3',
          tags: ['defi'],
        },
      ],
    };

    const skills = (crawler as any)._extractA2aSkills(mockAgentCard);

    expect(skills).toEqual(['blockchain', 'defi']);
  });

  test('should fetch skills from real Deep42 agent card', async () => {
    const endpoint = 'https://deep42.cambrian.network/.well-known/agent-card.json';
    const capabilities = await crawler.fetchA2aCapabilities(endpoint);

    expect(capabilities).not.toBeNull();
    expect(capabilities?.a2aSkills).toBeDefined();
    expect(capabilities?.a2aSkills?.length).toBeGreaterThan(0);
    expect(capabilities?.a2aSkills).toContain('blockchain');
    expect(capabilities?.a2aSkills).toContain('cryptocurrency');
  }, 15000); // Longer timeout for network request
});
