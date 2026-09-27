import { HttpRequestError, TimeoutError, http, type HttpTransportConfig, type Transport } from 'viem'

/**
 * Endpoint COOLDOWN: an HTTP transport that stops asking an endpoint which just failed.
 *
 * WHY. `fallback` with `rank: false` restarts at endpoint 1 on EVERY request. When endpoint 1 is
 * rate-limiting (429), down (5xx) or unreachable, every read in the app pays one failed request to
 * it before reaching a provider that answers — and a page's burst of reads plus a block poller turns
 * one struggling gateway into a request storm against it, which only deepens the rate limit. Measured
 * on testnet.latches.fun's /app (2026-09-25): with the first Sepolia endpoint answering 429, every
 * request went to it first, doubling the page's traffic for as long as the tab stayed open; with every
 * endpoint down, the page kept sending ~15 requests per 10 s forever.
 *
 * WHAT IT DOES. A transport failure — an HTTP error the node sent (401/403/408/429/5xx), a request
 * that never got a response, or a timeout — puts that URL in COOLDOWN: for the next `baseMs` (then
 * doubling per consecutive failure, up to `maxMs`) the transport refuses immediately without touching
 * the network, so `fallback` moves straight on to the next endpoint. One success clears it. The state
 * is per URL and module-wide, so every client and transport in the page that names the same endpoint
 * shares what was learned.
 *
 * WHAT IT DOES NOT DO. An RPC-level answer — a revert, "block range too large", an unknown method —
 * is the node WORKING, and never cools an endpoint. When every endpoint is cooling down the request
 * fails fast with `EndpointCoolingDownError` (an `HttpRequestError`, so callers classify it as a
 * transport failure and show their honest "unreachable" state) instead of queueing retries; the next
 * attempt after the soonest cooldown expires probes again.
 */

export interface CooldownOptions {
  /** First cooldown after a failure. Default 15 s. */
  readonly baseMs?: number
  /** Ceiling for the doubling cooldown. Default 2 min. */
  readonly maxMs?: number
  /**
   * Whether a TIMEOUT cools the endpoint. Default true. Set false for a transport that runs
   * deliberately heavy requests (a whole-history `eth_getLogs`), where a slow answer is the request's
   * size and says nothing about the endpoint's health.
   */
  readonly coolOnTimeout?: boolean
}

interface Health {
  fails: number
  until: number
}

const health = new Map<string, Health>()

/** Refused locally because the endpoint is in cooldown. Nothing was sent. */
export class EndpointCoolingDownError extends HttpRequestError {
  override name = 'EndpointCoolingDownError' as 'HttpRequestError'
  readonly retryAt: number
  constructor(url: string, retryAt: number) {
    super({ url, details: `endpoint cooling down after failures; next attempt after ${new Date(retryAt).toISOString()}` })
    this.retryAt = retryAt
  }
}

/** Statuses that say the ENDPOINT is not serving us, as opposed to the request being wrong. */
function coolsOnStatus(status: number | undefined): boolean {
  return status === undefined || status === 401 || status === 403 || status === 408 || status === 429 || status >= 500
}

function isEndpointFailure(e: unknown, coolOnTimeout: boolean): boolean {
  if (e instanceof EndpointCoolingDownError) return false
  if (e instanceof TimeoutError) return coolOnTimeout
  if (e instanceof HttpRequestError) return coolsOnStatus(e.status)
  return false
}

/** The cooldown for `url` as of now: `null` when it may be asked. */
export function endpointCooldown(url: string, now = Date.now()): { readonly until: number; readonly fails: number } | null {
  const h = health.get(url)
  return h !== undefined && now < h.until ? { until: h.until, fails: h.fails } : null
}

/** Forget every endpoint's history (tests, or a manual "retry now"). */
export function resetEndpointCooldowns(): void {
  health.clear()
}

/** Record a failure against `url` and return the time it may be asked again. */
export function noteEndpointFailure(url: string, opts: CooldownOptions = {}, now = Date.now()): number {
  const base = opts.baseMs ?? 15_000
  const max = opts.maxMs ?? 120_000
  const h = health.get(url) ?? { fails: 0, until: 0 }
  /* Already cooling: a sibling request from the same burst failed first. One outage is one failure,
     not one per request in flight — escalating per request put a page's first burst of ~20 reads
     straight onto the 2-minute ceiling. */
  if (now < h.until) return h.until
  h.fails += 1
  h.until = now + Math.min(max, base * 2 ** (h.fails - 1))
  health.set(url, h)
  return h.until
}

/** viem `http(url)` with endpoint cooldown. Drop-in inside a `fallback([...])`. */
export function cooledHttp(url: string, config: HttpTransportConfig = {}, opts: CooldownOptions = {}): Transport {
  const inner = http(url, config)
  const coolOnTimeout = opts.coolOnTimeout ?? true
  return ((params: Parameters<typeof inner>[0]) => {
    const t = inner(params)
    const request = (async (args: unknown, options: unknown) => {
      const cooling = endpointCooldown(url)
      if (cooling !== null) throw new EndpointCoolingDownError(url, cooling.until)
      try {
        const out = await (t.request as (a: unknown, o: unknown) => Promise<unknown>)(args, options)
        health.delete(url)
        return out
      } catch (e) {
        if (isEndpointFailure(e, coolOnTimeout)) noteEndpointFailure(url, opts)
        throw e
      }
    }) as typeof t.request
    return { ...t, request }
  }) as Transport
}
