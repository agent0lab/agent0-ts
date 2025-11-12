/**
 * OASF taxonomy validation utilities
 */

import allSkills from '../taxonomies/all_skills.json';
import allDomains from '../taxonomies/all_domains.json';

interface SkillsData {
  skills: Record<string, unknown>;
}

interface DomainsData {
  domains: Record<string, unknown>;
}

/**
 * Validate if a skill slug exists in the OASF taxonomy
 * @param slug The skill slug to validate (e.g., "natural_language_processing/summarization")
 * @returns True if the skill exists in the taxonomy, False otherwise
 */
export function validateSkill(slug: string): boolean {
  const skillsData = allSkills as SkillsData;
  const skills = skillsData.skills || {};
  return slug in skills;
}

/**
 * Validate if a domain slug exists in the OASF taxonomy
 * @param slug The domain slug to validate (e.g., "finance_and_business/investment_services")
 * @returns True if the domain exists in the taxonomy, False otherwise
 */
export function validateDomain(slug: string): boolean {
  const domainsData = allDomains as DomainsData;
  const domains = domainsData.domains || {};
  return slug in domains;
}

