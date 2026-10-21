import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOKING_STATUSES, TERMINAL_STATUSES, TRANSITION_RULES, canTransition, manualTargets } from "./lifecycle.ts";

test("terminal statuses have no outgoing transitions", () => {
  for (const s of TERMINAL_STATUSES) assert.equal(TRANSITION_RULES.filter((r) => r.from === s).length, 0, s);
});

test("every non-terminal status can be left, and every status is reachable from submitted", () => {
  const reachable = new Set(["submitted"]);
  for (let i = 0; i < BOOKING_STATUSES.length; i++) for (const r of TRANSITION_RULES) if (reachable.has(r.from)) reachable.add(r.to);
  assert.deepEqual([...reachable].sort(), [...BOOKING_STATUSES].sort());
  for (const s of BOOKING_STATUSES) if (!TERMINAL_STATUSES.includes(s)) assert.ok(TRANSITION_RULES.some((r) => r.from === s), s);
});

test("confirmation is only possible after the customer accepted a price", () => {
  const intoConfirmed = TRANSITION_RULES.filter((r) => r.to === "confirmed");
  assert.deepEqual(intoConfirmed.map((r) => r.from), ["customer_accepted"]);
  assert.equal(canTransition("submitted", "confirmed"), false);
  assert.equal(canTransition("under_review", "confirmed"), false);
  assert.equal(canTransition("price_proposed", "confirmed"), false);
});

test("price stages cannot be set by a manual status change", () => {
  for (const s of BOOKING_STATUSES) {
    assert.equal(canTransition(s, "price_proposed", "manual"), false, s);
    assert.equal(canTransition(s, "customer_accepted", "manual"), false, s);
  }
  assert.ok(canTransition("under_review", "price_proposed", "proposal_sent"));
  assert.ok(canTransition("price_proposed", "customer_accepted", "acceptance_recorded"));
  assert.deepEqual(manualTargets("under_review"), ["info_requested", "declined", "cancelled"]);
});
