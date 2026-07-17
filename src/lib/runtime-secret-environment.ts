const RUNTIME_SECRET_STORE_PROPERTY = '__leadpoetSubnetDashboardRuntimeSecretsV1'

type RuntimeSecretStore = Readonly<Record<string, string>>
type RuntimeSecretGlobal = typeof globalThis & {
  [RUNTIME_SECRET_STORE_PROPERTY]?: RuntimeSecretStore
}

function runtimeSecretStore(): RuntimeSecretStore | undefined {
  return (globalThis as RuntimeSecretGlobal)[RUNTIME_SECRET_STORE_PROPERTY]
}

export function installRuntimeSecretEnvironment(
  secrets: Readonly<Record<string, string>>,
): void {
  const installed = { ...secrets }
  Object.assign(process.env, installed)
  ;(globalThis as RuntimeSecretGlobal)[RUNTIME_SECRET_STORE_PROPERTY] = installed
}

/**
 * Next.js may restore its initial process.env snapshot while starting the
 * production server. The PM2 launcher therefore also keeps the validated AWS
 * secret document in this server-process-only global store. This accessor
 * merges that store over the current environment without exposing values to
 * client code or PM2 metadata.
 */
export function getRuntimeSecretEnvironment(
  base: Readonly<Record<string, string | undefined>> = process.env,
): Readonly<Record<string, string | undefined>> {
  const secrets = runtimeSecretStore()
  return secrets ? { ...base, ...secrets } : base
}

export function getRuntimeSecretValue(name: string): string | undefined {
  return runtimeSecretStore()?.[name] ?? process.env[name]
}
