/**
 * Pricing behaviour that the business configures — never tariffs themselves.
 * Real values will be loaded server-side; these are defaults only.
 */
export type PricingConfig = {
  /** How long a quote stays valid after it is computed. */
  quoteValidityHours: number;
  /** Totals are rounded UP to a multiple of this many tetri; null disables rounding. */
  roundingStepMinor: number | null;
};

/**
 * Founder-approved defaults:
 *  - a quote is valid for 12 hours from its server-side creation time, then the
 *    price must be recalculated on the server (expired at exactly 12:00:00);
 *  - the final service price is rounded UP to the next whole GEL (100 tetri),
 *    after driving, positioning, return and permitted extras are added.
 * Both remain configurable per pricing configuration.
 */
export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  quoteValidityHours: 12,
  roundingStepMinor: 100,
};

/** ISO timestamp at which a quote computed at `computedAt` expires. */
export function quoteExpiry(computedAt: string, validityHours: number): string {
  const start = Date.parse(computedAt);
  if (Number.isNaN(start)) throw new RangeError(`Invalid computedAt: ${computedAt}`);
  if (!Number.isFinite(validityHours) || validityHours <= 0) throw new RangeError(`Invalid validity: ${validityHours}h`);
  return new Date(start + validityHours * 3_600_000).toISOString();
}

/** Expired when `now` is at or after `validUntil` (exactly at the boundary counts as expired). */
export function isQuoteExpired(validUntil: string | null, now: string): boolean {
  if (validUntil === null) return false;
  return Date.parse(now) >= Date.parse(validUntil);
}

/**
 * Rounds an amount UP to the next multiple of `stepMinor` (integer tetri).
 * Returns the amount unchanged when rounding is disabled or already aligned.
 */
export function roundUpMinor(amountMinor: number, stepMinor: number | null): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new RangeError(`Invalid amount: ${amountMinor}`);
  if (stepMinor === null) return amountMinor;
  if (!Number.isSafeInteger(stepMinor) || stepMinor <= 0) throw new RangeError(`Invalid rounding step: ${stepMinor}`);
  const remainder = amountMinor % stepMinor;
  return remainder === 0 ? amountMinor : amountMinor + (stepMinor - remainder);
}
