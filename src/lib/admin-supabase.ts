/**
 * Server-only Supabase client for the /admin surface.
 *
 * Why this is distinct from src/lib/supabase.ts:
 *   - The public client falls back to NEXT_PUBLIC_SUPABASE_ANON_KEY
 *     when SUPABASE_SECRET_KEY isn't set. That's fine for public
 *     dashboards but unsafe for admin: we'd silently fail to read
 *     RLS-restricted columns (lead PII, internal_label, scrubbed
 *     company) and the admin pages would render blank.
 *   - This client REQUIRES the service role key and throws at
 *     module-load if it isn't set. That fail-loud-at-boot pattern
 *     keeps misconfiguration from looking like "no data".
 *
 * The client is server-only by construction: this module is imported
 * exclusively from route handlers and server components under /admin
 * and /api/admin, both of which run on the Node runtime. The service
 * key never reaches the browser.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SECRET_KEY

let _client: SupabaseClient | null = null

export function getAdminSupabase(): SupabaseClient {
  if (_client) return _client
  if (!SUPABASE_URL) {
    throw new Error(
      '[admin] NEXT_PUBLIC_SUPABASE_URL is not set. The admin surface cannot read from Supabase.',
    )
  }
  if (!SUPABASE_SERVICE_KEY) {
    throw new Error(
      '[admin] SUPABASE_SECRET_KEY is not set. The admin surface requires the service role key ' +
        'so it can read lead PII and other RLS-restricted columns.',
    )
  }
  _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
  return _client
}

// =================================================================
// Shared types. Mirrors the underlying Supabase schema so route
// handlers can pass results to client components without re-typing.
// =================================================================

// =================================================================
// IntentSignalSpec — structured buyer-side intent signal.
//
// Mirrors gateway/fulfillment/models.py::IntentSignalSpec exactly.
// `required=true` -> lead MUST satisfy this signal with verified evidence
// or it fails scoring. Every signal contributes to the numeric intent
// score once matched and verified.
//
// Legacy rows may temporarily carry stale ``is_scored`` JSON keys —
// coerce via ``normalizeIntentSignals`` before rendering so the runtime
// view is canonical (text + required only).
// =================================================================
export interface IntentSignalSpec {
  text: string
  required: boolean
}

export interface IcpDetails {
  prompt?: string
  industry?: string | string[]
  sub_industry?: string | string[]
  country?: string | string[]
  geography?: string
  target_roles?: string[]
  target_role_types?: string[]
  target_seniority?: string
  employee_count?: string | string[]
  // Legacy rows in Supabase stored ``intent_signals`` as ``string[]``.
  // New requests store structured ``IntentSignalSpec[]``. Both shapes
  // can be present at read time; producers coerce via
  // ``normalizeIntentSignals`` (admin-icp-parser.ts) before rendering
  // UI that depends on the ``required`` flag.
  intent_signals?: Array<string | IntentSignalSpec>
  product_service?: string
  excluded_companies?: string[]
  num_leads?: number
}

export interface AdminFulfillmentRequest {
  request_id: string
  internal_label: string | null
  company: string | null
  status: string
  num_leads: number
  icp_details: IcpDetails | null
  created_at: string
  window_start: string | null
  window_end: string | null
  successor_request_id: string | null
  // Derived counts (computed at query time, not stored on the row).
  delivered_count?: number
  // The root request_id of the chain this row belongs to. May equal
  // request_id if this row is itself the root.
  chain_root_request_id?: string
  // True if this row is the LATEST (leaf) row of its chain. Useful
  // for collapsing the list view to "one row per client request".
  is_chain_leaf?: boolean
}

// =================================================================
// Deep Research Analysis
// =================================================================
//
// Generated once per fulfilled chain by the gateway's Sonar Deep
// Research QA pass. Stored on the LEAF row of the chain (the row
// whose status='fulfilled'). The detail endpoint pulls from the leaf
// and forwards both the analysis JSON and the lifecycle status, so
// the dashboard can render four distinct states:
//
//   1. Not yet fulfilled       -> tab shows empty-state coachmark
//   2. Pending / in_progress    -> tab shows spinner + status text
//   3. Completed                -> tab shows summary card + per-lead table
//   4. Failed                   -> tab shows error + "Re-run" button
//
// All fields are optional/nullable because the column was added in
// migration 18 and historical rows pre-date this feature.
export type DeepResearchStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | null

export type DeepResearchFinalStatus =
  | 'Client Ready'
  | 'Needs Edit'
  | 'Needs Re-Research'
  | 'Remove'

export interface DeepResearchLead {
  company: string
  contact: string | null
  icp_fit: 'Strong' | 'Borderline' | 'Poor' | null
  intent_fit: 'Strong' | 'Borderline' | 'Poor' | null
  data_confidence: 'High' | 'Medium' | 'Low' | null
  final_status: DeepResearchFinalStatus | null
  reasoning: string
  data_issues_found: string
  recommended_fix: string
}

export interface DeepResearchSummary {
  total_reviewed: number
  client_ready: number
  needs_edit: number
  needs_re_research: number
  remove: number
  top_issues: string[]
  recommended_delivery_decision: string
}

export interface DeepResearchAnalysisPayload {
  summary: DeepResearchSummary
  leads: DeepResearchLead[]
  model?: string
  raw_response?: string
  generated_at?: string
  icp_snapshot?: IcpDetails | null
}

export interface DeepResearchState {
  status: DeepResearchStatus
  attempts: number
  error: string | null
  started_at: string | null
  generated_at: string | null
  analysis: DeepResearchAnalysisPayload | null
}

export interface IntentSignalMappingEntry {
  url?: string
  date?: string | null
  source?: string
  snippet?: string
  description?: string
  raw_score?: number
  confidence?: number
  date_status?: string
  decay_multiplier?: number
  after_decay_score?: number
  matched_icp_signal?: string | null
  matched_icp_signal_idx?: number
  // Flags inherited from the buyer-side IntentSignalSpec that this
  // miner signal was matched to. Populated by the gateway scorer at
  // intent-scoring time. Null when no spec was matched
  // (``matched_icp_signal_idx`` is -1) or when the spec list was
  // empty. Legacy rows pre-dating the flag rollout will be undefined.
  matched_icp_signal_required?: boolean | null
}

export interface IntentBreakdownEntry {
  index?: number
  source_index?: number
  icp_signal?: string | null
  details?: string
}

export interface IntentBreakdown {
  per_signal?: IntentBreakdownEntry[]
  passage?: string
  icp_hash?: string
  generated_at?: string
}

export interface LeadDataInner {
  business?: string
  full_name?: string
  email?: string
  phone?: string | null
  role?: string
  role_type?: string
  seniority?: string
  description?: string
  linkedin_url?: string
  company_website?: string
  company_linkedin?: string
  industry?: string
  sub_industry?: string
  employee_count?: string
  city?: string
  state?: string
  country?: string
  company_hq_city?: string
  company_hq_state?: string
  company_hq_country?: string
  intent_signals?: Array<{
    url?: string
    date?: string
    source?: string
    snippet?: string
    description?: string
  }>
}

export interface LeadDataEntry {
  lead_id: string
  data?: LeadDataInner
}

export interface AdminConsensusRow {
  consensus_id: string
  request_id: string
  submission_id: string
  lead_id: string
  miner_hotkey: string
  consensus_final_score: number | null
  consensus_intent_signal_final: number | null
  consensus_rep_score: number | null
  consensus_icp_fit: boolean | null
  consensus_tier2_passed: boolean | null
  consensus_email_verified: boolean | null
  consensus_person_verified: boolean | null
  consensus_company_verified: boolean | null
  consensus_decision_maker: boolean | null
  any_fabricated: boolean | null
  is_winner: boolean
  is_chain_held: boolean
  reward_pct: number | null
  reward_expires_epoch: number | null
  intent_details: string | null
  intent_breakdown: IntentBreakdown | null
  intent_signal_mapping: IntentSignalMappingEntry[] | null
  num_validators: number | null
  computed_at: string
}

export interface AdminWinningLead {
  consensus: AdminConsensusRow
  lead: LeadDataInner | null
}
