/**
 * TEST FIXTURES ONLY (lint forbids importing this from application code).
 * Fictional booking data used by the submission tests.
 */
import type { BookingDraft } from "./types.ts";

/** Valid against a "now" of 2026-10-22 09:00 Tbilisi. Fictional person, phone and addresses. */
export const VALID_DRAFT: BookingDraft = {
  pickupCity: "თბილისი",
  pickupCityOther: "",
  pickupAddress: "სატესტო ქუჩა 1",
  deliveryCity: "რუსთავი",
  deliveryCityOther: "",
  deliveryAddress: "სატესტო გამზირი 2",
  pickupDate: "2026-11-02",
  pickupTime: "10:00",
  vehicleMake: "Toyota",
  vehicleModel: "Prius",
  powertrain: "hybrid",
  transmission: "automatic",
  vehicleDrivable: true,
  customerName: "ტესტი ტესტაძე",
  customerPhone: "555 12 34 56",
  fuelPolicyAccepted: true,
};
