import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPhone, parsePhone } from "./phone.ts";
import { EMPTY_DRAFT, type BookingDraft } from "./types.ts";
import { STAGE_FIELDS, isSameLocation, toBookingRequest, validateStage } from "./validation.ts";

const NOW = { date: "2026-10-21", time: "10:30" };

const VALID: BookingDraft = {
  pickupCity: "თბილისი",
  pickupAddress: "ჭავჭავაძის გამზ. 1",
  deliveryCity: "ბათუმი",
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
  it("requires every route field when empty", () => {
    const errors = validateStage(EMPTY_DRAFT, "route", NOW);
    assert.deepEqual(Object.keys(errors).sort(), [...STAGE_FIELDS.route].sort());
    assert.ok(Object.values(errors).every((c) => c === "required"));
  });

  it("requires every details field, including both confirmations", () => {
    const errors = validateStage(EMPTY_DRAFT, "details", NOW);
    assert.deepEqual(Object.keys(errors).sort(), [...STAGE_FIELDS.details].sort());
    assert.equal(errors.fuelPolicyAccepted, "mustConfirm");
    assert.equal(errors.vehicleDrivable, "mustConfirm");
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
    const errors = validateStage({ ...VALID, customerPhone: "12345", fuelPolicyAccepted: false }, "details", NOW);
    assert.deepEqual(errors, { customerPhone: "invalidPhone", fuelPolicyAccepted: "mustConfirm" });
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
    assert.equal(result.request.meta.assignedDriverId, null);
  });

  it("returns errors instead of a request when anything is invalid", () => {
    const result = toBookingRequest({ ...VALID, vehicleDrivable: false }, NOW);
    assert.equal(result.ok, false);
  });
});
