# Release Notes - Agent0 TypeScript SDK v0.31

## 🎯 OASF Taxonomies Integration

This release introduces comprehensive support for the **Open Agentic Schema Framework (OASF)** taxonomies, enabling agents to advertise their skills and domains using standardized taxonomies.

## What's New

### OASF Endpoint Support

Agents can now advertise their capabilities using the OASF taxonomy system, which provides standardized classifications for:
- **Skills**: Specific capabilities agents can perform (e.g., `natural_language_processing/summarization`, `data_engineering/data_transformation_pipeline`)
- **Domains**: Fields of application and knowledge areas (e.g., `finance_and_business/investment_services`, `healthcare/telemedicine`)

### OASF in Registration Files

The OASF endpoint appears in your agent's registration file as part of the `endpoints` array:

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "My AI Agent",
  "description": "An intelligent assistant for various tasks",
  "endpoints": [
    {
      "name": "OASF",
      "endpoint": "https://github.com/agntcy/oasf/",
      "version": "v0.8.0",
      "skills": [
        "advanced_reasoning_planning/strategic_planning",
        "data_engineering/data_transformation_pipeline",
        "natural_language_processing/natural_language_generation/summarization"
      ],
      "domains": [
        "finance_and_business/investment_services",
        "technology/data_science/data_visualization",
        "technology/software_engineering"
      ]
    }
  ]
}
```

The OASF endpoint structure includes:
- **`name`**: Always `"OASF"` to identify this endpoint type
- **`endpoint`**: The OASF specification URL (`"https://github.com/agntcy/oasf/"`)
- **`version`**: The OASF taxonomy version (currently `"v0.8.0"`)
- **`skills`**: Array of skill slugs from the OASF taxonomy
- **`domains`**: Array of domain slugs from the OASF taxonomy

## New Methods

### Adding Skills and Domains

#### `addSkill(slug, validateOASF = false)`

Add a skill to your agent's OASF endpoint:

```typescript
// Add skill without validation (allows any string)
agent.addSkill('custom_skill/my_skill', false);

// Add skill with validation (ensures it exists in OASF taxonomy)
agent.addSkill('advanced_reasoning_planning/strategic_planning', true);
```

#### `addDomain(slug, validateOASF = false)`

Add a domain to your agent's OASF endpoint:

```typescript
// Add domain without validation
agent.addDomain('custom_domain/my_domain', false);

// Add domain with validation
agent.addDomain('finance_and_business/investment_services', true);
```

### Removing Skills and Domains

#### `removeSkill(slug)`

Remove a skill from your agent's OASF endpoint:

```typescript
agent.removeSkill('advanced_reasoning_planning/strategic_planning');
```

#### `removeDomain(slug)`

Remove a domain from your agent's OASF endpoint:

```typescript
agent.removeDomain('finance_and_business/investment_services');
```

### Method Chaining

All methods support chaining for convenient configuration:

```typescript
agent
  .addSkill('data_engineering/data_transformation_pipeline', true)
  .addDomain('technology/data_science', true)
  .addSkill('natural_language_processing/summarization', true)
  .removeSkill('old_skill');
```

## Validation

When `validateOASF=true`, the SDK validates that the skill or domain slug exists in the OASF taxonomy before adding it. If validation fails, an `Error` is thrown:

```typescript
try {
  agent.addSkill('invalid_skill/does_not_exist', true);
} catch (error) {
  console.error('Invalid skill:', error.message);
  // Output: Invalid OASF skill slug: invalid_skill/does_not_exist. Use validateOASF=false to skip validation.
}
```

**Note**: Validation is **disabled by default** (`validateOASF=false`) to allow flexibility, but it's recommended to enable it to ensure your agent's capabilities are properly classified.

## OASF Taxonomy Files

The SDK includes the complete OASF v0.8.0 taxonomy files:

- **Skills**: `src/taxonomies/all_skills.json` (136 skills)
- **Domains**: `src/taxonomies/all_domains.json` (204 domains)

You can browse these files to find the appropriate skill and domain slugs for your agent. The taxonomy files follow the OASF specification from the [agntcy organization](https://github.com/agntcy/oasf).

### Example Skills

- `advanced_reasoning_planning/strategic_planning`
- `data_engineering/data_transformation_pipeline`
- `natural_language_processing/natural_language_generation/summarization`
- `agent_orchestration/task_decomposition`
- `security_privacy/vulnerability_analysis`

### Example Domains

- `finance_and_business/investment_services`
- `healthcare/telemedicine`
- `technology/data_science/data_visualization`
- `legal/contract_law`
- `education/e_learning`

## Complete Example

```typescript
import { SDK } from 'agent0-sdk';

// Initialize SDK
const sdk = new SDK({
  chainId: 11155111,
  rpcUrl: process.env.RPC_URL!,
  signer: process.env.PRIVATE_KEY
});

// Create agent
const agent = sdk.createAgent(
  'Data Analyst Pro',
  'A specialized AI agent for data analysis and visualization'
);

// Add OASF skills and domains with validation
agent
  .addSkill('data_engineering/data_transformation_pipeline', true)
  .addSkill('tabular_text/tabular_regression', true)
  .addSkill('multi_modal/image_processing/text_to_image', true)
  .addDomain('finance_and_business/investment_services', true)
  .addDomain('technology/data_science/data_visualization', true);

// Register agent
await agent.registerIPFS();
console.log(`Agent registered with OASF capabilities: ${agent.agentId}`);
```

## Benefits

1. **Standardized Classification**: Use industry-standard taxonomies for agent capabilities
2. **Better Discovery**: Agents can be discovered by their standardized skills and domains
3. **Interoperability**: Compatible with other systems using OASF taxonomies
4. **Validation**: Optional validation ensures your agent's capabilities are properly classified
5. **Flexibility**: Can add custom skills/domains when validation is disabled

## Migration from v0.3rc1

If you're upgrading from v0.3rc1, no changes are required. The OASF functionality is additive and doesn't affect existing functionality.

## Installation

```bash
npm install agent0-sdk@0.31.0
```

## What's Next

We're continuing to improve the SDK based on community feedback. Future releases may include:
- Additional OASF taxonomy versions
- Enhanced search capabilities using OASF classifications
- Integration with OASF-compatible agent discovery platforms

---

For more information about OASF, visit: https://github.com/agntcy/oasf

