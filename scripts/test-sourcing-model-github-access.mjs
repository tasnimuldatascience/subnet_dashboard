import path from 'node:path'
import { pathToFileURL } from 'node:url'

const REPOSITORY = 'leadpoet/Sourcing_model'
const COMMIT_ENDPOINT = `https://api.github.com/repos/${REPOSITORY}/commits/main`

const appRoot = process.env.SUBNET_DASHBOARD_APP_ROOT?.trim() || process.cwd()
const secretLoaderUrl = pathToFileURL(path.join(appRoot, 'scripts/load-runtime-secret.mjs')).href
const { loadRuntimeSecretValues } = await import(secretLoaderUrl)

const values = await loadRuntimeSecretValues()
const token = values.SOURCING_MODEL_GITHUB_TOKEN
if (!token) throw new Error('SOURCING_MODEL_GITHUB_TOKEN is not configured.')

const response = await fetch(COMMIT_ENDPOINT, {
  headers: {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'Leadpoet-Sourcing-Model-Read-Test',
    'X-GitHub-Api-Version': '2022-11-28',
  },
})

let body = null
try {
  body = await response.json()
} catch {
  // Provider response bodies are intentionally not echoed by this smoke test.
}

if (!response.ok) {
  throw new Error(`GitHub sourcing-model read returned HTTP ${response.status}.`)
}
if (!body || typeof body !== 'object' || Array.isArray(body)) {
  throw new Error('GitHub returned an invalid commit document.')
}

const commitSha = typeof body.sha === 'string' && /^[0-9a-f]{40}$/i.test(body.sha)
  ? body.sha
  : null
if (!commitSha) throw new Error('GitHub commit response did not include a valid SHA.')

process.stdout.write(`${JSON.stringify({
  ok: true,
  repository: REPOSITORY,
  branch: 'main',
  commitSha: commitSha.slice(0, 12),
  changedFileCount: Array.isArray(body.files) ? body.files.length : null,
  tokenExposed: false,
})}\n`)
