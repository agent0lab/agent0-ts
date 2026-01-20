# Release Notes — 1.2.0

## Breaking changes

### Reputation: `score` → `value`

The ReputationRegistry scoring model migrated from `score (0–100)` to a decimal **`value`** stored on-chain as `(int256 value, uint8 valueDecimals)`.

This SDK release introduces a **hard break**:

- `giveFeedback(agentId, score, ...)` → `giveFeedback(agentId, value, ...)`
  - `value` accepts `number | string`
  - `string` is recommended for exact decimal inputs
  - `number` inputs are supported and **rounded** to fit up to 18 decimals
- Feedback search options:
  - `minScore/maxScore` → `minValue/maxValue`
- Reputation search filters:
  - `minAverageScore` → `minAverageValue`
- Feedback model:
  - `Feedback.score` → `Feedback.value`
- Reputation summary:
  - `{ count, averageScore }` → `{ count, averageValue }`

### Subgraph schema alignment

This SDK version expects the updated subgraph schema:

- `Feedback.value`
- `AgentStats.averageFeedbackValue`

If your subgraph is still exposing `Feedback.score`, you must deploy the updated subgraph before upgrading the SDK.


