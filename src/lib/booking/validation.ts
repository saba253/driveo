import { parsePhone } from "./phone.ts";
import { FUEL_POLICY } from "./policies.ts";
import { OTHER_CITY, POWERTRAINS, TRANSMISSIONS, type BookingDraft, type BookingField, type BookingRequest } from "./types.ts";

/**
 * Pure validation. Returns language-neutral codes; the UI maps them to
 * Georgian messages (ka.booking.errors). "Now" is always passed in so the
 * rules are deterministic and testable.
 */
export type ValidationCode =
  | "required"
  | "tooShort"
  | "tooLong"
  | "invalidDate"
  | "dateInPast"
  | "invalidTime"
  | "timeInPast"
  | "sameLocation"
  | "invalidPhone"
  | "invalidOption"
  | "invalidCity"
  | "mustConfirm"
  /** Server-side only: further ahead than bookings are accepted. */
  | "dateTooFar"
  /** Server-side only: control characters or other text that cannot be stored. */
  | "invalidText";

export type ValidationErrors = Partial<Record<BookingField, ValidationCode>>;

/** Local wall-clock "now", as the customer's browser sees it. */
export type LocalNow = { date: string; time: string };

export function localNow(at: Date = new Date()): LocalNow {
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
    time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
  };
}

/**
 * Fields collected on each form stage, in display order. "vehicle" and
 * "contact" are the two progressive sections of the UI's second step.
 */
export const STAGE_FIELDS = {
  route: [
    "pickupCity",
    "pickupCityOther",
    "pickupAddress",
    "deliveryCity",
    "deliveryCityOther",
    "deliveryAddress",
    "pickupDate",
    "pickupTime",
  ],
  vehicle: ["vehicleMake", "vehicleModel", "powertrain", "transmission", "vehicleDrivable"],
  contact: ["customerName", "customerPhone", "fuelPolicyAccepted"],
} as const satisfies Record<string, readonly BookingField[]>;

export const ALL_FIELDS: readonly BookingField[] = [...STAGE_FIELDS.route, ...STAGE_FIELDS.vehicle, ...STAGE_FIELDS.contact];

export type FormStage = keyof typeof STAGE_FIELDS;

export const LIMITS = {
  cityMin: 2,
  cityMax: 60,
  addressMin: 3,
  addressMax: 200,
  vehicleMax: 60,
  nameMin: 2,
  nameMax: 80,
} as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_24H = /^([01]\d|2[0-3]):[0-5]\d$/;

function isRealDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/* Letters in any script with combining marks, plus spaces, dots, apostrophes and hyphens. */
const CITY_NAME = /^[\p{L}\p{M}][\p{L}\p{M}\s.'’-]*$/u;

/** The city the customer means: the listed one, or their typed name for "other". */
export function effectiveCity(draft: BookingDraft, end: "pickup" | "delivery"): string {
  const city = end === "pickup" ? draft.pickupCity : draft.deliveryCity;
  const other = end === "pickup" ? draft.pickupCityOther : draft.deliveryCityOther;
  return city === OTHER_CITY ? other.trim().replace(/\s+/g, " ") : city;
}

/** Normalizes an address for comparison only: case, punctuation and spacing are ignored. */
export function normalizeAddress(value: string): string {
  return value
    .toLocaleLowerCase("ka")
    .replace(/[.,;:#№"'()\-/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isSameLocation(draft: BookingDraft): boolean {
  const from = effectiveCity(draft, "pickup");
  const to = effectiveCity(draft, "delivery");
  if (!from || !to || !draft.pickupAddress.trim() || !draft.deliveryAddress.trim()) return false;
  return normalizeAddress(from) === normalizeAddress(to) && normalizeAddress(draft.pickupAddress) === normalizeAddress(draft.deliveryAddress);
}

function text(value: string, min: number, max: number): ValidationCode | undefined {
  const v = value.trim();
  if (!v) return "required";
  if (v.length < min) return "tooShort";
  if (v.length > max) return "tooLong";
  return undefined;
}

function cityName(value: string): ValidationCode | undefined {
  return text(value, LIMITS.cityMin, LIMITS.cityMax) ?? (CITY_NAME.test(value.trim()) ? undefined : "invalidCity");
}

function validateField(field: BookingField, draft: BookingDraft, now: LocalNow): ValidationCode | undefined {
  switch (field) {
    case "pickupCity":
    case "deliveryCity":
      return draft[field] ? undefined : "required";
    case "pickupCityOther":
      return draft.pickupCity === OTHER_CITY ? cityName(draft.pickupCityOther) : undefined;
    case "deliveryCityOther":
      return draft.deliveryCity === OTHER_CITY ? cityName(draft.deliveryCityOther) : undefined;
    case "pickupAddress":
      return text(draft.pickupAddress, LIMITS.addressMin, LIMITS.addressMax);
    case "deliveryAddress":
      return text(draft.deliveryAddress, LIMITS.addressMin, LIMITS.addressMax) ?? (isSameLocation(draft) ? "sameLocation" : undefined);
    case "pickupDate":
      if (!draft.pickupDate) return "required";
      if (!isRealDate(draft.pickupDate)) return "invalidDate";
      return draft.pickupDate < now.date ? "dateInPast" : undefined;
    case "pickupTime":
      if (!draft.pickupTime) return "required";
      if (!TIME_24H.test(draft.pickupTime)) return "invalidTime";
      return draft.pickupDate === now.date && draft.pickupTime <= now.time ? "timeInPast" : undefined;
    case "vehicleMake":
    case "vehicleModel":
      return text(draft[field], 1, LIMITS.vehicleMax);
    case "powertrain":
      if (!draft.powertrain) return "required";
      return (POWERTRAINS as readonly string[]).includes(draft.powertrain) ? undefined : "invalidOption";
    case "transmission":
      if (!draft.transmission) return "required";
      return (TRANSMISSIONS as readonly string[]).includes(draft.transmission) ? undefined : "invalidOption";
    case "customerName":
      return text(draft.customerName, LIMITS.nameMin, LIMITS.nameMax);
    case "customerPhone":
      if (!draft.customerPhone.trim()) return "required";
      return parsePhone(draft.customerPhone) ? undefined : "invalidPhone";
    case "vehicleDrivable":
    case "fuelPolicyAccepted":
      return draft[field] ? undefined : "mustConfirm";
  }
}

export function validateFields(draft: BookingDraft, fields: readonly BookingField[], now: LocalNow): ValidationErrors {
  const errors: ValidationErrors = {};
  for (const field of fields) {
    const code = validateField(field, draft, now);
    if (code) errors[field] = code;
  }
  return errors;
}

export function validateStage(draft: BookingDraft, stage: FormStage, now: LocalNow): ValidationErrors {
  return validateFields(draft, STAGE_FIELDS[stage], now);
}

export function validateDraft(draft: BookingDraft, now: LocalNow): ValidationErrors {
  return validateFields(draft, ALL_FIELDS, now);
}

export type BuildResult = { ok: true; request: BookingRequest } | { ok: false; errors: ValidationErrors };

/** Validates the whole draft and, if valid, produces a normalized BookingRequest. */
export function toBookingRequest(draft: BookingDraft, now: LocalNow): BuildResult {
  const errors = validateDraft(draft, now);
  const phone = parsePhone(draft.customerPhone);
  if (Object.keys(errors).length > 0 || !phone || !draft.powertrain || !draft.transmission) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    request: {
      route: {
        pickup: {
          city: effectiveCity(draft, "pickup"),
          address: draft.pickupAddress.trim(),
          cityEnteredManually: draft.pickupCity === OTHER_CITY,
        },
        delivery: {
          city: effectiveCity(draft, "delivery"),
          address: draft.deliveryAddress.trim(),
          cityEnteredManually: draft.deliveryCity === OTHER_CITY,
        },
      },
      vehicle: {
        make: draft.vehicleMake.trim(),
        model: draft.vehicleModel.trim(),
        powertrain: draft.powertrain,
        transmission: draft.transmission,
        drivableConfirmed: true,
      },
      schedule: { preferredDate: draft.pickupDate, preferredTime: draft.pickupTime, isPreferenceOnly: true },
      contact: { name: draft.customerName.trim(), phone: phone.e164 },
      acknowledgements: {
        fuelPolicy: { accepted: true, policyId: FUEL_POLICY.id, policyVersion: FUEL_POLICY.version },
      },
      meta: { source: "web", status: "draft", assignedDriverId: null },
    },
  };
}
