# SDK additions: messaging, tasks, and x402

This document specifies new APIs on the Agent0 SDK **Agent** type: A2A messaging, XMTP conversations, task handling, and x402 payment-required flows. These extend the existing Agent API (`a2aEndpoint`, `setA2A`, `getWallet()`, `setX402Support()`, etc.).

**References:** [A2A Protocol](https://a2a-protocol.org/dev/specification/) · [XMTP Conversations](https://docs.xmtp.org/chat-apps/core-messaging/create-conversations) · [x402 HTTP 402](https://x402.gitbook.io/x402/core-concepts/http-402)

---

## 1. Messaging

### 1.0 Unified message

**`agent.message(content [, options])`** — Unified entry point. Determines which message methods are available for this agent (A2A, XMTP), uses a fixed priority order (**A2A first, then XMTP**), and delegates to the corresponding method (e.g. `messageA2A`, then `messageXMTP`). Returns the same shape as the underlying call (e.g. `MessageResponse | TaskResponse` when A2A is used). The SDK exposes this and the protocol-specific methods (`messageA2A`, `messageXMTP`); callers may use either.

**Options** — Passed through to the underlying method. When A2A is used: same as **`messageA2A`** (`blocking`, `contextId`, `taskId`, optional **`credential`** — see §2.1 and §2.5). When XMTP is used: no options specified for now.

---

## 2. A2A

### 2.1 Send message (messageA2A)

**`agent.messageA2A(content [, options])`**

Sends a message to the agent’s A2A endpoint. The server may reply with a direct message or create a task.

**Parameters**

- **content** — `string` or `object`.
  - String: treated as a single text part (SDK builds the A2A message).
  - Object: A2A message shape with **`parts`** (array of Part). Example: `{ parts: [{ text: 'What is the weather today?' }] }`. Parts use `text`, `url`, `data`, or `raw` per [A2A Part](https://a2a-protocol.org/dev/specification/). The SDK may allow omitting `role` (defaults to user) and `messageId` (generated if absent). Follow-ups use **options.taskId** / **options.contextId** (see options).
- **options** *(optional)* — e.g. `{ blocking?: boolean; contextId?: string; taskId?: string; credential?: string | Credential }`.  
  - `blocking: true` — wait until the task reaches a terminal state and return the final task state; otherwise return immediately.  
  - **`contextId`** — associate this message with an existing conversation context (opaque string from a previous Task or Message). Omit to start a new context; server will generate and return a new `contextId`. Pass `contextId` without `taskId` to start a **new task** in that same context.  
  - **`taskId`** — send a follow-up message to this existing task (continue or refine). Server infers `contextId` from the task if omitted. If you pass both `contextId` and `taskId`, they must match the task’s context or the server may reject.  
  - **`credential`** *(optional)* — when the agent’s endpoint requires auth, pass a credential: **string** (treated as `{ apiKey: string }`) or **object** (e.g. `{ apiKey: "..." }` or other keys for JWTs). The agent’s AgentCard **securitySchemes** (see §2.5) determine where and under what name the value is sent (header, query, cookie).

**Returns**

- **MessageResponse** — direct reply from the agent (no task). Typed object with message content (e.g. `content`, `parts`) and optional `contextId`. No `task` or `taskId`.
- **TaskResponse** — server created a task. Typed object with **`taskId`** (opaque string), **`contextId`**, and **`task`** (the task handle, e.g. an `AgentTask`). Use `response.task` to work with the task; use `agent.loadTask(taskId)` only when loading by ID (e.g. after restart). Discriminate from MessageResponse by shape: TaskResponse has `task` and `taskId`; MessageResponse does not (e.g. `'task' in response`).
- If the server responds with **HTTP 402**, the result is a response object that includes **`x402Required`** (see §4). The SDK does not throw; the caller checks `response.x402Required` and may call `response.x402Payment.pay()` to pay and retry.

**Errors**

- Missing or invalid A2A endpoint, network errors, 4xx/5xx (other than 402) — thrown or surfaced as error result per SDK convention.
- 402 is not treated as an error; it is a normal response with `x402Required` set.

**A2A mapping**

- Under the hood this maps to A2A **Send Message** (e.g. `POST /message:send` in the HTTP binding).

### 2.2 Getting a task handle

- **`response.task`** — When `messageA2A` returns a **TaskResponse**, **`response.task`** is the task handle (e.g. an **AgentTask** object). Use it directly. Discriminate by shape: e.g. `'task' in response` or `response.task !== undefined`.
- **`agent.loadTask(taskId)`** — Load an existing task by ID when you don’t have the response (e.g. after restart or when the ID was stored). `taskId` is an opaque string from the A2A server. Returns the same kind of task handle as `response.task`.

Example:

```ts
const response = await agent.messageA2A({ parts: [{ text: 'analyze ETH sentiment' }] });
if ('task' in response) {
  const task = response.task;  // AgentTask — use task.query(), task.message(), task.cancel()
}
// Or, when you only have the ID: const task = agent.loadTask(taskId);
```

### 2.3 Listing tasks

**`agent.listTasks([options])`**

Returns a list of tasks for this agent. Use when you don’t have a `taskId` yet (e.g. “my open tasks”).

**Options** *(optional)*

- **filter** — e.g. by **`contextId`** (tasks in that conversation only), by status (`open`, `completed`, `failed`, `canceled`), or other A2A list filters.
- **historyLength** — max number of messages to include per task in the list response (0 to omit history).
- **`credential`** *(optional)* — when the agent’s endpoint requires auth, same as **messageA2A** (string or credential object; see §2.5).

**Returns**

- List of **all** task summaries or full task objects matching the filter (per options). The SDK fetches all pages internally; callers receive a single array.
- May include **`x402Required`** if the list endpoint returns HTTP 402 (see §4).

*Implementation note:* The SDK may use A2A cursor pagination (pageSize/pageToken) under the hood until no more pages; the public API does not expose pagination.

### 2.4 Task handle (AgentTask)

A task handle (e.g. **AgentTask**) is an object tied to a single task ID.

**Properties (read-only):**

- **`task.taskId`** — The A2A task ID (opaque string). Use with `agent.loadTask(task.taskId)` to load the same task later (e.g. after restart).
- **`task.contextId`** — The A2A context ID for this task (opaque string). All tasks and messages with the same `contextId` belong to the same conversational session. Use it when starting a new task in the same context via `messageA2A(content, { contextId: task.contextId })` or when listing tasks in that context via `listTasks({ filter: { contextId: task.contextId } })`.

**Methods:**


| Method                      | Description                                                                                                                                                                          | A2A mapping                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| **`task.query([options])`** | Get current task state (status, artifacts, optional message history). Options may include `historyLength`.                                                                           | Get Task `GET /tasks/{id}`              |
| **`task.message(content)`** | Send another message to this task (follow-up). Same `content` shapes as `messageA2A`. The SDK sends this task’s `taskId` (and `contextId`) automatically; no need to pass contextId. | Send Message with existing task context |
| **`task.cancel()`**         | Cancel the task. Returns updated task state.                                                                                                                                         | Cancel Task `POST /tasks/{id}:cancel`   |


**x402:** Any of these methods may return a result that includes **`x402Required`** (e.g. the server requires payment for that operation). Same handling as §4: caller checks `x402Required` and may call `x402Payment.pay()` to retry.

**Auth:** **`task.query()`**, **`task.message()`**, and **`task.cancel()`** use the same auth as the agent’s A2A calls (see §2.5); no separate **credential** option on task methods.

**Task status / lifecycle**

- Tasks have a status (e.g. open, in progress, completed, failed, canceled, rejected, or server-specific values). The spec defers to A2A for exact status values.
- Once a task is in a terminal state (completed, failed, canceled, rejected), it typically cannot accept new messages; `task.message()` may fail or no-op.

### 2.5 A2A auth (optional)

When an agent’s A2A endpoint requires authentication, the **AgentCard** (e.g. from the A2A endpoint or discovery) may declare **securitySchemes** (OpenAPI 3 style). The caller provides **options.credential** on **messageA2A** or **listTasks**: either a **string** (treated as `{ apiKey: string }`) or a **credential object** (e.g. `{ apiKey: "..." }` or other keys for JWTs). The SDK uses the agent’s **securitySchemes** to send the credential in the right place (header, query, or cookie and name).

**AgentCard shape** — **securitySchemes** object with named schemes (e.g. `apiKey`). Each scheme has **`type`** (`apiKey` or `http` for now); for **apiKey** it also has **`in`** (e.g. `header`, `query`, `cookie`) and **`name`** (e.g. `X-API-Key`). A **`security`** array references which schemes are required (e.g. `[{ "apiKey": [] }]`).

Example:

```json
{
  "securitySchemes": {
    "apiKey": {
      "type": "apiKey",
      "in": "header",
      "name": "X-API-Key"
    }
  },
  "security": [{ "apiKey": [] }]
}
```

When **credential** is provided in options (string or credential object), the SDK normalizes to a credential (e.g. string → `{ apiKey: string }`) and uses the agent’s **securitySchemes** to place it in the request (for **apiKey** type: **`in`** + **`name`**; for **http** e.g. Bearer: **Authorization** header). The scheme also determines which key from the credential object is used (e.g. `apiKey`). Supported scheme types for now: **apiKey** and **http**. If the AgentCard has no supported scheme, behavior is implementation-defined.

---

## 3. XMTP

### 3.1 Assumptions

- A wallet **need not** be connected to use XMTP when the user has an **installation key** and loads an existing inbox (e.g. **`sdk.loadXMTPInbox(installationKey)`** or an installation key provided at config). Sending, listing conversations, and agent XMTP methods (**`agent.messageXMTP(content)`**, **`agent.loadXMTPConversation()`**) use the loaded inbox and the agent's wallet address (e.g. from **`agent.getWallet()`**); no signer is required. A wallet **is** required only when **registering** a new inbox (**`sdk.registerXMTPInbox()`**), to sign the registration.
- The agent may have a wallet (e.g. via `agent.getWallet()`). There is one conversation per pair of addresses (1:1 DM). Alternatives may be specified later.
- When a wallet is used for XMTP (registering or messaging as/with an agent), that wallet must be on the XMTP network (have a registered XMTP identity).
- The SDK is either **connected to an inbox** (via **`sdk.loadXMTPInbox()`**, either automatically when an installation key is given at config or manually by the user, or by automatic registration when a messaging method is used without an inbox — see below) or not.

### 3.2 Inbox connection and registration

**Optional installation key at config**

- The SDK accepts an **optional XMTP installation key** (or keys) parameter (e.g. at construction or via a setter). When provided, the SDK **automatically** calls **`sdk.loadXMTPInbox()`** (with that key) so the inbox is connected at init. When not provided, the user may call **`sdk.loadXMTPInbox(installationKey)`** manually (with a key they persisted from a previous register), or call **`sdk.registerXMTPInbox()`** to create and connect a new inbox. **If the user calls a messaging or conversation method (e.g. `sdk.messageXMTP`, `sdk.XMTPConversations()`, `sdk.loadXMTPConversation`, or the agent XMTP methods) without having set up an inbox**, the SDK **may automatically** register a new inbox (when a wallet is connected) and then proceed; if no wallet is connected, the SDK errors.

**`sdk.loadXMTPInbox(installationKey?)`**

- Connects the SDK to an XMTP inbox using the given installation key(s). If an installation key was provided at SDK config, the SDK may call this automatically at init; the user can also call it **manually** after the SDK is already initialized to connect an inbox (e.g. after obtaining a key from storage). When called with a key, the SDK validates that an inbox with those keys exists (and that the keys are correct); if not, it errors. When already connected to an inbox, calling **`loadXMTPInbox`** again with a different key may switch to that inbox or error per implementation; calling with the same key is a no-op.
- **Errors** if the provided key(s) are invalid or no inbox exists for them.

**`sdk.registerXMTPInbox()`**

- Use when the **SDK is not already connected to an XMTP inbox**. Creates a new installation and registers it with XMTP. The SDK **generates** installation key(s) and signs with the connected wallet. **Returns** the **installation key(s)** so the caller can persist them and pass them to **`loadXMTPInbox()`** on future runs; the SDK does not persist them. Requires a connected wallet.
- **Errors** if the SDK is already connected to an inbox. **Errors** if the wallet has already reached the maximum number of installations allowed by XMTP (the user must revoke an existing installation elsewhere before creating a new one).
- The wallet may already have an inbox on the XMTP network (from another app or device); this method creates a **new** installation so this SDK instance can connect. If the wallet is at max installations, the method errors (see above).

**`sdk.getXMTPInstallationKey()`** *(optional)*

- Returns the installation key(s) for the currently loaded XMTP client, if any, so the user can persist them after first use. When no client is loaded or keys are not available, returns `undefined` (or throws per SDK convention).

**`sdk.getXMTPInboxInfo()`**

- Returns information about the currently loaded inbox, when the SDK is connected to one. Includes: **walletAddress** (the WA linked to this inbox on the XMTP network), **publicKey(s)** for the installation, **privateKey(s)** or key material (for backup/export; callers must handle and store securely), **installationId**, and **inboxId**. When no inbox is loaded, returns `undefined` (or throws per SDK convention). Exposing private key material is sensitive; implementations may require an explicit opt-in or scoped API for private keys.

**Message history**

- The SDK does **not** use a local message database. All message history is **fetched from the XMTP network** each time (e.g. via the client’s sync/conversation APIs). No local persistence of message content.

### 3.3 SDK: connected wallet

- **`sdk.XMTPConversations()`** — List conversations for the loaded inbox. If no inbox is connected, the SDK may **automatically** register a new inbox (when a wallet is connected) and then return the list; otherwise errors. Returns array of conversation handles or summary objects (e.g. peer address, last activity).
- **`sdk.messageXMTP(peerAddress, content)`** — Send a message to that address. If no inbox is connected, the SDK may **automatically** register a new inbox (when a wallet is connected) and then send; otherwise errors. **Fails** if the receiver (`peerAddress`) has no registered XMTP inbox.
- **`sdk.loadXMTPConversation(peerAddress)`** — Get the conversation with that peer. If no inbox is connected, the SDK may **automatically** register a new inbox (when a wallet is connected) and then load the conversation; otherwise errors. Returns a handle with **`history([options])`** and **`message(content)`**. **Fails** if the peer wallet has no registered XMTP inbox.

### 3.4 Messaging an agent via XMTP

- **`agent.messageXMTP(content)`** — Send a message from the loaded inbox to this agent's XMTP address. If no inbox is connected, the SDK may **automatically** register a new inbox (when a wallet is connected) and then send; otherwise errors. Resolves the agent's wallet address (e.g. **`agent.getWallet()`**) and sends via **`sdk.messageXMTP(agentAddress, content)`**. Requires the agent to have a wallet set. **Fails** if the agent's wallet has no registered XMTP inbox.
- **`agent.loadXMTPConversation()`** — Get the loaded inbox's conversation with this agent. If no inbox is connected, the SDK may **automatically** register a new inbox (when a wallet is connected) and then load the conversation; otherwise errors. Resolves the agent's wallet address and returns a handle with **`history([options])`** and **`message(content)`**. **Fails** if the agent's wallet has no registered XMTP inbox.

**Conversation handle** (from **`sdk.loadXMTPConversation(peerAddress)`** or **`agent.loadXMTPConversation()`**): **`history([options])`** — past messages (fetched from network), optional pagination; **`message(content)`** — send a message.

**Errors**

- XMTP client not initialized; wallet missing when required (e.g. for **registerXMTPInbox** only); network/auth errors — thrown or surfaced per SDK convention.
- **`loadXMTPInbox(key)`** errors if the key(s) are invalid or no inbox exists for them.
- **`registerXMTPInbox()`** errors if the SDK is already connected to an inbox. Errors if the wallet has reached the maximum number of XMTP installations (user must revoke one elsewhere first).
- **`sdk.messageXMTP(peerAddress, content)`**, **`sdk.loadXMTPConversation(peerAddress)`**, **`agent.messageXMTP(content)`**, and **`agent.loadXMTPConversation()`** error if the **receiver (or peer) wallet has no registered XMTP inbox**.

**XMTP mapping**

- Aligns with [XMTP conversations](https://docs.xmtp.org/chat-apps/core-messaging/create-conversations) (DM with an address).

**Note.** Support for groups and other conversation types may be added in a later revision.

---

## 4. x402 payment required (all payable requests)

### 4.1 Scope

**Any** SDK method that performs an HTTP request to a server that might return **HTTP 402 Payment Required** should use the same response pattern described here. That includes:

- **A2A:** `messageA2A`, `listTasks`, and every task-handle method (`query`, `message`, `cancel`).
- **Future:** MCP tool/resource calls, or other HTTP-based agent operations. x402 can be extended later to other surfaces (e.g. **x402‑aware MCP endpoints**—tools, resources, or prompts that may return 402 and use the same payment flow).

These methods use a **generic HTTP x402 handler** internally (§4.2). The SDK also exposes that handler so custom or future features can tap into the same 402 flow. On 402 the SDK does not throw; it returns a response object that may include **`x402Required`**.

### 4.2 Generic HTTP x402 handler

**`sdk.request(options)`** (or **`sdk.fetchWithX402(options)`**) — Performs a single HTTP request with built-in 402 handling. Other SDK features (A2A, MCP, etc.) use this under the hood so 402 behavior is consistent.

**Parameters**

- **url** — Request URL.
- **method** — HTTP method (e.g. `GET`, `POST`).
- **headers** *(optional)* — Request headers.
- **body** *(optional)* — Request body (string or buffer).
- **parseResponse** *(optional)* — Function that takes the successful response (e.g. 200 body) and returns the typed result. If omitted, the handler may return the raw response or a default parse.
- **payment** *(optional)* — Optionally, payment payload or params to send with the initial request (e.g. `PAYMENT-SIGNATURE` or x402-defined payload). When provided, the first request is sent with that payment; if the server accepts it, the response is 2xx and no 402 (one round trip). If the server returns 402 (e.g. invalid or wrong payment), the handler returns `x402Required` + `x402Payment` as in the normal flow. Payable methods (A2A, MCP, etc.) accept the same optional **payment** in their options and pass it through.

**Behavior**

- **Normal flow (no payment on first request):** The first request is sent without payment. If the server responds with **HTTP 402**, the handler parses the 402 body (payment requirements), does **not** throw, and returns a result object with **`x402Required: true`** and **`x402Payment`** (price, token, network, description, **`pay()`**, etc.). **`pay()`** performs the payment (e.g. build payload, sign, send `PAYMENT-SIGNATURE`, retry the **same** request) and resolves with the same shape as a successful call (using `parseResponse` if provided). If the server responds with 2xx, the handler returns the parsed result (via `parseResponse` if provided) or the raw response.
- **Optional: payment with first request.** If **payment** is provided, the first request is sent **with** that payment. If the server responds with 2xx, the handler returns the result—one round trip, no 402. If the server responds with 402, the handler returns **`x402Required`** and **`x402Payment`** (and **`pay()`** to retry) as in the normal flow.
- Other status codes or network errors are thrown or surfaced per SDK convention.

Callers can use this for arbitrary HTTP endpoints that may return 402; A2A and MCP methods call it internally with the appropriate URL, body, and parser.

### 4.3 Response shape when 402 is returned

When the server responds with **HTTP 402**:

- The SDK returns a normal result object (no throw).
- That object includes **`x402Required: true`** and an **`x402Payment`** object.

**`x402Payment`** (payment-required payload) must include at least:

- **`accepts`** — array of accepted payment options (from the x402 402 body). When the endpoint accepts multiple chains, tokens, or schemes, the server returns multiple entries. Each entry has at least **price** (amount), **token** (address or symbol), and optionally **network** (chain id), **scheme**, **description**, **maxAmountRequired**, etc. The agent can choose which option to pay with (e.g. by preferred chain or token) and pass that choice into **`pay()`**.
- **`pay(accept?)`** — method that performs the payment and retries the request. If the server returned a single option, **`pay()`** with no argument uses it. If the server returned multiple **`accepts`**, the caller can pass the chosen option (e.g. **`pay(x402Payment.accepts[0])`** or **`pay(acceptIndex)`**) so the SDK pays with that chain/token/scheme. Returns a **Promise** that resolves to the same shape as the **original** call would on success (e.g. `MessageResponse` or `TaskResponse` for `messageA2A`, task state for `task.query()`, etc.).

**Convenience:** When there is only one accept, the SDK may also expose **`price`**, **`token`**, **`network`** at the top level of **`x402Payment`** for backward compatibility or simpler inspection. The **`accepts`** array is always present so multi-option and single-option flows use the same shape.

### 4.4 Usage pattern

**Normal flow:** Request without payment. If the server returns 402, the SDK returns a result with **`x402Required`** and **`x402Payment`**; the caller can inspect (e.g. price, token) and then call **`pay()`** to pay and retry:

```ts
const response = await agent.messageA2A(content);
if (response.x402Required) {
  // Agent can check response.x402Payment.accepts (each has price, token, network, etc.)
  const chosen = response.x402Payment.accepts.find(a => a.network === preferredChain);
  if (chosen && shouldPay(chosen)) {
    const finalResponse = await response.x402Payment.pay(chosen);
    // finalResponse has the same shape as a successful messageA2A (MessageResponse | TaskResponse)
  }
} else {
  // Normal success: response is MessageResponse | TaskResponse
}
```

Same pattern for any other payable method (e.g. A2A list tasks):

```ts
const a2aResult = await agent.listTasks({ filter: { status: 'open' } });
if (a2aResult.x402Required) {
  const paid = await a2aResult.x402Payment.pay();
  // paid = normal list result (array of all tasks)
}
```

**Optional: payment with first request.** When the agent already knows the cost, it can pass **`payment`** in options (e.g. `messageA2A(content, { payment: ... })`, or `sdk.request({ ..., payment: ... })`). The first request is sent with that payment; if the server accepts it, the response is 2xx and no 402. Only if something goes wrong does the server return 402 and the caller sees `x402Required` + `x402Payment.pay()`.

### 4.5 Pay() behavior and errors

- **`pay(accept?)`** — When the server returned multiple **`accepts`**, pass the chosen option (e.g. by chain or token). When there is a single option, **`pay()`** with no argument uses it. Resolves when the payment has been sent and the **retried** request succeeds. Return value = result of the retried request (no `x402Required` on success).
- If payment or retry fails (e.g. insufficient funds, server still 402, network error), **`pay()`** rejects with an error. The SDK does not retry indefinitely.
- Optional: SDK may allow passing a custom signer or payment params into **`pay(accept, options)`** for advanced flows; that can be specified later.

---

## 5. Types (summary)

Response objects are typed so the SDK and callers work with **MessageResponse** and **TaskResponse** as distinct types. Discriminate by shape (e.g. `'task' in response`); no `type` field is required.

- **MessageResponse** — Interface: message content (e.g. `content?: string`, `parts?: Part[]`), optional `contextId`. No `task` or `taskId`.
- **TaskResponse** — Interface: **`taskId: string`**; **`contextId: string`**; **`task: AgentTask`**; optional task snapshot. Has `task` and `taskId`; use these to narrow from the union.
- **Response union** — `messageA2A` returns **`MessageResponse | TaskResponse`**. Narrow by shape: e.g. `if ('task' in response)` then `response` is TaskResponse and use `response.task` to get the AgentTask.
- **List tasks result** — array of all tasks (SDK fetches all pages internally). May include `x402Required` + `x402Payment`.
- **A2A options** — **messageA2A** and **listTasks** options may include optional **`credential`** (string or credential object) when the agent requires auth (see §2.5); SDK applies it per AgentCard **securitySchemes** (**apiKey** and **http** types).
- **AgentTask** (task handle) — has read-only **`taskId`** and **`contextId`** (strings); methods `query()`, `message()`, `cancel()`. Returned by `response.task` and by `agent.loadTask(taskId)`. Each method may return a result that includes `x402Required` + `x402Payment`.
- **x402Payment** — **`accepts`** (array of payment options; each has at least `price`, `token`, and optionally `network`, `scheme`, `description`, `maxAmountRequired`). When the endpoint accepts multiple chains/tokens/schemes, **`accepts`** has multiple entries. **`pay(accept?)`** — pass the chosen option when there are multiple, or call **`pay()`** when there is one. Top-level **`price`** / **`token`** / **`network`** may be present for single-option convenience.
- **Conversation handle** — `history([options])`, `message(content)`. From **`sdk.loadXMTPConversation(peerAddress)`** or **`agent.loadXMTPConversation()`** (conversation with that agent). Send via **`sdk.messageXMTP(peerAddress, content)`** or **`agent.messageXMTP(content)`** to message an agent. Use **`agent.message(content)`** for a unified entry point (A2A first, then XMTP). List via **`sdk.XMTPConversations()`**.
- **XMTP inbox info** — Returned by **`sdk.getXMTPInboxInfo()`**. Includes: **walletAddress** (associated WA), **publicKey(s)**, **privateKey(s)** or key material (handle securely), **installationId**, **inboxId**.

All “payable” methods: their return type is effectively `NormalResult | { x402Required: true; x402Payment: X402Payment }`, where `NormalResult` is the success type for that method. They use **`sdk.request(options)`** (generic HTTP x402 handler) internally; that method is also exposed for custom or arbitrary HTTP calls that may return 402. also exposed for custom or arbitrary HTTP calls that may return 402.