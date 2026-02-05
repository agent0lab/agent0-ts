/**
 * OASF Taxonomies - Public exports
 *
 * Provides access to the Open Agentic Schema Framework (OASF) taxonomies
 * for skills and domains. These are used for standardized agent categorization.
 *
 * @example
 * ```typescript
 * import { OASF_SKILLS, OASF_DOMAINS } from 'agent0-sdk/taxonomies';
 *
 * // Access skill slugs
 * const skillSlugs = Object.keys(OASF_SKILLS.skills);
 *
 * // Access domain slugs
 * const domainSlugs = Object.keys(OASF_DOMAINS.domains);
 * ```
 */

import allSkills from './generated/all_skills.js';
import allDomains from './generated/all_domains.js';

/**
 * OASF Skills taxonomy data
 * Contains all standardized skill categories and their metadata
 */
export const OASF_SKILLS = allSkills as {
  metadata: {
    version: string;
    description: string;
    identifier_format: string;
    total_skills: number;
  };
  categories: Record<string, { caption: string; description: string }>;
  skills: Record<string, { caption?: string; name?: string; category?: string }>;
};

/**
 * OASF Domains taxonomy data
 * Contains all standardized domain categories and their metadata
 */
export const OASF_DOMAINS = allDomains as {
  metadata: {
    version: string;
    description: string;
    identifier_format: string;
    total_domains: number;
  };
  categories: Record<string, { caption: string; description: string }>;
  domains: Record<string, { caption?: string; name?: string; category?: string }>;
};

/**
 * Set of all valid OASF skill slugs
 */
export const OASF_SKILL_SLUGS = new Set(Object.keys(OASF_SKILLS.skills));

/**
 * Set of all valid OASF domain slugs
 */
export const OASF_DOMAIN_SLUGS = new Set(Object.keys(OASF_DOMAINS.domains));

/**
 * OASF version currently bundled in the SDK
 */
export const OASF_VERSION = OASF_SKILLS.metadata.version;
