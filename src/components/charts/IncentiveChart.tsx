'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts'
import { IncentiveData } from '@/lib/types'

interface IncentiveChartProps {
  data: IncentiveData[]
  maxMiners?: number
}

export function IncentiveChart({ data, maxMiners = 15 }: IncentiveChartProps) {
  const chartData = data.slice(0, maxMiners)

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[350px] text-muted-foreground">
        No incentive data available
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={350}>
      <BarChart
        data={chartData}
        margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
      >
        <XAxis
          dataKey="minerShort"
          stroke="#94a3b8"
          fontSize={10}
          angle={-45}
          textAnchor="end"
          height={60}
          tickFormatter={(value) => value.slice(0, 12) + '...'}
        />
        <YAxis
          stroke="#94a3b8"
          fontSize={12}
          tickFormatter={(value) => `${value}%`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
          }}
          separator=": "
          formatter={(value) => `${((value as number) ?? 0).toFixed(2)}%`}
          labelFormatter={(label) => label}
        />
        <Legend />
        <Bar
          dataKey="leadSharePct"
          name="Lead Share (%)"
          fill="#3b82f6"
          radius={[4, 4, 0, 0]}
        />
        <Bar
          dataKey="btIncentivePct"
          name="BT Incentive (%)"
          fill="#a855f7"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}
