/**
 * Central brand configuration.
 * DRIVEO. is a temporary working name — replace values here to rebrand.
 * Never hardcode the brand name, domain or contacts elsewhere in the app.
 */
export const brand = {
  /** Wordmark text, without the trailing accent mark. */
  name: "DRIVEO",
  /** Trailing mark rendered in the accent colour after the name. */
  mark: ".",
  /** Plain-text name for metadata, alt text and screen readers. */
  displayName: "DRIVEO.",
  /** Placeholder until a domain is registered. */
  url: "http://localhost:3000",
  locale: "ka_GE",
  /** Contact details are placeholders until verified — render nothing when null. */
  contact: {
    phone: null as string | null,
    email: null as string | null,
    telegram: null as string | null,
  },
  /**
   * Hero photograph. While null, the hero uses a CSS/SVG cinematic treatment.
   * To use a photo: add an optimized image under /public/images (≈2400px wide,
   * dark, subject on the right) and set e.g. { src: "/images/hero.jpg", width: 2400, height: 1600 }.
   * Alt text lives in content (hero.imageAlt).
   */
  heroImage: null as { src: string; width: number; height: number } | null,
} as const;

export type Brand = typeof brand;
