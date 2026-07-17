export const RUNTIME_SECRET_KEYS: readonly [
  'SUPABASE_SECRET_KEY',
  'OPENROUTER_KEY',
  'ADMIN_PASS',
  'ADMIN_USER',
  'ADMIN_SESSION_SECRET',
  'RESEARCH_LAB_ALERT_DISCORD_WEBHOOK_URL',
  'RESEARCH_LAB_IMPROVEMENT_DISCORD_WEBHOOK_URL',
]

export function loadRuntimeSecretValues(): Promise<
  Record<(typeof RUNTIME_SECRET_KEYS)[number], string>
>
