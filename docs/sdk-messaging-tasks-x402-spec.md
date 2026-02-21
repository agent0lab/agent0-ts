# SDK additions: messaging, tasks, and x402

This document specifies new APIs on the Agent0 SDK **Agent** type: A2A messaging, XMTP conversations, task handling, and x402 payment-required flows. These extend the existing Agent API (`a2aEndpoint`, `setA2A`, `getWallet()`, `setX402Support()`, etc.).

**References:** [A2A Protocol](https://a2a-protocol.org/dev/specification/) · [XMTP Conversations](https://docs.xmtp.org/chat-apps/core-messaging/create-conversations) · [x402 HTTP 402](https://x402.gitbook.io/x402/core-concepts/http-402)

---

## 1. A2A messaging

### 1.1 Send message

`**agent.messageA2A(content [, options])`**

Sends a message to the agent’s A2A endpoint. The server may reply with a direct message or create a task.

**Parameters**

- **content** — `string` or `object`.
  - String: treated as a single text part.
  - Object: structured payload. Supported shapes include:
    - `{ type: 'task-proposal', goal: string, ... }` — propose a task (e.g. `goal: 'analyze ETH sentiment'`).
    - A2A-aligned `SendMessageRequest`-like shape (message with `parts[]`, optional `taskId` for follow-ups, etc.) when the SDK supports it.
- **options** *(optional)* — e.g. `{ blocking?: boolean; contextId?: string; taskId?: string }`.  
  - `blocking: true` — wait until the task reaches a terminal state and return the final task state; otherwise return immediately.  
  - `**contextId`** — associate this message with an existing conversation context (opaque string from a previous Task or Message). Omit to start a new context; server will generate and return a new `contextId`. Pass `contextId` without `taskId` to start a **new task** in that same context.  
  - `**taskId`** — send a follow-up message to this existing task (continue or refine). Server infers `contextId` from the task if omitted. If you pass both `contextId` and `taskId`, they must match the task’s context or the server may reject.

**Returns**

- **MessageResponse** — direct reply from the agent (no task). Contains at least `type: 'message'` and the message content (e.g. `content`, `parts`).
- **TaskResponse** — server created a task. Contains `type: 'task'`, `taskId` (opaque string), `**contextId`** (opaque string grouping this task with related tasks/messages), and `**task**` — the task handle (e.g. an `AgentTask` object). Use `response.task` to work with the task; use `agent.task(taskId)` only when loading by ID (e.g. after restart).
- If the server responds with **HTTP 402**, the result is a response object that includes `**x402Required`** (see §4). The SDK does not throw; the caller checks `response.x402Required` and may call `response.x402Payment.pay()` to pay and retry.

**Errors**

- Missing or invalid A2A endpoint, network errors, 4xx/5xx (other than 402) — thrown or surfaced as error result per SDK convention.
- 402 is not treated as an error; it is a normal response with `x402Required` set.

**A2A mapping**

- Under the hood this maps to A2A **Send Message** (e.g. `POST /message:send` in the HTTP binding).

---

## 2. Tasks

### 2.1 Getting a task handle

- `**response.task`** — When `messageA2A` returns a **TaskResponse** (`response.type === 'task'`), `**response.task`** is the task handle (e.g. an **AgentTask** object) for that task. Use it directly.
- `**agent.task(taskId)`** — Load an existing task by ID when you don’t have the response (e.g. after restart or when the ID was stored). `taskId` is an opaque string from the A2A server. Returns the same kind of task handle as `response.task`.

Example:

```ts
const response = await agent.messageA2A({ type: 'task-proposal', goal: 'analyze ETH sentiment' });
if (response.type === 'task') {
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
- `**task.contextId**` — The A2A context ID for this task (opaque string). All tasks and messages with the same `contextId` belong to the same conversational session. Use it when starting a new task in the same context via `messageA2A(content, { contextId: task.contextId })` or when listing tasks in that context via `listTasks({ filter: { contextId: task.contextId } })`.

**Methods:**


| Method                      | Description                                                                                                                                                                                                    | A2A mapping                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `**task.query([options])`** | Get current task state (status, artifacts, optional message history). Options may include `historyLength`.                                                                                                     | Get Task `GET /tasks/{id}`                     |
| `**task.message(content)**` | Send another message to this task (follow-up). Same `content` shapes as `messageA2A`. The SDK sends this task’s `taskId` (and `contextId`) automatically; no need to pass contextId.                           | Send Message with existing task context        |
| `**task.cancel()**`         | Cancel the task. Returns updated task state.                                                                                                                                                                   | Cancel Task `POST /tasks/{id}:cancel`          |
| `**task.subscribe()**`      | Subscribe to live updates (status changes, artifact updates). Returns an async iterable or event stream; server sends events until task reaches a terminal state. Optional: not all servers support streaming. | Subscribe to task `POST /tasks/{id}:subscribe` |


**x402:** Any of these methods may return a result that includes `**x402Required`** (e.g. the server requires payment for that operation). Same handling as §4: caller checks `x402Required` and may call `x402Payment.pay()` to retry.

**Task status / lifecycle**

- Tasks have a status (e.g. open, in progress, completed, failed, canceled, rejected, or server-specific values). The spec defers to A2A for exact status values.
- Once a task is in a terminal state (completed, failed, canceled, rejected), it typically cannot accept new messages; `task.message()` may fail or no-op.

---

## 3. XMTP conversations

### 3.1 Assumptions

- A wallet is connected to the SDK (signer available).
- The agent may have a wallet (e.g. via `agent.getWallet()`). In XMTP there is **one DM per pair** of participants—so two addresses have a single 1:1 conversation. To have multiple distinct threads with the same party (e.g. one per task), you create **groups**; each group is a separate conversation. The SDK exposes both **DMs** (1:1, one per pair) and **groups** (multi-party or task-specific threads). Alternatives (no wallet, different auth) may be specified later.

### 3.2 SDK: conversations for the connected wallet

- **`sdk.xmtpConversations()`** — List conversations for the **connected wallet** (the wallet/signer connected to the SDK). Optional filter: `{ type?: 'dm' | 'group' }` to list only DMs or only groups. Returns array of conversation handles or summary objects (e.g. id, participants, last activity).
- **`sdk.xmtpConversations.newDm(peerAddress)`** — Create or get the **DM** with that peer (EOA or address). There is only one DM per pair; repeated calls with the same peer return the same conversation. Returns a **conversation handle**.
- **`sdk.xmtpConversations.newGroup([options])`** — Create a new **group** as the connected wallet. Options: participants (addresses or inbox IDs), optional name/description. Use groups when you need multiple distinct threads (e.g. one group per task). Returns a **conversation handle**.

### 3.3 Agent: conversations for the agent’s wallet

- **`agent.xmtpConversations()`** — List conversations for the **agent’s wallet** (e.g. from `agent.getWallet()`). Same optional filter `{ type?: 'dm' | 'group' }`. Requires the agent to have a wallet set.
- **`agent.xmtpConversations.newDm(peerAddress)`** — Create or get the **DM** between the agent and that peer. One DM per pair. Returns a **conversation handle**.
- **`agent.xmtpConversations.newGroup([options])`** — Create a new **group** as the agent. Same options as SDK. Use for task-specific or multi-party threads. Returns a **conversation handle**.

### 3.4 Conversation handle

For a conversation object `**convo`**:

- `**convo.history([options])**` — Past messages in this conversation. Options may include pagination (e.g. `limit`, `before` cursor). Returns an array of messages (and optionally a cursor for more).
- `**convo.message(content)**` — Send a message. `content` is string or a structured message payload (e.g. with parts or attachments if the SDK supports it).

**Errors**

- XMTP client not initialized, wallet missing, or network/auth errors — thrown or surfaced per SDK convention.

**XMTP mapping**

- Conversations and messages align with [XMTP conversations and messaging](https://docs.xmtp.org/chat-apps/core-messaging/create-conversations) (DMs and groups).

---

## 4. x402 payment required (all payable requests)

### 4.1 Scope

**Any** SDK method that performs an HTTP request to a server that might return **HTTP 402 Payment Required** should use the same response pattern described here. That includes:

- **A2A:** `messageA2A`, `listTasks`, and every task-handle method (`query`, `message`, `cancel`, `subscribe` if it does HTTP).
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
- That object includes `**x402Required: true`** and an `**x402Payment**` object.

`**x402Payment**` (payment-required payload) must include at least:

- `**price**` — amount required (e.g. in atomic units, or human-readable; exact format TBD per x402 body).
- `**token**` — token address or symbol (e.g. USDC).
- `**pay()**` — method that performs the payment (e.g. build payment payload, sign, send `PAYMENT-SIGNATURE` header, retry the **same** request). Returns a **Promise** that resolves to the same shape as the **original** call would on success (e.g. `MessageResponse` or `TaskResponse` for `messageA2A`, task state for `task.query()`, etc.).

**Additional fields** (so an agent can decide whether to pay):

- `**network`** — e.g. chain or network id.
- `**description**` — human- or agent-readable reason for payment.
- `**scheme**` — payment scheme (e.g. from x402 `accepts[].scheme`).
- `**maxAmountRequired**` — if different from `price` (x402 body may use this).
- Other fields from the 402 response body (see [x402 HTTP 402](https://x402.gitbook.io/x402/core-concepts/http-402)) as needed.

### 4.4 Usage pattern

**Normal flow:** Request without payment. If the server returns 402, the SDK returns a result with **`x402Required`** and **`x402Payment`**; the caller can inspect (e.g. price, token) and then call **`pay()`** to pay and retry:

```ts
const response = await agent.messageA2A(content);
if (response.x402Required) {
  // Agent can check response.x402Payment.price, .token, .network, .description
  if (shouldPay(response.x402Payment)) {
    const finalResponse = await response.x402Payment.pay();
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

**Optional: payment with first request.** When the agent already knows the cost, it can pass **`payment`** in options (e.g. `messageA2A(content, { payment: ... })`, or `sdk.request({ ..., payment: ... })`). The first request is sent with that payment; if the server accepts it, the response is 2xx and no 402. Only if something goes wrong does the server return 402 and the caller sees `x402Required` + `x402Payment.pay()`.

### 4.5 Pay() behavior and errors

- `**pay()**` — Resolves when the payment has been sent and the **retried** request succeeds. Return value = result of the retried request (no `x402Required` on success).
- If payment or retry fails (e.g. insufficient funds, server still 402, network error), `**pay()`** rejects with an error. The SDK does not retry indefinitely.
- Optional: SDK may allow passing a custom signer or payment params into `pay(options)` for advanced flows; that can be specified later.

---

## 5. Types (summary)

- **MessageResponse** — `type: 'message'`; message content (e.g. `content` or `parts`). May include `**contextId`** when the server associates the message with a context (use it in the next `messageA2A` call to continue that context).
- **TaskResponse** — `type: 'task'`; `taskId: string`; `**contextId`** (string, conversation context); `**task**` (the AgentTask handle); optional task snapshot.
- **Response union** — `MessageResponse | TaskResponse` for `messageA2A`; discriminate with `response.type`. For task responses, use `response.task` to get the AgentTask.
- **List tasks result** — list of tasks + optional `nextPageToken`. May include `x402Required` + `x402Payment`.
- **AgentTask** (task handle) — has read-only `**taskId`** and `**contextId**` (strings); methods `query()`, `message()`, `cancel()`, and optionally `subscribe()`. Same type returned by `response.task` and `agent.task(taskId)`. Each method may return a result that includes `x402Required` + `x402Payment`.
- **x402Payment** — at least `price`, `token`, `pay()`. Optionally `network`, `description`, `scheme`, `maxAmountRequired`, and other 402 body fields.
- **Conversation handle** — `history()`, `message(content)`. Obtained from listing (`sdk.xmtpConversations()` / `agent.xmtpConversations()`) or from `newDm(peerAddress)` (1:1, one per pair) or `newGroup([options])` (groups for multi-party or task-specific threads).

All “payable” methods: their return type is effectively `NormalResult | { x402Required: true; x402Payment: X402Payment }`, where `NormalResult` is the success type for that method. They use **`sdk.request(options)`** (generic HTTP x402 handler) internally; that method is also exposed for custom or arbitrary HTTP calls that may return 402.