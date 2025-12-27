'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
import { Download } from 'lucide-react'
import type {
  MinerStats,
  EpochStats,
  IncentiveData,
  LeadInventoryData,
} from '@/lib/types'

type ExportType =
  | 'epoch-summary'
  | 'miner-summary'
  | 'incentive-summary'
  | 'lead-inventory'

interface ExportProps {
  minerStats: MinerStats[]
  epochStats: EpochStats[]
  incentiveData: IncentiveData[]
  inventoryData: LeadInventoryData[]
}

export function Export({
  minerStats,
  epochStats,
  incentiveData,
  inventoryData,
}: ExportProps) {
  const [exportType, setExportType] = useState<ExportType>('epoch-summary')

  // Get preview data based on export type
  const previewData = useMemo(() => {
    switch (exportType) {
      case 'epoch-summary':
        return {
          headers: [
            'Epoch ID',
            'Total',
            'Accepted',
            'Rejected',
            'Acceptance Rate %',
            'Avg Rep Score',
          ],
          rows: epochStats.slice(0, 20).map((e) => [
            e.epochId.toString(),
            e.total.toString(),
            e.accepted.toString(),
            e.rejected.toString(),
            e.acceptanceRate.toString(),
            e.avgRepScore.toFixed(3),
          ]),
          total: epochStats.length,
        }
      case 'miner-summary':
        return {
          headers: [
            'UID',
            'Miner',
            'Total',
            'Accepted',
            'Rejected',
            'Pending',
            'Rate %',
            'Rep Score',
            'BT Incentive %',
          ],
          rows: minerStats.slice(0, 20).map((m) => [
            m.uid?.toString() || 'N/A',
            m.minerHotkey,
            m.total.toString(),
            m.accepted.toString(),
            m.rejected.toString(),
            m.pending.toString(),
            m.acceptanceRate.toString(),
            m.avgRepScore.toFixed(3),
            m.btIncentive.toFixed(4),
          ]),
          total: minerStats.length,
        }
      case 'incentive-summary':
        return {
          headers: ['UID', 'Miner', 'Accepted Leads', 'Lead Share %', 'BT Incentive %'],
          rows: incentiveData.slice(0, 20).map((i) => [
            i.uid?.toString() || 'N/A',
            i.minerHotkey,
            i.acceptedLeads.toString(),
            i.leadSharePct.toFixed(2),
            i.btIncentivePct.toFixed(4),
          ]),
          total: incentiveData.length,
        }
      case 'lead-inventory':
        return {
          headers: ['Date', 'New Valid Leads', 'Total Valid Inventory'],
          rows: inventoryData.slice(0, 20).map((i) => [
            i.date,
            i.newValidLeads.toString(),
            i.totalValidInventory.toString(),
          ]),
          total: inventoryData.length,
        }
      default:
        return { headers: [], rows: [], total: 0 }
    }
  }, [exportType, epochStats, minerStats, incentiveData, inventoryData])

  // Generate CSV content
  const generateCSV = () => {
    let csvContent = ''
    let filename = ''

    switch (exportType) {
      case 'epoch-summary':
        csvContent = 'Epoch ID,Total,Accepted,Rejected,Acceptance Rate %,Avg Rep Score\n'
        epochStats.forEach((e) => {
          csvContent += `${e.epochId},${e.total},${e.accepted},${e.rejected},${e.acceptanceRate},${e.avgRepScore}\n`
        })
        filename = `leadpoet_epoch_summary_${new Date().toISOString().split('T')[0]}.csv`
        break

      case 'miner-summary':
        csvContent = 'UID,Miner,Total,Accepted,Rejected,Pending,Acceptance Rate %,Avg Rep Score,BT Incentive %\n'
        minerStats.forEach((m) => {
          csvContent += `${m.uid || ''},${m.minerHotkey},${m.total},${m.accepted},${m.rejected},${m.pending},${m.acceptanceRate},${m.avgRepScore},${m.btIncentive}\n`
        })
        filename = `leadpoet_miner_summary_${new Date().toISOString().split('T')[0]}.csv`
        break

      case 'incentive-summary':
        csvContent = 'UID,Miner,Accepted Leads,Lead Share %,BT Incentive %\n'
        incentiveData.forEach((i) => {
          csvContent += `${i.uid || ''},${i.minerHotkey},${i.acceptedLeads},${i.leadSharePct},${i.btIncentivePct}\n`
        })
        filename = `leadpoet_incentive_summary_${new Date().toISOString().split('T')[0]}.csv`
        break

      case 'lead-inventory':
        csvContent = 'Date,New Valid Leads,Total Valid Inventory\n'
        inventoryData.forEach((i) => {
          csvContent += `${i.date},${i.newValidLeads},${i.totalValidInventory}\n`
        })
        filename = `leadpoet_lead_inventory_${new Date().toISOString().split('T')[0]}.csv`
        break
    }

    // Download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = filename
    link.click()
  }

  return (
    <div className="space-y-6">
      {/* Export Type Selector */}
      <div className="w-72">
        <label className="text-sm text-muted-foreground mb-2 block">
          Select data to export
        </label>
        <Select
          value={exportType}
          onValueChange={(value) => setExportType(value as ExportType)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select export type..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="epoch-summary">Epoch Summary</SelectItem>
            <SelectItem value="miner-summary">Miner Summary</SelectItem>
            <SelectItem value="incentive-summary">Incentive Summary</SelectItem>
            <SelectItem value="lead-inventory">Lead Inventory</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center justify-between">
            <span>Preview ({previewData.total} records)</span>
            <Button onClick={generateCSV} className="gap-2">
              <Download className="h-4 w-4" />
              Download CSV
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border max-h-96 overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-slate-900 z-10">
                <TableRow>
                  {previewData.headers.map((header, idx) => (
                    <TableHead key={idx}>{header}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewData.rows.map((row, rowIdx) => (
                  <TableRow key={rowIdx}>
                    {row.map((cell, cellIdx) => (
                      <TableCell
                        key={cellIdx}
                        className={cellIdx === 1 ? 'font-mono text-xs max-w-48 truncate' : ''}
                      >
                        {cell}
                      </TableCell>
                    ))}
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
