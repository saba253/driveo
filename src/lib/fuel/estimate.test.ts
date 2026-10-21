import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gel } from "../pricing/money.ts";
import { estimateEnergy } from "./estimate.ts";
import type { EnergyPrice, VehicleConsumption } from "./types.ts";

/* TEST FIXTURES ONLY — not market prices or real vehicle data. */
const source = { name: "fixture", updatedAt: "2026-10-21T00:00:00Z" };
const petrolPrice: EnergyPrice = { carrier: "petrol", unit: "l", pricePerUnit: gel(3), source };
const petrolUse: VehicleConsumption = { carrier: "petrol", unit: "l", per100km: 7.5, source: "customer" };
const kwhPrice: EnergyPrice = { carrier: "electricity", unit: "kWh", pricePerUnit: gel(0.3), source };
const evUse: VehicleConsumption = { carrier: "electricity", unit: "kWh", per100km: 16, source: "manufacturer" };

describe("estimateEnergy", () => {
  it("estimates litres and cost for a liquid fuel", () => {
    const e = estimateEnergy({ distanceKm: 200, carrier: "petrol", consumption: petrolUse, price: petrolPrice });
    assert.equal(e.status, "estimated");
    if (e.status !== "estimated") return;
    assert.equal(e.unit, "l");
    assert.equal(e.quantity, 15);
    assert.equal(e.cost.amountMinor, 4500);
    assert.equal(e.basis.price.source.updatedAt, "2026-10-21T00:00:00Z");
    assert.equal(e.includedInServicePrice, false);
  });

  it("estimates electric vehicles in kWh, never per litre", () => {
    const e = estimateEnergy({ distanceKm: 150, carrier: "electricity", consumption: evUse, price: kwhPrice });
    assert.equal(e.status, "estimated");
    if (e.status !== "estimated") return;
    assert.equal(e.unit, "kWh");
    assert.equal(e.quantity, 24);
    assert.equal(e.cost.amountMinor, 720);
  });

  it("refuses a per-litre price for an electric vehicle", () => {
    const wrong = { ...kwhPrice, unit: "l" } as EnergyPrice;
    const e = estimateEnergy({ distanceKm: 150, carrier: "electricity", consumption: evUse, price: wrong });
    assert.deepEqual([e.status, e.status === "unavailable" && e.reason], ["unavailable", "unitMismatch"]);
  });

  it("returns 'unavailable' instead of guessing", () => {
    const cases = [
      [{ distanceKm: 0, carrier: "petrol", consumption: petrolUse, price: petrolPrice }, "invalidDistance"],
      [{ distanceKm: 100, carrier: "petrol", consumption: null, price: petrolPrice }, "noConsumption"],
      [{ distanceKm: 100, carrier: "petrol", consumption: petrolUse, price: null }, "noPrice"],
      [{ distanceKm: 100, carrier: "diesel", consumption: petrolUse, price: petrolPrice }, "carrierMismatch"],
    ] as const;
    for (const [input, reason] of cases) {
      const e = estimateEnergy(input);
      assert.equal(e.status, "unavailable");
      assert.equal(e.status === "unavailable" && e.reason, reason);
    }
  });
});
