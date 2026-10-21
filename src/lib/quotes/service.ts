import { evaluateAutomaticPricingEligibility, type AutomaticPricingPolicy, type EligibilityResult } from "../pricing/eligibility.ts";
import type { ManualReason, PricingEngineConfig, QuoteDriver, QuoteRequest, RouteLookup, ServiceQuote, ServiceTariff } from "../pricing/engine-types.ts";
import { fingerprintQuoteInputs } from "../pricing/fingerprint.ts";
import { checkQuoteUsable, priceQuote, pricingContext, supersedeQuote, type UsabilityCheck } from "../pricing/quote.ts";
import type { RouteProvider, RouteRequest } from "../routing/types.ts";
import type { RateLimiter } from "../routing/usage.ts";
import { parseQuoteInput, type InputIssue, type QuoteInput } from "./input.ts";
import type { QuoteStore } from "./store.ts";

/**
 * Server-side quote orchestration:
 *
 *   rate limit → validate untrusted input → load tariff/config/driver →
 *   route (via RouteProvider) → price (priceQuote) → store → result
 *
 * The browser never supplies prices, tariffs, extras, overrides or drivers.
 * Every unsupported case returns manual pricing; nothing is substituted.
 * Results here are INTERNAL — use toPublicQuoteResponse() for customers.
 */

export type PricingSetup = {
  tariff: ServiceTariff | null;
  config: PricingEngineConfig | null;
  /** Driver with their own base; omitted → the config's default base (Tbilisi). */
  driver?: QuoteDriver | null;
};

export type QuoteServiceDeps = {
  routeProvider: RouteProvider;
  /**
   * Automatic-pricing gate (required). A request only receives a quote when
   * this policy says it is eligible; otherwise it goes to manual assessment.
   * Use DEFAULT_AUTOMATIC_PRICING_POLICY (everything disabled) until approved.
   */
  automaticPricingPolicy: AutomaticPricingPolicy;
  /** Loads the currently active pricing setup (tariff, configuration, driver). */
  loadPricingSetup: () => Promise<PricingSetup>;
  store: QuoteStore;
  rateLimiter?: RateLimiter;
  now?: () => Date;
  newId?: () => string;
  /** Development/tests only. Refused in production. */
  allowFixtures?: boolean;
  /** Development/tests only: accept trusted coordinates instead of place ids. Refused in production. */
  allowTestCoordinates?: boolean;
};

export type QuoteServiceResult =
  | { status: "rate_limited"; retryAfterMs: number }
  | { status: "invalid_input"; issues: InputIssue[] }
  | { status: "quoted"; quote: ServiceQuote; eligibility: EligibilityResult }
  | {
      status: "manual_pricing";
      requestId: string;
      inputFingerprint: string | null;
      /** Pricing-engine reasons (empty when only the eligibility gate refused). */
      reasons: readonly ManualReason[];
      /** Why automatic pricing was not allowed; includes the override audit trail. */
      eligibility: EligibilityResult;
    };

export type BookingCheck =
  | { ok: true; quote: ServiceQuote }
  | { ok: false; reason: "invalidInput"; issues: InputIssue[] }
  | { ok: false; reason: "unknownQuote" | "pricingNotConfigured" }
  /** The customer has not acknowledged this quote's exact total (e.g. after a price change). */
  | { ok: false; reason: "acknowledgementRequired"; priceChanged: boolean }
  | { ok: false; reason: Extract<UsabilityCheck, { usable: false }>["reason"] };

export class QuoteServiceConfigError extends Error {}

const isProductionRuntime = () => globalThis.process?.env?.NODE_ENV === "production";

function toRouteRequest(input: QuoteInput): RouteRequest {
  return {
    origin: { city: input.pickup.locality, address: input.pickup.address, placeId: input.pickup.placeId, coordinates: input.pickup.coordinates },
    destination: { city: input.delivery.locality, address: input.delivery.address, placeId: input.delivery.placeId, coordinates: input.delivery.coordinates },
  };
}

/** Customer input → engine request. Extras and overrides are never taken from customers. */
function toQuoteRequest(input: QuoteInput, requestId: string): QuoteRequest {
  return {
    requestId,
    pickup: { ...input.pickup },
    delivery: { ...input.delivery },
    schedule: { ...input.schedule },
    vehicle: { ...input.vehicle },
  };
}

export function createQuoteService(deps: QuoteServiceDeps) {
  if (isProductionRuntime() && (deps.allowFixtures || deps.allowTestCoordinates || deps.routeProvider.id.startsWith("mock"))) {
    throw new QuoteServiceConfigError("Fixtures, test coordinates and mock routing are not allowed in production");
  }
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => globalThis.crypto.randomUUID());
  const parse = (raw: unknown) => parseQuoteInput(raw, { now: now(), allowTestCoordinates: Boolean(deps.allowTestCoordinates) });

  async function requestQuote(raw: unknown, ctx: { clientKey: string }): Promise<QuoteServiceResult> {
    // 1. Abuse protection before any work or provider spend.
    if (deps.rateLimiter) {
      const limit = deps.rateLimiter.check(ctx.clientKey);
      if (!limit.allowed) return { status: "rate_limited", retryAfterMs: limit.retryAfterMs };
    }

    // 2. Untrusted input.
    const parsed = parse(raw);
    if (!parsed.ok) return { status: "invalid_input", issues: parsed.issues };
    const input = parsed.input;

    // 3. Re-quote chain.
    let previous: ServiceQuote | null = null;
    if (input.previousQuoteId) {
      previous = await deps.store.get(input.previousQuoteId);
      if (!previous || previous.supersededBy) return { status: "invalid_input", issues: [{ field: "previousQuoteId", code: "invalid" }] };
    }
    const requestId = previous?.requestId ?? newId();
    const request = toQuoteRequest(input, requestId);

    // 4. Pricing setup and eligibility gate. When automatic pricing is off, or
    //    there is no configuration or tariff, no provider call is made at all.
    const setup = await deps.loadPricingSetup();
    const nowIso = now().toISOString();
    const gate = (route: RouteLookup | null) =>
      evaluateAutomaticPricingEligibility({
        request,
        route,
        tariff: setup.tariff,
        config: setup.config,
        driver: setup.driver,
        policy: deps.automaticPricingPolicy,
        now: nowIso,
        allowFixtures: deps.allowFixtures,
      });

    if (!setup.config) {
      return {
        status: "manual_pricing",
        requestId,
        inputFingerprint: null,
        reasons: [{ code: "invalidConfig", detail: "no pricing configuration" }],
        eligibility: gate(null),
      };
    }
    if (!setup.tariff || !deps.automaticPricingPolicy.automaticPricingEnabled) {
      const fp = await fingerprintQuoteInputs(request, pricingContext(setup.tariff, setup.config, setup.driver));
      return {
        status: "manual_pricing",
        requestId,
        inputFingerprint: fp,
        reasons: setup.tariff ? [] : [{ code: "missingTariff" }],
        eligibility: gate(null),
      };
    }

    // 5. Road route through the provider abstraction (mock in this step).
    const route = await deps.routeProvider.computeRoute(toRouteRequest(input));

    // 6. Price.
    const outcome = await priceQuote({
      request,
      route,
      tariff: setup.tariff,
      config: setup.config,
      driver: setup.driver,
      meta: {
        quoteId: newId(),
        version: previous ? previous.version + 1 : 1,
        supersedes: previous?.quoteId ?? null,
        previousTotal: previous?.commercial.total ?? null,
        computedBy: "server",
        now: nowIso,
      },
      allowFixtures: deps.allowFixtures,
    });

    const eligibility = gate(route);
    if (outcome.status === "manual_pricing") {
      return { status: "manual_pricing", requestId, inputFingerprint: outcome.inputFingerprint, reasons: outcome.reasons, eligibility };
    }

    // 7. A computable price is not enough: ineligible requests never get a quote.
    if (!eligibility.eligible) {
      return { status: "manual_pricing", requestId, inputFingerprint: outcome.quote.inputFingerprint, reasons: [], eligibility };
    }

    // 8. Store; the previous version (if any) is marked superseded.
    if (previous) await deps.store.save(supersedeQuote(previous, outcome.quote));
    await deps.store.save(outcome.quote);
    return { status: "quoted", quote: outcome.quote, eligibility };
  }

  /**
   * Re-validates a quote right before a booking request: it must exist, be
   * authoritative, unexpired (server clock), not superseded, match the
   * submitted inputs AND the active tariff/configuration/driver, and the
   * customer must have acknowledged its exact total — so any price change
   * after a re-quote needs a fresh, explicit acknowledgement.
   */
  async function checkQuoteForBooking(
    quoteId: string,
    raw: unknown,
    acknowledgement: { totalMinor: number | null },
  ): Promise<BookingCheck> {
    const parsed = parse(raw);
    if (!parsed.ok) return { ok: false, reason: "invalidInput", issues: parsed.issues };
    const quote = await deps.store.get(quoteId);
    if (!quote) return { ok: false, reason: "unknownQuote" };

    const setup = await deps.loadPricingSetup();
    if (!setup.config) return { ok: false, reason: "pricingNotConfigured" };
    const fingerprint = await fingerprintQuoteInputs(
      toQuoteRequest(parsed.input, quote.requestId),
      pricingContext(setup.tariff, setup.config, setup.driver),
    );
    const usable = checkQuoteUsable(quote, { now: now().toISOString(), inputFingerprint: fingerprint });
    if (!usable.usable) return { ok: false, reason: usable.reason };
    if (acknowledgement.totalMinor !== quote.commercial.total.amountMinor) {
      return { ok: false, reason: "acknowledgementRequired", priceChanged: Boolean(quote.priceChange?.changed) };
    }
    return { ok: true, quote };
  }

  return { requestQuote, checkQuoteForBooking };
}

export type QuoteService = ReturnType<typeof createQuoteService>;
