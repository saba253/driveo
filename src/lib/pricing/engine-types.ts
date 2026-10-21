import type { Powertrain, Transmission } from "../booking/types.ts";
import type { RoadRoute, RouteResult } from "../routing/types.ts";
import type { Money } from "./money.ts";
import type { QuoteStatus, Tariff } from "./types.ts";

/**
 * Types for the quote engine (src/lib/pricing/quote.ts).
 *
 *   driving = max(baseFee + roadKm × perKm, minimumFee)          ← driven leg only
 *   travel  = positioning(base → pickup) + return(delivery → base) ← fare + travel-time charge
 *   total   = roundUp(driving + travel + Σ extras)
 *
 * No double counting:
 *  - the per-km rate pays for the driven leg only; its driving DURATION is never
 *    charged (it is used for plausibility and overnight checks only);
 *  - the driver's own travel time is charged once, inside each travel leg, from the
 *    travel rule's minutes — never via the per-km rate;
 *  - every booking has exactly one positioning leg and one return leg. A leg that
 *    costs nothing must come from an explicit rule (mode "none"), never a default.
 *
 * Fuel and charging are never part of a quote (see FUEL_POLICY).
 */

export type TariffStatus = "draft" | "active" | "retired";

/** A tariff the quote engine can use. Values are configured by the business, never hardcoded. */
export type ServiceTariff = Tariff & {
  status: TariffStatus;
  /** Test data marker. The engine refuses fixture tariffs unless a caller explicitly allows them (tests only). */
  fixture: boolean;
  /** Compensation for the driver's non-driving travel time (positioning and return), in tetri per hour. */
  travelTimePerHourMinor: number;
};

/* ------------------------------------------------------------------ zones */

export type TravelZone = {
  id: string;
  name: string;
  /** Locality names (any spelling/script); matched after normalizeLocality(). */
  localities: readonly string[];
};

export type TravelMode = "bus" | "minibus" | "train" | "taxi" | "walk" | "other" | "none";

/**
 * Directional travel rule between zones, optionally narrowed to specific
 * localities (a more specific rule wins). Fares and minutes are business data.
 */
export type TravelRule = {
  id: string;
  fromZoneId: string;
  toZoneId: string;
  /** Narrows the rule to one locality inside fromZoneId. */
  fromLocality?: string;
  /** Narrows the rule to one locality inside toZoneId. */
  toLocality?: string;
  mode: TravelMode;
  fare: Money;
  /** Door-to-door travel time the driver spends on this leg. */
  travelMinutes: number;
  updatedAt: string;
  updatedBy: string;
  note?: string;
};

/** Per-quote admin decision replacing a rule (e.g. an unusual village). Always audited. */
export type TravelOverride = {
  fare: Money;
  travelMinutes: number;
  reason: string;
  by: string;
};

export type OvernightPolicy =
  /** Not decided yet: every quote goes to manual pricing (safe default). */
  | { mode: "notConfigured" }
  /** Explicit, attributed decision that no same-day limit applies. */
  | { mode: "waived"; approvedBy: string; reason: string }
  /**
   * Jobs whose total driver commitment exceeds the limit go to manual pricing.
   * No allowance is ever computed automatically.
   */
  | { mode: "manualReviewAbove"; maxSameDayMinutes: number; handoverMinutes: number };

export type PlausibilityLimits = {
  maxRoadKm: number;
  minAvgSpeedKmh: number;
  maxAvgSpeedKmh: number;
  /** Road ÷ straight-line distance above this is suspicious; null skips the check. */
  maxRoadToStraightRatio: number | null;
};

/** Where a driver starts each job and returns to afterwards. */
export type DriverBase = { zoneId: string; locality: string };

/** The driver a quote is priced for. Optional while there is one driver. */
export type QuoteDriver = { id: string; base: DriverBase };

export type PricingEngineConfig = {
  /** Identity of this configuration (zones, rules, limits). Changing it invalidates quotes. */
  version: string;
  quoteValidityHours: number;
  roundingStepMinor: number | null;
  /**
   * Default home base (initially Tbilisi — see base.ts). A driver passed to
   * priceQuote() overrides it, so each future driver can have their own base.
   */
  base: DriverBase;
  zones: readonly TravelZone[];
  travelRules: readonly TravelRule[];
  plausibility: PlausibilityLimits;
  overnight: OvernightPolicy;
};

/* ----------------------------------------------------------------- inputs */

export type QuoteEndpoint = {
  /** Locality name used for zone matching (city, town or village). */
  locality: string;
  address: string;
  /** Provider place id, when the address was resolved by a geocoder. */
  placeId: string | null;
  /** Provider-derived; used for sanity checks only, never for pricing or fingerprints. */
  coordinates?: { lat: number; lng: number } | null;
};

/** Explicit extra categories. Anything else — including fuel and charging — is rejected. */
export const SERVICE_EXTRA_CATEGORIES = ["waiting", "parking", "toll", "ferry", "afterHours", "otherService"] as const;
export type ServiceExtraCategory = (typeof SERVICE_EXTRA_CATEGORIES)[number];

/** Categories that must never be part of the service price (FUEL_POLICY). */
export const ENERGY_EXTRA_CATEGORIES = ["fuel", "charging"] as const;

export type ServiceExtra = {
  category: ServiceExtraCategory;
  code: string;
  label: string;
  amount: Money;
};

/** Vehicle facts that decide whether a job can be priced automatically. */
export type QuoteVehicle = {
  powertrain: Powertrain;
  transmission: Transmission;
  drivableConfirmed: boolean;
};

/** Our own pricing inputs — safe to keep in commercial records. */
export type QuoteRequest = {
  /** Stable id of the customer's booking request; quotes for it form a version chain. */
  requestId: string;
  pickup: QuoteEndpoint;
  delivery: QuoteEndpoint;
  schedule: { date: string; time: string };
  vehicle: QuoteVehicle;
  extras?: readonly ServiceExtra[];
  overrides?: { positioning?: TravelOverride; return?: TravelOverride };
};

/**
 * Route data from an external provider (e.g. Google Routes API). Kept separate
 * from our records because provider terms may restrict how long it is retained —
 * see docs/google-maps-data-retention.md.
 */
export type ProviderRoute = RoadRoute;

/** A provider's normalized answer (see src/lib/routing). */
export type RouteLookup = RouteResult;

/* ---------------------------------------------------------------- outcome */

export type ManualReasonCode =
  | "invalidConfig"
  | "missingTariff"
  | "tariffNotActive"
  | "fixtureTariffNotAllowed"
  | "invalidTariff"
  | "invalidDriverBase"
  | "vehicleNotEligible"
  | "unknownPickupLocality"
  | "unknownDeliveryLocality"
  | "routeUnavailable"
  | "nonRoadDistance"
  | "implausibleDistance"
  | "implausibleDuration"
  | "roadShorterThanStraightLine"
  | "routeTooIndirect"
  | "missingPositioningRule"
  | "missingReturnRule"
  | "invalidOverride"
  | "invalidExtras"
  | "overnightPolicyNotConfigured"
  | "overnightRequired";

export type ManualReason = { code: ManualReasonCode; detail?: string };

export type CommercialLineKind = "baseFee" | "distance" | "minimumAdjustment" | "positioning" | "return" | "additional" | "rounding";

/** A priced line. Deliberately carries no provider distance or duration. */
export type CommercialLine = {
  kind: CommercialLineKind;
  code: string;
  amount: Money;
  /** For travel lines: the rule id, or "override". */
  source?: string;
  /** For travel lines: our own rule's minutes (business data, not provider data). */
  travelMinutes?: number;
};

export type OvernightCheck =
  | { status: "waived"; approvedBy: string }
  | { status: "within_limit"; limitMinutes: number };

/** Our commercial record: safe to persist long-term. */
export type CommercialQuote = {
  currency: "GEL";
  tariffId: string;
  tariffVersion: number;
  configVersion: string;
  /** Driver the quote was priced for; null = default base (single-driver setup). */
  driverId: string | null;
  zones: { base: string; pickup: string; delivery: string };
  lines: readonly CommercialLine[];
  drivingSubtotal: Money;
  drivingTotal: Money;
  minimumApplied: boolean;
  travelTotal: Money;
  roundingAdjustment: Money;
  total: Money;
  excludes: readonly ["fuel", "charging"];
  overnight: OvernightCheck;
};

/** Everything derived from the routing provider; purgeable on its own schedule. */
export type ProviderDerived = {
  route: ProviderRoute;
  /** Total driver commitment used by the overnight check (includes provider duration). */
  commitmentMinutes: number | null;
  retention: "provider_restricted";
};

export type ServiceQuote = {
  quoteId: string;
  requestId: string;
  version: number;
  /** Quote this one replaces, if any. */
  supersedes: string | null;
  supersededBy: string | null;
  status: QuoteStatus;
  computedBy: "client" | "server";
  /** Only server-computed quotes can ever be binding. */
  authoritative: boolean;
  computedAt: string;
  validUntil: string;
  /** Fingerprint of the customer inputs this price was computed for. */
  inputFingerprint: string;
  commercial: CommercialQuote;
  /** null once purged for retention reasons. */
  providerDerived: ProviderDerived | null;
};

export type QuoteOutcome =
  | { status: "quoted"; quote: ServiceQuote }
  | {
      status: "manual_pricing";
      requestId: string;
      inputFingerprint: string;
      computedAt: string;
      /** All problems found, so an admin can fix them in one pass. No amounts are ever included. */
      reasons: readonly ManualReason[];
    };
