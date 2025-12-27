'use client'

import { useState, useEffect, useCallback } from 'react'
import type { MetagraphData } from '../types'

export function useMetagraph() {
  const [metagraph, setMetagraph] = useState<MetagraphData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchMetagraph = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/metagraph')
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data: MetagraphData = await response.json()
      setMetagraph(data)

      if (data.error) {
        setError(data.error)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch metagraph'
      setError(message)
      setMetagraph(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMetagraph()
  }, [fetchMetagraph])

  return {
    metagraph,
    loading,
    error,
    refetch: fetchMetagraph,
  }
}

// Get active miners (non-validators) from metagraph
export function getActiveMinerCount(metagraph: MetagraphData | null): number {
  if (!metagraph || metagraph.error) return 0

  return Object.entries(metagraph.isValidator)
    .filter(([, isVal]) => !isVal)
    .length
}
