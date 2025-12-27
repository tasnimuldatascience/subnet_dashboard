'use client'

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
])

export function RejectionBarChart({ data, maxItems = 10 }: RejectionBarChartProps) {
  // Filter to only allowed reasons and show items > 1%, then take top items
  const filteredData = data
    .filter(d => ALLOWED_REASONS.has(d.reason))
    .filter(d => d.percentage > 1)
  const chartData = filteredData.slice(0, maxItems).reverse()

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] text-green-500">
        No rejections!
      </div>
    )
  }

  // Color gradient from dark red to light red based on count
  const maxCount = Math.max(...chartData.map((d) => d.count))
  const getColor = (count: number) => {
    const intensity = 0.4 + (count / maxCount) * 0.6
    return `rgba(239, 68, 68, ${intensity})`
  }

  return (
    <div className="h-[250px] md:h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
        >
        <XAxis type="number" stroke="#94a3b8" fontSize={12} />
        <YAxis
          type="category"
          dataKey="reason"
          stroke="#94a3b8"
          fontSize={11}
          width={220}
          tick={{ style: { whiteSpace: 'nowrap' } }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            color: '#f1f5f9',
          }}
          itemStyle={{ color: '#f1f5f9' }}
          labelStyle={{ color: '#94a3b8' }}
          separator=": "
          formatter={(value, _name, props) => [
            `${((value as number) ?? 0).toLocaleString()} (${(props?.payload as RejectionReason)?.percentage ?? 0}%)`,
            (props?.payload as RejectionReason)?.reason ?? '',
          ]}
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
          {chartData.map((entry, index) => (
            <Cell key={index} fill={getColor(entry.count)} />
          ))}
        </Bar>
      </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
