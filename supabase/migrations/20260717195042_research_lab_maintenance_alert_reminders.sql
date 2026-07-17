-- Permit a durable, independently idempotent reminder transition for critical
-- maintenance pauses that remain open beyond their 12-hour escalation.

alter table public.ops_alert_current
  drop constraint if exists ops_alert_current_last_transition_type_check;
alter table public.ops_alert_current
  add constraint ops_alert_current_last_transition_type_check check (
    last_transition_type is null or
    last_transition_type in ('open', 'escalate', 'remind', 'deescalate', 'recover', 'debounce_cancel')
  );

alter table public.ops_alert_events
  drop constraint if exists ops_alert_events_transition_check;
alter table public.ops_alert_events
  add constraint ops_alert_events_transition_check check (
    transition in ('open', 'escalate', 'remind', 'deescalate', 'recover', 'debounce_cancel')
  );

alter table public.ops_alert_delivery_events
  drop constraint if exists ops_alert_delivery_events_transition_check;
alter table public.ops_alert_delivery_events
  add constraint ops_alert_delivery_events_transition_check check (
    transition in ('open', 'escalate', 'remind', 'recover')
  );
