export interface SubnetEpochState {
  currentBlock: number | null
  tempo: number | null
  lastEpochBlock: number | null
  pendingEpochAt: number | null
  blocksSinceLastStep: number | null
}

export interface SubnetEpochPosition {
  blocksElapsed: number
  nextEpochBlock: number
  blocksRemaining: number
}

export interface SubnetEpochSnapshot extends SubnetEpochPosition {
  schemaVersion: 'leadpoet.subnet_epoch_state.v1'
  headKind: 'best'
  netuid: number
  blockHash: string
  currentBlock: number
  tempo: number
  lastEpochBlock: number
  pendingEpochAt: number
  subnetEpochIndex: number
  blocksSinceLastStep: number
  observedAt: string
}

function isNonNegativeInteger(value: number | null): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

const SUBTENSOR_MAX_TEMPO = 50_400

/**
 * Returns the exact number of chain blocks until the subnet's next epoch slot.
 *
 * Modern Subtensor schedules the normal slot from LastEpochBlock + Tempo. A
 * pending owner-triggered slot can move that boundary earlier. All inputs must
 * come from the same on-chain state snapshot.
 */
export function deriveSubnetEpochPosition(state: SubnetEpochState): SubnetEpochPosition | null {
  const { currentBlock, tempo, lastEpochBlock, pendingEpochAt, blocksSinceLastStep } = state
  if (
    !isNonNegativeInteger(currentBlock) ||
    !isNonNegativeInteger(tempo) ||
    tempo === 0 ||
    !isNonNegativeInteger(lastEpochBlock) ||
    !isNonNegativeInteger(blocksSinceLastStep) ||
    currentBlock < lastEpochBlock
  ) {
    return null
  }

  const normalEpochBlock = lastEpochBlock + tempo
  if (!Number.isSafeInteger(normalEpochBlock)) return null

  // Subtensor treats every non-zero PendingEpochAt at or before the current
  // block as due. Do not add a LastEpochBlock comparison that the runtime does
  // not make.
  const manualEpochBlock = isNonNegativeInteger(pendingEpochAt) && pendingEpochAt > 0
    ? pendingEpochAt
    : null
  const scheduledEpochBlock = manualEpochBlock === null
    ? normalEpochBlock
    : Math.min(normalEpochBlock, manualEpochBlock)
  // BlocksSinceLastStep is the post-block value. Subtensor increments it before
  // checking the next block, so 50,400 fires on the next block and 50,399 in two.
  let nextEpochBlock = currentBlock
  if (blocksSinceLastStep <= SUBTENSOR_MAX_TEMPO) {
    const safetyEpochBlock = currentBlock + (SUBTENSOR_MAX_TEMPO + 1 - blocksSinceLastStep)
    if (!Number.isSafeInteger(safetyEpochBlock)) return null
    nextEpochBlock = Math.min(scheduledEpochBlock, safetyEpochBlock)
  }

  return {
    blocksElapsed: currentBlock - lastEpochBlock,
    nextEpochBlock,
    blocksRemaining: Math.max(0, nextEpochBlock - currentBlock),
  }
}

export function blocksUntilNextSubnetEpoch(state: SubnetEpochState): number | null {
  return deriveSubnetEpochPosition(state)?.blocksRemaining ?? null
}
