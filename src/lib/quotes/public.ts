import type { ManualReasonCode } from "../pricing/engine-types.ts";
import type { InputIssue } from "./input.ts";
import type { QuoteServiceResult } from "./service.ts";

/**
 * The ONLY shape that may leave the server for customers.
 *
 * - Never contains provider route data (distance, duration, provider, timestamps
 *   of provider calls), internal reasons, zone ids, tariff ids or rule ids.
 * - A price is included only when publishing is explicitly enabled AND the quote
 *   is authoritative AND no fixture tariff/configuration was involved.
 *   Publishing is disabled in this step.
 */

export type ManualCategory = "location" | "route" | "vehicle" | "service";

export type PublicQuoteResponse =
  | {
      status: "price_available";
      quoteId: string;
      validUntil: string;
      total: { amountMinor: number; currency: "GEL" };
      excludes: readonly ["fuel", "charging"];
      /** True when this re-quote's total differs from the previous one; the customer must acknowledge it. */
      priceChanged: boolean;
    }
  /** A price was computed but may not be shown (publishing off, or test data). */
  | { status: "price_pending"; quoteId: string; validUntil: string; priceChanged: boolean }
  | { status: "manual_pricing"; categories: ManualCategory[] }
  | { status: "invalid_input"; issues: InputIssue[] }
  | { status: "rate_limited"; retryAfterSeconds: number };

const CATEGORY: Record<ManualReasonCode, ManualCategory> = {
  unknownPickupLocality: "location",
  unknownDeliveryLocality: "location",
  routeUnavailable: "route",
  nonRoadDistance: "route",
  implausibleDistance: "route",
  implausibleDuration: "route",
  roadShorterThanStraightLine: "route",
  routeTooIndirect: "route",
  overnightRequired: "route",
  vehicleNotEligible: "vehicle",
  invalidConfig: "service",
  missingTariff: "service",
  tariffNotActive: "service",
  fixtureTariffNotAllowed: "service",
  fixtureConfigNotAllowed: "service",
  invalidTariff: "service",
  invalidDriverBase: "service",
  missingPositioningRule: "service",
  missingReturnRule: "service",
  invalidOverride: "service",
  invalidExtras: "service",
  overnightPolicyNotConfigured: "service",
};

export function toPublicQuoteResponse(result: QuoteServiceResult, opts: { publishPrices: boolean }): PublicQuoteResponse {
  switch (result.status) {
    case "rate_limited":
      return { status: "rate_limited", retryAfterSeconds: Math.ceil(result.retryAfterMs / 1000) };
    case "invalid_input":
      return { status: "invalid_input", issues: result.issues.map((i) => ({ field: i.field, code: i.code })) };
    case "manual_pricing": {
      const categories = [...new Set(result.reasons.map((r) => CATEGORY[r.code] ?? "service"))];
      return { status: "manual_pricing", categories };
    }
    case "quoted": {
      const q = result.quote;
      const publishable = opts.publishPrices && q.authoritative && !q.commercial.testData;
      const priceChanged = Boolean(q.priceChange?.changed);
      if (!publishable) return { status: "price_pending", quoteId: q.quoteId, validUntil: q.validUntil, priceChanged };
      return {
        status: "price_available",
        quoteId: q.quoteId,
        validUntil: q.validUntil,
        total: { amountMinor: q.commercial.total.amountMinor, currency: "GEL" },
        excludes: ["fuel", "charging"],
        priceChanged,
      };
    }
  }
}
