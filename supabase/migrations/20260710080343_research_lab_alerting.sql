-- Durable Research Lab incident, transition, and notification delivery state.
-- All access is server-side through the service role. These relations live in
-- public for PostgREST compatibility, but RLS plus explicit revokes keep them
-- unavailable to anon/authenticated clients.

create table if not exists public.ops_alert_current (
  fingerprint text primary key,
  incident_id text not null unique,
  status text not null check (status in ('pending', 'open', 'resolved')),
  episode integer not null default 1 check (episode > 0),
  transition_sequence integer not null default 0 check (transition_sequence >= 0),
  severity text check (severity is null or severity in ('warning', 'critical')),
  signal text not null,
  scope text not null,
  entity_id text not null,
  validator_id text,
  title text not null,
  detail text not null default '',
  sources text[] not null default '{}'::text[],
  occurrences integer not null default 1 check (occurrences > 0),
  observed_at timestamptz,
  age_ms bigint check (age_ms is null or age_ms >= 0),
  age_blocks bigint check (age_blocks is null or age_blocks >= 0),
  pending_since timestamptz,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  opened_at timestamptz,
  resolved_at timestamptz,
  last_transition_at timestamptz,
  last_transition_type text check (
    last_transition_type is null or
    last_transition_type in ('open', 'escalate', 'deescalate', 'recover', 'debounce_cancel')
  ),
  owner text,
  acknowledged_at timestamptz,
  acknowledged_by text,
  snoozed_until timestamptz,
  resolution_note text,
  alert_doc jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (last_observed_at >= first_observed_at),
  check (status <> 'open' or opened_at is not null)
);

create index if not exists ops_alert_current_status_severity_idx
  on public.ops_alert_current (status, severity, updated_at desc);
create index if not exists ops_alert_current_validator_idx
  on public.ops_alert_current (validator_id, status, updated_at desc)
  where validator_id is not null;
create index if not exists ops_alert_current_snoozed_idx
  on public.ops_alert_current (snoozed_until)
  where snoozed_until is not null and status = 'open';

create table if not exists public.ops_alert_events (
  event_id text primary key,
  transition_id text not null unique,
  incident_id text not null,
  fingerprint text not null references public.ops_alert_current(fingerprint) on update cascade on delete restrict,
  episode integer not null check (episode > 0),
  sequence integer not null check (sequence > 0),
  transition text not null check (
    transition in ('open', 'escalate', 'deescalate', 'recover', 'debounce_cancel')
  ),
  from_status text check (from_status is null or from_status in ('pending', 'open', 'resolved')),
  to_status text not null check (to_status in ('pending', 'open', 'resolved')),
  from_severity text check (from_severity is null or from_severity in ('warning', 'critical')),
  to_severity text check (to_severity is null or to_severity in ('warning', 'critical')),
  occurred_at timestamptz not null,
  alert_doc jsonb not null,
  created_at timestamptz not null default now(),
  unique (fingerprint, episode, sequence)
);

create index if not exists ops_alert_events_fingerprint_time_idx
  on public.ops_alert_events (fingerprint, occurred_at desc);
create index if not exists ops_alert_events_transition_time_idx
  on public.ops_alert_events (transition, occurred_at desc);

create table if not exists public.ops_alert_delivery_events (
  intent_id text primary key,
  idempotency_key text not null,
  attempt integer not null check (attempt > 0),
  is_retry boolean not null default false,
  status text not null check (status in ('pending', 'succeeded', 'failed')),
  due_at timestamptz not null,
  retry_delay_ms bigint not null default 0 check (retry_delay_ms >= 0),
  channel text not null check (channel in ('email', 'discord')),
  destination_hash text not null,
  transition_id text not null,
  transition text not null check (transition in ('open', 'escalate', 'recover')),
  incident_id text not null,
  fingerprint text not null references public.ops_alert_current(fingerprint) on update cascade on delete restrict,
  provider_http_status integer,
  error_code text,
  error_detail text,
  attempted_at timestamptz,
  completed_at timestamptz,
  payload_doc jsonb not null,
  created_at timestamptz not null default now(),
  unique (idempotency_key, attempt),
  check (completed_at is null or attempted_at is not null)
);

create index if not exists ops_alert_delivery_due_idx
  on public.ops_alert_delivery_events (due_at, created_at)
  where status = 'pending';
create index if not exists ops_alert_delivery_transition_idx
  on public.ops_alert_delivery_events (transition_id, channel, destination_hash, attempt desc);
create index if not exists ops_alert_delivery_failures_idx
  on public.ops_alert_delivery_events (completed_at desc)
  where status = 'failed';

create table if not exists public.ops_alert_monitor_state (
  monitor_id text primary key,
  lease_owner text,
  lease_expires_at timestamptz,
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  last_evaluated_alert_count integer not null default 0 check (last_evaluated_alert_count >= 0),
  last_delivery_count integer not null default 0 check (last_delivery_count >= 0),
  last_delivery_failure_count integer not null default 0 check (last_delivery_failure_count >= 0),
  heartbeat_doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.ops_alert_current enable row level security;
alter table public.ops_alert_events enable row level security;
alter table public.ops_alert_delivery_events enable row level security;
alter table public.ops_alert_monitor_state enable row level security;

revoke all on table public.ops_alert_current from anon, authenticated;
revoke all on table public.ops_alert_events from anon, authenticated;
revoke all on table public.ops_alert_delivery_events from anon, authenticated;
revoke all on table public.ops_alert_monitor_state from anon, authenticated;

grant all on table public.ops_alert_current to service_role;
grant all on table public.ops_alert_events to service_role;
grant all on table public.ops_alert_delivery_events to service_role;
grant all on table public.ops_alert_monitor_state to service_role;

comment on table public.ops_alert_current is
  'One durable current incident per canonical Research Lab alert fingerprint.';
comment on table public.ops_alert_events is
  'Append-only Research Lab incident lifecycle transitions.';
comment on table public.ops_alert_delivery_events is
  'Idempotent email/Discord delivery intents and attempt outcomes.';
comment on table public.ops_alert_monitor_state is
  'Singleton lease and heartbeat state for the independent Research Lab alert monitor.';
