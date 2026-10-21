-- =============================================================================
-- DRIVEO — lifecycle and privileged functions (Step 1.7B.1)
--
-- Every write goes through one of these functions; no role has direct
-- INSERT/UPDATE/DELETE on any table (see the security migration).
--
-- SECURITY DEFINER rules applied to every function below:
--  * `set search_path = ''` and fully qualified names (no search_path hijacking);
--  * the first statement authorizes the caller (require_admin) or the function is
--    granted to service_role only;
--  * errors carry a short code only (SQLSTATE DV0xx + a token), never row data.
--
-- Error codes: DV001 submission_invalid · DV002 submission_conflict ·
-- DV003 booking_not_found · DV004 invalid_transition · DV005 proposal_invalid ·
-- DV006 acceptance_invalid · DV007 notification_invalid · 42501 not_authorized
-- =============================================================================

-- ----------------------------------------------------------- authorization helpers

create function driveo_private.current_aal()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '')
$$;

-- An admin is: authenticated, at AAL2 (password + TOTP in this session), and an
-- ACTIVE row in admin_users. Deactivating the row revokes access immediately.
create function driveo_private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and driveo_private.current_aal() = 'aal2'
     and exists (select 1 from public.admin_users a where a.user_id = auth.uid() and a.is_active)
$$;

create function driveo_private.require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not driveo_private.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return auth.uid();
end
$$;

-- ------------------------------------------------------------------ small helpers

-- Manual price validity: 12 hours from the moment the price is sent.
create function driveo_private.price_validity()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '12 hours' $$;

create function driveo_private.next_booking_reference(p_at timestamptz)
returns text
language sql
volatile
set search_path = ''
as $$
  select 'DRV-' || to_char(p_at at time zone 'Asia/Tbilisi', 'YYYY') || '-'
         || lpad(nextval('driveo_private.booking_reference_seq')::text, 6, '0')
$$;

create function driveo_private.audit(
  p_actor uuid, p_action text, p_entity_type text, p_entity_id text, p_details jsonb default '{}'::jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.admin_audit_log (actor_type, actor_user_id, action, entity_type, entity_id, details)
  values (case when p_actor is null then 'system' else 'admin' end, p_actor, p_action,
          p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb))
$$;

-- -------------------------------------------------------------- booking lifecycle

-- The single source of truth for allowed status changes. `via` says which
-- function may perform it: 'manual' = admin_transition_booking; the others are
-- side effects of the price-proposal functions. Mirrored (and compared in tests)
-- by src/lib/booking/lifecycle.ts.
create function driveo_private.booking_transition_rules()
returns table (from_status text, to_status text, via text)
language sql
immutable
set search_path = ''
as $$
  values
    ('submitted',         'under_review',      'manual'),
    ('submitted',         'declined',          'manual'),
    ('submitted',         'cancelled',         'manual'),
    ('under_review',      'info_requested',    'manual'),
    ('under_review',      'declined',          'manual'),
    ('under_review',      'cancelled',         'manual'),
    ('under_review',      'price_proposed',    'proposal_sent'),
    ('info_requested',    'under_review',      'manual'),
    ('info_requested',    'declined',          'manual'),
    ('info_requested',    'cancelled',         'manual'),
    ('price_proposed',    'under_review',      'manual'),
    ('price_proposed',    'under_review',      'proposal_superseded'),
    ('price_proposed',    'declined',          'manual'),
    ('price_proposed',    'cancelled',         'manual'),
    ('price_proposed',    'customer_accepted', 'acceptance_recorded'),
    ('customer_accepted', 'confirmed',         'manual'),
    ('customer_accepted', 'declined',          'manual'),
    ('customer_accepted', 'cancelled',         'manual'),
    ('confirmed',         'completed',         'manual'),
    ('confirmed',         'cancelled',         'manual')
$$;

-- Internal: lock, validate against the rules, update, append history. Not granted to anyone.
create function driveo_private.apply_booking_transition(
  p_booking_id uuid, p_to text, p_via text, p_actor uuid, p_note text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_from text;
begin
  select b.status into v_from from public.bookings b where b.id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'DV003';
  end if;
  if not exists (
    select 1 from driveo_private.booking_transition_rules() r
    where r.from_status = v_from and r.to_status = p_to and r.via = p_via
  ) then
    raise exception 'invalid_transition' using errcode = 'DV004';
  end if;
  update public.bookings set status = p_to where id = p_booking_id;
  insert into public.booking_status_events (booking_id, from_status, to_status, actor_type, actor_user_id, note)
  values (p_booking_id, v_from, p_to, case when p_actor is null then 'system' else 'admin' end, p_actor, p_note);
  return v_from;
end
$$;

-- ------------------------------------------------------------ booking submission

-- Called by the Next.js server only (service_role), never by browsers.
-- One transaction: booking + contact + first status event + notification outbox + audit.
-- Idempotent: the same submission_id with the same hash returns the existing booking;
-- the same submission_id with a different hash is rejected.
create function public.submit_booking_request(
  p_submission_id uuid, p_submission_hash text, p_booking jsonb, p_contact jsonb, p_ip_hash text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now  timestamptz := now();
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
    reference, submission_id, submission_hash, pricing_mode, eligibility_reasons,
    pickup_city, pickup_address, pickup_place_id, delivery_city, delivery_address, delivery_place_id,
    requested_date, requested_time,
    vehicle_make, vehicle_model, powertrain, transmission, drivable_confirmed,
    fuel_policy_id, fuel_policy_version, terms_version, privacy_version, consented_at,
    ip_hash, submitted_at, updated_at)
  values (
    driveo_private.next_booking_reference(v_now), p_submission_id, p_submission_hash, 'manual_assessment',
    coalesce(array(select jsonb_array_elements_text(coalesce(p_booking -> 'eligibility_reasons', '[]'::jsonb))), '{}'),
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
    select b.reference, b.status, b.submission_hash into v_existing
    from public.bookings b where b.submission_id = p_submission_id;
    if v_existing.submission_hash is distinct from p_submission_hash then
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
  insert into driveo_private.notification_outbox (event_type, booking_id, dedupe_key, payload)
  values ('booking.submitted', v_id, 'booking.submitted:' || v_id::text, jsonb_build_object(
    'reference', v_ref,
    'pickup_city', p_booking ->> 'pickup_city',
    'delivery_city', p_booking ->> 'delivery_city',
    'vehicle_make', p_booking ->> 'vehicle_make',
    'vehicle_model', p_booking ->> 'vehicle_model',
    'submitted_at', to_char(v_now at time zone 'Asia/Tbilisi', 'YYYY-MM-DD"T"HH24:MI')));

  perform driveo_private.audit(null, 'booking.submitted', 'booking', v_id::text,
                               jsonb_build_object('reference', v_ref, 'pricing_mode', 'manual_assessment'));

  return jsonb_build_object('reference', v_ref, 'status', 'submitted', 'duplicate', false);
end
$$;

-- ---------------------------------------------------------------- admin: lifecycle

create function public.admin_transition_booking(p_booking_id uuid, p_to_status text, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := driveo_private.require_admin();
  v_from  text;
begin
  v_from := driveo_private.apply_booking_transition(p_booking_id, p_to_status, 'manual', v_admin, p_note);

  -- Confirmation requires recorded evidence that the customer accepted a price.
  if p_to_status = 'confirmed' and not exists (
    select 1 from public.price_acceptances a
    join public.price_proposals p on p.id = a.proposal_id
    where a.booking_id = p_booking_id and p.status = 'accepted'
  ) then
    raise exception 'acceptance_required' using errcode = 'DV006';
  end if;

  -- Leaving the price stage withdraws any open (draft or sent) proposal.
  if p_to_status in ('under_review', 'declined', 'cancelled') then
    update public.price_proposals set status = 'withdrawn'
    where booking_id = p_booking_id and status in ('draft', 'sent');
  end if;

  perform driveo_private.audit(v_admin, 'booking.transition', 'booking', p_booking_id::text,
                               jsonb_build_object('from', v_from, 'to', p_to_status));
  return p_to_status;
end
$$;

-- ----------------------------------------------------------- admin: manual pricing

create function public.admin_create_price_proposal(
  p_booking_id uuid, p_amount_minor integer, p_breakdown jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin   uuid := driveo_private.require_admin();
  v_status  text;
  v_version integer;
  v_id      uuid;
begin
  select b.status into v_status from public.bookings b where b.id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'DV003';
  end if;
  if v_status not in ('under_review', 'price_proposed') then
    raise exception 'invalid_transition' using errcode = 'DV004';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 or p_amount_minor % 100 <> 0 then
    raise exception 'proposal_invalid' using errcode = 'DV005';
  end if;

  -- A new proposal replaces the open one; a sent price that is replaced moves the
  -- booking back to review until the new price is sent.
  update public.price_proposals
  set status = case when status = 'sent' then 'superseded' else 'withdrawn' end
  where booking_id = p_booking_id and status in ('draft', 'sent');
  if v_status = 'price_proposed' then
    perform driveo_private.apply_booking_transition(p_booking_id, 'under_review', 'proposal_superseded', v_admin, null);
  end if;

  select coalesce(max(p.version), 0) + 1 into v_version from public.price_proposals p where p.booking_id = p_booking_id;
  insert into public.price_proposals (booking_id, version, amount_minor, breakdown, created_by)
  values (p_booking_id, v_version, p_amount_minor, coalesce(p_breakdown, '[]'::jsonb), v_admin)
  returning id into v_id;

  perform driveo_private.audit(v_admin, 'price_proposal.created', 'price_proposal', v_id::text,
                               jsonb_build_object('booking_id', p_booking_id, 'version', v_version, 'amount_minor', p_amount_minor));
  return v_id;
end
$$;

-- Records that the admin sent the price to the customer in writing; starts the 12 h validity.
create function public.admin_mark_proposal_sent(p_proposal_id uuid, p_sent_via text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin   uuid := driveo_private.require_admin();
  v_booking uuid;
  v_status  text;
  v_until   timestamptz := now() + driveo_private.price_validity();
begin
  select p.booking_id, p.status into v_booking, v_status
  from public.price_proposals p where p.id = p_proposal_id for update;
  if not found or v_status <> 'draft' or p_sent_via is null or p_sent_via not in ('sms', 'email', 'whatsapp') then
    raise exception 'proposal_invalid' using errcode = 'DV005';
  end if;

  update public.price_proposals
  set status = 'sent', sent_at = now(), sent_via = p_sent_via, valid_until = v_until
  where id = p_proposal_id;
  perform driveo_private.apply_booking_transition(v_booking, 'price_proposed', 'proposal_sent', v_admin, null);

  perform driveo_private.audit(v_admin, 'price_proposal.sent', 'price_proposal', p_proposal_id::text,
                               jsonb_build_object('booking_id', v_booking, 'sent_via', p_sent_via));
  return v_until;
end
$$;

-- Evidence model: an admin click alone is NOT proof. The admin must record the
-- customer's WRITTEN acceptance — channel, where the message can be found, the
-- customer's own words, when it was received (within validity) and the amount the
-- customer acknowledged, which must equal the proposed amount exactly.
create function public.admin_record_price_acceptance(
  p_proposal_id uuid,
  p_method text,
  p_evidence_reference text,
  p_customer_statement text,
  p_received_at timestamptz,
  p_acknowledged_amount_minor integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := driveo_private.require_admin();
  v_p     public.price_proposals%rowtype;
  v_id    uuid;
begin
  select * into v_p from public.price_proposals p where p.id = p_proposal_id for update;
  if not found then
    raise exception 'proposal_invalid' using errcode = 'DV005';
  end if;
  if v_p.status <> 'sent'
     or p_method is null or p_method not in ('sms', 'email', 'whatsapp', 'signed_document')
     or p_acknowledged_amount_minor is distinct from v_p.amount_minor
     or p_received_at is null
     or p_received_at < v_p.sent_at
     or p_received_at > v_p.valid_until
     or p_received_at > now() + interval '5 minutes'
     or char_length(btrim(coalesce(p_evidence_reference, ''))) < 3
     or char_length(btrim(coalesce(p_customer_statement, ''))) < 2 then
    raise exception 'acceptance_invalid' using errcode = 'DV006';
  end if;

  insert into public.price_acceptances (
    proposal_id, booking_id, acknowledged_amount_minor, method, evidence_reference,
    customer_statement, received_at, recorded_by)
  values (p_proposal_id, v_p.booking_id, p_acknowledged_amount_minor, p_method, btrim(p_evidence_reference),
          btrim(p_customer_statement), p_received_at, v_admin)
  returning id into v_id;

  update public.price_proposals set status = 'accepted', accepted_at = p_received_at where id = p_proposal_id;
  perform driveo_private.apply_booking_transition(v_p.booking_id, 'customer_accepted', 'acceptance_recorded', v_admin, null);

  perform driveo_private.audit(v_admin, 'price_acceptance.recorded', 'price_acceptance', v_id::text,
                               jsonb_build_object('booking_id', v_p.booking_id, 'proposal_id', p_proposal_id, 'method', p_method));
  return v_id;
end
$$;

-- -------------------------------------------------------- notifications (worker side)

-- Worker = a future server job using service_role. Nothing schedules it in this step.
create function public.claim_notification_events(p_limit integer default 10, p_lock_seconds integer default 120)
returns table (event_id uuid, event_type text, payload jsonb, attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit not between 1 and 50 or p_lock_seconds not between 10 and 900 then
    raise exception 'notification_invalid' using errcode = 'DV007';
  end if;
  return query
  update driveo_private.notification_outbox o
  set status = 'processing', locked_until = now() + make_interval(secs => p_lock_seconds)
  where o.id in (
    select c.id from driveo_private.notification_outbox c
    where c.status in ('pending', 'processing')
      and c.next_attempt_at <= now()
      and (c.locked_until is null or c.locked_until < now())
    order by c.next_attempt_at
    limit p_limit
    for update skip locked)
  returning o.id, o.event_type, o.payload, o.attempts;
end
$$;

create function public.record_notification_attempt(
  p_event_id uuid, p_channel text, p_result text,
  p_provider_message_id text default null, p_http_status integer default null,
  p_error_code text default null, p_error_summary text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status  text;
  v_attempt integer;
begin
  select o.status into v_status from driveo_private.notification_outbox o where o.id = p_event_id for update;
  if not found or v_status <> 'processing' then
    raise exception 'notification_invalid' using errcode = 'DV007';
  end if;
  select coalesce(max(a.attempt_no), 0) + 1 into v_attempt
  from driveo_private.notification_attempts a where a.event_id = p_event_id and a.channel = p_channel;

  insert into driveo_private.notification_attempts (
    event_id, channel, attempt_no, result, provider_message_id, http_status, error_code, error_summary)
  values (p_event_id, p_channel, v_attempt, p_result, p_provider_message_id, p_http_status, p_error_code, p_error_summary);
  update driveo_private.notification_outbox set attempts = attempts + 1, last_error_code = coalesce(p_error_code, last_error_code)
  where id = p_event_id;
  return v_attempt;
end
$$;

-- outcome: 'sent_telegram' | 'sent_email_fallback' | 'failed_all' | 'retry'
create function public.complete_notification_event(
  p_event_id uuid, p_outcome text, p_retry_in_seconds integer default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select o.status into v_status from driveo_private.notification_outbox o where o.id = p_event_id for update;
  if not found or v_status <> 'processing' then
    raise exception 'notification_invalid' using errcode = 'DV007';
  end if;

  if p_outcome = 'sent_telegram' then
    if not exists (select 1 from driveo_private.notification_attempts a
                   where a.event_id = p_event_id and a.channel = 'telegram' and a.result = 'accepted') then
      raise exception 'notification_invalid' using errcode = 'DV007';
    end if;
  elsif p_outcome = 'sent_email_fallback' then
    -- Email is a fallback: only after Telegram has failed for this event.
    if not exists (select 1 from driveo_private.notification_attempts a
                   where a.event_id = p_event_id and a.channel = 'email' and a.result = 'accepted')
       or not exists (select 1 from driveo_private.notification_attempts a
                      where a.event_id = p_event_id and a.channel = 'telegram' and a.result = 'failed') then
      raise exception 'notification_invalid' using errcode = 'DV007';
    end if;
  elsif p_outcome = 'retry' then
    if p_retry_in_seconds is null or p_retry_in_seconds not between 1 and 86400 then
      raise exception 'notification_invalid' using errcode = 'DV007';
    end if;
    update driveo_private.notification_outbox
    set status = 'pending', locked_until = null, next_attempt_at = now() + make_interval(secs => p_retry_in_seconds)
    where id = p_event_id;
    return 'pending';
  elsif p_outcome is distinct from 'failed_all' then
    raise exception 'notification_invalid' using errcode = 'DV007';
  end if;

  update driveo_private.notification_outbox
  set status = p_outcome, locked_until = null, completed_at = now()
  where id = p_event_id;
  return p_outcome;
end
$$;

-- --------------------------------------------------------- notifications (admin side)

-- Failure recovery: the admin re-queues an event whose channels all failed.
create function public.admin_retry_notification(p_event_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin  uuid := driveo_private.require_admin();
  v_status text;
begin
  select o.status into v_status from driveo_private.notification_outbox o where o.id = p_event_id for update;
  if not found or v_status <> 'failed_all' then
    raise exception 'notification_invalid' using errcode = 'DV007';
  end if;
  update driveo_private.notification_outbox
  set status = 'pending', next_attempt_at = now(), locked_until = null, completed_at = null
  where id = p_event_id;
  perform driveo_private.audit(v_admin, 'notification.retry', 'notification', p_event_id::text);
  return 'pending';
end
$$;

-- Delivery history without payloads (the admin sees the booking itself through RLS).
create function public.admin_notification_history(p_booking_id uuid)
returns table (
  event_id uuid, event_type text, event_status text, event_attempts integer,
  event_created_at timestamptz, event_completed_at timestamptz,
  channel text, attempt_no integer, result text, error_code text, attempted_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform driveo_private.require_admin();
  return query
  select o.id, o.event_type, o.status, o.attempts, o.created_at, o.completed_at,
         a.channel, a.attempt_no, a.result, a.error_code, a.attempted_at
  from driveo_private.notification_outbox o
  left join driveo_private.notification_attempts a on a.event_id = o.id
  where o.booking_id = p_booking_id
  order by o.created_at, a.attempted_at;
end
$$;

-- -------------------------------------------------------------- rate limiting

-- Fixed-window counter. Returns true while the caller is within the limit.
create function public.consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_count  integer;
begin
  if p_limit not between 1 and 10000 or p_window_seconds not between 1 and 86400 then
    raise exception 'rate_limit_invalid' using errcode = '22023';
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into driveo_private.rate_limit_counters as c (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = c.count + 1
  returning c.count into v_count;
  return v_count <= p_limit;
end
$$;

-- --------------------------------------------- Telegram pairing (prepared, inactive)

create function public.admin_start_telegram_pairing(p_session_binding_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := driveo_private.require_admin();
  v_id    uuid;
begin
  update driveo_private.telegram_pairing_challenges
  set consumed_at = now(), outcome = 'superseded'
  where admin_user_id = v_admin and consumed_at is null;
  insert into driveo_private.telegram_pairing_challenges (admin_user_id, session_binding_hash, expires_at)
  values (v_admin, p_session_binding_hash, now() + interval '10 minutes')
  returning id into v_id;
  perform driveo_private.audit(v_admin, 'telegram_pairing.started', 'telegram_pairing', v_id::text);
  return v_id;
end
$$;

-- Bot side (service_role): after confirming the update came from a PRIVATE chat, attach
-- the hash of the one-time code it sent there. One code per challenge.
create function public.attach_telegram_pairing_code(p_challenge_id uuid, p_code_hash text, p_chat_ref_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update driveo_private.telegram_pairing_challenges
  set code_hash = p_code_hash, chat_ref_hash = p_chat_ref_hash
  where id = p_challenge_id and consumed_at is null and expires_at > now() and code_hash is null;
  return found;
end
$$;

-- Admin side: verify the code from the SAME session that started the challenge.
-- Returns the chat reference hash on success, null otherwise. Five failures lock it.
create function public.admin_verify_telegram_pairing(
  p_challenge_id uuid, p_session_binding_hash text, p_code_hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := driveo_private.require_admin();
  v_c     driveo_private.telegram_pairing_challenges%rowtype;
begin
  select * into v_c from driveo_private.telegram_pairing_challenges c
  where c.id = p_challenge_id and c.admin_user_id = v_admin and c.consumed_at is null
  for update;
  if not found then
    return null;
  end if;
  if v_c.expires_at <= now() then
    update driveo_private.telegram_pairing_challenges set consumed_at = now(), outcome = 'expired' where id = v_c.id;
    return null;
  end if;
  if v_c.code_hash is null
     or v_c.session_binding_hash is distinct from p_session_binding_hash
     or v_c.code_hash is distinct from p_code_hash then
    update driveo_private.telegram_pairing_challenges
    set failed_attempts = failed_attempts + 1,
        consumed_at = case when failed_attempts + 1 >= 5 then now() end,
        outcome = case when failed_attempts + 1 >= 5 then 'locked' end
    where id = v_c.id;
    return null;
  end if;
  update driveo_private.telegram_pairing_challenges set consumed_at = now(), outcome = 'verified' where id = v_c.id;
  perform driveo_private.audit(v_admin, 'telegram_pairing.verified', 'telegram_pairing', v_c.id::text);
  return v_c.chat_ref_hash;
end
$$;
