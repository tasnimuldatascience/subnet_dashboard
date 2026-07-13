-- Operator-managed validator coverage for PCR0 and weight-submission alerts.
-- The admin API is the only writer; browser roles remain fail-closed.

create table if not exists public.ops_validator_registry (
  validator_hotkey text primary key,
  label text,
  enabled boolean not null default true,
  monitor_pcr0 boolean not null default true,
  monitor_offchain_weights boolean not null default true,
  monitor_onchain_weights boolean not null default true,
  expected_pcr0 text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(validator_hotkey) between 40 and 64),
  check (label is null or char_length(label) <= 80),
  check (expected_pcr0 is null or expected_pcr0 ~ '^[0-9a-f]{96}$')
);

create index if not exists ops_validator_registry_enabled_idx
  on public.ops_validator_registry (enabled, updated_at desc);

alter table public.ops_validator_registry enable row level security;
revoke all on table public.ops_validator_registry from anon, authenticated;
grant all on table public.ops_validator_registry to service_role;

comment on table public.ops_validator_registry is
  'Admin-managed validator hotkeys whose PCR0 and off/on-chain weight freshness must be monitored.';
