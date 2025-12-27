'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { InventoryGrowthChart, DailyLeadsChart } from '@/components/charts'
import { Download } from 'lucide-react'
import type { LeadInventoryData } from '@/lib/types'

interface LeadInventoryProps {
  data: LeadInventoryData[]
}

export function LeadInventory({ data }: LeadInventoryProps) {
  // Download Lead Inventory CSV
  const downloadInventoryCSV = () => {
    const headers = ['Date', 'New Valid Leads', 'Total Inventory']
    const rows = [...data].reverse().map(row => [
      row.date,
      row.newValidLeads,
      row.totalValidInventory
    ])
    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'lead_inventory.csv'
    a.click()
    URL.revokeObjectURL(url)
  }
  if (data.length === 0) {
    return (
      <Card className="py-12">
        <CardContent className="text-center text-muted-foreground">
          No lead inventory data available
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Inventory Growth Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Valid Lead Inventory Growth</CardTitle>
          <p className="text-sm text-muted-foreground">
            Total sum of valid leads in database over time
          </p>
        </CardHeader>
        <CardContent>
          <InventoryGrowthChart data={data} />
        </CardContent>
      </Card>

      {/* Daily Leads Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Daily Valid Lead Additions</CardTitle>
          <p className="text-sm text-muted-foreground">
            Number of valid leads entering inventory each day
          </p>
        </CardHeader>
        <CardContent>
          <DailyLeadsChart data={data} />
        </CardContent>
      </Card>

      {/* Data Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Inventory Data</CardTitle>
            <button
              onClick={downloadInventoryCSV}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-md"
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
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">New Valid Leads</TableHead>
                  <TableHead className="text-right">Total Inventory</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...data].reverse().map((row) => (
                  <TableRow key={row.date}>
                    <TableCell>{row.date}</TableCell>
                    <TableCell className="text-right">
                      {row.newValidLeads.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.totalValidInventory.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
