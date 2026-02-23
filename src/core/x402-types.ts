/**
 * x402 payment-required types and 402 response parsing.
 * Aligns with docs/sdk-messaging-tasks-x402-spec.md §4 and §5.
 */

/**
 * A single payment option from a 402 response (or normalized from server body).
 * Each entry has at least price and token; optional fields for network, scheme, etc.
 */
export interface X402Accept {
  /** Amount in smallest units (e.g. USDC 6 decimals). May be string for large values. */
  price: string;
  /** Token contract address or symbol. */
  token: string;
  /** Chain id (number or string e.g. "base-sepolia", "eip155:84532"). */
  network?: string;
  scheme?: string;
  description?: string;
  /** Max amount required when variable. */
  maxAmountRequired?: string;
  /** Destination / pay-to address (recipient or verifying contract). */
  destination?: string;
  /** Asset address (alias for token in some 402 body shapes). */
  asset?: string;
  /** Additional fields from server (e.g. payTo, paymentRequirements). */
  [key: string]: unknown;
}

/**
 * Payment-required payload returned when the server responds with HTTP 402.
 * Always includes accepts[]; when there is a single accept, convenience fields may be set.
 */
export interface X402Payment<T = unknown> {
  /** Array of accepted payment options. Always present. */
  accepts: X402Accept[];
  /** When single accept: convenience price (same as accepts[0].price). */
  price?: string;
  /** When single accept: convenience token (same as accepts[0].token). */
  token?: string;
  /** When single accept: convenience network (same as accepts[0].network). */
  network?: string;
  /**
   * Performs payment and retries the request.
   * No arg = use single accept; number = accepts[index]; X402Accept = chosen option.
   * Resolves to the same shape as a successful request (no x402Required).
   */
  pay(accept?: X402Accept | number): Promise<T>;
}

/**
 * Options for the generic x402 HTTP request.
 */
export interface X402RequestOptions<T = unknown> {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer | Uint8Array;
  /**
   * Optional parser for 2xx response body. If omitted, raw Response or default parse is used.
   */
  parseResponse?: (response: Response) => Promise<T>;
  /**
   * Optional payment to send with the first request (e.g. base64 PAYMENT-SIGNATURE payload).
   * If provided and server returns 2xx, one round trip; if 402, normal x402 flow.
   */
  payment?: string;
}

/**
 * Response when server returns HTTP 402. Caller checks x402Required and may call x402Payment.pay().
 */
export interface X402RequiredResponse<T> {
  x402Required: true;
  x402Payment: X402Payment<T>;
}

/**
 * Result of sdk.request(): either the parsed success value or the 402 response object.
 */
export type X402RequestResult<T> = T | X402RequiredResponse<T>;

/**
 * Type guard: result is 402 response.
 */
export function isX402Required<T>(result: X402RequestResult<T>): result is X402RequiredResponse<T> {
  return typeof result === 'object' && result !== null && 'x402Required' in result && (result as X402RequiredResponse<T>).x402Required === true;
}

/** Raw 402 body shape (server may use paymentRequirements or flat accepts). */
interface Raw402Body {
  accepts?: Array<Record<string, unknown>>;
  paymentRequirements?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Normalize a single raw accept entry (flat or under paymentRequirements) to X402Accept.
 */
function normalizeAcceptEntry(entry: Record<string, unknown>): X402Accept {
  const pr = (entry.paymentRequirements as Record<string, unknown> | undefined) || entry;
  const price =
    (pr.price as string) ?? (pr.amount as string) ?? (pr.maxAmountRequired as string) ?? '0';
  const token = (pr.token as string) ?? (pr.asset as string) ?? '';
  return {
    price: String(price),
    token: String(token),
    network: pr.network as string | undefined,
    scheme: pr.scheme as string | undefined,
    description: pr.description as string | undefined,
    maxAmountRequired: pr.maxAmountRequired as string | undefined,
    destination: (pr.destination as string) ?? (pr.payTo as string),
    asset: pr.asset as string | undefined,
    ...entry,
  };
}

/**
 * Parse 402 response body into X402Accept[].
 * Tolerates common shapes: { accepts: [...] }, { accepts: [{ paymentRequirements: {...} }] }, or malformed (returns []).
 */
export function parse402Accepts(body: unknown): X402Accept[] {
  if (body == null || typeof body !== 'object') return [];
  const raw = body as Raw402Body;
  let list = raw.accepts;
  if (!Array.isArray(list)) {
    if (raw.paymentRequirements && typeof raw.paymentRequirements === 'object') {
      list = [raw.paymentRequirements as Record<string, unknown>];
    } else {
      return [];
    }
  }
  return list
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    .map(normalizeAcceptEntry);
}
