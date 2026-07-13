-- Atomically elect one Research Lab alert monitor across all dashboard workers.
-- The caller must hold the service role; browser roles cannot execute this RPC.

create or replace function public.claim_ops_alert_monitor_lease(
  p_monitor_id text,
  p_owner text,
  p_lease_seconds integer default 180
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed boolean := false;
begin
  if nullif(btrim(p_monitor_id), '') is null then
    raise exception 'p_monitor_id is required';
  end if;
  if nullif(btrim(p_owner), '') is null then
    raise exception 'p_owner is required';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception 'p_lease_seconds must be between 30 and 900';
  end if;

  insert into public.ops_alert_monitor_state (
    monitor_id,
    lease_owner,
    lease_expires_at,
    last_started_at,
    updated_at
  )
  values (
    p_monitor_id,
    p_owner,
    now() + (p_lease_seconds * interval '1 second'),
    now(),
    now()
  )
  on conflict (monitor_id) do update
  set lease_owner = excluded.lease_owner,
      lease_expires_at = excluded.lease_expires_at,
      last_started_at = excluded.last_started_at,
      updated_at = excluded.updated_at
  where ops_alert_monitor_state.lease_owner = p_owner
     or ops_alert_monitor_state.lease_expires_at is null
     or ops_alert_monitor_state.lease_expires_at <= now()
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

revoke all on function public.claim_ops_alert_monitor_lease(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_ops_alert_monitor_lease(text, text, integer)
  to service_role;

comment on function public.claim_ops_alert_monitor_lease(text, text, integer) is
  'Atomically claims the singleton Research Lab alert monitor lease for a service-role worker.';
