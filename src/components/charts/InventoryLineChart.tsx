'use client'

import { useState, useEffect } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Area,
  AreaChart,
} from 'recharts'
import { LeadInventoryData } from '@/lib/types'
import { WeeklyLeadInventory } from '@/lib/db-precalc'

interface InventoryChartProps {
  data: LeadInventoryData[]
}

export function InventoryGrowthChart({ data }: InventoryChartProps) {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[350px] text-muted-foreground">
        No inventory data available
      </div>
    )
  }

  // Reverse data so oldest is on left, newest on right
  const chartData = [...data].reverse()

  return (
    <ResponsiveContainer width="100%" height={350}>
      <AreaChart data={chartData} margin={isMobile
        ? { top: 20, right: 20, left: 0, bottom: 5 }
        : { top: 20, right: 30, left: 20, bottom: 5 }
      }>
        <defs>
          <linearGradient id="colorInventory" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          stroke="#94a3b8"
          fontSize={isMobile ? 10 : 12}
          tickFormatter={(value) => {
            // Parse date string directly to avoid timezone issues
            const [, month, day] = value.split('-')
            return `${parseInt(month)}/${parseInt(day)}`
          }}
          interval={isMobile ? Math.ceil(chartData.length / 6) : 0}
          angle={isMobile ? -45 : 0}
          textAnchor={isMobile ? 'end' : 'middle'}
          height={isMobile ? 50 : 30}
        />
        <YAxis
          stroke="#94a3b8"
          fontSize={12}
          tickFormatter={(value) => value.toLocaleString()}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
          }}
          separator=": "
          formatter={(value) => [((value as number) ?? 0).toLocaleString(), 'Total Lead Inventory']}
          labelFormatter={(label) => {
            // Parse date string directly to avoid timezone issues
            const [year, month, day] = label.split('-')
            const displayYear = isMobile ? year.slice(-2) : year
            return `${parseInt(month)}/${parseInt(day)}/${displayYear}`
          }}
        />
        <Area
          type="monotone"
          dataKey="totalValidInventory"
          stroke="#22c55e"
          strokeWidth={2}
          fill="url(#colorInventory)"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

interface WeeklyLeadsChartProps {
  data: WeeklyLeadInventory[]
}

export function WeeklyLeadsChart({ data }: WeeklyLeadsChartProps) {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[350px] text-muted-foreground">
        No weekly leads data available
      </div>
    )
  }

  // Sort by week_start ascending (oldest first on left)
  const chartData = [...data].sort((a, b) =>
    new Date(a.week_start).getTime() - new Date(b.week_start).getTime()
  )

  // Format date for display (e.g., "12/22")
  const formatDate = (dateStr: string) => {
    const [, month, day] = dateStr.split('-')
    return `${parseInt(month)}/${parseInt(day)}`
  }

  // Format full date for tooltip (e.g., "12/22/2024" or "12/22/24" on mobile)
  const formatFullDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-')
    const displayYear = isMobile ? year.slice(-2) : year
    return `${parseInt(month)}/${parseInt(day)}/${displayYear}`
  }

  return (
    <ResponsiveContainer width="100%" height={350}>
      <BarChart
        data={chartData}
        margin={isMobile
          ? { top: 20, right: 20, left: 0, bottom: 5 }
          : { top: 20, right: 30, left: 20, bottom: 5 }
        }
      >
        <XAxis
          dataKey="week_start"
          stroke="#94a3b8"
          fontSize={isMobile ? 10 : 12}
          tickFormatter={formatDate}
          interval={0}
          angle={isMobile ? -45 : 0}
          textAnchor={isMobile ? 'end' : 'middle'}
          height={isMobile ? 50 : 30}
        />
        <YAxis
          stroke="#94a3b8"
          fontSize={12}
          tickFormatter={(value) => value.toLocaleString()}
        />
        <Tooltip
          offset={isMobile ? -30 : 10}
          content={({ active, payload }) => {
            if (!active || !payload || !payload[0]) return null
            const item = payload[0].payload as WeeklyLeadInventory
            return (
              <div
                style={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  padding: '8px 12px',
                }}
              >
                <div style={{ color: '#94a3b8', marginBottom: '4px', fontSize: '14px' }}>
                  {formatFullDate(item.week_start)}-{formatFullDate(item.period_end)}
                </div>
                <div style={{ color: '#3b82f6', fontSize: '14px' }}>
                  New Lead Inventory: {item.leads_added.toLocaleString()}
                </div>
              </div>
            )
          }}
        />
        <Bar dataKey="leads_added" fill="#3b82f6" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
