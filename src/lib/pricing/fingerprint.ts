import { normalizeAddress } from "../booking/validation.ts";
import type { DriverBase, QuoteRequest, TravelOverride } from "./engine-types.ts";
import { normalizeLocality } from "./zones.ts";

/**
 * Input fingerprints tie a quote to everything that decided its price or its
 * eligibility for automatic pricing:
 *  - customer inputs: localities, addresses, place ids, date, time, vehicle
 *    (powertrain, transmission, drivable confirmation), extras;
 *  - admin overrides;
 *  - pricing context: tariff id/version, configuration version, driver and base.
 *
 * A change to any of them changes the fingerprint, so a stale quote can never
 * back a booking. Cosmetic differences (case, spacing, punctuation in
 * addresses and localities) do not. Provider-derived data (coordinates,
 * route distance/duration) is excluded on purpose.
 */

export type PricingContext = {
  tariff: { id: string; version: number } | null;
  configVersion: string;
  driverId: string | null;
  base: DriverBase;
};

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function canonicalize(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalQuoteInputs(request: QuoteRequest, context: PricingContext): string {
  const endpoint = (e: QuoteRequest["pickup"]): Json => ({
    locality: normalizeLocality(e.locality),
    address: normalizeAddress(e.address),
    placeId: e.placeId,
  });
  const override = (o: TravelOverride | undefined): Json =>
    o ? { fare: o.fare.amountMinor, currency: o.fare.currency, travelMinutes: o.travelMinutes } : null;

  return canonicalize({
    v: 2,
    pickup: endpoint(request.pickup),
    delivery: endpoint(request.delivery),
    schedule: { date: request.schedule.date, time: request.schedule.time },
    vehicle: {
      powertrain: request.vehicle.powertrain,
      transmission: request.vehicle.transmission,
      drivableConfirmed: request.vehicle.drivableConfirmed,
    },
    extras: [...(request.extras ?? [])]
      .map((c) => ({ category: c.category, code: c.code, amount: c.amount.amountMinor, currency: c.amount.currency }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    overrides: {
      positioning: override(request.overrides?.positioning),
      return: override(request.overrides?.return),
    },
    context: {
      tariff: context.tariff ? { id: context.tariff.id, version: context.tariff.version } : null,
      configVersion: context.configVersion,
      driverId: context.driverId,
      base: { zoneId: context.base.zoneId, locality: normalizeLocality(context.base.locality) },
    },
  });
}

/** "sha256:<hex>" of the canonical inputs. Uses Web Crypto (Node 20+, all modern browsers). */
export async function fingerprintQuoteInputs(request: QuoteRequest, context: PricingContext): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalQuoteInputs(request, context));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}
