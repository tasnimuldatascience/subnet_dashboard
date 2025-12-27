'use client'

import { useState, useEffect } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'

interface DecisionPieChartProps {
  accepted: number
  rejected: number
  pending: number
}

const COLORS = {
  ACCEPTED: '#22c55e',
  REJECTED: '#ef4444',
  PENDING: '#f59e0b',
}

export function DecisionPieChart({ accepted, rejected, pending }: DecisionPieChartProps) {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  const data = [
    { name: 'Accepted', value: accepted },
    { name: 'Rejected', value: rejected },
    { name: 'Pending', value: pending },
  ].filter((d) => d.value > 0)

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] text-muted-foreground">
        No data available
      </div>
    )
  }

  // Custom label renderer - keeps full text but positions better on mobile
  const renderLabel = ({ name, percent, cx, cy, midAngle, outerRadius }: {
    name?: string
    percent?: number
    cx?: number
    cy?: number
    midAngle?: number
    outerRadius?: number
  }) => {
    if (!name || cx === undefined || cy === undefined || midAngle === undefined || outerRadius === undefined) return null
    const RADIAN = Math.PI / 180
    const radius = outerRadius + (isMobile ? 25 : 35)
    const x = cx + radius * Math.cos(-midAngle * RADIAN)
    const y = cy + radius * Math.sin(-midAngle * RADIAN)
    const color = COLORS[name.toUpperCase() as keyof typeof COLORS] || '#94a3b8'

    return (
      <text
        x={x}
        y={y}
        fill={color}
        textAnchor={x > cx ? 'start' : 'end'}
        dominantBaseline="central"
        fontSize={isMobile ? 10 : 12}
      >
        {`${name}: ${((percent ?? 0) * 100).toFixed(1)}%`}
      </text>
    )
  }

  return (
    <div className="h-[280px] md:h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={isMobile ? { top: 20, right: 20, bottom: 20, left: 20 } : undefined}>
          <Pie
            data={data}
            cx="50%"
            cy="45%"
            innerRadius={isMobile ? 28 : 40}
            outerRadius={isMobile ? 50 : 70}
            paddingAngle={2}
            dataKey="value"
            label={renderLabel}
            labelLine={false}
          >
          {data.map((entry) => (
            <Cell
              key={entry.name}
              fill={COLORS[entry.name.toUpperCase() as keyof typeof COLORS]}
              stroke="transparent"
            />
          ))}
        </Pie>
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
          formatter={(value, name) => [(value ?? 0).toLocaleString(), name]}
        />
        <Legend
          verticalAlign="bottom"
          height={36}
          formatter={(value) => <span className="text-xs md:text-sm">{value}</span>}
        />
      </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
