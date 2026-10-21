import type { Powertrain } from "../booking/types.ts";
import type { Money } from "../pricing/money.ts";

/**
 * Energy model for future fuel/charging estimates. Always separate from the
 * driver service price: under the approved policy the customer provides the
 * fuel, and any extra refuelling is reimbursed at actual cost with receipts.
 *
 * Each carrier has its own unit, so an electric vehicle is never given a
 * "price per litre".
 */

export type EnergyCarrier = "petrol" | "diesel" | "lpg" | "cng" | "electricity";
export type EnergyUnit = "l" | "m3" | "kWh";

/** Unit each carrier is sold and consumed in (CNG is sold per m³ in Georgia). */
export const CARRIER_UNIT = {
  petrol: "l",
  diesel: "l",
  lpg: "l",
  cng: "m3",
  electricity: "kWh",
} as const satisfies Record<EnergyCarrier, EnergyUnit>;

/**
 * Carriers a powertrain can run on, primary first. Bi-fuel and plug-in
 * vehicles need the customer (or a future vehicle database) to say which applies.
 */
export const POWERTRAIN_CARRIERS = {
  petrol: ["petrol"],
  diesel: ["diesel"],
  lpg: ["lpg", "petrol"],
  cng: ["cng", "petrol"],
  hybrid: ["petrol"],
  plugin_hybrid: ["petrol", "electricity"],
  electric: ["electricity"],
} as const satisfies Record<Powertrain, readonly EnergyCarrier[]>;

/** Where a number came from — estimates must always be traceable. */
export type DataSource = {
  name: string;
  url?: string;
  /** ISO timestamp of the last update at the source. */
  updatedAt: string;
};

export type EnergyPrice = {
  carrier: EnergyCarrier;
  unit: EnergyUnit;
  /** Price per one unit, in minor units (tetri). */
  pricePerUnit: Money;
  source: DataSource;
};

export type VehicleConsumption = {
  carrier: EnergyCarrier;
  unit: EnergyUnit;
  /** Units per 100 km (l/100km, m³/100km or kWh/100km). */
  per100km: number;
  source: "customer" | "manufacturer" | "vehicleDatabase";
};

export type EnergyEstimateInput = {
  distanceKm: number;
  carrier: EnergyCarrier;
  consumption?: VehicleConsumption | null;
  price?: EnergyPrice | null;
};

export type EnergyEstimateUnavailableReason =
  | "invalidDistance"
  | "noConsumption"
  | "noPrice"
  | "carrierMismatch"
  | "unitMismatch";

export type EnergyEstimate =
  | {
      status: "estimated";
      carrier: EnergyCarrier;
      unit: EnergyUnit;
      /** Estimated quantity, rounded to 0.01 of a unit. */
      quantity: number;
      cost: Money;
      basis: { distanceKm: number; per100km: number; consumptionSource: VehicleConsumption["source"]; price: EnergyPrice };
      /** Fixed: fuel never contributes to the service price. */
      includedInServicePrice: false;
    }
  | {
      status: "unavailable";
      carrier: EnergyCarrier;
      reason: EnergyEstimateUnavailableReason;
      includedInServicePrice: false;
    };
