/**
 * Generic HTTP request with x402 (402 Payment Required) handling.
 * Used by sdk.request() and by future A2A/MCP methods.
 * See docs/sdk-messaging-tasks-x402-spec.md §4.2.
 */

import type { X402Accept, X402Payment, X402RequestOptions, X402RequiredResponse, X402RequestResult } from './x402-types.js';
import { parse402FromBody, parse402FromHeader, parse402FromWWWAuthenticate } from './x402-types.js';

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
 * Default parser when parseResponse is omitted: parse response body as JSON (res.json()).
 */
async function defaultParseResponse(res: Response): Promise<unknown> {
  return res.json();
}

/**
 * Perform a single HTTP request with built-in 402 handling.
 * - 2xx: return parsed result (default: JSON body; or use parseResponse for custom parsing).
 * - 402: do not throw; return { x402Required: true, x402Payment } with pay(accept?) that retries once.
 * - Other status or network error: throw.
 */
export async function requestWithX402<T = unknown>(
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

  /** x402 spec: V1 uses X-PAYMENT header; V2 uses PAYMENT-SIGNATURE. Fetch to a given requestUrl (default snapshot.url). */
  const doFetch = async (
    paymentPayload?: string,
    paymentHeaderName?: string,
    requestUrl?: string
  ): Promise<Response> => {
    const targetUrl = requestUrl ?? snapshot.url;
    const reqHeaders: Record<string, string> = { ...snapshot.headers };
    if (paymentPayload !== undefined) {
      const headerName = paymentHeaderName ?? 'PAYMENT-SIGNATURE';
      reqHeaders[headerName] = paymentPayload;
    }
    return deps.fetch(targetUrl, {
      method: snapshot.method,
      headers: reqHeaders,
      body: snapshot.body as RequestInit['body'],
    });
  };

  const firstPayload = payment !== undefined ? payment : undefined;
  let response = await doFetch(firstPayload);

  if (response.status === 402) {
    // x402 spec: payment requirements in header (PAYMENT-REQUIRED base64) or body (JSON). Fallback: WWW-Authenticate.
    const headerPayload =
      response.headers.get('payment-required') ?? response.headers.get('PAYMENT-REQUIRED');
    let { accepts, x402Version } = parse402FromHeader(headerPayload);
    let responseFromWWWAuthenticate = false;
    if (accepts.length === 0) {
      const wwwAuth = response.headers.get('www-authenticate') ?? response.headers.get('WWW-Authenticate');
      const parsed = parse402FromWWWAuthenticate(wwwAuth);
      accepts = parsed.accepts;
      if (accepts.length > 0) responseFromWWWAuthenticate = true;
      if (x402Version === undefined && parsed.x402Version !== undefined) x402Version = parsed.x402Version;
    }
    if (accepts.length === 0) {
      const bodyText = await response.text();
      const parsed = parse402FromBody(bodyText);
      accepts = parsed.accepts;
      if (x402Version === undefined && parsed.x402Version !== undefined) x402Version = parsed.x402Version;
    }
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
        // When server challenged with WWW-Authenticate: try Authorization: x402 <payload> first (RFC 7235); if 402 again, retry with PAYMENT-SIGNATURE (some servers expect spec header).
        const paymentHeaderName = responseFromWWWAuthenticate
          ? 'Authorization'
          : (x402Version === 1 ? 'X-PAYMENT' : 'PAYMENT-SIGNATURE');
        const paymentHeaderValue = responseFromWWWAuthenticate ? `x402 ${payload}` : payload;
        const retryHeaders: Record<string, string> = { ...snapshot.headers, [paymentHeaderName]: paymentHeaderValue };

        const tryUrl = async (requestUrl: string, useAuthHeader = true): Promise<Response> => {
          if (responseFromWWWAuthenticate && !useAuthHeader) {
            return doFetch(payload, 'PAYMENT-SIGNATURE', requestUrl);
          }
          return doFetch(paymentHeaderValue, paymentHeaderName, requestUrl);
        };

        let retryResponse = await tryUrl(snapshot.url);
        // If we used WWW-Authenticate and server returned 402 again, retry with PAYMENT-SIGNATURE (same payload).
        if (responseFromWWWAuthenticate && !retryResponse.ok && retryResponse.status === 402) {
          retryResponse = await tryUrl(snapshot.url, false);
        }
        if (!retryResponse.ok) {
          let body = '';
          try {
            body = await retryResponse.text();
          } catch {
            body = '(failed to read body)';
          }
          const paymentRequired = retryResponse.headers.get('payment-required') ?? retryResponse.headers.get('PAYMENT-REQUIRED');
          const paymentResponse = retryResponse.headers.get('payment-response') ?? retryResponse.headers.get('PAYMENT-RESPONSE');
          const responseHeaders: Record<string, string> = {};
          retryResponse.headers.forEach((v, k) => {
            responseHeaders[k] = v;
          });
          const msg = retryResponse.status === 402
            ? 'x402: payment rejected or insufficient (server returned 402 again)'
            : `x402: retry failed with HTTP ${retryResponse.status}`;
          let requestBody = '';
          if (snapshot.body !== undefined) {
            if (typeof snapshot.body === 'string') requestBody = snapshot.body;
            else if (snapshot.body instanceof ArrayBuffer) requestBody = new TextDecoder().decode(snapshot.body);
            else if (snapshot.body instanceof Uint8Array) requestBody = new TextDecoder().decode(snapshot.body);
          }
          const err = new Error(msg) as Error & {
            status?: number;
            body?: string;
            url?: string;
            method?: string;
            requestHeaders?: Record<string, string>;
            requestBody?: string;
            responseHeaders?: Record<string, string>;
            /** @deprecated use responseHeaders */
            headers?: Record<string, string>;
          };
          err.status = retryResponse.status;
          err.body = body;
          err.url = snapshot.url;
          err.method = snapshot.method;
          err.requestHeaders = retryHeaders;
          err.requestBody = requestBody;
          err.responseHeaders = responseHeaders;
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
