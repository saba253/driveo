import { DEFAULT_PRICING_CONFIG, quoteExpiry, type PricingConfig } from "./config.ts";
import { addMoney, maxMoney, money, sumMoney, type Money } from "./money.ts";
import type { QuoteLine, QuoteSnapshot, QuoteStatus, ServicePriceBreakdown, ServicePriceInput } from "./types.ts";

/**
 * Step 1.5 building blocks, kept for compatibility. New code should use
 * priceQuote() in ./quote.ts, which adds travel zones, positioning/return legs,
 * rounding, manual-pricing outcomes and provider-data separation.
 *
 * Pure service-price calculation.
 *
 *   driving = max(baseFee + distanceKm × perKm, minimumFee)
 *   total   = driving + returnTransport + Σ additionalCharges
 *
 * The minimum applies to the driving service only; return transport and
 * agreed extras are pass-through costs added on top. Fuel and charging are never included.
 *
 * The same function will run on the server; only a server-computed snapshot
 * may be authoritative (see createQuoteSnapshot).
 */
export class PricingError extends Error {}

const MAX_KM = 2_000;

function assertGel(m: Money, what: string) {
  if (m.currency !== "GEL") throw new PricingError(`${what} must be in GEL`);
  if (m.amountMinor < 0) throw new PricingError(`${what} must not be negative`);
}

export function calculateServicePrice(input: ServicePriceInput): ServicePriceBreakdown {
  const { route, tariff } = input;

  if (route.method !== "road") throw new PricingError("Only road distance from a routing provider can be priced");
  if (!Number.isFinite(route.distanceKm) || route.distanceKm <= 0 || route.distanceKm > MAX_KM) {
    throw new PricingError(`Implausible road distance: ${route.distanceKm} km`);
  }
  if (tariff.currency !== "GEL") throw new PricingError("Tariff must be in GEL");
  if (!Number.isFinite(tariff.perKmMinor) || tariff.perKmMinor < 0) throw new PricingError("Per-km rate must be a non-negative number");
  assertGel(tariff.baseFee, "Base fee");
  assertGel(tariff.minimumFee, "Minimum fee");

  const lines: QuoteLine[] = [];
  const distanceAmount = money(Math.round(route.distanceKm * tariff.perKmMinor));

  lines.push({ kind: "baseFee", code: "baseFee", amount: tariff.baseFee });
  lines.push({ kind: "distance", code: "distance", amount: distanceAmount, quantity: route.distanceKm });

  const drivingSubtotal = addMoney(tariff.baseFee, distanceAmount);
  const drivingTotal = maxMoney(drivingSubtotal, tariff.minimumFee);
  const minimumApplied = drivingTotal.amountMinor > drivingSubtotal.amountMinor;
  if (minimumApplied) {
    lines.push({
      kind: "minimumAdjustment",
      code: "minimumAdjustment",
      amount: money(drivingTotal.amountMinor - drivingSubtotal.amountMinor),
    });
  }

  const ret = input.returnTransport;
  if (ret && ret.mode !== "none") {
    assertGel(ret.cost, "Return transport");
    lines.push({ kind: "returnTransport", code: ret.mode, amount: ret.cost });
  }

  const seen = new Set<string>();
  for (const charge of input.additionalCharges ?? []) {
    if (!charge.code) throw new PricingError("Additional charge needs a code");
    if (seen.has(charge.code)) throw new PricingError(`Duplicate additional charge: ${charge.code}`);
    seen.add(charge.code);
    assertGel(charge.amount, `Charge "${charge.code}"`);
    lines.push({ kind: "additional", code: charge.code, amount: charge.amount });
  }

  return {
    currency: "GEL",
    lines,
    drivingSubtotal,
    drivingTotal,
    minimumApplied,
    total: sumMoney(lines.map((l) => l.amount)),
    excludes: ["fuel", "charging"],
  };
}

type SnapshotMeta = {
  quoteId: string;
  version: number;
  computedBy: "client" | "server";
  computedAt: string;
  /** Explicit expiry; otherwise derived from `config.quoteValidityHours`. */
  validUntil?: string | null;
  config?: Pick<PricingConfig, "quoteValidityHours">;
  /** Server-side only; ignored (forced to "estimate") for client calculations. */
  status?: Exclude<QuoteStatus, "estimate">;
};

/**
 * @deprecated Stores the provider's route distance inside the snapshot, which may
 * conflict with provider retention terms. Use priceQuote() (./quote.ts), which
 * keeps provider data in a separately purgeable `providerDerived` section.
 *
 * Freezes a calculation together with its inputs. A browser-computed snapshot
 * is always a non-authoritative "estimate", whatever status is requested.
 */
export function createQuoteSnapshot(input: ServicePriceInput, meta: SnapshotMeta): QuoteSnapshot {
  if (!Number.isInteger(meta.version) || meta.version < 1) throw new PricingError("Quote version must be a positive integer");
  const server = meta.computedBy === "server";

  const snapshot: QuoteSnapshot = {
    quoteId: meta.quoteId,
    version: meta.version,
    status: server ? (meta.status ?? "pending_review") : "estimate",
    computedBy: meta.computedBy,
    authoritative: server,
    computedAt: meta.computedAt,
    validUntil:
      meta.validUntil !== undefined
        ? meta.validUntil
        : quoteExpiry(meta.computedAt, (meta.config ?? DEFAULT_PRICING_CONFIG).quoteValidityHours),
    inputs: {
      tariffId: input.tariff.id,
      tariffVersion: input.tariff.version,
      distanceKm: input.route.distanceKm,
      routeProvider: input.route.provider,
      routeComputedAt: input.route.computedAt,
    },
    breakdown: calculateServicePrice(input),
  };
  return deepFreeze(snapshot);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}
