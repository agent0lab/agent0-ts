/**
 * Generic HTTP request with x402 (402 Payment Required) handling.
 * Used by sdk.request() and by future A2A/MCP methods.
 * See docs/sdk-messaging-tasks-x402-spec.md §4.2.
 */

import type { X402Accept, X402Payment, X402RequestOptions, X402RequiredResponse, X402RequestResult } from './x402-types.js';
import { parse402FromHeader } from './x402-types.js';

/** Snapshot of the original request so pay() can retry the same request with PAYMENT-SIGNATURE. */
export interface RequestSnapshot {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | ArrayBuffer | Uint8Array;
  /** x402 version from server's 402 PAYMENT-REQUIRED header (1 or 2). When set, buildPayment uses it for payload shape. */
  x402Version?: number;
}

export interface X402RequestDeps {
  fetch: typeof globalThis.fetch;
  buildPayment: (accept: X402Accept, snapshot: RequestSnapshot) => Promise<string>;
}

/**
 * Default parser when parseResponse is omitted: return the Response.
 */
async function defaultParseResponse(res: Response): Promise<Response> {
  return res;
}

/**
 * Perform a single HTTP request with built-in 402 handling.
 * - 2xx: return parsed result (or raw Response if no parseResponse).
 * - 402: do not throw; return { x402Required: true, x402Payment } with pay(accept?) that retries once.
 * - Other status or network error: throw.
 */
export async function requestWithX402<T = Response>(
  options: X402RequestOptions<T>,
  deps: X402RequestDeps
): Promise<X402RequestResult<T>> {
  const { url, method, headers = {}, body, payment } = options;
  const parseResponse = options.parseResponse ?? (defaultParseResponse as (res: Response) => Promise<T>);

  const snapshot: RequestSnapshot = {
    url,
    method,
    headers: { ...headers },
    body,
  };

  /** x402 spec: V1 uses X-PAYMENT header; V2 uses PAYMENT-SIGNATURE. */
  const doFetch = async (paymentPayload?: string, paymentHeaderName?: string): Promise<Response> => {
    const reqHeaders: Record<string, string> = { ...snapshot.headers };
    if (paymentPayload !== undefined) {
      const headerName = paymentHeaderName ?? 'PAYMENT-SIGNATURE';
      reqHeaders[headerName] = paymentPayload;
    }
    return deps.fetch(url, {
      method: snapshot.method,
      headers: reqHeaders,
      body: snapshot.body as RequestInit['body'],
    });
  };

  const firstPayload = payment !== undefined ? payment : undefined;
  let response = await doFetch(firstPayload);

  if (response.status === 402) {
    // x402 spec: payment options only in PAYMENT-REQUIRED header (base64 JSON).
    const headerPayload =
      response.headers.get('payment-required') ?? response.headers.get('PAYMENT-REQUIRED');
    const { accepts, x402Version } = parse402FromHeader(headerPayload);
    const singleAccept = accepts.length === 1 ? accepts[0]! : undefined;

    const x402Payment: X402Payment<T> = {
      accepts,
      ...(x402Version !== undefined && { x402Version }),
      ...(singleAccept && {
        price: singleAccept.price,
        token: singleAccept.token,
        network: singleAccept.network,
      }),
      pay: async (accept?: X402Accept | number): Promise<T> => {
        let chosen: X402Accept | undefined;
        if (accept === undefined) {
          chosen = singleAccept ?? accepts[0];
        } else if (typeof accept === 'number') {
          chosen = accepts[accept];
        } else {
          chosen = accept;
        }
        if (!chosen) {
          throw new Error('x402: no payment option selected (empty accepts or invalid index)');
        }
        const payload = await deps.buildPayment(chosen, { ...snapshot, x402Version });
        const paymentHeaderName = x402Version === 1 ? 'X-PAYMENT' : 'PAYMENT-SIGNATURE';
        const retryResponse = await doFetch(payload, paymentHeaderName);
        if (!retryResponse.ok) {
          let body = '';
          try {
            body = await retryResponse.text();
          } catch {
            body = '(failed to read body)';
          }
          const paymentRequired = retryResponse.headers.get('payment-required') ?? retryResponse.headers.get('PAYMENT-REQUIRED');
          const paymentResponse = retryResponse.headers.get('payment-response') ?? retryResponse.headers.get('PAYMENT-RESPONSE');
          const msg = retryResponse.status === 402
            ? 'x402: payment rejected or insufficient (server returned 402 again)'
            : `x402: retry failed with HTTP ${retryResponse.status}`;
          const err = new Error(msg) as Error & { status?: number; body?: string; headers?: Record<string, string>; url?: string };
          err.status = retryResponse.status;
          err.body = body;
          err.url = snapshot.url;
          err.headers = {
            ...(paymentRequired && { 'payment-required': paymentRequired }),
            ...(paymentResponse && { 'payment-response': paymentResponse }),
          };
          if (Object.keys(err.headers).length === 0) delete err.headers;
          throw err;
        }
        return parseResponse(retryResponse);
      },
    };

    const result: X402RequiredResponse<T> = {
      x402Required: true,
      x402Payment,
    };
    return result;
  }

  if (response.ok) {
    return parseResponse(response) as Promise<T>;
  }

  throw new Error(`HTTP ${response.status}: ${response.statusText}`);
}
