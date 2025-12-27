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

// Simplified type for chart data - only needs what the chart renders
interface EpochChartData {
  epochId: number
  accepted: number
  rejected: number
}

interface EpochStackedChartProps {
  data: EpochChartData[]
  maxEpochs?: number
  showContinuous?: boolean // Show continuous epoch range (including zeros for missing epochs)
}

export function EpochStackedChart({ data, maxEpochs = 20, showContinuous = false }: EpochStackedChartProps) {
  // Build chart data
  let chartData: EpochChartData[]

  if (showContinuous && data.length > 0) {
    // Find the highest epoch ID
    const maxEpochId = Math.max(...data.map(d => d.epochId))
    const startEpochId = maxEpochId - maxEpochs + 1

    // Create a map of existing data
    const dataMap = new Map(data.map(d => [d.epochId, d]))

    // Generate continuous range with zeros for missing epochs
    chartData = []
    for (let epochId = startEpochId; epochId <= maxEpochId; epochId++) {
      const existing = dataMap.get(epochId)
      chartData.push(existing || { epochId, accepted: 0, rejected: 0 })
    }
  } else {
    // Take the most recent epochs and reverse for chronological display
    chartData = data.slice(0, maxEpochs).reverse()
  }

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[250px] md:h-[350px] text-muted-foreground">
        No epoch data available
      </div>
    )
  }

  return (
    <div className="h-[250px] md:h-[350px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={{ top: 20, right: 20, left: 20, bottom: 60 }}
        >
          <XAxis
            dataKey="epochId"
            stroke="#94a3b8"
            fontSize={10}
            tickFormatter={(value) => value}
            interval="preserveStartEnd"
            label={{ value: 'Epoch ID', position: 'bottom', offset: 10, style: { fill: '#94a3b8', fontSize: 12 } }}
          />
          <YAxis
            stroke="#94a3b8"
            fontSize={10}
            width={50}
            label={{ value: 'Leads', angle: -90, position: 'insideLeft', offset: 10, style: { fill: '#94a3b8', fontSize: 12 } }}
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
            formatter={(value, name) => [(value ?? 0).toLocaleString(), name]}
            labelFormatter={(label) => `Epoch ${label}`}
          />
          <Legend
            verticalAlign="bottom"
            align="center"
            wrapperStyle={{ fontSize: '12px', paddingTop: '35px', width: '100%', display: 'flex', justifyContent: 'center' }}
          />
          <Bar
            dataKey="accepted"
            name="Accepted"
            stackId="a"
            fill="#22c55e"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="rejected"
            name="Rejected"
            stackId="a"
            fill="#ef4444"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
