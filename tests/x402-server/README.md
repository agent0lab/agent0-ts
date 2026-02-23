# x402 test server

Minimal HTTP server used for x402 integration tests. It returns **402** with configurable `accepts` when no payment is sent, and **200** when the client retries with a valid `PAYMENT-SIGNATURE` header.

## Run

```bash
node tests/x402-server/server.mjs
```

Or with a custom port and accepts:

```bash
PORT=4021 node tests/x402-server/server.mjs
ACCEPTS_JSON='[{"price":"1000000","token":"0xToken","network":"84532","destination":"0xPayTo"}]' node tests/x402-server/server.mjs
```

## Env

- **PORT** – Port (default `4020`).
- **ACCEPTS_JSON** – JSON array of payment options. Each option can include `price`, `token`, `network`, `scheme`, `destination`, etc. Default is a single Base Sepolia–style accept.

## Behavior

- **First request (no `PAYMENT-SIGNATURE`):** Responds with `402` and body `{ "accepts": [ ... ] }`.
- **Retry with `PAYMENT-SIGNATURE`:** Decodes the base64 payload; if it has `x402Version`, `payload.signature`, and `payload.authorization`, responds with `200` and body `{ "success": true, "data": "resource" }`, plus optional `PAYMENT-RESPONSE` header.

Verification is **mock** (well-formed payload is accepted). Real verification (e.g. EIP-3009 signature check) can be added in integration tests with a real chain.

## Integration tests

- **Server-only (mock payment):** `RUN_X402_INTEGRATION=1 npm test -- --testPathPattern=x402-integration` or `npm run test:x402-integration`.
- **Real chain (Foundry anvil + viem):** Requires [Foundry](https://book.getfoundry.sh/getting-started/installation) on PATH (`forge`, `anvil`). Run: `RUN_X402_ANVIL=1 npm test -- --testPathPattern=x402-anvil` or `npm run test:x402-anvil`. This starts anvil, builds the EIP-3009 mock token with `forge build`, deploys it with a viem script, starts this server with the deployed token in `accepts`, then runs the SDK with a real signer and real `pay()` flow.
