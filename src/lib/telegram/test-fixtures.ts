/**
 * TEST FIXTURES ONLY (lint forbids importing this from application code).
 *
 * Fake Telegram bot tokens for tests. They are assembled at runtime so no
 * token-shaped literal ever appears in source, and they cannot be mistaken
 * for real credentials: real tokens have an 8–10 digit bot id and a secret
 * starting with "AA"; these use a 6-digit zero id and say what they are.
 * They still satisfy DRIVEO's own format check, so validation paths are tested.
 */

const part = (...s: string[]) => s.join("");

/** Passes BOT_TOKEN_PATTERN; not a usable Telegram token. */
export const FAKE_BOT_TOKEN = [part("000", "000"), part("TEST-ONLY", "-not-a-real-telegram-", "token-xyz")].join(":");

/** A second, different fake token. */
export const OTHER_FAKE_BOT_TOKEN = [part("000", "001"), part("TEST-ONLY", "-another-fake-telegram-", "token")].join(":");

/** Token-shaped text for checks that refuse anything resembling a token (DB error-summary guard). */
export const TOKEN_SHAPED_TEXT = [part("000", "002"), "x".repeat(24)].join(":");
