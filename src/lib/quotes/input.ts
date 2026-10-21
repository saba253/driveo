import { POWERTRAINS, TRANSMISSIONS, type Powertrain, type Transmission } from "../booking/types.ts";
import type { LocalNow } from "../booking/validation.ts";

/**
 * Strict validation of UNTRUSTED quote input (from a browser or API client).
 *
 * - Unknown fields are rejected, so clients cannot send prices, extras,
 *   overrides, tariffs or drivers — those only ever come from the server.
 * - A location must be a selected place id (from address autocomplete) or,
 *   in development/tests only, trusted coordinates inside Georgia.
 * - Dates and times are checked against the current time in Tbilisi.
 */

export type QuoteLocationInput = {
  locality: string;
  address: string;
  placeId: string | null;
  coordinates: { lat: number; lng: number } | null;
};

export type QuoteInput = {
  pickup: QuoteLocationInput;
  delivery: QuoteLocationInput;
  schedule: { date: string; time: string };
  vehicle: { powertrain: Powertrain; transmission: Transmission; drivableConfirmed: boolean };
  /** Re-quote of an earlier quote for the same request. */
  previousQuoteId: string | null;
};

export type InputIssueCode =
  | "required"
  | "invalid"
  | "unknownField"
  | "tooLong"
  | "locationNotResolved"
  | "testCoordinatesNotAllowed"
  | "outsideServiceArea"
  | "dateInPast"
  | "timeInPast";

export type InputIssue = { field: string; code: InputIssueCode };

export type ParseResult = { ok: true; input: QuoteInput } | { ok: false; issues: InputIssue[] };

/* Approximate bounding box of Georgia, for trusted test coordinates only. */
const GEORGIA_BOUNDS = { minLat: 41.0, maxLat: 43.7, minLng: 39.8, maxLng: 46.8 };
/* Google place ids are URL-safe tokens; mock ids follow the same shape. */
const PLACE_ID = /^[A-Za-z0-9_-]{10,1024}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_24H = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Current wall-clock date/time in Tbilisi, regardless of the server's time zone. */
export function tbilisiNow(at: Date): LocalNow {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tbilisi",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function realDate(value: string): boolean {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function parseQuoteInput(raw: unknown, opts: { now: Date; allowTestCoordinates: boolean }): ParseResult {
  const issues: InputIssue[] = [];
  const issue = (field: string, code: InputIssueCode) => issues.push({ field, code });

  const onlyKeys = (obj: Record<string, unknown>, allowed: readonly string[], prefix: string) => {
    for (const key of Object.keys(obj)) if (!allowed.includes(key)) issue(prefix ? `${prefix}.${key}` : key, "unknownField");
  };

  const text = (v: unknown, field: string, min: number, max: number): string => {
    if (typeof v !== "string" || !v.trim()) {
      issue(field, "required");
      return "";
    }
    const t = v.trim();
    if (t.length < min) issue(field, "invalid");
    if (t.length > max) issue(field, "tooLong");
    return t;
  };

  if (!isObject(raw)) return { ok: false, issues: [{ field: "", code: "invalid" }] };
  onlyKeys(raw, ["pickup", "delivery", "schedule", "vehicle", "previousQuoteId"], "");

  const location = (v: unknown, field: string): QuoteLocationInput => {
    const empty: QuoteLocationInput = { locality: "", address: "", placeId: null, coordinates: null };
    if (!isObject(v)) {
      issue(field, "required");
      return empty;
    }
    onlyKeys(v, ["locality", "address", "placeId", "coordinates"], field);
    const locality = text(v.locality, `${field}.locality`, 2, 60);
    const address = text(v.address, `${field}.address`, 3, 200);

    let placeId: string | null = null;
    if (v.placeId !== undefined && v.placeId !== null) {
      if (typeof v.placeId === "string" && PLACE_ID.test(v.placeId)) placeId = v.placeId;
      else issue(`${field}.placeId`, "invalid");
    }

    let coordinates: QuoteLocationInput["coordinates"] = null;
    if (v.coordinates !== undefined && v.coordinates !== null) {
      const c = v.coordinates;
      if (!isObject(c) || typeof c.lat !== "number" || typeof c.lng !== "number" || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)) {
        issue(`${field}.coordinates`, "invalid");
      } else {
        onlyKeys(c, ["lat", "lng"], `${field}.coordinates`);
        if (!opts.allowTestCoordinates) issue(`${field}.coordinates`, "testCoordinatesNotAllowed");
        else if (c.lat < GEORGIA_BOUNDS.minLat || c.lat > GEORGIA_BOUNDS.maxLat || c.lng < GEORGIA_BOUNDS.minLng || c.lng > GEORGIA_BOUNDS.maxLng) {
          issue(`${field}.coordinates`, "outsideServiceArea");
        } else coordinates = { lat: c.lat, lng: c.lng };
      }
    }

    // Neither a selected place nor coordinates: a free-text address cannot be routed safely.
    if (v.placeId == null && v.coordinates == null) issue(field, "locationNotResolved");
    return { locality, address, placeId, coordinates };
  };

  const pickup = location(raw.pickup, "pickup");
  const delivery = location(raw.delivery, "delivery");

  // Schedule — not in the past, in Tbilisi time.
  const schedule = { date: "", time: "" };
  if (!isObject(raw.schedule)) issue("schedule", "required");
  else {
    onlyKeys(raw.schedule, ["date", "time"], "schedule");
    const { date, time } = raw.schedule;
    const now = tbilisiNow(opts.now);
    if (typeof date !== "string" || !ISO_DATE.test(date) || !realDate(date)) issue("schedule.date", date ? "invalid" : "required");
    else if (date < now.date) issue("schedule.date", "dateInPast");
    else schedule.date = date;
    if (typeof time !== "string" || !TIME_24H.test(time)) issue("schedule.time", time ? "invalid" : "required");
    else if (schedule.date === now.date && time <= now.time) issue("schedule.time", "timeInPast");
    else schedule.time = time;
  }

  // Vehicle
  const vehicle = { powertrain: "petrol" as Powertrain, transmission: "automatic" as Transmission, drivableConfirmed: false };
  if (!isObject(raw.vehicle)) issue("vehicle", "required");
  else {
    onlyKeys(raw.vehicle, ["powertrain", "transmission", "drivableConfirmed"], "vehicle");
    const { powertrain, transmission, drivableConfirmed } = raw.vehicle;
    if (!(POWERTRAINS as readonly unknown[]).includes(powertrain)) issue("vehicle.powertrain", powertrain ? "invalid" : "required");
    else vehicle.powertrain = powertrain as Powertrain;
    if (!(TRANSMISSIONS as readonly unknown[]).includes(transmission)) issue("vehicle.transmission", transmission ? "invalid" : "required");
    else vehicle.transmission = transmission as Transmission;
    if (typeof drivableConfirmed !== "boolean") issue("vehicle.drivableConfirmed", "required");
    else vehicle.drivableConfirmed = drivableConfirmed;
  }

  let previousQuoteId: string | null = null;
  if (raw.previousQuoteId !== undefined && raw.previousQuoteId !== null) {
    if (typeof raw.previousQuoteId === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(raw.previousQuoteId)) previousQuoteId = raw.previousQuoteId;
    else issue("previousQuoteId", "invalid");
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, input: { pickup, delivery, schedule, vehicle, previousQuoteId } };
}
