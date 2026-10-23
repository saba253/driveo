import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DRAFT_MAX_AGE_MS,
  DRAFT_STORAGE_KEY,
  clearDraft,
  hasDraftData,
  parseSavedDraft,
  readDraft,
  restorePosition,
  serializeDraft,
  writeDraft,
  type DraftStorage,
  type SavedDraft,
} from "./draft-storage.ts";
import { FUEL_POLICY } from "./policies.ts";
import { EMPTY_DRAFT, type BookingDraft } from "./types.ts";

const NOW_MS = Date.UTC(2026, 9, 24, 8, 0);
const NOW = { date: "2026-10-24", time: "12:00" };
const KEY = "3b241101-e2bb-4255-8caf-4136c566a962";

const VALID: BookingDraft = {
  pickupCity: "თბილისი",
  pickupCityOther: "",
  pickupAddress: "ჭავჭავაძის გამზ. 1",
  deliveryCity: "ბათუმი",
  deliveryCityOther: "",
  deliveryAddress: "რუსთაველის ქ. 10",
  pickupDate: "2026-10-27",
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

const saved = (over: Partial<SavedDraft> = {}): SavedDraft => ({
  draft: VALID,
  stage: "review",
  savedAt: NOW_MS - 60_000,
  pendingSubmissionId: null,
  ...over,
});

function memoryStorage(initial: Record<string, string> = {}): DraftStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
}

const throwing: DraftStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

describe("hasDraftData", () => {
  it("is false for an empty or whitespace-only form", () => {
    assert.equal(hasDraftData(EMPTY_DRAFT), false);
    assert.equal(hasDraftData({ ...EMPTY_DRAFT, pickupAddress: "   " }), false);
  });
  it("is true once anything is entered or ticked", () => {
    assert.equal(hasDraftData({ ...EMPTY_DRAFT, pickupCity: "თბილისი" }), true);
    assert.equal(hasDraftData({ ...EMPTY_DRAFT, vehicleDrivable: true }), true);
  });
});

describe("parseSavedDraft", () => {
  it("round-trips a saved draft", () => {
    assert.deepEqual(parseSavedDraft(serializeDraft(saved()), NOW_MS), saved());
  });

  it("rejects malformed, foreign and empty input without throwing", () => {
    for (const raw of [null, "", "{", "null", "42", '"text"', "[]", JSON.stringify({ v: 2, ...saved() })]) {
      assert.equal(parseSavedDraft(raw, NOW_MS), null, String(raw));
    }
    assert.equal(parseSavedDraft(serializeDraft(saved({ draft: EMPTY_DRAFT })), NOW_MS), null);
  });

  it("discards drafts older than 24 hours or dated in the future", () => {
    assert.ok(parseSavedDraft(serializeDraft(saved({ savedAt: NOW_MS - DRAFT_MAX_AGE_MS + 1000 })), NOW_MS));
    assert.equal(parseSavedDraft(serializeDraft(saved({ savedAt: NOW_MS - DRAFT_MAX_AGE_MS - 1 })), NOW_MS), null);
    assert.equal(parseSavedDraft(serializeDraft(saved({ savedAt: NOW_MS + 60 * 60 * 1000 })), NOW_MS), null);
    assert.equal(parseSavedDraft(JSON.stringify({ ...JSON.parse(serializeDraft(saved())), savedAt: "yesterday" }), NOW_MS), null);
  });

  it("never restores the final screens", () => {
    for (const stage of ["done", "received", "submitting", "anything"]) {
      const raw = JSON.stringify({ ...JSON.parse(serializeDraft(saved())), stage });
      assert.equal(parseSavedDraft(raw, NOW_MS), null, stage);
    }
  });

  it("drops fields of the wrong type, unknown fields and oversized text", () => {
    const raw = JSON.parse(serializeDraft(saved()));
    raw.draft.vehicleDrivable = "yes";
    raw.draft.powertrain = "jet";
    raw.draft.transmission = 3;
    raw.draft.vehicleModel = "x".repeat(5000);
    raw.draft.isAdmin = true;
    const parsed = parseSavedDraft(JSON.stringify(raw), NOW_MS);
    assert.ok(parsed);
    assert.equal(parsed.draft.vehicleDrivable, false);
    assert.equal(parsed.draft.powertrain, "");
    assert.equal(parsed.draft.transmission, "");
    assert.equal(parsed.draft.vehicleModel, "");
    assert.equal("isAdmin" in parsed.draft, false);
    assert.equal(parsed.draft.customerName, VALID.customerName);
  });

  it("asks for the fuel terms again when their version changed", () => {
    const raw = { ...JSON.parse(serializeDraft(saved())), policyVersion: FUEL_POLICY.version - 1 };
    assert.equal(parseSavedDraft(JSON.stringify(raw), NOW_MS)?.draft.fuelPolicyAccepted, false);
  });

  it("keeps only a well-formed pending submission key", () => {
    assert.equal(parseSavedDraft(serializeDraft(saved({ pendingSubmissionId: KEY.toUpperCase() })), NOW_MS)?.pendingSubmissionId, KEY);
    assert.equal(parseSavedDraft(serializeDraft(saved({ pendingSubmissionId: "not-a-uuid" })), NOW_MS)?.pendingSubmissionId, null);
  });

  it("stores no errors, honeypot or submission state", () => {
    const stored = JSON.parse(serializeDraft(saved()));
    assert.deepEqual(Object.keys(stored).sort(), ["draft", "pendingSubmissionId", "policyVersion", "savedAt", "stage", "v"]);
    assert.deepEqual(Object.keys(stored.draft).sort(), Object.keys(EMPTY_DRAFT).sort());
  });
});

describe("restorePosition", () => {
  it("resumes the saved stage when everything before it is still valid", () => {
    assert.deepEqual(restorePosition(VALID, "review", NOW), { stage: "review", errors: {}, attempted: null });
    // The stage being filled in is resumed as it was, without showing errors for unfinished fields.
    const halfway = { ...VALID, customerName: "", customerPhone: "", fuelPolicyAccepted: false };
    assert.deepEqual(restorePosition(halfway, "contact", NOW), { stage: "contact", errors: {}, attempted: null });
  });

  it("reopens the first completed stage that is no longer valid, with its errors", () => {
    const pastDate = { ...VALID, pickupDate: "2026-10-23" };
    const position = restorePosition(pastDate, "review", NOW);
    assert.equal(position.stage, "route");
    assert.equal(position.attempted, "route");
    assert.ok(position.errors.pickupDate);

    const timePassedToday = { ...VALID, pickupDate: NOW.date, pickupTime: "09:00" };
    assert.equal(restorePosition(timePassedToday, "contact", NOW).stage, "route");

    const vehicleChanged = { ...VALID, vehicleDrivable: false };
    assert.equal(restorePosition(vehicleChanged, "review", NOW).stage, "vehicle");
  });
});

describe("storage access", () => {
  it("writes, reads back and clears", () => {
    const storage = memoryStorage();
    writeDraft(storage, saved());
    assert.ok(storage.data[DRAFT_STORAGE_KEY]);
    assert.deepEqual(readDraft(storage, NOW_MS), saved());
    clearDraft(storage);
    assert.equal(DRAFT_STORAGE_KEY in storage.data, false);
  });

  it("removes a malformed or expired entry when reading it", () => {
    const storage = memoryStorage({ [DRAFT_STORAGE_KEY]: "{broken" });
    assert.equal(readDraft(storage, NOW_MS), null);
    assert.equal(DRAFT_STORAGE_KEY in storage.data, false);

    storage.data[DRAFT_STORAGE_KEY] = serializeDraft(saved({ savedAt: NOW_MS - DRAFT_MAX_AGE_MS - 1 }));
    assert.equal(readDraft(storage, NOW_MS), null);
    assert.equal(DRAFT_STORAGE_KEY in storage.data, false);
  });

  it("never throws when storage is blocked, full or missing", () => {
    assert.equal(readDraft(throwing, NOW_MS), null);
    assert.doesNotThrow(() => writeDraft(throwing, saved()));
    assert.doesNotThrow(() => clearDraft(throwing));
    assert.equal(readDraft(null, NOW_MS), null);
    assert.doesNotThrow(() => writeDraft(null, saved()));
  });
});
