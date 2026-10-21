/**
 * Money is held in integer minor units (tetri; 1 GEL = 100 tetri) so that
 * sums and comparisons are exact. Never store prices as floating GEL.
 */
export type Currency = "GEL";

export type Money = { readonly amountMinor: number; readonly currency: Currency };

export class MoneyError extends Error {}

export function money(amountMinor: number, currency: Currency = "GEL"): Money {
  if (!Number.isSafeInteger(amountMinor)) throw new MoneyError(`Amount must be an integer in minor units, got ${amountMinor}`);
  return { amountMinor, currency };
}

/** Convenience for literals: gel(25.5) → 2550 tetri. */
export function gel(amount: number): Money {
  return money(Math.round(amount * 100));
}

export const ZERO_GEL = money(0);

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new MoneyError(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function sumMoney(items: readonly Money[], currency: Currency = "GEL"): Money {
  return items.reduce(addMoney, money(0, currency));
}

export function maxMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new MoneyError(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  return a.amountMinor >= b.amountMinor ? a : b;
}
