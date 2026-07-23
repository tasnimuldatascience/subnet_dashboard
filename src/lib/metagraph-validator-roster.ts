import type { MetagraphData } from './types'

export const PRIMARY_VALIDATOR_UID = 0

type ValidatorRosterData = Pick<
  MetagraphData,
  'hotkeyToUid' | 'isValidator' | 'trusts' | 'consensus' | 'incentives'
>

export function isValidatorRosterMember(
  data: ValidatorRosterData,
  hotkey: string,
  uid: number,
): boolean {
  if (!data.isValidator[hotkey]) return false
  if (uid === PRIMARY_VALIDATOR_UID) return true

  const hasMinerActivity =
    (data.trusts[hotkey] ?? 0) > 0 ||
    (data.consensus[hotkey] ?? 0) > 0 ||
    (data.incentives[hotkey] ?? 0) > 0

  return !hasMinerActivity
}

export function validatorRosterUids(data: ValidatorRosterData): number[] {
  return Object.entries(data.hotkeyToUid)
    .filter(([hotkey, uid]) => isValidatorRosterMember(data, hotkey, uid))
    .map(([, uid]) => uid)
}
