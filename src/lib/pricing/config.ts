/**
 * Pricing behaviour that the business configures — never tariffs themselves.
 * Real values will be loaded server-side; these are defaults only.
 */
export type PricingConfig = {
  /** How long a quote stays valid after it is computed. */
  quoteValidityHours: number;
};

/**
 * PROPOSED default, pending founder approval: quotes expire after 24 hours,
 * after which the price must be recalculated on the server.
 */
export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  quoteValidityHours: 24,
};

/** ISO timestamp at which a quote computed at `computedAt` expires. */
export function quoteExpiry(computedAt: string, validityHours: number): string {
  const start = Date.parse(computedAt);
  if (Number.isNaN(start)) throw new RangeError(`Invalid computedAt: ${computedAt}`);
  if (!Number.isFinite(validityHours) || validityHours <= 0) throw new RangeError(`Invalid validity: ${validityHours}h`);
  return new Date(start + validityHours * 3_600_000).toISOString();
}

export function isQuoteExpired(validUntil: string | null, now: string): boolean {
  if (validUntil === null) return false;
  return Date.parse(now) >= Date.parse(validUntil);
}
