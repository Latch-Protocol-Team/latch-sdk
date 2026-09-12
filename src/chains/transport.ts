import { fallback, http, type FallbackTransport, type HttpTransportConfig } from 'viem'
import {
  chainById,
  resolveEndpoints,
  SINGLE_ENDPOINT_CHAINS,
  THIN_ENDPOINT_CHAINS,
  ENDPOINT_TARGET,
  type ChainKey,
  CHAIN_RPCS,
} from './endpoints.js'

/**
 * Auto-failover RPC transport for Latch Protocol chains.
 *
 * Public endpoints rate-limit, lag and disappear — most of the candidates tried
 * during the probe were already 403ing, 429ing or gone. A single hardcoded URL is
 * therefore a liveness bug waiting to happen, and across fourteen chains it is a
 * certainty.
 *
 * `latchTransport` stacks every verified endpoint (private ones first, from env)
 * behind viem's `fallback`, which moves to the next transport when one errors.
 *
 * ---------------------------------------------------------------------------
 * The retry shape is chosen for RATE LIMITS specifically
 * ---------------------------------------------------------------------------
 *
 * A 429 is not a transient network blip: retrying the SAME endpoint that just
 * rate-limited you is the one thing guaranteed not to help, and each retry spends
 * wall-clock time before the request reaches a provider that would have answered.
 * So the per-endpoint retry count defaults to 0 and the retries live on the
 * `fallback` instead: one pass tries every provider in order, and only then does
 * the whole list get retried with backoff. With five endpoints that is five
 * different providers asked before the first one is asked twice.
 *
 * `rank` defaults to FALSE. viem's ranking re-measures every endpoint on an
 * interval, which means continuous background traffic to each provider — against
 * exactly the shared keyless gateways whose per-minute limits we are trying not to
 * exhaust. The probe-time order in `endpoints.ts` is measured, not guessed, and
 * `fallback` already routes around an endpoint that errors. Turn ranking on only
 * where every endpoint for the chain is a paid one supplied through the env.
 */

export interface LatchTransportOptions {
  /** Environment carrying `LATCH_RPC_<chainId>` overrides. Injected for testability. */
  env?: Record<string, string | undefined>
  /**
   * Re-rank endpoints by live latency and stability. Default FALSE — ranking costs
   * continuous background requests against rate-limited public endpoints.
   */
  rank?: boolean
  /**
   * Retries at the FALLBACK level: whole passes over the endpoint list. Default 2.
   */
  retryCount?: number
  /**
   * Retries against a SINGLE endpoint before falling through to the next. Default 0,
   * so a rate-limited provider is skipped rather than hammered.
   */
  perEndpointRetries?: number
  /** Per-request timeout in ms. Default 10_000. */
  timeout?: number
  /** Extra viem http() config applied to every endpoint. */
  httpConfig?: HttpTransportConfig
}

export class UnknownChainError extends Error {
  constructor(public readonly chainId: number) {
    super(
      `No RPC endpoints known for chain ${chainId}. Add it to CHAIN_RPCS after probing it, ` +
        `or pass one via LATCH_RPC_${chainId}.`,
    )
    this.name = 'UnknownChainError'
  }
}

/**
 * Build a failover transport for a chain id.
 *
 * @throws UnknownChainError when the chain is neither known nor supplied via env.
 * Failing loudly beats silently falling back to a default chain — a transport that
 * quietly points at the wrong network is how testnet calls end up on mainnet.
 */
export function latchTransport(
  chainId: number,
  opts: LatchTransportOptions = {},
): FallbackTransport {
  const {
    env = {},
    rank = false,
    retryCount = 2,
    perEndpointRetries = 0,
    timeout = 10_000,
    httpConfig,
  } = opts

  const urls = resolveEndpoints(chainId, env)
  if (urls.length === 0) throw new UnknownChainError(chainId)

  return fallback(
    urls.map((url) => http(url, { retryCount: perEndpointRetries, timeout, ...httpConfig })),
    { rank, retryCount },
  )
}

/** Same, by chain key, for call sites that know the chain at author time. */
export function latchTransportFor(
  key: ChainKey,
  opts: LatchTransportOptions = {},
): FallbackTransport {
  return latchTransport(CHAIN_RPCS[key].chainId, opts)
}

export interface RedundancyReport {
  readonly chainId: number
  readonly name: string
  readonly endpointCount: number
  /** True when only one endpoint is known, so failover is impossible. */
  readonly singlePointOfFailure: boolean
  /**
   * True when the chain carries fewer than `ENDPOINT_TARGET` endpoints. It can
   * still fail over, but it has less headroom and will degrade first under load.
   */
  readonly belowTarget: boolean
}

/**
 * How much failover each chain actually has.
 *
 * Call this at startup and surface the result rather than discovering it during an
 * incident. As of the 2026-09-10 probe nothing is a single point of failure any
 * more, but X Layer, Plasma, Stable and Stable Testnet are still below the
 * five-endpoint target — on those, a dedicated node supplied through
 * `LATCH_RPC_<chainId>` is a requirement rather than an optimisation.
 */
export function redundancyReport(env: Record<string, string | undefined> = {}): RedundancyReport[] {
  return Object.entries(CHAIN_RPCS).map(([key, cfg]) => {
    const count = resolveEndpoints(cfg.chainId, env).length
    return {
      chainId: cfg.chainId,
      name: cfg.name,
      endpointCount: count,
      singlePointOfFailure: count < 2 && SINGLE_ENDPOINT_CHAINS.includes(key as ChainKey),
      belowTarget: count < ENDPOINT_TARGET && THIN_ENDPOINT_CHAINS.includes(key as ChainKey),
    }
  })
}

/**
 * Assert a chain's build backend matches its EIP-1153 support.
 *
 * Mirrors `script/BackendGuard.sol` on the TypeScript side: deploying the transient
 * build to a chain without EIP-1153 produces contracts that revert on every lock.
 */
export function assertBackendMatchesChain(chainId: number, builtWithEip1153: boolean): void {
  const cfg = chainById(chainId)
  if (!cfg) throw new UnknownChainError(chainId)
  if (cfg.supportsEip1153 !== builtWithEip1153) {
    throw new Error(
      `Backend mismatch for ${cfg.name} (${chainId}): chain supportsEip1153=${cfg.supportsEip1153} ` +
        `but this build was compiled with eip1153=${builtWithEip1153}.`,
    )
  }
}
