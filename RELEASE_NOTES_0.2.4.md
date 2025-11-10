# Release Notes: Agent0 SDK v0.2.4

## Enhanced Signer Configuration

The SDK now supports **flexible signer configuration** with improved error handling and provider connection logic.

> 📖 **For detailed technical documentation**, see [`SIGNER_IMPLEMENTATION.md`](./SIGNER_IMPLEMENTATION.md)

### New Features

#### Multiple Signer Options

You can now provide a signer in three ways:

1. **Private Key String** (Original Method) ✅
```typescript
const sdk = new SDK({
  chainId: 11155111,
  rpcUrl: 'https://sepolia.infura.io/v3/YOUR_KEY',
  signer: '0x1234...', // Private key as string
});
```

2. **Ethers Wallet Object** ✅
```typescript
import { ethers } from 'ethers';

const wallet = new ethers.Wallet('0x1234...');
const sdk = new SDK({
  chainId: 11155111,
  rpcUrl: 'https://sepolia.infura.io/v3/YOUR_KEY',
  signer: wallet, // Wallet object
});
```

3. **Ethers Signer Object** ✅
```typescript
import { ethers } from 'ethers';

// Example: MetaMask or other browser provider
const provider = new ethers.BrowserProvider(window.ethereum);
const signer = await provider.getSigner();
const sdk = new SDK({
  chainId: 11155111,
  rpcUrl: 'https://sepolia.infura.io/v3/YOUR_KEY',
  signer: signer, // Signer object
});
```

### Improvements

- **Smart Provider Connection**: Automatically detects if a signer is already connected to the same provider to avoid unnecessary reconnection
- **Enhanced Error Handling**: Better error messages when signer connection fails
- **Type Safety**: Full TypeScript support for all signer types

### Type Definition

```typescript
export interface SDKConfig {
  chainId: ChainId;
  rpcUrl: string;
  signer?: string | ethers.Wallet | ethers.Signer; // 3 options
  // ... other config
}
```

## Files Modified
1. **src/core/sdk.ts** - Updated SDKConfig interface
2. **src/core/web3-client.ts** - Updated constructor to handle both methods
3. **examples/signer-methods.ts** - New comprehensive example (NEW)
4. **SIGNER_IMPLEMENTATION.md** - Deep technical documentation (NEW)

## Backward Compatibility

✅ **100% Backward Compatible** - All existing code using private key strings continues to work unchanged.

## Technical Details

- Updated `Web3Client` constructor with improved provider connection logic
- Added error handling for signer connection failures
- Enhanced type imports to include `Signer` from ethers.js

For comprehensive usage examples, see `examples/signer-methods.ts`.

> 📖 **For deep technical analysis and implementation details**, see [`SIGNER_IMPLEMENTATION.md`](./SIGNER_IMPLEMENTATION.md)

---

## Upgrade Instructions

```bash
npm install agent0-sdk@0.2.4
```
