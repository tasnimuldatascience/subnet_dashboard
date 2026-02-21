'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Overview,
  MinerTracker,
  EpochAnalysis,
  SubmissionTracker,
  ModelCompetition,
  FAQ,
} from '@/components/dashboard'
import type {
  MetagraphData,
} from '@/lib/types'
import type { AllDashboardData } from '@/lib/db-precalc'
import {
  LayoutDashboard,
  Pickaxe,
  Layers,
  Search,
  HelpCircle,
  Trophy,
} from 'lucide-react'

// Server handles background refresh every 5 minutes via instrumentation.ts
// Client polls every 5 minutes to stay in sync with server cache

// Tab display modes based on container width
type TabDisplayMode = 'icon' | 'short' | 'full'

// Helper function to calculate relative time on the client
function getRelativeTime(date: Date): string {
  const now = new Date()
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} minute${Math.floor(diff / 60) === 1 ? '' : 's'} ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} hour${Math.floor(diff / 3600) === 1 ? '' : 's'} ago`
  return `${Math.floor(diff / 86400)} day${Math.floor(diff / 86400) === 1 ? '' : 's'} ago`
}

// Dashboard data from API
interface DashboardData extends AllDashboardData {
  hours: number
  fetchedAt: number
  serverRefreshedAt?: string
  serverRelativeTime?: string
  buildVersion?: string
}

// Props received from Server Component
export interface DashboardClientProps {
  initialData: DashboardData
  metagraph: MetagraphData | null
}

export function DashboardClient({ initialData, metagraph: initialMetagraph }: DashboardClientProps) {
  // Dashboard data state (aggregated results only - no raw data!)
  const [dashboardData, setDashboardData] = useState<DashboardData>(initialData)
  const [metagraph, setMetagraph] = useState<MetagraphData | null>(initialMetagraph)

  // "Updated X minutes ago" - based on server's data refresh time
  const [relativeTime, setRelativeTime] = useState<string>(
    initialData.serverRelativeTime || 'just now'
  )

  // Track server timestamp in ref for interval access
  const serverTimestampRef = useRef<string | undefined>(initialData.serverRefreshedAt)

  // Update relative time every minute based on server refresh timestamp
  useEffect(() => {
    let timeoutId: number
    let mounted = true

    const tick = () => {
      if (!mounted) return

      if (serverTimestampRef.current) {
        setRelativeTime(getRelativeTime(new Date(serverTimestampRef.current)))
      }

      // Schedule next tick in 60 seconds
      timeoutId = window.setTimeout(tick, 60000)
    }

    // Start after 60 seconds
    timeoutId = window.setTimeout(tick, 60000)

    return () => {
      mounted = false
      window.clearTimeout(timeoutId)
    }
  }, [])

  const [selectedMinerHotkey, setSelectedMinerHotkey] = useState<string | null>(null)
  const [selectedEpochId, setSelectedEpochId] = useState<number | null>(null)

  const [activeTab, setActiveTab] = useState('overview')

  // Dynamic tab display based on whether content fits
  // Default to 'full' to prevent flash of icons-only on initial render
  const [tabDisplayMode, setTabDisplayMode] = useState<TabDisplayMode>('full')
  const tabsContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const checkFit = () => {
      // Mobile always shows icons only (no calculation needed)
      if (window.innerWidth < 640) {
        setTabDisplayMode('icon')
        return
      }

      const container = tabsContainerRef.current
      if (!container) return

      const containerWidth = container.offsetWidth

      // Thresholds for 6 tabs (desktop/tablet only)
      // Full text needs ~780px (Model Competition is longest)
      // Short words need ~480px
      if (containerWidth >= 780) {
        setTabDisplayMode('full')
      } else if (containerWidth >= 480) {
        setTabDisplayMode('short')
      } else {
        setTabDisplayMode('icon')
      }
    }

    // Initial check after mount
    checkFit()

    // Also check after a short delay (for layout to settle)
    const timeoutId = setTimeout(checkFit, 100)

    // Watch for resize
    const handleResize = () => checkFit()
    window.addEventListener('resize', handleResize)

    return () => {
      clearTimeout(timeoutId)
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  // Poll for fresh data every 5 minutes using recursive setTimeout
  useEffect(() => {
    console.log('[Dashboard] Starting polling useEffect')
    let timeoutId: number
    let mounted = true
    const initialBuildVersion = initialData.buildVersion

    const fetchData = async () => {
      if (!mounted) return

      console.log('[Dashboard] Polling for new data...')
      try {
        const cacheBuster = `?t=${Date.now()}`
        const [dashboardRes, metagraphRes] = await Promise.all([
          fetch(`/api/dashboard${cacheBuster}`),
          fetch(`/api/metagraph${cacheBuster}`)
        ])
        if (dashboardRes.ok && mounted) {
          const newData = await dashboardRes.json()

          // Check if server was redeployed - reload page to get new JS
          if (initialBuildVersion && newData.buildVersion &&
              newData.buildVersion !== initialBuildVersion) {
            window.location.reload()
            return
          }

          // Update dashboard data - this triggers re-render
          setDashboardData(newData)

          // Update server timestamp for "Updated X minutes ago"
          if (newData.serverRefreshedAt) {
            serverTimestampRef.current = newData.serverRefreshedAt
            setRelativeTime(getRelativeTime(new Date(newData.serverRefreshedAt)))
          }
        }
        if (metagraphRes.ok && mounted) {
          const newMetagraph = await metagraphRes.json()
          setMetagraph(newMetagraph)
        }
      } catch (error) {
        console.error('Auto-refresh failed:', error)
      }

      // Schedule next fetch in 1 minute (for testing)
      if (mounted) {
        timeoutId = window.setTimeout(fetchData, 60 * 1000)
      }
    }

    // Start first fetch after 1 minute (for testing)
    timeoutId = window.setTimeout(fetchData, 60 * 1000)
    console.log('[Dashboard] First poll scheduled in 60 seconds')

    return () => {
      mounted = false
      window.clearTimeout(timeoutId)
    }
  }, [initialData.buildVersion])

  // Handle navigation from SubmissionTracker to MinerTracker
  const handleUidClick = useCallback((uid: number) => {
    // Find the hotkey for this UID
    const hotkey = Object.entries(metagraph?.hotkeyToUid ?? {}).find(([, u]) => u === uid)?.[0]
    if (hotkey) {
      setSelectedMinerHotkey(hotkey)
      setActiveTab('miner-tracker')
    }
  }, [metagraph?.hotkeyToUid])

  // Handle navigation from SubmissionTracker to EpochAnalysis
  const handleEpochClick = useCallback((epochId: number) => {
    setSelectedEpochId(epochId)
    setActiveTab('epoch-analysis')
  }, [])


  // Transform DB types to UI types
  const metrics = {
    total: dashboardData.summary.total_submissions,
    accepted: dashboardData.summary.total_accepted,
    rejected: dashboardData.summary.total_rejected,
    pending: dashboardData.summary.total_pending,
    acceptanceRate: dashboardData.summary.acceptance_rate,
    avgRepScore: dashboardData.summary.avg_rep_score,
    activeMiners: dashboardData.summary.unique_miners,
  }

  // Transform miner stats with metagraph data
  const minerStats = dashboardData.minerStats.map(m => {
    const uid = metagraph?.hotkeyToUid[m.miner_hotkey] ?? null
    const btIncentive = metagraph?.incentives[m.miner_hotkey] ?? 0
    const btEmission = metagraph?.emissions[m.miner_hotkey] ?? 0
    const stake = metagraph?.stakes[m.miner_hotkey] ?? 0

    return {
      uid,
      minerHotkey: m.miner_hotkey,
      coldkey: m.coldkey || metagraph?.hotkeyToColdkey?.[m.miner_hotkey] || null,
      minerShort: m.miner_hotkey,
      total: m.total_submissions,
      accepted: m.accepted,
      rejected: m.rejected,
      pending: m.pending,
      acceptanceRate: m.acceptance_rate,
      avgRepScore: m.avg_rep_score,
      btIncentive: btIncentive * 100,
      btEmission,
      stake: Math.round(stake * 100) / 100,
      // Epoch-specific stats (pre-calculated)
      last20Accepted: m.last20_accepted,
      last20Rejected: m.last20_rejected,
      currentAccepted: m.current_accepted,
      currentRejected: m.current_rejected,
      // Per-miner detailed stats for MinerTracker
      epochPerformance: (m.epoch_performance || []).map(ep => ({
        epochId: ep.epoch_id,
        accepted: ep.accepted,
        rejected: ep.rejected,
        acceptanceRate: ep.acceptance_rate,
      })),
      rejectionReasons: (m.rejection_reasons || []).map(rr => ({
        reason: rr.reason,
        count: rr.count,
        percentage: rr.percentage,
      })),
    }
  }).filter(m => !metagraph || Object.keys(metagraph.hotkeyToUid).length === 0 || m.uid !== null) // Only filter by metagraph if data available

  // Epoch stats (already in correct format from db-precalc)
  const epochStats = dashboardData.epochStats

  // Transform lead inventory
  const inventoryData = dashboardData.leadInventory.map(l => ({
    date: l.date,
    totalValidInventory: l.cumulative_leads,
    newValidLeads: l.new_leads,
  }))

  // Weekly lead inventory (already in correct format from db-precalc)
  const weeklyInventoryData = dashboardData.weeklyLeadInventory || []

  // Transform rejection reasons
  const rejectionReasons = dashboardData.rejectionReasons

  // Get active miners from miner stats
  const activeMiners = minerStats.map(m => m.minerHotkey)

  // Get active miner count (miners with incentive > 0) directly from metagraph
  const activeMinerCount = metagraph
    ? Object.values(metagraph.incentives).filter(i => i > 0).length
    : 0

  // Handler for clicking on a miner hotkey in the leaderboard
  const handleMinerClick = (minerHotkey: string) => {
    setSelectedMinerHotkey(minerHotkey)
    setActiveTab('miner-tracker')
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Main Content */}
      <div className="max-w-[1500px] mx-auto px-5 py-4 md:py-6 overflow-auto">
        {/* Header */}
        <div className="mb-4 md:mb-6">
          <div className="flex items-start gap-2 md:gap-3">
            <a href="https://leadpoet.com" target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity mt-0.5">
              <img
                src="/icon-64.png"
                alt="Leadpoet Logo"
                width={32}
                height={32}
                className="rounded"
              />
            </a>
            <div>
              <h1 className="text-lg sm:text-xl md:text-2xl font-bold">
                Leadpoet Subnet Dashboard
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                <span>Updated {relativeTime}</span>
                <span className="hidden sm:inline">{' '}| <strong>{(dashboardData.totalSubmissionCount || metrics.total).toLocaleString()}</strong> total lead submissions</span>
              </p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4 md:space-y-6">
          <div ref={tabsContainerRef} className="w-full">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="overview" className="flex-1 gap-1.5">
              <LayoutDashboard className="h-4 w-4 shrink-0" />
              {tabDisplayMode !== 'icon' && (
                <span className="hidden sm:inline text-xs whitespace-nowrap">
                  {tabDisplayMode === 'full' ? 'Overview' : 'Overview'}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="miner-tracker" className="flex-1 gap-1.5">
              <Pickaxe className="h-4 w-4 shrink-0" />
              {tabDisplayMode !== 'icon' && (
                <span className="hidden sm:inline text-xs whitespace-nowrap">
                  {tabDisplayMode === 'full' ? 'Miner Tracker' : 'Miner'}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="epoch-analysis" className="flex-1 gap-1.5">
              <Layers className="h-4 w-4 shrink-0" />
              {tabDisplayMode !== 'icon' && (
                <span className="hidden sm:inline text-xs whitespace-nowrap">
                  {tabDisplayMode === 'full' ? 'Epoch Analysis' : 'Epoch'}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="submission-tracker" className="flex-1 gap-1.5">
              <Search className="h-4 w-4 shrink-0" />
              {tabDisplayMode !== 'icon' && (
                <span className="hidden sm:inline text-xs whitespace-nowrap">
                  {tabDisplayMode === 'full' ? 'Lead Search' : 'Search'}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="model-competition" className="flex-1 gap-1.5">
              <Trophy className="h-4 w-4 shrink-0" />
              {tabDisplayMode !== 'icon' && (
                <span className="hidden sm:inline text-xs whitespace-nowrap">
                  {tabDisplayMode === 'full' ? 'Model Competition' : 'Model'}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="faq" className="flex-1 gap-1.5">
              <HelpCircle className="h-4 w-4 shrink-0" />
              {tabDisplayMode !== 'icon' && (
                <span className="hidden sm:inline text-xs whitespace-nowrap">FAQ</span>
              )}
            </TabsTrigger>
          </TabsList>
          </div>

          <TabsContent value="overview" keepMounted>
            <Overview
              metrics={metrics}
              minerStats={minerStats}
              rejectionReasons={rejectionReasons}
              activeMinerCount={activeMinerCount}
              inventoryData={inventoryData}
              weeklyInventoryData={weeklyInventoryData}
              leadInventoryCount={dashboardData.leadInventoryCount}
              alphaPrice={metagraph?.alphaPrice ?? null}
              onMinerClick={handleMinerClick}
            />
          </TabsContent>

          <TabsContent value="miner-tracker" keepMounted>
            <MinerTracker
              minerStats={minerStats}
              activeMiners={activeMiners}
              metagraph={metagraph}
              externalSelectedMiner={selectedMinerHotkey}
              onMinerSelected={() => setSelectedMinerHotkey(null)}
            />
          </TabsContent>

          <TabsContent value="epoch-analysis" keepMounted>
            <EpochAnalysis
              epochStats={epochStats}
              metagraph={metagraph}
              onMinerClick={handleMinerClick}
              externalSelectedEpoch={selectedEpochId}
              onEpochSelected={() => setSelectedEpochId(null)}
            />
          </TabsContent>

          <TabsContent value="submission-tracker" keepMounted>
            <SubmissionTracker
              minerStats={minerStats}
              epochStats={epochStats}
              metagraph={metagraph}
              onUidClick={handleUidClick}
              onEpochClick={handleEpochClick}
            />
          </TabsContent>

          <TabsContent value="model-competition" keepMounted>
            <ModelCompetition />
          </TabsContent>

          <TabsContent value="faq" keepMounted>
            <FAQ />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
