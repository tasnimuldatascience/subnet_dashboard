-- Durable success-event notifications and improvement analyses for Research Lab.
-- Incident alerts remain in ops_alert_*; this state intentionally models
-- one-shot benchmark completions and promotion analyses instead.

create table if not exists public.ops_research_lab_event_monitor_state (
  monitor_id text primary key,
  lease_owner text,
  lease_expires_at timestamptz,
  initialized_at timestamptz,
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  last_discovered_count integer not null default 0 check (last_discovered_count >= 0),
  last_delivery_count integer not null default 0 check (last_delivery_count >= 0),
  heartbeat_doc jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ops_research_lab_event_notifications (
  event_key text primary key,
  event_type text not null check (
    event_type in ('daily_benchmark_completed', 'improvement_analysis')
  ),
  source_id text not null,
  destination text not null check (destination in ('bug_watch', 'lab_chat')),
  status text not null check (
    status in ('pending_analysis', 'analyzing', 'pending_delivery', 'delivered')
  ),
  occurred_at timestamptz not null,
  payload_doc jsonb not null default '{}'::jsonb,
  evidence_doc jsonb not null default '{}'::jsonb,
  analysis_doc jsonb not null default '{}'::jsonb,
  prompt_version text,
  model text,
  reasoning_effort text,
  model_response_id text,
  model_usage_doc jsonb not null default '{}'::jsonb,
  analysis_attempt_count integer not null default 0 check (analysis_attempt_count >= 0),
  delivery_attempt_count integer not null default 0 check (delivery_attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  last_error text,
  analyzed_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_type, source_id),
  check (status <> 'delivered' or delivered_at is not null),
  check (event_type <> 'improvement_analysis' or destination = 'lab_chat'),
  check (event_type <> 'daily_benchmark_completed' or destination = 'bug_watch')
);

create index if not exists ops_research_lab_event_notifications_due_idx
  on public.ops_research_lab_event_notifications (next_attempt_at, occurred_at)
  where status in ('pending_analysis', 'pending_delivery');
create index if not exists ops_research_lab_event_notifications_type_time_idx
  on public.ops_research_lab_event_notifications (event_type, occurred_at desc);
create index if not exists ops_research_lab_event_notifications_dashboard_idx
  on public.ops_research_lab_event_notifications (analyzed_at desc)
  where event_type = 'improvement_analysis';

alter table public.ops_research_lab_event_monitor_state enable row level security;
alter table public.ops_research_lab_event_notifications enable row level security;

revoke all on table public.ops_research_lab_event_monitor_state from anon, authenticated;
revoke all on table public.ops_research_lab_event_notifications from anon, authenticated;
grant all on table public.ops_research_lab_event_monitor_state to service_role;
grant all on table public.ops_research_lab_event_notifications to service_role;

create or replace function public.claim_ops_research_lab_event_monitor_lease(
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

  insert into public.ops_research_lab_event_monitor_state (
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
  where ops_research_lab_event_monitor_state.lease_owner = p_owner
     or ops_research_lab_event_monitor_state.lease_expires_at is null
     or ops_research_lab_event_monitor_state.lease_expires_at <= now()
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

create or replace function public.claim_ops_research_lab_improvement_analysis(
  p_stale_after_seconds integer default 1800
)
returns setof public.ops_research_lab_event_notifications
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_stale_after_seconds < 300 or p_stale_after_seconds > 86400 then
    raise exception 'p_stale_after_seconds must be between 300 and 86400';
  end if;

  return query
  with candidate as (
    select event_key
    from public.ops_research_lab_event_notifications
    where event_type = 'improvement_analysis'
      and next_attempt_at <= now()
      and (
        status = 'pending_analysis'
        or (
          status = 'analyzing'
          and last_attempt_at <= now() - (p_stale_after_seconds * interval '1 second')
        )
      )
    order by occurred_at asc
    for update skip locked
    limit 1
  )
  update public.ops_research_lab_event_notifications event
  set status = 'analyzing',
      analysis_attempt_count = event.analysis_attempt_count + 1,
      last_attempt_at = now(),
      last_error = null,
      updated_at = now()
  from candidate
  where event.event_key = candidate.event_key
  returning event.*;
end;
$$;

revoke all on function public.claim_ops_research_lab_event_monitor_lease(text, text, integer)
  from public, anon, authenticated;
revoke all on function public.claim_ops_research_lab_improvement_analysis(integer)
  from public, anon, authenticated;
grant execute on function public.claim_ops_research_lab_event_monitor_lease(text, text, integer)
  to service_role;
grant execute on function public.claim_ops_research_lab_improvement_analysis(integer)
  to service_role;

comment on table public.ops_research_lab_event_monitor_state is
  'Singleton lease, activation watermark, and heartbeat for Research Lab success-event monitoring.';
comment on table public.ops_research_lab_event_notifications is
  'Idempotent benchmark-completion notifications and stored Sol analyses for genuine promotion events.';
comment on function public.claim_ops_research_lab_improvement_analysis(integer) is
  'Claims the oldest due improvement analysis while recovering abandoned analysis attempts.';
