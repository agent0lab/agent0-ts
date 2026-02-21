# SDK additions: messaging, tasks, and x402

This document specifies new APIs on the Agent0 SDK **Agent** type: A2A messaging, XMTP conversations, task handling, and x402 payment-required flows. These extend the existing Agent API (`a2aEndpoint`, `setA2A`, `getWallet()`, `setX402Support()`, etc.).

**References:** [A2A Protocol](https://a2a-protocol.org/dev/specification/) · [XMTP Conversations](https://docs.xmtp.org/chat-apps/core-messaging/create-conversations) · [x402 HTTP 402](https://x402.gitbook.io/x402/core-concepts/http-402)

---

## 1. A2A messaging

### 1.1 Send message

**`agent.messageA2A(content [, options])`**

Sends a message to the agent’s A2A endpoint. The server may reply with a direct message or create a task.

**Parameters**

- **content** — `string` or `object`.
  - String: treated as a single text part.
  - Object: structured payload. Supported shapes include:
    - `{ type: 'task-proposal', goal: string, ... }` — propose a task (e.g. `goal: 'analyze ETH sentiment'`).
    - A2A-aligned `SendMessageRequest`-like shape (message with `parts[]`, optional `taskId` for follow-ups, etc.) when the SDK supports it.
- **options** *(optional)* — e.g. `{ blocking?: boolean }`. If `blocking: true`, the call waits until the task reaches a terminal state (completed, failed, canceled, rejected) and returns the final task state; otherwise returns immediately with the task or message.

**Returns**

- **MessageResponse** — direct reply from the agent (no task). Contains at least `type: 'message'` and the message content (e.g. `content`, `parts`).
- **TaskResponse** — server created a task. Contains `type: 'task'`, `taskId` (opaque string), and **`task`** — the task handle (e.g. an `AgentTask` object) for this task. Use `response.task` to work with the task; use `agent.task(taskId)` only when loading by ID (e.g. after restart).
- If the server responds with **HTTP 402**, the result is a response object that includes **`x402Required`** (see §4). The SDK does not throw; the caller checks `response.x402Required` and may call `response.x402Payment.pay()` to pay and retry.

**Errors**

- Missing or invalid A2A endpoint, network errors, 4xx/5xx (other than 402) — thrown or surfaced as error result per SDK convention.
- 402 is not treated as an error; it is a normal response with `x402Required` set.

**A2A mapping**

- Under the hood this maps to A2A **Send Message** (e.g. `POST /message:send` in the HTTP binding).

---

## 2. Tasks

### 2.1 Getting a task handle

- **`response.task`** — When `messageA2A` returns a **TaskResponse** (`response.type === 'task'`), **`response.task`** is the task handle (e.g. an **AgentTask** object) for that task. Use it directly.
- **`agent.task(taskId)`** — Load an existing task by ID when you don’t have the response (e.g. after restart or when the ID was stored). `taskId` is an opaque string from the A2A server. Returns the same kind of task handle as `response.task`.

Example:

```ts
const response = await agent.messageA2A({ type: 'task-proposal', goal: 'analyze ETH sentiment' });
if (response.type === 'task') {
  const task = response.task;  // AgentTask — use task.query(), task.message(), task.cancel()
}
// Or, when you only have the ID: const task = agent.task(taskId);
```

### 2.2 Listing tasks

**`agent.listTasks([options])`**

Returns a list of tasks for this agent. Use when you don’t have a `taskId` yet (e.g. “my open tasks”).

**Options** *(optional)*

- **filter** — e.g. by status (`open`, `completed`, `failed`, `canceled`), by context, or other A2A list filters.
- **pagination** — e.g. `pageSize`, `pageToken` (from a previous `listTasks` response).
- **historyLength** — max number of messages to include per task in the list response (0 to omit history).

**Returns**

- List of task summaries or full task objects (per options), plus optional `nextPageToken` for pagination.
- May include **`x402Required`** if the list endpoint returns HTTP 402 (see §4).

### 2.3 Task handle (AgentTask)

A task handle (e.g. **AgentTask**) is an object tied to a single task ID. It exposes:

| Method | Description | A2A mapping |
|--------|-------------|-------------|
| **`task.query([options])`** | Get current task state (status, artifacts, optional message history). Options may include `historyLength`. | Get Task `GET /tasks/{id}` |
| **`task.message(content)`** | Send another message to this task (follow-up). Same `content` shapes as `messageA2A`. | Send Message with existing task context |
| **`task.cancel()`** | Cancel the task. Returns updated task state. | Cancel Task `POST /tasks/{id}:cancel` |
| **`task.subscribe()`** | Subscribe to live updates (status changes, artifact updates). Returns an async iterable or event stream; server sends events until task reaches a terminal state. Optional: not all servers support streaming. | Subscribe to task `POST /tasks/{id}:subscribe` |

**x402:** Any of these methods may return a result that includes **`x402Required`** (e.g. the server requires payment for that operation). Same handling as §4: caller checks `x402Required` and may call `x402Payment.pay()` to retry.

**Task status / lifecycle**

- Tasks have a status (e.g. open, in progress, completed, failed, canceled, rejected, or server-specific values). The spec defers to A2A for exact status values.
- Once a task is in a terminal state (completed, failed, canceled, rejected), it typically cannot accept new messages; `task.message()` may fail or no-op.

---

## 3. XMTP conversations

### 3.1 Assumptions

- A wallet is connected to the SDK (signer available).
- The agent has a wallet (e.g. via `agent.getWallet()`); that wallet is used for XMTP identity.
- We use **topics** to separate task-related or context-specific conversations; **DMs** remain available for 1:1 chat. Alternatives (no wallet, different auth) may be specified later.

### 3.2 Conversation list and creation

- **`agent.xmtpConversations()`** — Returns the list of current conversations (topics and/or DMs the agent participates in). Return type: array of conversation handles or summary objects (e.g. id, topic, participants, last activity).
- **`agent.xmtpConversations.new([options])`** — Create a new XMTP conversation. Options may specify topic vs DM, participants (e.g. peer address for DM), or other XMTP creation params. Returns a **conversation handle**.

### 3.3 Conversation handle

For a conversation object **`convo`**:

- **`convo.history([options])`** — Past messages in this conversation. Options may include pagination (e.g. `limit`, `before` cursor). Returns an array of messages (and optionally a cursor for more).
- **`convo.message(content)`** — Send a message. `content` is string or a structured message payload (e.g. with parts or attachments if the SDK supports it).

**Errors**

- XMTP client not initialized, wallet missing, or network/auth errors — thrown or surfaced per SDK convention.

**XMTP mapping**

- Conversations and messages align with [XMTP conversations and messaging](https://docs.xmtp.org/chat-apps/core-messaging/create-conversations); topics are used where appropriate to separate task-related flows.

---

## 4. x402 payment required (all payable requests)

### 4.1 Scope

**Any** SDK method that performs an HTTP request to a server that might return **HTTP 402 Payment Required** should use the same response pattern described here. That includes:

- **A2A:** `messageA2A`, `listTasks`, and every task-handle method (`query`, `message`, `cancel`, `subscribe` if it does HTTP).
- **Future:** MCP tool/resource calls, or other HTTP-based agent operations.

So “regular requests” that can respond with 402 are all treated uniformly: the SDK does not throw on 402; it returns a response object that may include **`x402Required`**.

### 4.2 Response shape when 402 is returned

When the server responds with **HTTP 402**:

- The SDK returns a normal result object (no throw).
- That object includes **`x402Required: true`** and an **`x402Payment`** object.

**`x402Payment`** (payment-required payload) must include at least:

- **`price`** — amount required (e.g. in atomic units, or human-readable; exact format TBD per x402 body).
- **`token`** — token address or symbol (e.g. USDC).
- **`pay()`** — method that performs the payment (e.g. build payment payload, sign, send `PAYMENT-SIGNATURE` header, retry the **same** request). Returns a **Promise** that resolves to the same shape as the **original** call would on success (e.g. `MessageResponse` or `TaskResponse` for `messageA2A`, task state for `task.query()`, etc.).

**Additional fields** (so an agent can decide whether to pay):

- **`network`** — e.g. chain or network id.
- **`description`** — human- or agent-readable reason for payment.
- **`scheme`** — payment scheme (e.g. from x402 `accepts[].scheme`).
- **`maxAmountRequired`** — if different from `price` (x402 body may use this).
- Other fields from the 402 response body (see [x402 HTTP 402](https://x402.gitbook.io/x402/core-concepts/http-402)) as needed.

### 4.3 Usage pattern

Caller (or autonomous agent) can inspect payment details before calling `pay()`:

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

Same pattern for any other payable method:

```ts
const listResult = await agent.listTasks({ filter: { status: 'open' } });
if (listResult.x402Required) {
  const paidResult = await listResult.x402Payment.pay();
  // paidResult = normal list result (tasks + optional nextPageToken)
}
```

### 4.4 Pay() behavior and errors

- **`pay()`** — Resolves when the payment has been sent and the **retried** request succeeds. Return value = result of the retried request (no `x402Required` on success).
- If payment or retry fails (e.g. insufficient funds, server still 402, network error), **`pay()`** rejects with an error. The SDK does not retry indefinitely.
- Optional: SDK may allow passing a custom signer or payment params into `pay(options)` for advanced flows; that can be specified later.

---

## 5. Types (summary)

- **MessageResponse** — `type: 'message'`; message content (e.g. `content` or `parts`).
- **TaskResponse** — `type: 'task'`; `taskId: string`; **`task`** (the AgentTask handle for this task); optional task snapshot.
- **Response union** — `MessageResponse | TaskResponse` for `messageA2A`; discriminate with `response.type`. For task responses, use `response.task` to get the AgentTask.
- **List tasks result** — list of tasks + optional `nextPageToken`. May include `x402Required` + `x402Payment`.
- **AgentTask** (task handle) — object with `query()`, `message()`, `cancel()`, and optionally `subscribe()`. Same type returned by `response.task` and `agent.task(taskId)`. Each method may return a result that includes `x402Required` + `x402Payment`.
- **x402Payment** — at least `price`, `token`, `pay()`. Optionally `network`, `description`, `scheme`, `maxAmountRequired`, and other 402 body fields.
- **Conversation handle** — `history()`, `message(content)`.

All “payable” methods: their return type is effectively `NormalResult | { x402Required: true; x402Payment: X402Payment }`, where `NormalResult` is the success type for that method.
