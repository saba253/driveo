/**
 * Phone parsing for Georgian customers, tolerant of how people type numbers.
 *
 * Accepted:
 *  - Georgian national numbers (9 digits): "555 12 34 56", "555-123-456", "322 12 34 56"
 *  - Georgian international forms: "+995 555 12 34 56", "00995555123456", "995555123456"
 *  - Other countries in international form: "+49 151 23456789" (E.164, 8–15 digits)
 */
export type ParsedPhone = { e164: string; isGeorgian: boolean };

const GEORGIA_CODE = "995";
/* Georgian national significant numbers are 9 digits: 3xx/4xx landlines, 5xx mobile, 7xx non-geographic. */
const GEORGIAN_NATIONAL = /^[3457]\d{8}$/;

export function parsePhone(input: string): ParsedPhone | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Only digits, spaces, dashes, dots, parentheses and one leading "+" (optionally in brackets: "(+995)").
  if (!/^\(?\+?[\d\s().-]+$/.test(trimmed)) return null;

  const hasPlus = /^\(?\+/.test(trimmed);
  let digits = trimmed.replace(/\D/g, "");
  let international = hasPlus;

  if (!hasPlus && digits.startsWith("00")) {
    digits = digits.slice(2);
    international = true;
  }

  if (!international) {
    if (GEORGIAN_NATIONAL.test(digits)) return { e164: `+${GEORGIA_CODE}${digits}`, isGeorgian: true };
    // "995555123456" typed without the plus.
    if (digits.startsWith(GEORGIA_CODE) && GEORGIAN_NATIONAL.test(digits.slice(3))) {
      return { e164: `+${digits}`, isGeorgian: true };
    }
    return null;
  }

  if (digits.startsWith(GEORGIA_CODE)) {
    const national = digits.slice(3);
    return GEORGIAN_NATIONAL.test(national) ? { e164: `+${digits}`, isGeorgian: true } : null;
  }

  // Other countries: E.164 allows up to 15 digits; country codes never start with 0.
  if (/^[1-9]\d{7,14}$/.test(digits)) return { e164: `+${digits}`, isGeorgian: false };
  return null;
}

/** Human-friendly display: "+995 555 12 34 56" for Georgian numbers, E.164 otherwise. */
export function formatPhone(phone: ParsedPhone): string {
  if (!phone.isGeorgian) return phone.e164;
  const n = phone.e164.slice(4);
  return `+995 ${n.slice(0, 3)} ${n.slice(3, 5)} ${n.slice(5, 7)} ${n.slice(7)}`;
}
