# Release Notes — 1.5.3 (stable)

## Highlights

- **Base + Polygon network support (defaults)**: adds Base Mainnet (`8453`), Base Sepolia (`84532`), and Polygon Mainnet (`137`) to the SDK default registry addresses (Polygon subgraph URL was already present).
- **Docs updated**: all network/support lists now reflect Base Mainnet + Base Sepolia as supported networks.

## Changes in 1.5.3 (since 1.5.2)

- **Added Base Mainnet + Base Sepolia + Polygon Mainnet to SDK defaults**
  - `DEFAULT_REGISTRIES` now includes chain IDs `8453`, `84532`, and `137`.
  - `DEFAULT_SUBGRAPH_URLS` now includes:
    - Base Mainnet: `https://gateway.thegraph.com/api/536c6d8572876cabea4a4ad0fa49aa57/subgraphs/id/43s9hQRurMGjuYnC1r2ZwS6xSQktbFyXMPMqGKUFJojb`
    - Base Sepolia: `https://gateway.thegraph.com/api/536c6d8572876cabea4a4ad0fa49aa57/subgraphs/id/4yYAvQLFjBhBtdRCY7eUWo181VNoTSLLFd5M7FXQAi6u`

## Notes

- The default subgraph URLs shipped in this release already include the project’s sponsored Graph Gateway API key, so you should not need to provide any additional auth to use the defaults. If you want to use your own key (or a different endpoint), override per-chain via `subgraphOverrides`.


