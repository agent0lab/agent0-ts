import { describe, expect, it } from '@jest/globals';
import { SDK } from '../src/index';
import {
  decodeErc8004JsonDataUri,
  encodeErc8004JsonDataUri,
  isErc8004JsonDataUri,
} from '../src/utils/data-uri';

describe('ERC-8004 JSON base64 data URI', () => {
  it('accepts tolerant application/json data URIs with charset param', () => {
    const obj = { name: 'Agent', description: 'Desc', services: [] };
    const uri = encodeErc8004JsonDataUri(obj);
    const tolerant = uri.replace('data:application/json;base64,', 'data:application/json;charset=utf-8;base64,');
    expect(isErc8004JsonDataUri(tolerant)).toBe(true);
    expect(decodeErc8004JsonDataUri(tolerant)).toEqual(obj);
  });

  it('rejects data URIs that are not application/json base64', () => {
    expect(isErc8004JsonDataUri('data:text/plain;base64,SGVsbG8=')).toBe(false);
    expect(isErc8004JsonDataUri('data:application/json,{"a":1}')).toBe(false);
  });

  it('roundtrips object -> data URI -> object', () => {
    const obj = { a: 1, b: 'x', c: { ok: true }, services: [] };
    const uri = encodeErc8004JsonDataUri(obj);
    expect(isErc8004JsonDataUri(uri)).toBe(true);
    expect(decodeErc8004JsonDataUri(uri)).toEqual(obj);
  });

  it('enforces maxBytes', () => {
    const big = { data: 'x'.repeat(1024) };
    const uri = encodeErc8004JsonDataUri(big);
    expect(() => decodeErc8004JsonDataUri(uri, { maxBytes: 10 })).toThrow(/too large/i);
  });
});

describe('SDK registration loader (data URI)', () => {
  it('loads registration file from data URI without network', async () => {
    const sdk = new SDK({ chainId: 1, rpcUrl: 'http://localhost:8545' });
    const raw = {
      name: 'Agent',
      description: 'Desc',
      services: [{ name: 'MCP', endpoint: 'https://example.com/mcp', version: '2025-06-18' }],
      supportedTrust: ['reputation'],
      active: true,
      x402Support: false,
    };
    const uri = encodeErc8004JsonDataUri(raw as any);
    const rf = await (sdk as any)._loadRegistrationFile(uri);
    expect(rf.name).toBe('Agent');
    expect(rf.description).toBe('Desc');
    expect(Array.isArray(rf.endpoints)).toBe(true);
  });
});

