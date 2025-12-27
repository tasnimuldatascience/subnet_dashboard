// Metagraph fetching utilities (with caching)
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import type { MetagraphData } from './types'

const execAsync = promisify(exec)

// Use global to persist metagraph cache across hot reloads
const globalForMetagraph = globalThis as unknown as {
  metagraphCache: { data: MetagraphData; timestamp: number } | null
}

if (!globalForMetagraph.metagraphCache) {
  globalForMetagraph.metagraphCache = null
}

const METAGRAPH_TTL = 12 * 60 * 1000 // 12 minutes

// Fetch metagraph from bittensor (slow - runs Python script)
async function fetchMetagraphFromBittensor(): Promise<MetagraphData> {
  console.log('[Metagraph] Fetching from bittensor...')
  const startTime = Date.now()
  const scriptPath = path.join(process.cwd(), 'scripts', 'fetch_metagraph.py')

  // Use PYTHON_PATH env var, or try common locations
  const pythonPath = process.env.PYTHON_PATH
    || (process.env.HOME + '/bittensor-venv/bin/python')  // AWS default
    || (process.env.HOME + '/anaconda3/bin/python3')       // Local fallback

  try {
    const { stdout, stderr } = await execAsync(
      `${pythonPath} ${scriptPath}`,
      {
        timeout: 120000,
        env: {
          ...process.env,
        }
      }
    )

    if (stderr) {
      console.error('Python stderr:', stderr)
    }

    console.log(`[Metagraph] Fetch completed in ${Date.now() - startTime}ms`)
    return JSON.parse(stdout)
  } catch (error) {
    console.error('Error fetching metagraph:', error)
    return {
      hotkeyToUid: {},
      uidToHotkey: {},
      incentives: {},
      emissions: {},
      stakes: {},
      isValidator: {},
      totalNeurons: 0,
      error: error instanceof Error ? error.message : 'Failed to fetch metagraph data'
    }
  }
}

// Cached metagraph fetch (handles 1000s of concurrent requests)
export async function fetchMetagraph(): Promise<MetagraphData> {
  const now = Date.now()

  // Return cached if available and fresh
  if (globalForMetagraph.metagraphCache && now - globalForMetagraph.metagraphCache.timestamp < METAGRAPH_TTL) {
    console.log('[Metagraph] Cache HIT')
    return globalForMetagraph.metagraphCache.data
  }

  // Fetch fresh data
  const data = await fetchMetagraphFromBittensor()
  globalForMetagraph.metagraphCache = { data, timestamp: now }
  return data
}
