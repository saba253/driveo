-- =============================================================================
-- DRIVEO — post-migration security checks (READ-ONLY)
--
-- Run in the Supabase SQL Editor of the DEVELOPMENT project after applying the
-- migrations. Query 1 must return ZERO rows: every row is a problem. Query 2 is
-- informational. Nothing here changes data or settings.
-- =============================================================================

-- Query 1 — problems (expect 0 rows)
with our_tables as (
  select c.oid, n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) as owner
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r' and n.nspname in ('public', 'driveo_private')
),
our_functions as (
  select p.oid, n.nspname, p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as owner
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'driveo_private')
),
expected_tables(nspname, relname) as (values
  ('public', 'admin_users'), ('public', 'drivers'), ('public', 'bookings'), ('public', 'booking_contacts'),
  ('public', 'booking_status_events'), ('public', 'price_proposals'), ('public', 'price_acceptances'),
  ('public', 'admin_audit_log'), ('driveo_private', 'notification_outbox'), ('driveo_private', 'notification_attempts'),
  ('driveo_private', 'telegram_pairing_challenges'), ('driveo_private', 'rate_limit_counters'),
  ('driveo_private', 'telegram_recipients'), ('driveo_private', 'telegram_test_sends')
),
admin_fns(name) as (values
  ('admin_transition_booking'), ('admin_create_price_proposal'), ('admin_mark_proposal_sent'),
  ('admin_record_price_acceptance'), ('admin_retry_notification'), ('admin_notification_history'),
  ('admin_start_telegram_pairing'), ('admin_verify_telegram_pairing'),
  ('admin_attach_telegram_pairing_code'), ('admin_telegram_status'), ('admin_telegram_send_target'),
  ('admin_revoke_telegram_recipient'), ('admin_claim_telegram_test_send'), ('admin_complete_telegram_test_send')
),
service_fns(name) as (values
  ('submit_booking_request'), ('claim_notification_events'), ('record_notification_attempt'),
  ('complete_notification_event'), ('consume_rate_limit'),
  ('worker_telegram_recipient'), ('claim_booking_notifications')
)
select 'missing table' as check, e.nspname || '.' || e.relname as detail
from expected_tables e where not exists (select 1 from our_tables t where t.nspname = e.nspname and t.relname = e.relname)
union all
select 'unexpected table', t.nspname || '.' || t.relname
from our_tables t where not exists (select 1 from expected_tables e where e.nspname = t.nspname and e.relname = t.relname)
union all
select 'RLS disabled', nspname || '.' || relname from our_tables where not relrowsecurity
union all
-- FORCE RLS would make the SECURITY DEFINER functions (run as the owner) subject to RLS and break them.
select 'FORCE RLS set (breaks definer functions)', nspname || '.' || relname from our_tables where relforcerowsecurity
union all
select 'table not owned by postgres', nspname || '.' || relname || ' owner=' || owner from our_tables where owner <> 'postgres'
union all
select 'anon has a table privilege', t.nspname || '.' || t.relname || ' ' || p.priv
from our_tables t cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as p(priv)
where has_table_privilege('anon', t.oid, p.priv)
union all
select 'service_role has a table privilege', t.nspname || '.' || t.relname || ' ' || p.priv
from our_tables t cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as p(priv)
where has_table_privilege('service_role', t.oid, p.priv)
union all
select 'authenticated has more than SELECT', t.nspname || '.' || t.relname || ' ' || p.priv
from our_tables t cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as p(priv)
where has_table_privilege('authenticated', t.oid, p.priv)
union all
select 'authenticated can read a private table', t.nspname || '.' || t.relname
from our_tables t where t.nspname = 'driveo_private' and has_table_privilege('authenticated', t.oid, 'SELECT')
union all
select 'authenticated cannot read a public table', t.nspname || '.' || t.relname
from our_tables t where t.nspname = 'public' and not has_table_privilege('authenticated', t.oid, 'SELECT')
union all
select 'function without empty search_path', nspname || '.' || proname
from our_functions where not coalesce(proconfig @> array['search_path=""'], false)
union all
select 'function not owned by postgres', nspname || '.' || proname || ' owner=' || owner from our_functions where owner <> 'postgres'
union all
select 'PUBLIC or anon can execute', f.nspname || '.' || f.proname
from our_functions f
where has_function_privilege('anon', f.oid, 'EXECUTE')
   or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = f.oid and a.grantee = 0 and a.privilege_type = 'EXECUTE')
union all
select 'authenticated execute mismatch', f.nspname || '.' || f.proname
from our_functions f
where has_function_privilege('authenticated', f.oid, 'EXECUTE')
      <> (f.nspname = 'public' and f.proname in (select name from admin_fns)
          or f.nspname = 'driveo_private' and f.proname in ('is_admin', 'current_aal'))
union all
select 'service_role execute mismatch', f.nspname || '.' || f.proname
from our_functions f
where has_function_privilege('service_role', f.oid, 'EXECUTE')
      <> (f.nspname = 'public' and f.proname in (select name from service_fns))
union all
select 'view in an app schema', table_schema || '.' || table_name
from information_schema.views where table_schema in ('public', 'driveo_private')
union all
select 'anon can use the private schema', 'driveo_private' where has_schema_privilege('anon', 'driveo_private', 'USAGE')
union all
select 'service_role can use the private schema', 'driveo_private' where has_schema_privilege('service_role', 'driveo_private', 'USAGE')
union all
select 'table published to Realtime', schemaname || '.' || tablename
from pg_publication_tables where schemaname in ('public', 'driveo_private')
union all
select 'append-only trigger missing', x.tbl
from (values ('public.booking_status_events'), ('public.admin_audit_log'), ('public.price_acceptances'),
             ('driveo_private.notification_attempts')) as x(tbl)
where not exists (select 1 from pg_trigger tg where tg.tgrelid = x.tbl::regclass and tg.tgname like '%append_only' and tg.tgenabled = 'O')
union all
-- Test booking isolation (migration 20261022000100) must be present before test mode is used.
select 'test isolation missing', 'constraint outbox_test_events_suppressed'
where not exists (select 1 from pg_constraint where conname = 'outbox_test_events_suppressed')
union all
select 'test isolation missing', 'submit_booking_request(p_is_test)'
where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'submit_booking_request' and 'p_is_test' = any (p.proargnames))
union all
select 'old submit_booking_request overload still present', 'public.submit_booking_request (5 arguments)'
where exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'submit_booking_request' and p.pronargs = 5)
order by 1, 2;

-- Query 2 — information (review, no fixed expectation)
select 'migration history' as item, string_agg(version, ', ' order by version) as value
from supabase_migrations.schema_migrations
union all
select 'postgres version', version()
union all
select 'PostgREST schemas (if stored on the authenticator role)',
       coalesce((select array_to_string(rolconfig, '; ') from pg_roles where rolname = 'authenticator'), '(not stored here — check Data API settings)')
union all
select 'pg_graphql installed', coalesce((select extversion from pg_extension where extname = 'pg_graphql'), 'no')
union all
select 'admin_users rows (active)', (select count(*)::text from public.admin_users where is_active)
union all
select 'bookings rows (test / total)', (select count(*) filter (where is_test)::text || ' / ' || count(*)::text from public.bookings);
