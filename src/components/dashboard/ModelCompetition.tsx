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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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

// Types for model competition data
interface Champion {
  modelId: string
  minerHotkey: string
  modelName: string
  codeHash: string
  s3Path?: string | null
  score: number
  championAt: string
  evaluatedAt: string | null
}

interface LeaderboardEntry {
  modelId: string
  minerHotkey: string
  modelName: string
  score: number
  rank: number
  isChampion: boolean | null
  evaluatedAt: string | null
}

interface Submission {
  id: string
  minerHotkey: string
  modelName: string
  status: string
  score: number | null
  scoreBreakdown?: Record<string, number> | null
  codeHash: string
  s3Path?: string | null
  createdAt: string
  evaluatedAt: string | null
  isChampion: boolean | null
  paymentTao: number | null
  evaluationTime?: number | null
  evaluationCost?: number | null
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
  championScore: number
}

interface ModelCompetitionData {
  champion: Champion | null
  leaderboard: LeaderboardEntry[]
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

// Rank display component - just shows the number
function RankIcon({ rank }: { rank: number }) {
      return <span className="text-muted-foreground font-mono">#{rank}</span>
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

// Model Detail Dialog with Code Viewing
function ModelDetailDialog({
  model,
  isOpen,
  onClose
}: {
  model: Submission | null
  isOpen: boolean
  onClose: () => void
}) {
  const [codeContent, setCodeContent] = useState<Record<string, string> | null>(null)
  const [loadingCode, setLoadingCode] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [activeFile, setActiveFile] = useState<string | null>(null)

  // Fetch code when dialog opens for evaluated models
  useEffect(() => {
    if (!model || !isOpen) return

    const isEvaluated = model.status.toLowerCase() === 'evaluated'
    if (!isEvaluated) return

    setLoadingCode(true)
    setCodeError(null)

    fetch(`/api/model-code?modelId=${model.id}`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.code) {
          setCodeContent(data.code)
          // Set first file as active
          const files = Object.keys(data.code)
          if (files.length > 0) {
            setActiveFile(files[0])
          }
        } else {
          setCodeError(data.error || 'Code not available')
        }
      })
      .catch(() => {
        setCodeError('Failed to load code')
      })
      .finally(() => {
        setLoadingCode(false)
      })
  }, [model, isOpen])

  if (!model) return null

  const isEvaluated = model.status.toLowerCase() === 'evaluated'
  const canViewCode = isEvaluated

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Code className="h-5 w-5" />
            <span className="font-mono">{truncateHotkey(model.minerHotkey)}</span>
            {model.isChampion && (
              <Badge variant="outline" className="border-yellow-500/50 text-yellow-500 ml-2">
                <Crown className="h-3 w-3 mr-1" />
                Champion
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
          {/* Status & Score Row */}
          <div className="flex items-center justify-between flex-wrap gap-4">
            <StatusBadge status={model.status} />
            {model.score !== null && (
              <div className="text-right">
                <span className="text-3xl font-bold text-yellow-500">{model.score.toFixed(2)}</span>
                <span className="text-muted-foreground ml-1">/ 100</span>
              </div>
            )}
          </div>

          {/* Model Info - Stacked Layout */}
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-muted-foreground mb-1">Miner Hotkey</p>
              <div className="flex items-center gap-2 flex-wrap">
                <code className="text-xs bg-muted px-2 py-1 rounded font-mono break-all">
                  {model.minerHotkey}
                </code>
                <CopyButton text={model.minerHotkey} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-muted-foreground mb-1">Submitted</p>
                <p className="text-sm">{new Date(model.createdAt).toLocaleString()}</p>
              </div>
              {model.evaluatedAt && (
                <div>
                  <p className="text-muted-foreground mb-1">Evaluated</p>
                  <p className="text-sm">{new Date(model.evaluatedAt).toLocaleString()}</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-4">
              {model.evaluationTime && (
                <div>
                  <p className="text-muted-foreground mb-1">Eval Time</p>
                  <p className="font-mono">{Math.round(model.evaluationTime)}s</p>
                </div>
              )}
              {model.paymentTao && (
                <div>
                  <p className="text-muted-foreground mb-1">Fee</p>
                  <p className="font-mono">{model.paymentTao.toFixed(4)} TAO</p>
                </div>
              )}
            </div>
          </div>

          {/* Code Hash */}
          <div>
            <h4 className="font-medium mb-2 flex items-center gap-2 text-sm">
              <Code className="h-4 w-4" />
              Code Hash (SHA256)
            </h4>
            <div className="flex items-center gap-2">
              <code className="text-xs bg-muted px-3 py-2 rounded font-mono break-all flex-1">
                {model.codeHash}
              </code>
              <CopyButton text={model.codeHash} />
            </div>
          </div>

          {/* Code Section */}
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-muted/50 px-4 py-2 border-b flex items-center gap-2">
              {canViewCode ? (
                <>
                  <Eye className="h-4 w-4 text-green-500" />
                  <span className="font-medium text-green-500">Model Code</span>
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-muted-foreground">Code Hidden</span>
                </>
              )}
            </div>

            {canViewCode ? (
              <div>
                {loadingCode ? (
                  <div className="p-8 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Loading code...</p>
                  </div>
                ) : codeError ? (
                  <div className="p-8 text-center">
                    <XCircle className="h-6 w-6 text-red-500 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">{codeError}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      Code storage is being set up. Check back soon!
                    </p>
                  </div>
                ) : codeContent && activeFile ? (
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
                    <div className="relative">
                      <pre className="p-4 text-xs font-mono overflow-x-auto max-h-[300px] overflow-y-auto bg-[#0d1117] text-[#c9d1d9]">
                        <code>{codeContent[activeFile]}</code>
                      </pre>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute top-2 right-2 h-7 text-xs"
                        onClick={() => navigator.clipboard.writeText(codeContent[activeFile])}
                      >
                        <Copy className="h-3 w-3 mr-1" />
                        Copy
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="p-8 text-center">
                    <p className="text-sm text-muted-foreground">No code files found</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6 text-center">
                <Lock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  Code will be revealed once evaluation is complete.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  This prevents frontrunning and ensures fair competition.
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ModelCompetition() {
  const [data, setData] = useState<ModelCompetitionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<Submission | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)

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

  // Initial fetch + polling every 30 seconds
  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)
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
      {/* Stats Cards - 3 columns: Total Submissions, Evaluated, Unique Miners */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Total Submissions */}
        <Card className="bg-gradient-to-br from-cyan-500/10 to-blue-500/5 border-cyan-500/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Submissions</CardTitle>
            <Send className="h-4 w-4 text-cyan-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.stats.totalSubmissions}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {data.stats.statusCounts.evaluating} evaluating (last 24h)
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
              {data.stats.statusCounts.submitted} pending (last 24h)
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
              competing (last 24h)
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="grid gap-6 lg:grid-cols-2 items-start">
        {/* Current Champion Card */}
        {data.champion && (() => {
          // Find champion in recentSubmissions or construct a Submission object
          const championSubmission: Submission = data.recentSubmissions.find(s => s.id === data.champion!.modelId) || {
            id: data.champion.modelId,
            minerHotkey: data.champion.minerHotkey,
            modelName: data.champion.modelName,
            status: 'evaluated',
            score: data.champion.score,
            codeHash: data.champion.codeHash,
            s3Path: data.champion.s3Path,
            createdAt: data.champion.championAt,
            evaluatedAt: data.champion.evaluatedAt,
            isChampion: true,
            paymentTao: null,
          }

          return (
            <Card
              className="lg:col-span-2 bg-gradient-to-r from-yellow-500/5 via-amber-500/5 to-orange-500/5 border-yellow-500/30 cursor-pointer hover:border-yellow-500/50 transition-colors"
              onClick={() => {
                setSelectedModel(championSubmission)
                setIsDetailOpen(true)
              }}
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-yellow-500" />
                  Current Champion
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold font-mono">{truncateHotkey(data.champion.minerHotkey)}</span>
                      <Badge variant="outline" className="border-yellow-500/50 text-yellow-500">
                        Champion
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <p className="text-xs text-muted-foreground">
                        Hash: {data.champion.codeHash.slice(0, 16)}..
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0"
                        onClick={(e) => {
                          e.stopPropagation()
                          navigator.clipboard.writeText(data.champion!.codeHash)
                        }}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-4xl font-bold text-yellow-500">
                      {data.champion.score.toFixed(2)}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Champion since {getRelativeTime(data.champion.championAt)}
                    </p>
                    {data.champion.evaluatedAt && (
                      <p className="text-xs text-muted-foreground">
                        Last evaluated {getRelativeTime(data.champion.evaluatedAt)}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })()}

        {/* Leaderboard */}
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              Leaderboard
              <Badge variant="outline" className="ml-2 text-xs font-normal">
                All Time
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Rank</TableHead>
                  <TableHead>Miner</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.leaderboard.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      No models evaluated yet
                    </TableCell>
                  </TableRow>
                ) : (
                  data.leaderboard.map((entry) => {
                    // Find full submission data if available
                    const fullSubmission = data.recentSubmissions.find(s => s.id === entry.modelId)

                    return (
                      <TableRow
                        key={entry.modelId}
                        className={`${entry.isChampion ? 'bg-yellow-500/5' : ''} ${fullSubmission ? 'cursor-pointer hover:bg-muted/50' : ''} transition-colors`}
                        onClick={() => {
                          if (fullSubmission) {
                            setSelectedModel(fullSubmission)
                            setIsDetailOpen(true)
                          }
                        }}
                      >
                      <TableCell>
                        <RankIcon rank={entry.rank} />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium flex items-center gap-1.5 font-mono text-sm">
                          <span className={fullSubmission ? 'hover:text-cyan-400' : ''}>
                            {truncateHotkey(entry.minerHotkey)}
                          </span>
                          {entry.isChampion && (
                            <Crown className="h-3 w-3 text-yellow-500 flex-shrink-0" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold">
                        {entry.score.toFixed(2)}
                      </TableCell>
                    </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Recent Submissions (Last 24 Hours) */}
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Recent Submissions
              <Badge variant="outline" className="ml-2 text-xs font-normal">
                Last 24h
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {data.recentSubmissions.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  No submissions in the last 24 hours
                </p>
              ) : (
                data.recentSubmissions.map((submission) => (
                  <div
                    key={submission.id}
                    className="p-2.5 sm:p-3 rounded-lg bg-muted/30 border border-border/50 hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => {
                      setSelectedModel(submission)
                      setIsDetailOpen(true)
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium font-mono hover:text-cyan-400 transition-colors">
                          {truncateHotkey(submission.minerHotkey)}
                        </span>
                        {submission.isChampion && (
                          <Crown className="h-3 w-3 text-yellow-500 flex-shrink-0" />
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
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Model Detail Dialog */}
      <ModelDetailDialog
        model={selectedModel}
        isOpen={isDetailOpen}
        onClose={() => {
          setIsDetailOpen(false)
          setSelectedModel(null)
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
              Beat the champion score of <span className="font-bold text-yellow-500">{data.stats.championScore.toFixed(2)}</span> by the specified threshold to become the new champion!
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
