import type { Money } from "./money.ts";
import type { RoadRoute } from "../routing/types.ts";

/**
 * Service-price model. Fuel is deliberately absent: it is never part of the
 * driver service price (see FUEL_POLICY) and is modelled in src/lib/fuel.
 */

/** A versioned set of rates. Production tariffs are configured by the business, never hardcoded in UI. */
export type Tariff = {
  id: string;
  version: number;
  currency: "GEL";
  /** Flat fee per job. */
  baseFee: Money;
  /** Price per road kilometre, in minor units. May be fractional per km; the line total is rounded. */
  perKmMinor: number;
  /** The driving service (base + distance) is never priced below this. */
  minimumFee: Money;
  /** ISO timestamp from which this tariff applies. */
  effectiveFrom: string;
  /** Reserved for per-driver or per-region tariffs once there are multiple drivers. */
  scope: { driverId: string | null; region: string | null };
};

/** How the driver gets back after delivery — a pass-through cost, priced per job. */
export type ReturnTransport = {
  mode: "bus" | "minibus" | "train" | "taxi" | "other" | "none";
  cost: Money;
  note?: string;
};

/** Explicit, itemised extras agreed with the customer (e.g. waiting time, tolls, parking). */
export type AdditionalCharge = {
  code: string;
  label: string;
  amount: Money;
};

export type ServicePriceInput = {
  /** Road distance from a routing provider. Straight-line distance is not accepted. */
  route: Pick<RoadRoute, "distanceKm" | "method" | "provider" | "computedAt">;
  tariff: Tariff;
  returnTransport?: ReturnTransport | null;
  additionalCharges?: readonly AdditionalCharge[];
};

export type QuoteLineKind = "baseFee" | "distance" | "minimumAdjustment" | "returnTransport" | "additional";

export type QuoteLine = {
  kind: QuoteLineKind;
  /** Charge code for `additional` lines; otherwise equals `kind`. */
  code: string;
  amount: Money;
  /** Quantity basis, e.g. kilometres for the distance line. */
  quantity?: number;
};

export type ServicePriceBreakdown = {
  currency: "GEL";
  lines: readonly QuoteLine[];
  /** Base + distance, before the minimum is applied. */
  drivingSubtotal: Money;
  /** Base + distance after the minimum. */
  drivingTotal: Money;
  minimumApplied: boolean;
  total: Money;
  /** Costs never included in this total. */
  excludes: readonly ["fuel"];
};

export type QuoteStatus =
  /** Calculated in the browser — indicative only, never binding. */
  | "estimate"
  /** Recalculated on the server, awaiting driver/founder review. */
  | "pending_review"
  /** Agreed with the customer; the snapshot is the price of record. */
  | "agreed"
  | "expired"
  | "superseded";

/**
 * Immutable record of a quote and everything it was computed from, so it can be
 * audited or re-derived later even after tariffs change.
 */
export type QuoteSnapshot = {
  quoteId: string;
  /** Increments each time a request is re-quoted. */
  version: number;
  status: QuoteStatus;
  computedBy: "client" | "server";
  /** Only server-computed quotes can ever be binding. */
  authoritative: boolean;
  computedAt: string;
  validUntil: string | null;
  inputs: {
    tariffId: string;
    tariffVersion: number;
    distanceKm: number;
    routeProvider: string;
    routeComputedAt: string;
  };
  breakdown: ServicePriceBreakdown;
};
