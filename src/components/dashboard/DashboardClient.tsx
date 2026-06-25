'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Overview,
  MinerTracker,
  EpochAnalysis,
  SubmissionTracker,
  ModelCompetition,
  ResearchLab,
  FAQ,
} from '@/components/dashboard'
import { Fulfillment } from '@/components/dashboard/Fulfillment'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import type {
  MetagraphData,
} from '@/lib/types'
import type { AllDashboardData } from '@/lib/db-precalc'
import { cn } from '@/lib/utils'

// =================================================================
// Tab routing config
// =================================================================
type TabKey =
  | 'research-lab'
  | 'fulfillment'
  | 'model-competition'
  | 'overview'
  | 'miner-tracker'
  | 'epoch-analysis'
  | 'submission-tracker'
  | 'faq'
// Single source of truth for the public dashboard tabs. Legacy tab code stays
// in this file for now, but tabs not listed here cannot be opened from the UI
// or by an old ?tab=... URL.
const VISIBLE_TABS: readonly TabKey[] = ['research-lab', 'fulfillment', 'faq'] as const
const DEFAULT_TAB: TabKey = VISIBLE_TABS[0]

function isValidTab(value: string | null): value is TabKey {
  return Boolean(value && (VISIBLE_TABS as readonly string[]).includes(value))
}

// Dashboard data from API
interface DashboardData extends AllDashboardData {
  hours: number
  fetchedAt: number
  serverRefreshedAt?: string
  serverRelativeTime?: string
  buildVersion?: string
  qualificationMinerHotkeys?: string[]
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

  const [selectedMinerHotkey, setSelectedMinerHotkey] = useState<string | null>(null)
  const [selectedEpochId, setSelectedEpochId] = useState<number | null>(null)

  // -------------------------------------------------------------------
  // Tab routing. Keep tab state in memory so the public URL stays clean.
  // Older shared URLs with ?tab=... are honored once on mount, then cleaned.
  // -------------------------------------------------------------------
  const [activeTab, setActiveTab] = useState<TabKey>(DEFAULT_TAB)
  const [mountedTabs, setMountedTabs] = useState<Set<TabKey>>(() => new Set([DEFAULT_TAB]))

  const activateTab = useCallback((tab: TabKey) => {
    setMountedTabs((prev) => {
      if (prev.has(tab)) return prev
      const next = new Set(prev)
      next.add(tab)
      return next
    })
    setActiveTab(tab)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const tab = params.get('tab')
    if (isValidTab(tab)) activateTab(tab)

    if (params.has('tab')) {
      params.delete('tab')
      const query = params.toString()
      const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', next)
    }
  }, [activateTab])

  const handleTabChange = useCallback((value: string) => {
    if (!isValidTab(value)) return
    activateTab(value)
  }, [activateTab])

  // -------------------------------------------------------------------
  // Single, page-level "Synced X ago" indicator. Each tab calls
  // `handleSync()` after a successful fetch so the masthead reflects
  // the freshest data across whichever tab last polled. The brief pulse
  // animation gives a subtle live-data confirmation on every refresh.
  // -------------------------------------------------------------------
  const [lastSync, setLastSync] = useState<number | null>(null)
  const [syncPulse, setSyncPulse] = useState(false)
  const syncPulseTimerRef = useRef<number | null>(null)
  const handleSync = useCallback(() => {
    setLastSync(Date.now())
    setSyncPulse(true)
    if (syncPulseTimerRef.current) {
      window.clearTimeout(syncPulseTimerRef.current)
    }
    syncPulseTimerRef.current = window.setTimeout(() => setSyncPulse(false), 900)
  }, [])
  useEffect(() => {
    return () => {
      if (syncPulseTimerRef.current) window.clearTimeout(syncPulseTimerRef.current)
    }
  }, [])

  // -------------------------------------------------------------------
  // Polling: every 60s, paused when the tab isn't visible so we
  // don't burn battery or hammer the API when nobody's looking.
  // -------------------------------------------------------------------
  useEffect(() => {
    let timeoutId: number
    let mounted = true
    const initialBuildVersion = initialData.buildVersion

    const fetchData = async () => {
      if (!mounted) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        // Skip this tick; reschedule. Will resume next time we're visible.
        if (mounted) timeoutId = window.setTimeout(fetchData, 60 * 1000)
        return
      }

      try {
        const cacheBuster = `?t=${Date.now()}`
        const [dashboardRes, metagraphRes] = await Promise.all([
          fetch(`/api/dashboard${cacheBuster}`),
          fetch(`/api/metagraph${cacheBuster}`)
        ])
        if (dashboardRes.ok && mounted) {
          const newData = await dashboardRes.json()

          // Reload page to pick up new JS when the server has redeployed.
          if (initialBuildVersion && newData.buildVersion &&
              newData.buildVersion !== initialBuildVersion) {
            window.location.reload()
            return
          }

          setDashboardData(newData)

        }
        if (metagraphRes.ok && mounted) {
          const newMetagraph = await metagraphRes.json()
          setMetagraph(newMetagraph)
        }
      } catch (error) {
        // Silent. Surfaced by the stale "Updated X ago" timestamp. Logged
        // only to aid local debugging.
        if (process.env.NODE_ENV !== 'production') {
          console.error('Auto-refresh failed:', error)
        }
      }

      if (mounted) {
        timeoutId = window.setTimeout(fetchData, 60 * 1000)
      }
    }

    timeoutId = window.setTimeout(fetchData, 60 * 1000)

    return () => {
      mounted = false
      window.clearTimeout(timeoutId)
    }
  }, [initialData.buildVersion])

  // Refresh immediately when the tab becomes visible again after backgrounding.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      const fetchData = async () => {
        try {
          const cacheBuster = `?t=${Date.now()}`
          const [dashboardRes, metagraphRes] = await Promise.all([
            fetch(`/api/dashboard${cacheBuster}`),
            fetch(`/api/metagraph${cacheBuster}`)
          ])
          if (dashboardRes.ok) {
            const newData = await dashboardRes.json()
            setDashboardData(newData)
          }
          if (metagraphRes.ok) {
            const newMetagraph = await metagraphRes.json()
            setMetagraph(newMetagraph)
          }
        } catch {
          // Best-effort refresh; ignore.
        }
      }
      fetchData()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
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
        <header className="relative mb-6 md:mb-8 pb-4 md:pb-5 border-b border-[var(--surface-border)]">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-xl sm:text-2xl md:text-[26px] leading-none tracking-[-0.018em] text-[color:var(--text-primary)]">
              <span className="font-semibold">Leadpoet</span>
              <span className="ml-2 font-light text-[color:var(--text-secondary)]">Subnet Dashboard</span>
            </h1>
            <SyncedIndicator lastSync={lastSync} pulse={syncPulse} />
          </div>
        </header>

        {/* Tabs: gated by the public tab registry above. */}
        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4 md:space-y-6">
          <TabsList
            className={cn(
              'flex w-full overflow-x-auto bg-slate-900/40 border border-slate-800/70 backdrop-blur-sm h-auto p-1 gap-1'
            )}
          >
            {VISIBLE_TABS.includes('research-lab') && (
              <DashboardTabTrigger
                value="research-lab"
                label="Research Lab"
                shortLabel="Lab"
              />
            )}
            {VISIBLE_TABS.includes('fulfillment') && (
              <DashboardTabTrigger
                value="fulfillment"
                label="Fulfillment"
              />
            )}
            {VISIBLE_TABS.includes('model-competition') && (
              <DashboardTabTrigger
                value="model-competition"
                label="Model Competition"
                shortLabel="Model"
              />
            )}
            {/* Legacy tabs stay registered in code, but are not publicly visible. */}
            {VISIBLE_TABS.includes('overview') && (
              <DashboardTabTrigger
                value="overview"
                label="Overview"
              />
            )}
            {VISIBLE_TABS.includes('miner-tracker') && (
              <DashboardTabTrigger
                value="miner-tracker"
                label="Miner Tracker"
                shortLabel="Miner"
              />
            )}
            {VISIBLE_TABS.includes('epoch-analysis') && (
              <DashboardTabTrigger
                value="epoch-analysis"
                label="Epoch Analysis"
                shortLabel="Epoch"
              />
            )}
            {VISIBLE_TABS.includes('submission-tracker') && (
              <DashboardTabTrigger
                value="submission-tracker"
                label="Lead Search"
                shortLabel="Search"
              />
            )}
            {VISIBLE_TABS.includes('faq') && (
              <DashboardTabTrigger
                value="faq"
                label="FAQ"
              />
            )}
          </TabsList>

          {/* Launch tabs stay mounted so switching tabs does not flash loading states. */}
          {VISIBLE_TABS.includes('research-lab') && mountedTabs.has('research-lab') && (
            <TabsContent
              value="research-lab"
              keepMounted
              className="data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-300"
            >
              <ErrorBoundary label="ResearchLab">
                <ResearchLab onSync={handleSync} />
              </ErrorBoundary>
            </TabsContent>
          )}

          {VISIBLE_TABS.includes('fulfillment') && mountedTabs.has('fulfillment') && (
            <TabsContent
              value="fulfillment"
              keepMounted
              className="data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-300"
            >
              <ErrorBoundary label="Fulfillment">
                <Fulfillment onSync={handleSync} />
              </ErrorBoundary>
            </TabsContent>
          )}

          {VISIBLE_TABS.includes('model-competition') && mountedTabs.has('model-competition') && (
            <TabsContent
              value="model-competition"
              keepMounted
              className="data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-300"
            >
              <ErrorBoundary label="ModelCompetition">
                <ModelCompetition onSync={handleSync} />
              </ErrorBoundary>
            </TabsContent>
          )}

          {VISIBLE_TABS.includes('faq') && mountedTabs.has('faq') && (
            <TabsContent
              value="faq"
              keepMounted
              className="data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-300"
            >
              <ErrorBoundary label="FAQ">
                <FAQ />
              </ErrorBoundary>
            </TabsContent>
          )}

          {/* Legacy tabs: keepMounted is intentional here so the
              chart-heavy Overview / MinerTracker views don't lose state
              if they are re-enabled later. */}
          {VISIBLE_TABS.includes('overview') && (
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
                metagraph={metagraph}
                qualificationMinerHotkeys={dashboardData.qualificationMinerHotkeys || []}
              />
            </TabsContent>
          )}

          {VISIBLE_TABS.includes('miner-tracker') && (
            <TabsContent value="miner-tracker" keepMounted>
              <MinerTracker
                minerStats={minerStats}
                activeMiners={activeMiners}
                metagraph={metagraph}
                externalSelectedMiner={selectedMinerHotkey}
                onMinerSelected={() => setSelectedMinerHotkey(null)}
              />
            </TabsContent>
          )}

          {VISIBLE_TABS.includes('epoch-analysis') && (
            <TabsContent value="epoch-analysis" keepMounted>
              <EpochAnalysis
                epochStats={epochStats}
                metagraph={metagraph}
                onMinerClick={handleMinerClick}
                externalSelectedEpoch={selectedEpochId}
                onEpochSelected={() => setSelectedEpochId(null)}
              />
            </TabsContent>
          )}

          {VISIBLE_TABS.includes('submission-tracker') && (
            <TabsContent value="submission-tracker" keepMounted>
              <SubmissionTracker
                minerStats={minerStats}
                epochStats={epochStats}
                metagraph={metagraph}
                onUidClick={handleUidClick}
                onEpochClick={handleEpochClick}
              />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  )
}

/* ============================================================
 * DashboardTabTrigger. Styled to match the editorial palette.
 * Gold active indicator, warm-neutral resting state, accessible
 * focus ring. Replaces the default muted Radix styling.
 * ============================================================ */
function DashboardTabTrigger({
  value,
  label,
  shortLabel,
}: {
  value: string
  label: string
  shortLabel?: string
}) {
  return (
    <TabsTrigger
      value={value}
      className={cn(
        'flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-transparent',
        'h-10 px-2.5 text-xs font-medium whitespace-nowrap transition-all',
        // Resting state
        'text-slate-400 hover:text-slate-100 hover:bg-slate-800/40',
        // Focus: subtle neutral ring so it doesn't clash with the gold
        // active state (shift/tab focus used to render a gold-on-gold halo).
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-500/50',
        // Active state: gold accent
        'data-[state=active]:bg-slate-900/70 data-[state=active]:text-gold',
        'data-[state=active]:border-[rgba(201,169,110,0.30)]',
        'data-[state=active]:shadow-[0_0_0_1px_rgba(201,169,110,0.10)]'
      )}
    >
      <span className="inline md:hidden">{shortLabel ?? label}</span>
      <span className="hidden md:inline">{label}</span>
    </TabsTrigger>
  )
}

/* ============================================================
 * SyncedIndicator. Page-level "Synced X ago" pill, anchored to
 * the masthead top-right. Each tab calls the parent's onSync
 * after a successful fetch so this stays accurate across tabs.
 * ============================================================ */
function SyncedIndicator({
  lastSync,
  pulse,
}: {
  lastSync: number | null
  pulse: boolean
}) {
  // Re-render once a minute so the relative time stays accurate
  // without each tab having to push updates.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 60_000)
    return () => window.clearInterval(id)
  }, [])

  const label = formatRelativeShort(lastSync)
  return (
    <div
      className="flex items-center gap-1.5 sm:gap-2 text-[10px] font-mono text-slate-500 shrink-0"
      title="Auto-syncs every 60s"
    >
      <span
        className={cn(
          'inline-block w-1.5 h-1.5 rounded-full dot-gold',
          pulse ? 'live-pulse' : 'opacity-70'
        )}
        aria-hidden
      />
      <span>
        <span className="hidden sm:inline">Synced </span>
        <span className="text-slate-300">{label}</span>
      </span>
    </div>
  )
}

function formatRelativeShort(ts: number | null): string {
  if (ts === null) return '—'
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (diff < 30) return 'just now'
  if (diff < 60) return `${diff}s ago`
  const m = Math.floor(diff / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
