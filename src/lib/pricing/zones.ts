import type { PricingEngineConfig, TravelRule, TravelZone } from "./engine-types.ts";

/**
 * Locality → zone matching. Names arrive in Georgian or Latin script, with or
 * without a "city" prefix, and in any case; all are normalized before matching.
 */
export function normalizeLocality(name: string): string {
  return (
    name
      .normalize("NFC")
      // Mtavruli (Georgian capitals) and Latin capitals → lower case.
      .toLocaleLowerCase("ka")
      .replace(/[.,;:"'()«»„“”]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      // "ქ. <name>", "ქალაქი <name>", "city of <name>", "<name> city"
      .replace(/^(ქ|ქალაქი|city of|city)\s+/u, "")
      .replace(/\s+city$/u, "")
      .trim()
  );
}

export type ZoneMatch = { zoneId: string; locality: string };

/** Returns the zone for a locality, or null when it is not configured (→ manual pricing). */
export function matchLocality(zones: readonly TravelZone[], locality: string): ZoneMatch | null {
  const key = normalizeLocality(locality);
  if (!key) return null;
  for (const zone of zones) {
    if (zone.localities.some((l) => normalizeLocality(l) === key)) return { zoneId: zone.id, locality: key };
  }
  return null;
}

/** Specificity of a rule: locality-narrowed sides beat zone-wide ones. */
function specificity(rule: TravelRule): number {
  return (rule.fromLocality ? 1 : 0) + (rule.toLocality ? 1 : 0);
}

/**
 * Finds the most specific rule for a directional leg. Returns null when none
 * applies — callers must turn that into manual pricing, never a zero cost.
 */
export function findTravelRule(rules: readonly TravelRule[], from: ZoneMatch, to: ZoneMatch): TravelRule | null {
  const candidates = rules.filter(
    (r) =>
      r.fromZoneId === from.zoneId &&
      r.toZoneId === to.zoneId &&
      (!r.fromLocality || normalizeLocality(r.fromLocality) === from.locality) &&
      (!r.toLocality || normalizeLocality(r.toLocality) === to.locality),
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, r) => (specificity(r) > specificity(best) ? r : best));
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const isNonNegativeMoney =(m: { amountMinor: number; currency: string }) =>
  m.currency === "GEL" && Number.isSafeInteger(m.amountMinor) && m.amountMinor >= 0;

/**
 * Structural validation of an engine configuration. Any issue makes the engine
 * return manual pricing, so a bad admin edit can never produce a wrong price.
 */
export function validatePricingConfig(config: PricingEngineConfig): string[] {
  const issues: string[] = [];

  if (!config.version?.trim()) issues.push("version is required");
  if (!Number.isFinite(config.quoteValidityHours) || config.quoteValidityHours <= 0) issues.push("quoteValidityHours must be > 0");
  if (config.roundingStepMinor !== null && (!Number.isSafeInteger(config.roundingStepMinor) || config.roundingStepMinor <= 0)) {
    issues.push("roundingStepMinor must be a positive integer or null");
  }

  // Zones and localities
  const zoneIds = new Set<string>();
  const localityOwner = new Map<string, string>();
  for (const zone of config.zones) {
    if (!zone.id || zoneIds.has(zone.id)) issues.push(`duplicate or empty zone id "${zone.id}"`);
    zoneIds.add(zone.id);
    if (zone.localities.length === 0) issues.push(`zone "${zone.id}" has no localities`);
    for (const raw of zone.localities) {
      const key = normalizeLocality(raw);
      if (!key) issues.push(`zone "${zone.id}" has an empty locality`);
      const owner = localityOwner.get(key);
      if (owner && owner !== zone.id) issues.push(`locality "${raw}" is in both "${owner}" and "${zone.id}"`);
      localityOwner.set(key, zone.id);
    }
  }

  const base = matchLocality(config.zones, config.base.locality);
  if (!zoneIds.has(config.base.zoneId)) issues.push(`base zone "${config.base.zoneId}" does not exist`);
  else if (!base || base.zoneId !== config.base.zoneId) issues.push(`base locality "${config.base.locality}" is not in zone "${config.base.zoneId}"`);

  // Travel rules
  const ruleIds = new Set<string>();
  const ruleKeys = new Set<string>();
  for (const rule of config.travelRules) {
    if (!rule.id || ruleIds.has(rule.id)) issues.push(`duplicate or empty travel rule id "${rule.id}"`);
    ruleIds.add(rule.id);
    if (!zoneIds.has(rule.fromZoneId)) issues.push(`rule "${rule.id}": unknown fromZoneId "${rule.fromZoneId}"`);
    if (!zoneIds.has(rule.toZoneId)) issues.push(`rule "${rule.id}": unknown toZoneId "${rule.toZoneId}"`);
    if (rule.fromLocality && localityOwner.get(normalizeLocality(rule.fromLocality)) !== rule.fromZoneId) {
      issues.push(`rule "${rule.id}": fromLocality is not in zone "${rule.fromZoneId}"`);
    }
    if (rule.toLocality && localityOwner.get(normalizeLocality(rule.toLocality)) !== rule.toZoneId) {
      issues.push(`rule "${rule.id}": toLocality is not in zone "${rule.toZoneId}"`);
    }
    if (!isNonNegativeMoney(rule.fare)) issues.push(`rule "${rule.id}": fare must be non-negative GEL in whole tetri`);
    if (!Number.isFinite(rule.travelMinutes) || rule.travelMinutes < 0) issues.push(`rule "${rule.id}": travelMinutes must be >= 0`);
    if (rule.mode === "none" && (rule.fare.amountMinor !== 0 || rule.travelMinutes !== 0)) {
      issues.push(`rule "${rule.id}": mode "none" must have zero fare and minutes`);
    }
    const a = rule.availability;
    if (a && a.kind !== "unknown") {
      const times = a.kind === "frequent" ? [a.firstDeparture, a.lastDeparture] : a.departures;
      if (times.length === 0 || times.some((t) => !HHMM.test(t))) issues.push(`rule "${rule.id}": availability times must be HH:MM`);
      if (!Number.isFinite(a.accessMinutes) || a.accessMinutes < 0 || a.accessMinutes > rule.travelMinutes) {
        issues.push(`rule "${rule.id}": accessMinutes must be between 0 and travelMinutes`);
      }
      if (a.kind === "frequent" && a.firstDeparture > a.lastDeparture) issues.push(`rule "${rule.id}": firstDeparture after lastDeparture`);
      if (a.kind === "timetable" && (!ISO_DAY.test(a.validFrom) || !ISO_DAY.test(a.validTo) || a.validFrom > a.validTo)) {
        issues.push(`rule "${rule.id}": timetable needs a valid validFrom/validTo date range`);
      }
    }
    if (rule.evidence && (Number.isNaN(Date.parse(rule.evidence.verifiedAt)) || !rule.evidence.source.trim() || !rule.evidence.verifiedBy.trim())) {
      issues.push(`rule "${rule.id}": evidence needs source, verifiedBy and a valid verifiedAt`);
    }
    const key = [rule.fromZoneId, rule.toZoneId, normalizeLocality(rule.fromLocality ?? ""), normalizeLocality(rule.toLocality ?? "")].join("|");
    if (ruleKeys.has(key)) issues.push(`rule "${rule.id}" duplicates another rule for the same leg`);
    ruleKeys.add(key);
  }

  // Plausibility
  const p = config.plausibility;
  if (!(p.maxRoadKm > 0)) issues.push("plausibility.maxRoadKm must be > 0");
  if (!(p.minAvgSpeedKmh > 0) || !(p.maxAvgSpeedKmh > p.minAvgSpeedKmh)) issues.push("plausibility speed limits must satisfy 0 < min < max");
  if (p.maxRoadToStraightRatio !== null && !(p.maxRoadToStraightRatio >= 1)) issues.push("plausibility.maxRoadToStraightRatio must be >= 1 or null");

  // Overnight
  const o = config.overnight;
  if (o.mode === "waived" && (!o.approvedBy?.trim() || !o.reason?.trim())) issues.push("overnight waiver needs approvedBy and reason");
  if (o.mode === "manualReviewAbove") {
    if (!(o.maxSameDayMinutes > 0)) issues.push("overnight.maxSameDayMinutes must be > 0");
    if (!Number.isFinite(o.handoverMinutes) || o.handoverMinutes < 0) issues.push("overnight.handoverMinutes must be >= 0");
  }

  return issues;
}
