/**
 * Tests for OASF skills and domains management
 */

import { SDK } from '../src/index';
import { EndpointType } from '../src/models/enums';
import { validateSkill, validateDomain } from '../src/core/oasf-validator';

describe('OASF Management', () => {
  let sdk: SDK;

  beforeEach(() => {
    // Initialize SDK without signer (read-only operations, no blockchain calls needed)
    sdk = new SDK({
      chainId: 11155111,
      rpcUrl: 'https://eth-sepolia.g.alchemy.com/v2/test',
    });
  });

  describe('addSkill', () => {
    it('should add a skill without validation', () => {
      const agent = sdk.createAgent('Test Agent', 'A test agent');

      // Add skill without validation
      agent.addSkill('custom_skill/test_skill', false);

      // Verify OASF endpoint was created
      const oasfEndpoints = agent.getRegistrationFile().endpoints.filter(
        (ep) => ep.type === EndpointType.OASF
      );
      expect(oasfEndpoints.length).toBe(1);

      const oasfEndpoint = oasfEndpoints[0];
      expect(oasfEndpoint.value).toBe('https://github.com/agntcy/oasf/');
      expect(oasfEndpoint.meta?.version).toBe('v0.8.0');
      expect((oasfEndpoint.meta?.skills as string[]).includes('custom_skill/test_skill')).toBe(
        true
      );
    });

    it('should add a valid skill with validation', () => {
      const agent = sdk.createAgent('Test Agent', 'A test agent');

      // Add valid skill with validation
      agent.addSkill('advanced_reasoning_planning/strategic_planning', true);

      // Verify skill was added
      const oasfEndpoint = agent
        .getRegistrationFile()
        .endpoints.find((ep) => ep.type === EndpointType.OASF);
      expect(
        (oasfEndpoint?.meta?.skills as string[]).includes(
          'advanced_reasoning_planning/strategic_planning'
        )
      ).toBe(true);
    });

    it('should throw error when adding invalid skill with validation', () => {
      const agent = sdk.createAgent('Test Agent', 'A test agent');

      // Try to add invalid skill with validation
      expect(() => {
        agent.addSkill('invalid_skill/does_not_exist', true);
      }).toThrow('Invalid OASF skill slug');
    });

    it('should not create duplicates when adding same skill twice', () => {
      const agent = sdk.createAgent('Test Agent', 'A test agent');

      // Add same skill twice
      agent.addSkill('test_skill/slug', false);
      agent.addSkill('test_skill/slug', false);

      // Verify only one instance exists
      const oasfEndpoint = agent
        .getRegistrationFile()
        .endpoints.find((ep) => ep.type === EndpointType.OASF);
      const skills = oasfEndpoint?.meta?.skills as string[];
      expect(skills.filter((s) => s === 'test_skill/slug').length).toBe(1);
    });
  });

  describe('removeSkill', () => {
    it('should remove an existing skill', () => {
      const agent = sdk.createAgent('Test Agent', 'A test agent');

      // Add skills
      agent.addSkill('test_skill/slug1', false);
      agent.addSkill('test_skill/slug2', false);

      // Remove one skill
      agent.removeSkill('test_skill/slug1');

      // Verify skill was removed
      const oasfEndpoint = agent
        .getRegistrationFile()
        .endpoints.find((ep) => ep.type === EndpointType.OASF);
      const skills = oasfEndpoint?.meta?.skills as string[];
      expect(skills.includes('test_skill/slug1')).toBe(false);
      expect(skills.includes('test_skill/slug2')).toBe(true);
    });

    it('should succeed silently when removing non-existent skill', () => {
      const agent = sdk.createAgent('Test Agent', 'A test agent');

      // Remove skill when OASF endpoint doesn't exist (should succeed silently)
      expect(() => {
        agent.removeSkill('non_existent_skill');
      }).not.toThrow();
    });

    it('should succeed silently when removing skill from non-existent endpoint', () => {
      const agent = sdk.createAgent('Test Agent', 'A test agent');

      // Remove skill when no OASF endpoint exists
      expect(() => {
        agent.removeSkill('some_skill');
      }).not.toThrow();
    });
  });

  describe('addDomain', () => {
    it('should add a domain without validation', () => {
      const agent = sdk.createAgent('Test Agent', 'A test agent');

      // Add domain without validation
      agent.addDomain('custom_domain/test_domain', false);

      // Verify OASF endpoint was created
      const oasfEndpoints = agent.getRegistrationFile().endpoints.filter(
        (ep) => ep.type === EndpointType.OASF
      );
      expect(oasfEndpoints.length).toBe(1);

      const oasfEndpoint = oasfEndpoints[0];
      expect((oasfEndpoint.meta?.domains as string[]).includes('custom_domain/test_domain')).toBe(
        true
      );
    });

    it('should add a valid domain with validation', () => {
      const agent = sdk.createAgent('Test Agent', 'A test agent');

      // Add valid domain with validation
      agent.addDomain('finance_and_business/investment_services', true);

      // Verify domain was added
      const oasfEndpoint = agent
        .getRegistrationFile()
        .endpoints.find((ep) => ep.type === EndpointType.OASF);
      expect(
        (oasfEndpoint?.meta?.domains as string[]).includes(
          'finance_and_business/investment_services'
        )
      ).toBe(true);
    });

    it('should throw error when adding invalid domain with validation', () => {
      const agent = sdk.createAgent('Test Agent', 'A test agent');

      // Try to add invalid domain with validation
      expect(() => {
        agent.addDomain('invalid_domain/does_not_exist', true);
      }).toThrow('Invalid OASF domain slug');
    });

    it('should not create duplicates when adding same domain twice', () => {
      const agent = sdk.createAgent('Test Agent', 'A test agent');

      // Add same domain twice
      agent.addDomain('test_domain/slug', false);
      agent.addDomain('test_domain/slug', false);

      // Verify only one instance exists
      const oasfEndpoint = agent
        .getRegistrationFile()
        .endpoints.find((ep) => ep.type === EndpointType.OASF);
      const domains = oasfEndpoint?.meta?.domains as string[];
      expect(domains.filter((d) => d === 'test_domain/slug').length).toBe(1);
    });
  });

  describe('removeDomain', () => {
    it('should remove an existing domain', () => {
      const agent = sdk.createAgent('Test Agent', 'A test agent');

      // Add domains
      agent.addDomain('test_domain/slug1', false);
      agent.addDomain('test_domain/slug2', false);

      // Remove one domain
      agent.removeDomain('test_domain/slug1');

      // Verify domain was removed
      const oasfEndpoint = agent
        .getRegistrationFile()
        .endpoints.find((ep) => ep.type === EndpointType.OASF);
      const domains = oasfEndpoint?.meta?.domains as string[];
      expect(domains.includes('test_domain/slug1')).toBe(false);
      expect(domains.includes('test_domain/slug2')).toBe(true);
    });

    it('should succeed silently when removing non-existent domain', () => {
      const agent = sdk.createAgent('Test Agent', 'A test agent');

      // Remove domain when OASF endpoint doesn't exist (should succeed silently)
      expect(() => {
        agent.removeDomain('non_existent_domain');
      }).not.toThrow();
    });
  });

  describe('method chaining', () => {
    it('should support method chaining', () => {
      const agent = sdk.createAgent('Test Agent', 'A test agent');

      // Chain multiple operations
      agent
        .addSkill('skill1', false)
        .addDomain('domain1', false)
        .addSkill('skill2', false)
        .removeSkill('skill1');

      // Verify results
      const oasfEndpoint = agent
        .getRegistrationFile()
        .endpoints.find((ep) => ep.type === EndpointType.OASF);
      const skills = oasfEndpoint?.meta?.skills as string[];
      const domains = oasfEndpoint?.meta?.domains as string[];
      expect(skills.includes('skill1')).toBe(false);
      expect(skills.includes('skill2')).toBe(true);
      expect(domains.includes('domain1')).toBe(true);
    });
  });

  describe('serialization/deserialization', () => {
    it('should persist OASF data through serialization', () => {
      const agent = sdk.createAgent('Test Agent', 'A test agent');

      // Add skills and domains
      agent.addSkill('test_skill/slug1', false);
      agent.addSkill('test_skill/slug2', false);
      agent.addDomain('test_domain/slug1', false);

      // Get registration file
      const regFile = agent.getRegistrationFile();

      // Verify data is present
      const oasfEndpoint = regFile.endpoints.find((ep) => ep.type === EndpointType.OASF);
      const skills = oasfEndpoint?.meta?.skills as string[];
      const domains = oasfEndpoint?.meta?.domains as string[];
      expect(skills.includes('test_skill/slug1')).toBe(true);
      expect(skills.includes('test_skill/slug2')).toBe(true);
      expect(domains.includes('test_domain/slug1')).toBe(true);
    });
  });
});

describe('OASF Validator', () => {
  describe('validateSkill', () => {
    it('should validate a valid skill', () => {
      expect(validateSkill('advanced_reasoning_planning/strategic_planning')).toBe(true);
    });

    it('should reject an invalid skill', () => {
      expect(validateSkill('invalid_skill/does_not_exist')).toBe(false);
    });
  });

  describe('validateDomain', () => {
    it('should validate a valid domain', () => {
      expect(validateDomain('finance_and_business/investment_services')).toBe(true);
    });

    it('should reject an invalid domain', () => {
      expect(validateDomain('invalid_domain/does_not_exist')).toBe(false);
    });
  });
});

