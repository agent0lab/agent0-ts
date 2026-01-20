/**
 * Encode a decimal value (number|string) to ReputationRegistry's (int256 value, uint8 valueDecimals).
 *
 * - Supports negatives
 * - Rounds half-up to at most 18 decimals (never rejects)
 * - Clamps the raw int256 magnitude to <= 1e50 to avoid on-chain reverts
 */

const MAX_VALUE_DECIMALS = 18;
const MAX_RAW_ABS = 10n ** 50n; // matches ReputationRegistryUpgradeable MAX_ABS_VALUE = 1e50

export type EncodedReputationValue = {
  value: bigint;
  valueDecimals: number;
  normalized: string; // normalized decimal string (no exponent)
};

function stripLeadingZeros(s: string): string {
  let i = 0;
  while (i < s.length - 1 && s[i] === '0') i++;
  return s.slice(i);
}

function normalizeDecimalString(input: string): string {
  const s = input.trim();
  if (s.length === 0) throw new Error('Empty value');

  // Reject NaN/Infinity textual forms early
  const lower = s.toLowerCase();
  if (lower === 'nan' || lower === '+nan' || lower === '-nan') throw new Error('NaN not supported');
  if (lower === 'infinity' || lower === '+infinity' || lower === '-infinity') throw new Error('Infinity not supported');

  // Handle exponential notation (e.g. 1.23e-4)
  if (/[eE]/.test(s)) {
    const match = s.match(/^([+-]?)(\d+(?:\.\d+)?)[eE]([+-]?\d+)$/);
    if (!match) throw new Error(`Invalid numeric string: ${input}`);
    const sign = match[1] === '-' ? '-' : '';
    const mantissa = match[2];
    const exp = parseInt(match[3], 10);
    if (!Number.isFinite(exp)) throw new Error(`Invalid exponent: ${input}`);

    const [intPartRaw, fracPartRaw = ''] = mantissa.split('.');
    const digits = stripLeadingZeros((intPartRaw || '0') + fracPartRaw);
    const fracLen = fracPartRaw.length;
    // mantissa represents digits * 10^-fracLen. Apply exponent => shift by (exp - fracLen).
    const shift = exp - fracLen;

    if (digits === '0') return '0';

    if (shift >= 0) {
      return sign + digits + '0'.repeat(shift);
    }
    // shift < 0 => decimal point moves left
    const pos = digits.length + shift; // shift negative
    if (pos > 0) {
      const a = digits.slice(0, pos);
      const b = digits.slice(pos);
      return sign + a + '.' + b;
    }
    // Need leading zeros: 0.xxx
    return sign + '0.' + '0'.repeat(-pos) + digits;
  }

  // Plain decimal
  if (!/^([+-])?(\d+)(\.\d+)?$/.test(s)) {
    throw new Error(`Invalid numeric string: ${input}`);
  }

  // Normalize: remove leading +, trim trailing fractional zeros
  let sign = '';
  let body = s;
  if (body[0] === '+') body = body.slice(1);
  if (body[0] === '-') {
    sign = '-';
    body = body.slice(1);
  }
  let [intPart, fracPart = ''] = body.split('.');
  intPart = stripLeadingZeros(intPart || '0');
  fracPart = fracPart.replace(/0+$/, '');

  if (intPart === '0' && fracPart.length === 0) return '0';
  return sign + intPart + (fracPart.length ? '.' + fracPart : '');
}

function pow10BigInt(decimals: number): bigint {
  return 10n ** BigInt(decimals);
}

/**
 * Encodes an input decimal to (value,valueDecimals), rounding half-up to <=18 decimals
 * and clamping raw abs(value) to <= 1e50.
 */
export function encodeReputationValue(input: number | string): EncodedReputationValue {
  let normalized: string;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('Non-finite number not supported');
    // Convert number to a decimal string; toString may yield exponent form, which we normalize above.
    // Keep plenty of precision; downstream we round to <=18 decimals anyway.
    normalized = normalizeDecimalString(input.toString());
  } else {
    normalized = normalizeDecimalString(input);
  }

  if (normalized === '0') {
    return { value: 0n, valueDecimals: 0, normalized };
  }

  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [intPart, fracPartRaw = ''] = unsigned.split('.');

  // Decide decimals to encode (<=18), then round half-up if needed.
  const fracPart = fracPartRaw;
  const decimals = Math.min(fracPart.length, MAX_VALUE_DECIMALS);

  const kept = fracPart.slice(0, decimals);
  const nextDigit = fracPart.length > decimals ? fracPart.charCodeAt(decimals) - 48 : 0;

  // Build the raw scaled integer string
  const scaledStr = stripLeadingZeros((intPart || '0') + kept.padEnd(decimals, '0')) || '0';
  let raw = BigInt(scaledStr);

  // Round half-up at the next digit beyond `decimals`
  const shouldRoundUp = fracPart.length > decimals && nextDigit >= 5;
  if (shouldRoundUp) raw = raw + 1n;

  if (negative) raw = -raw;

  // Clamp to on-chain bounds for raw int256 value
  if (raw > MAX_RAW_ABS) raw = MAX_RAW_ABS;
  if (raw < -MAX_RAW_ABS) raw = -MAX_RAW_ABS;

  return {
    value: raw,
    valueDecimals: decimals,
    normalized,
  };
}

/**
 * Compute a JS number from (raw,valueDecimals). Note: may lose precision for very large values.
 */
export function decodeReputationValue(raw: bigint, valueDecimals: number): number {
  const denom = Number(pow10BigInt(valueDecimals));
  return Number(raw) / denom;
}


