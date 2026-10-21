import { ka } from "@/content/ka";
import type { BookingField } from "@/lib/booking/types";
import type { ValidationCode } from "@/lib/booking/validation";

const e = ka.booking.errors;

const SELECT_FIELDS: ReadonlySet<BookingField> = new Set(["pickupCity", "deliveryCity", "powertrain", "transmission"]);

/** Maps a validation code to Georgian copy, with field-specific wording where it helps. */
export function errorMessage(field: BookingField, code: ValidationCode | undefined): string | undefined {
  if (!code) return undefined;
  if (code === "required" && SELECT_FIELDS.has(field)) return e.requiredSelect;
  if (code === "mustConfirm") return field === "vehicleDrivable" ? e.mustConfirmDrivable : e.mustConfirmFuel;
  return e[code];
}
