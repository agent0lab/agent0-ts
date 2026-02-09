# Agent0 SDK v1.1.3 Release Notes

This release is a **bugfix** for transaction confirmation in browser-wallet flows.

## Fixes

- **Fix: receipt polling fallback when RPC backends are out of sync**
  - `waitForTransaction` now first polls receipts via the configured `rpcUrl` public client.
  - If that times out and a browser `walletProvider` is configured, it retries receipt polling via a secondary public client using the same wallet provider transport.






