'use client'

import { useState, useEffect } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Cell,
} from 'recharts'
import { RejectionReason } from '@/lib/types'

interface RejectionBarChartProps {
  data: RejectionReason[]
  maxItems?: number
  combineErrorsAsUnknown?: boolean
}

// Only these rejection reasons should be shown in the chart
const ALLOWED_REASONS = new Set([
  'Invalid Email',
  'Invalid LinkedIn',
  'Invalid Role',
  'Invalid Region',
  'Invalid Source URL',
  'Invalid Website',
  'Invalid Country',
  'Invalid Industry',
  'Invalid Source Type',
  'Invalid Sub Industry',
  'Invalid Company',
  'Invalid Employee Count',
  'Invalid Description',
  'Invalid Company Linkedin',
])

export function RejectionBarChart({ data, maxItems = 10, combineErrorsAsUnknown = false }: RejectionBarChartProps) {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // First, aggregate entries with the same reason name
  const aggregatedMap = new Map<string, { count: number; percentage: number }>()
  for (const d of data) {
    const existing = aggregatedMap.get(d.reason)
    if (existing) {
      existing.count += d.count
      existing.percentage += d.percentage
    } else {
      aggregatedMap.set(d.reason, { count: d.count, percentage: d.percentage })
    }
  }
  const aggregatedData: RejectionReason[] = Array.from(aggregatedMap.entries()).map(([reason, stats]) => ({
    reason,
    count: stats.count,
    percentage: Math.min(stats.percentage, 100),
  }))

  // For Miner tab: combine reasons containing "Error" into "Unknown Error"
  // For Overview tab: filter to only allowed reasons
  let chartData: RejectionReason[]

  // Track if there are reasons outside the allowed list (for miner tab message)
  let hasUnavailableReasons = false

  if (combineErrorsAsUnknown) {
    // Filter to only allowed reasons for miner tab
    const allowedReasons = aggregatedData.filter(d => ALLOWED_REASONS.has(d.reason))
    const otherReasons = aggregatedData.filter(d => !ALLOWED_REASONS.has(d.reason))

    hasUnavailableReasons = otherReasons.length > 0

    // Sort by count descending and take top items
    const sorted = allowedReasons.sort((a, b) => b.count - a.count)
    chartData = sorted.slice(0, maxItems).reverse()
  } else {
    // Filter to only allowed reasons and show items > 1%, then take top items
    const filteredData = aggregatedData
      .filter(d => ALLOWED_REASONS.has(d.reason))
      .filter(d => d.percentage > 1)
    chartData = filteredData.slice(0, maxItems).reverse()
  }

  if (chartData.length === 0) {
    // If no allowed reasons but there are other reasons, show unavailable message
    if (hasUnavailableReasons && combineErrorsAsUnknown) {
      return (
        <div className="flex items-center justify-center h-[300px]">
          <span className="text-xs text-amber-400">Rejection reason unavailable. Please query the Lead Search tab for details.</span>
        </div>
      )
    }
    return (
      <div className="flex items-center justify-center h-[300px]">
        <span className="text-green-500">No rejections!</span>
      </div>
    )
  }

  // Color gradient from dark red to light red based on count
  const maxCount = Math.max(...chartData.map((d) => d.count))
  const getColor = (count: number) => {
    const intensity = 0.4 + (count / maxCount) * 0.6
    return `rgba(239, 68, 68, ${intensity})`
  }

  // Calculate dynamic YAxis width based on longest label (~7px per char at fontSize 11)
  const maxLabelLength = Math.max(...chartData.map(d => d.reason.length))
  const yAxisWidth = Math.max(maxLabelLength * 7 + 10, 80)

  return (
    <div className="flex flex-col">
      <div className="h-[250px] md:h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
        >
        <XAxis type="number" stroke="#94a3b8" fontSize={12} />
        <YAxis
          type="category"
          dataKey="reason"
          stroke="#94a3b8"
          fontSize={11}
          width={yAxisWidth}
          tick={{ style: { whiteSpace: 'nowrap' } }}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload || !payload[0]) return null
            const data = payload[0].payload as RejectionReason
            return (
              <div
                style={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #475569',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  ...(isMobile && { maxWidth: '220px' }),
                }}
              >
                <span style={{ color: '#ef4444' }}>{data.reason}</span>
                <span style={{ color: '#f1f5f9' }}>: {data.count.toLocaleString()} ({data.percentage.toFixed(2)}%)</span>
              </div>
            )
          }}
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {chartData.map((entry, index) => (
              <Cell key={index} fill={getColor(entry.count)} />
            ))}
          </Bar>
        </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
