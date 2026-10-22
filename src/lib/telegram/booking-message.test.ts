import { test } from "node:test";
import assert from "node:assert/strict";
import { adminDashboardUrl, bookingNotificationMessage, cleanText, readBookingNotificationPayload } from "./booking-message.ts";

const PAYLOAD = {
  reference: "DRV-2026-000001",
  pickup_city: "თბილისი",
  delivery_city: "რუსთავი",
  vehicle_make: "TEST",
  vehicle_model: "TEST",
  submitted_at: "2026-10-23T00:01",
  requested_date: "2026-10-29",
  requested_time: "10:00",
};

test("the booking notification shows the requested pickup date and time, not the submission time", () => {
  const b = readBookingNotificationPayload(PAYLOAD);
  assert.ok(b);
  const text = bookingNotificationMessage(b!, { adminUrl: "https://driveo.ge/admin" });
  assert.equal(
    text,
    [
      "🚗 DRIVEO — ახალი შეკვეთა",
      "🆔 შეკვეთა: DRV-2026-000001",
      "📍 მარშრუტი: თბილისი → რუსთავი",
      "📅 გაყვანის თარიღი: 29 ოქტომბერი, 2026",
      "🕐 გაყვანის დრო: 10:00",
      "📋 სტატუსი: მიღებული",
      "🔗 დეტალები: Admin Dashboard — https://driveo.ge/admin",
    ].join("\n"),
  );
  assert.doesNotMatch(text, /00:01|2026-10-23/);
});

test("older payloads without pickup fields get explicit fallbacks", () => {
  const { requested_date: _d, requested_time: _t, ...old } = PAYLOAD;
  void _d;
  void _t;
  const text = bookingNotificationMessage(readBookingNotificationPayload(old)!, { adminUrl: null });
  assert.match(text, /📅 გაყვანის თარიღი: თარიღი მითითებული არ არის/);
  assert.match(text, /🕐 გაყვანის დრო: დრო მითითებული არ არის/);
  assert.match(text, /🔗 დეტალები: Admin Dashboard$/);
});

test("nothing outside the payload allowlist can appear, and text is cleaned", () => {
  const injected = { ...PAYLOAD, phone: "+995555000111", full_name: "ტესტი ტესტაძე", pickup_city: `თბილისი${String.fromCharCode(0x202e)}\n*bold*` };
  const text = bookingNotificationMessage(readBookingNotificationPayload(injected)!, { adminUrl: null });
  assert.doesNotMatch(text, /\+995|ტესტაძე/);
  assert.equal(text.split("\n").length, 7);
  assert.equal(cleanText(`a${String.fromCharCode(0)}b${String.fromCharCode(0x202e)}c  d`), "abc d");
  assert.equal(cleanText("x".repeat(100)).length, 60);
});

test("invalid payloads are refused", () => {
  for (const p of [null, "x", {}, { ...PAYLOAD, reference: "123" }, { ...PAYLOAD, pickup_city: 5 }]) {
    assert.equal(readBookingNotificationPayload(p), null, JSON.stringify(p));
  }
});

test("admin links only from a clean configured origin", () => {
  assert.equal(adminDashboardUrl("https://driveo.ge"), "https://driveo.ge/admin");
  assert.equal(adminDashboardUrl("https://driveo.ge/"), "https://driveo.ge/admin");
  assert.equal(adminDashboardUrl("http://localhost:3000"), "http://localhost:3000/admin");
  for (const bad of [undefined, "", "driveo.ge", "http://driveo.ge", "https://user:pw@driveo.ge", "https://driveo.ge/x", "https://driveo.ge?t=1", "javascript:alert(1)"]) {
    assert.equal(adminDashboardUrl(bad), null, String(bad));
  }
});
