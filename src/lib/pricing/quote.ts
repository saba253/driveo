import { checkRoutePlausibility } from "./checks.ts";
import { quoteExpiry, roundUpMinor } from "./config.ts";
import type {
  CommercialLine,
  ManualReason,
  OvernightCheck,
  QuoteDriver,
  PricingEngineConfig,
  QuoteOutcome,
  QuoteRequest,
  RouteLookup,
  ServiceQuote,
  ServiceTariff,
  TravelOverride,
  TravelRule,
} from "./engine-types.ts";
import { fingerprintQuoteInputs } from "./fingerprint.ts";
import { money, sumMoney, type Money } from "./money.ts";
import type { QuoteStatus } from "./types.ts";
import { findTravelRule, matchLocality, validatePricingConfig, type ZoneMatch } from "./zones.ts";

/**
 * Quote engine. Pure apart from hashing; "now" and ids are passed in.
 *
 * Business conditions (missing rule, unknown town, implausible route…) never
 * throw: they return { status: "manual_pricing", reasons }, which carries no
 * amounts. Only programmer errors (bad meta) throw.
 */

export class QuoteError extends Error {}

export type QuoteMeta = {
  quoteId: string;
  version: number;
  /** quoteId of the quote this one replaces, for re-quotes of the same request. */
  supersedes?: string | null;
  computedBy: "client" | "server";
  now: string;
  /** Server-side status for authoritative quotes; client quotes are always "estimate". */
  status?: Exclude<QuoteStatus, "estimate" | "superseded" | "expired">;
};

export type PriceQuoteArgs = {
  request: QuoteRequest;
  route: RouteLookup;
  tariff: ServiceTariff | null;
  config: PricingEngineConfig;
  meta: QuoteMeta;
  /** Driver-specific base; when omitted the config's default base is used. */
  driver?: QuoteDriver | null;
  /** Tests only: allow tariffs marked `fixture: true`. Never set in application code. */
  allowFixtures?: boolean;
};

/** Charge codes that would smuggle fuel or charging into the service price. */
const ENERGY_CODE = /fuel|petrol|diesel|gas|lpg|cng|charg|electric|energy|kwh|საწვავ|ბენზინ|დიზელ|დატენვ/i;

function tariffIssues(t: ServiceTariff): string[] {
  const issues: string[] = [];
  const okMoney = (m: Money) => m.currency === "GEL" && Number.isSafeInteger(m.amountMinor) && m.amountMinor >= 0;
  if (t.currency !== "GEL") issues.push("currency");
  if (!okMoney(t.baseFee)) issues.push("baseFee");
  if (!okMoney(t.minimumFee)) issues.push("minimumFee");
  if (!Number.isFinite(t.perKmMinor) || t.perKmMinor < 0) issues.push("perKmMinor");
  if (!Number.isFinite(t.travelTimePerHourMinor) || t.travelTimePerHourMinor < 0) issues.push("travelTimePerHourMinor");
  return issues;
}

function overrideIssues(o: TravelOverride): string | null {
  if (o.fare.currency !== "GEL" || !Number.isSafeInteger(o.fare.amountMinor) || o.fare.amountMinor < 0) return "fare";
  if (!Number.isFinite(o.travelMinutes) || o.travelMinutes < 0) return "travelMinutes";
  if (!o.reason.trim() || !o.by.trim()) return "reason and author are required";
  return null;
}

type Leg = { source: string; fare: Money; travelMinutes: number };

function resolveLeg(
  rules: readonly TravelRule[],
  from: ZoneMatch | null,
  to: ZoneMatch | null,
  override: TravelOverride | undefined,
): Leg | "missing" | "unresolved" {
  if (override) return { source: "override", fare: override.fare, travelMinutes: override.travelMinutes };
  if (!from || !to) return "unresolved";
  const rule = findTravelRule(rules, from, to);
  return rule ? { source: rule.id, fare: rule.fare, travelMinutes: rule.travelMinutes } : "missing";
}

/** Fare plus the driver's travel time at the tariff's travel rate — counted once per leg. */
function legCost(leg: Leg, tariff: ServiceTariff): Money {
  return money(leg.fare.amountMinor + Math.round((leg.travelMinutes * tariff.travelTimePerHourMinor) / 60));
}

export async function priceQuote(args: PriceQuoteArgs): Promise<QuoteOutcome> {
  const { request, route, tariff, config, meta } = args;
  if (!Number.isInteger(meta.version) || meta.version < 1) throw new QuoteError("Quote version must be a positive integer");
  if (Number.isNaN(Date.parse(meta.now))) throw new QuoteError(`Invalid now: ${meta.now}`);

  const inputFingerprint = await fingerprintQuoteInputs(request);
  const reasons: ManualReason[] = [];
  const manual = (): QuoteOutcome => ({
    status: "manual_pricing",
    requestId: request.requestId,
    inputFingerprint,
    computedAt: meta.now,
    reasons: Object.freeze(reasons.map((r) => Object.freeze({ ...r }))),
  });

  // 1. Configuration — a broken config must never produce a price.
  const configIssues = validatePricingConfig(config);
  if (configIssues.length > 0) {
    reasons.push({ code: "invalidConfig", detail: configIssues.join("; ") });
    return manual();
  }

  // 2. Tariff
  if (!tariff) reasons.push({ code: "missingTariff" });
  else if (tariff.status !== "active") reasons.push({ code: "tariffNotActive", detail: tariff.status });
  else if (tariff.fixture && !args.allowFixtures) reasons.push({ code: "fixtureTariffNotAllowed", detail: tariff.id });
  else {
    const issues = tariffIssues(tariff);
    if (issues.length > 0) reasons.push({ code: "invalidTariff", detail: issues.join(", ") });
  }

  // 3. Base and zones — the base comes from configuration or the driver, never from code.
  const baseDef = args.driver?.base ?? config.base;
  const base = matchLocality(config.zones, baseDef.locality);
  if (!base || base.zoneId !== baseDef.zoneId) {
    reasons.push({ code: "invalidDriverBase", detail: `${args.driver?.id ?? "default"}: ${baseDef.locality} / ${baseDef.zoneId}` });
  }
  const pickupZone = matchLocality(config.zones, request.pickup.locality);
  const deliveryZone = matchLocality(config.zones, request.delivery.locality);
  if (!pickupZone) reasons.push({ code: "unknownPickupLocality", detail: request.pickup.locality });
  if (!deliveryZone) reasons.push({ code: "unknownDeliveryLocality", detail: request.delivery.locality });

  // 4. Route — never substituted when unavailable.
  if (!route.ok) reasons.push({ code: "routeUnavailable", detail: route.reason });
  else reasons.push(...checkRoutePlausibility(route.route, request.pickup, request.delivery, config.plausibility));

  // 5. Travel legs — a missing rule is a manual-pricing reason, never a zero cost.
  for (const [leg, o] of Object.entries(request.overrides ?? {}) as [string, TravelOverride][]) {
    const issue = overrideIssues(o);
    if (issue) reasons.push({ code: "invalidOverride", detail: `${leg}: ${issue}` });
  }
  const positioning = resolveLeg(config.travelRules, base, pickupZone, request.overrides?.positioning);
  const ret = resolveLeg(config.travelRules, deliveryZone, base, request.overrides?.return);
  if (positioning === "missing") reasons.push({ code: "missingPositioningRule", detail: `${baseDef.zoneId} → ${pickupZone?.zoneId}` });
  if (ret === "missing") reasons.push({ code: "missingReturnRule", detail: `${deliveryZone?.zoneId} → ${baseDef.zoneId}` });

  // 6. Extras — explicit, unique, GEL, and never fuel or charging.
  const codes = new Set<string>();
  for (const charge of request.extras ?? []) {
    const m = charge.amount;
    if (!charge.code || codes.has(charge.code)) reasons.push({ code: "invalidExtras", detail: `duplicate or empty code "${charge.code}"` });
    else if (ENERGY_CODE.test(charge.code) || ENERGY_CODE.test(charge.label)) {
      reasons.push({ code: "invalidExtras", detail: `"${charge.code}": fuel and charging are never part of the service price` });
    } else if (m.currency !== "GEL" || !Number.isSafeInteger(m.amountMinor) || m.amountMinor < 0) {
      reasons.push({ code: "invalidExtras", detail: `"${charge.code}": amount must be non-negative GEL in whole tetri` });
    }
    codes.add(charge.code);
  }

  // 7. Overnight eligibility — only when configured; no allowance is ever computed.
  let overnight: OvernightCheck = { status: "not_checked" };
  let commitmentMinutes: number | null = null;
  if (config.overnight.mode === "manualReviewAbove" && route.ok && typeof positioning === "object" && typeof ret === "object") {
    commitmentMinutes = positioning.travelMinutes + config.overnight.handoverMinutes + route.route.durationMinutes + ret.travelMinutes;
    if (commitmentMinutes > config.overnight.maxSameDayMinutes) {
      reasons.push({ code: "overnightRequired", detail: `${Math.round(commitmentMinutes)} > ${config.overnight.maxSameDayMinutes} min` });
    } else {
      overnight = { status: "within_limit", limitMinutes: config.overnight.maxSameDayMinutes };
    }
  }

  if (reasons.length > 0 || !tariff || !route.ok || typeof positioning !== "object" || typeof ret !== "object" || !base || !pickupZone || !deliveryZone) {
    return manual();
  }

  // 8. Price — integer tetri throughout.
  const lines: CommercialLine[] = [];
  const distance = money(Math.round(route.route.distanceKm * tariff.perKmMinor));
  lines.push({ kind: "baseFee", code: "baseFee", amount: tariff.baseFee });
  lines.push({ kind: "distance", code: "distance", amount: distance });

  const drivingSubtotal = sumMoney([tariff.baseFee, distance]);
  const minimumApplied = drivingSubtotal.amountMinor < tariff.minimumFee.amountMinor;
  const drivingTotal = minimumApplied ? tariff.minimumFee : drivingSubtotal;
  if (minimumApplied) {
    lines.push({ kind: "minimumAdjustment", code: "minimumAdjustment", amount: money(tariff.minimumFee.amountMinor - drivingSubtotal.amountMinor) });
  }

  const positioningCost = legCost(positioning, tariff);
  const returnCost = legCost(ret, tariff);
  lines.push({ kind: "positioning", code: "positioning", amount: positioningCost, source: positioning.source, travelMinutes: positioning.travelMinutes });
  lines.push({ kind: "return", code: "return", amount: returnCost, source: ret.source, travelMinutes: ret.travelMinutes });

  for (const charge of request.extras ?? []) lines.push({ kind: "additional", code: charge.code, amount: charge.amount });

  const beforeRounding = sumMoney(lines.map((l) => l.amount));
  const rounded = roundUpMinor(beforeRounding.amountMinor, config.roundingStepMinor);
  const roundingAdjustment = money(rounded - beforeRounding.amountMinor);
  if (roundingAdjustment.amountMinor > 0) lines.push({ kind: "rounding", code: "rounding", amount: roundingAdjustment });

  const server = meta.computedBy === "server";
  const quote: ServiceQuote = {
    quoteId: meta.quoteId,
    requestId: request.requestId,
    version: meta.version,
    supersedes: meta.supersedes ?? null,
    supersededBy: null,
    status: server ? (meta.status ?? "pending_review") : "estimate",
    computedBy: meta.computedBy,
    authoritative: server,
    computedAt: meta.now,
    validUntil: quoteExpiry(meta.now, config.quoteValidityHours),
    inputFingerprint,
    commercial: {
      currency: "GEL",
      tariffId: tariff.id,
      tariffVersion: tariff.version,
      driverId: args.driver?.id ?? null,
      zones: { base: base.zoneId, pickup: pickupZone.zoneId, delivery: deliveryZone.zoneId },
      lines,
      drivingSubtotal,
      drivingTotal,
      minimumApplied,
      travelTotal: sumMoney([positioningCost, returnCost]),
      roundingAdjustment,
      total: money(rounded),
      excludes: ["fuel", "charging"],
      overnight,
    },
    providerDerived: { route: { ...route.route }, commitmentMinutes, retention: "provider_restricted" },
  };
  return { status: "quoted", quote: deepFreeze(quote) };
}

/* -------------------------------------------------------------- lifecycle */

export type UsabilityCheck = { usable: true } | { usable: false; reason: "expired" | "inputsChanged" | "superseded" | "notAuthoritative" };

/**
 * Whether a quote may back a booking request right now. The caller passes the
 * fingerprint of the inputs being submitted; any mismatch means re-quote.
 */
export function checkQuoteUsable(quote: ServiceQuote, current: { now: string; inputFingerprint: string }): UsabilityCheck {
  if (quote.status === "superseded" || quote.supersededBy) return { usable: false, reason: "superseded" };
  if (!quote.authoritative) return { usable: false, reason: "notAuthoritative" };
  if (Date.parse(current.now) >= Date.parse(quote.validUntil)) return { usable: false, reason: "expired" };
  if (quote.inputFingerprint !== current.inputFingerprint) return { usable: false, reason: "inputsChanged" };
  return { usable: true };
}

/** Marks `previous` as replaced by `replacement`. Both stay immutable; a new copy is returned. */
export function supersedeQuote(previous: ServiceQuote, replacement: ServiceQuote): ServiceQuote {
  if (previous.supersededBy) throw new QuoteError(`Quote ${previous.quoteId} is already superseded`);
  if (replacement.requestId !== previous.requestId) throw new QuoteError("Replacement belongs to a different request");
  if (replacement.version !== previous.version + 1) throw new QuoteError("Replacement must be the next version");
  if (replacement.supersedes !== previous.quoteId) throw new QuoteError("Replacement must reference the quote it supersedes");
  return deepFreeze({ ...structuredClone(previous), status: "superseded", supersededBy: replacement.quoteId });
}

/**
 * Returns a copy without provider-derived route data, for long-term storage once
 * the provider's retention window ends (docs/google-maps-data-retention.md).
 */
export function stripProviderDerived(quote: ServiceQuote): ServiceQuote {
  return deepFreeze({ ...structuredClone(quote), providerDerived: null });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}
