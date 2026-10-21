-- =============================================================================
-- DRIVEO — booking foundation (schema, constraints, indexes, append-only guards)
-- Step 1.7B.1. Security (RLS, grants, functions) is in the next migration.
--
-- Conventions
--  * All timestamps are timestamptz (UTC storage). Requested pickup date/time are
--    local wall-clock values in Asia/Tbilisi, stored with an explicit timezone column.
--  * Money is integer tetri; manual prices must be whole GEL (multiple of 100).
--  * Status values are text + CHECK (simpler to evolve than enums).
--  * Internal operational tables live in schema `driveo_private`, which must NOT be
--    added to the Supabase API "exposed schemas" list.
-- =============================================================================

create schema if not exists driveo_private;
revoke all on schema driveo_private from public;

-- ----------------------------------------------------------------- admins/drivers

create table public.admin_users (
  user_id        uuid primary key references auth.users (id) on delete restrict,
  display_name   text not null check (char_length(display_name) between 1 and 80),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  deactivated_at timestamptz,
  constraint admin_deactivation_consistent check (is_active = (deactivated_at is null))
);
comment on table public.admin_users is 'Who may administer DRIVEO. Rows are created manually (no self-registration).';

create table public.drivers (
  id             uuid primary key default gen_random_uuid(),
  display_name   text not null check (char_length(display_name) between 1 and 80),
  admin_user_id  uuid unique references public.admin_users (user_id) on delete restrict,
  base_zone_id   text not null check (base_zone_id ~ '^[a-z0-9_-]{1,40}$'),
  base_locality  text not null check (char_length(base_locality) between 1 and 60),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);
comment on table public.drivers is 'Future multi-driver support. MVP: one row (the founder).';

-- ---------------------------------------------------------------------- bookings

create sequence driveo_private.booking_reference_seq as bigint start 1 no cycle;

create table public.bookings (
  id                  uuid primary key default gen_random_uuid(),
  reference           text not null unique check (reference ~ '^DRV-[0-9]{4}-[0-9]{6}$'),
  -- Client-generated id for one submission attempt; retries reuse it (idempotency).
  submission_id       uuid not null unique,
  -- Hash of the normalized submission; a reused submission_id with different content is rejected.
  submission_hash     text not null check (submission_hash ~ '^sha256:[0-9a-f]{64}$'),
  status              text not null default 'submitted' check (status in (
                        'submitted', 'under_review', 'info_requested', 'price_proposed',
                        'customer_accepted', 'confirmed', 'declined', 'cancelled', 'completed')),

  -- Pricing. Manual assessment needs no quote; automatic pricing is disabled.
  pricing_mode        text not null default 'manual_assessment'
                        check (pricing_mode in ('manual_assessment', 'automatic_quote')),
  quote_reference     text check (quote_reference is null or char_length(quote_reference) between 1 and 100),
  eligibility_reasons text[] not null default '{}'
                        check (cardinality(eligibility_reasons) <= 50),
  constraint automatic_pricing_needs_quote check (pricing_mode <> 'automatic_quote' or quote_reference is not null),

  -- Locations (no coordinates stored).
  pickup_city         text not null check (char_length(pickup_city) between 2 and 60),
  pickup_address      text not null check (char_length(pickup_address) between 3 and 200),
  pickup_place_id     text check (pickup_place_id is null or pickup_place_id ~ '^[A-Za-z0-9_-]{10,1024}$'),
  delivery_city       text not null check (char_length(delivery_city) between 2 and 60),
  delivery_address    text not null check (char_length(delivery_address) between 3 and 200),
  delivery_place_id   text check (delivery_place_id is null or delivery_place_id ~ '^[A-Za-z0-9_-]{10,1024}$'),
  constraint pickup_differs_from_delivery check (
    not (lower(btrim(pickup_city)) = lower(btrim(delivery_city))
         and lower(btrim(pickup_address)) = lower(btrim(delivery_address)))),

  -- Requested schedule (a preference, not a confirmed slot).
  requested_date      date not null,
  requested_time      time not null,
  timezone            text not null default 'Asia/Tbilisi' check (timezone = 'Asia/Tbilisi'),

  -- Vehicle.
  vehicle_make        text not null check (char_length(vehicle_make) between 1 and 60),
  vehicle_model       text not null check (char_length(vehicle_model) between 1 and 60),
  powertrain          text not null check (powertrain in ('petrol', 'diesel', 'lpg', 'cng', 'hybrid', 'plugin_hybrid', 'electric')),
  transmission        text not null check (transmission in ('automatic', 'manual')),
  drivable_confirmed  boolean not null check (drivable_confirmed),

  -- Consent and the exact policy versions accepted.
  fuel_policy_id      text not null check (char_length(fuel_policy_id) between 1 and 60),
  fuel_policy_version integer not null check (fuel_policy_version > 0),
  terms_version       text check (terms_version is null or char_length(terms_version) between 1 and 40),
  privacy_version     text check (privacy_version is null or char_length(privacy_version) between 1 and 40),
  consented_at        timestamptz not null,

  -- Future driver assignment.
  assigned_driver_id  uuid references public.drivers (id) on delete restrict,

  source              text not null default 'web' check (source = 'web'),
  -- Salted SHA-256 of the client IP for abuse analysis only (never the raw IP).
  ip_hash             text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  submitted_at        timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table public.bookings is 'Customer booking requests. Contact details are in booking_contacts.';

create index bookings_status_submitted_idx on public.bookings (status, submitted_at desc);
create index bookings_requested_date_idx on public.bookings (requested_date);
create index bookings_assigned_driver_idx on public.bookings (assigned_driver_id) where assigned_driver_id is not null;

-- Contact details are separated so they can be anonymized without touching the booking record.
create table public.booking_contacts (
  booking_id        uuid primary key references public.bookings (id) on delete restrict,
  full_name         text not null check (char_length(full_name) between 2 and 80),
  phone_e164        text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$' or phone_e164 = 'REDACTED'),
  email             text check (email is null or (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  preferred_contact text not null default 'phone' check (preferred_contact in ('phone', 'sms', 'whatsapp', 'email')),
  created_at        timestamptz not null default now(),
  anonymized_at     timestamptz
);

-- ---------------------------------------------------------------- status history

create table public.booking_status_events (
  id            bigint generated always as identity primary key,
  booking_id    uuid not null references public.bookings (id) on delete restrict,
  from_status   text check (from_status is null or from_status in (
                  'submitted', 'under_review', 'info_requested', 'price_proposed',
                  'customer_accepted', 'confirmed', 'declined', 'cancelled', 'completed')),
  to_status     text not null check (to_status in (
                  'submitted', 'under_review', 'info_requested', 'price_proposed',
                  'customer_accepted', 'confirmed', 'declined', 'cancelled', 'completed')),
  actor_type    text not null check (actor_type in ('system', 'admin')),
  actor_user_id uuid references public.admin_users (user_id) on delete restrict,
  note          text check (note is null or char_length(note) <= 500),
  created_at    timestamptz not null default now(),
  constraint status_event_actor_consistent check ((actor_type = 'admin') = (actor_user_id is not null))
);
create index booking_status_events_booking_idx on public.booking_status_events (booking_id, created_at);

-- --------------------------------------------------------------- manual pricing

create table public.price_proposals (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references public.bookings (id) on delete restrict,
  version      integer not null check (version > 0),
  -- Whole GEL only (final price rounded up to 1 GEL).
  amount_minor integer not null check (amount_minor > 0 and amount_minor % 100 = 0),
  currency     text not null default 'GEL' check (currency = 'GEL'),
  breakdown    jsonb not null default '[]'::jsonb
                 check (jsonb_typeof(breakdown) = 'array' and jsonb_array_length(breakdown) <= 20),
  -- Fuel and charging are never part of the service price.
  excludes     text[] not null default array['fuel', 'charging'] check (excludes @> array['fuel', 'charging']),
  status       text not null default 'draft'
                 check (status in ('draft', 'sent', 'accepted', 'superseded', 'withdrawn')),
  created_by   uuid not null references public.admin_users (user_id) on delete restrict,
  created_at   timestamptz not null default now(),
  -- The price is sent in writing; validity (12 h) runs from the moment it is sent.
  sent_at      timestamptz,
  sent_via     text check (sent_via is null or sent_via in ('sms', 'email', 'whatsapp')),
  valid_until  timestamptz,
  accepted_at  timestamptz,
  unique (booking_id, version),
  constraint proposal_send_fields_together check (
    (sent_at is null) = (sent_via is null) and (sent_at is null) = (valid_until is null)),
  constraint proposal_validity_window check (
    valid_until is null or (valid_until > sent_at and valid_until <= sent_at + interval '7 days')),
  constraint proposal_sent_consistent check ((status in ('sent', 'accepted')) <= (sent_at is not null)),
  constraint proposal_accepted_consistent check ((status = 'accepted') = (accepted_at is not null))
);
-- At most one open (draft or sent) proposal per booking.
create unique index price_proposals_one_open_idx on public.price_proposals (booking_id) where status in ('draft', 'sent');

-- Evidence that the CUSTOMER accepted the exact amount — an admin click alone is not proof.
create table public.price_acceptances (
  id                        uuid primary key default gen_random_uuid(),
  proposal_id               uuid not null unique references public.price_proposals (id) on delete restrict,
  booking_id                uuid not null references public.bookings (id) on delete restrict,
  acknowledged_amount_minor integer not null check (acknowledged_amount_minor > 0),
  -- Written channels only; a phone call must be followed by a written confirmation.
  method                    text not null check (method in ('sms', 'email', 'whatsapp', 'signed_document')),
  -- Where the written acceptance can be found (message id, thread/date, document ref).
  evidence_reference        text not null check (char_length(btrim(evidence_reference)) between 3 and 200),
  -- The customer's own words, copied verbatim.
  customer_statement        text not null check (char_length(btrim(customer_statement)) between 2 and 500),
  received_at               timestamptz not null,
  recorded_by               uuid not null references public.admin_users (user_id) on delete restrict,
  recorded_at               timestamptz not null default now(),
  constraint acceptance_not_from_future check (received_at <= recorded_at + interval '5 minutes')
);

-- -------------------------------------------------------------------- audit log

create table public.admin_audit_log (
  id            bigint generated always as identity primary key,
  actor_type    text not null check (actor_type in ('admin', 'system')),
  actor_user_id uuid references public.admin_users (user_id) on delete restrict,
  action        text not null check (action ~ '^[a-z][a-z_.]{2,63}$'),
  entity_type   text not null check (entity_type in ('booking', 'price_proposal', 'price_acceptance', 'notification', 'admin', 'driver', 'telegram_pairing')),
  entity_id     text not null check (char_length(entity_id) between 1 and 100),
  -- Never personal data or secrets: identifiers and codes only.
  details       jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at    timestamptz not null default now(),
  constraint audit_actor_consistent check ((actor_type = 'admin') = (actor_user_id is not null))
);
create index admin_audit_log_entity_idx on public.admin_audit_log (entity_type, entity_id, created_at);

-- ------------------------------------------------- notifications (internal schema)

-- Only these keys, all short strings, may appear in a notification payload:
-- no phone, name, street address, coordinates or notes.
create function driveo_private.is_minimal_notification_payload(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
     and p ? 'reference'
     and not exists (
       select 1 from jsonb_object_keys(p) as k(key)
       where k.key not in ('reference', 'pickup_city', 'delivery_city', 'vehicle_make', 'vehicle_model', 'submitted_at'))
     and not exists (
       select 1 from jsonb_each(p) as e(key, value)
       where jsonb_typeof(e.value) <> 'string' or char_length(e.value #>> '{}') > 80)
$$;

create table driveo_private.notification_outbox (
  id              uuid primary key default gen_random_uuid(),
  event_type      text not null check (event_type in ('booking.submitted')),
  booking_id      uuid not null references public.bookings (id) on delete restrict,
  -- One event per booking per type; retries can never create a second one.
  dedupe_key      text not null unique check (char_length(dedupe_key) between 1 and 200),
  payload         jsonb not null check (driveo_private.is_minimal_notification_payload(payload)),
  status          text not null default 'pending'
                    check (status in ('pending', 'processing', 'sent_telegram', 'sent_email_fallback', 'failed_all')),
  attempts        integer not null default 0 check (attempts between 0 and 20),
  next_attempt_at timestamptz not null default now(),
  locked_until    timestamptz,
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z0-9_.:-]{1,64}$'),
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,
  constraint outbox_completion_consistent check (
    (status in ('sent_telegram', 'sent_email_fallback', 'failed_all')) = (completed_at is not null))
);
create index notification_outbox_due_idx on driveo_private.notification_outbox (next_attempt_at)
  where status in ('pending', 'processing');
create index notification_outbox_booking_idx on driveo_private.notification_outbox (booking_id);

create table driveo_private.notification_attempts (
  id                  bigint generated always as identity primary key,
  event_id            uuid not null references driveo_private.notification_outbox (id) on delete restrict,
  channel             text not null check (channel in ('telegram', 'email')),
  attempt_no          integer not null check (attempt_no between 1 and 10),
  -- "accepted" = the provider API accepted the message; it does NOT mean it was read.
  result              text not null check (result in ('accepted', 'failed')),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 200),
  http_status         integer check (http_status is null or http_status between 100 and 599),
  error_code          text check (error_code is null or error_code ~ '^[a-z0-9_.:-]{1,64}$'),
  -- Sanitized summary only: never tokens, URLs or customer data (crude guard below).
  error_summary       text check (error_summary is null or (
                        char_length(error_summary) <= 200
                        and error_summary !~* 'https?://'
                        and error_summary !~ '[0-9]{6,}:[A-Za-z0-9_-]{20,}'
                        and error_summary !~ '\+?[0-9][0-9 ()-]{7,}[0-9]')),
  attempted_at        timestamptz not null default now(),
  unique (event_id, channel, attempt_no),
  constraint attempt_result_consistent check ((result = 'accepted') = (error_code is null))
);

-- Future Telegram pairing (not active): session-bound, short-lived, single-use, attempt-limited.
-- Flow: admin (AAL2) starts a challenge in the dashboard -> opens the bot in a PRIVATE chat ->
-- the bot (server) sends a one-time code to that chat and attaches its hash -> the admin types
-- the code into the SAME dashboard session -> the server also checks the chat against its
-- server-side allowlist before storing anything.
create table driveo_private.telegram_pairing_challenges (
  id                   uuid primary key default gen_random_uuid(),
  admin_user_id        uuid not null references public.admin_users (user_id) on delete restrict,
  -- SHA-256 of the admin's session identifier; verification must come from the same session.
  session_binding_hash text not null check (session_binding_hash ~ '^[0-9a-f]{64}$'),
  -- SHA-256 of the one-time code and of the private chat reference (raw values never stored).
  code_hash            text check (code_hash is null or code_hash ~ '^[0-9a-f]{64}$'),
  chat_ref_hash        text check (chat_ref_hash is null or chat_ref_hash ~ '^[0-9a-f]{64}$'),
  created_at           timestamptz not null default now(),
  expires_at           timestamptz not null,
  failed_attempts      integer not null default 0 check (failed_attempts between 0 and 5),
  consumed_at          timestamptz,
  outcome              text check (outcome is null or outcome in ('verified', 'superseded', 'expired', 'locked')),
  constraint pairing_short_lived check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  constraint pairing_code_with_chat check ((code_hash is null) = (chat_ref_hash is null)),
  constraint pairing_consumed_consistent check ((consumed_at is null) = (outcome is null))
);
create unique index telegram_pairing_one_open_idx on driveo_private.telegram_pairing_challenges (admin_user_id)
  where consumed_at is null;

-- Persistent rate limiting (replaces in-memory counters across server instances).
-- Keys are "<scope>:<hex hash>" so raw IPs or phone numbers can never be stored here.
create table driveo_private.rate_limit_counters (
  key          text not null check (key ~ '^[a-z][a-z0-9_.]{0,39}:[0-9a-f]{16,64}$'),
  window_start timestamptz not null,
  count        integer not null check (count >= 0),
  primary key (key, window_start)
);

-- ------------------------------------------------------------ append-only guards

create function driveo_private.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'append-only table: % on % is not allowed', tg_op, tg_table_name
    using errcode = '42501';
end
$$;

-- Statement-level, so even a statement matching zero rows (or TRUNCATE) is refused.
create trigger booking_status_events_append_only before update or delete or truncate on public.booking_status_events
  for each statement execute function driveo_private.forbid_mutation();
create trigger admin_audit_log_append_only before update or delete or truncate on public.admin_audit_log
  for each statement execute function driveo_private.forbid_mutation();
create trigger price_acceptances_append_only before update or delete or truncate on public.price_acceptances
  for each statement execute function driveo_private.forbid_mutation();
create trigger notification_attempts_append_only before update or delete or truncate on driveo_private.notification_attempts
  for each statement execute function driveo_private.forbid_mutation();

create function driveo_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;
create trigger bookings_touch_updated_at before update on public.bookings
  for each row execute function driveo_private.touch_updated_at();
