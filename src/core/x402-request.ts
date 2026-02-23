/**
 * Generic HTTP request with x402 (402 Payment Required) handling.
 * Used by sdk.request() and by future A2A/MCP methods.
 * See docs/sdk-messaging-tasks-x402-spec.md §4.2.
 */

import type { X402Accept, X402Payment, X402RequestOptions, X402RequiredResponse, X402RequestResult } from './x402-types.js';
import { parse402Accepts } from './x402-types.js';

/** Snapshot of the original request so pay() can retry the same request with PAYMENT-SIGNATURE. */
export interface RequestSnapshot {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | ArrayBuffer | Uint8Array;
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

  const doFetch = async (paymentPayload?: string): Promise<Response> => {
    const reqHeaders: Record<string, string> = { ...snapshot.headers };
    if (paymentPayload !== undefined) {
      reqHeaders['PAYMENT-SIGNATURE'] = paymentPayload;
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
    let bodyJson: unknown;
    try {
      const text = await response.text();
      bodyJson = text ? JSON.parse(text) : {};
    } catch {
      bodyJson = {};
    }
    const accepts = parse402Accepts(bodyJson);
    const singleAccept = accepts.length === 1 ? accepts[0]! : undefined;

    const x402Payment: X402Payment<T> = {
      accepts,
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
        const payload = await deps.buildPayment(chosen, snapshot);
        const retryResponse = await doFetch(payload);
        if (!retryResponse.ok) {
          const msg = retryResponse.status === 402
            ? 'x402: payment rejected or insufficient (server returned 402 again)'
            : `x402: retry failed with HTTP ${retryResponse.status}`;
          throw new Error(msg);
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
