/**
 * Booking domain types — independent of UI, storage and transport.
 *
 * Modules under src/lib use relative imports with explicit `.ts` extensions
 * and no framework code, so they run unchanged in Node's test runner and,
 * later, on the server.
 */

export const POWERTRAINS = ["petrol", "diesel", "lpg", "cng", "hybrid", "plugin_hybrid", "electric"] as const;
export type Powertrain = (typeof POWERTRAINS)[number];

export const TRANSMISSIONS = ["automatic", "manual"] as const;
export type Transmission = (typeof TRANSMISSIONS)[number];

/** Raw form state: everything the customer can type or toggle, as entered. */
export type BookingDraft = {
  pickupCity: string;
  pickupAddress: string;
  deliveryCity: string;
  deliveryAddress: string;
  /** Local date, YYYY-MM-DD. */
  pickupDate: string;
  /** Local 24h time, HH:MM. */
  pickupTime: string;
  vehicleMake: string;
  vehicleModel: string;
  powertrain: Powertrain | "";
  transmission: Transmission | "";
  vehicleDrivable: boolean;
  customerName: string;
  customerPhone: string;
  fuelPolicyAccepted: boolean;
};

export type BookingField = keyof BookingDraft;

export const EMPTY_DRAFT: BookingDraft = {
  pickupCity: "",
  pickupAddress: "",
  deliveryCity: "",
  deliveryAddress: "",
  pickupDate: "",
  pickupTime: "",
  vehicleMake: "",
  vehicleModel: "",
  powertrain: "",
  transmission: "",
  vehicleDrivable: false,
  customerName: "",
  customerPhone: "",
  fuelPolicyAccepted: false,
};

export type Place = { city: string; address: string };

/** A validated, normalized request — the shape a future API will accept. */
export type BookingRequest = {
  route: { pickup: Place; delivery: Place };
  vehicle: {
    make: string;
    model: string;
    powertrain: Powertrain;
    transmission: Transmission;
    drivableConfirmed: true;
  };
  schedule: {
    preferredDate: string;
    preferredTime: string;
    /** The time is a preference; availability is confirmed by the driver. */
    isPreferenceOnly: true;
  };
  contact: {
    name: string;
    /** E.164, e.g. +995555123456. */
    phone: string;
  };
  acknowledgements: {
    fuelPolicy: { accepted: true; policyId: string; policyVersion: string };
  };
  meta: {
    source: "web";
    status: BookingStatus;
    /** Reserved for multi-driver dispatch; always null while there is one driver. */
    assignedDriverId: string | null;
  };
};

/** Lifecycle a request will move through once a backend exists. */
export type BookingStatus = "draft" | "submitted" | "quoted" | "confirmed" | "declined" | "completed" | "cancelled";
