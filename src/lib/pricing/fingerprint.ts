import { normalizeAddress } from "../booking/validation.ts";
import type { QuoteRequest, TravelOverride } from "./engine-types.ts";
import { normalizeLocality } from "./zones.ts";

/**
 * Input fingerprints tie a quote to the exact customer inputs it priced.
 * Any change that could change the price (address, locality, date, time,
 * extras, admin overrides) changes the fingerprint; cosmetic differences
 * (case, spacing, punctuation in addresses) do not.
 *
 * Provider-derived data (coordinates, route) is excluded on purpose.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function canonicalize(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalQuoteInputs(request: QuoteRequest): string {
  const endpoint = (e: QuoteRequest["pickup"]): Json => ({
    locality: normalizeLocality(e.locality),
    address: normalizeAddress(e.address),
    placeId: e.placeId,
  });
  const override = (o: TravelOverride | undefined): Json =>
    o ? { fare: o.fare.amountMinor, currency: o.fare.currency, travelMinutes: o.travelMinutes } : null;

  return canonicalize({
    v: 1,
    pickup: endpoint(request.pickup),
    delivery: endpoint(request.delivery),
    schedule: { date: request.schedule.date, time: request.schedule.time },
    extras: [...(request.extras ?? [])]
      .map((c) => ({ code: c.code, amount: c.amount.amountMinor, currency: c.amount.currency }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    overrides: {
      positioning: override(request.overrides?.positioning),
      return: override(request.overrides?.return),
    },
  });
}

/** "sha256:<hex>" of the canonical inputs. Uses Web Crypto (Node 20+, all modern browsers). */
export async function fingerprintQuoteInputs(request: QuoteRequest): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalQuoteInputs(request));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}
