/**
 * ERC-8004 on-chain registration file support.
 *
 * The spec allows `agentURI` / ERC-721 `tokenURI` to be a base64-encoded JSON data URI:
 *   data:application/json;base64,eyJ0eXBlIjoi...
 *
 * We also accept optional parameters such as `;charset=utf-8` as long as `;base64,` is present.
 */

export interface DecodeJsonDataUriOptions {
  /**
   * Maximum decoded UTF-8 byte length allowed.
   *
   * Defaults to 256 KiB.
   */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 256 * 1024;

type ParsedDataUri = {
  mediaType: string | undefined;
  params: string[];
  isBase64: boolean;
  data: string;
};

function _parseDataUri(uri: string): ParsedDataUri | null {
  if (typeof uri !== 'string') return null;
  if (!uri.startsWith('data:')) return null;

  const commaIndex = uri.indexOf(',');
  if (commaIndex === -1) return null;

  const meta = uri.slice('data:'.length, commaIndex); // <mediatype>[;<param>]*
  const data = uri.slice(commaIndex + 1);
  const parts = meta.split(';').filter((p) => p.length > 0);

  const mediaType = parts.length > 0 && parts[0].includes('/') ? parts[0] : undefined;
  const params = mediaType ? parts.slice(1) : parts;

  const isBase64 = params.some((p) => p.toLowerCase() === 'base64');

  return { mediaType, params, isBase64, data };
}

function _normalizeBase64(input: string): string {
  // Remove ASCII whitespace (defensive; payloads SHOULD NOT contain it).
  let s = input.replace(/[\r\n\t ]+/g, '');

  // Accept base64url by normalizing to standard base64.
  s = s.replace(/-/g, '+').replace(/_/g, '/');

  // Add missing padding if required.
  const mod = s.length % 4;
  if (mod === 2) s += '==';
  else if (mod === 3) s += '=';
  else if (mod === 1) {
    // Impossible base64 length.
    throw new Error('Invalid base64 length');
  }

  // Strict character set check (after url-normalization).
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) {
    throw new Error('Invalid base64 characters');
  }

  return s;
}

function _base64ToBytes(b64: string): Uint8Array {
  // Prefer Node Buffer when available (tests run in Node).
  // Fall back to atob if in a browser-like environment.
  const g: any = globalThis as any;
  if (typeof g.Buffer !== 'undefined') {
    return new Uint8Array(g.Buffer.from(b64, 'base64'));
  }
  if (typeof g.atob !== 'function') {
    throw new Error('No base64 decoder available (Buffer/atob missing)');
  }
  const bin = g.atob(b64) as string;
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function _bytesToBase64(bytes: Uint8Array): string {
  const g: any = globalThis as any;
  if (typeof g.Buffer !== 'undefined') {
    return g.Buffer.from(bytes).toString('base64');
  }
  if (typeof g.btoa !== 'function') {
    throw new Error('No base64 encoder available (Buffer/btoa missing)');
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return g.btoa(bin) as string;
}

/**
 * Returns true if this is an acceptable ERC-8004 JSON base64 data URI.
 *
 * Tolerant:
 * - Accepts `data:application/json;charset=utf-8;base64,...`
 * - Requires `;base64,`
 */
export function isErc8004JsonDataUri(uri: string): boolean {
  const parsed = _parseDataUri(uri);
  if (!parsed) return false;
  if (!parsed.isBase64) return false;
  if (!parsed.data || parsed.data.length === 0) return false;
  if (!parsed.mediaType) return false;
  return parsed.mediaType.toLowerCase() === 'application/json';
}

/**
 * Decode an ERC-8004 JSON base64 data URI into a JSON object.
 */
export function decodeErc8004JsonDataUri(
  uri: string,
  opts: DecodeJsonDataUriOptions = {}
): Record<string, unknown> {
  const parsed = _parseDataUri(uri);
  if (!parsed || !uri.startsWith('data:')) {
    throw new Error('Not a data URI');
  }

  if (!parsed.mediaType || parsed.mediaType.toLowerCase() !== 'application/json') {
    throw new Error(`Unsupported data URI media type: ${parsed.mediaType || '(missing)'}`);
  }
  if (!parsed.isBase64) {
    throw new Error('Unsupported data URI encoding: expected ;base64');
  }

  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error(`Invalid maxBytes: ${maxBytes}`);
  }

  // Pre-check approximate decoded size to avoid allocating huge buffers.
  const rawPayload = parsed.data;
  const approxDecoded = Math.ceil((rawPayload.length * 3) / 4);
  if (approxDecoded > maxBytes) {
    throw new Error(`Data URI payload too large (approx ${approxDecoded} bytes > max ${maxBytes})`);
  }

  let bytes: Uint8Array;
  try {
    const normalized = _normalizeBase64(rawPayload);
    bytes = _base64ToBytes(normalized);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid base64 payload in data URI: ${msg}`);
  }

  if (bytes.byteLength > maxBytes) {
    throw new Error(`Data URI payload too large (${bytes.byteLength} bytes > max ${maxBytes})`);
  }

  const jsonStr = new TextDecoder().decode(bytes);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonStr);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid JSON in data URI: ${msg}`);
  }

  if (typeof parsedJson !== 'object' || parsedJson === null || Array.isArray(parsedJson)) {
    throw new Error('Invalid registration file format: expected a JSON object');
  }

  return parsedJson as Record<string, unknown>;
}

/**
 * Encode a JSON object into an ERC-8004-compatible JSON base64 data URI.
 */
export function encodeErc8004JsonDataUri(obj: Record<string, unknown>): string {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    throw new Error('encodeErc8004JsonDataUri expects an object');
  }
  const jsonStr = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(jsonStr);
  const b64 = _bytesToBase64(bytes);
  return `data:application/json;base64,${b64}`;
}

