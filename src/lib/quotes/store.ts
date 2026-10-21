import type { ServiceQuote } from "../pricing/engine-types.ts";

/**
 * Where issued quotes live between pricing and booking. The in-memory store
 * is for development and tests only: it is per-process, lost on restart and
 * refuses to run in production. Authoritative persistence (with separate,
 * purgeable provider data) is a Step 1.7 requirement.
 */
export interface QuoteStore {
  get(quoteId: string): Promise<ServiceQuote | null>;
  /** Inserts or replaces a quote by id. */
  save(quote: ServiceQuote): Promise<void>;
}

export function createInMemoryQuoteStore(): QuoteStore {
  if (globalThis.process?.env?.NODE_ENV === "production") {
    throw new Error("The in-memory quote store must never be used in production");
  }
  const quotes = new Map<string, ServiceQuote>();
  return {
    async get(id) {
      return quotes.get(id) ?? null;
    },
    async save(quote) {
      quotes.set(quote.quoteId, quote);
    },
  };
}

/** Store used where persistence is not configured: nothing can be saved or found. */
export const unavailableQuoteStore: QuoteStore = {
  async get() {
    return null;
  },
  async save() {
    throw new Error("Quote persistence is not configured");
  },
};
