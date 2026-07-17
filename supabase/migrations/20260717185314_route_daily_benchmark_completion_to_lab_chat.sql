-- Phase one of a zero-downtime routing change. The application currently
-- writes successful daily benchmark events to bug_watch; removing the old
-- event-specific check lets both the old and new releases run during reload.
-- The follow-up migration restores strict routing after the new release is live.
alter table public.ops_research_lab_event_notifications
  drop constraint if exists ops_research_lab_event_notifications_check2;
