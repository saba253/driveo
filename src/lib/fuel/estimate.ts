import { money } from "../pricing/money.ts";
import { CARRIER_UNIT, type EnergyEstimate, type EnergyEstimateInput } from "./types.ts";

/**
 * Pure energy estimate: quantity = distance × consumption / 100, cost = quantity × price.
 * Returns "unavailable" (never a guess) when consumption or price is unknown
 * or inconsistent. The result is informational and never added to a service quote.
 */
export function estimateEnergy(input: EnergyEstimateInput): EnergyEstimate {
  const { distanceKm, carrier, consumption, price } = input;
  const unavailable = (reason: Extract<EnergyEstimate, { status: "unavailable" }>["reason"]): EnergyEstimate => ({
    status: "unavailable",
    carrier,
    reason,
    includedInServicePrice: false,
  });

  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return unavailable("invalidDistance");
  if (!consumption || !Number.isFinite(consumption.per100km) || consumption.per100km <= 0) return unavailable("noConsumption");
  if (!price) return unavailable("noPrice");
  if (consumption.carrier !== carrier || price.carrier !== carrier) return unavailable("carrierMismatch");

  const unit = CARRIER_UNIT[carrier];
  if (consumption.unit !== unit || price.unit !== unit) return unavailable("unitMismatch");

  const quantity = Math.round(((distanceKm * consumption.per100km) / 100) * 100) / 100;
  const cost = money(Math.round(quantity * price.pricePerUnit.amountMinor), price.pricePerUnit.currency);

  return {
    status: "estimated",
    carrier,
    unit,
    quantity,
    cost,
    basis: { distanceKm, per100km: consumption.per100km, consumptionSource: consumption.source, price },
    includedInServicePrice: false,
  };
}
