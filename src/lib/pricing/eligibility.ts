import { POWERTRAINS, TRANSMISSIONS } from "../booking/types.ts";
import { checkRoutePlausibility } from "./checks.ts";
import type {
  PricingEngineConfig,
  QuoteDriver,
  QuoteRequest,
  RouteLookup,
  ServiceTariff,
  TransportAvailability,
  TravelRule,
} from "./engine-types.ts";
import { findTravelRule, matchLocality, validatePricingConfig } from "./zones.ts";

/**
 * Automatic-pricing eligibility gate.
 *
 * Decides whether a request MAY receive an automatic price, independently of
 * computing one. Everything must be explicitly enabled and approved; anything
 * unknown, unverified, stale or unapproved fails safe to manual assessment.
 * Booking approval stays manual either way.
 *
 * Geography lives only in configuration (zones, pilot routes, travel rules);
 * this module contains no place names.
 */

/* ------------------------------------------------------------- approvals */

/** Separates founder-approved settings from research assumptions. */
export type Approval =
  | { status: "approved"; approvedBy: string; approvedAt: string; reference?: string }
  | { status: "proposed"; note: string };

const isApproved = (a: Approval | null | undefined): boolean =>
  !!a && a.status === "approved" && !!a.approvedBy.trim() && !Number.isNaN(Date.parse(a.approvedAt));

/* ---------------------------------------------------------------- policy */

/** How a working day is planned. All values are business decisions. */
export type OperatingPolicy = {
  approval: Approval;
  /** Whole commitment: positioning + handovers + driving + breaks + waiting + return. */
  maxTotalMinutes: number;
  maxDrivingMinutes: number;
  /** A break is required before driving continuously longer than this. */
  maxContinuousDrivingMinutes: number;
  breakMinutes: number;
  pickupHandoverMinutes: number;
  deliveryHandoverMinutes: number;
  /** No customer-vehicle drive may start after this local time; null = no limit. */
  latestDriveStart: string | null;
};

export type PilotRoute = {
  id: string;
  /** Pickup zone → delivery zone. Directions are separate entries. */
  fromZoneId: string;
  toZoneId: string;
  automaticPricingEnabled: boolean;
  approval: Approval;
};

export type AutomaticPricingPolicy = {
  version: string;
  /** Master switch for automatic pricing. */
  automaticPricingEnabled: boolean;
  masterApproval: Approval;
  pilotRoutes: readonly PilotRoute[];
  tariffApproval: { tariffId: string; tariffVersion: number; approval: Approval } | null;
  configApproval: { configVersion: string; approval: Approval } | null;
  operating: OperatingPolicy | null;
  /** Travel-rule evidence older than this is stale. */
  evidenceMaxAgeDays: { value: number; approval: Approval } | null;
};

/* ---------------------------------------------------------------- result */

export type EligibilityReasonCode =
  | "automaticPricingDisabled"
  | "masterSwitchNotApproved"
  | "noPricingConfiguration"
  | "invalidConfig"
  | "configNotApproved"
  | "tariffMissing"
  | "tariffNotApproved"
  | "testDataNotAllowed"
  | "operatingPolicyMissing"
  | "operatingPolicyNotApproved"
  | "invalidOperatingPolicy"
  | "overnightPolicyMissing"
  | "evidencePolicyMissing"
  | "evidencePolicyNotApproved"
  | "vehicleNotEligible"
  | "extrasRequireManualReview"
  | "adminOverride"
  | "unknownLocality"
  | "invalidDriverBase"
  | "routeNotInPilot"
  | "pilotRouteDisabled"
  | "pilotRouteNotApproved"
  | "missingPositioningRule"
  | "missingReturnRule"
  | "travelRuleUnverified"
  | "travelRuleEvidenceStale"
  | "positioningDepartureUnknown"
  | "positioningDepartureUnavailable"
  | "returnDepartureUnknown"
  | "returnDepartureUnavailable"
  | "routeUnavailable"
  | "routeImplausible"
  | "invalidSchedule"
  | "driveStartTooLate"
  | "drivingExceedsLimit"
  | "dayExceedsLimit"
  | "overnightRequired";

export type EligibilityReason = { code: EligibilityReasonCode; detail?: string };

/** Planned working day, in minutes after local midnight of the pickup date. */
export type PlannedSchedule = {
  positioningStart: number;
  pickupAt: number;
  driveStart: number;
  driveEnd: number;
  deliveryDone: number;
  returnBoarding: number;
  end: number;
  minutes: {
    positioning: number;
    handover: number;
    driving: number;
    breaks: number;
    waiting: number;
    returnTravel: number;
    total: number;
  };
};

export type OverrideAudit = { leg: "positioning" | "return"; by: string; reason: string; fareMinor: number; travelMinutes: number };

export type EligibilityResult = {
  eligible: boolean;
  reasons: readonly EligibilityReason[];
  schedule: PlannedSchedule | null;
  /** Every admin override on the request, for the audit log. Overrides always need manual review. */
  overrides: readonly OverrideAudit[];
  policyVersion: string;
  /**
   * Customer-safe status. Neither value claims that a price is automatic:
   * eligible requests are still reviewed manually before acceptance.
   */
  customerStatus: "under_review" | "manual_assessment";
};

export type EligibilityArgs = {
  request: QuoteRequest;
  /** null = not computed yet (e.g. gate failed earlier); no route reasons are added. */
  route: RouteLookup | null;
  tariff: ServiceTariff | null;
  config: PricingEngineConfig | null;
  driver?: QuoteDriver | null;
  policy: AutomaticPricingPolicy;
  /** Server time (ISO). */
  now: string;
  /** Tests only. Ignored in production. */
  allowFixtures?: boolean;
};

/* --------------------------------------------------------------- helpers */

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMinutes = (t: string): number | null => {
  const m = HHMM.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const isProductionRuntime = () => globalThis.process?.env?.NODE_ENV === "production";
const DAY = 24 * 60;

function operatingIssues(o: OperatingPolicy): string[] {
  const issues: string[] = [];
  const positive = { maxTotalMinutes: o.maxTotalMinutes, maxDrivingMinutes: o.maxDrivingMinutes, maxContinuousDrivingMinutes: o.maxContinuousDrivingMinutes };
  for (const [k, v] of Object.entries(positive)) if (!Number.isFinite(v) || v <= 0) issues.push(k);
  for (const [k, v] of Object.entries({ breakMinutes: o.breakMinutes, pickupHandoverMinutes: o.pickupHandoverMinutes, deliveryHandoverMinutes: o.deliveryHandoverMinutes })) {
    if (!Number.isFinite(v) || v < 0) issues.push(k);
  }
  if (o.latestDriveStart !== null && toMinutes(o.latestDriveStart) === null) issues.push("latestDriveStart");
  return issues;
}

/** Plans boarding for a leg that must END by `arriveBy` (positioning). */
function planArrivingLeg(rule: TravelRule, arriveBy: number, date: string): { start: number; waiting: number } | "unknown" | "unavailable" {
  const a: TransportAvailability | undefined = rule.availability;
  if (!a || a.kind === "unknown") return "unknown";
  const ride = rule.travelMinutes - a.accessMinutes;
  if (a.kind === "frequent") {
    const start = arriveBy - rule.travelMinutes;
    const boarding = start + a.accessMinutes;
    const first = toMinutes(a.firstDeparture)!;
    const last = toMinutes(a.lastDeparture)!;
    if (boarding < first || boarding > last) return "unavailable";
    return { start, waiting: 0 };
  }
  if (date < a.validFrom || date > a.validTo) return "unknown";
  const usable = a.departures.map((d) => toMinutes(d)!).filter((d) => d + ride <= arriveBy);
  if (usable.length === 0) return "unavailable";
  const departure = Math.max(...usable);
  return { start: departure - a.accessMinutes, waiting: arriveBy - (departure + ride) };
}

/** Plans boarding for a leg that may START at `readyAt` (return). */
function planDepartingLeg(rule: TravelRule, readyAt: number, date: string): { boarding: number; waiting: number } | "unknown" | "unavailable" {
  const a: TransportAvailability | undefined = rule.availability;
  if (!a || a.kind === "unknown") return "unknown";
  const atStop = readyAt + a.accessMinutes;
  if (a.kind === "frequent") {
    const first = toMinutes(a.firstDeparture)!;
    const last = toMinutes(a.lastDeparture)!;
    if (atStop > last) return "unavailable";
    const boarding = Math.max(atStop, first);
    return { boarding, waiting: boarding - atStop };
  }
  if (date < a.validFrom || date > a.validTo) return "unknown";
  const next = a.departures.map((d) => toMinutes(d)!).filter((d) => d >= atStop);
  if (next.length === 0) return "unavailable";
  const boarding = Math.min(...next);
  return { boarding, waiting: boarding - atStop };
}

/* ------------------------------------------------------------- evaluator */

export function evaluateAutomaticPricingEligibility(args: EligibilityArgs): EligibilityResult {
  const { request, route, tariff, config, policy } = args;
  const reasons: EligibilityReason[] = [];
  const add = (code: EligibilityReasonCode, detail?: string) => reasons.push(detail ? { code, detail } : { code });
  const nowMs = Date.parse(args.now);

  // Overrides are always recorded, and always require manual review.
  const overrides: OverrideAudit[] = [];
  for (const leg of ["positioning", "return"] as const) {
    const o = request.overrides?.[leg];
    if (o) overrides.push({ leg, by: o.by, reason: o.reason, fareMinor: o.fare.amountMinor, travelMinutes: o.travelMinutes });
  }

  // 1. Switches and approvals.
  if (!policy.automaticPricingEnabled) add("automaticPricingDisabled");
  else if (!isApproved(policy.masterApproval)) add("masterSwitchNotApproved");

  if (!config) add("noPricingConfiguration");
  else {
    const issues = validatePricingConfig(config);
    if (issues.length > 0) add("invalidConfig", issues.join("; "));
    if (!policy.configApproval || policy.configApproval.configVersion !== config.version || !isApproved(policy.configApproval.approval)) {
      add("configNotApproved", config.version);
    }
    if (config.overnight.mode === "notConfigured") add("overnightPolicyMissing");
  }

  if (!tariff) add("tariffMissing");
  else {
    const ta = policy.tariffApproval;
    if (tariff.status !== "active" || !ta || ta.tariffId !== tariff.id || ta.tariffVersion !== tariff.version || !isApproved(ta.approval)) {
      add("tariffNotApproved", `${tariff.id}@${tariff.version}`);
    }
  }
  if ((tariff?.fixture || config?.fixture) && (!args.allowFixtures || isProductionRuntime())) add("testDataNotAllowed");

  const op = policy.operating;
  if (!op) add("operatingPolicyMissing");
  else if (!isApproved(op.approval)) add("operatingPolicyNotApproved");
  else {
    const issues = operatingIssues(op);
    if (issues.length > 0) add("invalidOperatingPolicy", issues.join(", "));
  }

  const ev = policy.evidenceMaxAgeDays;
  if (!ev) add("evidencePolicyMissing");
  else if (!isApproved(ev.approval) || !(ev.value > 0)) add("evidencePolicyNotApproved");

  // 2. Request content that always needs a person.
  const v = request.vehicle;
  if (!v?.drivableConfirmed || !(POWERTRAINS as readonly string[]).includes(v.powertrain) || !(TRANSMISSIONS as readonly string[]).includes(v.transmission)) {
    add("vehicleNotEligible");
  }
  if ((request.extras ?? []).length > 0) add("extrasRequireManualReview");
  if (overrides.length > 0) add("adminOverride", overrides.map((o) => `${o.leg} by ${o.by}`).join(", "));

  // 3. Zones and pilot routes (geography from configuration only).
  let rules: { positioning: TravelRule | null; ret: TravelRule | null } = { positioning: null, ret: null };
  if (config) {
    const baseDef = args.driver?.base ?? config.base;
    const base = matchLocality(config.zones, baseDef.locality);
    if (!base || base.zoneId !== baseDef.zoneId) add("invalidDriverBase", baseDef.zoneId);
    const pickup = matchLocality(config.zones, request.pickup.locality);
    const delivery = matchLocality(config.zones, request.delivery.locality);
    if (!pickup || !delivery) add("unknownLocality", [!pickup && request.pickup.locality, !delivery && request.delivery.locality].filter(Boolean).join(", "));

    if (pickup && delivery) {
      const pilot = policy.pilotRoutes.find((p) => p.fromZoneId === pickup.zoneId && p.toZoneId === delivery.zoneId);
      if (!pilot) add("routeNotInPilot", `${pickup.zoneId} → ${delivery.zoneId}`);
      else if (!pilot.automaticPricingEnabled) add("pilotRouteDisabled", pilot.id);
      else if (!isApproved(pilot.approval)) add("pilotRouteNotApproved", pilot.id);
    }

    // Direction-specific travel rules with verified, fresh evidence.
    if (base && pickup && delivery) {
      rules = { positioning: findTravelRule(config.travelRules, base, pickup), ret: findTravelRule(config.travelRules, delivery, base) };
      if (!rules.positioning) add("missingPositioningRule", `${base.zoneId} → ${pickup.zoneId}`);
      if (!rules.ret) add("missingReturnRule", `${delivery.zoneId} → ${base.zoneId}`);
      // Same rule for both legs (e.g. local jobs) is checked once.
      for (const rule of new Set([rules.positioning, rules.ret])) {
        if (!rule) continue;
        const verified = rule.evidence ? Date.parse(rule.evidence.verifiedAt) : Number.NaN;
        if (!rule.evidence || Number.isNaN(verified) || verified > nowMs) add("travelRuleUnverified", rule.id);
        else if (ev && ev.value > 0 && nowMs - verified > ev.value * 86_400_000) add("travelRuleEvidenceStale", rule.id);
      }
    }
  }

  // 4. Route from the provider (skipped when not computed). Only a plausible route is scheduled.
  let plausibleRoute = false;
  if (route && !route.ok) add("routeUnavailable", route.error.kind);
  else if (route && config) {
    const implausible = checkRoutePlausibility(route.route, request.pickup, request.delivery, config.plausibility);
    if (implausible.length > 0) add("routeImplausible", implausible.map((r) => r.code).join(", "));
    else plausibleRoute = true;
  }

  // 5. Working-day schedule — only when every input is known.
  let schedule: PlannedSchedule | null = null;
  const pickupAt = toMinutes(request.schedule.time);
  if (pickupAt === null) add("invalidSchedule", request.schedule.time);
  else if (op && isApproved(op.approval) && operatingIssues(op).length === 0 && plausibleRoute && route?.ok && rules.positioning && rules.ret) {
    const date = request.schedule.date;
    const pos = planArrivingLeg(rules.positioning, pickupAt, date);
    if (pos === "unknown") add("positioningDepartureUnknown", rules.positioning.id);
    else if (pos === "unavailable") add("positioningDepartureUnavailable", rules.positioning.id);

    const driveStart = pickupAt + op.pickupHandoverMinutes;
    if (op.latestDriveStart !== null && driveStart > toMinutes(op.latestDriveStart)!) add("driveStartTooLate");

    const driving = route.route.durationMinutes;
    if (driving > op.maxDrivingMinutes) add("drivingExceedsLimit", `${Math.round(driving)} > ${op.maxDrivingMinutes} min`);
    const breaks = driving > op.maxContinuousDrivingMinutes ? (Math.ceil(driving / op.maxContinuousDrivingMinutes) - 1) * op.breakMinutes : 0;
    const driveEnd = driveStart + driving + breaks;
    const deliveryDone = driveEnd + op.deliveryHandoverMinutes;

    const ret = planDepartingLeg(rules.ret, deliveryDone, date);
    if (ret === "unknown") add("returnDepartureUnknown", rules.ret.id);
    else if (ret === "unavailable") add("returnDepartureUnavailable", rules.ret.id);

    if (typeof pos === "object" && typeof ret === "object") {
      const accessMinutes = rules.ret.availability && rules.ret.availability.kind !== "unknown" ? rules.ret.availability.accessMinutes : 0;
      const end = ret.boarding + (rules.ret.travelMinutes - accessMinutes);
      const total = end - pos.start;
      schedule = {
        positioningStart: pos.start,
        pickupAt,
        driveStart,
        driveEnd,
        deliveryDone,
        returnBoarding: ret.boarding,
        end,
        minutes: {
          positioning: rules.positioning.travelMinutes,
          handover: op.pickupHandoverMinutes + op.deliveryHandoverMinutes,
          driving,
          breaks,
          waiting: pos.waiting + ret.waiting,
          returnTravel: rules.ret.travelMinutes,
          total,
        },
      };
      if (pos.start < 0 || end > DAY) add("overnightRequired", "schedule crosses midnight");
      if (total > op.maxTotalMinutes) add("dayExceedsLimit", `${Math.round(total)} > ${op.maxTotalMinutes} min`);
      if (config?.overnight.mode === "manualReviewAbove" && total > config.overnight.maxSameDayMinutes) {
        add("overnightRequired", `${Math.round(total)} > ${config.overnight.maxSameDayMinutes} min`);
      }
    }
  }

  const eligible = reasons.length === 0;
  return Object.freeze({
    eligible,
    reasons: Object.freeze(reasons),
    schedule,
    overrides: Object.freeze(overrides),
    policyVersion: policy.version,
    customerStatus: eligible ? "under_review" : "manual_assessment",
  });
}
