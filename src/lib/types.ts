// Dashboard data types

export interface MergedSubmission {
  timestamp: string
  leadId: string | null
  minerHotkey: string
  uid: number | null
  emailHash: string | null
  emailHashFull: string | null
  leadBlobHash: string | null
  teeSequence: number | null
  epochId: number | null
  finalDecision: 'ACCEPTED' | 'REJECTED' | 'PENDING'
  finalRepScore: number | null
  primaryRejectionReason: string | null
  validatorCount: number | null
}

export interface MinerEpochPerformance {
  epochId: number
  accepted: number
  rejected: number
  acceptanceRate: number
}

export interface MinerRejectionReason {
  reason: string
  count: number
  percentage: number
}

export interface MinerStats {
  uid: number | null
  minerHotkey: string
  minerShort: string
  total: number
  accepted: number
  rejected: number
  pending: number
  acceptanceRate: number
  avgRepScore: number
  btIncentive: number
  btEmission: number
  stake: number
  // Epoch-specific stats for leaderboard
  last20Accepted: number
  last20Rejected: number
  currentAccepted: number
  currentRejected: number
  // Per-miner detailed stats for MinerTracker
  epochPerformance: MinerEpochPerformance[]
  rejectionReasons: MinerRejectionReason[]
}

export interface EpochMinerStats {
  miner_hotkey: string
  total: number
  accepted: number
  rejected: number
  acceptance_rate: number
  avg_rep_score: number
}

export interface EpochStats {
  epochId: number
  total: number
  accepted: number
  rejected: number
  acceptanceRate: number
  avgRepScore: number
  miners: EpochMinerStats[]
}

export interface RejectionReason {
  reason: string
  count: number
  percentage: number
}

export interface LeadInventoryData {
  date: string
  totalValidInventory: number
  newValidLeads: number
}

export interface LeadInventoryCount {
  accepted: number
  rejected: number
  pending: number
}

export interface MetagraphData {
  hotkeyToUid: Record<string, number>
  uidToHotkey: Record<number, string>
  incentives: Record<string, number>
  emissions: Record<string, number>
  stakes: Record<string, number>
  isValidator: Record<string, boolean>
  totalNeurons: number
  error: string | null
}

export interface DashboardMetrics {
  total: number
  accepted: number
  rejected: number
  pending: number
  acceptanceRate: number
  avgRepScore: number
  activeMiners: number
}

export interface IncentiveData {
  minerShort: string
  minerHotkey: string
  uid: number | null
  acceptedLeads: number
  leadSharePct: number
  btIncentivePct: number
}

export type TimeFilterOption =
  | 'all'
  | '1h'
  | '6h'
  | '12h'
  | '24h'
  | '48h'
  | '72h'
  | '7d'

export const TIME_FILTER_HOURS: Record<TimeFilterOption, number> = {
  all: 0,
  '1h': 1,
  '6h': 6,
  '12h': 12,
  '24h': 24,
  '48h': 48,
  '72h': 72,
  '7d': 168,
}

export interface JourneyEvent {
  timestamp: string
  eventType: string
  actor: string | null
  leadId: string | null
  finalDecision: string | null
  finalRepScore: number | null
  rejectionReason: string | null
  teeSequence: number | null
}
