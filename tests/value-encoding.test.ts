import { encodeReputationValue } from '../src/utils/value-encoding';

describe('value-encoding (reputation)', () => {
  it('clamps extremely large values to 1e38 (positive)', () => {
    const out = encodeReputationValue('1e40');
    expect(out.valueDecimals).toBe(0);
    expect(out.value).toBe(10n ** 38n);
  });

  it('clamps extremely large values to 1e38 (negative)', () => {
    const out = encodeReputationValue('-1e40');
    expect(out.valueDecimals).toBe(0);
    expect(out.value).toBe(-(10n ** 38n));
  });

  it('supports exponent notation and normalizes decimals', () => {
    const out = encodeReputationValue('1e-3');
    expect(out.normalized).toBe('0.001');
    expect(out.valueDecimals).toBe(3);
    expect(out.value).toBe(1n);
  });

  it('rounds half-up to at most 18 decimals', () => {
    // 19th digit is 5 => rounds up at 18 decimals.
    const out = encodeReputationValue('1.0000000000000000005');
    expect(out.valueDecimals).toBe(18);
    expect(out.value).toBe(1000000000000000001n);
  });

  it('rejects non-finite numbers', () => {
    expect(() => encodeReputationValue(Number.NaN)).toThrow();
    expect(() => encodeReputationValue(Number.POSITIVE_INFINITY)).toThrow();
  });
});






