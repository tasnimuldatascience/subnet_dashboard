'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Trophy,
  Clock,
  Zap,
  Users,
  CheckCircle,
  XCircle,
  Loader2,
  Send,
  Crown,
  Code,
  Eye,
  Lock,
  ExternalLink,
  Copy,
  Check,
} from 'lucide-react'

// Types for champion history data
interface ChampionHistoryEntry {
  modelId: string
  minerHotkey: string
  modelName: string
  score: number
  championAt: string
  dethronedAt: string | null
  reignDuration: string | null
  codeContent: unknown | null
  hasCode: boolean
  canShowCode: boolean
}

// Score breakdown types
interface ScoreComponents {
  icp_fit: number
  decision_maker: number
  intent_signal_raw: number
  intent_signal_final: number
  cost_penalty: number
  time_penalty: number
  time_decay_multiplier?: number
}

interface LeadResult {
  rank: number
  final_score: number
  icp_prompt: string
  lead: {
    city?: string
    role?: string
    state?: string
    country?: string
    business?: string
    industry?: string
    sub_industry?: string
    employee_count?: string
    company_website?: string
    company_linkedin?: string
  } | null
  score_components: ScoreComponents
  failure_reason: string | null
  run_cost_usd: number
  run_time_seconds: number
  icp_industry?: string
  icp_geography?: string
  intent_signals?: Array<{
    url: string
    date: string
    source: string
    snippet: string
    description: string
  }>
}

interface EvaluationSummary {
  raw_avg_score?: number
  final_score?: number
  total_icps: number
  icps_failed?: number
  icps_no_lead?: number
  icps_scored: number
  icps_with_lead?: number
  total_cost_usd: number
  total_time_seconds: number
  stopped_early?: boolean
  stopped_reason?: string | null
  fabrication_rate?: number
  fabrication_count?: number
  integrity_multiplier?: number
}

interface ScoreBreakdown {
  status: string
  version?: number
  evaluation_summary: EvaluationSummary
  top_5_leads: LeadResult[]
  bottom_5_leads: LeadResult[]
  rejection?: string | null
  zero_score_count?: number
}

// Types for today's submissions
interface Submission {
  id: string
  minerHotkey: string
  modelName: string
  status: string
  score: number | null
  scoreBreakdown: ScoreBreakdown | null
  codeContent: unknown | null
  createdAt: string
  evaluatedAt: string | null
  isChampion: boolean | null
  canShowCode: boolean
}

interface Stats {
  totalSubmissions: number
  uniqueMiners: number
  statusCounts: {
    submitted: number
    evaluating: number
    evaluated: number
    failed: number
  }
  totalChampions: number
  uniqueChampionMiners: number
  currentChampionScore: number
}

interface ModelCompetitionData {
  championHistory: ChampionHistoryEntry[]
  recentSubmissions: Submission[]
  stats: Stats
  fetchedAt: string
}

// Helper to format relative time
function getRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// Helper to format date as readable string
function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Helper to format PostgreSQL interval to readable string
function formatDuration(interval: string | null): string {
  if (!interval) return 'Current'

  // Parse PostgreSQL interval format like "2 days 03:45:12" or "03:45:12"
  const parts = interval.match(/(?:(\d+)\s*days?)?\s*(\d{2}):(\d{2}):(\d{2})/)
  if (!parts) return interval

  const days = parseInt(parts[1] || '0')
  const hours = parseInt(parts[2] || '0')
  const minutes = parseInt(parts[3] || '0')

  if (days > 0) {
    return `${days}d ${hours}h`
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`
  } else {
    return `${minutes}m`
  }
}

// Helper to truncate hotkey
function truncateHotkey(hotkey: string): string {
  if (!hotkey || hotkey.length < 12) return hotkey
  return `${hotkey.slice(0, 6)}..${hotkey.slice(-4)}`
}

// Status badge component
function StatusBadge({ status }: { status: string }) {
  const statusLower = status.toLowerCase()

  switch (statusLower) {
    case 'submitted':
      return (
        <Badge variant="secondary" className="gap-1">
          <Send className="h-3 w-3" />
          Submitted
        </Badge>
      )
    case 'evaluating':
      return (
        <Badge variant="default" className="gap-1 bg-blue-500">
          <Loader2 className="h-3 w-3 animate-spin" />
          Evaluating
        </Badge>
      )
    case 'evaluated':
      return (
        <Badge variant="default" className="gap-1 bg-green-600">
          <CheckCircle className="h-3 w-3" />
          Evaluated
        </Badge>
      )
    case 'failed':
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          Failed
        </Badge>
      )
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

// Copy button component
function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-2 text-xs"
      onClick={handleCopy}
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 mr-1" />
          Copied
        </>
      ) : (
        <>
          <Copy className="h-3 w-3 mr-1" />
          {label || 'Copy'}
        </>
      )}
    </Button>
  )
}

// Score Breakdown Tab Component
// Treat "NA", "N/A", "n/a", empty strings, and undefined/null as missing
function clean(val: string | undefined | null): string {
  if (!val) return ''
  const trimmed = val.trim()
  if (trimmed === '' || trimmed.toLowerCase() === 'na' || trimmed.toLowerCase() === 'n/a') return ''
  return trimmed
}

function ScoreBreakdownTab({ breakdown, score }: { breakdown: ScoreBreakdown | null | undefined; score: number | null }) {
  const [copied, setCopied] = useState(false)

  const handleCopyBreakdown = async () => {
    if (!breakdown) return
    await navigator.clipboard.writeText(JSON.stringify(breakdown, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!breakdown || !breakdown.evaluation_summary) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-muted-foreground">Score breakdown not available</p>
      </div>
    )
  }

  const summary = breakdown.evaluation_summary

  return (
    <div className="space-y-4">
      {/* Copy Button */}
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={handleCopyBreakdown}
        >
          {copied ? (
            <>
              <Check className="h-4 w-4" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              Copy Full Breakdown
            </>
          )}
        </Button>
      </div>

      {/* Evaluation Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-muted/30 rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Final Score</p>
          <p className="text-xl font-bold text-yellow-500">{(score ?? 0).toFixed(2)}</p>
        </div>
        <div className="bg-muted/30 rounded-lg p-3">
          <p className="text-xs text-muted-foreground">ICPs Tested</p>
          <p className="text-xl font-bold">{summary.total_icps ?? 0}</p>
        </div>
        <div className="bg-muted/30 rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Success Rate</p>
          <p className="text-xl font-bold text-green-500">
            {summary.total_icps > 0 ? (((summary.icps_scored ?? 0) / summary.total_icps) * 100).toFixed(1) : '0.0'}%
          </p>
        </div>
        <div className="bg-muted/30 rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Total Cost</p>
          <p className="text-lg font-mono">${(summary.total_cost_usd ?? 0).toFixed(4)}</p>
        </div>
        <div className="bg-muted/30 rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Total Time</p>
          <p className="text-lg font-mono">{Math.round(summary.total_time_seconds ?? 0)}s</p>
        </div>
        <div className="bg-muted/30 rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Leads Scored 0</p>
          <p className="text-xl font-bold text-red-500">{breakdown.zero_score_count ?? 0}</p>
        </div>
      </div>

      {/* Top 5 Leads */}
      {breakdown.top_5_leads && breakdown.top_5_leads.length > 0 && (
        <div>
          <h4 className="font-medium text-sm mb-2 flex items-center gap-2 text-green-500">
            <CheckCircle className="h-4 w-4" />
            Top 5 Leads
          </h4>
          <div className="space-y-2">
            {breakdown.top_5_leads.map((lead, idx) => (
              <div key={idx} className="bg-muted/20 rounded-lg p-3 text-sm border border-green-500/20">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1">
                    <span className="text-xs text-muted-foreground">#{lead.rank}</span>
                    {lead.lead && (clean(lead.lead.role) || clean(lead.lead.business)) && (
                      <p className="font-medium">
                        {[clean(lead.lead.role), clean(lead.lead.business)].filter(Boolean).join(' at ')}
                      </p>
                    )}
                  </div>
                  <span className="text-lg font-bold text-green-500 ml-2 flex-shrink-0">{(lead.final_score ?? 0).toFixed(1)}</span>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  <span className="font-medium text-foreground">ICP:</span> {lead.icp_prompt}
                </p>
                {lead.lead && (() => {
                  const loc = [clean(lead.lead.city), clean(lead.lead.state), clean(lead.lead.country)].filter(Boolean).join(', ')
                  const ind = [clean(lead.lead.industry), clean(lead.lead.sub_industry)].filter(Boolean)
                  const indStr = ind.length > 1 ? `${ind[0]} (${ind[1]})` : ind[0] || ''
                  return (loc || indStr) ? (
                    <div className="text-xs text-muted-foreground mb-2">
                      {loc && <><span className="font-medium text-foreground">Location:</span> {loc}</>}
                      {loc && indStr && ' | '}
                      {indStr && <><span className="font-medium text-foreground ml-1">Industry:</span> {indStr}</>}
                    </div>
                  ) : null
                })()}
                {lead.score_components && (
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">
                      ICP Fit: {(lead.score_components.icp_fit ?? 0).toFixed(1)}
                    </span>
                    <span className="bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded">
                      Decision Maker: {(lead.score_components.decision_maker ?? 0).toFixed(1)}
                    </span>
                    <span className="bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded">
                      Intent: {(lead.score_components.intent_signal_final ?? 0).toFixed(1)}
                    </span>
                    <span className="bg-red-500/20 text-red-400 px-2 py-0.5 rounded">
                      Time Penalty: {(lead.score_components.time_penalty ?? 0).toFixed(1)}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom 5 Leads */}
      {breakdown.bottom_5_leads && breakdown.bottom_5_leads.length > 0 && (
        <div>
          <h4 className="font-medium text-sm mb-2 flex items-center gap-2 text-red-500">
            <XCircle className="h-4 w-4" />
            Bottom 5 Leads
          </h4>
          <div className="space-y-2">
            {breakdown.bottom_5_leads.map((lead, idx) => (
              <div key={idx} className="bg-muted/20 rounded-lg p-3 text-sm border border-red-500/20">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1">
                    <span className="text-xs text-muted-foreground">#{lead.rank}</span>
                    {lead.lead && (clean(lead.lead.role) || clean(lead.lead.business)) ? (
                      <p className="font-medium">
                        {[clean(lead.lead.role), clean(lead.lead.business)].filter(Boolean).join(' at ')}
                      </p>
                    ) : !lead.lead ? (
                      <p className="font-medium text-red-400">No lead returned</p>
                    ) : null}
                  </div>
                  <span className="text-lg font-bold text-red-500 ml-2 flex-shrink-0">{(lead.final_score ?? 0).toFixed(1)}</span>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  <span className="font-medium text-foreground">ICP:</span> {lead.icp_prompt}
                </p>
                {lead.lead && (() => {
                  const loc = [clean(lead.lead.city), clean(lead.lead.state), clean(lead.lead.country)].filter(Boolean).join(', ')
                  const ind = [clean(lead.lead.industry), clean(lead.lead.sub_industry)].filter(Boolean)
                  const indStr = ind.length > 1 ? `${ind[0]} (${ind[1]})` : ind[0] || ''
                  return (loc || indStr) ? (
                    <div className="text-xs text-muted-foreground mb-2">
                      {loc && <><span className="font-medium text-foreground">Location:</span> {loc}</>}
                      {loc && indStr && ' | '}
                      {indStr && <><span className="font-medium text-foreground ml-1">Industry:</span> {indStr}</>}
                    </div>
                  ) : null
                })()}
                {lead.failure_reason && (
                  <p className="text-xs text-red-400 mb-2">
                    <span className="font-medium">Failure Reason:</span> {lead.failure_reason}
                  </p>
                )}
                {lead.score_components && (
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">
                      ICP Fit: {(lead.score_components.icp_fit ?? 0).toFixed(1)}
                    </span>
                    <span className="bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded">
                      Decision Maker: {(lead.score_components.decision_maker ?? 0).toFixed(1)}
                    </span>
                    <span className="bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded">
                      Intent: {(lead.score_components.intent_signal_final ?? 0).toFixed(1)}
                    </span>
                    <span className="bg-red-500/20 text-red-400 px-2 py-0.5 rounded">
                      Time Penalty: {(lead.score_components.time_penalty ?? 0).toFixed(1)}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Champion Code Tab Component
function ChampionCodeTab({
  champion,
  codeContent,
  loadingCode,
  codeError,
  activeFile,
  setActiveFile
}: {
  champion: ChampionHistoryEntry
  codeContent: Record<string, string> | null
  loadingCode: boolean
  codeError: string | null
  activeFile: string | null
  setActiveFile: (file: string) => void
}) {
  if (loadingCode) {
    return (
      <div className="p-8 text-center">
        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">Loading code...</p>
      </div>
    )
  }

  if (codeError) {
    return (
      <div className="p-8 text-center">
        <Lock className="h-6 w-6 text-yellow-500 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">{codeError}</p>
      </div>
    )
  }

  if (!codeContent || !activeFile) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-muted-foreground">No code files found</p>
      </div>
    )
  }

  return (
    <div>
      {/* File tabs */}
      <div className="flex flex-wrap gap-1 p-2 bg-muted/30 border-b overflow-x-auto">
        {Object.keys(codeContent).map(filename => (
          <Button
            key={filename}
            variant={activeFile === filename ? 'default' : 'ghost'}
            size="sm"
            className="h-7 text-xs font-mono"
            onClick={() => setActiveFile(filename)}
          >
            {filename}
          </Button>
        ))}
      </div>
      {/* Code content */}
      <div>
        <div className="flex justify-end p-2 bg-[#0d1117] border-b border-gray-700">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-gray-300 hover:text-white hover:bg-gray-700"
            onClick={() => navigator.clipboard.writeText(codeContent[activeFile])}
          >
            <Copy className="h-3 w-3 mr-1" />
            Copy
          </Button>
        </div>
        <pre className="p-4 text-xs font-mono overflow-x-auto max-h-[300px] overflow-y-auto bg-[#0d1117] text-[#c9d1d9]">
          <code>{codeContent[activeFile]}</code>
        </pre>
      </div>
    </div>
  )
}

// Champion Detail Dialog
function ChampionDetailDialog({
  champion,
  isOpen,
  onClose
}: {
  champion: ChampionHistoryEntry | null
  isOpen: boolean
  onClose: () => void
}) {
  const [codeContent, setCodeContent] = useState<Record<string, string> | null>(null)
  const [loadingCode, setLoadingCode] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [activeFile, setActiveFile] = useState<string | null>(null)

  // Load code directly from champion data when dialog opens
  useEffect(() => {
    if (!champion || !isOpen) return

    // Reset state
    setCodeError(null)
    setLoadingCode(false)

    // Use code directly from champion data (already parsed in cache.ts)
    if (champion.canShowCode && champion.codeContent) {
      const code = champion.codeContent as Record<string, string>
      setCodeContent(code)
      const files = Object.keys(code)
      if (files.length > 0) {
        setActiveFile(files[0])
      }
    } else {
      setCodeContent(null)
      setActiveFile(null)
    }
  }, [champion, isOpen])

  if (!champion) return null

  const isCurrentChampion = !champion.dethronedAt

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-yellow-500" />
            <span className="font-mono">{truncateHotkey(champion.minerHotkey)}</span>
            {isCurrentChampion && (
              <Badge variant="outline" className="border-yellow-500/50 text-yellow-500 ml-2">
                <Crown className="h-3 w-3 mr-1" />
                Current Champion
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Score Row */}
        <div className="flex items-center justify-between flex-wrap gap-4 pb-2">
          <Badge variant={isCurrentChampion ? "default" : "secondary"} className={isCurrentChampion ? "bg-green-600" : ""}>
            {isCurrentChampion ? 'Active' : 'Former Champion'}
          </Badge>
          <div className="text-right">
            <span className="text-3xl font-bold text-yellow-500">{champion.score.toFixed(2)}</span>
            <span className="text-muted-foreground ml-1">/ 100</span>
          </div>
        </div>

        {/* Champion Info */}
        <div className="text-sm space-y-2 pb-3 border-b">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
              {champion.minerHotkey.slice(0, 8)}...{champion.minerHotkey.slice(-6)}
            </code>
            <CopyButton text={champion.minerHotkey} label="Copy Hotkey" />
          </div>
          <div className="flex gap-4 text-xs text-muted-foreground flex-wrap">
            <span>Champion since: {formatDate(champion.championAt)}</span>
            {champion.dethronedAt && (
              <span>Dethroned: {formatDate(champion.dethronedAt)}</span>
            )}
            {champion.reignDuration && (
              <span>Reign: {formatDuration(champion.reignDuration)}</span>
            )}
          </div>
        </div>

        {/* Model Code Section */}
        <div className="flex items-center gap-2 border-b pb-2">
          <Code className="h-4 w-4 text-cyan-500" />
          <span className="text-sm font-medium">Model Code</span>
          {!champion.canShowCode && <Lock className="h-3 w-3 text-muted-foreground" />}
        </div>

        {/* Code Content */}
        <div className="flex-1 overflow-y-auto pr-2 pt-4">
          {!champion.canShowCode ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Lock className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">Code Hidden</p>
              <p className="text-sm text-muted-foreground mt-1">
                Code is available 24 hours after becoming champion
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Available: {formatDate(new Date(new Date(champion.championAt).getTime() + 24 * 60 * 60 * 1000).toISOString())}
              </p>
            </div>
          ) : (
            <ChampionCodeTab
              champion={champion}
              codeContent={codeContent}
              loadingCode={loadingCode}
              codeError={codeError}
              activeFile={activeFile}
              setActiveFile={setActiveFile}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Submission Detail Dialog
function SubmissionDetailDialog({
  submission,
  isOpen,
  onClose
}: {
  submission: Submission | null
  isOpen: boolean
  onClose: () => void
}) {
  const [activeTab, setActiveTab] = useState<'score' | 'code'>('score')
  const [codeContent, setCodeContent] = useState<Record<string, string> | null>(null)
  const [activeFile, setActiveFile] = useState<string | null>(null)

  // Parse code content when dialog opens
  useEffect(() => {
    if (!submission || !isOpen) return

    // Reset state
    setActiveTab('score')

    // Parse code content if available
    if (submission.codeContent) {
      let parsedCode: Record<string, string> | null = null
      try {
        if (typeof submission.codeContent === 'string') {
          parsedCode = JSON.parse(submission.codeContent)
        } else {
          parsedCode = submission.codeContent as Record<string, string>
        }
      } catch {
        console.error('Failed to parse code content')
      }

      if (parsedCode && Object.keys(parsedCode).length > 0) {
        setCodeContent(parsedCode)
        setActiveFile(Object.keys(parsedCode)[0])
      } else {
        setCodeContent(null)
        setActiveFile(null)
      }
    } else {
      setCodeContent(null)
      setActiveFile(null)
    }
  }, [submission, isOpen])

  if (!submission) return null

  // Use canShowCode from backend (24-hour protection)
  const canShowCode = submission.canShowCode

  // Parse score breakdown if available
  let scoreBreakdown: ScoreBreakdown | null = null
  if (submission.scoreBreakdown) {
    if (typeof submission.scoreBreakdown === 'string') {
      try {
        scoreBreakdown = JSON.parse(submission.scoreBreakdown)
      } catch {
        scoreBreakdown = null
      }
    } else {
      scoreBreakdown = submission.scoreBreakdown
    }
  }

  const hasCode = canShowCode && codeContent && Object.keys(codeContent).length > 0

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono">{truncateHotkey(submission.minerHotkey)}</span>
            {submission.isChampion && (
              <Badge variant="outline" className="border-yellow-500/50 text-yellow-500 ml-2">
                <Crown className="h-3 w-3 mr-1" />
                Champion
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Score and Status Row */}
        <div className="flex items-center justify-between flex-wrap gap-4 pb-2">
          <StatusBadge status={submission.status} />
          <div className="text-right">
            {submission.score !== null && (
              <>
                <span className="text-3xl font-bold text-yellow-500">{submission.score.toFixed(2)}</span>
                <span className="text-muted-foreground ml-1">/ 100</span>
              </>
            )}
          </div>
        </div>

        {/* Submission Info */}
        <div className="text-sm space-y-2 pb-3 border-b">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
              {submission.minerHotkey.slice(0, 8)}...{submission.minerHotkey.slice(-6)}
            </code>
            <CopyButton text={submission.minerHotkey} label="Copy Hotkey" />
          </div>
          <div className="flex gap-4 text-xs text-muted-foreground flex-wrap">
            <span>Submitted: {formatDate(submission.createdAt)}</span>
            {submission.evaluatedAt && (
              <span>Evaluated: {formatDate(submission.evaluatedAt)}</span>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b">
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'score'
                ? 'border-yellow-500 text-yellow-500'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('score')}
          >
            <CheckCircle className="h-4 w-4 inline mr-1.5" />
            Score Breakdown
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'code'
                ? 'border-cyan-500 text-cyan-500'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('code')}
          >
            <Code className="h-4 w-4 inline mr-1.5" />
            Model Code
            {!canShowCode && <Lock className="h-3 w-3 inline ml-1.5 text-muted-foreground" />}
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto pr-2 pt-4">
          {activeTab === 'score' ? (
            <ScoreBreakdownTab breakdown={scoreBreakdown} score={submission.score} />
          ) : hasCode && codeContent && activeFile ? (
            <div>
              {/* File tabs */}
              <div className="flex flex-wrap gap-1 p-2 bg-muted/30 border-b overflow-x-auto">
                {Object.keys(codeContent).map(filename => (
                  <Button
                    key={filename}
                    variant={activeFile === filename ? 'default' : 'ghost'}
                    size="sm"
                    className="h-7 text-xs font-mono"
                    onClick={() => setActiveFile(filename)}
                  >
                    {filename}
                  </Button>
                ))}
              </div>
              {/* Code content */}
              <div>
                <div className="flex justify-end p-2 bg-[#0d1117] border-b border-gray-700">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-gray-300 hover:text-white hover:bg-gray-700"
                    onClick={() => navigator.clipboard.writeText(codeContent[activeFile])}
                  >
                    <Copy className="h-3 w-3 mr-1" />
                    Copy
                  </Button>
                </div>
                <pre className="p-4 text-xs font-mono overflow-x-auto max-h-[300px] overflow-y-auto bg-[#0d1117] text-[#c9d1d9]">
                  <code>{codeContent[activeFile]}</code>
                </pre>
              </div>
            </div>
          ) : !canShowCode ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Lock className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">Code Hidden</p>
              <p className="text-sm text-muted-foreground mt-1">
                Code is available 24 hours after submission
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Available: {formatDate(new Date(new Date(submission.createdAt).getTime() + 24 * 60 * 60 * 1000).toISOString())}
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Code className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">No Code Available</p>
              <p className="text-sm text-muted-foreground mt-1">
                Code is not available for this submission
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ModelCompetition() {
  const [data, setData] = useState<ModelCompetitionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedChampion, setSelectedChampion] = useState<ChampionHistoryEntry | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null)
  const [isSubmissionDetailOpen, setIsSubmissionDetailOpen] = useState(false)

  // Fetch data function
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/model-competition?t=${Date.now()}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const json = await res.json()
      if (json.success) {
        setData(json.data)
        setError(null)
      } else {
        setError(json.error || 'Unknown error')
      }
    } catch (err) {
      console.error('Error fetching model competition data:', err)
      setError('Failed to fetch data')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch + polling every 60 seconds
  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 60000)
    return () => clearInterval(interval)
  }, [fetchData])

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-48 w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error || !data) {
    return (
      <Card className="border-destructive">
        <CardContent className="pt-6">
          <p className="text-destructive">Error: {error || 'No data available'}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Total Submissions Today */}
        <Card className="bg-gradient-to-br from-cyan-500/10 to-blue-500/5 border-cyan-500/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Submissions</CardTitle>
            <Send className="h-4 w-4 text-cyan-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.stats.totalSubmissions}</div>
            <p className="text-xs text-muted-foreground mt-1">
              submitted today
            </p>
          </CardContent>
        </Card>

        {/* Evaluated */}
        <Card className="bg-gradient-to-br from-green-500/10 to-emerald-500/5 border-green-500/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Evaluated</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.stats.statusCounts.evaluated}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {data.stats.statusCounts.submitted} pending today
            </p>
          </CardContent>
        </Card>

        {/* Unique Miners */}
        <Card className="bg-gradient-to-br from-purple-500/10 to-violet-500/5 border-purple-500/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unique Miners</CardTitle>
            <Users className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.stats.uniqueMiners}</div>
            <p className="text-xs text-muted-foreground mt-1">
              competing today
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Current Champion */}
      {data.championHistory.filter(c => !c.dethronedAt)[0] && (() => {
        const currentChampion = data.championHistory.filter(c => !c.dethronedAt)[0]
        // Find matching submission in recentSubmissions for score breakdown
        const championSubmission = data.recentSubmissions.find(s => s.isChampion)
        return (
          <Card
            className="bg-gradient-to-br from-yellow-500/10 to-amber-500/5 border-yellow-500/30 cursor-pointer hover:bg-yellow-500/15 transition-colors"
            onClick={() => {
              if (championSubmission) {
                // Use submission dialog if we have score breakdown
                setSelectedSubmission(championSubmission)
                setIsSubmissionDetailOpen(true)
              } else {
                // Fall back to champion dialog
                setSelectedChampion(currentChampion)
                setIsDetailOpen(true)
              }
            }}
          >
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <Crown className="h-5 w-5 text-yellow-500" />
                Current Champion
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <code className="text-sm font-mono bg-muted/50 px-2 py-1 rounded">
                    {truncateHotkey(currentChampion.minerHotkey)}
                  </code>
                  <p className="text-xs text-muted-foreground mt-2">
                    Champion since {formatDate(currentChampion.championAt)}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-3xl font-bold text-yellow-500">{currentChampion.score.toFixed(2)}</span>
                  <p className="text-xs text-muted-foreground mt-1">
                    {currentChampion.canShowCode ? (
                      <span className="flex items-center gap-1 justify-end"><Eye className="h-3 w-3 text-green-500" /> Code available</span>
                    ) : (
                      <span className="flex items-center gap-1 justify-end"><Lock className="h-3 w-3" /> Code in 24h</span>
                    )}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })()}

      {/* Today's Evaluations */}
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Today&apos;s Evaluations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {data.recentSubmissions.filter(s => !s.isChampion).length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No submissions today
              </p>
            ) : (
              <>
                {data.recentSubmissions.filter(s => !s.isChampion).map((submission) => (
                  <div
                    key={submission.id}
                    className="p-2.5 sm:p-3 rounded-lg cursor-pointer transition-colors bg-muted/30 border border-border/50 hover:bg-muted/50"
                    onClick={() => {
                      setSelectedSubmission(submission)
                      setIsSubmissionDetailOpen(true)
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium font-mono">
                          {truncateHotkey(submission.minerHotkey)}
                        </span>
                        {submission.status === 'evaluated' && (
                          submission.canShowCode ? (
                            <Eye className="h-3 w-3 text-green-500 flex-shrink-0" />
                          ) : (
                            <Lock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          )
                        )}
                      </div>
                      {submission.score !== null && (
                        <span className="text-sm font-mono font-bold">
                          {submission.score.toFixed(2)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-xs text-muted-foreground">{getRelativeTime(submission.createdAt)}</span>
                      <StatusBadge status={submission.status} />
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Champion History (past champions only) */}
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5" />
            Champion History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {data.championHistory.filter(c => c.dethronedAt).length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No past champions yet
              </p>
            ) : (
              <>
                {data.championHistory.filter(c => c.dethronedAt).map((champion) => (
                    <div
                      key={champion.modelId}
                      className="p-3 rounded-lg cursor-pointer transition-colors bg-muted/30 border border-border/50 hover:bg-muted/50"
                      onClick={() => {
                        setSelectedChampion(champion)
                        setIsDetailOpen(true)
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium font-mono">
                            {truncateHotkey(champion.minerHotkey)}
                          </span>
                          {champion.canShowCode ? (
                            <Eye className="h-3 w-3 text-green-500" />
                          ) : (
                            <Lock className="h-3 w-3 text-muted-foreground" />
                          )}
                        </div>
                        <span className="text-sm font-mono font-bold">
                          {champion.score.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                        <span>{formatDate(champion.championAt)}</span>
                        <span>Reign: {formatDuration(champion.reignDuration)}</span>
                      </div>
                    </div>
                ))}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Champion Detail Dialog */}
      <ChampionDetailDialog
        champion={selectedChampion}
        isOpen={isDetailOpen}
        onClose={() => {
          setIsDetailOpen(false)
          setSelectedChampion(null)
        }}
      />

      {/* Submission Detail Dialog */}
      <SubmissionDetailDialog
        submission={selectedSubmission}
        isOpen={isSubmissionDetailOpen}
        onClose={() => {
          setIsSubmissionDetailOpen(false)
          setSelectedSubmission(null)
        }}
      />

      {/* Submission Instructions */}
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-cyan-500" />
            How to Submit
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/10 text-cyan-500 text-xs">1</span>
                Pay Submission Fee
              </div>
              <p className="text-xs text-muted-foreground pl-8">
                Send $5 worth of TAO to the Leadpoet wallet
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/10 text-cyan-500 text-xs">2</span>
                Upload Model Code
              </div>
              <p className="text-xs text-muted-foreground pl-8">
                Submit your model via the qualification API
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/10 text-cyan-500 text-xs">3</span>
                Get Evaluated
              </div>
              <p className="text-xs text-muted-foreground pl-8">
                Validators benchmark against 100 ICPs
              </p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t">
            <p className="text-xs text-muted-foreground">
              See the <a href="https://github.com/leadpoet/leadpoet" target="_blank" rel="noopener noreferrer" className="text-cyan-500 hover:underline">documentation</a> for full submission guide.
              {data.stats.currentChampionScore > 0 ? (
                <> Beat the champion score of <span className="font-bold text-yellow-500">{data.stats.currentChampionScore.toFixed(2)}</span> by the specified threshold to become the new champion!</>
              ) : (
                <> Beat the score of <span className="font-bold text-yellow-500">10.00</span> by the specified threshold to become the champion!</>
              )}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
