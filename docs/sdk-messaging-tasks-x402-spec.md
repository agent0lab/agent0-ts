# SDK additions: messaging, tasks, and x402

This document specifies new APIs on the Agent0 SDK **Agent** type: A2A messaging, XMTP conversations, task handling, and x402 payment-required flows. These extend the existing Agent API (`a2aEndpoint`, `setA2A`, `getWallet()`, `setX402Support()`, etc.).

**References:** [A2A Protocol](https://a2a-protocol.org/dev/specification/) · [XMTP Conversations](https://docs.xmtp.org/chat-apps/core-messaging/create-conversations) · [x402 HTTP 402](https://x402.gitbook.io/x402/core-concepts/http-402)

---

## 1. Messaging

### 1.0 Unified message

**`agent.message(content [, options])`** — Unified entry point. Determines which message methods are available for this agent (A2A, XMTP), uses a fixed priority order (**A2A first, then XMTP**), and delegates to the corresponding method (e.g. `messageA2A`, then `messageXMTP`). Returns the same shape as the underlying call (e.g. `MessageResponse | TaskResponse` when A2A is used). The SDK exposes this and the protocol-specific methods (`messageA2A`, `messageXMTP`); callers may use either.

**Options** — Passed through to the underlying method. When A2A is used: same as **`messageA2A`** (`blocking`, `contextId`, `taskId` — see §1.1). When XMTP is used: no options specified for now.

### 1.1 A2A: messageA2A

**`agent.messageA2A(content [, options])`**

Sends a message to the agent’s A2A endpoint. The server may reply with a direct message or create a task.

**Parameters**

- **content** — `string` or `object`.
  - String: treated as a single text part (SDK builds the A2A message).
  - Object: A2A message shape with **`parts`** (array of Part). Example: `{ parts: [{ text: 'What is the weather today?' }] }`. Parts use `text`, `url`, `data`, or `raw` per [A2A Part](https://a2a-protocol.org/dev/specification/). The SDK may allow omitting `role` (defaults to user) and `messageId` (generated if absent). Follow-ups use **options.taskId** / **options.contextId** (see options).
- **options** *(optional)* — e.g. `{ blocking?: boolean; contextId?: string; taskId?: string }`.  
  - `blocking: true` — wait until the task reaches a terminal state and return the final task state; otherwise return immediately.  
  - `**contextId`** — associate this message with an existing conversation context (opaque string from a previous Task or Message). Omit to start a new context; server will generate and return a new `contextId`. Pass `contextId` without `taskId` to start a **new task** in that same context.  
  - `**taskId`** — send a follow-up message to this existing task (continue or refine). Server infers `contextId` from the task if omitted. If you pass both `contextId` and `taskId`, they must match the task’s context or the server may reject.

**Returns**

- **MessageResponse** — direct reply from the agent (no task). Typed object with message content (e.g. `content`, `parts`) and optional `contextId`. No `task` or `taskId`.
- **TaskResponse** — server created a task. Typed object with `**taskId`** (opaque string), `**contextId`**, and `**task**` (the task handle, e.g. an `AgentTask`). Use `response.task` to work with the task; use `agent.task(taskId)` only when loading by ID (e.g. after restart). Discriminate from MessageResponse by shape: TaskResponse has `task` and `taskId`; MessageResponse does not (e.g. `'task' in response`).
- If the server responds with **HTTP 402**, the result is a response object that includes `**x402Required`** (see §4). The SDK does not throw; the caller checks `response.x402Required` and may call `response.x402Payment.pay()` to pay and retry.

**Errors**

- Missing or invalid A2A endpoint, network errors, 4xx/5xx (other than 402) — thrown or surfaced as error result per SDK convention.
- 402 is not treated as an error; it is a normal response with `x402Required` set.

**A2A mapping**

- Under the hood this maps to A2A **Send Message** (e.g. `POST /message:send` in the HTTP binding).

---

## 2. Tasks

### 2.1 Getting a task handle

- `**response.task`** — When `messageA2A` returns a **TaskResponse**, `**response.task`** is the task handle (e.g. an **AgentTask** object). Use it directly. Discriminate by shape: e.g. `'task' in response` or `response.task !== undefined`.
- `**agent.task(taskId)`** — Load an existing task by ID when you don’t have the response (e.g. after restart or when the ID was stored). `taskId` is an opaque string from the A2A server. Returns the same kind of task handle as `response.task`.

Example:

```ts
const response = await agent.messageA2A({ type: 'task-proposal', goal: 'analyze ETH sentiment' });
if ('task' in response) {
  const task = response.task;  // AgentTask — use task.query(), task.message(), task.cancel()
}
// Or, when you only have the ID: const task = agent.task(taskId);
```

### 2.2 Listing tasks

`**agent.listTasks([options])**`

Returns a list of tasks for this agent. Use when you don’t have a `taskId` yet (e.g. “my open tasks”).

**Options** *(optional)*

- **filter** — e.g. by `**contextId`** (tasks in that conversation only), by status (`open`, `completed`, `failed`, `canceled`), or other A2A list filters.
- **pagination** — e.g. `pageSize`, `pageToken` (from a previous `listTasks` response).
- **historyLength** — max number of messages to include per task in the list response (0 to omit history).

**Returns**

- List of task summaries or full task objects (per options), plus optional `nextPageToken` for pagination.
- May include `**x402Required`** if the list endpoint returns HTTP 402 (see §4).

### 2.3 Task handle (AgentTask)

A task handle (e.g. **AgentTask**) is an object tied to a single task ID.

**Properties (read-only):**

- `**task.taskId`** — The A2A task ID (opaque string). Use with `agent.task(task.taskId)` to load the same task later (e.g. after restart).
- `**task.contextId`** — The A2A context ID for this task (opaque string). All tasks and messages with the same `contextId` belong to the same conversational session. Use it when starting a new task in the same context via `messageA2A(content, { contextId: task.contextId })` or when listing tasks in that context via `listTasks({ filter: { contextId: task.contextId } })`.

**Methods:**


| Method                                                                                                                                                                                                                                  | Description                                                                                                                                                                          | A2A mapping                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| `**task.query([options])`**                                                                                                                                                                                                             | Get current task state (status, artifacts, optional message history). Options may include `historyLength`.                                                                           | Get Task `GET /tasks/{id}`              |
| `**task.message(content)`**                                                                                                                                                                                                             | Send another message to this task (follow-up). Same `content` shapes as `messageA2A`. The SDK sends this task’s `taskId` (and `contextId`) automatically; no need to pass contextId. | Send Message with existing task context |
| `**task.cancel()`**                                                                                                                                                                                                                     | Cancel the task. Returns updated task state.                                                                                                                                         | Cancel Task `POST /tasks/{id}:cancel`   |

**x402:** Any of these methods may return a result that includes **`x402Required`** (e.g. the server requires payment for that operation). Same handling as §4: caller checks `x402Required` and may call `x402Payment.pay()` to retry.

**Task status / lifecycle**

- Tasks have a status (e.g. open, in progress, completed, failed, canceled, rejected, or server-specific values). The spec defers to A2A for exact status values.
- Once a task is in a terminal state (completed, failed, canceled, rejected), it typically cannot accept new messages; `task.message()` may fail or no-op.

---

## 3. XMTP

### 3.1 Assumptions

- A wallet is connected to the SDK (signer available).
- The agent may have a wallet (e.g. via `agent.getWallet()`). There is one conversation per pair of addresses (1:1 DM). Alternatives may be specified later.
- The connected wallet and the agent's wallet (when used for XMTP) must be on the XMTP network (have registered XMTP identities).

### 3.2 SDK: connected wallet

- `**sdk.xmtpConversations()`** — List conversations for the **connected wallet**. Returns array of conversation handles or summary objects (e.g. peer address, last activity).
- `**sdk.messageTo(peerAddress, content)`** — Send a message to that address.
- `**sdk.conversationWith(peerAddress)`** — Get the conversation with that peer. Returns a handle with `**history([options])**` and `**message(content)**`.

### 3.3 Messaging an agent via XMTP

- **`agent.messageXMTP(content)`** — Send a message from the **connected wallet** to this agent's XMTP address. Resolves the agent's wallet/XMTP address and sends via **`sdk.messageTo(agentAddress, content)`**. Requires the agent to have a wallet set.
- **`agent.xmtpConversation()`** — Get the connected wallet's conversation with this agent. Returns a handle with **`history([options])`** and **`message(content)`**.

**Conversation handle** (from `**sdk.conversationWith(peerAddress)`** or `**agent.xmtpConversation()`**): `**history([options])**` — past messages, optional pagination; `**message(content)**` — send a message.

**Errors**

- XMTP client not initialized, wallet missing, or network/auth errors — thrown or surfaced per SDK convention.

**XMTP mapping**

- Aligns with [XMTP conversations](https://docs.xmtp.org/chat-apps/core-messaging/create-conversations) (DM with an address).

**Note.** Support for groups and other conversation types may be added in a later revision.

---

## 4. x402 payment required (all payable requests)

### 4.1 Scope

**Any** SDK method that performs an HTTP request to a server that might return **HTTP 402 Payment Required** should use the same response pattern described here. That includes:

- **A2A:** `messageA2A`, `listTasks`, and every task-handle method (`query`, `message`, `cancel`).
- **Future:** MCP tool/resource calls, or other HTTP-based agent operations. x402 can be extended later to other surfaces (e.g. **x402‑aware MCP endpoints**—tools, resources, or prompts that may return 402 and use the same payment flow).

These methods use a **generic HTTP x402 handler** internally (§4.2). The SDK also exposes that handler so custom or future features can tap into the same 402 flow. On 402 the SDK does not throw; it returns a response object that may include `**x402Required`**.

### 4.2 Generic HTTP x402 handler

`**sdk.request(options)`** (or `**sdk.fetchWithX402(options)**`) — Performs a single HTTP request with built-in 402 handling. Other SDK features (A2A, MCP, etc.) use this under the hood so 402 behavior is consistent.

**Parameters**

- **url** — Request URL.
- **method** — HTTP method (e.g. `GET`, `POST`).
- **headers** *(optional)* — Request headers.
- **body** *(optional)* — Request body (string or buffer).
- **parseResponse** *(optional)* — Function that takes the successful response (e.g. 200 body) and returns the typed result. If omitted, the handler may return the raw response or a default parse.
- **payment** *(optional)* — Optionally, payment payload or params to send with the initial request (e.g. `PAYMENT-SIGNATURE` or x402-defined payload). When provided, the first request is sent with that payment; if the server accepts it, the response is 2xx and no 402 (one round trip). If the server returns 402 (e.g. invalid or wrong payment), the handler returns `x402Required` + `x402Payment` as in the normal flow. Payable methods (A2A, MCP, etc.) accept the same optional **payment** in their options and pass it through.

**Behavior**

- **Normal flow (no payment on first request):** The first request is sent without payment. If the server responds with **HTTP 402**, the handler parses the 402 body (payment requirements), does **not** throw, and returns a result object with `**x402Required: true`** and `**x402Payment`** (price, token, network, description, `**pay()**`, etc.). `**pay()**` performs the payment (e.g. build payload, sign, send `PAYMENT-SIGNATURE`, retry the **same** request) and resolves with the same shape as a successful call (using `parseResponse` if provided). If the server responds with 2xx, the handler returns the parsed result (via `parseResponse` if provided) or the raw response.
- **Optional: payment with first request.** If **payment** is provided, the first request is sent **with** that payment. If the server responds with 2xx, the handler returns the result—one round trip, no 402. If the server responds with 402, the handler returns `**x402Required`** and `**x402Payment`** (and `**pay()**` to retry) as in the normal flow.
- Other status codes or network errors are thrown or surfaced per SDK convention.

Callers can use this for arbitrary HTTP endpoints that may return 402; A2A and MCP methods call it internally with the appropriate URL, body, and parser.

### 4.3 Response shape when 402 is returned

When the server responds with **HTTP 402**:

- The SDK returns a normal result object (no throw).
- That object includes `**x402Required: true`** and an `**x402Payment`** object.

`**x402Payment**` (payment-required payload) must include at least:

- `**accepts**` — array of accepted payment options (from the x402 402 body). When the endpoint accepts multiple chains, tokens, or schemes, the server returns multiple entries. Each entry has at least **price** (amount), **token** (address or symbol), and optionally **network** (chain id), **scheme**, **description**, **maxAmountRequired**, etc. The agent can choose which option to pay with (e.g. by preferred chain or token) and pass that choice into `**pay()`**.
- `**pay(accept?)`** — method that performs the payment and retries the request. If the server returned a single option, `**pay()**` with no argument uses it. If the server returned multiple `**accepts**`, the caller can pass the chosen option (e.g. `**pay(x402Payment.accepts[0])**` or `**pay(acceptIndex)**`) so the SDK pays with that chain/token/scheme. Returns a **Promise** that resolves to the same shape as the **original** call would on success (e.g. `MessageResponse` or `TaskResponse` for `messageA2A`, task state for `task.query()`, etc.).

**Convenience:** When there is only one accept, the SDK may also expose `**price`**, `**token`**, `**network**` at the top level of `**x402Payment**` for backward compatibility or simpler inspection. The `**accepts**` array is always present so multi-option and single-option flows use the same shape.

### 4.4 Usage pattern

**Normal flow:** Request without payment. If the server returns 402, the SDK returns a result with `**x402Required`** and `**x402Payment`**; the caller can inspect (e.g. price, token) and then call `**pay()**` to pay and retry:

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
  // paid = normal list result (tasks + optional nextPageToken)
}
```

**Optional: payment with first request.** When the agent already knows the cost, it can pass `**payment`** in options (e.g. `messageA2A(content, { payment: ... })`, or `sdk.request({ ..., payment: ... })`). The first request is sent with that payment; if the server accepts it, the response is 2xx and no 402. Only if something goes wrong does the server return 402 and the caller sees `x402Required` + `x402Payment.pay()`.

### 4.5 Pay() behavior and errors

- `**pay(accept?)`** — When the server returned multiple `**accepts**`, pass the chosen option (e.g. by chain or token). When there is a single option, `**pay()**` with no argument uses it. Resolves when the payment has been sent and the **retried** request succeeds. Return value = result of the retried request (no `x402Required` on success).
- If payment or retry fails (e.g. insufficient funds, server still 402, network error), `**pay()`** rejects with an error. The SDK does not retry indefinitely.
- Optional: SDK may allow passing a custom signer or payment params into `**pay(accept, options)`** for advanced flows; that can be specified later.

---

## 5. Types (summary)

Response objects are typed so the SDK and callers work with **MessageResponse** and **TaskResponse** as distinct types. Discriminate by shape (e.g. `'task' in response`); no `type` field is required.

- **MessageResponse** — Interface: message content (e.g. `content?: string`, `parts?: Part[]`), optional `contextId`. No `task` or `taskId`.
- **TaskResponse** — Interface: `**taskId: string`**; `**contextId: string`**; `**task: AgentTask**`; optional task snapshot. Has `task` and `taskId`; use these to narrow from the union.
- **Response union** — `messageA2A` returns `**MessageResponse | TaskResponse`**. Narrow by shape: e.g. `if ('task' in response)` then `response` is TaskResponse and use `response.task` to get the AgentTask.
- **List tasks result** — list of tasks + optional `nextPageToken`. May include `x402Required` + `x402Payment`.
- **AgentTask** (task handle) — has read-only **`taskId`** and **`contextId`** (strings); methods `query()`, `message()`, `cancel()`. Returned by `response.task` and by `agent.task(taskId)`. Each method may return a result that includes `x402Required` + `x402Payment`.
- **x402Payment** — `**accepts`** (array of payment options; each has at least `price`, `token`, and optionally `network`, `scheme`, `description`, `maxAmountRequired`). When the endpoint accepts multiple chains/tokens/schemes, `**accepts`** has multiple entries. `**pay(accept?)**` — pass the chosen option when there are multiple, or call `**pay()**` when there is one. Top-level `**price**` / `**token**` / `**network**` may be present for single-option convenience.
- **Conversation handle** — `history([options])`, `message(content)`. From `**sdk.conversationWith(peerAddress)`** or `**agent.xmtpConversation()`** (conversation with that agent). Send via **`sdk.messageTo(peerAddress, content)`** or **`agent.messageXMTP(content)`** to message an agent. Use **`agent.message(content)`** for a unified entry point (A2A first, then XMTP). List via `**sdk.xmtpConversations()**`.

All “payable” methods: their return type is effectively `NormalResult | { x402Required: true; x402Payment: X402Payment }`, where `NormalResult` is the success type for that method. They use `**sdk.request(options)**` (generic HTTP x402 handler) internally; that method is also exposed for custom or arbitrary HTTP calls that may return 402.