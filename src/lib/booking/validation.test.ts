import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPhone, parsePhone } from "./phone.ts";
import { FUEL_POLICY } from "./policies.ts";
import { EMPTY_DRAFT, OTHER_CITY, type BookingDraft } from "./types.ts";
import { STAGE_FIELDS, effectiveCity, isSameLocation, toBookingRequest, validateStage } from "./validation.ts";

const NOW = { date: "2026-10-21", time: "10:30" };

const VALID: BookingDraft = {
  pickupCity: "თბილისი",
  pickupCityOther: "",
  pickupAddress: "ჭავჭავაძის გამზ. 1",
  deliveryCity: "ბათუმი",
  deliveryCityOther: "",
  deliveryAddress: "რუსთაველის ქ. 10",
  pickupDate: "2026-10-25",
  pickupTime: "09:00",
  vehicleMake: "Toyota",
  vehicleModel: "Prius",
  powertrain: "hybrid",
  transmission: "automatic",
  vehicleDrivable: true,
  customerName: "გიორგი",
  customerPhone: "555 12 34 56",
  fuelPolicyAccepted: true,
};

describe("parsePhone", () => {
  it("accepts common Georgian formats", () => {
    for (const input of ["555123456", "555 12 34 56", "555-12-34-56", "+995 555 12 34 56", "00995555123456", "995555123456", "(+995) 322 12 34 56"]) {
      assert.ok(parsePhone(input), input);
    }
    assert.equal(parsePhone("555 12 34 56")?.e164, "+995555123456");
    assert.equal(formatPhone(parsePhone("555123456")!), "+995 555 12 34 56");
  });

  it("accepts foreign numbers in international format", () => {
    assert.deepEqual(parsePhone("+49 151 23456789"), { e164: "+4915123456789", isGeorgian: false });
  });

  it("rejects malformed numbers", () => {
    for (const input of ["", "12345", "555 12 34 5", "5551234567", "123456789", "+995 123 45 67 89", "+0 123 4567", "555-12-34-56x", "+995 555 12 34 567"]) {
      assert.equal(parsePhone(input), null, input);
    }
  });
});

describe("validateStage", () => {
  it("requires every route field when empty (other-city fields only when chosen)", () => {
    const errors = validateStage(EMPTY_DRAFT, "route", NOW);
    const expected = STAGE_FIELDS.route.filter((f) => f !== "pickupCityOther" && f !== "deliveryCityOther");
    assert.deepEqual(Object.keys(errors).sort(), [...expected].sort());
    assert.ok(Object.values(errors).every((c) => c === "required"));
  });

  it("requires every vehicle field, including the drivable confirmation", () => {
    const errors = validateStage(EMPTY_DRAFT, "vehicle", NOW);
    assert.deepEqual(Object.keys(errors).sort(), [...STAGE_FIELDS.vehicle].sort());
    assert.equal(errors.vehicleDrivable, "mustConfirm");
  });

  it("requires every contact field, including the fuel/charging acknowledgement", () => {
    const errors = validateStage(EMPTY_DRAFT, "contact", NOW);
    assert.deepEqual(Object.keys(errors).sort(), [...STAGE_FIELDS.contact].sort());
    assert.equal(errors.fuelPolicyAccepted, "mustConfirm");
  });

  it("rejects past dates and already-passed times today", () => {
    assert.equal(validateStage({ ...VALID, pickupDate: "2026-10-20" }, "route", NOW).pickupDate, "dateInPast");
    assert.equal(validateStage({ ...VALID, pickupDate: "2026-10-21", pickupTime: "10:00" }, "route", NOW).pickupTime, "timeInPast");
    assert.deepEqual(validateStage({ ...VALID, pickupDate: "2026-10-21", pickupTime: "11:00" }, "route", NOW), {});
    assert.equal(validateStage({ ...VALID, pickupDate: "2026-02-30" }, "route", NOW).pickupDate, "invalidDate");
  });

  it("flags identical pickup and delivery, ignoring case, punctuation and spacing", () => {
    const same = { ...VALID, deliveryCity: "თბილისი", deliveryAddress: "  ჭავჭავაძის   გამზ 1." };
    assert.equal(isSameLocation(same), true);
    assert.equal(validateStage(same, "route", NOW).deliveryAddress, "sameLocation");
    // Same address in a different city is a valid route.
    assert.equal(isSameLocation({ ...VALID, deliveryAddress: VALID.pickupAddress }), false);
  });

  it("rejects an invalid phone and missing fuel-policy acknowledgement", () => {
    const errors = validateStage({ ...VALID, customerPhone: "12345", fuelPolicyAccepted: false }, "contact", NOW);
    assert.deepEqual(errors, { customerPhone: "invalidPhone", fuelPolicyAccepted: "mustConfirm" });
  });

  it("accepts international numbers in the contact step", () => {
    assert.deepEqual(validateStage({ ...VALID, customerPhone: "+49 151 23456789" }, "contact", NOW), {});
  });
});

describe("other city", () => {
  const other = (city: string): BookingDraft => ({ ...VALID, deliveryCity: OTHER_CITY, deliveryCityOther: city });

  it("requires a typed city name when 'other' is chosen", () => {
    assert.equal(validateStage(other(""), "route", NOW).deliveryCityOther, "required");
    assert.equal(validateStage(other("   "), "route", NOW).deliveryCityOther, "required");
    assert.equal(validateStage(other("ა"), "route", NOW).deliveryCityOther, "tooShort");
    assert.equal(validateStage(other("ა".repeat(61)), "route", NOW).deliveryCityOther, "tooLong");
  });

  it("accepts Georgian and Latin names, rejects digits and symbols", () => {
    for (const name of ["ბორჯომი", "წყალტუბო", "Sachkhere", "Kazbegi-Stepantsminda", "St. Nino"]) {
      assert.equal(validateStage(other(name), "route", NOW).deliveryCityOther, undefined, name);
    }
    for (const name of ["12345", "ბორჯომი 2", "@city", "-ბორჯომი"]) {
      assert.equal(validateStage(other(name), "route", NOW).deliveryCityOther, "invalidCity", name);
    }
  });

  it("ignores the typed name, but keeps it, when a listed city is selected again", () => {
    const back = { ...other("ბორჯომი"), deliveryCity: "ბათუმი" };
    assert.deepEqual(validateStage(back, "route", NOW), {});
    assert.equal(back.deliveryCityOther, "ბორჯომი");
    assert.equal(effectiveCity(back, "delivery"), "ბათუმი");
  });

  it("uses the typed city in same-location checks and in the request", () => {
    const same: BookingDraft = {
      ...VALID,
      pickupCity: OTHER_CITY,
      pickupCityOther: "ბორჯომი",
      deliveryCity: OTHER_CITY,
      deliveryCityOther: "  ბორჯომი ",
      deliveryAddress: VALID.pickupAddress,
    };
    assert.equal(isSameLocation(same), true);

    const result = toBookingRequest(other("  ბორჯომი  "), NOW);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.deepEqual(result.request.route.delivery, { city: "ბორჯომი", address: "რუსთაველის ქ. 10", cityEnteredManually: true });
    assert.equal(result.request.route.pickup.cityEnteredManually, false);
  });
});

describe("toBookingRequest", () => {
  it("builds a normalized request from a valid draft", () => {
    const result = toBookingRequest({ ...VALID, pickupAddress: "  ჭავჭავაძის გამზ. 1 " }, NOW);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.request.route.pickup.address, "ჭავჭავაძის გამზ. 1");
    assert.equal(result.request.contact.phone, "+995555123456");
    assert.equal(result.request.schedule.isPreferenceOnly, true);
    assert.equal(result.request.acknowledgements.fuelPolicy.policyId, "fuel-customer-provided");
    assert.equal(result.request.acknowledgements.fuelPolicy.policyVersion, FUEL_POLICY.version);
    assert.equal(FUEL_POLICY.version, 2);
    assert.deepEqual([...FUEL_POLICY.covers], ["petrol", "diesel", "lpg", "cng", "electricity"]);
    assert.equal(result.request.meta.assignedDriverId, null);
  });

  it("returns errors instead of a request when anything is invalid", () => {
    const result = toBookingRequest({ ...VALID, vehicleDrivable: false }, NOW);
    assert.equal(result.ok, false);
  });
});
