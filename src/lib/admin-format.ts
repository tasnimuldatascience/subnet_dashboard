/**
 * Shared formatters and small data-shaping helpers for the /admin
 * surface. Kept tiny on purpose: every helper here is used by both
 * server components and client components, so they need to be free
 * of React or DOM dependencies.
 */

import type {
  AdminFulfillmentRequest,
  IcpDetails,
  IntentSignalMappingEntry,
} from './admin-supabase'

// =================================================================
// Status presentation
// =================================================================

export type StatusTone = 'open' | 'pending' | 'fulfilled' | 'partial' | 'recycled' | 'neutral'

export function statusTone(status: string | null | undefined): StatusTone {
  switch ((status || '').toLowerCase()) {
    case 'open':
    case 'continued_open':
    case 'commit_closed':
    case 'scoring':
      return 'open'
    case 'pending':
      return 'pending'
    case 'fulfilled':
      return 'fulfilled'
    case 'partially_fulfilled':
      return 'partial'
    case 'recycled':
    case 'expired':
      return 'recycled'
    default:
      return 'neutral'
  }
}

export function statusLabel(status: string | null | undefined): string {
  switch ((status || '').toLowerCase()) {
    case 'continued_open':
      return 'Continued'
    case 'commit_closed':
      return 'Commits closed'
    case 'partially_fulfilled':
      return 'Partially fulfilled'
    case 'fulfilled':
      return 'Fulfilled'
    case 'recycled':
      return 'Recycled'
    case 'expired':
      return 'Expired'
    case 'scoring':
      return 'Scoring'
    case 'open':
      return 'Open'
    case 'pending':
      return 'Pending'
    default:
      return status || 'Unknown'
  }
}

// =================================================================
// Time / number formatting
// =================================================================

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffSec = Math.max(0, Math.floor((now - then) / 1000))
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d ago`
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// =================================================================
// ICP normalization
// =================================================================
// icp_details fields drifted over time (single string -> List[str]
// migration for country, industry, sub_industry, employee_count).
// These helpers coerce whatever shape we read into a clean string[]
// for rendering, so the UI doesn't have to branch.

export function asList(v: string | string[] | null | undefined): string[] {
  if (!v) return []
  if (Array.isArray(v)) return v.filter((s) => typeof s === 'string' && s.length > 0)
  return v.trim() ? [v] : []
}

export function icpSignals(icp: IcpDetails | null | undefined): string[] {
  if (!icp || !Array.isArray(icp.intent_signals)) return []
  return icp.intent_signals.filter((s) => typeof s === 'string' && s.length > 0)
}

// =================================================================
// Hotkey display
// =================================================================

export function shortHotkey(hk: string | null | undefined, head = 6, tail = 4): string {
  if (!hk) return ''
  if (hk.length <= head + tail + 3) return hk
  return `${hk.slice(0, head)}…${hk.slice(-tail)}`
}

// =================================================================
// Score display
// =================================================================

export function formatScore(s: number | null | undefined, decimals = 1): string {
  if (s === null || s === undefined) return '—'
  return s.toFixed(decimals)
}

export function formatRewardPct(p: number | null | undefined): string {
  if (p === null || p === undefined) return '—'
  // Stored as fraction (e.g. 0.0005). Render as basis-points-ish percent.
  return `${(p * 100).toFixed(3)}%`
}

// =================================================================
// Chain helpers
// =================================================================
// Walk a successor_request_id graph to find the root and the leaf.
// Used to fold a recycle chain into one logical client request.

export interface ChainView {
  rootId: string
  leafId: string
  /** Predecessors in chronological order (root first), excluding the leaf. */
  predecessors: AdminFulfillmentRequest[]
  /** The leaf row itself. */
  leaf: AdminFulfillmentRequest
}

export function buildChainViews(rows: AdminFulfillmentRequest[]): ChainView[] {
  const byId = new Map(rows.map((r) => [r.request_id, r]))
  // Reverse index: predecessor_id -> successor row. We persist the
  // pointer as `successor_request_id` on the predecessor row, so the
  // edge "A -> B" means A.successor_request_id === B.request_id.
  const successorOf = new Map<string, AdminFulfillmentRequest>()
  for (const r of rows) {
    if (r.successor_request_id) {
      successorOf.set(r.request_id, byId.get(r.successor_request_id) ?? r)
    }
  }
  // A row is a "leaf" if nothing in the set points its successor at us
  // AND we ourselves don't have a successor pointer. Equivalent: no
  // outgoing edge AND no incoming edge from a predecessor we hold.
  // Simpler: a leaf = no successor pointer of its own.
  const chains: ChainView[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    if (r.successor_request_id) continue // not a leaf
    // Walk backwards from this leaf to find the root.
    const path: AdminFulfillmentRequest[] = [r]
    let cur = r
    while (true) {
      // Find a row whose successor_request_id === cur.request_id.
      const predecessor = rows.find(
        (cand) => cand.successor_request_id === cur.request_id,
      )
      if (!predecessor) break
      if (seen.has(predecessor.request_id)) break // safety against cycle
      path.unshift(predecessor)
      seen.add(predecessor.request_id)
      cur = predecessor
    }
    seen.add(r.request_id)
    chains.push({
      rootId: path[0].request_id,
      leafId: r.request_id,
      predecessors: path.slice(0, -1),
      leaf: r,
    })
  }
  return chains
}

// =================================================================
// Intent signal helpers
// =================================================================

export function creditedSignals(
  mapping: IntentSignalMappingEntry[] | null | undefined,
): IntentSignalMappingEntry[] {
  if (!Array.isArray(mapping)) return []
  return mapping.filter(
    (s) => (s.after_decay_score ?? s.raw_score ?? 0) > 0,
  )
}
