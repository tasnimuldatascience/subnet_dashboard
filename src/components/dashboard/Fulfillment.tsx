'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Package,
  Trophy,
  Search,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  Target,
  Copy,
  Recycle,
} from 'lucide-react'

interface IcpDetails {
  prompt?: string
  country?: string
  industry?: string
  sub_industry?: string
  target_roles?: string[]
  company_stage?: string
  employee_count?: string
  intent_signals?: string[]
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
  tier1_passed: boolean
  tier2_passed: boolean
  rep_score: number
  scored_at: string
  all_fabricated: boolean
  email_verified: boolean
  person_verified: boolean
  company_verified: boolean
}

interface FulfillmentData {
  activeRequests: ActiveRequest[]
  winners: ConsensusResult[]
  allConsensus: ConsensusResult[]
  minerScores: MinerScore[] | null
  requestMap: Record<string, { icp_details: IcpDetails; num_leads: number; status: string }>
  rejectionBreakdown: { reason: string; count: number }[]
  scoreTotals: { passed: number; failed: number }
  stats: {
    activeRequestCount: number
    totalConsensus: number
    totalWinners: number
    fulfilledCount: number
    recycledCount: number
  }
}

const REJECTION_LABELS: Record<string, string> = {
  seniority_mismatch: 'Seniority Mismatch',
  insufficient_intent: 'Insufficient Intent',
  lead_validation_stage4: 'Person Not Verified (LinkedIn)',
  truelist_inline_verification: 'Email Verification Failed',
  check_stage5_unified: 'Company Verification Failed',
  industry_mismatch: 'Industry Mismatch',
  role_mismatch: 'Role Mismatch',
  geography_mismatch: 'Geography Mismatch',
  duplicate_company: 'Duplicate Company',
  fabricated_lead: 'Fabricated Lead',
}

function readableReason(reason: string): string {
  return REJECTION_LABELS[reason] || reason.replace(/_/g, ' ')
}

function truncateHotkey(hotkey: string): string {
  if (hotkey.length <= 12) return hotkey
  return `${hotkey.slice(0, 6)}...${hotkey.slice(-4)}`
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
    >
      <Copy className="h-3 w-3" />
      {copied && <span className="text-green-500">Copied</span>}
    </button>
  )
}

function VerificationBadge({ label, passed }: { label: string; passed: boolean }) {
  return (
    <Badge variant={passed ? "outline" : "secondary"} className={`text-[10px] gap-0.5 ${passed ? 'text-green-500 border-green-500/30' : 'text-red-400 border-red-500/20'}`}>
      {passed ? <CheckCircle className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
      {label}
    </Badge>
  )
}

function RequestStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'open':
      return <Badge variant="default" className="gap-1 bg-green-600"><Clock className="h-3 w-3" />Open</Badge>
    case 'commit_closed':
      return <Badge variant="secondary" className="gap-1"><Package className="h-3 w-3" />Commits Closed</Badge>
    case 'scoring':
      return <Badge variant="default" className="gap-1 bg-blue-500"><Target className="h-3 w-3" />Scoring</Badge>
    case 'fulfilled':
      return <Badge variant="default" className="gap-1 bg-green-700"><CheckCircle className="h-3 w-3" />Fulfilled</Badge>
    case 'recycled':
      return <Badge variant="secondary" className="gap-1"><Recycle className="h-3 w-3" />Recycled</Badge>
    default:
      return <Badge variant="secondary">{status}</Badge>
  }
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

export function Fulfillment() {
  const [data, setData] = useState<FulfillmentData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [minerSearch, setMinerSearch] = useState('')
  const [searchedMiner, setSearchedMiner] = useState<string | null>(null)
  const [expandedRequest, setExpandedRequest] = useState<string | null>(null)

  const fetchData = useCallback(async (minerHotkey?: string) => {
    try {
      const url = minerHotkey
        ? `/api/fulfillment?minerHotkey=${encodeURIComponent(minerHotkey)}`
        : '/api/fulfillment'
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch')
      const json = await res.json()
      if (json.success) {
        setData(json.data)
        setError(null)
      } else {
        setError(json.error || 'Unknown error')
      }
    } catch {
      setError('Failed to fetch fulfillment data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(() => fetchData(searchedMiner || undefined), 60000)
    return () => clearInterval(interval)
  }, [fetchData, searchedMiner])

  const handleMinerSearch = () => {
    const term = minerSearch.trim()
    if (!term) return
    setSearchedMiner(term)
    setLoading(true)
    fetchData(term)
  }

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}><CardHeader className="pb-2"><Skeleton className="h-4 w-24" /></CardHeader><CardContent><Skeleton className="h-8 w-16" /></CardContent></Card>
          ))}
        </div>
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

  // Build consensus map: request_id -> all leads (sorted by score desc)
  const leadsByRequest = new Map<string, ConsensusResult[]>()
  for (const c of data.allConsensus) {
    const list = leadsByRequest.get(c.request_id) || []
    list.push(c)
    leadsByRequest.set(c.request_id, list)
  }
  for (const [, leads] of leadsByRequest) {
    leads.sort((a, b) => b.consensus_final_score - a.consensus_final_score)
  }

  // Split requests into pending and completed
  const pendingRequests = data.activeRequests.filter(r => ['open', 'commit_closed', 'scoring'].includes(r.status))
  const completedRequests = data.activeRequests.filter(r => r.status === 'fulfilled')

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid gap-4 grid-cols-3">
        <Card className="bg-gradient-to-br from-green-500/10 to-emerald-500/5 border-green-500/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open Requests</CardTitle>
            <Package className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingRequests.length}</div>
            <p className="text-xs text-muted-foreground mt-1">awaiting submissions</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-yellow-500/10 to-amber-500/5 border-yellow-500/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Winning Leads</CardTitle>
            <Trophy className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.stats.totalWinners}</div>
            <p className="text-xs text-muted-foreground mt-1">top leads selected</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500/10 to-violet-500/5 border-purple-500/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Fulfilled</CardTitle>
            <CheckCircle className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.stats.fulfilledCount}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {data.stats.recycledCount} recycled
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Rejection Breakdown */}
      {data.rejectionBreakdown.length > 0 && (() => {
        const total = data.scoreTotals.passed + data.scoreTotals.failed
        const maxCount = Math.max(...data.rejectionBreakdown.map(r => r.count))
        return (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5" />
                Rejection Reasons
              </CardTitle>
              <div className="flex gap-4 mt-2">
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
                  <span className="text-xs text-muted-foreground">{data.scoreTotals.passed} passed</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
                  <span className="text-xs text-muted-foreground">{data.scoreTotals.failed} failed</span>
                </div>
                <span className="text-xs text-muted-foreground ml-auto">{total} total scored</span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data.rejectionBreakdown.map(({ reason, count }) => {
                  const barPct = maxCount > 0 ? (count / maxCount) * 100 : 0
                  const ofTotal = total > 0 ? ((count / total) * 100).toFixed(1) : '0'
                  return (
                    <div key={reason}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">{readableReason(reason)}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{ofTotal}%</span>
                          <span className="text-xs font-mono font-semibold w-6 text-right">{count}</span>
                        </div>
                      </div>
                      <div className="bg-muted/50 rounded-full h-2.5 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-red-500 to-red-400 transition-all duration-500"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )
      })()}

      {/* Request History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Request History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {data.activeRequests.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No requests</p>
            ) : (
              data.activeRequests.map((req) => {
                const icp = req.icp_details
                const leads = leadsByRequest.get(req.request_id) || []
                const isFulfilled = req.status === 'fulfilled'
                const isExpanded = expandedRequest === req.request_id
                const winnerCount = leads.filter(l => l.is_winner).length

                return (
                  <div
                    key={req.request_id}
                    className={`p-3 rounded-lg border ${
                      isFulfilled
                        ? 'bg-green-500/5 border-green-500/20'
                        : 'bg-muted/30 border-border/50'
                    }`}
                  >
                    {/* Request header — clickable */}
                    <div
                      className="cursor-pointer"
                      onClick={() => setExpandedRequest(isExpanded ? null : req.request_id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <code className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{req.request_id.slice(0, 8)}</code>
                          <CopyButton text={req.request_id} />
                        </div>
                        <div className="flex items-center gap-2">
                          {isFulfilled && winnerCount > 0 && (
                            <span className="text-xs text-muted-foreground">{winnerCount} lead{winnerCount !== 1 ? 's' : ''} won</span>
                          )}
                          <RequestStatusBadge status={req.status} />
                        </div>
                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 mt-1.5">
                        <span className="text-sm font-medium">
                          {[
                            icp?.industry || 'Not Specified',
                            icp?.sub_industry,
                            (icp as IcpDetails & { target_role_types?: string[] })?.target_role_types?.[0],
                          ].filter(Boolean).join(' / ')}
                        </span>
                        {req.window_start && req.window_end && (
                          <span className="text-xs text-muted-foreground">
                            {formatDate(req.window_start)} - {formatDate(req.window_end)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Expanded: show all leads */}
                    {isExpanded && leads.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-border/30 space-y-1.5">
                        {leads.map((lead, idx) => (
                          <div
                            key={lead.consensus_id}
                            className={`flex items-center justify-between py-1 ${idx > 0 ? 'border-t border-border/20' : ''}`}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground w-5">#{idx + 1}</span>
                              {lead.is_winner && <Trophy className="h-3.5 w-3.5 text-yellow-500 shrink-0" />}
                              <code className="text-xs font-mono">{truncateHotkey(lead.miner_hotkey)}</code>
                              <CopyButton text={lead.miner_hotkey} />
                            </div>
                            <span className={`text-sm font-mono font-bold ${lead.is_winner ? 'text-yellow-500' : lead.consensus_final_score > 0 ? 'text-green-500' : 'text-red-400'}`}>
                              {lead.consensus_final_score.toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {isExpanded && leads.length === 0 && isFulfilled && (
                      <div className="mt-2 pt-2 border-t border-border/30">
                        <span className="text-xs text-muted-foreground">No scored leads</span>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* Miner Score Lookup */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Miner Score Lookup
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              placeholder="Enter miner hotkey to see scores and rejection reasons..."
              className="flex-1 px-3 py-2 text-sm bg-muted/50 border border-border rounded-md font-mono"
              value={minerSearch}
              onChange={(e) => setMinerSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleMinerSearch()}
            />
            <button
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
              onClick={handleMinerSearch}
              disabled={!minerSearch.trim()}
            >
              Search
            </button>
          </div>

          {searchedMiner && data.minerScores && (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {data.minerScores.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No scores found for this miner</p>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3 text-sm">
                    <span className="text-muted-foreground">
                      {data.minerScores.length} scores for <code className="font-mono">{truncateHotkey(searchedMiner)}</code>
                    </span>
                    <div className="flex gap-3 text-xs">
                      <span className="text-green-500">
                        {data.minerScores.filter(s => !s.failure_reason).length} passed
                      </span>
                      <span className="text-red-500">
                        {data.minerScores.filter(s => s.failure_reason).length} rejected
                      </span>
                    </div>
                  </div>
                  {data.minerScores.map((score) => {
                    const req = data.requestMap[score.request_id]
                    const icp = req?.icp_details as IcpDetails | undefined
                    return (
                      <div
                        key={score.score_id}
                        className={`p-3 rounded-lg border ${
                          score.failure_reason
                            ? 'bg-red-500/5 border-red-500/20'
                            : 'bg-green-500/5 border-green-500/20'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                          <div className="flex items-center gap-2">
                            {score.failure_reason ? (
                              <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                            ) : (
                              <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                            )}
                            <span className="text-sm font-medium">
                              {score.failure_reason
                                ? readableReason(score.failure_reason)
                                : 'Passed all tiers'}
                            </span>
                          </div>
                          <span className={`text-sm font-mono font-bold ${score.final_score > 0 ? 'text-green-500' : 'text-red-400'}`}>
                            {score.final_score.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-2 text-xs text-muted-foreground">
                          {icp?.industry && <span>{icp.industry}</span>}
                          {icp?.country && <span>| {icp.country}</span>}
                          <span>| Rep: {score.rep_score.toFixed(1)}</span>
                          <span>| {formatDate(score.scored_at)}</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {score.tier1_passed ? (
                            <Badge variant="outline" className="text-[10px] text-green-500 border-green-500/30">Tier 1</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] text-red-400 border-red-500/20">Tier 1 Failed</Badge>
                          )}
                          {score.tier2_passed ? (
                            <Badge variant="outline" className="text-[10px] text-green-500 border-green-500/30">Tier 2</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] text-red-400 border-red-500/20">Tier 2 Failed</Badge>
                          )}
                          <VerificationBadge label="Email" passed={score.email_verified} />
                          <VerificationBadge label="Person" passed={score.person_verified} />
                          <VerificationBadge label="Company" passed={score.company_verified} />
                          {score.all_fabricated && (
                            <Badge variant="destructive" className="text-[10px] gap-0.5">
                              <AlertCircle className="h-2.5 w-2.5" />Fabricated
                            </Badge>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
