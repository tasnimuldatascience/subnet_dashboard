/**
 * OpenRouter client for Perplexity Sonar Deep Research.
 *
 * Single-shot HTTP call with an aggressive 180s timeout — Deep Research
 * typically completes in 30-90s but can run longer on very large lead
 * sets. Caller (worker.ts) handles state transitions and retries; this
 * module is intentionally stateless.
 *
 * Env vars (looked up in this order):
 *   OPENROUTER_API_KEY               (canonical name in this repo)
 *   FULFILLMENT_OPENROUTER_API_KEY   (matches the gateway env)
 *   OPENROUTER_KEY                   (legacy)
 *
 * IMPORTANT: this is a server-only module. It is imported exclusively
 * from API route handlers and the background sweep, both of which run
 * on the Node runtime. The API key never reaches the browser.
 */

export const LLM_MODEL = 'perplexity/sonar-deep-research'
export const LLM_TIMEOUT_MS = 180_000

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

function getApiKey(): string | null {
  return (
    process.env.OPENROUTER_API_KEY ||
    process.env.FULFILLMENT_OPENROUTER_API_KEY ||
    process.env.OPENROUTER_KEY ||
    null
  )
}

export interface OpenRouterResult {
  ok: boolean
  content?: string
  error?: string
}

/**
 * Single call to OpenRouter for the QA pass.
 *
 * Returns:
 *   { ok: true, content }   on success
 *   { ok: false, error }    on any failure (timeout, non-200, parse error)
 *
 * The caller logs ``error`` to deep_research_error so the dashboard
 * UI can surface it on the failed-state card.
 */
export async function callDeepResearch(prompt: string): Promise<OpenRouterResult> {
  const apiKey = getApiKey()
  if (!apiKey) {
    return {
      ok: false,
      error:
        'No OpenRouter API key set. Configure OPENROUTER_API_KEY (or ' +
        'FULFILLMENT_OPENROUTER_API_KEY) in the dashboard env.',
    }
  }

  // AbortController gives us a hard upper bound on the call duration
  // independent of any internal fetch defaults. Without this a hung
  // upstream connection could block the sweep loop indefinitely.
  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)

  let resp: Response
  try {
    resp = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://leadpoet.ai',
        'X-Title': 'LeadPoet Deep Research QA',
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          {
            role: 'system',
            content:
              'You are a strict QA analyst. Respond with ONLY a single ' +
              'valid JSON object matching the schema in the user message. ' +
              'No preamble, no markdown fences, no commentary outside the JSON.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        // Sonar Deep Research's research stage ignores temperature, but
        // the chat-completion wrapper accepts the field. Keep low so
        // verdicts stay stable across re-runs of the same chain.
        temperature: 0.2,
        max_tokens: 8000,
      }),
    })
  } catch (err) {
    clearTimeout(timeoutHandle)
    const aborted = err instanceof Error && err.name === 'AbortError'
    return {
      ok: false,
      error: aborted
        ? `Sonar Deep Research timed out after ${LLM_TIMEOUT_MS / 1000}s.`
        : `OpenRouter request failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
    }
  } finally {
    clearTimeout(timeoutHandle)
  }

  if (!resp.ok) {
    let bodyText = ''
    try {
      bodyText = await resp.text()
    } catch {
      // ignore
    }
    return {
      ok: false,
      error: `OpenRouter returned ${resp.status}: ${bodyText.slice(0, 500)}`,
    }
  }

  let json: unknown
  try {
    json = await resp.json()
  } catch (err) {
    return {
      ok: false,
      error: `Could not parse OpenRouter JSON envelope: ${
        err instanceof Error ? err.message : String(err)
      }`,
    }
  }

  // The envelope is OpenAI-shaped: { choices: [{ message: { content }}] }
  if (
    !json ||
    typeof json !== 'object' ||
    !('choices' in json) ||
    !Array.isArray((json as { choices: unknown }).choices)
  ) {
    return { ok: false, error: 'OpenRouter response missing choices array' }
  }
  const choices = (json as { choices: Array<{ message?: { content?: string } }> })
    .choices
  const content = choices[0]?.message?.content
  if (typeof content !== 'string' || content.length === 0) {
    return { ok: false, error: 'OpenRouter response had no message content' }
  }
  return { ok: true, content }
}
