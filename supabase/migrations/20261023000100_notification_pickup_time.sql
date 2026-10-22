-- =============================================================================
-- DRIVEO — requested pickup date/time in notification payloads (Step 1.7D.1)
--
-- A future booking notification must show the customer's REQUESTED pickup
-- date and time (never the submission or notification time). The outbox
-- payload so far carried only the submission time, so:
--  1. the minimal-payload allowlist gains requested_date and requested_time
--     (still: short strings only; no name, phone, street address or notes);
--  2. submit_booking_request adds them to NEW outbox events.
-- Existing outbox rows are not modified (the test booking's event stays
-- suppressed exactly as it is). Same function signature: grants are kept.
-- =============================================================================

create or replace function driveo_private.is_minimal_notification_payload(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
     and p ? 'reference'
     and not exists (
       select 1 from jsonb_object_keys(p) as k(key)
       where k.key not in ('reference', 'pickup_city', 'delivery_city', 'vehicle_make', 'vehicle_model', 'submitted_at',
                           'requested_date', 'requested_time'))
     and not exists (
       select 1 from jsonb_each(p) as e(key, value)
       where jsonb_typeof(e.value) <> 'string' or char_length(e.value #>> '{}') > 80)
$$;

create or replace function public.submit_booking_request(
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
  -- Includes the requested pickup date/time so a notification never has to guess it.
  -- Test bookings get a suppressed event: recorded, never deliverable.
  insert into driveo_private.notification_outbox (event_type, booking_id, dedupe_key, payload, is_test, status, completed_at)
  values ('booking.submitted', v_id, 'booking.submitted:' || v_id::text, jsonb_build_object(
    'reference', v_ref,
    'pickup_city', p_booking ->> 'pickup_city',
    'delivery_city', p_booking ->> 'delivery_city',
    'vehicle_make', p_booking ->> 'vehicle_make',
    'vehicle_model', p_booking ->> 'vehicle_model',
    'submitted_at', to_char(v_now at time zone 'Asia/Tbilisi', 'YYYY-MM-DD"T"HH24:MI'),
    -- The customer's requested pickup, as stored (Asia/Tbilisi wall clock).
    'requested_date', to_char((p_booking ->> 'requested_date')::date, 'YYYY-MM-DD'),
    'requested_time', to_char((p_booking ->> 'requested_time')::time, 'HH24:MI')),
    v_test,
    case when v_test then 'suppressed_test' else 'pending' end,
    case when v_test then v_now end);

  perform driveo_private.audit(null, 'booking.submitted', 'booking', v_id::text,
                               jsonb_build_object('reference', v_ref, 'pricing_mode', 'manual_assessment', 'is_test', v_test));

  return jsonb_build_object('reference', v_ref, 'status', 'submitted', 'duplicate', false);
end
$$;
