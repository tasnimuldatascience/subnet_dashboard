'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { MetricCard } from '@/components/shared/MetricCard'
import { EpochStackedChart, RejectionBarChart } from '@/components/charts'
import {
  FileText,
  CheckCircle,
  XCircle,
  Percent,
  Activity,
  Coins,
  Wallet,
  Zap,
  Download,
  ChevronsUpDown,
  Check,
  Users,
  ChevronUp,
  ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MinerStats, MetagraphData } from '@/lib/types'

interface MinerTrackerProps {
  minerStats: MinerStats[]
  activeMiners: string[]
  metagraph: MetagraphData | null
  externalSelectedMiner?: string | null
  onMinerSelected?: () => void
}

export function MinerTracker({
  minerStats,
  activeMiners,
  metagraph,
  externalSelectedMiner,
  onMinerSelected,
}: MinerTrackerProps) {
  const [selectedMiner, setSelectedMiner] = useState<string | null>(null)
  const [selectedColdkey, setSelectedColdkey] = useState<string | null>(null)

  // Custom dropdown state
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)

  // Coldkey table sorting state
  type SortColumn = 'uid' | 'total' | 'accepted' | 'rejected' | 'acceptanceRate' | 'avgRepScore' | 'btIncentive' | 'btEmission' | 'stake'
  const [sortColumn, setSortColumn] = useState<SortColumn>('accepted')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('desc')
    }
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Handle external miner selection (from clicking hotkey in Overview or EpochAnalysis)
  useEffect(() => {
    if (externalSelectedMiner) {
      setSelectedMiner(externalSelectedMiner)
      // Notify parent that we've consumed the external selection
      if (onMinerSelected) {
        onMinerSelected()
      }
      // Scroll to top of miner tracker
      setTimeout(() => {
        topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    }
  }, [externalSelectedMiner, onMinerSelected])

  // Auto-select the top miner (by accepted count) on initial load
  useEffect(() => {
    if (!selectedMiner && !externalSelectedMiner && minerStats.length > 0) {
      // Sort by accepted to find the top miner
      const topMiner = [...minerStats].sort((a, b) => b.accepted - a.accepted)[0]
      if (topMiner) {
        setSelectedMiner(topMiner.minerHotkey)
      }
    }
  }, [minerStats, selectedMiner, externalSelectedMiner])

  // All miner options with UID for display
  const allMinerOptions = useMemo(() => {
    return minerStats
      .filter(m => m.uid !== null)
      .map(m => ({
        uid: m.uid!,
        hotkey: m.minerHotkey,
      }))
      .sort((a, b) => a.uid - b.uid)
  }, [minerStats])

  // Check if search query matches a coldkey
  const matchedColdkey = useMemo(() => {
    if (!searchQuery.trim() || !metagraph?.coldkeyToHotkeys) return null
    const query = searchQuery.trim()
    // Check if it's a coldkey (exists in coldkeyToHotkeys)
    if (metagraph.coldkeyToHotkeys[query]) {
      return query
    }
    // Also check for partial match at start
    const matchingColdkey = Object.keys(metagraph.coldkeyToHotkeys).find(ck =>
      ck.toLowerCase().startsWith(query.toLowerCase())
    )
    return matchingColdkey || null
  }, [searchQuery, metagraph?.coldkeyToHotkeys])

  // Filtered miner options based on search
  const filteredMinerOptions = useMemo(() => {
    if (!searchQuery.trim()) return allMinerOptions

    const query = searchQuery.trim().toLowerCase()
    let options = allMinerOptions.filter(opt =>
      opt.uid.toString().startsWith(query) ||
      opt.hotkey.toLowerCase().startsWith(query)
    )
    // Sort: exact UID match first, then by UID
    options = options.sort((a, b) => {
      const aExact = a.uid.toString() === query
      const bExact = b.uid.toString() === query
      if (aExact && !bExact) return -1
      if (!aExact && bExact) return 1
      return a.uid - b.uid
    })
    return options
  }, [allMinerOptions, searchQuery])

  // Get selected miner's stats (includes pre-calculated epoch performance and rejection reasons)
  const selectedMinerStats = useMemo(() => {
    if (!selectedMiner) return null
    return minerStats.find((m) => m.minerHotkey === selectedMiner) || null
  }, [minerStats, selectedMiner])

  // Get combined stats for coldkey (aggregates all miners under that coldkey)
  const coldkeyStats = useMemo(() => {
    if (!selectedColdkey || !metagraph?.coldkeyToHotkeys) return null

    const hotkeysUnderColdkey = metagraph.coldkeyToHotkeys[selectedColdkey] || []
    const minersUnderColdkey = minerStats.filter(m => hotkeysUnderColdkey.includes(m.minerHotkey))

    if (minersUnderColdkey.length === 0) return null

    // Aggregate stats
    const combined = {
      coldkey: selectedColdkey,
      minerCount: minersUnderColdkey.length,
      miners: minersUnderColdkey,
      total: minersUnderColdkey.reduce((sum, m) => sum + m.total, 0),
      accepted: minersUnderColdkey.reduce((sum, m) => sum + m.accepted, 0),
      rejected: minersUnderColdkey.reduce((sum, m) => sum + m.rejected, 0),
      pending: minersUnderColdkey.reduce((sum, m) => sum + m.pending, 0),
      avgRepScore: minersUnderColdkey.length > 0
        ? minersUnderColdkey.reduce((sum, m) => sum + m.avgRepScore, 0) / minersUnderColdkey.length
        : 0,
      btIncentive: minersUnderColdkey.reduce((sum, m) => sum + m.btIncentive, 0),
      btEmission: minersUnderColdkey.reduce((sum, m) => sum + (m.btEmission || 0), 0),
      stake: minersUnderColdkey.reduce((sum, m) => sum + m.stake, 0),
      acceptanceRate: 0,
      // Combine epoch performance from all miners
      epochPerformance: [] as { epochId: number; accepted: number; rejected: number; acceptanceRate: number }[],
      // Combine rejection reasons from all miners
      rejectionReasons: [] as { reason: string; count: number; percentage: number }[],
    }

    // Calculate acceptance rate
    const decided = combined.accepted + combined.rejected
    combined.acceptanceRate = decided > 0 ? Math.round((combined.accepted / decided) * 1000) / 10 : 0

    // Aggregate epoch performance
    const epochMap = new Map<number, { accepted: number; rejected: number }>()
    for (const miner of minersUnderColdkey) {
      for (const ep of miner.epochPerformance) {
        const existing = epochMap.get(ep.epochId) || { accepted: 0, rejected: 0 }
        epochMap.set(ep.epochId, {
          accepted: existing.accepted + ep.accepted,
          rejected: existing.rejected + ep.rejected,
        })
      }
    }
    combined.epochPerformance = Array.from(epochMap.entries())
      .map(([epochId, stats]) => ({
        epochId,
        accepted: stats.accepted,
        rejected: stats.rejected,
        acceptanceRate: stats.accepted + stats.rejected > 0
          ? Math.round((stats.accepted / (stats.accepted + stats.rejected)) * 1000) / 10
          : 0,
      }))
      .sort((a, b) => b.epochId - a.epochId)

    // Aggregate rejection reasons
    const reasonMap = new Map<string, number>()
    for (const miner of minersUnderColdkey) {
      for (const r of miner.rejectionReasons) {
        reasonMap.set(r.reason, (reasonMap.get(r.reason) || 0) + r.count)
      }
    }
    const totalRejections = Array.from(reasonMap.values()).reduce((sum, c) => sum + c, 0)
    combined.rejectionReasons = Array.from(reasonMap.entries())
      .map(([reason, count]) => ({
        reason,
        count,
        percentage: totalRejections > 0 ? Math.round((count / totalRejections) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count)

    return combined
  }, [selectedColdkey, metagraph?.coldkeyToHotkeys, minerStats])

  // Get epoch stats for chart (transform to format expected by EpochStackedChart)
  const minerEpochStats = useMemo(() => {
    if (selectedColdkey && coldkeyStats) {
      return coldkeyStats.epochPerformance.map(ep => ({
        epochId: ep.epochId,
        total: ep.accepted + ep.rejected,
        accepted: ep.accepted,
        rejected: ep.rejected,
        acceptanceRate: ep.acceptanceRate,
        avgRepScore: 0,
      }))
    }
    if (!selectedMinerStats) return []
    return selectedMinerStats.epochPerformance.map(ep => ({
      epochId: ep.epochId,
      total: ep.accepted + ep.rejected,
      accepted: ep.accepted,
      rejected: ep.rejected,
      acceptanceRate: ep.acceptanceRate,
      avgRepScore: 0, // Not tracked per-epoch per-miner
    }))
  }, [selectedMinerStats, selectedColdkey, coldkeyStats])

  // Get rejection reasons for chart
  const minerRejectionReasons = useMemo(() => {
    if (selectedColdkey && coldkeyStats) {
      return coldkeyStats.rejectionReasons
    }
    if (!selectedMinerStats) return []
    return selectedMinerStats.rejectionReasons
  }, [selectedMinerStats, selectedColdkey, coldkeyStats])

  // Download CSV function for epoch performance
  const downloadEpochPerformanceCSV = () => {
    if (minerEpochStats.length === 0) return
    const headers = ['Epoch ID', 'Total', 'Accepted', 'Rejected', 'Acceptance Rate%']
    const rows = minerEpochStats.map(ep => [
      ep.epochId,
      ep.total,
      ep.accepted,
      ep.rejected,
      ep.acceptanceRate
    ])
    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const filename = selectedColdkey
      ? `coldkey_${selectedColdkey.slice(0, 8)}_epoch_performance.csv`
      : `miner_${selectedMinerStats?.uid ?? 'unknown'}_epoch_performance.csv`
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  // Download CSV function for miner rejection reasons
  const downloadMinerRejectionReasonsCSV = () => {
    if (minerRejectionReasons.length === 0) return
    const headers = ['Reason', 'Count', 'Percentage']
    const rows = minerRejectionReasons.map(r => [
      `"${r.reason.replace(/"/g, '""')}"`,
      r.count,
      r.percentage.toFixed(2) + '%'
    ])
    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const filename = selectedColdkey
      ? `coldkey_${selectedColdkey.slice(0, 8)}_rejection_reasons.csv`
      : `miner_${selectedMinerStats?.uid ?? 'unknown'}_rejection_reasons.csv`
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div ref={topRef} className="space-y-6">
      {/* Miner Selection - Custom Dropdown with Search */}
      <div ref={dropdownRef} className="relative max-w-2xl">
        <label className="text-sm text-muted-foreground mb-2 block">
          Miner
        </label>
        <Button
          variant="outline"
          type="button"
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="w-full justify-between font-normal overflow-hidden"
        >
          <span className="truncate font-mono text-xs">
            {selectedColdkey ? (
              <span className="flex items-center gap-1">
                <Wallet className="h-3 w-3 inline" />
                [Coldkey] {selectedColdkey.slice(0, 8)}...{selectedColdkey.slice(-8)}
              </span>
            ) : selectedMiner ? (() => {
              const miner = allMinerOptions.find(m => m.hotkey === selectedMiner)
              return miner ? `[${miner.uid}] ${miner.hotkey}` : selectedMiner
            })() : 'Select a miner...'}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
        {dropdownOpen && (
          <div className="absolute z-50 mt-1 w-full bg-popover border rounded-md shadow-md">
            <div className="p-2 border-b">
              <Input
                placeholder="Search by UID, Hotkey, or Coldkey..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (matchedColdkey) {
                      // If coldkey matched, select coldkey view
                      setSelectedColdkey(matchedColdkey)
                      setSelectedMiner(null)
                    } else if (searchQuery.trim() && filteredMinerOptions.length > 0) {
                      setSelectedMiner(filteredMinerOptions[0].hotkey)
                      setSelectedColdkey(null)
                    }
                    setDropdownOpen(false)
                    setSearchQuery('')
                  }
                }}
                className="h-9"
                autoFocus
              />
            </div>
            <div className="max-h-[300px] overflow-y-auto p-1">
              {/* Coldkey option if matched */}
              {matchedColdkey && (
                <div
                  className={cn(
                    "relative flex cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                    selectedColdkey === matchedColdkey ? "bg-accent text-accent-foreground" : ""
                  )}
                  onClick={() => {
                    setSelectedColdkey(matchedColdkey)
                    setSelectedMiner(null)
                    setDropdownOpen(false)
                    setSearchQuery('')
                  }}
                >
                  <Wallet className="mr-2 h-4 w-4 flex-shrink-0" />
                  <span className="font-mono text-xs break-all">
                    [Coldkey] {matchedColdkey.slice(0, 8)}...{matchedColdkey.slice(-8)} ({metagraph?.coldkeyToHotkeys[matchedColdkey]?.length || 0} miners)
                  </span>
                </div>
              )}
              {/* Individual miner options */}
              {filteredMinerOptions.map((opt, idx) => (
                <div
                  key={opt.hotkey}
                  className={cn(
                    "relative flex cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                    selectedMiner === opt.hotkey && !selectedColdkey && "bg-accent text-accent-foreground",
                    searchQuery.trim() && idx === 0 && !matchedColdkey && "bg-accent/50"
                  )}
                  onClick={() => {
                    setSelectedMiner(opt.hotkey)
                    setSelectedColdkey(null)
                    setDropdownOpen(false)
                    setSearchQuery('')
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4 flex-shrink-0", selectedMiner === opt.hotkey && !selectedColdkey ? "opacity-100" : "opacity-0")} />
                  <span className="font-mono text-xs break-all">[{opt.uid}] {opt.hotkey}</span>
                </div>
              ))}
              {filteredMinerOptions.length === 0 && !matchedColdkey && (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No miner found.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Individual Miner Stats View */}
      {selectedMiner && selectedMinerStats && !selectedColdkey && (
        <>
          {/* Performance Metrics */}
          <div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard
                title="Total Submissions"
                value={selectedMinerStats.total}
                icon={FileText}
                color="blue"
              />
              <MetricCard
                title="Accepted"
                value={selectedMinerStats.accepted}
                icon={CheckCircle}
                color="green"
              />
              <MetricCard
                title="Rejected"
                value={selectedMinerStats.rejected}
                icon={XCircle}
                color="red"
              />
              <MetricCard
                title="Approval Rate"
                value={`${selectedMinerStats.acceptanceRate}%`}
                icon={Percent}
                color="purple"
              />
            </div>
          </div>

          {/* Incentive Metrics */}
          <div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard
                title="Average Score"
                value={selectedMinerStats.avgRepScore.toFixed(3)}
                icon={Activity}
                color="cyan"
              />
              <MetricCard
                title="Incentive"
                value={`${selectedMinerStats.btIncentive.toFixed(4)}%`}
                icon={Coins}
                color="amber"
              />
              <MetricCard
                title="Emission per Epoch"
                value={`${(selectedMinerStats.btEmission || 0).toFixed(4)} ㄴ`}
                icon={Zap}
                color="teal"
              />
              <MetricCard
                title="Alpha Stake"
                value={`${selectedMinerStats.stake.toFixed(2)} ㄴ`}
                icon={Wallet}
                color="indigo"
              />
            </div>
          </div>

          {/* Epoch Performance Chart */}
          <Card>
            <CardHeader className="p-4 md:p-6">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base md:text-lg">Epoch Performance</CardTitle>
                <button
                  onClick={downloadEpochPerformanceCSV}
                  className="flex items-center gap-1 px-2 py-1 md:px-3 md:py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md"
                >
                  <Download className="h-3 w-3" />
                  <span className="hidden sm:inline">CSV</span>
                </button>
              </div>
            </CardHeader>
            <CardContent className="p-4 md:p-6 pt-0 md:pt-0">
              <EpochStackedChart data={minerEpochStats} maxEpochs={20} />
            </CardContent>
          </Card>

          {/* Rejection Reasons */}
          <Card>
            <CardHeader className="p-4 md:p-6">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base md:text-lg">Rejection Reasons</CardTitle>
                <button
                  onClick={downloadMinerRejectionReasonsCSV}
                  className="flex items-center gap-1 px-2 py-1 md:px-3 md:py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md"
                >
                  <Download className="h-3 w-3" />
                  <span className="hidden sm:inline">CSV</span>
                </button>
              </div>
            </CardHeader>
            <CardContent className="p-4 md:p-6 pt-0 md:pt-0 pl-0">
              <RejectionBarChart data={minerRejectionReasons} maxItems={10} combineErrorsAsUnknown />
            </CardContent>
          </Card>
        </>
      )}

      {/* Coldkey Combined Stats View */}
      {selectedColdkey && coldkeyStats && (
        <>
          {/* Coldkey Header */}
          <Card className="bg-blue-500/10 border-blue-500/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Wallet className="h-5 w-5 text-blue-400" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-blue-300">Coldkey</div>
                  <div className="font-mono text-xs break-all">{selectedColdkey}</div>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="h-4 w-4" />
                  <span>{coldkeyStats.minerCount} miner{coldkeyStats.minerCount === 1 ? '' : 's'}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Combined Performance Metrics */}
          <div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard
                title="Total Submissions"
                value={coldkeyStats.total}
                icon={FileText}
                color="blue"
              />
              <MetricCard
                title="Accepted"
                value={coldkeyStats.accepted}
                icon={CheckCircle}
                color="green"
              />
              <MetricCard
                title="Rejected"
                value={coldkeyStats.rejected}
                icon={XCircle}
                color="red"
              />
              <MetricCard
                title="Approval Rate"
                value={`${coldkeyStats.acceptanceRate}%`}
                icon={Percent}
                color="purple"
              />
            </div>
          </div>

          {/* Combined Incentive Metrics */}
          <div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard
                title="Average Score"
                value={coldkeyStats.avgRepScore.toFixed(3)}
                icon={Activity}
                color="cyan"
              />
              <MetricCard
                title="Total Incentive"
                value={`${coldkeyStats.btIncentive.toFixed(4)}%`}
                icon={Coins}
                color="amber"
              />
              <MetricCard
                title="Total Emission"
                value={`${coldkeyStats.btEmission.toFixed(4)} ㄴ`}
                icon={Zap}
                color="teal"
              />
              <MetricCard
                title="Total Alpha Stake"
                value={`${coldkeyStats.stake.toFixed(2)} ㄴ`}
                icon={Wallet}
                color="indigo"
              />
            </div>
          </div>

          {/* Combined Epoch Performance Chart */}
          <Card>
            <CardHeader className="p-4 md:p-6">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base md:text-lg">Combined Epoch Performance</CardTitle>
                <button
                  onClick={downloadEpochPerformanceCSV}
                  className="flex items-center gap-1 px-2 py-1 md:px-3 md:py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md"
                >
                  <Download className="h-3 w-3" />
                  <span className="hidden sm:inline">CSV</span>
                </button>
              </div>
            </CardHeader>
            <CardContent className="p-4 md:p-6 pt-0 md:pt-0">
              <EpochStackedChart data={minerEpochStats} maxEpochs={20} />
            </CardContent>
          </Card>

          {/* Combined Rejection Reasons */}
          <Card>
            <CardHeader className="p-4 md:p-6">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base md:text-lg">Combined Rejection Reasons</CardTitle>
                <button
                  onClick={downloadMinerRejectionReasonsCSV}
                  className="flex items-center gap-1 px-2 py-1 md:px-3 md:py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md"
                >
                  <Download className="h-3 w-3" />
                  <span className="hidden sm:inline">CSV</span>
                </button>
              </div>
            </CardHeader>
            <CardContent className="p-4 md:p-6 pt-0 md:pt-0 pl-0">
              <RejectionBarChart data={minerRejectionReasons} maxItems={10} combineErrorsAsUnknown />
            </CardContent>
          </Card>

          {/* Individual Miner Breakdown Table */}
          <Card>
            <CardHeader className="p-4 md:p-6">
              <CardTitle className="text-base md:text-lg">Miner Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="p-0 md:p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 bg-slate-800/50">
                      <th
                        className="text-left p-3 font-medium text-slate-400 cursor-pointer hover:text-slate-200 transition-colors select-none"
                        onClick={() => handleSort('uid')}
                      >
                        <div className="flex items-center gap-1">
                          UID
                          <div className="flex flex-col -space-y-1">
                            <ChevronUp className={cn("h-3 w-3", sortColumn === 'uid' && sortDirection === 'asc' ? "text-white" : "text-slate-600")} />
                            <ChevronDown className={cn("h-3 w-3", sortColumn === 'uid' && sortDirection === 'desc' ? "text-white" : "text-slate-600")} />
                          </div>
                        </div>
                      </th>
                      <th className="text-left p-3 font-medium text-slate-400">Hotkey</th>
                      <th
                        className="text-right p-3 font-medium text-blue-400 cursor-pointer hover:text-blue-300 transition-colors select-none"
                        onClick={() => handleSort('total')}
                      >
                        <div className="flex items-center justify-end gap-1">
                          Total
                          <div className="flex flex-col -space-y-1">
                            <ChevronUp className={cn("h-3 w-3", sortColumn === 'total' && sortDirection === 'asc' ? "text-blue-300" : "text-slate-600")} />
                            <ChevronDown className={cn("h-3 w-3", sortColumn === 'total' && sortDirection === 'desc' ? "text-blue-300" : "text-slate-600")} />
                          </div>
                        </div>
                      </th>
                      <th
                        className="text-right p-3 font-medium text-green-400 cursor-pointer hover:text-green-300 transition-colors select-none"
                        onClick={() => handleSort('accepted')}
                      >
                        <div className="flex items-center justify-end gap-1">
                          Accepted
                          <div className="flex flex-col -space-y-1">
                            <ChevronUp className={cn("h-3 w-3", sortColumn === 'accepted' && sortDirection === 'asc' ? "text-green-300" : "text-slate-600")} />
                            <ChevronDown className={cn("h-3 w-3", sortColumn === 'accepted' && sortDirection === 'desc' ? "text-green-300" : "text-slate-600")} />
                          </div>
                        </div>
                      </th>
                      <th
                        className="text-right p-3 font-medium text-red-400 cursor-pointer hover:text-red-300 transition-colors select-none"
                        onClick={() => handleSort('rejected')}
                      >
                        <div className="flex items-center justify-end gap-1">
                          Rejected
                          <div className="flex flex-col -space-y-1">
                            <ChevronUp className={cn("h-3 w-3", sortColumn === 'rejected' && sortDirection === 'asc' ? "text-red-300" : "text-slate-600")} />
                            <ChevronDown className={cn("h-3 w-3", sortColumn === 'rejected' && sortDirection === 'desc' ? "text-red-300" : "text-slate-600")} />
                          </div>
                        </div>
                      </th>
                      <th
                        className="text-right p-3 font-medium text-purple-400 cursor-pointer hover:text-purple-300 transition-colors select-none"
                        onClick={() => handleSort('acceptanceRate')}
                      >
                        <div className="flex items-center justify-end gap-1">
                          Approval Rate
                          <div className="flex flex-col -space-y-1">
                            <ChevronUp className={cn("h-3 w-3", sortColumn === 'acceptanceRate' && sortDirection === 'asc' ? "text-purple-300" : "text-slate-600")} />
                            <ChevronDown className={cn("h-3 w-3", sortColumn === 'acceptanceRate' && sortDirection === 'desc' ? "text-purple-300" : "text-slate-600")} />
                          </div>
                        </div>
                      </th>
                      <th
                        className="text-right p-3 font-medium text-cyan-400 cursor-pointer hover:text-cyan-300 transition-colors select-none"
                        onClick={() => handleSort('avgRepScore')}
                      >
                        <div className="flex items-center justify-end gap-1">
                          Avg Score
                          <div className="flex flex-col -space-y-1">
                            <ChevronUp className={cn("h-3 w-3", sortColumn === 'avgRepScore' && sortDirection === 'asc' ? "text-cyan-300" : "text-slate-600")} />
                            <ChevronDown className={cn("h-3 w-3", sortColumn === 'avgRepScore' && sortDirection === 'desc' ? "text-cyan-300" : "text-slate-600")} />
                          </div>
                        </div>
                      </th>
                      <th
                        className="text-right p-3 font-medium text-amber-400 cursor-pointer hover:text-amber-300 transition-colors select-none"
                        onClick={() => handleSort('btIncentive')}
                      >
                        <div className="flex items-center justify-end gap-1">
                          Incentive
                          <div className="flex flex-col -space-y-1">
                            <ChevronUp className={cn("h-3 w-3", sortColumn === 'btIncentive' && sortDirection === 'asc' ? "text-amber-300" : "text-slate-600")} />
                            <ChevronDown className={cn("h-3 w-3", sortColumn === 'btIncentive' && sortDirection === 'desc' ? "text-amber-300" : "text-slate-600")} />
                          </div>
                        </div>
                      </th>
                      <th
                        className="text-right p-3 font-medium text-teal-400 cursor-pointer hover:text-teal-300 transition-colors select-none"
                        onClick={() => handleSort('btEmission')}
                      >
                        <div className="flex items-center justify-end gap-1">
                          Emission/Epoch
                          <div className="flex flex-col -space-y-1">
                            <ChevronUp className={cn("h-3 w-3", sortColumn === 'btEmission' && sortDirection === 'asc' ? "text-teal-300" : "text-slate-600")} />
                            <ChevronDown className={cn("h-3 w-3", sortColumn === 'btEmission' && sortDirection === 'desc' ? "text-teal-300" : "text-slate-600")} />
                          </div>
                        </div>
                      </th>
                      <th
                        className="text-right p-3 font-medium text-indigo-400 cursor-pointer hover:text-indigo-300 transition-colors select-none"
                        onClick={() => handleSort('stake')}
                      >
                        <div className="flex items-center justify-end gap-1">
                          Alpha Stake
                          <div className="flex flex-col -space-y-1">
                            <ChevronUp className={cn("h-3 w-3", sortColumn === 'stake' && sortDirection === 'asc' ? "text-indigo-300" : "text-slate-600")} />
                            <ChevronDown className={cn("h-3 w-3", sortColumn === 'stake' && sortDirection === 'desc' ? "text-indigo-300" : "text-slate-600")} />
                          </div>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...coldkeyStats.miners]
                      .sort((a, b) => {
                        const aVal = a[sortColumn] ?? 0
                        const bVal = b[sortColumn] ?? 0
                        return sortDirection === 'desc' ? (bVal as number) - (aVal as number) : (aVal as number) - (bVal as number)
                      })
                      .map((m, idx) => (
                        <tr
                          key={m.minerHotkey}
                          className={cn(
                            "border-b border-slate-700/50 transition-colors",
                            idx % 2 === 0 ? "bg-slate-900/30" : "bg-slate-800/20",
                            "hover:bg-blue-500/10"
                          )}
                        >
                          <td className="p-3 font-mono font-semibold text-slate-200">{m.uid}</td>
                          <td className="p-3">
                            <code
                              className="font-mono text-xs bg-slate-800 px-2 py-1 rounded cursor-pointer hover:bg-slate-700 transition-colors select-all"
                              onClick={() => navigator.clipboard.writeText(m.minerHotkey)}
                              title="Click to copy"
                            >
                              {m.minerHotkey}
                            </code>
                          </td>
                          <td className="p-3 text-right font-medium text-blue-300">{m.total.toLocaleString()}</td>
                          <td className="p-3 text-right font-medium text-green-400">{m.accepted.toLocaleString()}</td>
                          <td className="p-3 text-right font-medium text-red-400">{m.rejected.toLocaleString()}</td>
                          <td className="p-3 text-right font-medium text-purple-300">{m.acceptanceRate}%</td>
                          <td className="p-3 text-right font-medium text-cyan-300">{m.avgRepScore.toFixed(3)}</td>
                          <td className="p-3 text-right font-medium text-amber-300">{m.btIncentive.toFixed(3)}%</td>
                          <td className="p-3 text-right font-medium text-teal-300">{(m.btEmission || 0).toFixed(4)}</td>
                          <td className="p-3 text-right font-medium text-indigo-300">{m.stake.toFixed(2)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!selectedMiner && !selectedColdkey && (
        <Card className="py-12">
          <CardContent className="text-center text-muted-foreground">
            Select a miner or coldkey to view performance details
          </CardContent>
        </Card>
      )}
    </div>
  )
}
