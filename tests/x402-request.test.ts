/**
 * x402 request API and handler unit tests.
 * Commit 1: smoke tests. Commit 2: full handler coverage with mocked fetch + buildPayment.
 */

import { SDK, isX402Required, parse402Accepts } from '../src/index';
import { requestWithX402 } from '../src/core/x402-request.js';

const BASE_URL = 'https://example.com/api';

function mockResponse(init: { status: number; body?: unknown; ok?: boolean }): Response {
  const bodyStr = init.body !== undefined ? JSON.stringify(init.body) : '';
  const ok = init.ok ?? (init.status >= 200 && init.status < 300);
  return {
    ok,
    status: init.status,
    statusText: ok ? 'OK' : 'Error',
    text: () => Promise.resolve(bodyStr),
    json: () => Promise.resolve(init.body ?? {}),
    headers: new Headers(),
    redirected: false,
    type: 'basic',
    url: '',
    clone: function () { return this; },
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
  } as Response;
}

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
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body: payload }));

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

describe('x402 request handler (requestWithX402)', () => {
  const parseResponse = (r: Response) => r.json() as Promise<{ data: string }>;
  const successBody = { data: 'resource' };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Success (2xx)', () => {
    it('GET 200 returns parsed result', async () => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body: successBody }));

      const result = await requestWithX402(
        { url: BASE_URL, method: 'GET', parseResponse },
        { fetch: globalThis.fetch, buildPayment: async () => 'mock-payload' }
      );

      expect(isX402Required(result)).toBe(false);
      expect(result).toEqual(successBody);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(BASE_URL, expect.objectContaining({ method: 'GET' }));
    });

    it('POST with body works', async () => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body: successBody }));

      const result = await requestWithX402(
        { url: BASE_URL, method: 'POST', body: '{"x":1}', parseResponse },
        { fetch: globalThis.fetch, buildPayment: async () => 'mock' }
      );

      expect(isX402Required(result)).toBe(false);
      expect(result).toEqual(successBody);
      expect(fetchSpy).toHaveBeenCalledWith(BASE_URL, expect.objectContaining({ method: 'POST', body: '{"x":1}' }));
    });
  });

  describe('402 without pay', () => {
    it('402 + valid JSON body returns x402Required and parsed accepts (single)', async () => {
      const acceptsBody = {
        accepts: [{ price: '1000000', token: '0xToken', network: '8453', destination: '0xPayTo' }],
      };
      jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 402, body: acceptsBody }));

      const result = await requestWithX402(
        { url: BASE_URL, method: 'GET', parseResponse },
        { fetch: globalThis.fetch, buildPayment: async () => 'mock' }
      );

      expect(isX402Required(result)).toBe(true);
      if (!isX402Required(result)) return;
      expect(result.x402Payment.accepts).toHaveLength(1);
      expect(result.x402Payment.accepts[0]).toMatchObject({ price: '1000000', token: '0xToken', network: '8453' });
      expect(result.x402Payment.price).toBe('1000000');
      expect(result.x402Payment.token).toBe('0xToken');
      expect(result.x402Payment.network).toBe('8453');
    });

    it('402 + multiple accepts returns all and no top-level convenience', async () => {
      const acceptsBody = {
        accepts: [
          { price: '1000000', token: '0xA', network: '8453' },
          { price: '2000000', token: '0xB', network: '1' },
        ],
      };
      jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 402, body: acceptsBody }));

      const result = await requestWithX402(
        { url: BASE_URL, method: 'GET', parseResponse },
        { fetch: globalThis.fetch, buildPayment: async () => 'mock' }
      );

      expect(isX402Required(result)).toBe(true);
      if (!isX402Required(result)) return;
      expect(result.x402Payment.accepts).toHaveLength(2);
      expect(result.x402Payment.accepts[0]).toMatchObject({ token: '0xA', network: '8453' });
      expect(result.x402Payment.accepts[1]).toMatchObject({ token: '0xB', network: '1' });
      expect(result.x402Payment.price).toBeUndefined();
      expect(result.x402Payment.token).toBeUndefined();
    });
  });

  describe('402 + pay() success', () => {
    it('pay() with mock buildPayment and retry 200 resolves to parsed result', async () => {
      const buildPayment = jest.fn().mockResolvedValue('base64-payment-payload');
      const fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse({ status: 402, body: { accepts: [{ price: '1000000', token: '0xT', destination: '0xD' }] } }))
        .mockResolvedValueOnce(mockResponse({ status: 200, body: successBody }));

      const result = await requestWithX402(
        { url: BASE_URL, method: 'GET', parseResponse },
        { fetch: globalThis.fetch, buildPayment }
      );

      expect(isX402Required(result)).toBe(true);
      if (!isX402Required(result)) return;

      const paid = await result.x402Payment.pay();
      expect(paid).toEqual(successBody);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy).toHaveBeenNthCalledWith(1, BASE_URL, expect.not.objectContaining({ headers: expect.objectContaining({ 'PAYMENT-SIGNATURE': expect.anything() }) }));
      expect(fetchSpy).toHaveBeenNthCalledWith(2, BASE_URL, expect.objectContaining({ headers: expect.objectContaining({ 'PAYMENT-SIGNATURE': 'base64-payment-payload' }) }));
      expect(buildPayment).toHaveBeenCalledTimes(1);
      expect(buildPayment).toHaveBeenCalledWith(expect.objectContaining({ price: '1000000', token: '0xT' }), expect.any(Object));
    });
  });

  describe('402 + pay(accept)', () => {
    it('pay(index) passes chosen accept to buildPayment', async () => {
      const acceptsBody = {
        accepts: [
          { price: '1000000', token: '0xA', destination: '0xD1' },
          { price: '2000000', token: '0xB', destination: '0xD2' },
        ],
      };
      const buildPayment = jest.fn().mockResolvedValue('payload');
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse({ status: 402, body: acceptsBody }))
        .mockResolvedValueOnce(mockResponse({ status: 200, body: successBody }));

      const result = await requestWithX402(
        { url: BASE_URL, method: 'GET', parseResponse },
        { fetch: globalThis.fetch, buildPayment }
      );

      expect(isX402Required(result)).toBe(true);
      if (!isX402Required(result)) return;

      await result.x402Payment.pay(1);
      expect(buildPayment).toHaveBeenCalledWith(expect.objectContaining({ token: '0xB', price: '2000000' }), expect.any(Object));
    });

    it('pay(accept object) passes that accept to buildPayment', async () => {
      const acceptsBody = {
        accepts: [
          { price: '1000000', token: '0xA', destination: '0xD1' },
          { price: '2000000', token: '0xB', destination: '0xD2' },
        ],
      };
      const buildPayment = jest.fn().mockResolvedValue('payload');
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse({ status: 402, body: acceptsBody }))
        .mockResolvedValueOnce(mockResponse({ status: 200, body: successBody }));

      const result = await requestWithX402(
        { url: BASE_URL, method: 'GET', parseResponse },
        { fetch: globalThis.fetch, buildPayment }
      );

      expect(isX402Required(result)).toBe(true);
      if (!isX402Required(result)) return;

      await result.x402Payment.pay(result.x402Payment.accepts[0]);
      expect(buildPayment).toHaveBeenCalledWith(expect.objectContaining({ token: '0xA' }), expect.any(Object));
    });
  });

  describe('pay() failures', () => {
    it('retry returns 402 again then pay() rejects', async () => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse({ status: 402, body: { accepts: [{ price: '1', token: '0xT', destination: '0xD' }] } }))
        .mockResolvedValueOnce(mockResponse({ status: 402, body: {} }));

      const result = await requestWithX402(
        { url: BASE_URL, method: 'GET', parseResponse },
        { fetch: globalThis.fetch, buildPayment: async () => 'payload' }
      );

      expect(isX402Required(result)).toBe(true);
      if (!isX402Required(result)) return;

      await expect(result.x402Payment.pay()).rejects.toThrow(/402|payment rejected/);
    });

    it('retry returns 500 then pay() rejects', async () => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse({ status: 402, body: { accepts: [{ price: '1', token: '0xT', destination: '0xD' }] } }))
        .mockResolvedValueOnce(mockResponse({ status: 500, body: {} }));

      const result = await requestWithX402(
        { url: BASE_URL, method: 'GET', parseResponse },
        { fetch: globalThis.fetch, buildPayment: async () => 'payload' }
      );

      expect(isX402Required(result)).toBe(true);
      if (!isX402Required(result)) return;

      await expect(result.x402Payment.pay()).rejects.toThrow(/retry failed|500/);
    });

    it('buildPayment throws then pay() rejects', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockResponse({ status: 402, body: { accepts: [{ price: '1', token: '0xT', destination: '0xD' }] } })
      );

      const result = await requestWithX402(
        { url: BASE_URL, method: 'GET', parseResponse },
        { fetch: globalThis.fetch, buildPayment: async () => { throw new Error('no signer'); } }
      );

      expect(isX402Required(result)).toBe(true);
      if (!isX402Required(result)) return;

      await expect(result.x402Payment.pay()).rejects.toThrow('no signer');
    });

    it('empty accepts and pay() rejects', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 402, body: {} }));

      const result = await requestWithX402(
        { url: BASE_URL, method: 'GET', parseResponse },
        { fetch: globalThis.fetch, buildPayment: async () => 'payload' }
      );

      expect(isX402Required(result)).toBe(true);
      if (!isX402Required(result)) return;
      expect(result.x402Payment.accepts).toHaveLength(0);

      await expect(result.x402Payment.pay()).rejects.toThrow(/no payment option/);
    });

    it('pay(invalid index) rejects', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockResponse({ status: 402, body: { accepts: [{ price: '1', token: '0xT' }, { price: '2', token: '0xU' }] } })
      );

      const result = await requestWithX402(
        { url: BASE_URL, method: 'GET', parseResponse },
        { fetch: globalThis.fetch, buildPayment: async () => 'payload' }
      );

      expect(isX402Required(result)).toBe(true);
      if (!isX402Required(result)) return;
      expect(result.x402Payment.accepts).toHaveLength(2);

      await expect(result.x402Payment.pay(99)).rejects.toThrow(/no payment option selected/);
      await expect(result.x402Payment.pay(-1)).rejects.toThrow(/no payment option selected/);
    });
  });

  describe('Payment with first request', () => {
    it('options.payment set and 200 returns result (one round trip)', async () => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 200, body: successBody }));

      const result = await requestWithX402(
        { url: BASE_URL, method: 'GET', payment: 'prebuilt-base64-payload', parseResponse },
        { fetch: globalThis.fetch, buildPayment: async () => 'never-called' }
      );

      expect(isX402Required(result)).toBe(false);
      expect(result).toEqual(successBody);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(BASE_URL, expect.objectContaining({
        headers: expect.objectContaining({ 'PAYMENT-SIGNATURE': 'prebuilt-base64-payload' }),
      }));
    });

    it('first request with payment returns 402 then same x402 flow', async () => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse({ status: 402, body: { accepts: [{ price: '1', token: '0xT', destination: '0xD' }] } }))
        .mockResolvedValueOnce(mockResponse({ status: 200, body: successBody }));

      const result = await requestWithX402(
        { url: BASE_URL, method: 'GET', payment: 'wrong-or-rejected-payload', parseResponse },
        { fetch: globalThis.fetch, buildPayment: async () => 'retry-payload' }
      );

      expect(isX402Required(result)).toBe(true);
      if (!isX402Required(result)) return;

      const paid = await result.x402Payment.pay();
      expect(paid).toEqual(successBody);
    });
  });

  describe('Edge cases', () => {
    it('malformed 402 body returns x402Required with empty accepts', async () => {
      const res402 = mockResponse({ status: 402, body: {} });
      (res402 as any).text = () => Promise.resolve('not json');
      jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(res402);

      const result = await requestWithX402(
        { url: BASE_URL, method: 'GET', parseResponse },
        { fetch: globalThis.fetch, buildPayment: async () => 'x' }
      );

      expect(isX402Required(result)).toBe(true);
      if (!isX402Required(result)) return;
      expect(result.x402Payment.accepts).toHaveLength(0);
    });

    it('non-402 errors throw', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 401, body: {} }));

      await expect(
        requestWithX402(
          { url: BASE_URL, method: 'GET', parseResponse },
          { fetch: globalThis.fetch, buildPayment: async () => 'x' }
        )
      ).rejects.toThrow(/401/);

      jest.restoreAllMocks();
      jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse({ status: 500, body: {} }));

      await expect(
        requestWithX402(
          { url: BASE_URL, method: 'GET', parseResponse },
          { fetch: globalThis.fetch, buildPayment: async () => 'x' }
        )
      ).rejects.toThrow(/500/);
    });
  });
});

describe('parse402Accepts', () => {
  it('parses flat accepts', () => {
    const out = parse402Accepts({ accepts: [{ price: '100', token: '0xT', network: '8453' }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ price: '100', token: '0xT', network: '8453' });
  });

  it('parses paymentRequirements shape', () => {
    const out = parse402Accepts({ paymentRequirements: { amount: '200', asset: '0xA', payTo: '0xD' } });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ price: '200', token: '0xA', destination: '0xD' });
  });

  it('parses description and maxAmountRequired from accept entry', () => {
    const body = {
      accepts: [
        { price: '100', token: '0xT', network: '1', description: 'Pay in ETH', maxAmountRequired: '200' },
      ],
    };
    const out = parse402Accepts(body);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      price: '100',
      token: '0xT',
      network: '1',
      description: 'Pay in ETH',
      maxAmountRequired: '200',
    });
  });

  it('returns [] for null or non-object', () => {
    expect(parse402Accepts(null)).toEqual([]);
    expect(parse402Accepts(undefined)).toEqual([]);
    expect(parse402Accepts('string')).toEqual([]);
  });
});
