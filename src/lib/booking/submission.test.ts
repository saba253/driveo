import { test } from "node:test";
import assert from "node:assert/strict";
import { ka } from "../../content/ka.ts";
import { FUEL_POLICY } from "./policies.ts";
import { addDays, canonicalSubmissionContent, parseBookingSubmission, toStoredSubmission, SUBMISSION_LIMITS } from "./submission.ts";
import { toSubmissionPayload, readSubmissionResponse } from "./submission-contract.ts";
import { VALID_DRAFT } from "./test-fixtures.ts";
import { OTHER_CITY, type BookingDraft } from "./types.ts";

const NOW = { date: "2026-10-22", time: "09:00" };
const opts = { now: NOW, allowedCities: ka.booking.cities };

const payload = (draft: Partial<BookingDraft> = {}, extra: Record<string, unknown> = {}) => ({
  ...toSubmissionPayload({ ...VALID_DRAFT, ...draft }),
  ...extra,
});

test("a valid manual-assessment submission parses into a normalized request", () => {
  const r = parseBookingSubmission(payload(), opts);
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal(r.request.contact.phone, "+995555123456");
  assert.equal(r.request.route.pickup.city, "თბილისი");
  assert.deepEqual(r.request.acknowledgements.fuelPolicy, { accepted: true, policyId: FUEL_POLICY.id, policyVersion: FUEL_POLICY.version });
});

test("a typed 'other' city is accepted", () => {
  const r = parseBookingSubmission(payload({ deliveryCity: OTHER_CITY, deliveryCityOther: "ბორჯომი" }), opts);
  assert.equal(r.kind, "ok");
});

test("field errors use the same codes as the form", () => {
  const r = parseBookingSubmission(
    payload({ pickupAddress: "", customerPhone: "123", vehicleDrivable: false, fuelPolicyAccepted: false, pickupDate: "2026-10-01" }),
    opts,
  );
  assert.equal(r.kind, "invalid");
  if (r.kind !== "invalid") return;
  assert.deepEqual(r.errors, {
    pickupAddress: "required",
    customerPhone: "invalidPhone",
    vehicleDrivable: "mustConfirm",
    fuelPolicyAccepted: "mustConfirm",
    pickupDate: "dateInPast",
  });
});

test("server-only rules: unlisted cities, far-future dates and control characters", () => {
  const r1 = parseBookingSubmission(payload({ pickupCity: "Atlantis" }), opts);
  assert.deepEqual(r1.kind === "invalid" && r1.errors, { pickupCity: "invalidOption" });
  const far = addDays(NOW.date, SUBMISSION_LIMITS.maxDaysAhead + 1);
  const r2 = parseBookingSubmission(payload({ pickupDate: far }), opts);
  assert.deepEqual(r2.kind === "invalid" && r2.errors, { pickupDate: "dateTooFar" });
  const r3 = parseBookingSubmission(payload({ pickupDate: addDays(NOW.date, SUBMISSION_LIMITS.maxDaysAhead) }), opts);
  assert.equal(r3.kind, "ok");
  const ctrl = `ტესტი${String.fromCharCode(0)}ტესტაძე`;
  const bidi = `ქუჩა ${String.fromCharCode(0x202e)}1`;
  const r4 = parseBookingSubmission(payload({ customerName: ctrl, pickupAddress: bidi }), opts);
  assert.equal(r4.kind === "invalid" && r4.errors.customerName, "invalidText");
  assert.equal(r4.kind === "invalid" && r4.errors.pickupAddress, "invalidText");
});

test("injected privileged fields are rejected, at the top level and inside the draft", () => {
  for (const extra of [{ price: 1 }, { totalMinor: 100 }, { status: "confirmed" }, { pricing_mode: "automatic_quote" }, { reference: "DRV-2026-000001" }, { quoteId: "q" }]) {
    assert.deepEqual(parseBookingSubmission(payload({}, extra), opts), { kind: "rejected", reason: "unexpected_field" }, JSON.stringify(extra));
  }
  const withDraftExtra = { ...payload(), draft: { ...VALID_DRAFT, assignedDriverId: "x" } };
  assert.deepEqual(parseBookingSubmission(withDraftExtra, opts), { kind: "rejected", reason: "unexpected_field" });
});

test("malformed shapes and wrong types are rejected", () => {
  const p = payload();
  const { website: _omit, ...withoutHoneypot } = p;
  void _omit;
  for (const raw of [null, [], "x", 42, {}, withoutHoneypot, { ...p, draft: [] }, { ...p, draft: { ...VALID_DRAFT, vehicleDrivable: "true" } }, { ...p, draft: { ...VALID_DRAFT, customerName: 5 } }]) {
    assert.deepEqual(parseBookingSubmission(raw, opts), { kind: "rejected", reason: "malformed" }, JSON.stringify(raw));
  }
  const missing: Record<string, unknown> = { ...VALID_DRAFT };
  delete missing.customerPhone;
  assert.deepEqual(parseBookingSubmission({ ...p, draft: missing }, opts), { kind: "rejected", reason: "malformed" });
  assert.deepEqual(parseBookingSubmission(payload({ pickupAddress: "x".repeat(SUBMISSION_LIMITS.maxRawFieldLength + 1) }), opts), {
    kind: "rejected",
    reason: "malformed",
  });
});

test("a filled honeypot is rejected; an outdated policy version is reported", () => {
  assert.deepEqual(parseBookingSubmission({ ...payload(), website: "http://spam.example" }, opts), { kind: "rejected", reason: "honeypot" });
  assert.deepEqual(parseBookingSubmission({ ...payload(), fuelPolicyVersion: FUEL_POLICY.version - 1 }, opts), { kind: "policy_changed" });
});

test("stored parameters: manual assessment, no price, server consent time, test marker, unapproved policies left empty", () => {
  const r = parseBookingSubmission(payload(), opts);
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  const at = new Date("2026-10-22T05:00:00Z");
  const s = toStoredSubmission(r.request, { consentedAt: at, test: true });
  assert.equal(s.booking.pricing_mode, "manual_assessment");
  assert.deepEqual(s.booking.eligibility_reasons, ["test_submission"]);
  assert.equal(s.booking.consented_at, at.toISOString());
  assert.equal(s.booking.terms_version, null);
  assert.equal(s.booking.privacy_version, null);
  assert.ok(!Object.keys(s.booking).some((k) => /price|amount|quote|status|reference|driver/.test(k)));
  assert.deepEqual(s.contact, { full_name: "ტესტი ტესტაძე", phone_e164: "+995555123456", preferred_contact: "phone" });
  assert.equal(toStoredSubmission(r.request, { consentedAt: at, test: false }).booking.eligibility_reasons.length, 0);
});

test("the submission identity ignores server time but not content", () => {
  const a = parseBookingSubmission(payload(), opts);
  const b = parseBookingSubmission(payload({ customerName: "სხვა სახელი" }), opts);
  assert.ok(a.kind === "ok" && b.kind === "ok");
  if (a.kind !== "ok" || b.kind !== "ok") return;
  assert.equal(canonicalSubmissionContent(a.request, true), canonicalSubmissionContent(a.request, true));
  assert.notEqual(canonicalSubmissionContent(a.request, true), canonicalSubmissionContent(b.request, true));
  assert.notEqual(canonicalSubmissionContent(a.request, true), canonicalSubmissionContent(a.request, false));
});

test("the browser treats any unexpected response as unavailable, never as received", () => {
  assert.deepEqual(readSubmissionResponse(null), { status: "unavailable" });
  assert.deepEqual(readSubmissionResponse({ status: "ok" }), { status: "unavailable" });
  assert.deepEqual(readSubmissionResponse({ status: "received" }), { status: "unavailable" });
  assert.deepEqual(readSubmissionResponse({ status: "received", reference: "<script>" }), { status: "unavailable" });
  assert.deepEqual(readSubmissionResponse({ status: "received", reference: "DRV-2026-000123", duplicate: true }), {
    status: "received",
    reference: "DRV-2026-000123",
    duplicate: true,
  });
  assert.deepEqual(readSubmissionResponse({ status: "rate_limited", retryAfterSeconds: "x" }), { status: "rate_limited", retryAfterSeconds: 60 });
});
