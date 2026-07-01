const TEMPORARY_RESEARCH_LAB_IMPROVEMENT_OVERRIDES: Record<string, number> = {
  // Temporary product override: backend currently reports this known improvement
  // as small_gain/below-threshold. Remove once the backend promotion gate emits
  // passed_threshold or a promotion pass event for the real record.
  '5G3vwvuuygd2xxKqdkDcg8H3ZdNdqscrQmkB5iEWMzzLiZDK': 1,
}

export function researchLabTemporaryImprovementOverride(hotkey: string | null | undefined): number {
  if (!hotkey) return 0
  return TEMPORARY_RESEARCH_LAB_IMPROVEMENT_OVERRIDES[hotkey] ?? 0
}

