-- New daily benchmark completions are positive Lab Chat events. Preserve the
-- destination recorded on historical Bug Watch deliveries and on any event
-- created during the zero-downtime release window.
alter table public.ops_research_lab_event_notifications
  drop constraint if exists ops_research_lab_event_notifications_daily_benchmark_destination_check;

alter table public.ops_research_lab_event_notifications
  add constraint ops_research_lab_event_notifications_daily_benchmark_destination_check
  check (
    event_type <> 'daily_benchmark_completed'
    or destination = 'lab_chat'
    or (
      destination = 'bug_watch'
      and created_at < timestamptz '2026-07-17 20:30:00+00'
    )
  );

comment on constraint ops_research_lab_event_notifications_daily_benchmark_destination_check
  on public.ops_research_lab_event_notifications is
  'Routes new daily benchmark completion events to Lab Chat while preserving historical Bug Watch audit rows.';
