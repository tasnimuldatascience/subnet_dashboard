'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from '@/components/ui/table'
import { MetricCard } from '@/components/shared/MetricCard'
import {
  RejectionBarChart,
  MinerIncentiveChart,
  InventoryGrowthChart,
  WeeklyLeadsChart,
} from '@/components/charts'
import {
  Users,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Copy,
  Check,
  Download,
  Database,
} from 'lucide-react'
import type {
  DashboardMetrics,
  MinerStats,
  RejectionReason,
  LeadInventoryData,
  LeadInventoryCount,
  MetagraphData,
} from '@/lib/types'
import type { WeeklyLeadInventory } from '@/lib/db-precalc'

type SortKey = 'uid' | 'minerHotkey' | 'total' | 'accepted' | 'rejected' | 'pending' | 'acceptanceRate' | 'avgRepScore' | 'last20Accepted' | 'last20Rejected' | 'currentAccepted' | 'currentRejected' | 'btIncentive'
type SortDirection = 'asc' | 'desc'

interface OverviewProps {
  metrics: DashboardMetrics
  minerStats: MinerStats[]
  rejectionReasons: RejectionReason[]
  activeMinerCount: number
  inventoryData: LeadInventoryData[]
  weeklyInventoryData: WeeklyLeadInventory[]
  leadInventoryCount?: LeadInventoryCount
  alphaPrice: number | null
  onMinerClick?: (minerHotkey: string) => void
  metagraph?: MetagraphData | null
  qualificationMinerHotkeys?: string[]
}

export function Overview({
  metrics,
  minerStats,
  rejectionReasons,
  activeMinerCount,
  inventoryData,
  weeklyInventoryData,
  leadInventoryCount,
  alphaPrice,
  onMinerClick,
  metagraph,
  qualificationMinerHotkeys = [],
}: OverviewProps) {
  const [sortKey, setSortKey] = useState<SortKey>('accepted')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [copiedHotkey, setCopiedHotkey] = useState<string | null>(null)

  // Get current lead inventory from unique lead_ids count (CONSENSUS_RESULT)
  // Use leadInventoryCount if available, otherwise fallback to latest inventoryData
  const currentLeadInventory = leadInventoryCount
    ? leadInventoryCount.accepted
    : (inventoryData.length > 0
        ? [...inventoryData].sort((a, b) =>
            new Date(b.date).getTime() - new Date(a.date).getTime()
          )[0]?.totalValidInventory ?? 0
        : 0)

  // Leaderboard data uses pre-calculated epoch stats from minerStats
  const leaderboardData = minerStats

  // Calculate totals
  const totals = useMemo(() => {
    const totalStats = leaderboardData.reduce(
      (acc, miner) => ({
        total: acc.total + miner.total,
        accepted: acc.accepted + miner.accepted,
        rejected: acc.rejected + miner.rejected,
        pending: acc.pending + miner.pending,
        last20Accepted: acc.last20Accepted + miner.last20Accepted,
        last20Rejected: acc.last20Rejected + miner.last20Rejected,
        currentAccepted: acc.currentAccepted + miner.currentAccepted,
        currentRejected: acc.currentRejected + miner.currentRejected,
        btIncentive: acc.btIncentive + miner.btIncentive,
        avgRepScoreSum: acc.avgRepScoreSum + (miner.avgRepScore * miner.total),
        totalForAvg: acc.totalForAvg + miner.total,
      }),
      { total: 0, accepted: 0, rejected: 0, pending: 0, last20Accepted: 0, last20Rejected: 0, currentAccepted: 0, currentRejected: 0, btIncentive: 0, avgRepScoreSum: 0, totalForAvg: 0 }
    )

    const decided = totalStats.accepted + totalStats.rejected
    const rate = decided > 0 ? (totalStats.accepted / decided) * 100 : 0
    const avgScore = totalStats.totalForAvg > 0 ? totalStats.avgRepScoreSum / totalStats.totalForAvg : 0

    return {
      ...totalStats,
      rate: Math.round(rate * 10) / 10,
      avgScore: Math.round(avgScore * 1000) / 1000,
    }
  }, [leaderboardData])

  const sortedLeaderboardData = useMemo(() => {
    const sorted = [...leaderboardData].sort((a, b) => {
      let aValue: number | string | null = null
      let bValue: number | string | null = null

      switch (sortKey) {
        case 'uid':
          aValue = a.uid ?? -1
          bValue = b.uid ?? -1
          break
        case 'minerHotkey':
          aValue = a.minerHotkey
          bValue = b.minerHotkey
          break
        default:
          aValue = a[sortKey as keyof MinerStats] as number
          bValue = b[sortKey as keyof MinerStats] as number
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === 'asc'
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue)
      }

      return sortDirection === 'asc'
        ? (aValue as number) - (bValue as number)
        : (bValue as number) - (aValue as number)
    })
    return sorted
  }, [leaderboardData, sortKey, sortDirection])

  // Combined miner stats for incentive chart (includes qualification miners)
  const minerStatsForIncentiveChart = useMemo(() => {
    if (!metagraph || qualificationMinerHotkeys.length === 0) {
      return minerStats
    }

    // Get existing miner hotkeys
    const existingHotkeys = new Set(minerStats.map(m => m.minerHotkey))

    // Find qualification miners not in minerStats with incentive > 0
    const additionalMiners: MinerStats[] = []
    for (const hotkey of qualificationMinerHotkeys) {
      if (!existingHotkeys.has(hotkey)) {
        const incentive = metagraph.incentives[hotkey] ?? 0
        if (incentive > 0) {
          const uid = metagraph.hotkeyToUid[hotkey] ?? null
          additionalMiners.push({
            uid,
            minerHotkey: hotkey,
            coldkey: metagraph.hotkeyToColdkey?.[hotkey] || null,
            minerShort: hotkey,
            total: 0,
            accepted: 0,
            rejected: 0,
            pending: 0,
            acceptanceRate: 0,
            avgRepScore: 0,
            btIncentive: incentive * 100,
            btEmission: metagraph.emissions[hotkey] ?? 0,
            stake: Math.round((metagraph.stakes[hotkey] ?? 0) * 100) / 100,
            last20Accepted: 0,
            last20Rejected: 0,
            currentAccepted: 0,
            currentRejected: 0,
            epochPerformance: [],
            rejectionReasons: [],
          })
        }
      }
    }

    return [...minerStats, ...additionalMiners]
  }, [minerStats, metagraph, qualificationMinerHotkeys])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDirection('desc')
    }
  }

  const SortIcon = ({ columnKey }: { columnKey: SortKey }) => {
    if (sortKey !== columnKey) {
      return <ArrowUpDown className="h-3 w-3 ml-1 opacity-50" />
    }
    return sortDirection === 'asc'
      ? <ArrowUp className="h-3 w-3 ml-1" />
      : <ArrowDown className="h-3 w-3 ml-1" />
  }

  const handleHotkeyClick = (minerHotkey: string) => {
    if (onMinerClick) {
      onMinerClick(minerHotkey)
    }
  }

  const handleCopyHotkey = async (hotkey: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(hotkey)
      } else {
        // Fallback for older browsers/non-HTTPS
        const textArea = document.createElement('textarea')
        textArea.value = hotkey
        textArea.style.position = 'fixed'
        textArea.style.opacity = '0'
        document.body.appendChild(textArea)
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
      }
      setCopiedHotkey(hotkey)
      setTimeout(() => setCopiedHotkey(null), 2000)
    } catch (err) {
      console.error('Failed to copy hotkey:', err)
    }
  }

  // Download CSV function for miner leaderboard
  const downloadMinerCSV = () => {
    const headers = ['UID', 'Hotkey', 'Total', 'Accepted', 'Rejected', 'Pending', 'Approval Rate%', 'Last 20 Epochs Acc', 'Last 20 Epochs Rej', 'Current Epoch Acc', 'Current Epoch Rej', 'Incentive%']
    const rows = sortedLeaderboardData.map(m => [
      m.uid ?? '',
      m.minerHotkey,
      m.total,
      m.accepted,
      m.rejected,
      m.pending,
      m.acceptanceRate,
      m.last20Accepted,
      m.last20Rejected,
      m.currentAccepted,
      m.currentRejected,
      m.btIncentive.toFixed(4)
    ])
    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'miner_leaderboard.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Download CSV function for lead distribution (uses precalc totals)
  const downloadLeadDistributionCSV = () => {
    const accepted = leadInventoryCount?.accepted ?? totals.accepted
    const rejected = leadInventoryCount?.rejected ?? totals.rejected
    const pending = Math.max(0, (leadInventoryCount?.pending ?? totals.pending) - 2500)
    const total = accepted + rejected + pending
    const headers = ['Status', 'Count', 'Percentage']
    const rows = [
      ['Accepted', accepted, total > 0 ? ((accepted / total) * 100).toFixed(2) + '%' : '0%'],
      ['Rejected', rejected, total > 0 ? ((rejected / total) * 100).toFixed(2) + '%' : '0%'],
      ['Pending', pending, total > 0 ? ((pending / total) * 100).toFixed(2) + '%' : '0%'],
    ]
    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'lead_distribution.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Download CSV function for rejection reasons
  const downloadRejectionReasonsCSV = () => {
    const headers = ['Reason', 'Count', 'Percentage']
    const rows = rejectionReasons.map(r => [
      `"${r.reason.replace(/"/g, '""')}"`,
      r.count,
      r.percentage.toFixed(2) + '%'
    ])
    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'rejection_reasons.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Download CSV function for inventory growth
  const downloadInventoryGrowthCSV = () => {
    const headers = ['Date', 'Total Valid Inventory']
    const rows = inventoryData.map(d => [d.date, d.totalValidInventory])
    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'inventory_growth.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Download CSV function for weekly leads
  const downloadWeeklyLeadsCSV = () => {
    const headers = ['Week Start', 'Period End', 'Is Complete', 'Leads Added']
    const rows = weeklyInventoryData.map(d => [d.week_start, d.period_end, d.is_complete, d.leads_added])
    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'weekly_lead_inventory.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Download CSV function for miner incentive distribution
  const downloadMinerIncentiveCSV = () => {
    const headers = ['Rank', 'UID', 'Hotkey', 'Incentive%']
    const sorted = [...minerStatsForIncentiveChart].sort((a, b) => b.btIncentive - a.btIncentive)
    const rows = sorted.map((m, idx) => [
      idx + 1,
      m.uid ?? '',
      m.minerHotkey,
      m.btIncentive.toFixed(4)
    ])
    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'miner_incentive_distribution.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Metrics Row */}
      <div className="grid grid-cols-2 gap-2 md:gap-6">
        <MetricCard
          title="Current Lead Inventory"
          value={currentLeadInventory.toLocaleString()}
          icon={Database}
          color="blue"
          size="large"
        />
        <MetricCard
          title="Active Miners"
          value={activeMinerCount}
          icon={Users}
          color="cyan"
          size="large"
        />
      </div>

      {/* Lead Inventory Charts */}
      {inventoryData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          <Card>
            <CardHeader className="p-4 md:p-6">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base md:text-lg">Lead Inventory</CardTitle>
                <button
                  onClick={downloadInventoryGrowthCSV}
                  className="flex items-center gap-1 px-2 py-1 md:px-3 md:py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md flex-shrink-0"
                >
                  <Download className="h-3 w-3" />
                  <span className="hidden sm:inline">CSV</span>
                </button>
              </div>
            </CardHeader>
            <CardContent className="p-4 md:p-6 pt-0 md:pt-0">
              <InventoryGrowthChart data={inventoryData} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4 md:p-6">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base md:text-lg">Weekly Lead Inventory Growth</CardTitle>
                <button
                  onClick={downloadWeeklyLeadsCSV}
                  className="flex items-center gap-1 px-2 py-1 md:px-3 md:py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md flex-shrink-0"
                >
                  <Download className="h-3 w-3" />
                  <span className="hidden sm:inline">CSV</span>
                </button>
              </div>
            </CardHeader>
            <CardContent className="p-4 md:p-6 pt-0 md:pt-0">
              <WeeklyLeadsChart data={weeklyInventoryData} />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <Card>
          <CardHeader className="p-4 md:p-6">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base md:text-lg">Lead Distribution</CardTitle>
              <button
                onClick={downloadLeadDistributionCSV}
                className="flex items-center gap-1 px-2 py-1 md:px-3 md:py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md"
              >
                <Download className="h-3 w-3" />
                <span className="hidden sm:inline">CSV</span>
              </button>
            </div>
          </CardHeader>
          <CardContent className="p-4 md:p-6 pt-0 md:pt-0">
            {(() => {
              // Use leadInventoryCount from supabase precalc totals
              const accepted = leadInventoryCount?.accepted ?? totals.accepted
              const rejected = leadInventoryCount?.rejected ?? totals.rejected
              const pending = Math.max(0, (leadInventoryCount?.pending ?? totals.pending) - 2500)
              const total = accepted + rejected + pending
              const pct = (val: number) => total > 0 ? ((val / total) * 100).toFixed(1) : '0.0'
              return (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700">
                        <th className="text-left py-3 px-4 font-semibold text-slate-300">Status</th>
                        <th className="text-right py-3 px-4 font-semibold text-slate-300">Count</th>
                        <th className="text-right py-3 px-4 font-semibold text-slate-300">Percentage</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-slate-800 hover:bg-slate-800/50">
                        <td className="py-3 px-4 text-emerald-400 font-medium">Accepted</td>
                        <td className="py-3 px-4 text-right font-mono">{accepted.toLocaleString()}</td>
                        <td className="py-3 px-4 text-right font-mono text-slate-400">{pct(accepted)}%</td>
                      </tr>
                      <tr className="border-b border-slate-800 hover:bg-slate-800/50">
                        <td className="py-3 px-4 text-red-400 font-medium">Denied</td>
                        <td className="py-3 px-4 text-right font-mono">{rejected.toLocaleString()}</td>
                        <td className="py-3 px-4 text-right font-mono text-slate-400">{pct(rejected)}%</td>
                      </tr>
                      <tr className="hover:bg-slate-800/50">
                        <td className="py-3 px-4 text-amber-400 font-medium">Pending</td>
                        <td className="py-3 px-4 text-right font-mono">{pending.toLocaleString()}</td>
                        <td className="py-3 px-4 text-right font-mono text-slate-400">{pct(pending)}%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )
            })()}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 md:p-6">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base md:text-lg">Top Rejections Over Last Week</CardTitle>
              <button
                onClick={downloadRejectionReasonsCSV}
                className="flex items-center gap-1 px-2 py-1 md:px-3 md:py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md"
              >
                <Download className="h-3 w-3" />
                <span className="hidden sm:inline">CSV</span>
              </button>
            </div>
          </CardHeader>
          <CardContent className="p-4 md:p-6 pt-0 md:pt-0 pl-0">
            <RejectionBarChart data={rejectionReasons} maxItems={10} />
          </CardContent>
        </Card>
      </div>

      {/* Incentive Distribution */}
      <Card>
        <CardHeader className="p-4 md:p-6">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base md:text-lg">Miner Incentive Distribution</CardTitle>
            <button
              onClick={downloadMinerIncentiveCSV}
              className="flex items-center gap-1 px-2 py-1 md:px-3 md:py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md flex-shrink-0"
            >
              <Download className="h-3 w-3" />
              <span className="hidden sm:inline">CSV</span>
            </button>
          </div>
        </CardHeader>
        <CardContent className="p-4 md:p-6 pt-0 md:pt-0">
          <MinerIncentiveChart minerStats={minerStatsForIncentiveChart} />
        </CardContent>
      </Card>

      {/* Miner Leaderboard */}
      <Card>
        <CardHeader className="p-4 md:p-6">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base md:text-lg">Miner Leaderboard</CardTitle>
            <button
              onClick={downloadMinerCSV}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md"
            >
              <Download className="h-3 w-3" />
              CSV
            </button>
          </div>
        </CardHeader>
        <CardContent className="p-2 md:p-6 pt-0 md:pt-0">
          <div className="rounded-md border max-h-[1000px] md:max-h-[1300px] overflow-auto relative">
            <Table className="text-xs md:text-sm">
              <TableHeader className="sticky top-0 z-20 bg-slate-900 shadow-sm">
                <TableRow>
                  <TableHead
                    className="w-12 md:w-16 cursor-pointer hover:bg-muted/50 select-none px-2 md:px-4"
                    onClick={() => handleSort('uid')}
                  >
                    <div className="flex items-center whitespace-nowrap">
                      UID
                      <SortIcon columnKey="uid" />
                    </div>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-muted/50 select-none min-w-[120px] md:min-w-[180px] px-2 md:px-4"
                    onClick={() => handleSort('minerHotkey')}
                  >
                    <div className="flex items-center whitespace-nowrap">
                      Hotkey
                      <SortIcon columnKey="minerHotkey" />
                    </div>
                  </TableHead>
                  <TableHead
                    className="text-right cursor-pointer hover:bg-muted/50 select-none px-2 md:px-4"
                    onClick={() => handleSort('total')}
                  >
                    <div className="flex items-center justify-end whitespace-nowrap">
                      Total
                      <SortIcon columnKey="total" />
                    </div>
                  </TableHead>
                  <TableHead
                    className="text-right cursor-pointer hover:bg-muted/50 select-none px-2 md:px-4"
                    onClick={() => handleSort('accepted')}
                  >
                    <div className="flex items-center justify-end whitespace-nowrap">
                      <span className="hidden sm:inline">Accepted</span>
                      <span className="sm:hidden">Acc</span>
                      <SortIcon columnKey="accepted" />
                    </div>
                  </TableHead>
                  <TableHead
                    className="text-right cursor-pointer hover:bg-muted/50 select-none px-2 md:px-4"
                    onClick={() => handleSort('rejected')}
                  >
                    <div className="flex items-center justify-end whitespace-nowrap">
                      <span className="hidden sm:inline">Rejected</span>
                      <span className="sm:hidden">Rej</span>
                      <SortIcon columnKey="rejected" />
                    </div>
                  </TableHead>
                  <TableHead
                    className="text-right cursor-pointer hover:bg-muted/50 select-none px-2 md:px-4"
                    onClick={() => handleSort('pending')}
                  >
                    <div className="flex items-center justify-end whitespace-nowrap">
                      <span className="hidden sm:inline">Pending</span>
                      <span className="sm:hidden">Pend</span>
                      <SortIcon columnKey="pending" />
                    </div>
                  </TableHead>
                  <TableHead
                    className="text-right cursor-pointer hover:bg-muted/50 select-none px-2 md:px-4"
                    onClick={() => handleSort('acceptanceRate')}
                  >
                    <div className="flex items-center justify-end whitespace-nowrap">
                      Approval Rate
                      <SortIcon columnKey="acceptanceRate" />
                    </div>
                  </TableHead>
                  <TableHead
                    className="text-center cursor-pointer hover:bg-muted/50 select-none px-2 md:px-4"
                    onClick={() => handleSort('last20Accepted')}
                  >
                    <div className="flex items-center justify-center whitespace-nowrap">
                      <span className="hidden sm:inline">Last 20 Epochs</span>
                      <span className="sm:hidden">L20</span>
                      <SortIcon columnKey="last20Accepted" />
                    </div>
                  </TableHead>
                  <TableHead
                    className="text-center cursor-pointer hover:bg-muted/50 select-none px-2 md:px-4"
                    onClick={() => handleSort('currentAccepted')}
                  >
                    <div className="flex items-center justify-center whitespace-nowrap">
                      <span className="hidden sm:inline">Current Epoch</span>
                      <span className="sm:hidden">Epoch</span>
                      <SortIcon columnKey="currentAccepted" />
                    </div>
                  </TableHead>
                  <TableHead
                    className="text-right cursor-pointer hover:bg-muted/50 select-none px-2 md:px-4"
                    onClick={() => handleSort('btIncentive')}
                  >
                    <div className="flex items-center justify-end whitespace-nowrap">
                      Incentive
                      <SortIcon columnKey="btIncentive" />
                    </div>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedLeaderboardData.map((miner) => (
                  <TableRow key={miner.minerHotkey}>
                    <TableCell className="font-mono px-2 md:px-4">
                      {miner.uid ?? 'N/A'}
                    </TableCell>
                    <TableCell className="font-mono text-xs px-2 md:px-4">
                      <div className="flex items-center gap-1 group">
                        <span
                          className="text-blue-400 hover:text-blue-300 cursor-pointer"
                          onClick={() => handleHotkeyClick(miner.minerHotkey)}
                          title={miner.minerHotkey}
                        >
                          {miner.minerHotkey.slice(0, 5)}...{miner.minerHotkey.slice(-5)}
                        </span>
                        <button
                          onClick={(e) => handleCopyHotkey(miner.minerHotkey, e)}
                          className="flex-shrink-0"
                          title="Copy hotkey"
                        >
                          {copiedHotkey === miner.minerHotkey ? (
                            <Check className="h-3 w-3 text-green-500" />
                          ) : (
                            <Copy className="h-3 w-3 opacity-0 group-hover:opacity-50" />
                          )}
                        </button>
                      </div>
                    </TableCell>
                    <TableCell className="text-right px-2 md:px-4">{miner.total}</TableCell>
                    <TableCell className="text-right text-green-500 px-2 md:px-4">
                      {miner.accepted}
                    </TableCell>
                    <TableCell className="text-right text-red-500 px-2 md:px-4">
                      {miner.rejected}
                    </TableCell>
                    <TableCell className="text-right text-amber-500 px-2 md:px-4">
                      {miner.pending}
                    </TableCell>
                    <TableCell className="text-right px-2 md:px-4">
                      {miner.acceptanceRate}%
                    </TableCell>
                    <TableCell className="text-center px-2 md:px-4 whitespace-nowrap">
                      <span className="text-green-500">{miner.last20Accepted}</span>
                      <span className="text-muted-foreground">/</span>
                      <span className="text-red-500">{miner.last20Rejected}</span>
                    </TableCell>
                    <TableCell className="text-center px-2 md:px-4 whitespace-nowrap">
                      <span className="text-green-500">{miner.currentAccepted}</span>
                      <span className="text-muted-foreground">/</span>
                      <span className="text-red-500">{miner.currentRejected}</span>
                    </TableCell>
                    <TableCell className="text-right px-2 md:px-4 whitespace-nowrap">
                      {miner.btIncentive.toFixed(4)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter className="sticky bottom-0 z-20 bg-slate-800 font-semibold shadow-[0_-2px_4px_rgba(0,0,0,0.3)]">
                <TableRow>
                  <TableCell className="font-bold px-2 md:px-4">Total</TableCell>
                  <TableCell className="text-muted-foreground px-2 md:px-4">-</TableCell>
                  <TableCell className="text-right px-2 md:px-4">{totals.total}</TableCell>
                  <TableCell className="text-right text-green-500 px-2 md:px-4">
                    {totals.accepted}
                  </TableCell>
                  <TableCell className="text-right text-red-500 px-2 md:px-4">
                    {totals.rejected}
                  </TableCell>
                  <TableCell className="text-right text-amber-500 px-2 md:px-4">
                    {totals.pending}
                  </TableCell>
                  <TableCell className="text-right px-2 md:px-4">
                    {totals.rate}%
                  </TableCell>
                  <TableCell className="text-center px-2 md:px-4 whitespace-nowrap">
                    <span className="text-green-500">{totals.last20Accepted}</span>
                    <span className="text-muted-foreground">/</span>
                    <span className="text-red-500">{totals.last20Rejected}</span>
                  </TableCell>
                  <TableCell className="text-center px-2 md:px-4 whitespace-nowrap">
                    <span className="text-green-500">{totals.currentAccepted}</span>
                    <span className="text-muted-foreground">/</span>
                    <span className="text-red-500">{totals.currentRejected}</span>
                  </TableCell>
                  <TableCell className="text-right px-2 md:px-4 whitespace-nowrap">
                    <div>{totals.btIncentive.toFixed(4)}%</div>
                    {alphaPrice && (
                      <div className="text-xs text-muted-foreground">
                        ≈ {((totals.btIncentive / 100) * 2952 * alphaPrice).toFixed(2)} T
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
