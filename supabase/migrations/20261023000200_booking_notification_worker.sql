-- =============================================================================
-- DRIVEO — booking notification worker support (Step 1.7E.2)
--
-- The worker runs on the server with the secret key (service_role), never in
-- an admin session. It needs two narrowly scoped functions:
--
--  1. worker_telegram_recipient(): the verified PRIVATE chat of the active
--     founder admin(s). The worker refuses to send unless exactly one exists.
--  2. claim_booking_notifications(): claims only FRESH 'pending' booking events
--     of REAL bookings. Unlike claim_notification_events it never re-claims a
--     stale 'processing' event: if a worker stopped after Telegram accepted a
--     message, re-sending would duplicate it, so such events wait for a person.
--     Test events are excluded twice (outbox.is_test and bookings.is_test), on
--     top of the existing CHECK that keeps them 'suppressed_test'.
--
-- No table, row, policy or existing function is changed.
-- =============================================================================

create function public.worker_telegram_recipient()
returns table (chat_id bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select r.chat_id
  from driveo_private.telegram_recipients r
  join public.admin_users a on a.user_id = r.admin_user_id
  where r.revoked_at is null and a.is_active and r.chat_id > 0
$$;

create function public.claim_booking_notifications(p_limit integer default 5, p_lock_seconds integer default 120)
returns table (event_id uuid, payload jsonb, attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_lock_seconds is null or p_limit not between 1 and 20 or p_lock_seconds not between 30 and 900 then
    raise exception 'notification_invalid' using errcode = 'DV007';
  end if;
  return query
  update driveo_private.notification_outbox o
  set status = 'processing', locked_until = now() + make_interval(secs => p_lock_seconds)
  where o.id in (
    select c.id
    from driveo_private.notification_outbox c
    join public.bookings b on b.id = c.booking_id
    where c.status = 'pending'
      and c.event_type = 'booking.submitted'
      and not c.is_test
      and not b.is_test
      and c.next_attempt_at <= now()
    order by c.next_attempt_at
    limit p_limit
    for update of c skip locked)
  returning o.id, o.payload, o.attempts;
end
$$;

revoke all on function public.worker_telegram_recipient(), public.claim_booking_notifications(integer, integer)
  from public, anon, authenticated;
grant execute on function public.worker_telegram_recipient(), public.claim_booking_notifications(integer, integer)
  to service_role;
