# Signer Configuration - Deep Analysis & Implementation

## Overview
The SDK now supports **two methods** for configuring a signer:
1. **Private Key String** - Simple string containing the private key
2. **Ethers Wallet/Signer Object** - Pre-configured ethers.js Wallet or Signer instance

## Implementation Details

### 1. Type Changes

#### `SDKConfig` Interface (src/core/sdk.ts)
```typescript
export interface SDKConfig {
  chainId: ChainId;
  rpcUrl: string;
  signer?: string | ethers.Wallet | ethers.Signer; // NEW: Supports 3 types
  // ... other config options
}
```

**Changes:**
- **Before:** `signer?: string`
- **After:** `signer?: string | ethers.Wallet | ethers.Signer`

#### `Web3Client` Class (src/core/web3-client.ts)
```typescript
export class Web3Client {
  public readonly signer?: Wallet | Signer; // Changed from Wallet only

  constructor(rpcUrl: string, signerOrKey?: string | Wallet | Signer) {
    // Implementation handles all three types
  }
}
```

### 2. Constructor Logic Changes

#### Web3Client Constructor
```typescript
constructor(rpcUrl: string, signerOrKey?: string | Wallet | Signer) {
  this.provider = new ethers.JsonRpcProvider(rpcUrl);
  
  if (signerOrKey) {
    if (typeof signerOrKey === 'string') {
      // Case 1: Private key string
      this.signer = new ethers.Wallet(signerOrKey, this.provider);
    } else {
      // Case 2 & 3: Wallet or Signer object
      // Connect to provider if connect method exists
      this.signer = signerOrKey.connect 
        ? signerOrKey.connect(this.provider) 
        : signerOrKey;
    }
  }
  
  this.chainId = 0n;
}
```

**Logic Flow:**
1. Check if `signerOrKey` is provided
2. If string → Create new Wallet with private key
3. If object → Check if it has `connect()` method
4. If connectable → Connect to provider
5. Otherwise → Use as-is

### 3. Address Retrieval

#### Synchronous Getter (with limitations)
```typescript
get address(): string | undefined {
  if (!this.signer) return undefined;
  
  // Wallet has address property
  if ('address' in this.signer) {
    return this.signer.address as string;
  }
  
  // Generic Signer doesn't have synchronous address
  return undefined;
}
```

**Limitation:** Generic `Signer` interface doesn't guarantee synchronous address access.

#### Asynchronous Method (recommended)
```typescript
async getAddress(): Promise<string | undefined> {
  if (!this.signer) return undefined;
  return await this.signer.getAddress();
}
```

**Recommendation:** Use `getAddress()` when working with generic Signers.

## Usage Examples

### Method 1: Private Key String (Simple)
```typescript
import { SDK } from '@agent0/sdk';

const sdk = new SDK({
  chainId: 11155111,
  rpcUrl: 'https://sepolia.infura.io/v3/YOUR_KEY',
  signer: '0x1234...', // Private key string
});
```

**Pros:**
- Simple and straightforward
- Requires only the private key
- SDK handles wallet creation

**Cons:**
- Less flexible
- Private key must be in string format

### Method 2: Ethers Wallet Object (Flexible)
```typescript
import { SDK } from '@agent0/sdk';
import { ethers } from 'ethers';

// Create wallet externally
const wallet = new ethers.Wallet('0x1234...');

const sdk = new SDK({
  chainId: 11155111,
  rpcUrl: 'https://sepolia.infura.io/v3/YOUR_KEY',
  signer: wallet, // Pass wallet object
});
```

**Pros:**
- More control over wallet creation
- Can use HD wallets or other wallet types
- Can reuse wallet across multiple SDK instances

**Cons:**
- Requires importing ethers separately
- Slightly more verbose

### Method 3: Connected Signer (Web3 Provider)
```typescript
import { SDK } from '@agent0/sdk';
import { ethers } from 'ethers';

// In browser with MetaMask
const provider = new ethers.BrowserProvider(window.ethereum);
const signer = await provider.getSigner();

const sdk = new SDK({
  chainId: 11155111,
  rpcUrl: 'https://sepolia.infura.io/v3/YOUR_KEY',
  signer: signer, // Use browser wallet signer
});

// Important: Use async method for address
const address = await sdk.web3Client.getAddress();
```

**Pros:**
- Works with browser wallets (MetaMask, etc.)
- User controls private keys
- Best for dApp integration

**Cons:**
- Requires async address retrieval
- More complex setup

### Method 4: Read-Only Mode
```typescript
import { SDK } from '@agent0/sdk';

const sdk = new SDK({
  chainId: 11155111,
  rpcUrl: 'https://sepolia.infura.io/v3/YOUR_KEY',
  // No signer - read-only mode
});

console.log(sdk.isReadOnly); // true
```

**Use Cases:**
- Searching agents
- Reading feedback
- Viewing registry data
- Any read operation

## Type Safety

### Type Checking
```typescript
// TypeScript will enforce correct types
const sdk = new SDK({
  chainId: 11155111,
  rpcUrl: 'https://...',
  signer: wallet, // ✓ ethers.Wallet
  // signer: 123,    // ✗ TypeError
  // signer: {},     // ✗ TypeError
});
```

### Runtime Validation
The constructor performs runtime type checking:
```typescript
if (typeof signerOrKey === 'string') {
  // Handle private key
} else {
  // Handle Wallet/Signer object
}
```

## Migration Guide

### From Old Version (v0.2.2)
```typescript
// OLD - Only supported string
const sdk = new SDK({
  chainId: 11155111,
  rpcUrl: 'https://...',
  signer: privateKeyString,
});
```

### To New Version (v0.2.3+)
```typescript
// NEW - Option 1: Still works (backward compatible)
const sdk = new SDK({
  chainId: 11155111,
  rpcUrl: 'https://...',
  signer: privateKeyString, // Still supported
});

// NEW - Option 2: Use Wallet object
const wallet = new ethers.Wallet(privateKeyString);
const sdk = new SDK({
  chainId: 11155111,
  rpcUrl: 'https://...',
  signer: wallet, // Now supported
});

// NEW - Option 3: Use Signer
const signer = await provider.getSigner();
const sdk = new SDK({
  chainId: 11155111,
  rpcUrl: 'https://...',
  signer: signer, // Now supported
});
```

**Backward Compatibility:** ✅ All existing code continues to work.

## Technical Considerations

### 1. Provider Connection
When a Wallet/Signer is passed:
- SDK checks if `connect()` method exists
- If yes, connects signer to internal provider
- If no, uses signer as-is

### 2. Address Access
- **Wallet:** Synchronous access via `.address`
- **Generic Signer:** Async access via `.getAddress()`
- SDK provides both methods for compatibility

### 3. Transaction Signing
Both methods produce identical signing behavior:
```typescript
// Method 1: Private key
const sdk1 = new SDK({ ..., signer: '0x123...' });

// Method 2: Wallet
const wallet = new ethers.Wallet('0x123...');
const sdk2 = new SDK({ ..., signer: wallet });

// Both produce identical signatures
```

## Best Practices

### 1. Security
```typescript
// ✓ Good: Load from environment
const sdk = new SDK({
  signer: process.env.PRIVATE_KEY,
});

// ✗ Bad: Hardcode private key
const sdk = new SDK({
  signer: '0x1234...abc', // Don't do this!
});
```

### 2. Flexibility
```typescript
// ✓ Good: Use Wallet for advanced features
const wallet = ethers.Wallet.createRandom();
const sdk = new SDK({ signer: wallet });

// ✓ Good: Use string for simplicity
const sdk = new SDK({ signer: process.env.PRIVATE_KEY });
```

### 3. Type Safety
```typescript
// ✓ Good: Let TypeScript infer types
import { ethers } from 'ethers';
const wallet: ethers.Wallet = new ethers.Wallet('...');

// ✓ Good: Use SDK types
import { SDK, type SDKConfig } from '@agent0/sdk';
const config: SDKConfig = { ... };
```

## Testing

### Unit Tests
```typescript
describe('SDK Signer Configuration', () => {
  it('should accept private key string', () => {
    const sdk = new SDK({
      chainId: 1,
      rpcUrl: 'http://localhost:8545',
      signer: '0x' + '1'.repeat(64),
    });
    expect(sdk.isReadOnly).toBe(false);
  });

  it('should accept Wallet object', () => {
    const wallet = new ethers.Wallet('0x' + '1'.repeat(64));
    const sdk = new SDK({
      chainId: 1,
      rpcUrl: 'http://localhost:8545',
      signer: wallet,
    });
    expect(sdk.isReadOnly).toBe(false);
  });

  it('should work in read-only mode', () => {
    const sdk = new SDK({
      chainId: 1,
      rpcUrl: 'http://localhost:8545',
    });
    expect(sdk.isReadOnly).toBe(true);
  });
});
```

## Summary

### Key Changes
1. ✅ Support for private key string (unchanged)
2. ✅ Support for ethers.Wallet object (new)
3. ✅ Support for ethers.Signer object (new)
4. ✅ Backward compatible
5. ✅ Type safe

### Benefits
- **Flexibility:** Choose the method that fits your use case
- **Compatibility:** Works with browser wallets, HD wallets, etc.
- **Type Safety:** TypeScript ensures correct usage
- **Backward Compatible:** Existing code continues to work

### Files Modified
- `src/core/sdk.ts` - Updated SDKConfig interface
- `src/core/web3-client.ts` - Updated constructor and address access
- `examples/signer-methods.ts` - New comprehensive example

### Breaking Changes
**None** - This is a backward-compatible enhancement.
