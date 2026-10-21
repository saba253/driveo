import { projectRefOf } from "./config.ts";

/**
 * Guard for the live security check (scripts/live-security-check.ts): it may
 * only ever run against a project the founder has explicitly marked as the
 * DEVELOPMENT project, and never in a production environment.
 */
export type LiveTarget = { ok: true; url: string; projectRef: string } | { ok: false; reason: string };

export function checkLiveTarget(env: Record<string, string | undefined>): LiveTarget {
  if (env.NODE_ENV === "production") return { ok: false, reason: "refusing to run with NODE_ENV=production" };
  if (env.DRIVEO_LIVE_TARGET !== "development") return { ok: false, reason: "set DRIVEO_LIVE_TARGET=development to confirm the target" };
  const url = env.SUPABASE_URL?.trim().replace(/\/$/, "") ?? "";
  const ref = projectRefOf(url);
  if (!ref) return { ok: false, reason: "SUPABASE_URL is not a hosted project URL" };
  if (env.DRIVEO_LIVE_PROJECT_REF !== ref) return { ok: false, reason: "DRIVEO_LIVE_PROJECT_REF must equal the project ref in SUPABASE_URL" };
  if (env.DRIVEO_PRODUCTION_PROJECT_REF && env.DRIVEO_PRODUCTION_PROJECT_REF === ref) {
    return { ok: false, reason: "this is the production project" };
  }
  return { ok: true, url, projectRef: ref };
}

/** The schema is not exposed through the Data API. */
export const SCHEMA_NOT_EXPOSED = "PGRST106";
