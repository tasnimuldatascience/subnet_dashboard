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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MinerStats } from '@/lib/types'

interface MinerTrackerProps {
  minerStats: MinerStats[]
  activeMiners: string[]
  externalSelectedMiner?: string | null
  onMinerSelected?: () => void
}

export function MinerTracker({
  minerStats,
  activeMiners,
  externalSelectedMiner,
  onMinerSelected,
}: MinerTrackerProps) {
  const [selectedMiner, setSelectedMiner] = useState<string | null>(null)

  // Custom dropdown state
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)

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

  // Get epoch stats for chart (transform to format expected by EpochStackedChart)
  const minerEpochStats = useMemo(() => {
    if (!selectedMinerStats) return []
    return selectedMinerStats.epochPerformance.map(ep => ({
      epochId: ep.epochId,
      total: ep.accepted + ep.rejected,
      accepted: ep.accepted,
      rejected: ep.rejected,
      acceptanceRate: ep.acceptanceRate,
      avgRepScore: 0, // Not tracked per-epoch per-miner
    }))
  }, [selectedMinerStats])

  // Get rejection reasons for chart
  const minerRejectionReasons = useMemo(() => {
    if (!selectedMinerStats) return []
    return selectedMinerStats.rejectionReasons
  }, [selectedMinerStats])

  // Download CSV function for epoch performance
  const downloadEpochPerformanceCSV = () => {
    if (!selectedMinerStats || minerEpochStats.length === 0) return
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
    a.download = `miner_${selectedMinerStats.uid ?? 'unknown'}_epoch_performance.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Download CSV function for miner rejection reasons
  const downloadMinerRejectionReasonsCSV = () => {
    if (!selectedMinerStats || minerRejectionReasons.length === 0) return
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
    a.download = `miner_${selectedMinerStats.uid ?? 'unknown'}_rejection_reasons.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div ref={topRef} className="space-y-6">
      {/* Miner Selection - Custom Dropdown with Search */}
      <div ref={dropdownRef} className="relative max-w-2xl">
        <label className="text-sm text-muted-foreground mb-2 block">
          Miner (UID or Hotkey)
        </label>
        <Button
          variant="outline"
          type="button"
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="w-full justify-between font-normal overflow-hidden"
        >
          <span className="truncate font-mono text-xs">
            {selectedMiner ? (() => {
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
                placeholder="Search by UID or Hotkey..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (searchQuery.trim() && filteredMinerOptions.length > 0) {
                      setSelectedMiner(filteredMinerOptions[0].hotkey)
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
              {filteredMinerOptions.map((opt, idx) => (
                <div
                  key={opt.hotkey}
                  className={cn(
                    "relative flex cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                    selectedMiner === opt.hotkey && "bg-accent text-accent-foreground",
                    searchQuery.trim() && idx === 0 && "bg-accent/50"
                  )}
                  onClick={() => {
                    setSelectedMiner(opt.hotkey)
                    setDropdownOpen(false)
                    setSearchQuery('')
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4 flex-shrink-0", selectedMiner === opt.hotkey ? "opacity-100" : "opacity-0")} />
                  <span className="font-mono text-xs break-all">[{opt.uid}] {opt.hotkey}</span>
                </div>
              ))}
              {filteredMinerOptions.length === 0 && (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No miner found.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {selectedMiner && selectedMinerStats && (
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
                color="green"
              />
              <MetricCard
                title="Emission per Epoch"
                value={`${(selectedMinerStats.btEmission || 0).toFixed(4)} ㄴ`}
                icon={Zap}
                color="purple"
              />
              <MetricCard
                title="Alpha Stake"
                value={`${selectedMinerStats.stake.toFixed(2)} ㄴ`}
                icon={Wallet}
                color="amber"
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
            <CardContent className="p-4 md:p-6 pt-0 md:pt-0">
              <RejectionBarChart data={minerRejectionReasons} maxItems={10} combineErrorsAsUnknown />
            </CardContent>
          </Card>
        </>
      )}

      {!selectedMiner && (
        <Card className="py-12">
          <CardContent className="text-center text-muted-foreground">
            Select a miner to view their performance details
          </CardContent>
        </Card>
      )}
    </div>
  )
}
