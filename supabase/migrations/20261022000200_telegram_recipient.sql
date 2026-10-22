-- =============================================================================
-- DRIVEO — verified private Telegram recipient + one-time test send (Step 1.7E.1)
--
-- Builds on the existing pairing challenges (20261021000100/200):
--  * The admin's server polls the bot (getUpdates) while the admin is signed in
--    at AAL2, so the code is attached through an ADMIN function bound to the
--    same session — no secret key or public webhook is needed for pairing.
--  * The verified chat id is stored only after the code typed into the same
--    admin session matches. Telegram private chats have POSITIVE ids; groups,
--    supergroups and channels have negative ids — a CHECK makes them impossible.
--  * At most one active recipient per admin (the server-side allowlist).
--  * The standalone test message can be claimed once per recipient; a send
--    whose outcome is unknown also blocks re-sending (no duplicates).
-- Nothing here sends anything. No booking or worker is involved.
-- =============================================================================

-- The original secret-key attach function could never record a chat id, so it can
-- not complete a usable pairing. It is replaced by the admin-session variant below.
drop function public.attach_telegram_pairing_code(uuid, text, text);

alter table driveo_private.telegram_pairing_challenges add column chat_id bigint;
alter table driveo_private.telegram_pairing_challenges add constraint pairing_chat_private
  check (chat_id is null or chat_id > 0);
alter table driveo_private.telegram_pairing_challenges add constraint pairing_chat_id_with_code
  check ((chat_id is null) = (code_hash is null));

create table driveo_private.telegram_recipients (
  id            uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.admin_users (user_id) on delete restrict,
  -- Private chat only (positive id). Never a group or channel.
  chat_id       bigint not null check (chat_id > 0),
  chat_ref_hash text not null check (chat_ref_hash ~ '^[0-9a-f]{64}$'),
  challenge_id  uuid not null unique references driveo_private.telegram_pairing_challenges (id) on delete restrict,
  verified_at   timestamptz not null default now(),
  revoked_at    timestamptz
);
create unique index telegram_recipients_one_active_idx on driveo_private.telegram_recipients (admin_user_id)
  where revoked_at is null;

create table driveo_private.telegram_test_sends (
  id                  uuid primary key default gen_random_uuid(),
  recipient_id        uuid not null references driveo_private.telegram_recipients (id) on delete restrict,
  requested_by        uuid not null references public.admin_users (user_id) on delete restrict,
  requested_at        timestamptz not null default now(),
  -- unknown = timeout / network error: it may have been delivered, so it blocks re-sending.
  status              text not null default 'claimed' check (status in ('claimed', 'sent', 'failed', 'unknown')),
  telegram_message_id bigint,
  error_code          text check (error_code is null or error_code ~ '^[a-z0-9_.:-]{1,64}$'),
  completed_at        timestamptz,
  constraint test_send_completion_consistent check ((status = 'claimed') = (completed_at is null))
);
-- Exactly one test message per recipient unless the previous attempt definitely failed.
create unique index telegram_test_sends_once_idx on driveo_private.telegram_test_sends (recipient_id)
  where status in ('claimed', 'sent', 'unknown');

alter table driveo_private.telegram_recipients enable row level security;
alter table driveo_private.telegram_test_sends enable row level security;
revoke all on table driveo_private.telegram_recipients, driveo_private.telegram_test_sends
  from public, anon, authenticated, service_role;

-- --------------------------------------------------------------- pairing (admin)

-- The admin's server saw "/start <challenge>" in a PRIVATE chat and sent a one-time
-- code there. Bound to the admin and to the session that started the challenge.
create function public.admin_attach_telegram_pairing_code(
  p_challenge_id uuid, p_session_binding_hash text, p_code_hash text, p_chat_ref_hash text, p_chat_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := driveo_private.require_admin();
begin
  if p_chat_id is null or p_chat_id <= 0 then
    return false;
  end if;
  update driveo_private.telegram_pairing_challenges
  set code_hash = p_code_hash, chat_ref_hash = p_chat_ref_hash, chat_id = p_chat_id
  where id = p_challenge_id
    and admin_user_id = v_admin
    and session_binding_hash = p_session_binding_hash
    and consumed_at is null
    and expires_at > now()
    and code_hash is null;
  return found;
end
$$;

-- Same contract as before (returns the chat reference hash or null; five failures
-- lock the challenge), and on success records the verified private chat as the
-- admin's single active recipient.
create or replace function public.admin_verify_telegram_pairing(
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

  if v_c.chat_id is not null then
    update driveo_private.telegram_recipients set revoked_at = now()
    where admin_user_id = v_admin and revoked_at is null;
    insert into driveo_private.telegram_recipients (admin_user_id, chat_id, chat_ref_hash, challenge_id)
    values (v_admin, v_c.chat_id, v_c.chat_ref_hash, v_c.id);
  end if;

  perform driveo_private.audit(v_admin, 'telegram_pairing.verified', 'telegram_pairing', v_c.id::text);
  return v_c.chat_ref_hash;
end
$$;

-- Status for the admin page — never the chat id.
create function public.admin_telegram_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin uuid := driveo_private.require_admin();
  v_r     driveo_private.telegram_recipients%rowtype;
  v_send  text;
begin
  select * into v_r from driveo_private.telegram_recipients r where r.admin_user_id = v_admin and r.revoked_at is null;
  if not found then
    return jsonb_build_object('paired', false);
  end if;
  select s.status into v_send from driveo_private.telegram_test_sends s
  where s.recipient_id = v_r.id order by s.requested_at desc limit 1;
  return jsonb_build_object('paired', true, 'verified_at', v_r.verified_at, 'test_send', v_send);
end
$$;

-- Server-side use only (the admin's server needs the chat id to call Telegram).
create function public.admin_telegram_send_target()
returns table (recipient_id uuid, chat_id bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin uuid := driveo_private.require_admin();
begin
  return query
  select r.id, r.chat_id from driveo_private.telegram_recipients r
  where r.admin_user_id = v_admin and r.revoked_at is null;
end
$$;

create function public.admin_revoke_telegram_recipient()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := driveo_private.require_admin();
  v_id    uuid;
begin
  update driveo_private.telegram_recipients set revoked_at = now()
  where admin_user_id = v_admin and revoked_at is null
  returning id into v_id;
  if v_id is null then
    return false;
  end if;
  perform driveo_private.audit(v_admin, 'telegram_recipient.revoked', 'telegram_pairing', v_id::text);
  return true;
end
$$;

-- --------------------------------------------------------- one-time test send

create function public.admin_claim_telegram_test_send()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin     uuid := driveo_private.require_admin();
  v_recipient uuid;
  v_id        uuid;
begin
  select r.id into v_recipient from driveo_private.telegram_recipients r
  where r.admin_user_id = v_admin and r.revoked_at is null;
  if v_recipient is null then
    raise exception 'telegram_not_paired' using errcode = 'DV008';
  end if;
  begin
    insert into driveo_private.telegram_test_sends (recipient_id, requested_by)
    values (v_recipient, v_admin)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'telegram_test_already_sent' using errcode = 'DV009';
  end;
  perform driveo_private.audit(v_admin, 'telegram_test.claimed', 'notification', v_id::text);
  return v_id;
end
$$;

create function public.admin_complete_telegram_test_send(
  p_send_id uuid, p_status text, p_telegram_message_id bigint default null, p_error_code text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := driveo_private.require_admin();
begin
  if p_status is null or p_status not in ('sent', 'failed', 'unknown') then
    raise exception 'notification_invalid' using errcode = 'DV007';
  end if;
  update driveo_private.telegram_test_sends
  set status = p_status, telegram_message_id = p_telegram_message_id, error_code = p_error_code, completed_at = now()
  where id = p_send_id and requested_by = v_admin and status = 'claimed';
  if not found then
    raise exception 'notification_invalid' using errcode = 'DV007';
  end if;
  perform driveo_private.audit(v_admin, 'telegram_test.' || p_status, 'notification', p_send_id::text,
                               case when p_error_code is null then '{}'::jsonb else jsonb_build_object('error', p_error_code) end);
  return p_status;
end
$$;

revoke all on function
  public.admin_attach_telegram_pairing_code(uuid, text, text, text, bigint),
  public.admin_telegram_status(),
  public.admin_telegram_send_target(),
  public.admin_revoke_telegram_recipient(),
  public.admin_claim_telegram_test_send(),
  public.admin_complete_telegram_test_send(uuid, text, bigint, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.admin_attach_telegram_pairing_code(uuid, text, text, text, bigint),
  public.admin_telegram_status(),
  public.admin_telegram_send_target(),
  public.admin_revoke_telegram_recipient(),
  public.admin_claim_telegram_test_send(),
  public.admin_complete_telegram_test_send(uuid, text, bigint, text)
to authenticated;
