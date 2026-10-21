-- =============================================================================
-- DRIVEO — row level security and privileges (Step 1.7B.1)
--
-- Model
--  * anon (browsers without a session): NO table access, NO function access.
--  * authenticated: SELECT only, and RLS lets only an ACTIVE admin at AAL2 see rows
--    (plus a user's own admin_users row, so the server can route to MFA setup).
--    Writes only through the admin_* functions, which re-check admin + AAL2.
--  * service_role (Next.js server only): NO direct table access — it can only call
--    the submission / notification-worker / rate-limit / pairing functions.
--    service_role bypasses RLS by design, so grants are the control for it.
--  * driveo_private is never added to the API "exposed schemas"; its tables have no
--    grants at all.
--  * No views are created. Any future view must use security_invoker = true.
-- Supabase grants broad default privileges to anon/authenticated/service_role on
-- objects in public; everything below explicitly revokes them first.
-- =============================================================================

-- --------------------------------------------------------------- table privileges

revoke all on table
  public.admin_users, public.drivers, public.bookings, public.booking_contacts,
  public.booking_status_events, public.price_proposals, public.price_acceptances, public.admin_audit_log
from public, anon, authenticated, service_role;

grant select on table
  public.admin_users, public.drivers, public.bookings, public.booking_contacts,
  public.booking_status_events, public.price_proposals, public.price_acceptances, public.admin_audit_log
to authenticated;

revoke all on sequence public.booking_status_events_id_seq, public.admin_audit_log_id_seq
from public, anon, authenticated, service_role;

revoke all on all tables in schema driveo_private from public, anon, authenticated, service_role;
revoke all on all sequences in schema driveo_private from public, anon, authenticated, service_role;

-- ------------------------------------------------------------ function privileges

-- PostgreSQL grants EXECUTE to PUBLIC by default, and Supabase also grants it to
-- anon/authenticated/service_role on new functions in public. Revoke everything, then
-- grant exactly what each role needs.
revoke all on all functions in schema public from public, anon, authenticated, service_role;
revoke all on all functions in schema driveo_private from public, anon, authenticated, service_role;

-- Future objects created by the migration role start closed too.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema driveo_private revoke execute on functions from public;

-- RLS policies call these two helpers with the caller's privileges.
grant usage on schema driveo_private to authenticated;
grant execute on function driveo_private.current_aal(), driveo_private.is_admin() to authenticated;

grant execute on function
  public.admin_transition_booking(uuid, text, text),
  public.admin_create_price_proposal(uuid, integer, jsonb),
  public.admin_mark_proposal_sent(uuid, text),
  public.admin_record_price_acceptance(uuid, text, text, text, timestamptz, integer),
  public.admin_retry_notification(uuid),
  public.admin_notification_history(uuid),
  public.admin_start_telegram_pairing(text),
  public.admin_verify_telegram_pairing(uuid, text, text)
to authenticated;

grant execute on function
  public.submit_booking_request(uuid, text, jsonb, jsonb, text),
  public.claim_notification_events(integer, integer),
  public.record_notification_attempt(uuid, text, text, text, integer, text, text),
  public.complete_notification_event(uuid, text, integer),
  public.consume_rate_limit(text, integer, integer),
  public.attach_telegram_pairing_code(uuid, text, text)
to service_role;

-- ------------------------------------------------------------------------ RLS

alter table public.admin_users           enable row level security;
alter table public.drivers               enable row level security;
alter table public.bookings              enable row level security;
alter table public.booking_contacts      enable row level security;
alter table public.booking_status_events enable row level security;
alter table public.price_proposals       enable row level security;
alter table public.price_acceptances     enable row level security;
alter table public.admin_audit_log       enable row level security;

alter table driveo_private.notification_outbox         enable row level security;
alter table driveo_private.notification_attempts       enable row level security;
alter table driveo_private.telegram_pairing_challenges enable row level security;
alter table driveo_private.rate_limit_counters         enable row level security;
-- driveo_private tables get no policies: every non-owner, non-bypass access is denied.

-- admin_users: a signed-in user may see only their own row (needed before MFA to know
-- whether to show enrollment); a full admin at AAL2 may see all rows.
create policy admin_users_select_own on public.admin_users
  for select to authenticated using (user_id = (select auth.uid()));
create policy admin_users_select_admin on public.admin_users
  for select to authenticated using ((select driveo_private.is_admin()));

create policy drivers_select_admin on public.drivers
  for select to authenticated using ((select driveo_private.is_admin()));
create policy bookings_select_admin on public.bookings
  for select to authenticated using ((select driveo_private.is_admin()));
create policy booking_contacts_select_admin on public.booking_contacts
  for select to authenticated using ((select driveo_private.is_admin()));
create policy booking_status_events_select_admin on public.booking_status_events
  for select to authenticated using ((select driveo_private.is_admin()));
create policy price_proposals_select_admin on public.price_proposals
  for select to authenticated using ((select driveo_private.is_admin()));
create policy price_acceptances_select_admin on public.price_acceptances
  for select to authenticated using ((select driveo_private.is_admin()));
create policy admin_audit_log_select_admin on public.admin_audit_log
  for select to authenticated using ((select driveo_private.is_admin()));

-- Belt and braces: business tables are never visible below AAL2, even if a future
-- permissive policy is added by mistake.
create policy drivers_require_aal2 on public.drivers as restrictive
  for all to authenticated using ((select driveo_private.current_aal()) = 'aal2');
create policy bookings_require_aal2 on public.bookings as restrictive
  for all to authenticated using ((select driveo_private.current_aal()) = 'aal2');
create policy booking_contacts_require_aal2 on public.booking_contacts as restrictive
  for all to authenticated using ((select driveo_private.current_aal()) = 'aal2');
create policy booking_status_events_require_aal2 on public.booking_status_events as restrictive
  for all to authenticated using ((select driveo_private.current_aal()) = 'aal2');
create policy price_proposals_require_aal2 on public.price_proposals as restrictive
  for all to authenticated using ((select driveo_private.current_aal()) = 'aal2');
create policy price_acceptances_require_aal2 on public.price_acceptances as restrictive
  for all to authenticated using ((select driveo_private.current_aal()) = 'aal2');
create policy admin_audit_log_require_aal2 on public.admin_audit_log as restrictive
  for all to authenticated using ((select driveo_private.current_aal()) = 'aal2');
