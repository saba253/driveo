import { test } from "node:test";
import assert from "node:assert/strict";
import { toAdminBookingItem, type AdminBookingRow } from "./admin-list.ts";
import { formatCalendarDate, formatClockTime, formatInstantInTbilisi, formatRequestedPickup } from "./schedule-format.ts";

test("requested pickup: shown exactly as stored, 24-hour, Georgian month names", () => {
  assert.deepEqual(formatRequestedPickup("2026-10-29", "10:00:00"), {
    date: "29 ოქტომბერი, 2026",
    time: "10:00",
    combined: "29 ოქტომბერი, 2026 — 10:00",
    dateKnown: true,
    timeKnown: true,
  });
  assert.equal(formatClockTime("23:59"), "23:59");
  assert.equal(formatClockTime("00:05:30.000"), "00:05");
  assert.equal(formatCalendarDate("2026-01-01"), "1 იანვარი, 2026");
});

test("missing or invalid values get explicit fallbacks, never an invented time", () => {
  const none = formatRequestedPickup(null, null);
  assert.deepEqual(none, {
    date: "თარიღი მითითებული არ არის",
    time: "დრო მითითებული არ არის",
    combined: "თარიღი მითითებული არ არის — დრო მითითებული არ არის",
    dateKnown: false,
    timeKnown: false,
  });
  for (const bad of ["24:00", "9:00", "10:60", "", "10", "ten"]) assert.equal(formatClockTime(bad), null, bad);
  for (const bad of ["2026-02-30", "2026-13-01", "29.10.2026", ""]) assert.equal(formatCalendarDate(bad), null, bad);
  assert.equal(formatRequestedPickup("2026-10-29", null).time, "დრო მითითებული არ არის");
  assert.equal(formatRequestedPickup("2026-10-29", null).date, "29 ოქტომბერი, 2026");
});

test("submission instants are converted to Asia/Tbilisi (UTC+4, no DST)", () => {
  // The real test booking: submitted 2026-10-22 20:01 UTC = 23 October 00:01 in Tbilisi.
  assert.equal(formatInstantInTbilisi("2026-10-22T20:01:00Z"), "23 ოქტომბერი, 2026 — 00:01");
  assert.equal(formatInstantInTbilisi("2026-07-01T08:30:00Z"), "1 ივლისი, 2026 — 12:30");
  assert.equal(formatInstantInTbilisi("not a date"), null);
  assert.equal(formatInstantInTbilisi(null), null);
});

const ROW: AdminBookingRow = {
  reference: "DRV-2026-000001",
  status: "submitted",
  pickup_city: "თბილისი",
  delivery_city: "რუსთავი",
  requested_date: "2026-10-29",
  requested_time: "10:00:00",
  submitted_at: "2026-10-22T20:01:00Z",
  is_test: true,
};

test("dashboard item: pickup comes from requested_date/time, submission time is separate", () => {
  const item = toAdminBookingItem(ROW);
  assert.equal(item.pickup.combined, "29 ოქტომბერი, 2026 — 10:00");
  assert.equal(item.submittedAt, "23 ოქტომბერი, 2026 — 00:01");
  assert.equal(item.route, "თბილისი → რუსთავი");
  assert.equal(item.isTest, true);
});

test("dashboard item: a missing pickup time is NOT replaced by the submission time", () => {
  const item = toAdminBookingItem({ ...ROW, requested_time: null });
  assert.equal(item.pickup.time, "დრო მითითებული არ არის");
  assert.equal(item.pickup.timeKnown, false);
  assert.doesNotMatch(item.pickup.combined, /00:01/);
  assert.equal(item.submittedAt, "23 ოქტომბერი, 2026 — 00:01");
});
