'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { MetricCard } from '@/components/shared/MetricCard'
import { EpochStackedChart } from '@/components/charts'
import {
  FileText,
  CheckCircle,
  XCircle,
  Percent,
  Users,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Copy,
  Check,
  Download,
  Search,
} from 'lucide-react'
import type { EpochStats, MetagraphData } from '@/lib/types'

type SortField = 'uid' | 'total' | 'accepted' | 'rejected' | 'acceptanceRate' | 'btIncentive'
type EpochSortField = 'epochId' | 'total' | 'accepted' | 'rejected' | 'avgRepScore' | 'acceptanceRate'
type SortOrder = 'asc' | 'desc' | null

interface EpochAnalysisProps {
  epochStats: EpochStats[]
  metagraph: MetagraphData | null
  onMinerClick?: (minerHotkey: string) => void
  externalSelectedEpoch?: number | null
  onEpochSelected?: () => void
}

export function EpochAnalysis({ epochStats, metagraph, onMinerClick, externalSelectedEpoch, onEpochSelected }: EpochAnalysisProps) {
  const [selectedEpoch, setSelectedEpoch] = useState<number | null>(
    epochStats.length > 0 ? epochStats[0].epochId : null
  )
  const epochDataRef = useRef<HTMLDivElement>(null)

  // Handle external epoch selection
  useEffect(() => {
    if (externalSelectedEpoch !== undefined && externalSelectedEpoch !== null) {
      setSelectedEpoch(externalSelectedEpoch)
      onEpochSelected?.()
      // Scroll to epoch data section after a brief delay for render
      setTimeout(() => {
        epochDataRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    }
  }, [externalSelectedEpoch, onEpochSelected])
  const [epochSearch, setEpochSearch] = useState('')
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortOrder, setSortOrder] = useState<SortOrder>(null)
  const [epochSortField, setEpochSortField] = useState<EpochSortField>('epochId')
  const [epochSortOrder, setEpochSortOrder] = useState<SortOrder>('desc')
  const [copiedMiner, setCopiedMiner] = useState<string | null>(null)

  // Get selected epoch stats (pre-calculated, no raw data needed)
  const selectedEpochStats = useMemo(() => {
    if (selectedEpoch === null) return null
    return epochStats.find(e => e.epochId === selectedEpoch) || null
  }, [epochStats, selectedEpoch])

  // Get miner stats for selected epoch (pre-calculated, with metagraph enrichment)
  const epochMinerStats = useMemo(() => {
    if (!selectedEpochStats || !selectedEpochStats.miners) return []

    // Enrich with metagraph data
    const stats = selectedEpochStats.miners.map(m => {
      const uid = metagraph?.hotkeyToUid[m.miner_hotkey] ?? null
      const btIncentive = metagraph?.incentives[m.miner_hotkey] ?? 0

      return {
        uid,
        minerHotkey: m.miner_hotkey,
        minerShort: m.miner_hotkey,
        total: m.total,
        accepted: m.accepted,
        rejected: m.rejected,
        acceptanceRate: m.acceptance_rate,
        avgRepScore: m.avg_rep_score,
        btIncentive: btIncentive * 100,
      }
    }).filter(m => m.uid !== null) // Only show miners in metagraph

    if (!sortField || !sortOrder) return stats

    return [...stats].sort((a, b) => {
      let aVal: number
      let bVal: number

      switch (sortField) {
        case 'uid':
          aVal = a.uid ?? -1
          bVal = b.uid ?? -1
          break
        case 'total':
          aVal = a.total
          bVal = b.total
          break
        case 'accepted':
          aVal = a.accepted
          bVal = b.accepted
          break
        case 'rejected':
          aVal = a.rejected
          bVal = b.rejected
          break
        case 'acceptanceRate':
          aVal = a.acceptanceRate
          bVal = b.acceptanceRate
          break
        case 'btIncentive':
          aVal = a.btIncentive
          bVal = b.btIncentive
          break
        default:
          return 0
      }

      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal
    })
  }, [selectedEpochStats, metagraph, sortField, sortOrder])

  // Handle column header click for sorting
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      // Cycle through: asc -> desc -> null
      if (sortOrder === 'asc') {
        setSortOrder('desc')
      } else if (sortOrder === 'desc') {
        setSortOrder(null)
        setSortField(null)
      } else {
        setSortOrder('asc')
      }
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  // Get sort icon for column
  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="h-3 w-3 ml-1 opacity-50" />
    }
    if (sortOrder === 'asc') {
      return <ArrowUp className="h-3 w-3 ml-1" />
    }
    if (sortOrder === 'desc') {
      return <ArrowDown className="h-3 w-3 ml-1" />
    }
    return <ArrowUpDown className="h-3 w-3 ml-1 opacity-50" />
  }

  // Handle epoch overview column header click for sorting
  const handleEpochSort = (field: EpochSortField) => {
    if (epochSortField === field) {
      // Toggle between asc and desc
      setEpochSortOrder(epochSortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setEpochSortField(field)
      setEpochSortOrder('desc')
    }
  }

  // Get sort icon for epoch overview column
  const getEpochSortIcon = (field: EpochSortField) => {
    if (epochSortField !== field) {
      return <ArrowUpDown className="h-3 w-3 ml-1 opacity-50" />
    }
    if (epochSortOrder === 'asc') {
      return <ArrowUp className="h-3 w-3 ml-1" />
    }
    return <ArrowDown className="h-3 w-3 ml-1" />
  }

  // Sorted epoch stats
  const sortedEpochStats = useMemo(() => {
    if (!epochSortField || !epochSortOrder) return epochStats

    return [...epochStats].sort((a, b) => {
      const aVal = a[epochSortField]
      const bVal = b[epochSortField]
      return epochSortOrder === 'asc' ? aVal - bVal : bVal - aVal
    })
  }, [epochStats, epochSortField, epochSortOrder])

  // Copy miner hotkey to clipboard
  const handleCopyMiner = async (hotkey: string, e: React.MouseEvent) => {
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
      setCopiedMiner(hotkey)
      setTimeout(() => setCopiedMiner(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  // Get unique miner count for this epoch (from pre-calculated data)
  const uniqueMiners = epochMinerStats.length

  // Download Epoch Overview CSV
  const downloadEpochOverviewCSV = () => {
    const headers = ['Epoch ID', 'Total Validated', 'Accepted', 'Rejected', 'Avg Score', 'Approval Rate%']
    const rows = sortedEpochStats.map(e => [
      e.epochId,
      e.total,
      e.accepted,
      e.rejected,
      e.avgRepScore.toFixed(3),
      e.acceptanceRate
    ])
    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'epoch_overview.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Download Miners in Epoch CSV
  const downloadMinersInEpochCSV = () => {
    if (!selectedEpoch) return
    const headers = ['UID', 'Hotkey', 'Total Validated', 'Accepted', 'Rejected', 'Approval Rate%', 'Incentive%']
    const rows = epochMinerStats.map(m => [
      m.uid ?? '',
      m.minerHotkey,
      m.total,
      m.accepted,
      m.rejected,
      m.acceptanceRate,
      m.btIncentive.toFixed(4)
    ])
    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `miners_epoch_${selectedEpoch}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (epochStats.length === 0) {
    return (
      <Card className="py-12">
        <CardContent className="text-center text-muted-foreground">
          No epoch data available
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Epoch Performance Chart */}
      <Card>
        <CardHeader className="p-4 md:p-6">
          <CardTitle className="text-base md:text-lg">Epoch Performance</CardTitle>
        </CardHeader>
        <CardContent className="p-4 md:p-6 pt-0 md:pt-0">
          <EpochStackedChart data={epochStats} maxEpochs={20} showContinuous={true} />
        </CardContent>
      </Card>

      {/* Epoch Overview Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Epoch Overview</CardTitle>
            <button
              onClick={downloadEpochOverviewCSV}
              className="flex items-center gap-1 px-2 py-1 md:px-3 md:py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md"
            >
              <Download className="h-3 w-3" />
              CSV
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border max-h-80 overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-slate-900 z-10">
                <TableRow>
                  <TableHead
                    className="cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleEpochSort('epochId')}
                  >
                    <div className="flex items-center">
                      Epoch ID {getEpochSortIcon('epochId')}
                    </div>
                  </TableHead>
                  <TableHead
                    className="text-right cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleEpochSort('total')}
                  >
                    <div className="flex items-center justify-end">
                      Total Validated {getEpochSortIcon('total')}
                    </div>
                  </TableHead>
                  <TableHead
                    className="text-right cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleEpochSort('accepted')}
                  >
                    <div className="flex items-center justify-end">
                      Accepted {getEpochSortIcon('accepted')}
                    </div>
                  </TableHead>
                  <TableHead
                    className="text-right cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleEpochSort('rejected')}
                  >
                    <div className="flex items-center justify-end">
                      Rejected {getEpochSortIcon('rejected')}
                    </div>
                  </TableHead>
                  <TableHead
                    className="text-right cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleEpochSort('avgRepScore')}
                  >
                    <div className="flex items-center justify-end">
                      Avg Score {getEpochSortIcon('avgRepScore')}
                    </div>
                  </TableHead>
                  <TableHead
                    className="text-right cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleEpochSort('acceptanceRate')}
                  >
                    <div className="flex items-center justify-end">
                      Approval Rate {getEpochSortIcon('acceptanceRate')}
                    </div>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedEpochStats.map((epoch) => (
                  <TableRow
                    key={epoch.epochId}
                    className={`cursor-pointer hover:bg-muted/50 ${selectedEpoch === epoch.epochId ? 'bg-blue-500/10' : ''}`}
                    onClick={() => setSelectedEpoch(epoch.epochId)}
                  >
                    <TableCell className="font-medium">{epoch.epochId}</TableCell>
                    <TableCell className="text-right">{epoch.total}</TableCell>
                    <TableCell className="text-right text-green-500">{epoch.accepted}</TableCell>
                    <TableCell className="text-right text-red-500">{epoch.rejected}</TableCell>
                    <TableCell className="text-right">{epoch.avgRepScore.toFixed(3)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-green-500 rounded-full"
                            style={{ width: `${epoch.acceptanceRate}%` }}
                          />
                        </div>
                        <span className="w-12 text-right">{epoch.acceptanceRate}%</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Epoch Selector with Search */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-sm text-muted-foreground mb-2 block">
            Search Epoch
          </label>
          <div className="flex gap-2">
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="Enter Epoch ID..."
              value={epochSearch}
              onChange={(e) => setEpochSearch(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && epochSearch) {
                  const found = epochStats.find(ep => ep.epochId.toString() === epochSearch)
                  if (found) {
                    setSelectedEpoch(found.epochId)
                    setEpochSearch('')
                  }
                }
              }}
              className="flex-1"
            />
            <button
              onClick={() => {
                if (epochSearch) {
                  const found = epochStats.find(ep => ep.epochId.toString() === epochSearch)
                  if (found) {
                    setSelectedEpoch(found.epochId)
                    setEpochSearch('')
                  }
                }
              }}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md text-sm"
            >
              <Search className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div>
          <label className="text-sm text-muted-foreground mb-2 block">
            Select Epoch
          </label>
          <Select
            value={selectedEpoch?.toString() || ''}
            onValueChange={(value) => {
              setSelectedEpoch(parseInt(value))
              setEpochSearch('')
            }}
          >
            <SelectTrigger className="bg-background">
              <SelectValue placeholder="Select Epoch..." />
            </SelectTrigger>
            <SelectContent>
              {epochStats.map((epoch) => (
                <SelectItem key={epoch.epochId} value={epoch.epochId.toString()}>
                  Epoch {epoch.epochId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedEpoch !== null && selectedEpochStats && (
        <div ref={epochDataRef}>
          {/* Epoch Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <MetricCard
              title="Total Validated"
              value={selectedEpochStats.total}
              icon={FileText}
              color="blue"
            />
            <MetricCard
              title="Accepted"
              value={selectedEpochStats.accepted}
              icon={CheckCircle}
              color="green"
            />
            <MetricCard
              title="Rejected"
              value={selectedEpochStats.rejected}
              icon={XCircle}
              color="red"
            />
            <MetricCard
              title="Approval Rate"
              value={`${selectedEpochStats.acceptanceRate}%`}
              icon={Percent}
              color="purple"
            />
            <MetricCard
              title="Unique Miners"
              value={uniqueMiners}
              icon={Users}
              color="cyan"
            />
          </div>

          {/* Miners in Epoch */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">
                  Miners in Epoch {selectedEpoch}
                </CardTitle>
                <button
                  onClick={downloadMinersInEpochCSV}
                  className="flex items-center gap-1 px-2 py-1 md:px-3 md:py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md"
                >
                  <Download className="h-3 w-3" />
                  CSV
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border max-h-96 overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-slate-900 z-10">
                    <TableRow>
                      <TableHead
                        className="w-16 cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleSort('uid')}
                      >
                        <div className="flex items-center">
                          UID {getSortIcon('uid')}
                        </div>
                      </TableHead>
                      <TableHead>Hotkey</TableHead>
                      <TableHead
                        className="text-right cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleSort('total')}
                      >
                        <div className="flex items-center justify-end">
                          Total Validated {getSortIcon('total')}
                        </div>
                      </TableHead>
                      <TableHead
                        className="text-right cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleSort('accepted')}
                      >
                        <div className="flex items-center justify-end">
                          Accepted {getSortIcon('accepted')}
                        </div>
                      </TableHead>
                      <TableHead
                        className="text-right cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleSort('rejected')}
                      >
                        <div className="flex items-center justify-end">
                          Rejected {getSortIcon('rejected')}
                        </div>
                      </TableHead>
                      <TableHead
                        className="text-right cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleSort('acceptanceRate')}
                      >
                        <div className="flex items-center justify-end">
                          Approval Rate {getSortIcon('acceptanceRate')}
                        </div>
                      </TableHead>
                      <TableHead
                        className="text-right cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleSort('btIncentive')}
                      >
                        <div className="flex items-center justify-end">
                          Incentive {getSortIcon('btIncentive')}
                        </div>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {epochMinerStats.map((miner) => (
                      <TableRow key={miner.minerHotkey}>
                        <TableCell className="font-mono text-sm">
                          <span
                            className="cursor-pointer hover:text-blue-400"
                            onClick={() => onMinerClick?.(miner.minerHotkey)}
                            title="Click to view in Miner Tracker"
                          >
                            {miner.uid ?? 'N/A'}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[120px] sm:max-w-[200px]">
                          <div className="flex items-center gap-2 group">
                            <span
                              className="cursor-pointer hover:text-blue-400 truncate sm:break-all md:break-normal"
                              onClick={() => onMinerClick?.(miner.minerHotkey)}
                              title={miner.minerHotkey}
                            >
                              {miner.minerHotkey}
                            </span>
                            <button
                              onClick={(e) => handleCopyMiner(miner.minerHotkey, e)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-muted rounded"
                              title="Copy full hotkey"
                            >
                              {copiedMiner === miner.minerHotkey ? (
                                <Check className="h-3 w-3 text-green-500" />
                              ) : (
                                <Copy className="h-3 w-3 text-muted-foreground" />
                              )}
                            </button>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{miner.total}</TableCell>
                        <TableCell className="text-right text-green-500">
                          {miner.accepted}
                        </TableCell>
                        <TableCell className="text-right text-red-500">
                          {miner.rejected}
                        </TableCell>
                        <TableCell className="text-right">
                          {miner.acceptanceRate}%
                        </TableCell>
                        <TableCell className="text-right">
                          {miner.btIncentive.toFixed(4)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
