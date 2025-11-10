import { DEFAULT_REGISTRIES, DEFAULT_SUBGRAPH_URLS } from '../src/core/contracts';

describe('DEFAULT_REGISTRIES', () => {
  it('includes Hedera testnet addresses and no default subgraph URL', () => {
    expect(DEFAULT_REGISTRIES[296]).toEqual({
      IDENTITY: '0x4c74ebd72921d537159ed2053f46c12a7d8e5923',
      REPUTATION: '0xc565edcba77e3abeade40bfd6cf6bf583b3293e0',
      VALIDATION: '0x18df085d85c586e9241e0cd121ca422f571c2da6',
    });
    expect(DEFAULT_SUBGRAPH_URLS[296]).toBeUndefined();
  });
});
