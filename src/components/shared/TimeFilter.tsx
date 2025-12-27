'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TimeFilterOption, TIME_FILTER_HOURS } from '@/lib/types'

interface TimeFilterProps {
  value: TimeFilterOption
  onChange: (option: TimeFilterOption, hours: number) => void
  disabled?: boolean
}

const TIME_OPTIONS: { value: TimeFilterOption; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: '1h', label: 'Last 1 hour' },
  { value: '6h', label: 'Last 6 hours' },
  { value: '12h', label: 'Last 12 hours' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '48h', label: 'Last 48 hours' },
  { value: '72h', label: 'Last 72 hours' },
  { value: '7d', label: 'Last 7 days' },
]

export function TimeFilter({ value, onChange, disabled }: TimeFilterProps) {
  const handleChange = (newValue: TimeFilterOption) => {
    onChange(newValue, TIME_FILTER_HOURS[newValue])
  }

  return (
    <Select value={value} onValueChange={handleChange} disabled={disabled}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select time range" />
      </SelectTrigger>
      <SelectContent>
        {TIME_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
