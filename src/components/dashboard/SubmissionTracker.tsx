'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  FileText,
  Database,
  Send,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Copy,
  Check,
  ChevronsUpDown,
  Search,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
} from 'lucide-react'

const ITEMS_PER_PAGE = 100
import { cn } from '@/lib/utils'
import { fetchLeadJourney } from '@/lib/supabase'
import { cleanRejectionReason } from '@/lib/utils-rejection'
import type { JourneyEvent, MinerStats, EpochStats } from '@/lib/types'

interface SearchResult {
  emailHash: string
  minerHotkey: string
  leadId: string | null
  uid: number | null
  epochId: number | null
  decision: 'ACCEPTED' | 'REJECTED' | 'PENDING'
  repScore: number | null
  rejectionReason: string | null
  timestamp: string
}

// Module-level cache to persist search results across tab switches
interface SearchCache {
  results: SearchResult[]
  totalResults: number
  filters: {
    uid: string
    epoch: string
    leadId: string
  }
  currentPage: number
  timestamp: number
}

let searchCache: SearchCache | null = null

interface SubmissionTrackerProps {
  minerStats: MinerStats[]
  epochStats: EpochStats[]
  onUidClick?: (uid: number) => void
  onEpochClick?: (epochId: number) => void
}

// Copyable text component with optional truncation
function CopyableText({ text, maxLength }: { text: string; maxLength?: number }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        // Fallback for older browsers/non-HTTPS
        const textArea = document.createElement('textarea')
        textArea.value = text
        textArea.style.position = 'fixed'
        textArea.style.opacity = '0'
        document.body.appendChild(textArea)
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const displayText = maxLength && text.length > maxLength
    ? text.substring(0, maxLength) + '...'
    : text

  return (
    <span
      onClick={handleCopy}
      className="cursor-pointer hover:text-primary inline-flex items-center gap-1 group"
      title={text}
    >
      <span className="truncate max-w-[120px] sm:max-w-[180px] md:max-w-none">{displayText}</span>
      {copied ? (
        <Check className="h-3 w-3 text-green-500 flex-shrink-0" />
      ) : (
        <Copy className="h-3 w-3 opacity-0 group-hover:opacity-50 flex-shrink-0" />
      )}
    </span>
  )
}

export function SubmissionTracker({ minerStats, epochStats, onUidClick, onEpochClick }: SubmissionTrackerProps) {
  // Filters - restore from cache if available
  const [selectedUid, setSelectedUid] = useState<string>(searchCache?.filters.uid ?? 'all')
  const [selectedEpoch, setSelectedEpoch] = useState<string>(searchCache?.filters.epoch ?? 'all')
  const [leadIdSearch, setLeadIdSearch] = useState(searchCache?.filters.leadId ?? '')

  // Search state - restore from cache if available
  const [searchResults, setSearchResults] = useState<SearchResult[]>(searchCache?.results ?? [])
  const [totalResults, setTotalResults] = useState<number>(searchCache?.totalResults ?? 0)
  const [isSearching, setIsSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(searchCache !== null)
  const [currentPage, setCurrentPage] = useState(searchCache?.currentPage ?? 1)

  // Save current page to cache when it changes
  useEffect(() => {
    if (searchCache && searchResults.length > 0) {
      searchCache.currentPage = currentPage
    }
  }, [currentPage, searchResults.length])

  // Auto-load latest 100 leads on mount if no cache and All is selected
  useEffect(() => {
    if (!searchCache && selectedUid === 'all' && selectedEpoch === 'all') {
      loadLatestLeads()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load latest leads (when All is selected)
  const loadLatestLeads = async () => {
    setIsSearching(true)
    setHasSearched(true)

    try {
      const params = new URLSearchParams()
      params.set('limit', '100')

      console.log('[Lead Search] Loading latest 100 leads...')

      const response = await fetch(`/api/lead-search/latest?${params}`)
      if (!response.ok) {
        console.error('[Lead Search] API error')
        setSearchResults([])
        return
      }

      const data = await response.json()
      console.log(`[Lead Search] Loaded ${data.results?.length || 0} latest leads`)

      const results: SearchResult[] = (data.results || []).map((r: SearchResult) => ({
        emailHash: r.emailHash,
        minerHotkey: r.minerHotkey,
        leadId: r.leadId,
        uid: r.uid,
        epochId: r.epochId,
        decision: r.decision,
        repScore: r.repScore,
        rejectionReason: r.rejectionReason,
        timestamp: r.timestamp,
      }))

      setSearchResults(results)
      setTotalResults(results.length)
      setCurrentPage(1)

      // Save to cache
      searchCache = {
        results,
        totalResults: results.length,
        filters: { uid: 'all', epoch: 'all', leadId: '' },
        currentPage: 1,
        timestamp: Date.now(),
      }
    } catch (err) {
      console.error('Error loading latest leads:', err)
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }

  // Sorting state
  type SortField = 'uid' | 'epochId' | 'repScore' | 'timestamp' | null
  type SortOrder = 'asc' | 'desc'
  const [sortField, setSortField] = useState<SortField>(null)
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')

  // Handle sort click
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      // Toggle order if same field
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      // New field, default to desc
      setSortField(field)
      setSortOrder('desc')
    }
    setCurrentPage(1) // Reset to first page on sort
  }

  // Sorted results
  const sortedResults = useMemo(() => {
    if (!sortField) return searchResults

    return [...searchResults].sort((a, b) => {
      let aVal: number | null = null
      let bVal: number | null = null

      switch (sortField) {
        case 'uid':
          aVal = a.uid
          bVal = b.uid
          break
        case 'epochId':
          aVal = a.epochId
          bVal = b.epochId
          break
        case 'repScore':
          aVal = a.repScore
          bVal = b.repScore
          break
        case 'timestamp':
          aVal = new Date(a.timestamp).getTime()
          bVal = new Date(b.timestamp).getTime()
          break
      }

      // Handle nulls - push to end
      if (aVal === null && bVal === null) return 0
      if (aVal === null) return 1
      if (bVal === null) return -1

      const diff = aVal - bVal
      return sortOrder === 'asc' ? diff : -diff
    })
  }, [searchResults, sortField, sortOrder])

  // Pagination calculations (use sorted results)
  const totalPages = Math.ceil(sortedResults.length / ITEMS_PER_PAGE)
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const endIndex = startIndex + ITEMS_PER_PAGE
  const paginatedResults = sortedResults.slice(startIndex, endIndex)

  // Lead journey viewer
  const [selectedEmailHash, setSelectedEmailHash] = useState<string | null>(null)
  const [journeyEvents, setJourneyEvents] = useState<JourneyEvent[]>([])
  const [loadingJourney, setLoadingJourney] = useState(false)
  const journeyRef = useRef<HTMLDivElement>(null)

  // Format event type: replace underscores with spaces
  const formatEventType = (eventType: string) => {
    return eventType.replace(/_/g, ' ')
  }

  // Custom dropdown state
  const [uidDropdownOpen, setUidDropdownOpen] = useState(false)
  const [uidSearchQuery, setUidSearchQuery] = useState('')
  const uidDropdownRef = useRef<HTMLDivElement>(null)
  const [epochDropdownOpen, setEpochDropdownOpen] = useState(false)
  const [epochSearchQuery, setEpochSearchQuery] = useState('')
  const epochDropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (uidDropdownRef.current && !uidDropdownRef.current.contains(e.target as Node)) {
        setUidDropdownOpen(false)
      }
      if (epochDropdownRef.current && !epochDropdownRef.current.contains(e.target as Node)) {
        setEpochDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // All available UIDs and Epochs with cached counts
  // All UID options with epoch data for cross-filtering
  const allUidOptions = useMemo(() => {
    return minerStats
      .filter(m => m.uid !== null)
      .map(m => ({
        uid: m.uid!,
        hotkey: m.minerHotkey,
        total: m.total,
        epochIds: m.epochPerformance?.map(ep => ep.epochId) || []
      }))
      .sort((a, b) => a.uid - b.uid)
  }, [minerStats])

  // All epoch options with miner data for cross-filtering
  const allEpochOptions = useMemo(() => {
    return epochStats
      .map(e => ({
        epochId: e.epochId,
        total: e.total,
        minerHotkeys: e.miners?.map(m => m.miner_hotkey) || []
      }))
      .sort((a, b) => b.epochId - a.epochId)
  }, [epochStats])

  // Filtered UID options based on search AND selected epoch
  const filteredUidOptions = useMemo(() => {
    let options = allUidOptions

    // Filter by selected epoch (show only miners in that epoch)
    if (selectedEpoch !== 'all') {
      const selectedEpochData = allEpochOptions.find(e => e.epochId.toString() === selectedEpoch)
      if (selectedEpochData) {
        const minersInEpoch = new Set(selectedEpochData.minerHotkeys)
        options = options.filter(opt => minersInEpoch.has(opt.hotkey))
      }
    }

    // Filter by search query
    if (uidSearchQuery.trim()) {
      const query = uidSearchQuery.trim().toLowerCase()
      options = options.filter(opt =>
        opt.uid.toString().startsWith(query) ||
        opt.hotkey.toLowerCase().startsWith(query)
      )
      // Sort: exact UID match first, then by UID
      options = options.sort((a, b) => {
        const aExact = a.uid.toString() === query
        const bExact = b.uid.toString() === query
        if (aExact && !bExact) return -1
        if (!aExact && bExact) return 1
        return a.uid - b.uid
      })
    }

    return options
  }, [allUidOptions, allEpochOptions, selectedEpoch, uidSearchQuery])

  // Filtered Epoch options based on search AND selected miner
  const filteredEpochOptions = useMemo(() => {
    let options = allEpochOptions

    // Filter by selected miner (show only epochs with that miner)
    if (selectedUid !== 'all') {
      const selectedMiner = allUidOptions.find(m => m.uid.toString() === selectedUid)
      if (selectedMiner) {
        const epochsWithMiner = new Set(selectedMiner.epochIds)
        options = options.filter(opt => epochsWithMiner.has(opt.epochId))
      }
    }

    // Filter by search query
    if (epochSearchQuery.trim()) {
      const query = epochSearchQuery.trim()
      options = options.filter(opt => opt.epochId.toString().startsWith(query))
    }

    return options
  }, [allEpochOptions, allUidOptions, selectedUid, epochSearchQuery])

  // Search using API (server-side cache for speed)
  const handleSearch = async () => {
    // Need at least one filter
    if (selectedUid === 'all' && selectedEpoch === 'all' && !leadIdSearch.trim()) {
      return
    }

    setIsSearching(true)
    setHasSearched(true)
    setSelectedEmailHash(null)

    try {
      // Build query params
      const params = new URLSearchParams()
      if (selectedUid !== 'all') params.set('uid', selectedUid)
      if (selectedEpoch !== 'all') params.set('epoch', selectedEpoch)
      if (leadIdSearch.trim()) params.set('leadId', leadIdSearch.trim())
      params.set('limit', '50000') // Fetch up to 50k results for pagination

      console.log(`[Lead Search] Calling API: /api/lead-search?${params}`)

      const response = await fetch(`/api/lead-search?${params}`)
      if (!response.ok) {
        const errorData = await response.json()
        console.error('[Lead Search] API error:', errorData)
        setSearchResults([])
        return
      }

      const data = await response.json()
      console.log(`[Lead Search] API returned ${data.returned} of ${data.total} results`)

      // Transform to SearchResult format (API already returns the correct format)
      const results: SearchResult[] = data.results.map((r: SearchResult) => ({
        emailHash: r.emailHash,
        minerHotkey: r.minerHotkey,
        leadId: r.leadId,
        uid: r.uid,
        epochId: r.epochId,
        decision: r.decision,
        repScore: r.repScore,
        rejectionReason: r.rejectionReason,
        timestamp: r.timestamp,
      }))

      setSearchResults(results)
      setTotalResults(data.total || results.length)
      setCurrentPage(1) // Reset to first page on new search

      // Save to cache
      searchCache = {
        results,
        totalResults: data.total || results.length,
        filters: {
          uid: selectedUid,
          epoch: selectedEpoch,
          leadId: leadIdSearch.trim(),
        },
        currentPage: 1,
        timestamp: Date.now(),
      }
    } catch (err) {
      console.error('Search error:', err)
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }

  // Load journey events
  const handleSelectEmailHash = async (emailHash: string) => {
    setSelectedEmailHash(emailHash)
    setLoadingJourney(true)

    try {
      const events = await fetchLeadJourney(emailHash)
      const journeyEvents: JourneyEvent[] = events.map((e) => ({
        timestamp: e.ts,
        eventType: e.event_type,
        actor: e.actor_hotkey || null,
        leadId: e.payload?.lead_id || null,
        finalDecision: e.payload?.final_decision || null,
        finalRepScore: e.payload?.final_rep_score || null,
        rejectionReason: e.payload?.primary_rejection_reason
          ? cleanRejectionReason(e.payload.primary_rejection_reason)
          : null,
        teeSequence: e.tee_sequence,
      }))
      setJourneyEvents(journeyEvents)
    } catch (error) {
      console.error('Error fetching journey:', error)
      setJourneyEvents([])
    } finally {
      setLoadingJourney(false)
      // Scroll to journey section after loading completes
      setTimeout(() => {
        journeyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 150)
    }
  }

  // Get color for feedback based on rejection reason
  const getFeedbackColor = (reason: string): string => {
    const lowerReason = reason.toLowerCase()

    // Invalid/Bad email - Red
    if (lowerReason.includes('invalid') || lowerReason.includes('bad')) {
      return 'text-red-400'
    }
    // Duplicate - Yellow/Amber
    if (lowerReason.includes('duplicate')) {
      return 'text-amber-400'
    }
    // Domain issues (generic, free provider, disposable) - Orange
    if (lowerReason.includes('domain') || lowerReason.includes('provider') || lowerReason.includes('disposable')) {
      return 'text-orange-400'
    }
    // Role-based email - Purple
    if (lowerReason.includes('role')) {
      return 'text-purple-400'
    }
    // Score/Quality related - Cyan
    if (lowerReason.includes('score') || lowerReason.includes('quality') || lowerReason.includes('reputation')) {
      return 'text-cyan-400'
    }
    // Blacklisted - Pink/Fuchsia
    if (lowerReason.includes('blacklist') || lowerReason.includes('blocklist')) {
      return 'text-fuchsia-400'
    }
    // Default - Slate
    return 'text-slate-400'
  }

  const getEventIcon = (eventType: string, decision?: string | null) => {
    if (eventType === 'SUBMISSION_REQUEST') return <Send className="h-4 w-4" />
    if (eventType === 'STORAGE_PROOF') return <Database className="h-4 w-4" />
    if (eventType === 'SUBMISSION') return <FileText className="h-4 w-4" />
    if (eventType === 'CONSENSUS_RESULT') {
      if (decision === 'ACCEPTED') return <CheckCircle className="h-4 w-4 text-green-500" />
      if (decision === 'REJECTED') return <XCircle className="h-4 w-4 text-red-500" />
    }
    return <Clock className="h-4 w-4" />
  }

  // Download Lead Search CSV
  const downloadLeadSearchCSV = () => {
    if (sortedResults.length === 0) return

    const headers = ['UID', 'Lead ID', 'Email Hash', 'Epoch', 'Status', 'Score', 'Feedback', 'Timestamp']
    const rows = sortedResults.map(lead => [
      lead.uid ?? '',
      lead.leadId ?? '',
      lead.emailHash,
      lead.epochId ?? '',
      lead.decision,
      lead.repScore?.toFixed(4) ?? '',
      lead.rejectionReason ?? '',
      new Date(lead.timestamp).toISOString(),
    ])

    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `lead_search_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_auto] gap-4">
        {/* Custom Miner Dropdown */}
        <div ref={uidDropdownRef} className="relative">
          <label className="text-sm text-muted-foreground mb-2 block">
            Miner (UID or Hotkey)
          </label>
          <Button
            variant="outline"
            type="button"
            onClick={() => setUidDropdownOpen(!uidDropdownOpen)}
            className="w-full justify-between font-normal"
          >
            {selectedUid === 'all' ? 'All Miners' : `Miner ${selectedUid}`}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
          {uidDropdownOpen && (
            <div className="absolute z-50 mt-1 w-full sm:w-[500px] max-w-[95vw] bg-popover border rounded-md shadow-md">
              <div className="p-2 border-b">
                <Input
                  placeholder="Search by UID or Hotkey..."
                  value={uidSearchQuery}
                  onChange={(e) => setUidSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (uidSearchQuery.trim() && filteredUidOptions.length > 0) {
                        setSelectedUid(filteredUidOptions[0].uid.toString())
                      } else {
                        setSelectedUid('all')
                      }
                      setUidDropdownOpen(false)
                      setUidSearchQuery('')
                    }
                  }}
                  className="h-9"
                  autoFocus
                />
              </div>
              <div className="max-h-[300px] overflow-y-auto p-1">
                {!uidSearchQuery.trim() && (
                  <div
                    className={cn(
                      "relative flex cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                      selectedUid === 'all' && "bg-accent text-accent-foreground"
                    )}
                    onClick={() => {
                      setSelectedUid('all')
                      setUidDropdownOpen(false)
                      setUidSearchQuery('')
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", selectedUid === 'all' ? "opacity-100" : "opacity-0")} />
                    All Miners
                  </div>
                )}
                {filteredUidOptions.map((opt, idx) => (
                  <div
                    key={opt.uid}
                    className={cn(
                      "relative flex cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                      selectedUid === opt.uid.toString() && "bg-accent text-accent-foreground",
                      uidSearchQuery.trim() && idx === 0 && "bg-accent/50"
                    )}
                    onClick={() => {
                      setSelectedUid(opt.uid.toString())
                      setUidDropdownOpen(false)
                      setUidSearchQuery('')
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4 flex-shrink-0", selectedUid === opt.uid.toString() ? "opacity-100" : "opacity-0")} />
                    <span className="font-mono text-xs break-all">[{opt.uid}] {opt.hotkey}</span>
                  </div>
                ))}
                {filteredUidOptions.length === 0 && (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    No miner found.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Custom Epoch Dropdown */}
        <div ref={epochDropdownRef} className="relative">
          <label className="text-sm text-muted-foreground mb-2 block">
            Epoch
          </label>
          <Button
            variant="outline"
            type="button"
            onClick={() => setEpochDropdownOpen(!epochDropdownOpen)}
            className="w-full justify-between font-normal"
          >
            {selectedEpoch === 'all' ? 'All Epochs' : `Epoch ${selectedEpoch}`}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
          {epochDropdownOpen && (
            <div className="absolute z-50 mt-1 w-full bg-popover border rounded-md shadow-md">
              <div className="p-2 border-b">
                <Input
                  placeholder="Search epoch..."
                  value={epochSearchQuery}
                  onChange={(e) => setEpochSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (epochSearchQuery.trim() && filteredEpochOptions.length > 0) {
                        setSelectedEpoch(filteredEpochOptions[0].epochId.toString())
                      } else {
                        setSelectedEpoch('all')
                      }
                      setEpochDropdownOpen(false)
                      setEpochSearchQuery('')
                    }
                  }}
                  className="h-9"
                  autoFocus
                />
              </div>
              <div className="max-h-[300px] overflow-y-auto p-1">
                {!epochSearchQuery.trim() && (
                  <div
                    className={cn(
                      "relative flex cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                      selectedEpoch === 'all' && "bg-accent text-accent-foreground"
                    )}
                    onClick={() => {
                      setSelectedEpoch('all')
                      setEpochDropdownOpen(false)
                      setEpochSearchQuery('')
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", selectedEpoch === 'all' ? "opacity-100" : "opacity-0")} />
                    All Epochs
                  </div>
                )}
                {filteredEpochOptions.map((opt, idx) => (
                  <div
                    key={opt.epochId}
                    className={cn(
                      "relative flex cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                      selectedEpoch === opt.epochId.toString() && "bg-accent text-accent-foreground",
                      epochSearchQuery.trim() && idx === 0 && "bg-accent/50"
                    )}
                    onClick={() => {
                      setSelectedEpoch(opt.epochId.toString())
                      setEpochDropdownOpen(false)
                      setEpochSearchQuery('')
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", selectedEpoch === opt.epochId.toString() ? "opacity-100" : "opacity-0")} />
                    Epoch {opt.epochId}
                  </div>
                ))}
                {filteredEpochOptions.length === 0 && (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    No epoch found.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="text-sm text-muted-foreground mb-2 block">
            Lead ID
          </label>
          <Input
            placeholder="Enter Lead ID..."
            value={leadIdSearch}
            onChange={(e) => setLeadIdSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
        </div>

        <div className="flex items-end">
          <Button
            onClick={() => {
              if (selectedUid === 'all' && selectedEpoch === 'all' && !leadIdSearch.trim()) {
                loadLatestLeads()
              } else {
                handleSearch()
              }
            }}
            className="w-full"
            disabled={isSearching}
          >
            {isSearching ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Searching...
              </>
            ) : (
              <>
                <Search className="h-4 w-4 mr-2" />
                Search
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Results */}
      <div>
        {!isSearching && hasSearched && searchResults.length === 0 && (
          <div className="text-center p-8 text-muted-foreground">
            No results found
          </div>
        )}

        {!isSearching && searchResults.length > 0 && (
          <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground mb-4 flex items-center justify-between">
              <div>
                {selectedUid === 'all' && selectedEpoch === 'all' && !leadIdSearch.trim() ? (
                  <span>
                    Latest {searchResults.length} leads
                    <span className="ml-2 text-sky-400 text-xs">
                      Use filters for more specific results
                    </span>
                  </span>
                ) : (
                  <span>
                    Showing {startIndex + 1}-{Math.min(endIndex, searchResults.length)} of {searchResults.length} leads
                    {totalResults > searchResults.length && (
                      <span className="ml-1 text-yellow-500">
                        (fetched {searchResults.length} of {totalResults} total)
                      </span>
                    )}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={downloadLeadSearchCSV}
                  className="flex items-center gap-1 px-2 py-1 md:px-3 md:py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md"
                >
                  <Download className="h-3 w-3" />
                  CSV
                </button>
                <span className="text-sm">
                  Page {currentPage} of {totalPages}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto rounded-md border">
              <div className="max-h-[400px] md:max-h-[600px] overflow-y-auto">
                <Table className="min-w-[900px] w-full">
                <TableHeader className="sticky top-0 bg-slate-900 z-10">
                  <TableRow className="border-b bg-muted/50">
                    <TableHead className="w-16 font-semibold text-foreground">
                      <button
                        onClick={() => handleSort('uid')}
                        className="flex items-center gap-1 hover:text-primary transition-colors"
                      >
                        UID
                        {sortField === 'uid' ? (
                          sortOrder === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-50" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead className="font-semibold text-foreground">Lead ID</TableHead>
                    <TableHead className="font-semibold text-foreground">Email Hash</TableHead>
                    <TableHead className="w-20 font-semibold text-foreground">
                      <button
                        onClick={() => handleSort('epochId')}
                        className="flex items-center gap-1 hover:text-primary transition-colors"
                      >
                        Epoch
                        {sortField === 'epochId' ? (
                          sortOrder === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-50" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead className="w-24 font-semibold text-foreground">Status</TableHead>
                    <TableHead className="w-24 font-semibold text-foreground">
                      <button
                        onClick={() => handleSort('repScore')}
                        className="flex items-center gap-1 hover:text-primary transition-colors"
                      >
                        Score
                        {sortField === 'repScore' ? (
                          sortOrder === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-50" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead className="font-semibold text-foreground">Feedback</TableHead>
                    <TableHead className="w-40 font-semibold text-foreground">
                      <button
                        onClick={() => handleSort('timestamp')}
                        className="flex items-center gap-1 hover:text-primary transition-colors"
                      >
                        Timestamp
                        {sortField === 'timestamp' ? (
                          sortOrder === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-50" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead className="w-20 font-semibold text-foreground">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedResults.map((lead, idx) => (
                    <TableRow
                      key={`${lead.emailHash}-${startIndex + idx}`}
                      className="hover:bg-muted/50 transition-colors"
                    >
                      <TableCell className="font-mono text-sm font-medium">
                        {lead.uid != null ? (
                          <button
                            onClick={() => onUidClick?.(lead.uid!)}
                            className="text-cyan-500 hover:text-cyan-400 hover:underline cursor-pointer"
                          >
                            {lead.uid}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">N/A</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-300">
                        {lead.leadId ? (
                          <CopyableText text={lead.leadId} />
                        ) : (
                          <span className="text-muted-foreground">N/A</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-400">
                        <CopyableText text={lead.emailHash} />
                      </TableCell>
                      <TableCell className="font-medium">
                        {lead.epochId != null ? (
                          <button
                            onClick={() => onEpochClick?.(lead.epochId!)}
                            className="text-violet-400 hover:text-violet-300 hover:underline cursor-pointer"
                          >
                            {lead.epochId}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">N/A</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={cn(
                            "font-semibold",
                            lead.decision === 'ACCEPTED'
                              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                              : lead.decision === 'REJECTED'
                              ? "bg-red-500/20 text-red-400 border-red-500/30"
                              : "bg-slate-500/20 text-slate-400 border-slate-500/30"
                          )}
                          variant="outline"
                        >
                          {lead.decision}
                        </Badge>
                      </TableCell>
                      <TableCell className={cn(
                        "font-mono font-medium",
                        lead.repScore !== null && lead.repScore >= 0.8 ? "text-emerald-400" :
                        lead.repScore !== null && lead.repScore >= 0.5 ? "text-yellow-400" :
                        lead.repScore !== null ? "text-red-400" : "text-muted-foreground"
                      )}>
                        {lead.repScore?.toFixed(4) ?? '-'}
                      </TableCell>
                      <TableCell className="text-xs max-w-[150px] sm:max-w-[200px]">
                        {lead.rejectionReason ? (
                          <span className={cn(getFeedbackColor(lead.rejectionReason), "block truncate")} title={lead.rejectionReason}>
                            {lead.rejectionReason}
                          </span>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(lead.timestamp).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <button
                          onClick={() => handleSelectEmailHash(lead.emailHash)}
                          className="text-xs text-sky-400 hover:text-sky-300 hover:underline font-medium transition-colors"
                        >
                          Show
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                </Table>
              </div>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="gap-1"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Prev
                </Button>

                {/* Page Numbers */}
                <div className="flex items-center gap-1">
                  {/* First page */}
                  {currentPage > 3 && (
                    <>
                      <Button
                        variant={currentPage === 1 ? "default" : "outline"}
                        size="sm"
                        onClick={() => setCurrentPage(1)}
                        className="w-9"
                      >
                        1
                      </Button>
                      {currentPage > 4 && (
                        <span className="px-2 text-muted-foreground">...</span>
                      )}
                    </>
                  )}

                  {/* Page numbers around current */}
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum: number
                    if (totalPages <= 5) {
                      pageNum = i + 1
                    } else if (currentPage <= 3) {
                      pageNum = i + 1
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i
                    } else {
                      pageNum = currentPage - 2 + i
                    }

                    if (pageNum < 1 || pageNum > totalPages) return null
                    if (currentPage > 3 && pageNum === 1) return null
                    if (currentPage < totalPages - 2 && pageNum === totalPages) return null

                    return (
                      <Button
                        key={pageNum}
                        variant={currentPage === pageNum ? "default" : "outline"}
                        size="sm"
                        onClick={() => setCurrentPage(pageNum)}
                        className="w-9"
                      >
                        {pageNum}
                      </Button>
                    )
                  })}

                  {/* Last page */}
                  {currentPage < totalPages - 2 && totalPages > 5 && (
                    <>
                      {currentPage < totalPages - 3 && (
                        <span className="px-2 text-muted-foreground">...</span>
                      )}
                      <Button
                        variant={currentPage === totalPages ? "default" : "outline"}
                        size="sm"
                        onClick={() => setCurrentPage(totalPages)}
                        className="w-9"
                      >
                        {totalPages}
                      </Button>
                    </>
                  )}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="gap-1"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
        )}

        {/* Initial State */}
        {!hasSearched && !isSearching && (
          <div className="text-center p-8 text-muted-foreground">
            Loading latest leads...
          </div>
        )}
      </div>

      {/* Lead Journey Viewer */}
      {selectedEmailHash && (
        <div ref={journeyRef}>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center justify-between">
              <span>Lead Journey</span>
              <button
                onClick={() => setSelectedEmailHash(null)}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingJourney && (
              <p className="text-sm text-muted-foreground">Loading journey...</p>
            )}

            {!loadingJourney && journeyEvents.length > 0 && (
              <div className="space-y-3">
                {journeyEvents.map((event, idx) => (
                  <Card
                    key={idx}
                    className={cn(
                      event.eventType === 'SUBMISSION_REQUEST'
                        ? 'border-primary bg-primary/5'
                        : idx === journeyEvents.length - 1
                        ? 'border-primary'
                        : ''
                    )}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="mt-1">
                          {getEventIcon(event.eventType, event.finalDecision)}
                        </div>
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{formatEventType(event.eventType)}</span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(event.timestamp).toLocaleString()}
                            </span>
                          </div>
                          <div className="text-sm text-muted-foreground space-y-0.5">
                            <p className="break-all"><span className="font-medium">Actor:</span> <span className="font-mono text-xs">{event.actor || 'N/A'}</span></p>
                            <p className="break-all"><span className="font-medium">Lead ID:</span> <span className="font-mono text-xs">{event.leadId || 'N/A'}</span></p>
                            <p className="break-all"><span className="font-medium">Email Hash:</span> <span className="font-mono text-xs">{selectedEmailHash}</span></p>
                            {event.finalDecision && (
                              <p>Decision: {event.finalDecision}</p>
                            )}
                            {event.finalRepScore != null && (
                              <p>Score: {event.finalRepScore}</p>
                            )}
                            {event.rejectionReason && (
                              <p className="flex items-center gap-1">
                                <span>Feedback:</span>
                                <span
                                  className={getFeedbackColor(event.rejectionReason)}
                                  title={event.rejectionReason}
                                >
                                  {event.rejectionReason.length > 40
                                    ? event.rejectionReason.substring(0, 40) + '...'
                                    : event.rejectionReason}
                                </span>
                              </p>
                            )}
                            <p>TEE Sequence: {event.teeSequence || 'N/A'}</p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {!loadingJourney && journeyEvents.length === 0 && (
              <p className="text-sm text-muted-foreground">No journey events found</p>
            )}
          </CardContent>
        </Card>
        </div>
      )}
    </div>
  )
}
