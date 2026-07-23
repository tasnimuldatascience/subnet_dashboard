'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  AlertCircle,
  Copy,
  X,
  ChevronRight,
  ChevronsUpDown,
  Loader2,
} from 'lucide-react'
import {
  FulfillmentCosmos,
  type CosmosMinerLink,
  type CosmosRequest,
} from './FulfillmentCosmos'
import { FulfillmentMobile } from './FulfillmentMobile'

interface IcpDetails {
  prompt?: string
  company_country?: string | string[]
  company_region?: string
  contact_country?: string | string[]
  contact_region?: string
  country?: string
  geography?: string
  industry?: string
  sub_industry?: string
  target_roles?: string[]
  target_role_types?: string[]
  company_stage?: string
  employee_count?: string
  intent_signals?: Array<string | { text?: string; evidence_type?: string | null; recency_cap_days?: number | null; required?: boolean }>
  product_service?: string
  target_seniority?: string
  num_leads?: number
}

interface ActiveRequest {
  request_id: string
  icp_details: IcpDetails
  num_leads: number
  window_start: string | null
  window_end: string | null
  status: string
  created_at: string
  held_count?: number
}

interface ConsensusResult {
  consensus_id: string
  request_id: string
  miner_hotkey: string
  lead_id: string
  consensus_final_score: number
  consensus_rep_score: number
  consensus_tier2_passed: boolean
  is_winner: boolean
  reward_pct: number | null
  computed_at: string
  any_fabricated: boolean
  consensus_email_verified: boolean
  consensus_person_verified: boolean
  consensus_company_verified: boolean
}

interface MinerScore {
  score_id: string
  request_id: string
  lead_id: string
  miner_hotkey: string
  final_score: number
  failure_reason: string | null
  failure_detail: string | null
  tier1_passed: boolean
  tier2_passed: boolean
  rep_score: number
  scored_at: string
  all_fabricated: boolean
  email_verified: boolean
  person_verified: boolean
  company_verified: boolean
}

interface ConsensusSummaryRow {
  request_id: string
  miner_hotkey: string
  lead_count: number
  win_count: number
  last_computed_at: string | null
}

interface FulfillmentData {
  activeRequests: ActiveRequest[]
  // Aggregated per (request, miner) — raw lead rows load on demand per dialog.
  consensusSummary: ConsensusSummaryRow[]
  minerScores: MinerScore[] | null
  requestMap: Record<string, { icp_details: IcpDetails; num_leads: number; status: string }>
  rejectionBreakdown: { reason: string; count: number }[]
  leaderboard: { rank: number; hotkey: string; wins: number; bonusPct: number }[]
  scoreTotals: { passed: number; failed: number; sampleSize?: number }
  stats: {
    activeRequestCount: number
    totalSubmittedLeads?: number
    totalDeliveredLeads?: number
    totalConsensus: number
    totalWinners: number
    fulfilledCount: number
    recycledCount: number
    leaderboardWindowDays?: number
    leaderboardWindowStart?: string
  }
}

type FilterMode = 'all' | 'pending' | 'completed'

type HotkeyOption = {
  hotkey: string
  scored: number
  fulfilled: number
  lastActive: string | null
  rank?: number
  bonusPct?: number
}

const PENDING_STATUSES = ['pending', 'open', 'continued_open', 'commit_closed', 'scoring']

// Human-readable rejection labels.
// Pattern: prefer "Wrong X" for ICP-fit mismatches (concise, scannable),
// descriptive for verification states ("Email greylisted", "Already delivered").
// Where the same concept is checked twice (e.g. industry by miner text-match
// vs by LLM verification), suffix with the verifier in parens.
const REJECTION_LABELS: Record<string, string> = {
  // Intent & ICP fit
  insufficient_intent: 'Weak intent signals',
  seniority_mismatch: 'Wrong seniority',
  industry_mismatch: 'Wrong industry',
  sub_industry_mismatch: 'Wrong sub-industry',
  employee_count_mismatch: 'Wrong company size',
  country_mismatch: 'Wrong country',
  role_mismatch: 'Wrong role',
  geography_mismatch: 'Wrong location',

  // Email verification
  truelist_inline_verification: 'Invalid email',
  truelist_batch: 'Invalid email',
  email_accept_all: 'Catch-all email server',
  email_unknown_error: 'Email check failed',
  email_failed_greylisted: 'Email greylisted',
  email_failed_no_mailbox: 'No mailbox',
  check_mx_record: 'No email server',

  // Person verification (LinkedIn)
  lead_validation_stage4: 'Person not on LinkedIn',
  fulfillment_person_company_name_mismatch: 'Different company on LinkedIn',
  fulfillment_person_company_url_mismatch: 'LinkedIn company link mismatch',
  fulfillment_person_no_company_url: 'No company linked on LinkedIn',
  fulfillment_person_location_mismatch: 'Wrong location on LinkedIn',
  fulfillment_person_role_mismatch: 'Wrong role on LinkedIn',

  // Company verification (LLM / web)
  check_stage5_unified: "Couldn't verify company",
  check_domain_age: 'Company too new',
  check_head_request: 'Company website unreachable',
  fulfillment_company_industry_mismatch: 'Wrong industry (verified)',
  fulfillment_company_industry_classification_mismatch: 'Wrong industry (verified)',
  fulfillment_company_website_mismatch: 'Wrong company website',
  fulfillment_company_name_mismatch: 'Wrong company name',
  fulfillment_company_description_invalid: 'Bad company description',
  fulfillment_company_size_mismatch: 'Wrong company size (verified)',

  // Other / outcome
  duplicate_company: 'Duplicate company',
  company_excluded: 'Already delivered',
  fabricated_lead: 'Fabricated data',
  not_selected: 'Not selected',
}

function readableReason(reason: string): string {
  if (REJECTION_LABELS[reason]) return REJECTION_LABELS[reason]
  // Fallback for unknown keys: sentence case, with common proper nouns preserved.
  const spaced = reason.replace(/_/g, ' ').trim().toLowerCase()
  const sentence = spaced.charAt(0).toUpperCase() + spaced.slice(1)
  // Restore casing for known proper nouns / acronyms.
  return sentence
    .replace(/\blinkedin\b/gi, 'LinkedIn')
    .replace(/\bicp\b/gi, 'ICP')
    .replace(/\burl\b/gi, 'URL')
    .replace(/\bllm\b/gi, 'LLM')
    .replace(/\bmx\b/gi, 'MX')
}

// Map a failure_reason to a high-level category for grouping.
const CATEGORY_FOR_REASON: Record<string, string> = {
  insufficient_intent: 'ICP mismatch',
  industry_mismatch: 'ICP mismatch',
  sub_industry_mismatch: 'ICP mismatch',
  role_mismatch: 'ICP mismatch',
  seniority_mismatch: 'ICP mismatch',
  geography_mismatch: 'ICP mismatch',
  country_mismatch: 'ICP mismatch',
  employee_count_mismatch: 'ICP mismatch',
  truelist_inline_verification: 'Email verification',
  truelist_batch: 'Email verification',
  email_accept_all: 'Email verification',
  email_unknown_error: 'Email verification',
  email_failed_greylisted: 'Email verification',
  email_failed_no_mailbox: 'Email verification',
  lead_validation_stage4: 'Person verification',
  fulfillment_person_company_name_mismatch: 'Person verification',
  fulfillment_person_company_url_mismatch: 'Person verification',
  fulfillment_person_no_company_url: 'Person verification',
  fulfillment_person_location_mismatch: 'Person verification',
  fulfillment_person_role_mismatch: 'Person verification',
  check_stage5_unified: 'Company verification',
  check_domain_age: 'Company verification',
  check_mx_record: 'Company verification',
  check_head_request: 'Company verification',
  fulfillment_company_industry_mismatch: 'Company verification',
  fulfillment_company_website_mismatch: 'Company verification',
  fulfillment_company_name_mismatch: 'Company verification',
  fulfillment_company_description_invalid: 'Company verification',
  fulfillment_company_size_mismatch: 'Company verification',
  duplicate_company: 'Other',
  company_excluded: 'Other',
  fabricated_lead: 'Fabrication',
}

// Editorial category palette. Restrained, mostly neutral with semantic
// accents only where it actually communicates state. Each tone maps to a
// utility class in toneText() below.
const CATEGORY_COLORS: Record<string, string> = {
  Passed: 'gold',
  'ICP mismatch': 'amber',
  'Email verification': 'cream',
  'Person verification': 'neutral',
  'Company verification': 'neutral',
  Fabrication: 'burgundy',
  Other: 'neutral',
}

const CATEGORY_ORDER = [
  'ICP mismatch',
  'Company verification',
  'Email verification',
  'Person verification',
  'Fabrication',
  'Other',
  'Passed',
]

function categorizeScore(s: MinerScore): string {
  if (!s.failure_reason) return 'Passed'
  return CATEGORY_FOR_REASON[s.failure_reason] || 'Other'
}

function truncateHotkey(hotkey: string): string {
  if (hotkey.length <= 12) return hotkey
  return `${hotkey.slice(0, 6)}...${hotkey.slice(-4)}`
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatRewardWeekRange(startStr: string | null): string {
  if (!startStr) return 'Current reward week'
  const start = new Date(startStr)
  if (Number.isNaN(start.getTime())) return 'Current reward week'
  const end = new Date(start)
  end.setUTCDate(start.getUTCDate() + 7)
  const fmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
  return `Current reward week · ${fmt.format(start)} to ${fmt.format(end)}`
}

function formatRelative(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return ''
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function asText(v: unknown): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) {
    return v.filter((x) => typeof x === 'string' && x.length > 0).join(', ')
  }
  if (v == null) return ''
  return String(v)
}

function icpCompanyCountry(icp: IcpDetails | undefined): string {
  return asText(icp?.company_country ?? icp?.country)
}

// Deterministic, muted color swatch from hotkey. Low saturation keeps the
// palette feeling editorial. Every avatar reads as a refined chromatic
// neutral rather than a vivid Tailwind hue.
function hotkeySwatch(hotkey: string): { hue: number; hex: string; initials: string } {
  let h = 0
  for (let i = 0; i < hotkey.length; i++) {
    h = (h * 33 + hotkey.charCodeAt(i)) | 0
  }
  const hue = Math.abs(h) % 360
  const initials = hotkey.slice(2, 4).toUpperCase()
  // Monochrome avatar: a single warm-neutral grey, no per-hotkey hue.
  return { hue, hex: `hsl(40, 5%, 54%)`, initials }
}

// Smooth count-up animation for premium feel on stat displays
function CountUp({ value, duration = 600, className }: { value: number; duration?: number; className?: string }) {
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  useEffect(() => {
    const from = fromRef.current
    const to = value
    if (from === to) return
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      const next = Math.round(from + (to - from) * eased)
      setDisplay(next)
      if (t < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = to
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])
  return <span className={cn('tabular-nums', className)}>{display.toLocaleString()}</span>
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-100 transition-colors"
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      title="Copy hotkey"
      aria-label="Copy hotkey"
    >
      <Copy className="h-3 w-3" />
      {copied && <span className="text-gold">Copied</span>}
    </button>
  )
}

export function Fulfillment({ onSync }: { onSync?: () => void } = {}) {
  const [data, setData] = useState<FulfillmentData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterMode>('completed')
  const [searchQuery, setSearchQuery] = useState('')
  const [dialogRequest, setDialogRequest] = useState<ActiveRequest | null>(null)
  const [inspectedMiner, setInspectedMiner] = useState<string | null>(null)
  const [minerCache, setMinerCache] = useState<
    Record<
      string,
      {
        scores: MinerScore[]
        requestMap: Record<string, { icp_details: IcpDetails; num_leads: number; status: string }>
      }
    >
  >({})
  const [minerLoading, setMinerLoading] = useState<string | null>(null)
  // Per-miner fetch errors. The MinerDetailDialog reads from this so failures
  // are visible to the user instead of producing a blank scores panel.
  const [minerErrors, setMinerErrors] = useState<Record<string, string>>({})
  const [historyOpen, setHistoryOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // Last ETag we've seen from the API. Sent back as If-None-Match on the
  // next poll; if the server's data hasn't changed, we get a 304 and skip
  // both bandwidth and re-render. See route.ts notes for the protocol.
  const etagRef = useRef<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const headers: Record<string, string> = {}
      if (etagRef.current) {
        headers['If-None-Match'] = etagRef.current
      }
      const res = await fetch('/api/fulfillment', { headers, cache: 'no-store' })

      // Server tells us nothing changed since our last successful poll.
      // Keep the existing data, just refresh the sync indicator.
      if (res.status === 304) {
        onSync?.()
        return
      }
      if (!res.ok) throw new Error('Failed to fetch')

      // Remember the server's ETag so subsequent polls can short-circuit.
      const nextEtag = res.headers.get('etag')
      if (nextEtag) etagRef.current = nextEtag

      const json = await res.json()
      if (json.success) {
        setData(json.data)
        setError(null)
        onSync?.()
      } else {
        setError(json.error || 'Unknown error')
      }
    } catch {
      setError('Failed to fetch fulfillment data')
    } finally {
      setLoading(false)
    }
  }, [onSync])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 60000)
    return () => clearInterval(interval)
  }, [fetchData])

  // Global "/" keyboard shortcut to focus search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isTyping =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      if (e.key === '/' && !isTyping && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
      if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        searchInputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const graphableActiveRequests = useMemo(() => {
    if (!data) return []
    const requestIdsWithVisibleLeads = new Set(data.consensusSummary.map((g) => g.request_id))
    return data.activeRequests.filter(
      (r) => PENDING_STATUSES.includes(r.status) || requestIdsWithVisibleLeads.has(r.request_id)
    )
  }, [data])

  const filteredRequests = useMemo<CosmosRequest[]>(() => {
    return graphableActiveRequests
      .filter((r) => {
        if (filter === 'all') return true
        if (filter === 'pending') return PENDING_STATUSES.includes(r.status)
        if (filter === 'completed') return r.status === 'fulfilled'
        return true
      })
      .map((r) => ({
        request_id: r.request_id,
        status: r.status,
        num_leads: r.num_leads,
        created_at: r.created_at,
        icp_details: r.icp_details,
      }))
  }, [graphableActiveRequests, filter])

  const filteredLeads = useMemo<CosmosMinerLink[]>(() => {
    if (!data) return []
    const ids = new Set(filteredRequests.map((r) => r.request_id))
    return data.consensusSummary.filter((g) => ids.has(g.request_id))
  }, [data, filteredRequests])

  const { visibleNodeIds, matchedNodeIds, resultCount } = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) {
      return {
        visibleNodeIds: null as Set<string> | null,
        matchedNodeIds: null as Set<string> | null,
        resultCount: 0,
      }
    }
    const matched = new Set<string>()
    for (const r of filteredRequests) {
      const industry = asText(r.icp_details?.industry).toLowerCase()
      const subIndustry = asText(r.icp_details?.sub_industry).toLowerCase()
      if (
        r.request_id.toLowerCase().includes(q) ||
        industry.includes(q) ||
        subIndustry.includes(q)
      ) {
        matched.add(`req:${r.request_id}`)
      }
    }
    for (const lead of filteredLeads) {
      if (lead.miner_hotkey.toLowerCase().includes(q)) {
        matched.add(`mnr:${lead.miner_hotkey}`)
      }
    }
    const visible = new Set<string>(matched)
    for (const lead of filteredLeads) {
      const sId = `req:${lead.request_id}`
      const mId = `mnr:${lead.miner_hotkey}`
      if (matched.has(sId)) visible.add(mId)
      if (matched.has(mId)) visible.add(sId)
    }
    return { visibleNodeIds: visible, matchedNodeIds: matched, resultCount: matched.size }
  }, [searchQuery, filteredRequests, filteredLeads])

  const focusedMinerHotkey = useMemo(() => {
    if (inspectedMiner) return inspectedMiner
    const q = searchQuery.trim()
    if (!q) return null
    if (!data) return null
    const lower = q.toLowerCase()
    const hotkeys = new Set<string>()
    for (const g of data.consensusSummary) hotkeys.add(g.miner_hotkey)
    for (const l of data.leaderboard) hotkeys.add(l.hotkey)
    for (const h of hotkeys) {
      if (h.toLowerCase() === lower) return h
    }
    const matches = Array.from(hotkeys).filter((h) => h.toLowerCase().includes(lower))
    return matches.length === 1 ? matches[0] : null
  }, [inspectedMiner, searchQuery, data])

  const loadMinerScores = useCallback((hotkey: string) => {
    let cancelled = false
    setMinerLoading(hotkey)
    setMinerErrors((prev) => {
      if (!(hotkey in prev)) return prev
      const next = { ...prev }
      delete next[hotkey]
      return next
    })
    fetch(`/api/fulfillment?minerHotkey=${encodeURIComponent(hotkey)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`)
        return r.json()
      })
      .then((json) => {
        if (cancelled) return
        if (json.success && Array.isArray(json.data?.minerScores)) {
          // The API returns an EXTENDED requestMap that includes any requests
          // referenced by this miner's scores that weren't already in the base
          // fetch. Store both so the popup can resolve ICP details for every row.
          setMinerCache((prev) => ({
            ...prev,
            [hotkey]: {
              scores: json.data.minerScores,
              requestMap: json.data.requestMap || {},
            },
          }))
        } else {
          throw new Error(json.error || 'No score data returned')
        }
      })
      .catch((err) => {
        if (cancelled) return
        setMinerErrors((prev) => ({
          ...prev,
          [hotkey]: err instanceof Error ? err.message : 'Failed to load miner detail',
        }))
      })
      .finally(() => {
        if (!cancelled) setMinerLoading(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!focusedMinerHotkey) return
    if (minerCache[focusedMinerHotkey]) return
    if (minerErrors[focusedMinerHotkey]) return // Don't retry automatically
    const cleanup = loadMinerScores(focusedMinerHotkey)
    return cleanup
  }, [focusedMinerHotkey, minerCache, minerErrors, loadMinerScores])

  const focusedMinerScores = focusedMinerHotkey
    ? minerCache[focusedMinerHotkey]?.scores ?? null
    : null

  const rejectionView = useMemo(() => {
    if (focusedMinerHotkey && focusedMinerScores) {
      const counts: Record<string, number> = {}
      let passed = 0
      let failed = 0
      for (const s of focusedMinerScores) {
        if (s.failure_reason) {
          counts[s.failure_reason] = (counts[s.failure_reason] || 0) + 1
          failed++
        } else {
          passed++
        }
      }
      return {
        reasons: Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([reason, count]) => ({ reason, count })),
        passed,
        failed,
        scope: 'miner' as const,
        label: focusedMinerHotkey,
        loading: false,
      }
    }
    if (focusedMinerHotkey && minerLoading === focusedMinerHotkey) {
      return {
        reasons: [] as { reason: string; count: number }[],
        passed: 0,
        failed: 0,
        scope: 'miner' as const,
        label: focusedMinerHotkey,
        loading: true,
      }
    }
    return {
      reasons: data?.rejectionBreakdown || [],
      passed: data?.scoreTotals?.passed || 0,
      failed: data?.scoreTotals?.failed || 0,
      sampleSize: data?.scoreTotals?.sampleSize,
      scope: 'global' as const,
      label: '',
      loading: false,
    }
  }, [focusedMinerHotkey, focusedMinerScores, minerLoading, data])

  const counts = useMemo(() => {
    return {
      all: graphableActiveRequests.length,
      pending: graphableActiveRequests.filter((r) => PENDING_STATUSES.includes(r.status)).length,
      completed: graphableActiveRequests.filter((r) => r.status === 'fulfilled').length,
    }
  }, [graphableActiveRequests])

  const emphasizedNodeIds = useMemo(() => {
    if (!focusedMinerHotkey) return null
    return new Set<string>([`mnr:${focusedMinerHotkey}`])
  }, [focusedMinerHotkey])

  // The 60s payload carries per-(request, miner) aggregates only; the full
  // lead rows for a request load on demand when its dialog opens.
  const [detailLeads, setDetailLeads] = useState<ConsensusResult[] | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailRetryNonce, setDetailRetryNonce] = useState(0)
  useEffect(() => {
    setDetailLeads(null)
    setDetailError(null)
    if (!dialogRequest) {
      setDetailLoading(false)
      return
    }

    let cancelled = false
    setDetailLoading(true)
    fetch(`/api/fulfillment?requestId=${encodeURIComponent(dialogRequest.request_id)}`)
      .then(async (res) => {
        const payload = await res.json().catch(() => null)
        if (!res.ok || !payload?.success || !Array.isArray(payload.leads)) {
          throw new Error(payload?.error || 'Could not load scored leads')
        }
        return payload
      })
      .then((payload) => {
        if (cancelled) return
        setDetailLeads(payload.leads as ConsensusResult[])
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDetailError(error instanceof Error ? error.message : 'Could not load scored leads')
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [dialogRequest, detailRetryNonce])

  const dialogLeads = detailLeads ?? []

  const historyStats = useMemo(() => {
    if (!data) return { submissions: 0, fulfilled: 0, miners: 0 }
    const miners = new Set<string>()
    for (const g of data.consensusSummary) {
      miners.add(g.miner_hotkey)
    }
    const summaryLeadTotal = data.consensusSummary.reduce((acc, g) => acc + g.lead_count, 0)
    return {
      submissions: data.stats.totalSubmittedLeads ?? summaryLeadTotal,
      fulfilled: data.stats.totalDeliveredLeads ?? data.stats.totalWinners,
      miners: miners.size,
    }
  }, [data])

  const hotkeyOptions = useMemo<HotkeyOption[]>(() => {
    if (!data) return []
    const byHotkey = new Map<string, HotkeyOption>()

    const ensureHotkey = (hotkey: string) => {
      let entry = byHotkey.get(hotkey)
      if (!entry) {
        entry = {
          hotkey,
          scored: 0,
          fulfilled: 0,
          lastActive: null,
        }
        byHotkey.set(hotkey, entry)
      }
      return entry
    }

    for (const g of data.consensusSummary) {
      if (!g.miner_hotkey) continue
      const entry = ensureHotkey(g.miner_hotkey)
      entry.scored += g.lead_count
      entry.fulfilled += g.win_count
      if (
        g.last_computed_at &&
        (!entry.lastActive ||
          new Date(g.last_computed_at).getTime() > new Date(entry.lastActive).getTime())
      ) {
        entry.lastActive = g.last_computed_at
      }
    }

    for (const l of data.leaderboard) {
      if (!l.hotkey) continue
      const entry = ensureHotkey(l.hotkey)
      entry.rank = l.rank
      entry.bonusPct = l.bonusPct
      entry.fulfilled = Math.max(entry.fulfilled, l.wins)
    }

    return Array.from(byHotkey.values()).sort((a, b) => {
      const rankDelta = (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER)
      if (rankDelta !== 0) return rankDelta
      if (b.fulfilled !== a.fulfilled) return b.fulfilled - a.fulfilled
      if (b.scored !== a.scored) return b.scored - a.scored
      const aTime = a.lastActive ? new Date(a.lastActive).getTime() : 0
      const bTime = b.lastActive ? new Date(b.lastActive).getTime() : 0
      return bTime - aTime
    })
  }, [data])

  const handleRequestActivate = useCallback(
    (req: CosmosRequest) => {
      if (!data) return
      const full = data.activeRequests.find((r) => r.request_id === req.request_id)
      if (full) setDialogRequest(full)
    },
    [data]
  )

  const handleMinerActivate = useCallback((hotkey: string) => {
    setSearchQuery(hotkey)
    setInspectedMiner(hotkey)
  }, [])

  if (loading && !data) {
    // Match the real layout's heights so the skeleton doesn't pop when
    // content fills in: action bar (h-9 + container) and cosmos
    // (h-[72vh] min-h-[600px]).
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-[72vh] min-h-[600px] w-full" />
      </div>
    )
  }

  if (error && !data) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="py-8 text-center">
          <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    )
  }

  if (!data) return null

  return (
    <div>
      {/* ════════════════════════════════════════════════════════════════
       *  Mobile (< md): vertical scrollable layout with stat strip,
       *  filter pills, and stacked sections. The cosmos is hidden
       *  because pan/zoom doesn't work without touch gestures, and the
       *  three data panels are what mobile users actually consult.
       * ════════════════════════════════════════════════════════════════ */}
      <div className="md:hidden">
        <FulfillmentMobile
          activeRequests={data.activeRequests}
          consensusSummary={data.consensusSummary}
          leaderboard={data.leaderboard}
          leaderboardWindowDays={data.stats.leaderboardWindowDays ?? 30}
          totalSubmittedLeads={data.stats.totalSubmittedLeads ?? data.consensusSummary.reduce((acc, g) => acc + g.lead_count, 0)}
          totalDeliveredLeads={data.stats.totalDeliveredLeads ?? data.stats.totalWinners}
          rejectionBreakdown={data.rejectionBreakdown}
          scoreTotals={data.scoreTotals}
          filter={filter}
          setFilter={setFilter}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          focusedMinerHotkey={focusedMinerHotkey}
          onMinerSelect={handleMinerActivate}
          onRequestSelect={(req) => setDialogRequest(req)}
          onRefresh={fetchData}
          readableReason={readableReason}
          readableStatus={readableStatus}
          truncateHotkey={truncateHotkey}
          asText={asText}
          formatDate={formatDate}
        />
      </div>

      {/* ════════════════════════════════════════════════════════════════
       *  Desktop (md+): cosmos + side panels + filter bar.
       * ════════════════════════════════════════════════════════════════ */}
      <div className="hidden md:block space-y-4">
        {/* Top action bar */}
        <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-900/60 border border-slate-700/50 self-start">
          <FilterButton
            active={filter === 'all'}
            onClick={() => setFilter('all')}
            label="All"
            count={counts.all}
            tone="neutral"
          />
          <FilterButton
            active={filter === 'pending'}
            onClick={() => setFilter('pending')}
            label="Pending"
            count={counts.pending}
            tone="pending"
          />
          <FilterButton
            active={filter === 'completed'}
            onClick={() => setFilter('completed')}
            label="Completed"
            count={counts.completed}
            tone="completed"
          />
        </div>

        <div className="relative md:max-w-md md:flex-1">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              if (!e.target.value.trim()) setInspectedMiner(null)
            }}
            placeholder="Search hotkey, request id, or industry"
            className="w-full pl-3 pr-24 h-9 bg-slate-900/60 border border-slate-700/50 rounded-md text-xs font-mono text-slate-100 placeholder:text-slate-500 outline-none premium-focus transition-colors"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
            {searchQuery.trim() ? (
              <>
                <span className="text-[10px] font-mono text-slate-500 tabular-nums">
                  {resultCount} {resultCount === 1 ? 'match' : 'matches'}
                </span>
                <button
                  onClick={() => {
                    setSearchQuery('')
                    setInspectedMiner(null)
                  }}
                  className="text-slate-500 hover:text-slate-200 transition-colors"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <span className="kbd-chip">/</span>
            )}
          </div>
        </div>

        <div className="md:ml-auto flex items-center gap-3">
          <button
            onClick={() => setHistoryOpen(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-slate-300 bg-slate-900/60 border border-slate-700/50 hover:bg-slate-800/60 hover:text-slate-100 hover:border-slate-600 transition-colors"
            title="Open fulfillment activity panel"
            aria-label="Open fulfillment activity panel"
          >
            <span>Activity panel</span>
          </button>
        </div>
      </div>

      <div className="relative h-[72vh] min-h-[600px]">
        <FulfillmentCosmos
          requests={filteredRequests}
          leads={filteredLeads}
          visibleNodeIds={visibleNodeIds}
          forceLabelIds={matchedNodeIds}
          emphasizedNodeIds={emphasizedNodeIds}
          onRequestActivate={handleRequestActivate}
          onMinerActivate={handleMinerActivate}
        />

      </div>
      </div>
      {/* End md:block desktop layout */}

      <RequestHistoryDialog
        open={historyOpen}
        requests={data.activeRequests}
        leaderboard={data.leaderboard}
        hotkeyOptions={hotkeyOptions}
        leaderboardWindowStart={data.stats.leaderboardWindowStart ?? null}
        rejectionView={rejectionView}
        cosmosStats={historyStats}
        onSelectMiner={(hotkey) => {
          setHistoryOpen(false)
          handleMinerActivate(hotkey)
        }}
        onSelectRequest={(req) => {
          setHistoryOpen(false)
          setDialogRequest(req)
        }}
        onOpenChange={(open) => !open && setHistoryOpen(false)}
      />

      <RequestDetailDialog
        request={dialogRequest}
        leads={dialogLeads}
        loading={detailLoading}
        error={detailError}
        onRetry={() => setDetailRetryNonce((nonce) => nonce + 1)}
        onOpenChange={(open) => !open && setDialogRequest(null)}
      />

      <MinerDetailDialog
        hotkey={inspectedMiner}
        scores={inspectedMiner ? minerCache[inspectedMiner]?.scores ?? null : null}
        loading={inspectedMiner !== null && minerLoading === inspectedMiner}
        error={inspectedMiner ? minerErrors[inspectedMiner] ?? null : null}
        onRetry={() => {
          if (inspectedMiner) loadMinerScores(inspectedMiner)
        }}
        requestMap={
          inspectedMiner
            ? { ...data.requestMap, ...(minerCache[inspectedMiner]?.requestMap || {}) }
            : data.requestMap
        }
        onOpenChange={(open) => {
          if (!open) {
            setInspectedMiner(null)
            setSearchQuery('')
          }
        }}
      />
    </div>
  )
}

type RejectionView = {
  reasons: { reason: string; count: number }[]
  passed: number
  failed: number
  sampleSize?: number
  scope: 'global' | 'miner'
  label: string
  loading: boolean
}

function RejectionReasonsContent({
  view,
  maxRows,
  className,
}: {
  view: RejectionView
  maxRows?: number
  className?: string
}) {
  const rows = typeof maxRows === 'number' ? view.reasons.slice(0, maxRows) : view.reasons
  const maxCount = Math.max(1, ...rows.map((r) => r.count))
  const totalEvaluated = view.passed + view.failed

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-mono text-slate-500">
        <span>
          Not fulfilled <span className="text-slate-300 tabular-nums">{view.failed}</span>
        </span>
        <span>
          Fulfilled <span className="text-slate-300 tabular-nums">{view.passed}</span>
        </span>
        <span>
          Evaluated <span className="text-slate-300 tabular-nums">{totalEvaluated}</span>
        </span>
      </div>

      {view.loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-500 py-3">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading scores...
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-3 text-xs text-slate-500">
          {view.scope === 'miner' ? 'No rejections. Clean miner.' : 'No rejection data.'}
        </div>
      ) : (
        rows.map(({ reason, count }, idx) => {
          const pct = (count / maxCount) * 100
          const ofTotal = view.failed > 0 ? (count / view.failed) * 100 : 0
          const severity = 1 - idx / Math.max(1, rows.length - 1) * 0.45
          return (
            <div key={reason} className="group">
              <div className="flex items-center justify-between mb-1 text-[10px]">
                <span
                  className="text-slate-200 truncate"
                  title={readableReason(reason) + ` · ${reason}`}
                >
                  {readableReason(reason)}
                </span>
                <span className="flex items-center gap-2 text-slate-500 font-mono shrink-0 ml-2 tabular-nums">
                  <span>{ofTotal.toFixed(0)}%</span>
                  <span className="text-slate-300 w-6 text-right">{count}</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-800/60 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    background: `linear-gradient(90deg, rgba(236, 234, 230, ${0.26 + severity * 0.2}) 0%, rgba(236, 234, 230, ${0.16 + severity * 0.16}) 100%)`,
                    transition: 'width 320ms cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                />
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

/* ============================================================
 * Request detail dialog
 * ============================================================ */
/* ============================================================
 * Request history dialog (table view)
 * ============================================================ */
function RequestHistoryDialog({
  open,
  requests,
  leaderboard,
  hotkeyOptions,
  leaderboardWindowStart,
  rejectionView,
  cosmosStats,
  onSelectMiner,
  onSelectRequest,
  onOpenChange,
}: {
  open: boolean
  requests: ActiveRequest[]
  leaderboard: { rank: number; hotkey: string; wins: number; bonusPct: number }[]
  hotkeyOptions: HotkeyOption[]
  leaderboardWindowStart: string | null
  rejectionView: RejectionView
  cosmosStats: { submissions: number; fulfilled: number; miners: number }
  onSelectMiner: (hotkey: string) => void
  onSelectRequest: (req: ActiveRequest) => void
  onOpenChange: (open: boolean) => void
}) {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<FilterMode>('all')
  const [mode, setMode] = useState<'requests' | 'leaderboard' | 'rejections'>('requests')

  useEffect(() => {
    if (!open) {
      setQuery('')
      setScope('all')
      setMode('requests')
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return requests
      .filter((r) => {
        if (scope === 'pending') return PENDING_STATUSES.includes(r.status)
        if (scope === 'completed') return r.status === 'fulfilled'
        return true
      })
      .filter((r) => {
        if (!q) return true
        const icp = r.icp_details
        return (
          r.request_id.toLowerCase().includes(q) ||
          asText(icp?.industry).toLowerCase().includes(q) ||
          asText(icp?.sub_industry).toLowerCase().includes(q) ||
          icpCompanyCountry(icp).toLowerCase().includes(q) ||
          asText(icp?.company_region ?? icp?.geography).toLowerCase().includes(q) ||
          asText(icp?.contact_country).toLowerCase().includes(q) ||
          asText(icp?.contact_region).toLowerCase().includes(q)
        )
      })
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [requests, query, scope])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="sm:w-[calc(100vw-3rem)] sm:max-w-[1400px] sm:max-h-[90vh] overflow-hidden flex flex-col bg-slate-950 border-slate-800 text-slate-100 p-0 sm:p-0 gap-0"
      >
        <DialogHeader className="px-5 py-4 border-b border-slate-800/80 space-y-3 text-left">
          <div className="flex items-center gap-2 pr-8">
            <DialogTitle className="text-sm font-semibold text-slate-100">
              {mode === 'requests'
                ? 'Fulfillment activity'
                : mode === 'leaderboard'
                  ? 'Miner leaderboard'
                  : 'Not fulfilled reasons'}
            </DialogTitle>
            {mode === 'rejections' && (
              <span className="ml-auto text-[10px] text-slate-500 font-mono tabular-nums">
                {rejectionView.failed} not fulfilled · {rejectionView.passed} fulfilled
              </span>
            )}
          </div>

          {mode === 'requests' && (
            <div className="grid grid-cols-3 gap-2">
              <HistoryStat label="Miners" value={cosmosStats.miners} tone="neutral" />
              <HistoryStat label="Submitted leads" value={cosmosStats.submissions} tone="neutral" />
              <HistoryStat label="Fulfilled leads" value={cosmosStats.fulfilled} tone="gold" />
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-900/60 border border-slate-700/50 self-start">
              <HistoryTab
                active={mode === 'requests' && scope === 'all'}
                onClick={() => {
                  setMode('requests')
                  setScope('all')
                }}
                label="All"
                tone="neutral"
              />
              <HistoryTab
                active={mode === 'requests' && scope === 'pending'}
                onClick={() => {
                  setMode('requests')
                  setScope('pending')
                }}
                label="Pending"
                tone="pending"
              />
              <HistoryTab
                active={mode === 'requests' && scope === 'completed'}
                onClick={() => {
                  setMode('requests')
                  setScope('completed')
                }}
                label="Completed"
                tone="completed"
              />
              <button
                onClick={() => setMode('rejections')}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all',
                  mode === 'rejections'
                    ? 'bg-burgundy-soft text-burgundy border-burgundy-soft'
                    : 'bg-transparent text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/40'
                )}
              >
                <span>Not fulfilled reasons</span>
                <span className={cn('text-[10px] font-mono tabular-nums', mode === 'rejections' ? 'text-current/70' : 'text-slate-500')}>
                  {rejectionView.failed}
                </span>
              </button>
            </div>
            <HotkeySearchDropdown
              options={hotkeyOptions}
              onSelect={onSelectMiner}
            />
            {mode === 'requests' && (
            <div className="relative sm:flex-1 sm:max-w-md">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by request id, industry, or country"
                className="w-full pl-3 pr-20 h-8 bg-slate-900/60 border border-slate-700/50 rounded-md text-[11px] font-mono text-slate-100 placeholder:text-slate-500 outline-none premium-focus transition-colors"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                {query.trim() ? (
                  <>
                    <span className="text-[10px] font-mono text-slate-500 tabular-nums">
                      {filtered.length}
                    </span>
                    <button
                      onClick={() => setQuery('')}
                      className="text-slate-500 hover:text-slate-200 transition-colors"
                      aria-label="Clear search"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <span className="text-[10px] font-mono text-slate-500 tabular-nums">
                    {filtered.length}
                  </span>
                )}
              </div>
            </div>
            )}
          </div>
        </DialogHeader>

        <LeaderboardSummary
          entries={leaderboard}
          windowStart={leaderboardWindowStart}
          onSelect={onSelectMiner}
        />

        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {mode === 'rejections' ? (
            <div className="p-5">
              <RejectionReasonsContent view={rejectionView} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-sm text-slate-500">
              No requests match the current filter.
            </div>
          ) : (
            <div>
              <div className="grid grid-cols-[2rem_5.5rem_minmax(0,1fr)_5rem_6rem_7rem] gap-3 px-5 py-2 text-[9px] uppercase tracking-[0.08em] text-slate-500 font-mono border-b border-slate-800/60 sticky top-0 bg-slate-950/95 backdrop-blur-sm z-10">
                <span>#</span>
                <span>ID</span>
                <span>Industry / role</span>
                <span className="text-right">Leads</span>
                <span className="text-center">Status</span>
                <span>Time</span>
              </div>
              {filtered.map((req, idx) => (
                <HistoryRow
                  key={req.request_id}
                  index={idx + 1}
                  request={req}
                  onSelect={() => onSelectRequest(req)}
                />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function HotkeySearchDropdown({
  options,
  onSelect,
}: {
  options: HotkeyOption[]
  onSelect: (hotkey: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim()
  const exactOption = normalizedQuery
    ? options.some((opt) => opt.hotkey.toLowerCase() === normalizedQuery.toLowerCase())
    : false
  const canOpenTypedHotkey =
    normalizedQuery.length >= 8 && !normalizedQuery.includes(' ') && !exactOption

  const selectHotkey = (hotkey: string) => {
    const cleaned = hotkey.trim()
    if (!cleaned) return
    onSelect(cleaned)
    setOpen(false)
    setQuery('')
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setQuery('')
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 w-full items-center justify-between gap-2 rounded-md border border-slate-700/50 bg-slate-900/60 px-3 text-[11px] font-mono text-slate-200 transition-colors hover:border-slate-600 hover:bg-slate-800/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--brand)] sm:w-64"
          title="Open miner detail by hotkey"
          aria-label="Open miner detail by hotkey"
        >
          <span className="truncate">Hotkey</span>
          <span className="ml-auto text-[10px] text-slate-500 tabular-nums">
            {options.length}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(calc(100vw-3rem),26rem)] overflow-hidden border-slate-800 bg-slate-950 p-0 text-slate-100 shadow-2xl shadow-black/50"
      >
        <Command className="bg-slate-950 text-slate-100 [&_[data-slot=command-input-wrapper]]:border-slate-800">
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search or paste hotkey"
            className="font-mono text-xs text-slate-100 placeholder:text-slate-500"
          />
          <CommandList className="max-h-[19rem]">
            <CommandEmpty className="py-6 text-center text-xs text-slate-500">
              No matching hotkeys.
            </CommandEmpty>
            {canOpenTypedHotkey && (
              <CommandGroup
                heading="Typed hotkey"
                className="[&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-slate-500"
              >
                <CommandItem
                  value={`open:${normalizedQuery}`}
                  onSelect={() => selectHotkey(normalizedQuery)}
                  className="items-start rounded-md px-2 py-2 data-[selected=true]:bg-slate-800/80 data-[selected=true]:text-slate-100"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] uppercase tracking-[0.08em] text-slate-500">
                      Open hotkey
                    </div>
                    <code className="mt-0.5 block truncate font-mono text-xs text-slate-100">
                      {normalizedQuery}
                    </code>
                  </div>
                </CommandItem>
              </CommandGroup>
            )}
            {options.length > 0 && (
              <CommandGroup
                heading="Activity hotkeys"
                className="[&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-slate-500"
              >
                {options.map((opt) => (
                  <CommandItem
                    key={opt.hotkey}
                    value={opt.hotkey}
                    onSelect={() => selectHotkey(opt.hotkey)}
                    className="items-start rounded-md px-2 py-2 data-[selected=true]:bg-slate-800/80 data-[selected=true]:text-slate-100"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        {opt.rank !== undefined && (
                          <span className="shrink-0 font-mono text-[10px] text-slate-500 tabular-nums">
                            #{opt.rank}
                          </span>
                        )}
                        <code className="truncate font-mono text-xs text-slate-100" title={opt.hotkey}>
                          {truncateHotkey(opt.hotkey)}
                        </code>
                        {opt.bonusPct !== undefined && opt.bonusPct > 0 && (
                          <span className="ml-auto shrink-0 font-mono text-[10px] text-amber-warm tabular-nums">
                            +{opt.bonusPct}%
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[10px] text-slate-500 tabular-nums">
                        <span>{opt.scored.toLocaleString()} scored</span>
                        <span>{opt.fulfilled.toLocaleString()} fulfilled</span>
                        {opt.lastActive && <span>{formatRelative(opt.lastActive)}</span>}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function HistoryStat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'gold' | 'neutral'
}) {
  const valueClass = tone === 'gold' ? 'text-gold' : 'text-slate-100'
  return (
    <div className="rounded-md border border-slate-800/80 bg-slate-900/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">
        {label}
      </div>
      <div className={cn('text-lg font-semibold tabular-nums leading-tight mt-0.5', valueClass)}>
        {value.toLocaleString()}
      </div>
    </div>
  )
}

function LeaderboardSummary({
  entries,
  windowStart,
  onSelect,
}: {
  entries: { rank: number; hotkey: string; wins: number; bonusPct: number }[]
  windowStart: string | null
  onSelect: (hotkey: string) => void
}) {
  if (entries.length === 0) {
    return (
      <div className="border-b border-slate-800/80 px-5 py-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-100">Miner leaderboard</span>
          <span className="text-[10px] text-slate-500 font-mono">
            {formatRewardWeekRange(windowStart)}
          </span>
        </div>
        <div className="rounded-md border border-dashed border-slate-800/80 px-4 py-5 text-center text-sm text-slate-500">
          No fulfilled leads yet this week.
        </div>
      </div>
    )
  }

  return (
    <div className="border-b border-slate-800/80 px-5 py-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-100">Miner leaderboard</span>
        <span className="text-[10px] text-slate-500 font-mono">
          {formatRewardWeekRange(windowStart)}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {entries.slice(0, 5).map((entry) => (
          <button
            key={entry.hotkey}
            type="button"
            onClick={() => onSelect(entry.hotkey)}
            className="rounded-lg border border-slate-800/80 bg-slate-900/40 px-3 py-2 text-left transition-colors hover:bg-slate-800/60"
            title={`Inspect ${entry.hotkey}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] text-slate-500 tabular-nums">
                #{entry.rank}
              </span>
              <span className="font-mono text-[10px] text-amber-warm tabular-nums">
                {entry.bonusPct > 0 ? `+${entry.bonusPct}%` : ''}
              </span>
            </div>
            <code className="mt-1 block truncate font-mono text-[11px] text-slate-200" title={entry.hotkey}>
              {truncateHotkey(entry.hotkey)}
            </code>
            <div className="mt-1 text-xs font-semibold text-gold tabular-nums">
              {entry.wins} fulfilled
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function HistoryTab({
  active,
  onClick,
  label,
  count,
  tone,
}: {
  active: boolean
  onClick: () => void
  label: string
  count?: number
  tone: 'neutral' | 'pending' | 'completed'
}) {
  const activeBg =
    tone === 'pending'
      ? 'bg-amber-warm-soft text-amber-warm border-amber-warm-soft'
      : tone === 'completed'
        ? 'bg-cream-soft text-cream border-cream-soft'
        : 'bg-slate-700/60 text-slate-100 border-slate-500/40'
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all',
        active
          ? activeBg
          : 'bg-transparent text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/40'
      )}
    >
      <span>{label}</span>
      {count !== undefined && (
        <span
          className={cn(
            'text-[10px] font-mono tabular-nums',
            active ? 'text-current/70' : 'text-slate-500'
          )}
        >
          {count}
        </span>
      )}
    </button>
  )
}

function HistoryRow({
  index,
  request,
  onSelect,
}: {
  index: number
  request: ActiveRequest
  onSelect: () => void
}) {
  const isFulfilled = request.status === 'fulfilled'
  const isPending = PENDING_STATUSES.includes(request.status)
  const heldCount = request.held_count ?? 0
  const icp = request.icp_details
  const industries = [asText(icp?.industry), asText(icp?.sub_industry)]
    .filter((s) => s.length > 0)
    .join(' / ')
  const roles = Array.isArray(icp?.target_roles)
    ? icp.target_roles.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : []
  const roleStr = roles[0]
  const windowLabel =
    request.window_start && request.window_end
      ? `${formatDate(request.window_start)} – ${formatDate(request.window_end)}`
      : '·'
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full grid grid-cols-[2rem_5.5rem_minmax(0,1fr)_5rem_7.25rem_7rem] gap-3 items-center px-5 py-2.5 text-[11px] text-left border-b border-slate-800/40 hover:bg-slate-900/60 transition-colors focus:outline-none focus-visible:bg-slate-900/60"
      title={`Open request ${request.request_id}`}
    >
      <span className="text-slate-500 font-mono tabular-nums">{index}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        <code className="font-mono text-slate-200 truncate" title={request.request_id}>
          {request.request_id.slice(0, 8)}
        </code>
      </div>
      <div className="min-w-0">
        <div className="text-slate-200 truncate" title={industries || 'No ICP details'}>
          {industries || <span className="text-slate-600">·</span>}
        </div>
        {roleStr && (
          <div className="text-[10px] text-slate-500 truncate">{roleStr}</div>
        )}
      </div>
      <div className="text-right font-mono text-slate-200 tabular-nums">
        <div>
          <span>{request.num_leads}</span>
          <span className="text-slate-500 text-[10px]"> leads</span>
        </div>
        {!isFulfilled && heldCount > 0 && (
          <div className="text-[10px] text-gold tabular-nums">{heldCount} approved</div>
        )}
      </div>
      <div className="flex justify-center">
        <StatusPill status={request.status} isPending={isPending} isFulfilled={isFulfilled} />
      </div>
      <div
        className="text-[10px] font-mono tabular-nums leading-tight min-w-0"
        title={windowLabel}
      >
        {request.window_start ? (
          <span className="text-slate-300 truncate block">
            {formatDate(request.window_start)}
          </span>
        ) : (
          <span className="text-slate-600">·</span>
        )}
      </div>
    </button>
  )
}

function StatusPill({
  status,
  isPending,
  isFulfilled,
}: {
  status: string
  isPending: boolean
  isFulfilled: boolean
}) {
  const label = readableStatus(status)
  const isCommitClosed = status === 'commit_closed'
  const showDot = isPending || isCommitClosed
  const cls = isFulfilled
    ? 'bg-gold-soft text-gold border-gold-soft'
    : isCommitClosed
      ? 'bg-cream-soft text-cream border-cream-soft'
      : isPending
      ? 'bg-cream-soft text-cream border-cream-soft'
      : 'bg-slate-700/40 text-slate-300 border-slate-600/40'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-1 text-[10px] font-medium leading-none shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]',
        cls
      )}
    >
      {showDot && (
        <span
          className={cn(
            'inline-block h-1.5 w-1.5 rounded-full dot-amber',
            !isCommitClosed && 'live-pulse'
          )}
        />
      )}
      {label}
    </span>
  )
}

function readableStatus(status: string): string {
  switch (status) {
    case 'pending':
      return 'Pending'
    case 'open':
    case 'continued_open':
      return 'Open'
    case 'commit_closed':
      return 'Commit closed'
    case 'scoring':
      return 'Scoring'
    case 'fulfilled':
      return 'Fulfilled'
    case 'recycled':
      return 'Recycled'
    default:
      return status
  }
}

function RequestDetailDialog({
  request,
  leads,
  loading,
  error,
  onRetry,
  onOpenChange,
}: {
  request: ActiveRequest | null
  leads: ConsensusResult[]
  loading: boolean
  error: string | null
  onRetry: () => void
  onOpenChange: (open: boolean) => void
}) {
  const open = request !== null
  // Render nothing when there's no request. Dialog handles unmount cleanly.
  if (!request) return null

  const isFulfilled = request.status === 'fulfilled'
  const isCommitClosed = request.status === 'commit_closed'
  const winners = leads.filter((l) => l.is_winner).length
  const heldCount = request.held_count ?? 0
  const remaining = Math.max(0, request.num_leads - heldCount)
  const fillPct =
    request.num_leads > 0 ? Math.min(100, (heldCount / request.num_leads) * 100) : 0
  const icp = request.icp_details
  const targetRoles = Array.isArray(icp?.target_roles)
    ? icp.target_roles.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="sm:max-w-3xl sm:w-[calc(100%-2rem)] sm:max-h-[85vh] overflow-hidden flex flex-col bg-slate-950 border-slate-800 text-slate-100 p-0 sm:p-0 gap-0"
      >
        <DialogHeader className="px-5 py-4 border-b border-slate-800/80 space-y-2 text-left">
          <div className="flex items-center gap-2 pr-8">
            <DialogTitle className="text-sm font-mono text-slate-100">
              {request.request_id.slice(0, 12)}
            </DialogTitle>
            <CopyButton text={request.request_id} />
            <span
              className={cn(
                'ml-auto inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-1 text-[10px] font-medium leading-none',
                isFulfilled || isCommitClosed
                  ? 'text-cream border-cream-soft bg-cream-soft'
                  : 'text-amber-warm border-amber-warm-soft bg-amber-warm-soft'
              )}
            >
              {!isFulfilled && (
                <span
                  className={cn(
                    'inline-block h-1.5 w-1.5 rounded-full dot-amber',
                    !isCommitClosed && 'live-pulse'
                  )}
                />
              )}
              {readableStatus(request.status)}
            </span>
          </div>
          <div className="text-sm text-slate-200">
            {[asText(icp?.industry), asText(icp?.sub_industry)]
              .filter((s) => s.length > 0)
              .join(' / ') || 'No ICP details'}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400 font-mono">
            <span>
              <span className="text-slate-500">Requested</span>{' '}
              <span className="text-slate-200 tabular-nums">{request.num_leads}</span>
            </span>
            {isFulfilled ? (
              <>
                <span>
                  <span className="text-slate-500">Submitted</span>{' '}
                  <span className="text-slate-200 tabular-nums">
                    {loading || error ? '—' : leads.length}
                  </span>
                </span>
                <span>
                  <span className="text-slate-500">Fulfilled</span>{' '}
                  <span className="text-gold tabular-nums">
                    {loading || error ? '—' : winners}
                  </span>
                </span>
              </>
            ) : (
              <>
                <span>
                  <span className="text-slate-500">Approved</span>{' '}
                  <span className="text-gold tabular-nums">{heldCount}</span>
                </span>
                <span>
                  <span className="text-slate-500">Remaining</span>{' '}
                  <span className="text-amber-warm tabular-nums">{remaining}</span>
                </span>
              </>
            )}
            {request.window_start && request.window_end && (
              <span>
                <span className="text-slate-500">Window</span>{' '}
                {formatDate(request.window_start)} – {formatDate(request.window_end)}
              </span>
            )}
          </div>
          {(icpCompanyCountry(icp) ||
            asText(icp?.contact_country) ||
            asText(icp?.employee_count) ||
            asText(icp?.target_seniority) ||
            targetRoles.length > 0) && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {icpCompanyCountry(icp) && (
                <Badge variant="outline" className="text-[9px] border-slate-700/60 text-slate-300">
                  Co: {icpCompanyCountry(icp)}
                </Badge>
              )}
              {asText(icp?.contact_country) && (
                <Badge variant="outline" className="text-[9px] border-slate-700/60 text-slate-300">
                  Contact: {asText(icp?.contact_country)}
                </Badge>
              )}
              {asText(icp?.employee_count) && (
                <Badge variant="outline" className="text-[9px] border-slate-700/60 text-slate-300">
                  {asText(icp?.employee_count)} employees
                </Badge>
              )}
              {asText(icp?.target_seniority) && (
                <Badge variant="outline" className="text-[9px] border-slate-700/60 text-slate-300">
                  {asText(icp?.target_seniority)}
                </Badge>
              )}
              {targetRoles.slice(0, 4).map((r) => (
                <Badge
                  key={r}
                  variant="outline"
                  className="text-[9px] border-slate-700/60 text-slate-300"
                >
                  {r}
                </Badge>
              ))}
            </div>
          )}
          {Array.isArray(icp?.intent_signals) && icp.intent_signals.length > 0 && (
            <div className="pt-2 space-y-1">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Intent signals</div>
              <ul className="space-y-1">
                {icp.intent_signals.map((signal, i) => {
                  const text = typeof signal === 'string' ? signal : signal?.text ?? ''
                  if (!text) return null
                  const evidenceType = typeof signal === 'object' ? signal?.evidence_type : null
                  const recencyCap = typeof signal === 'object' ? signal?.recency_cap_days : null
                  return (
                    <li key={i} className="text-[11px] text-slate-300 flex gap-2 items-start">
                      <span className="text-slate-600 font-mono shrink-0">{i + 1}.</span>
                      <span className="flex-1">{text}</span>
                      {(evidenceType || recencyCap != null) && (
                        <span className="shrink-0 flex gap-1.5 text-[9px] text-slate-500">
                          {evidenceType && (
                            <span className="rounded border border-slate-800 px-1 py-0.5">{evidenceType}</span>
                          )}
                          {recencyCap != null && (
                            <span className="rounded border border-slate-800 px-1 py-0.5">{recencyCap}d</span>
                          )}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-gold" aria-hidden />
              <p className="mt-2 text-sm text-slate-500">Loading scored leads...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertCircle className="h-6 w-6 text-amber-warm" aria-hidden />
              <p className="mt-2 text-sm text-slate-300">{error}</p>
              <button
                type="button"
                onClick={onRetry}
                className="mt-4 inline-flex h-8 items-center rounded border border-slate-700 px-3 text-xs font-medium text-slate-200 transition-colors hover:border-slate-600 hover:bg-slate-900"
              >
                Try again
              </button>
            </div>
          ) : !isFulfilled ? (
            <PendingRequestBody
              heldCount={heldCount}
              requested={request.num_leads}
              remaining={remaining}
              fillPct={fillPct}
              status={request.status}
              leads={leads}
            />
          ) : leads.length === 0 ? (
            <div className="text-center py-12 text-sm text-slate-500">
              No scored leads for this request.
            </div>
          ) : (
            <div className="space-y-1">
              <div className="grid grid-cols-[2rem_1fr_5rem_4.5rem_1fr] gap-3 px-2 py-1.5 text-[10px] text-slate-500 font-mono border-b border-slate-800/60">
                <span>#</span>
                <span>Hotkey</span>
                <span className="text-right">Score</span>
                <span className="text-center">Outcome</span>
                <span>Checks</span>
              </div>
              {leads.map((lead, idx) => (
                <LeadRow key={lead.consensus_id} lead={lead} rank={idx + 1} />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PendingRequestBody({
  heldCount,
  requested,
  remaining,
  fillPct,
  status,
  leads,
}: {
  heldCount: number
  requested: number
  remaining: number
  fillPct: number
  status: string
  leads: ConsensusResult[]
}) {
  // Build a per-miner aggregation from anything we know so far (typically empty
  // for pure pending; non-empty when consensus has partially run, e.g. scoring).
  const byMiner = new Map<string, number>()
  for (const c of leads) {
    byMiner.set(c.miner_hotkey, (byMiner.get(c.miner_hotkey) || 0) + 1)
  }
  const participants = Array.from(byMiner.entries()).sort((a, b) => b[1] - a[1])

  const statusHint =
    status === 'pending'
      ? 'Waiting for miners to commit leads.'
      : status === 'open' || status === 'continued_open'
        ? 'Open for new lead submissions.'
        : status === 'commit_closed'
          ? 'No more submissions accepted. Awaiting scoring.'
          : status === 'scoring'
            ? 'Validators are scoring submissions.'
            : 'In progress.'

  return (
    <div className="space-y-5 py-3">
      {/* Fulfillment progress hero */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold text-slate-100 tabular-nums leading-none">
              <CountUp value={heldCount} />
            </span>
            <span className="text-slate-500 font-mono text-sm tabular-nums">/ {requested}</span>
            <span className="text-[10px] text-slate-500 uppercase tracking-[0.1em] ml-1">
              approved
            </span>
          </div>
          <span className="text-[11px] text-slate-400 font-mono tabular-nums">
            <span className="text-gold">{fillPct.toFixed(0)}%</span> fulfilled ·{' '}
            <span className="text-amber-warm">{remaining}</span> remaining
          </span>
        </div>
        <div className="h-2 rounded-full bg-slate-800/70 overflow-hidden">
          <div
            className="h-full"
            style={{
              width: `${fillPct}%`,
              background: 'linear-gradient(90deg, #4c4a45 0%, #ededec 100%)',
              transition: 'width 480ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          />
        </div>
        <div className="text-[11px] text-slate-400">{statusHint}</div>
      </div>

      {/* Participants so far (if any) */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-xs font-semibold text-slate-100">Participating miners</span>
          <span className="text-[10px] text-slate-500 font-mono tabular-nums">
            {participants.length} so far
          </span>
        </div>
        {participants.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-800/80 px-4 py-6 text-center text-[11px] text-slate-500">
            No miner submissions recorded yet. Once miners commit leads, they&apos;ll show here.
          </div>
        ) : (
          <div className="rounded-lg border border-slate-800/70 overflow-hidden">
            <div className="grid grid-cols-[2rem_1fr_5rem] gap-3 px-3 py-1.5 text-[9px] text-slate-500 font-mono uppercase tracking-[0.06em] bg-slate-900/40 border-b border-slate-800/60">
              <span>#</span>
              <span>Hotkey</span>
              <span className="text-right">Submitted</span>
            </div>
            {participants.map(([hotkey, count], idx) => (
              <div
                key={hotkey}
                className="grid grid-cols-[2rem_1fr_5rem] gap-3 items-center px-3 py-2 text-[11px] border-t first:border-t-0 border-slate-800/40 hover:bg-slate-900/40 transition-colors"
              >
                <span className="text-slate-500 font-mono tabular-nums">{idx + 1}</span>
                <code className="font-mono text-slate-200 truncate" title={hotkey}>
                  {truncateHotkey(hotkey)}
                </code>
                <span className="text-right font-mono text-slate-200 tabular-nums">{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function LeadRow({ lead, rank }: { lead: ConsensusResult; rank: number }) {
  const score = lead.consensus_final_score
  const tier2 = lead.consensus_tier2_passed
  return (
    <div className="grid grid-cols-[2rem_1fr_5rem_4.5rem_1fr] gap-3 items-center px-2 py-2 text-xs hover:bg-slate-900/60 transition-colors rounded-md">
      <span className="text-slate-500 font-mono tabular-nums">{rank}</span>
      <div className="flex items-center gap-2 min-w-0">
        <code className="font-mono text-slate-200 truncate" title={lead.miner_hotkey}>
          {truncateHotkey(lead.miner_hotkey)}
        </code>
        <CopyButton text={lead.miner_hotkey} />
      </div>
      <span
        className={cn(
          'font-mono font-semibold text-right tabular-nums',
          lead.is_winner ? 'text-gold-bright' : score > 0 ? 'text-gold' : 'text-burgundy'
        )}
      >
        {score.toFixed(2)}
      </span>
      <span className="text-center">
        {lead.is_winner ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gold-tint text-gold-bright border border-gold-soft font-medium">
            Winner
          </span>
        ) : tier2 ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gold-soft text-gold border border-gold-soft font-medium">
            Passed
          </span>
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-burgundy-soft text-burgundy border border-burgundy-soft font-medium">
            Rejected
          </span>
        )}
      </span>
      <div className="flex flex-wrap gap-1">
        <CheckChip label="email" passed={lead.consensus_email_verified} />
        <CheckChip label="person" passed={lead.consensus_person_verified} />
        <CheckChip label="company" passed={lead.consensus_company_verified} />
        {lead.any_fabricated && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-burgundy-soft text-burgundy border border-burgundy-soft font-medium">
            fabricated
          </span>
        )}
      </div>
    </div>
  )
}

function CheckChip({ label, passed }: { label: string; passed: boolean }) {
  return (
    <span
      className={cn(
        'text-[9px] px-1 py-0.5 rounded font-medium',
        passed
          ? 'bg-gold-soft text-gold border border-gold-soft'
          : 'bg-slate-700/30 text-slate-400 border border-slate-700/40'
      )}
    >
      {label}
    </span>
  )
}

/* ============================================================
 * Miner detail dialog (profile-style)
 * ============================================================ */
function MinerDetailDialog({
  hotkey,
  scores,
  loading,
  error,
  onRetry,
  requestMap,
  onOpenChange,
}: {
  hotkey: string | null
  scores: MinerScore[] | null
  loading: boolean
  error?: string | null
  onRetry?: () => void
  requestMap: Record<string, { icp_details: IcpDetails; num_leads: number; status: string }>
  onOpenChange: (open: boolean) => void
}) {
  const [expandedScoreId, setExpandedScoreId] = useState<string | null>(null)
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())
  const [requestFilter, setRequestFilter] = useState('')
  const open = hotkey !== null

  // Clear the in-dialog filter whenever the dialog closes or switches miner
  useEffect(() => {
    if (!open) {
      setRequestFilter('')
      setExpandedScoreId(null)
      setCollapsedCategories(new Set())
    }
  }, [open, hotkey])

  if (!hotkey) {
    return (
      <DialogPrimitive.Root open={false} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Content aria-describedby={undefined} />
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    )
  }

  const list = scores || []
  // Overall stats are always computed from the full list (not filtered)
  const passed = list.filter((s) => !s.failure_reason).length
  const passRate = list.length > 0 ? (passed / list.length) * 100 : 0
  const avgScore =
    list.length > 0 ? list.reduce((sum, s) => sum + (s.final_score || 0), 0) / list.length : 0
  const lastActive = list.length > 0 ? list[0].scored_at : null

  // In-dialog filter: narrow to a specific request id / industry / sub-industry / country
  const q = requestFilter.trim().toLowerCase()
  const filteredList = q
    ? list.filter((s) => {
        const req = requestMap[s.request_id]
        const icp = req?.icp_details as IcpDetails | undefined
        return (
          s.request_id.toLowerCase().includes(q) ||
          asText(icp?.industry).toLowerCase().includes(q) ||
          asText(icp?.sub_industry).toLowerCase().includes(q) ||
          icpCompanyCountry(icp).toLowerCase().includes(q) ||
          asText(icp?.company_region ?? icp?.geography).toLowerCase().includes(q) ||
          asText(icp?.contact_country).toLowerCase().includes(q) ||
          asText(icp?.contact_region).toLowerCase().includes(q)
        )
      })
    : list

  // Unique matching requests, surfaces what the user is currently scoped to
  const matchingRequestIds = new Set(filteredList.map((s) => s.request_id))

  const grouped: { category: string; items: MinerScore[] }[] = []
  const byCat = new Map<string, MinerScore[]>()
  for (const s of filteredList) {
    const cat = categorizeScore(s)
    const arr = byCat.get(cat) || []
    arr.push(s)
    byCat.set(cat, arr)
  }
  for (const cat of CATEGORY_ORDER) {
    const items = byCat.get(cat)
    if (items && items.length > 0) grouped.push({ category: cat, items })
  }

  const swatch = hotkeySwatch(hotkey)

  const toggleCategory = (cat: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-[2px]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'duration-200'
          )}
        />
        <DialogPrimitive.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          aria-describedby={undefined}
          className={cn(
            'fixed z-50 bg-slate-950 border-slate-800 text-slate-100 shadow-2xl shadow-black/60',
            'overflow-hidden flex flex-col p-0 outline-none',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'duration-200',
            // Mobile: bottom sheet
            'inset-x-0 bottom-0 w-full max-w-full max-h-[92vh] rounded-t-2xl border-t border-x',
            'data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
            // Desktop: centered modal
            'sm:inset-x-auto sm:bottom-auto sm:top-[50%] sm:left-[50%]',
            'sm:translate-x-[-50%] sm:translate-y-[-50%]',
            'sm:max-w-3xl sm:w-[calc(100%-2rem)] sm:max-h-[85vh] sm:rounded-xl sm:border',
            'sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=closed]:slide-out-to-bottom-0',
            'sm:data-[state=open]:fade-in-0 sm:data-[state=closed]:fade-out-0',
            'sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:zoom-out-95'
          )}
        >
          {/* Profile-style header */}
          <div className="px-6 py-5 border-b border-slate-800/80 bg-gradient-to-b from-slate-900/60 to-transparent">
            <DialogPrimitive.Title className="sr-only">Miner profile</DialogPrimitive.Title>
            <div className="flex items-center gap-3 pr-10">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-slate-950 shadow-lg"
                style={{
                  // Monochrome avatar: warm-neutral grey, no per-hotkey hue.
                  background: `linear-gradient(135deg, hsl(40, 5%, 60%), hsl(40, 5%, 42%))`,
                  boxShadow: `0 0 0 1px hsl(40, 5%, 54%, 0.35), 0 8px 24px -8px hsl(40, 5%, 34%, 0.45)`,
                }}
                aria-hidden
              >
                {swatch.initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <code className="text-sm font-mono text-slate-100 truncate" title={hotkey}>
                    {truncateHotkey(hotkey)}
                  </code>
                  <CopyButton text={hotkey} />
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {lastActive ? `Last active ${formatRelative(lastActive)}` : 'No activity'}
                </div>
              </div>
            </div>

            {/* KPI stat blocks */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 mt-4">
              <StatBlock label="Pass rate" value={`${passRate.toFixed(0)}%`} tone="gold" />
              <StatBlock label="Scored" value={list.length} tone="slate" />
              <StatBlock label="Passed" value={passed} tone="gold" muted />
              <StatBlock label="Avg score" value={avgScore.toFixed(2)} tone="slate" />
            </div>
          </div>

          {/* In-dialog request filter */}
          {!loading && list.length > 0 && (
            <div className="px-6 pt-3 pb-2 border-b border-slate-800/60">
              <div className="relative">
                <input
                  type="text"
                  value={requestFilter}
                  onChange={(e) => setRequestFilter(e.target.value)}
                  placeholder="Filter by request id, industry, or country"
                  className="w-full pl-3 pr-24 h-8 bg-slate-900/60 border border-slate-700/50 rounded-md text-[11px] font-mono text-slate-100 placeholder:text-slate-500 outline-none premium-focus transition-colors"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  {requestFilter.trim() ? (
                    <>
                      <span className="text-[10px] font-mono text-slate-500 tabular-nums">
                        {filteredList.length} of {list.length}
                      </span>
                      <button
                        onClick={() => setRequestFilter('')}
                        className="text-slate-500 hover:text-slate-200 transition-colors"
                        aria-label="Clear filter"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <span className="text-[10px] font-mono text-slate-500 tabular-nums">
                      {matchingRequestIds.size} {matchingRequestIds.size === 1 ? 'request' : 'requests'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Grouped score list */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Loading miner scores...
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                <p className="text-sm text-burgundy">Couldn&apos;t load miner detail</p>
                <p className="text-[11px] text-slate-500 font-mono max-w-md">{error}</p>
                {onRetry && (
                  <button
                    type="button"
                    onClick={onRetry}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-slate-200 bg-slate-800/60 border border-slate-700/50 hover:bg-slate-700/60 hover:border-slate-600 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--brand)]"
                  >
                    Try again
                  </button>
                )}
              </div>
            ) : list.length === 0 ? (
              <div className="text-center py-12 text-sm text-slate-500">
                No scored leads found for this miner.
              </div>
            ) : filteredList.length === 0 ? (
              <div className="text-center py-12 text-sm text-slate-500">
                No leads match{' '}
                <code className="font-mono text-slate-300 bg-slate-900/60 px-1.5 py-0.5 rounded">
                  {requestFilter}
                </code>
                . Try a shorter prefix or a different request.
              </div>
            ) : (
              <div className="space-y-4">
                {grouped.map(({ category, items }) => {
                  const collapsed = collapsedCategories.has(category)
                  const tone = CATEGORY_COLORS[category] || 'slate'
                  return (
                    <section key={category}>
                      <button
                        onClick={() => toggleCategory(category)}
                        className="w-full flex items-center gap-2 text-left hover:bg-slate-900/40 -mx-2 px-2 py-1.5 rounded-md transition-colors"
                      >
                        <ChevronRight
                          className={cn(
                            'h-3.5 w-3.5 text-slate-500 transition-transform',
                            !collapsed && 'rotate-90'
                          )}
                        />
                        <span className={cn('text-xs font-semibold', toneText(tone))}>
                          {category}
                        </span>
                        <span className="text-[11px] text-slate-500 tabular-nums">
                          {items.length}
                        </span>
                      </button>
                      {!collapsed && (
                        <div className="mt-1.5 rounded-lg border border-slate-800/70 overflow-hidden">
                          <div className="grid grid-cols-[1fr_5rem_5rem_1.5fr] gap-3 px-3 py-1.5 text-[9px] text-slate-500 font-mono uppercase tracking-[0.06em] bg-slate-900/40 border-b border-slate-800/60">
                            <span>Reason</span>
                            <span className="text-right">Score</span>
                            <span className="text-right">Rep</span>
                            <span>Context</span>
                          </div>
                          {items.map((score) => (
                            <ScoreTableRow
                              key={score.score_id}
                              score={score}
                              requestMap={requestMap}
                              expanded={expandedScoreId === score.score_id}
                              onToggle={() =>
                                score.failure_detail &&
                                setExpandedScoreId((cur) =>
                                  cur === score.score_id ? null : score.score_id
                                )
                              }
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  )
                })}
              </div>
            )}
          </div>

          <DialogPrimitive.Close
            className="absolute top-3 right-3 rounded p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 transition-colors outline-none focus-visible:ring-1 focus-visible:ring-slate-500"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function StatBlock({
  label,
  value,
  tone,
  muted,
}: {
  label: string
  value: string | number
  tone: 'slate' | 'gold' | 'amber' | 'burgundy'
  muted?: boolean
}) {
  const valueColor =
    tone === 'gold'
      ? muted
        ? 'text-gold opacity-80'
        : 'text-gold'
      : tone === 'amber'
        ? 'text-amber-warm'
        : tone === 'burgundy'
          ? 'text-burgundy'
          : 'text-slate-100'
  return (
    <div className="rounded-lg border border-slate-800/70 bg-slate-900/30 px-3 py-2">
      <div className="text-[9px] text-slate-500 uppercase tracking-[0.1em] font-medium">{label}</div>
      <div className={cn('text-lg font-semibold tabular-nums leading-tight mt-0.5', valueColor)}>
        {typeof value === 'number' ? <CountUp value={value} /> : value}
      </div>
    </div>
  )
}

function toneText(tone: string): string {
  switch (tone) {
    case 'gold':
      return 'text-gold'
    case 'amber':
      return 'text-amber-warm'
    case 'cream':
      return 'text-cream'
    case 'burgundy':
      return 'text-burgundy'
    default:
      return 'text-slate-300'
  }
}

function ScoreTableRow({
  score,
  requestMap,
  expanded,
  onToggle,
}: {
  score: MinerScore
  requestMap: Record<string, { icp_details: IcpDetails; num_leads: number; status: string }>
  expanded: boolean
  onToggle: () => void
}) {
  const req = requestMap[score.request_id]
  const icp = req?.icp_details as IcpDetails | undefined
  const canExpand = Boolean(score.failure_detail)
  const passed = !score.failure_reason
  return (
    <div
      className={cn(
        'grid grid-cols-[1fr_5rem_5rem_1.5fr] gap-3 px-3 py-2 text-[11px] border-t first:border-t-0 border-slate-800/40 transition-colors',
        passed ? 'hover-bg-warm' : 'hover:bg-slate-900/40',
        canExpand && 'cursor-pointer'
      )}
      onClick={canExpand ? onToggle : undefined}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={cn(
            'w-1 h-3 rounded-full shrink-0',
            passed ? 'dot-gold' : 'bg-[#a8746f]'
          )}
        />
        <span
          className={cn('truncate', passed ? 'text-gold' : 'text-slate-200')}
          title={score.failure_reason ? readableReason(score.failure_reason) : 'Passed all tiers'}
        >
          {score.failure_reason ? readableReason(score.failure_reason) : 'Passed all tiers'}
        </span>
        {canExpand && (
          <span className="text-[9px] text-cream shrink-0 opacity-80">details</span>
        )}
      </div>
      <span
        className={cn(
          'font-mono font-semibold text-right tabular-nums',
          score.final_score > 0 ? 'text-gold' : 'text-burgundy'
        )}
      >
        {score.final_score.toFixed(2)}
      </span>
      <span className="font-mono text-slate-400 text-right tabular-nums">
        {score.rep_score.toFixed(1)}
      </span>
      <div className="flex items-center gap-2 text-slate-500 font-mono text-[10px] min-w-0">
        <span className="truncate" title={[asText(icp?.industry), icpCompanyCountry(icp)].filter(Boolean).join(' · ')}>
          {asText(icp?.industry) || '·'}
          {icpCompanyCountry(icp) && <span className="text-slate-600"> · {icpCompanyCountry(icp)}</span>}
        </span>
        <span className="ml-auto shrink-0 text-slate-600 tabular-nums">{formatRelative(score.scored_at)}</span>
      </div>
      {expanded && score.failure_detail && (
        <div className="col-span-4 mt-2 mb-1 p-2.5 rounded-md bg-slate-900/80 border-l-2 border-burgundy-soft text-[10px] text-slate-300 leading-relaxed font-mono">
          {score.failure_detail}
        </div>
      )}
    </div>
  )
}

/* ============================================================
 * Filter button (segmented control pill)
 * ============================================================ */
function FilterButton({
  active,
  onClick,
  label,
  count,
  tone,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
  tone: 'neutral' | 'pending' | 'completed'
}) {
  const activeBg =
    tone === 'pending'
      ? 'bg-amber-warm-soft text-amber-warm border-amber-warm-soft'
      : tone === 'completed'
        ? 'bg-cream-soft text-cream border-cream-soft'
        : 'bg-slate-700/60 text-slate-100 border-slate-500/40'
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-all',
        active
          ? activeBg
          : 'bg-transparent text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/40'
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          'text-[10px] font-mono tabular-nums',
          active ? 'text-current/70' : 'text-slate-500'
        )}
      >
        {count}
      </span>
    </button>
  )
}
