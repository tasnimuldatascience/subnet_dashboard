'use client'

import { useState, useCallback, useEffect } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Overview,
  MinerTracker,
  EpochAnalysis,
  SubmissionTracker,
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
} from 'lucide-react'

// Server handles background refresh every 5 minutes via instrumentation.ts
// Client auto-refreshes data every 5 minutes and updates time display every minute

// Dashboard data from API
interface DashboardData extends AllDashboardData {
  hours: number
  fetchedAt: number
  serverRefreshedAt?: string
}

// Props received from Server Component
export interface DashboardClientProps {
  initialData: DashboardData
  metagraph: MetagraphData | null
}

// Helper function to calculate relative time string
function getRelativeTime(date: Date): string {
  const now = new Date()
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} minute${Math.floor(diff / 60) === 1 ? '' : 's'} ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} hour${Math.floor(diff / 3600) === 1 ? '' : 's'} ago`
  return `${Math.floor(diff / 86400)} day${Math.floor(diff / 86400) === 1 ? '' : 's'} ago`
}

export function DashboardClient({ initialData, metagraph: initialMetagraph }: DashboardClientProps) {
  // Dashboard data state (aggregated results only - no raw data!)
  const [dashboardData, setDashboardData] = useState<DashboardData>(initialData)
  const [metagraph, setMetagraph] = useState<MetagraphData | null>(initialMetagraph)

  // UI state - track both server and user refresh times
  const initialServerTime = dashboardData.serverRefreshedAt || dashboardData.updatedAt
  const [serverRefreshTime, setServerRefreshTime] = useState<Date>(new Date(initialServerTime))
  const [userRefreshTime, setUserRefreshTime] = useState<Date>(new Date())
  const [serverRelativeTime, setServerRelativeTime] = useState<string>(getRelativeTime(new Date(initialServerTime)))
  const [userRelativeTime, setUserRelativeTime] = useState<string>(getRelativeTime(new Date()))
  const [selectedMinerHotkey, setSelectedMinerHotkey] = useState<string | null>(null)
  const [selectedEpochId, setSelectedEpochId] = useState<number | null>(null)

  const [activeTab, setActiveTab] = useState('overview')

  // Update relative time displays every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setServerRelativeTime(getRelativeTime(serverRefreshTime))
      setUserRelativeTime(getRelativeTime(userRefreshTime))
    }, 60000) // Every 60 seconds
    return () => clearInterval(interval)
  }, [serverRefreshTime, userRefreshTime])

  // Auto-fetch new data every 5 minutes
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Add cache-busting timestamp to bypass browser HTTP cache
        const cacheBuster = `?t=${Date.now()}`
        const [dashboardRes, metagraphRes] = await Promise.all([
          fetch(`/api/dashboard${cacheBuster}`),
          fetch(`/api/metagraph${cacheBuster}`)
        ])
        if (dashboardRes.ok) {
          const newData = await dashboardRes.json()
          setDashboardData(newData)
          // Update server refresh time (when server cache was refreshed)
          const serverTime = new Date(newData.serverRefreshedAt || newData.updatedAt)
          setServerRefreshTime(serverTime)
          setServerRelativeTime(getRelativeTime(serverTime))
          // Update user refresh time (now)
          const userTime = new Date()
          setUserRefreshTime(userTime)
          setUserRelativeTime(getRelativeTime(userTime))
        }
        if (metagraphRes.ok) {
          const newMetagraph = await metagraphRes.json()
          setMetagraph(newMetagraph)
        }
      } catch (error) {
        console.error('Auto-refresh failed:', error)
      }
    }

    const interval = setInterval(fetchData, 5 * 60 * 1000) // Every 5 minutes
    return () => clearInterval(interval)
  }, [])

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
                alt="LeadPoet Logo"
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
                <span>Updated {serverRelativeTime}</span>
                <span className="hidden sm:inline">{' '}| <strong>{(dashboardData.totalSubmissionCount || metrics.total).toLocaleString()}</strong> total lead submissions</span>
              </p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4 md:space-y-6">
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <TabsList className="inline-flex w-auto min-w-full md:grid md:w-full md:grid-cols-5 gap-1">
              <TabsTrigger value="overview" className="gap-1 md:gap-2 px-2 md:px-4 text-xs md:text-sm whitespace-nowrap">
                <LayoutDashboard className="h-3 w-3 md:h-4 md:w-4" />
                <span className="hidden sm:inline">Overview</span>
                <span className="sm:hidden">Home</span>
              </TabsTrigger>
              <TabsTrigger value="miner-tracker" className="gap-1 md:gap-2 px-2 md:px-4 text-xs md:text-sm whitespace-nowrap">
                <Pickaxe className="h-3 w-3 md:h-4 md:w-4" />
                <span className="hidden sm:inline">Miner Tracker</span>
                <span className="sm:hidden">Miners</span>
              </TabsTrigger>
              <TabsTrigger value="epoch-analysis" className="gap-1 md:gap-2 px-2 md:px-4 text-xs md:text-sm whitespace-nowrap">
                <Layers className="h-3 w-3 md:h-4 md:w-4" />
                <span className="hidden sm:inline">Epoch Analysis</span>
                <span className="sm:hidden">Epochs</span>
              </TabsTrigger>
              <TabsTrigger value="submission-tracker" className="gap-1 md:gap-2 px-2 md:px-4 text-xs md:text-sm whitespace-nowrap">
                <Search className="h-3 w-3 md:h-4 md:w-4" />
                <span className="hidden sm:inline">Lead Search</span>
                <span className="sm:hidden">Search</span>
              </TabsTrigger>
              <TabsTrigger value="faq" className="gap-1 md:gap-2 px-2 md:px-4 text-xs md:text-sm whitespace-nowrap">
                <HelpCircle className="h-3 w-3 md:h-4 md:w-4" />
                <span className="hidden sm:inline">FAQ</span>
                <span className="sm:hidden">FAQ</span>
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

          <TabsContent value="faq" keepMounted>
            <FAQ />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
