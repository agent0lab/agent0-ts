/**
 * x402 request API smoke tests (Commit 1).
 * Full unit tests with mocked fetch are in Commit 2.
 */

import { SDK, isX402Required } from '../src/index';

describe('x402 SDK API', () => {
  it('exposes request and fetchWithX402 on SDK', () => {
    const sdk = new SDK({
      chainId: 8453,
      rpcUrl: 'https://mainnet.base.org',
    });
    expect(typeof sdk.request).toBe('function');
    expect(typeof sdk.fetchWithX402).toBe('function');
  });

  it('request() with 200 returns parsed result', async () => {
    const payload = { ok: true, data: 'hello' };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(payload)),
      json: () => Promise.resolve(payload),
      headers: new Headers(),
      statusText: 'OK',
      redirected: false,
      type: 'basic',
      url: '',
      clone: function () { return this; },
      body: null,
      bodyUsed: false,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      blob: () => Promise.resolve(new Blob()),
      formData: () => Promise.resolve(new FormData()),
    } as Response);

    const sdk = new SDK({
      chainId: 8453,
      rpcUrl: 'https://mainnet.base.org',
    });

    const result = await sdk.request<{ ok: boolean; data: string }>({
      url: 'https://example.com/api',
      method: 'GET',
      parseResponse: (r) => r.json(),
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/api',
      expect.objectContaining({ method: 'GET' })
    );
    expect(isX402Required(result)).toBe(false);
    expect(result).toEqual(payload);

    fetchSpy.mockRestore();
  });

  it('isX402Required type guard', () => {
    expect(isX402Required({ x402Required: true, x402Payment: {} as any })).toBe(true);
    expect(isX402Required({ foo: 'bar' })).toBe(false);
    expect(isX402Required(null)).toBe(false);
  });
});
