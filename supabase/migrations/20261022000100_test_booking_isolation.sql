-- =============================================================================
-- DRIVEO — test booking isolation (Step 1.7C.2-A)
--
-- Fictional TEST bookings must never reach a notification channel, and must be
-- removable later without touching real records.
--
--  1. bookings.is_test and notification_outbox.is_test, set ONLY by the server
--     (service_role) through submit_booking_request(p_is_test => true).
--  2. A test booking's outbox event is born 'suppressed_test' (completed, never
--     claimable). A CHECK makes it impossible for a test event to be pending,
--     processing or sent, and for a real event to be suppressed.
--  3. claim_notification_events also skips is_test events (defence in depth).
--  4. submit_booking_request gains p_is_test. The app ALWAYS passes it in test
--     mode, so test submissions fail closed (function not found) on a database
--     that does not have this migration yet.
--  5. driveo_private.purge_test_bookings(): owner-only cleanup of test bookings
--     (no grants; run deliberately from the SQL Editor). The audit log is kept.
-- =============================================================================

-- ------------------------------------------------------------------- columns

alter table public.bookings add column is_test boolean not null default false;
comment on column public.bookings.is_test is 'Fictional booking created in development TEST mode. Never a customer.';
create index bookings_is_test_idx on public.bookings (is_test) where is_test;

alter table driveo_private.notification_outbox add column is_test boolean not null default false;

alter table driveo_private.notification_outbox drop constraint notification_outbox_status_check;
alter table driveo_private.notification_outbox add constraint notification_outbox_status_check
  check (status in ('pending', 'processing', 'sent_telegram', 'sent_email_fallback', 'failed_all', 'suppressed_test'));

alter table driveo_private.notification_outbox drop constraint outbox_completion_consistent;
alter table driveo_private.notification_outbox add constraint outbox_completion_consistent check (
  (status in ('sent_telegram', 'sent_email_fallback', 'failed_all', 'suppressed_test')) = (completed_at is not null));

-- A test event is ALWAYS suppressed; a real event NEVER is.
alter table driveo_private.notification_outbox add constraint outbox_test_events_suppressed
  check ((status = 'suppressed_test') = is_test);

-- ------------------------------------------------------- submission function

drop function public.submit_booking_request(uuid, text, jsonb, jsonb, text);

create function public.submit_booking_request(
  p_submission_id uuid, p_submission_hash text, p_booking jsonb, p_contact jsonb,
  p_ip_hash text default null, p_is_test boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now  timestamptz := now();
  v_test boolean := coalesce(p_is_test, false);
  v_id   uuid;
  v_ref  text;
  v_existing record;
begin
  if p_submission_id is null or p_submission_hash is null
     or jsonb_typeof(p_booking) is distinct from 'object' or jsonb_typeof(p_contact) is distinct from 'object' then
    raise exception 'submission_invalid' using errcode = 'DV001';
  end if;
  -- Automatic pricing stays disabled at the database level too: there is no persistent,
  -- server-verified quote store yet, so a quote reference could not be checked here.
  if coalesce(p_booking ->> 'pricing_mode', 'manual_assessment') <> 'manual_assessment' then
    raise exception 'submission_invalid' using errcode = 'DV001';
  end if;

  insert into public.bookings (
    reference, submission_id, submission_hash, pricing_mode, eligibility_reasons, is_test,
    pickup_city, pickup_address, pickup_place_id, delivery_city, delivery_address, delivery_place_id,
    requested_date, requested_time,
    vehicle_make, vehicle_model, powertrain, transmission, drivable_confirmed,
    fuel_policy_id, fuel_policy_version, terms_version, privacy_version, consented_at,
    ip_hash, submitted_at, updated_at)
  values (
    driveo_private.next_booking_reference(v_now), p_submission_id, p_submission_hash, 'manual_assessment',
    coalesce(array(select jsonb_array_elements_text(coalesce(p_booking -> 'eligibility_reasons', '[]'::jsonb))), '{}'),
    v_test,
    p_booking ->> 'pickup_city', p_booking ->> 'pickup_address', p_booking ->> 'pickup_place_id',
    p_booking ->> 'delivery_city', p_booking ->> 'delivery_address', p_booking ->> 'delivery_place_id',
    (p_booking ->> 'requested_date')::date, (p_booking ->> 'requested_time')::time,
    p_booking ->> 'vehicle_make', p_booking ->> 'vehicle_model', p_booking ->> 'powertrain',
    p_booking ->> 'transmission', (p_booking ->> 'drivable_confirmed')::boolean,
    p_booking ->> 'fuel_policy_id', (p_booking ->> 'fuel_policy_version')::integer,
    p_booking ->> 'terms_version', p_booking ->> 'privacy_version', (p_booking ->> 'consented_at')::timestamptz,
    p_ip_hash, v_now, v_now)
  on conflict (submission_id) do nothing
  returning id, reference into v_id, v_ref;

  if v_id is null then
    select b.reference, b.status, b.submission_hash, b.is_test into v_existing
    from public.bookings b where b.submission_id = p_submission_id;
    if v_existing.submission_hash is distinct from p_submission_hash or v_existing.is_test is distinct from v_test then
      raise exception 'submission_conflict' using errcode = 'DV002';
    end if;
    return jsonb_build_object('reference', v_existing.reference, 'status', v_existing.status, 'duplicate', true);
  end if;

  insert into public.booking_contacts (booking_id, full_name, phone_e164, email, preferred_contact)
  values (v_id, p_contact ->> 'full_name', p_contact ->> 'phone_e164', nullif(p_contact ->> 'email', ''),
          coalesce(p_contact ->> 'preferred_contact', 'phone'));

  insert into public.booking_status_events (booking_id, from_status, to_status, actor_type)
  values (v_id, null, 'submitted', 'system');

  -- Minimal payload: no name, phone, street address or notes (enforced by a CHECK).
  -- Test bookings get a suppressed event: recorded, never deliverable.
  insert into driveo_private.notification_outbox (event_type, booking_id, dedupe_key, payload, is_test, status, completed_at)
  values ('booking.submitted', v_id, 'booking.submitted:' || v_id::text, jsonb_build_object(
    'reference', v_ref,
    'pickup_city', p_booking ->> 'pickup_city',
    'delivery_city', p_booking ->> 'delivery_city',
    'vehicle_make', p_booking ->> 'vehicle_make',
    'vehicle_model', p_booking ->> 'vehicle_model',
    'submitted_at', to_char(v_now at time zone 'Asia/Tbilisi', 'YYYY-MM-DD"T"HH24:MI')),
    v_test,
    case when v_test then 'suppressed_test' else 'pending' end,
    case when v_test then v_now end);

  perform driveo_private.audit(null, 'booking.submitted', 'booking', v_id::text,
                               jsonb_build_object('reference', v_ref, 'pricing_mode', 'manual_assessment', 'is_test', v_test));

  return jsonb_build_object('reference', v_ref, 'status', 'submitted', 'duplicate', false);
end
$$;

revoke all on function public.submit_booking_request(uuid, text, jsonb, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.submit_booking_request(uuid, text, jsonb, jsonb, text, boolean) to service_role;

-- ------------------------------------------------------------ worker claim

create or replace function public.claim_notification_events(p_limit integer default 10, p_lock_seconds integer default 120)
returns table (event_id uuid, event_type text, payload jsonb, attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_lock_seconds is null or p_limit not between 1 and 50 or p_lock_seconds not between 10 and 900 then
    raise exception 'notification_invalid' using errcode = 'DV007';
  end if;
  return query
  update driveo_private.notification_outbox o
  set status = 'processing', locked_until = now() + make_interval(secs => p_lock_seconds)
  where o.id in (
    select c.id from driveo_private.notification_outbox c
    where c.status in ('pending', 'processing')
      and not c.is_test
      and c.next_attempt_at <= now()
      and (c.locked_until is null or c.locked_until < now())
    order by c.next_attempt_at
    limit p_limit
    for update skip locked)
  returning o.id, o.event_type, o.payload, o.attempts;
end
$$;

-- ------------------------------------------------------- test data cleanup

-- Append-only history may be DELETED only by the table owner, inside a purge
-- transaction (purge_test_bookings sets the flag transaction-locally), and never
-- for the audit log. Updates and TRUNCATE stay forbidden for everyone.
create or replace function driveo_private.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and tg_table_name <> 'admin_audit_log'
     and current_setting('driveo.test_purge', true) = 'on'
     and pg_catalog.pg_has_role(current_user, (select c.relowner from pg_catalog.pg_class c where c.oid = tg_relid), 'MEMBER') then
    return null;
  end if;
  raise exception 'append-only table: % on % is not allowed', tg_op, tg_table_name
    using errcode = '42501';
end
$$;

-- Removes fictional TEST bookings and everything that hangs off them. Real
-- bookings are untouched (every statement filters on is_test). The audit log is
-- kept and gains one summary entry. No grants: run as the owner, deliberately:
--   select driveo_private.purge_test_bookings('DELETE TEST BOOKINGS');
create function driveo_private.purge_test_bookings(p_confirm text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_count integer;
begin
  if p_confirm is distinct from 'DELETE TEST BOOKINGS' then
    raise exception 'confirmation_required' using errcode = '22023';
  end if;

  select coalesce(array_agg(b.id), '{}') into v_ids from public.bookings b where b.is_test;
  v_count := cardinality(v_ids);
  if v_count = 0 then
    return 0;
  end if;

  perform pg_catalog.set_config('driveo.test_purge', 'on', true);

  delete from driveo_private.notification_attempts a
  using driveo_private.notification_outbox o
  where a.event_id = o.id and o.booking_id = any (v_ids) and o.is_test;
  delete from driveo_private.notification_outbox o where o.booking_id = any (v_ids) and o.is_test;
  delete from public.price_acceptances x where x.booking_id = any (v_ids);
  delete from public.price_proposals x where x.booking_id = any (v_ids);
  delete from public.booking_status_events x where x.booking_id = any (v_ids);
  delete from public.booking_contacts x where x.booking_id = any (v_ids);
  delete from public.bookings b where b.id = any (v_ids) and b.is_test;

  perform pg_catalog.set_config('driveo.test_purge', 'off', true);
  perform driveo_private.audit(null, 'test_booking.purged', 'booking', 'test-bookings',
                               jsonb_build_object('count', v_count));
  return v_count;
end
$$;

revoke all on function driveo_private.purge_test_bookings(text) from public, anon, authenticated, service_role;
