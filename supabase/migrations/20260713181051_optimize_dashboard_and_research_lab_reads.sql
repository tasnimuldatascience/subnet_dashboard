-- Cover the ticket/receipt lookups used by the admin overview and run
-- inspector. These tables are append-only operational logs, so composite
-- indexes keep both the equality filter and newest-first ordering index-only.

create index if not exists idx_research_eval_score_bundles_ticket_created
  on public.research_evaluation_score_bundles (ticket_id, created_at desc);

create index if not exists idx_research_eval_score_bundles_receipt
  on public.research_evaluation_score_bundles (receipt_id)
  where receipt_id is not null;

create index if not exists idx_research_lab_candidate_eval_ticket_created
  on public.research_lab_candidate_evaluation_events (ticket_id, created_at desc);

create index if not exists idx_research_lab_candidate_eval_score_bundle
  on public.research_lab_candidate_evaluation_events (score_bundle_id)
  where score_bundle_id is not null;

create index if not exists idx_research_lab_public_loop_ticket_created
  on public.research_lab_public_loop_card_events (ticket_id, created_at desc);

create index if not exists idx_research_loop_receipt_events_ticket_created
  on public.research_loop_receipt_events (ticket_id, created_at desc);

create index if not exists idx_research_lab_company_labels_ticket_created
  on public.research_lab_company_label_examples (ticket_id, created_at desc)
  where ticket_id is not null;

create index if not exists idx_research_lab_scoring_dispatch_ticket_created
  on public.research_lab_scoring_dispatch_events (ticket_id, created_at desc)
  where ticket_id is not null;

analyze public.dashboard_miner_stats;
analyze public.research_evaluation_score_bundles;
analyze public.research_lab_candidate_evaluation_events;
analyze public.research_lab_public_loop_card_events;
analyze public.research_loop_receipt_events;
analyze public.research_lab_company_label_examples;
analyze public.research_lab_scoring_dispatch_events;
