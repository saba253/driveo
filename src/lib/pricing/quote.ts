import { checkRoutePlausibility } from "./checks.ts";
import { quoteExpiry, roundUpMinor } from "./config.ts";
import { POWERTRAINS, TRANSMISSIONS } from "../booking/types.ts";
import {
  ENERGY_EXTRA_CATEGORIES,
  SERVICE_EXTRA_CATEGORIES,
  type CommercialLine,
  type ManualReason,
  type OvernightCheck,
  type QuoteDriver,
  type PricingEngineConfig,
  type QuoteOutcome,
  type QuoteRequest,
  type RouteLookup,
  type ServiceQuote,
  type ServiceTariff,
  type TravelOverride,
  type TravelRule,
} from "./engine-types.ts";
import { fingerprintQuoteInputs, type PricingContext } from "./fingerprint.ts";
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
  /** Total of the replaced quote; required with `supersedes` so price changes are detected. */
  previousTotal?: Money | null;
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
  /**
   * Tests only: allow tariffs marked `fixture: true`. Ignored in production
   * builds, and lint forbids importing fixtures outside *.test.ts files.
   */
  allowFixtures?: boolean;
};

/** The context a quote is priced in; callers use it to recompute fingerprints before booking. */
export function pricingContext(tariff: ServiceTariff | null, config: PricingEngineConfig, driver?: QuoteDriver | null): PricingContext {
  return {
    tariff: tariff ? { id: tariff.id, version: tariff.version } : null,
    configVersion: config.version,
    driverId: driver?.id ?? null,
    base: driver?.base ?? config.base,
  };
}

const isProductionRuntime = () => globalThis.process?.env?.NODE_ENV === "production";

/**
 * Secondary guard on extra codes and labels. The primary guard is the explicit
 * category allow-list (SERVICE_EXTRA_CATEGORIES).
 */
const ENERGY_TEXT = /fuel|petrol|diesel|gas|lpg|cng|charg|electric|energy|kwh|საწვავ|ბენზინ|დიზელ|დატენვ/i;

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
  if (meta.supersedes && !meta.previousTotal) throw new QuoteError("A re-quote must carry the previous total");

  const baseDef = args.driver?.base ?? config.base;
  const inputFingerprint = await fingerprintQuoteInputs(request, pricingContext(tariff, config, args.driver));
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

  if (config.fixture && (!args.allowFixtures || isProductionRuntime())) {
    reasons.push({ code: "fixtureConfigNotAllowed", detail: config.version });
  }

  // 2. Tariff
  if (!tariff) reasons.push({ code: "missingTariff" });
  else if (tariff.status !== "active") reasons.push({ code: "tariffNotActive", detail: tariff.status });
  else if (tariff.fixture && (!args.allowFixtures || isProductionRuntime())) {
    reasons.push({ code: "fixtureTariffNotAllowed", detail: tariff.id });
  }
  else {
    const issues = tariffIssues(tariff);
    if (issues.length > 0) reasons.push({ code: "invalidTariff", detail: issues.join(", ") });
  }

  // 3. Base and zones — the base comes from configuration or the driver, never from code.
  const base = matchLocality(config.zones, baseDef.locality);
  if (!base || base.zoneId !== baseDef.zoneId) {
    reasons.push({ code: "invalidDriverBase", detail: `${args.driver?.id ?? "default"}: ${baseDef.locality} / ${baseDef.zoneId}` });
  }
  const pickupZone = matchLocality(config.zones, request.pickup.locality);
  const deliveryZone = matchLocality(config.zones, request.delivery.locality);
  if (!pickupZone) reasons.push({ code: "unknownPickupLocality", detail: request.pickup.locality });
  if (!deliveryZone) reasons.push({ code: "unknownDeliveryLocality", detail: request.delivery.locality });

  // 4. Vehicle — only drivable vehicles of known types can be priced automatically.
  const v = request.vehicle;
  if (!v || v.drivableConfirmed !== true) reasons.push({ code: "vehicleNotEligible", detail: "drivable confirmation missing" });
  else if (!(POWERTRAINS as readonly string[]).includes(v.powertrain) || !(TRANSMISSIONS as readonly string[]).includes(v.transmission)) {
    reasons.push({ code: "vehicleNotEligible", detail: "unknown powertrain or transmission" });
  }

  // 5. Route — never substituted when unavailable.
  if (!route.ok) reasons.push({ code: "routeUnavailable", detail: route.error.kind });
  else reasons.push(...checkRoutePlausibility(route.route, request.pickup, request.delivery, config.plausibility));

  // 6. Travel legs — a missing rule is a manual-pricing reason, never a zero cost.
  for (const [leg, o] of Object.entries(request.overrides ?? {}) as [string, TravelOverride][]) {
    const issue = overrideIssues(o);
    if (issue) reasons.push({ code: "invalidOverride", detail: `${leg}: ${issue}` });
  }
  const positioning = resolveLeg(config.travelRules, base, pickupZone, request.overrides?.positioning);
  const ret = resolveLeg(config.travelRules, deliveryZone, base, request.overrides?.return);
  if (positioning === "missing") reasons.push({ code: "missingPositioningRule", detail: `${baseDef.zoneId} → ${pickupZone?.zoneId}` });
  if (ret === "missing") reasons.push({ code: "missingReturnRule", detail: `${deliveryZone?.zoneId} → ${baseDef.zoneId}` });

  // 7. Extras — explicit allowed category, unique code, GEL, and never fuel or charging.
  const codes = new Set<string>();
  for (const charge of request.extras ?? []) {
    const m = charge.amount;
    const category = String(charge.category);
    if (!charge.code || codes.has(charge.code)) reasons.push({ code: "invalidExtras", detail: `duplicate or empty code "${charge.code}"` });
    else if ((ENERGY_EXTRA_CATEGORIES as readonly string[]).includes(category)) {
      reasons.push({ code: "invalidExtras", detail: `"${charge.code}": category "${category}" is never part of the service price` });
    } else if (!(SERVICE_EXTRA_CATEGORIES as readonly string[]).includes(category)) {
      reasons.push({ code: "invalidExtras", detail: `"${charge.code}": unknown category "${category}"` });
    } else if (ENERGY_TEXT.test(charge.code) || ENERGY_TEXT.test(charge.label)) {
      reasons.push({ code: "invalidExtras", detail: `"${charge.code}": looks like fuel or charging, which are never part of the service price` });
    } else if (m.currency !== "GEL" || !Number.isSafeInteger(m.amountMinor) || m.amountMinor < 0) {
      reasons.push({ code: "invalidExtras", detail: `"${charge.code}": amount must be non-negative GEL in whole tetri` });
    }
    codes.add(charge.code);
  }

  // 8. Overnight eligibility — an undecided policy blocks automatic pricing; no allowance is ever computed.
  let overnight: OvernightCheck | null = null;
  let commitmentMinutes: number | null = null;
  if (config.overnight.mode === "notConfigured") {
    reasons.push({ code: "overnightPolicyNotConfigured" });
  } else if (config.overnight.mode === "waived") {
    overnight = { status: "waived", approvedBy: config.overnight.approvedBy };
  } else if (route.ok && typeof positioning === "object" && typeof ret === "object") {
    commitmentMinutes = positioning.travelMinutes + config.overnight.handoverMinutes + route.route.durationMinutes + ret.travelMinutes;
    if (commitmentMinutes > config.overnight.maxSameDayMinutes) {
      reasons.push({ code: "overnightRequired", detail: `${Math.round(commitmentMinutes)} > ${config.overnight.maxSameDayMinutes} min` });
    } else {
      overnight = { status: "within_limit", limitMinutes: config.overnight.maxSameDayMinutes };
    }
  }

  if (
    reasons.length > 0 ||
    !tariff ||
    !route.ok ||
    !overnight ||
    typeof positioning !== "object" ||
    typeof ret !== "object" ||
    !base ||
    !pickupZone ||
    !deliveryZone
  ) {
    return manual();
  }

  // 9. Price — integer tetri throughout.
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
    priceChange:
      meta.supersedes && meta.previousTotal
        ? { previousQuoteId: meta.supersedes, previousTotal: meta.previousTotal, changed: meta.previousTotal.amountMinor !== rounded }
        : null,
    commercial: {
      currency: "GEL",
      tariffId: tariff.id,
      tariffVersion: tariff.version,
      configVersion: config.version,
      testData: Boolean(tariff.fixture || config.fixture),
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
