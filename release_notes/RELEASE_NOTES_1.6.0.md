# Release Notes — 1.6.0 (stable)

## Highlights

- **FeedbackFile schema aligned with deployed subgraph**: feedback file fields now match the current subgraph `FeedbackFile` entity.
- **Legacy feedback fields removed**: legacy keys are no longer accepted or mapped by the SDK.
- **Fully on-chain registration files (ERC-8004 data URIs)**: the SDK now supports `agentURI`/`tokenURI` as `data:application/json;base64,...` for fully on-chain registration metadata.
- **IPFS backends updated**: deprecated `ipfs-http-client` removed; `ipfs: 'node'` uses Kubo RPC and a new embedded `ipfs: 'helia'` provider is available.

## Changes in 1.6.0 (since 1.5.3)

- **On-chain registration file support (`data:` URI)**
  - **Read**: `SDK.loadAgent()` now supports `agentURI`/`tokenURI` values like `data:application/json;base64,...` (tolerant of optional params such as `;charset=utf-8`).
  - **Write**: new `Agent.registerOnChain()` publishes the registration file fully on-chain by encoding it into a `data:` URI and calling `register(...)` / `setAgentURI(...)`.
  - **Safety**: `SDKConfig.registrationDataUriMaxBytes` limits decoded `data:` URI size (default **256 KiB**).
  - **Backwards compatible**: `registerIPFS()` and `registerHTTP()` are unchanged.

- **Spec-aligned feedback fields only**
  - `Feedback` / `FeedbackFileInput` now use:
    - `mcpTool`, `mcpPrompt`, `mcpResource`
    - `a2aSkills`, `a2aContextId`, `a2aTaskId`
    - `oasfSkills`, `oasfDomains`
  - Removed legacy fields from the interfaces and runtime behavior:
    - `capability`, `name`, `skill`, `task`, `context`

- **`giveFeedback(...)` no longer accepts legacy keys**
  - The optional `feedbackFile` payload is read as spec-only fields.
  - Callers must send `mcpTool` / `a2aSkills` / `a2aContextId` / `a2aTaskId` (and other spec fields as needed).

- **Subgraph queries select spec-aligned fields**
  - Subgraph selection for `feedbackFile` includes the spec-aligned fields so the SDK matches the deployed subgraph.

- **Tests updated**
  - Feedback tests now validate `mcpTool` + `a2aSkills` instead of legacy `capability`/`skill`.

- **IPFS: remove deprecated `ipfs-http-client`**
  - The SDK no longer depends on `ipfs-http-client` (deprecated; no security fixes).
  - The `ipfs: 'node'` provider now connects to a running Kubo daemon via `kubo-rpc-client`.

- **IPFS: add embedded Helia option**
  - New `ipfs: 'helia'` provider runs an embedded Helia node (in-process, no external daemon) for `add/get/pin/unpin` operations.
  - This is an alternative to running a separate IPFS daemon.

## Migration notes

- If you previously wrote feedback files like:
  - `capability: "tools"`, `name: "foo"`, `skill: "python"`, `task: "bar"`, `context: {...}`
  - Update to:
    - `mcpTool: "foo"` (or `mcpPrompt` / `mcpResource`)
    - `a2aSkills: ["python"]`
    - `a2aTaskId: "bar"` (if applicable)
    - `a2aContextId: "..."` (if applicable)

- If you use `ipfs: 'node'`:
  - Your `ipfsNodeUrl` should point to a running **Kubo HTTP RPC API** (for example `http://localhost:5001` or `http://localhost:5001/api/v0`).

- If you don’t want to run an IPFS daemon:
  - Switch to `ipfs: 'helia'`.

