'use client'

import { useState, useMemo } from 'react'
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Search, Copy, Check } from 'lucide-react'
import type { MinerStats } from '@/lib/types'

interface MinerIncentiveChartProps {
  minerStats: MinerStats[]
}

interface ChartDataItem {
  index: number
  rank: number
  minerHotkey: string
  minerShort: string
  uid: number | null
  btIncentive: number
}

export function MinerIncentiveChart({ minerStats }: MinerIncentiveChartProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [copiedField, setCopiedField] = useState<string | null>(null)

  // Sort miners by incentive (ascending) and assign rank (descending - highest incentive = rank 1)
  const chartData: ChartDataItem[] = useMemo(() => {
    const sorted = [...minerStats].sort((a, b) => a.btIncentive - b.btIncentive)
    const totalMiners = sorted.length
    return sorted.map((miner, index) => ({
      index: index + 1,
      rank: totalMiners - index,
      minerHotkey: miner.minerHotkey,
      minerShort: miner.minerShort,
      uid: miner.uid,
      btIncentive: miner.btIncentive,
    }))
  }, [minerStats])

  // Get rank 1 miner (highest incentive = last in sorted array)
  const rank1Miner = useMemo(() => {
    return chartData.find(m => m.rank === 1) || null
  }, [chartData])

  const [hoveredMiner, setHoveredMiner] = useState<ChartDataItem | null>(null)

  // Find miner matching search - prioritize exact UID match
  const searchedMiner = useMemo(() => {
    if (!searchTerm) return null
    const term = searchTerm.trim().toLowerCase()

    // First, check for exact UID match (if search term is a number)
    if (/^\d+$/.test(term)) {
      const uidMatch = chartData.find(m => m.uid !== null && m.uid.toString() === term)
      if (uidMatch) return uidMatch
    }

    // Then, check for hotkey match
    return chartData.find(m => m.minerHotkey.toLowerCase().includes(term)) || null
  }, [chartData, searchTerm])

  // Get max incentive for Y-axis domain (add 10% padding)
  const yAxisMax = useMemo(() => {
    if (chartData.length === 0) return 1
    const max = Math.max(...chartData.map(m => m.btIncentive))
    return Math.ceil((max * 1.1) * 100) / 100
  }, [chartData])

  const handleCopy = async (text: string, field: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        // Fallback for older browsers/non-HTTPS
        const textArea = document.createElement('textarea')
        textArea.value = text
        textArea.style.position = 'fixed'
        textArea.style.opacity = '0'
        document.body.appendChild(textArea)
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
      }
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const formatHotkey = (hotkey: string) => {
    if (hotkey.length <= 20) return hotkey
    return `${hotkey.substring(0, 10)}...${hotkey.substring(hotkey.length - 6)}`
  }

  // Display miner (searched > hovered > rank 1 default)
  const displayMiner = searchTerm ? (searchedMiner ?? rank1Miner) : (hoveredMiner ?? rank1Miner)

  // Reference line target (for crosshairs) - show for searched, hovered, or rank 1
  const crosshairTarget = searchTerm ? (searchedMiner ?? rank1Miner) : (hoveredMiner ?? rank1Miner)

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[400px] text-muted-foreground">
        No incentive data available
      </div>
    )
  }

  return (
    <div className="space-y-3 md:space-y-4">
      {/* Search Box - Mobile first */}
      <div className="md:hidden relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by Hotkey or UID..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-9 bg-muted/30 text-sm"
        />
      </div>

      {/* Info Panel and Search */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 md:gap-4">
        {/* Miner Info Panel */}
        <Card className="flex-1 p-2 md:p-3 bg-muted/30">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
            <div className="md:border-r border-border md:pr-4">
              <div className="text-[10px] md:text-xs text-muted-foreground mb-0.5 md:mb-1">RANK</div>
              <div className="font-semibold text-base md:text-lg text-white">
                {displayMiner ? `#${displayMiner.rank}` : '-'}
              </div>
            </div>
            <div className="md:border-r border-border md:pr-4">
              <div className="text-[10px] md:text-xs text-muted-foreground mb-0.5 md:mb-1">INCENTIVE</div>
              <div className="font-semibold text-base md:text-lg text-emerald-400">
                {displayMiner ? `${displayMiner.btIncentive.toFixed(4)}%` : '-'}
              </div>
            </div>
            <div className="md:border-r border-border md:pr-4">
              <div className="text-[10px] md:text-xs text-muted-foreground mb-0.5 md:mb-1">HOTKEY</div>
              <div className="flex items-center gap-1">
                <span className="font-mono text-xs md:text-sm truncate text-white">
                  {displayMiner ? formatHotkey(displayMiner.minerHotkey) : '-'}
                </span>
                {displayMiner && (
                  <button
                    onClick={() => handleCopy(displayMiner.minerHotkey, 'hotkey')}
                    className="p-1 hover:bg-muted rounded flex-shrink-0"
                    title="Copy hotkey"
                  >
                    {copiedField === 'hotkey' ? (
                      <Check className="h-3 w-3 text-green-500" />
                    ) : (
                      <Copy className="h-3 w-3 text-muted-foreground" />
                    )}
                  </button>
                )}
              </div>
            </div>
            <div>
              <div className="text-[10px] md:text-xs text-muted-foreground mb-0.5 md:mb-1">UID</div>
              <div className="font-semibold text-base md:text-lg text-white">
                {displayMiner ? (displayMiner.uid ?? '-') : '-'}
              </div>
            </div>
          </div>
        </Card>

        {/* Search Box - Desktop */}
        <div className="hidden md:block relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Enter Hotkey or UID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 bg-muted/30"
          />
        </div>
      </div>

      {/* Chart */}
      <div className="relative h-[280px] md:h-[400px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart
            margin={{ top: 20, right: 60, left: 20, bottom: 20 }}
          >
            <XAxis
              dataKey="index"
              type="number"
              domain={[0, chartData.length + 1]}
              tick={false}
              axisLine={{ stroke: '#334155' }}
              tickLine={false}
            />
            <YAxis
              dataKey="btIncentive"
              type="number"
              domain={[0, yAxisMax]}
              stroke="#94a3b8"
              fontSize={12}
              tickFormatter={(value) => value.toFixed(3)}
              orientation="right"
              axisLine={{ stroke: '#334155' }}
              tickLine={{ stroke: '#334155' }}
              label={{
                value: 'Incentive (%)',
                angle: 90,
                position: 'insideRight',
                offset: 10,
                style: { fill: '#94a3b8', fontSize: 12 },
              }}
            />

            {/* Crosshair reference lines */}
            {crosshairTarget && (
              <>
                <ReferenceLine
                  x={crosshairTarget.index}
                  stroke="#64748b"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
                <ReferenceLine
                  y={crosshairTarget.btIncentive}
                  stroke="#64748b"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
              </>
            )}

            <Scatter
              data={chartData}
              isAnimationActive={false}
              onMouseEnter={(data) => {
                if (data) {
                  setHoveredMiner(data as unknown as ChartDataItem)
                }
              }}
              onMouseLeave={() => setHoveredMiner(null)}
            >
              {chartData.map((entry, index) => {
                const isHovered = hoveredMiner?.index === entry.index
                const isSearched = searchedMiner?.index === entry.index

                let fill = '#10b981' // Default green
                let radius = 4

                if (isSearched) {
                  fill = '#facc15' // Yellow for searched
                  radius = 8
                }
                if (isHovered && !searchTerm) {
                  fill = '#22d3ee' // Cyan for hovered (only when not searching)
                  radius = 6
                }

                return (
                  <Cell
                    key={`cell-${index}`}
                    fill={fill}
                    r={radius}
                    style={{ cursor: 'pointer' }}
                  />
                )
              })}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
