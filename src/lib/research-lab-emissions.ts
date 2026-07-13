export type ResearchLabAllocationSource =
  | 'latest_weight_epoch'
  | 'latest_allocation_current'
  | 'latest_allocation_snapshot'
  | 'none'

export type ResearchLabEmissionAllocationEntry = {
  miner_hotkey?: string | null
  uid?: number | string | null
  paid_alpha_percent?: number | string | null
  intended_alpha_percent?: number | string | null
  overpaid_alpha_percent?: number | string | null
  spend_usd?: number | string | null
  reason?: string | null
  alpha_percent?: number | string | null
}

export type ResearchLabEmissionAllocationDoc = {
  lab_cap_alpha_percent?: number | string | null
  lab_cap_percent?: number | string | null
  reimbursement_allocations?: ResearchLabEmissionAllocationEntry[]
  champion_allocations?: ResearchLabEmissionAllocationEntry[]
  queued_champion_allocations?: ResearchLabEmissionAllocationEntry[]
}

export type ResearchLabEmissionAllocationSnapshot = {
  epoch?: number | string | null
  allocation_doc?: ResearchLabEmissionAllocationDoc | null
  created_at?: string | null
  lab_cap_alpha_percent?: number | string | null
}

export type ResearchLabMinerAllocationEntry = {
  paidAlphaPercent: number
  intendedAlphaPercent: number
  overpaidAlphaPercent: number
  spendUsd: number
  labBucketSharePercent: number
  allocationCount: number
  reasons: string[]
}

export type ResearchLabEmissionAllocationRollup = {
  epoch: number | null
  source: ResearchLabAllocationSource
  labCapAlphaPercent: number | null
  byHotkey: Record<string, ResearchLabMinerAllocationEntry>
}

export type FulfillmentRewardRow = {
  miner_hotkey?: string | null
  reward_pct?: number | string | null
}

export type FulfillmentRewardEntry = {
  directAlphaPercent: number
  leaderboardAlphaPercent: number
  totalAlphaPercent: number
  rewardCount: number
}

export type FulfillmentRewardRollup = {
  epoch: number
  fulfillmentPoolAlphaPercent: number
  directAlphaPercent: number
  leaderboardAlphaPercent: number
  totalAlphaPercent: number
  byHotkey: Record<string, FulfillmentRewardEntry>
}

const FULFILLMENT_LEADERBOARD_ALPHA_PERCENTS = [5, 3, 1.5] as const

export function researchLabAllocationEntries(
  doc: ResearchLabEmissionAllocationDoc | null | undefined,
): ResearchLabEmissionAllocationEntry[] {
  if (!doc) return []
  return [
    ...(Array.isArray(doc.reimbursement_allocations) ? doc.reimbursement_allocations : []),
    ...(Array.isArray(doc.champion_allocations) ? doc.champion_allocations : []),
    ...(Array.isArray(doc.queued_champion_allocations) ? doc.queued_champion_allocations : []),
  ]
}

export function buildResearchLabAllocationRollup(
  snapshot: ResearchLabEmissionAllocationSnapshot | null | undefined,
  source: ResearchLabAllocationSource,
): ResearchLabEmissionAllocationRollup {
  const doc = snapshot?.allocation_doc ?? null
  const labCapAlphaPercent = nullableNumber(
    doc?.lab_cap_alpha_percent ?? doc?.lab_cap_percent ?? snapshot?.lab_cap_alpha_percent
  )
  const byHotkey: Record<string, ResearchLabMinerAllocationEntry> = {}

  for (const allocation of researchLabAllocationEntries(doc)) {
    const hotkey = allocation.miner_hotkey ? String(allocation.miner_hotkey) : ''
    if (!hotkey) continue

    const current = byHotkey[hotkey] ?? {
      paidAlphaPercent: 0,
      intendedAlphaPercent: 0,
      overpaidAlphaPercent: 0,
      spendUsd: 0,
      labBucketSharePercent: 0,
      allocationCount: 0,
      reasons: [],
    }
    current.paidAlphaPercent += numberOrZero(allocation.paid_alpha_percent ?? allocation.alpha_percent)
    current.intendedAlphaPercent += numberOrZero(allocation.intended_alpha_percent)
    current.overpaidAlphaPercent += numberOrZero(allocation.overpaid_alpha_percent)
    current.spendUsd += numberOrZero(allocation.spend_usd)
    current.allocationCount += 1
    if (allocation.reason) current.reasons.push(String(allocation.reason))
    byHotkey[hotkey] = current
  }

  return {
    epoch: nullableNumber(snapshot?.epoch),
    source,
    labCapAlphaPercent,
    byHotkey: Object.fromEntries(
      Object.entries(byHotkey).map(([hotkey, entry]) => [
        hotkey,
        {
          ...entry,
          paidAlphaPercent: roundAllocation(entry.paidAlphaPercent),
          intendedAlphaPercent: roundAllocation(entry.intendedAlphaPercent),
          overpaidAlphaPercent: roundAllocation(entry.overpaidAlphaPercent),
          spendUsd: roundAllocation(entry.spendUsd),
          labBucketSharePercent: labCapAlphaPercent && labCapAlphaPercent > 0
            ? roundAllocation((entry.paidAlphaPercent / labCapAlphaPercent) * 100)
            : 0,
          reasons: Array.from(new Set(entry.reasons)),
        },
      ])
    ),
  }
}

export function formatLabAllocationPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%'
  return `${value.toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })}%`
}

export function buildFulfillmentRewardRollup({
  epoch,
  labCapAlphaPercent,
  rewards,
  leaderboardHotkeys,
}: {
  epoch: number
  labCapAlphaPercent: number
  rewards: FulfillmentRewardRow[]
  leaderboardHotkeys: string[]
}): FulfillmentRewardRollup {
  const leaderboardAlphaPercent = FULFILLMENT_LEADERBOARD_ALPHA_PERCENTS.reduce(
    (sum, value) => sum + value,
    0,
  )
  const fulfillmentPoolAlphaPercent = Math.max(
    0,
    100 - Math.max(0, labCapAlphaPercent) - leaderboardAlphaPercent,
  )
  const rawByHotkey = new Map<string, { share: number; rewardCount: number }>()

  for (const reward of rewards) {
    const hotkey = reward.miner_hotkey ? String(reward.miner_hotkey) : ''
    const share = Math.max(0, numberOrZero(reward.reward_pct))
    if (!hotkey || share <= 0) continue
    const current = rawByHotkey.get(hotkey) ?? { share: 0, rewardCount: 0 }
    current.share += share
    current.rewardCount += 1
    rawByHotkey.set(hotkey, current)
  }

  const rawTotalShare = Array.from(rawByHotkey.values()).reduce(
    (sum, entry) => sum + entry.share,
    0,
  )
  const fulfillmentPoolShare = fulfillmentPoolAlphaPercent / 100
  const directScale = rawTotalShare > fulfillmentPoolShare && rawTotalShare > 0
    ? fulfillmentPoolShare / rawTotalShare
    : 1
  const byHotkey: Record<string, FulfillmentRewardEntry> = {}

  for (const [hotkey, entry] of rawByHotkey) {
    byHotkey[hotkey] = {
      directAlphaPercent: entry.share * directScale * 100,
      leaderboardAlphaPercent: 0,
      totalAlphaPercent: entry.share * directScale * 100,
      rewardCount: entry.rewardCount,
    }
  }

  leaderboardHotkeys.slice(0, FULFILLMENT_LEADERBOARD_ALPHA_PERCENTS.length)
    .forEach((hotkey, index) => {
      if (!hotkey) return
      const current = byHotkey[hotkey] ?? {
        directAlphaPercent: 0,
        leaderboardAlphaPercent: 0,
        totalAlphaPercent: 0,
        rewardCount: 0,
      }
      current.leaderboardAlphaPercent += FULFILLMENT_LEADERBOARD_ALPHA_PERCENTS[index]
      current.totalAlphaPercent = current.directAlphaPercent + current.leaderboardAlphaPercent
      byHotkey[hotkey] = current
    })

  const roundedByHotkey = Object.fromEntries(
    Object.entries(byHotkey).map(([hotkey, entry]) => [
      hotkey,
      {
        ...entry,
        directAlphaPercent: roundAllocation(entry.directAlphaPercent),
        leaderboardAlphaPercent: roundAllocation(entry.leaderboardAlphaPercent),
        totalAlphaPercent: roundAllocation(entry.totalAlphaPercent),
      },
    ]),
  )
  const directAlphaPercent = Object.values(roundedByHotkey).reduce(
    (sum, entry) => sum + entry.directAlphaPercent,
    0,
  )
  const paidLeaderboardAlphaPercent = Object.values(roundedByHotkey).reduce(
    (sum, entry) => sum + entry.leaderboardAlphaPercent,
    0,
  )

  return {
    epoch,
    fulfillmentPoolAlphaPercent: roundAllocation(fulfillmentPoolAlphaPercent),
    directAlphaPercent: roundAllocation(directAlphaPercent),
    leaderboardAlphaPercent: roundAllocation(paidLeaderboardAlphaPercent),
    totalAlphaPercent: roundAllocation(directAlphaPercent + paidLeaderboardAlphaPercent),
    byHotkey: roundedByHotkey,
  }
}

export function committedLabAlphaPercent(
  metagraphIncentiveAlphaPercent: number,
  fulfillmentOwedAlphaPercent: number,
): number {
  return roundAllocation(Math.max(
    0,
    numberOrZero(metagraphIncentiveAlphaPercent) - numberOrZero(fulfillmentOwedAlphaPercent),
  ))
}

function nullableNumber(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function numberOrZero(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function roundAllocation(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
