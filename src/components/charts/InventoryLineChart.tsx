'use client'

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

interface InventoryChartProps {
  data: LeadInventoryData[]
}

export function InventoryGrowthChart({ data }: InventoryChartProps) {
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
      <AreaChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
        <defs>
          <linearGradient id="colorInventory" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          stroke="#94a3b8"
          fontSize={12}
          tickFormatter={(value) => {
            // Parse date string directly to avoid timezone issues
            const [, month, day] = value.split('-')
            return `${parseInt(month)}/${parseInt(day)}`
          }}
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
            return `${parseInt(month)}/${parseInt(day)}/${year}`
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

export function DailyLeadsChart({ data }: InventoryChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[350px] text-muted-foreground">
        No daily leads data available
      </div>
    )
  }

  // Reverse data so oldest is on left, newest on right
  const chartData = [...data].reverse()

  return (
    <ResponsiveContainer width="100%" height={350}>
      <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
        <XAxis
          dataKey="date"
          stroke="#94a3b8"
          fontSize={12}
          tickFormatter={(value) => {
            // Parse date string directly to avoid timezone issues
            const [, month, day] = value.split('-')
            return `${parseInt(month)}/${parseInt(day)}`
          }}
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
          formatter={(value) => [((value as number) ?? 0).toLocaleString(), 'New Lead Inventory']}
          labelFormatter={(label) => {
            // Parse date string directly to avoid timezone issues
            const [year, month, day] = label.split('-')
            return `${parseInt(month)}/${parseInt(day)}/${year}`
          }}
        />
        <Bar dataKey="newValidLeads" fill="#3b82f6" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
