/**
 * Public RPC endpoints for every Latch Protocol target chain.
 *
 * Every endpoint below was PROBED, not collected from a list. Each one answered
 * `eth_chainId` with the expected id, served `eth_blockNumber` three times, and was
 * timed by the median of those three. Endpoints that 404'd, 403'd, rate-limited,
 * returned the wrong chain, or failed to resolve were dropped rather than shipped as
 * dead fallbacks — a dead entry is worse than a short list, because a fallback
 * transport spends a retry on it before reaching a provider that works.
 *
 * Ordered fastest-first by measured latency, which is also the order a fallback
 * transport should try them in.
 *
 * SELECTION RULE, applied after the probe: fastest first, at most TWO endpoints per
 * operator, and the chain's own canonical endpoint always included where it was
 * reachable. Five is the target. Chains that carry fewer than five carry fewer
 * because fewer exist — see `THIN_ENDPOINT_CHAINS`; the list is never padded.
 *
 * Probed 2026-09-10. Public endpoints rot: re-run `scripts/probe-rpcs.mjs` before
 * relying on this in production, and expect some of these to have gone away.
 *
 * NONE of these carry an API key. Never add a credentialed URL to this file — it is
 * committed. Keyed providers belong in the environment; see `resolveEndpoints`.
 *
 * ---------------------------------------------------------------------------
 * NOT PRESENT, and why
 * ---------------------------------------------------------------------------
 *
 *   * Arc MAINNET (5042). It exists and it is live, but it has NO public RPC.
 *     Circle's own mainnet hosts (`rpc.mainnet.arc.io` and the drpc/quicknode/
 *     blockdaemon variants) resolve and answer 401/403, and thirdweb's
 *     `5042.rpc.thirdweb.com` answers `eth_chainId` out of a config table while
 *     failing every `eth_blockNumber` — alive to a chainId check, dead to a real
 *     request. Circle's docs still say "Mainnet endpoints and parameters are
 *     published separately when available." Arc TESTNET (5042002) is fully
 *     supported below. Do not add Arc mainnet from memory: probe it first.
 *
 *     PROBED AGAIN 2026-09-12 with a candidate supplied by the project owner,
 *     `https://rpc.arc-scan.org`. STILL NOT USABLE. DNS resolves and TCP
 *     connects in ~46ms, then the TLS handshake fails (curl exit 35, HTTP
 *     status 000); `https://arc-scan.org` itself behaves identically. A
 *     control request to a known-good host from the same machine returned
 *     200, so this is the endpoint rather than the network. Neither
 *     `eth_chainId` nor `eth_blockNumber` was answerable, so chain id 5042 is
 *     still UNCONFIRMED from here — it has never been read off a live node.
 *
 *     The rest of the owner's config is recorded so it is not lost, and
 *     because one field needs care when the chain does become reachable:
 *
 *         chainId 5042 · rpc https://rpc.arc-scan.org
 *         explorer https://arc-scan.org
 *         quoteIsGasToken true · nativeDecimals 18 · quoteDecimals 6
 *
 *     THE DECIMALS ARE CONTRADICTORY AND MUST BE SETTLED ON CHAIN FIRST.
 *     The owner's config says `quoteDecimals: 6`. Arc's own Connect RPC page,
 *     read from a browser that can reach it, says plainly:
 *
 *         Chain ID 5042      USDC - 18 decimals
 *
 *     USDC is 6 decimals everywhere else it exists, so 18 here is either a
 *     deliberate native-gas representation (a gas token has to be 18 to behave
 *     like ether in the EVM) sitting alongside a 6-decimal ERC-20 of the same
 *     name, or one of the two sources is wrong. Both readings are plausible
 *     and they differ by 10^12.
 *
 *     That is the same quantity that would have opened a USDG pool on
 *     Robinhood at a million times the intended price. `sqrtPriceX96` encodes
 *     the ratio in RAW units, so this is not a display concern — it is the
 *     opening price of a pool, fixed permanently at initialize.
 *
 *     Resolve it by reading `decimals()` off the actual token contract before
 *     any pool is priced, and record BOTH the gas-token and ERC-20 answers if
 *     they turn out to differ. Do not let a default of 18, or of 6, anywhere
 *     near an Arc tick.
 *
 *   * `rpc.xlayer.tech` (X Layer's own canonical endpoint) and roughly a dozen
 *     other hosts — `ethereum-rpc.publicnode.com`, `eth.llamarpc.com`,
 *     `rpc.mevblocker.io`, `sepolia.gateway.tenderly.co` among them. These fail
 *     the TLS handshake from the machine this probe ran on (schannel
 *     SEC_E_INVALID_TOKEN / OpenSSL "wrong version number", over both IPv4 and
 *     IPv6, with and without SNI), which is a local network filter rather than a
 *     statement about the endpoint. They are UNVERIFIED, not known-dead. Re-probe
 *     from unfiltered network before concluding anything about them, and if they
 *     work there they belong in this file.
 *
 *   * `*.gateway.tatum.io` — answers, but the free tier is FIVE requests per
 *     minute and `eth_call` is paid-only. It would 429 in normal use.
 */

export interface RpcEndpoint {
  readonly url: string
  /** Median of three eth_blockNumber round trips at probe time, in ms. Indicative only. */
  readonly latencyMs: number
  /**
   * Whether this endpoint could execute a TSTORE probe.
   * `null` means the endpoint blocks or rate-limits contract-creation `eth_call`, so
   * it could not be asked — which is NOT the same as the chain lacking EIP-1153.
   */
  readonly eip1153: boolean | null
}

export interface ChainRpcConfig {
  readonly chainId: number
  readonly name: string
  /** Whether the CHAIN supports EIP-1153, decided across endpoints, not from one. */
  readonly supportsEip1153: boolean
  readonly endpoints: readonly RpcEndpoint[]
}

export const CHAIN_RPCS = {
  ethereum: {
    chainId: 1,
    name: 'Ethereum',
    supportsEip1153: true,
    endpoints: [
      { url: 'https://eth.drpc.org', latencyMs: 47, eip1153: true },
      { url: 'https://1.rpc.thirdweb.com', latencyMs: 48, eip1153: true },
      { url: 'https://eth.rpc.blxrbdn.com', latencyMs: 82, eip1153: true },
      { url: 'https://rpc.flashbots.net', latencyMs: 96, eip1153: null },
      { url: 'https://gateway.tenderly.co/public/mainnet', latencyMs: 115, eip1153: true },
    ],
  },
  base: {
    chainId: 8453,
    name: 'Base',
    supportsEip1153: true,
    endpoints: [
      { url: 'https://8453.rpc.thirdweb.com', latencyMs: 43, eip1153: true },
      { url: 'https://base.drpc.org', latencyMs: 58, eip1153: true },
      { url: 'https://base.gateway.tenderly.co', latencyMs: 100, eip1153: true },
      { url: 'https://base-mainnet.public.blastapi.io', latencyMs: 119, eip1153: true },
      { url: 'https://mainnet.base.org', latencyMs: 138, eip1153: true },
    ],
  },
  bsc: {
    chainId: 56,
    name: 'BNB Smart Chain',
    supportsEip1153: true,
    endpoints: [
      { url: 'https://56.rpc.thirdweb.com', latencyMs: 55, eip1153: true },
      { url: 'https://bsc-dataseed1.ninicoin.io', latencyMs: 89, eip1153: true },
      { url: 'https://bsc-dataseed.bnbchain.org', latencyMs: 94, eip1153: true },
      { url: 'https://bsc-dataseed1.defibit.io', latencyMs: 98, eip1153: true },
      { url: 'https://bsc-rpc.publicnode.com', latencyMs: 112, eip1153: true },
    ],
  },
  /**
   * Linea — Consensys zkEVM L2.
   *
   * EIP-1153 answered true on all six probed endpoints. Caveat worth carrying:
   * on a zkEVM, `eth_call` is executed by the node's EVM, not by the prover, so a
   * successful TSTORE `eth_call` is strong evidence rather than proof that a
   * PROVEN transaction supports it. `script/BackendGuard.sol` is the authoritative
   * check, because it runs on chain at deploy time. Do not skip it here.
   */
  linea: {
    chainId: 59144,
    name: 'Linea',
    supportsEip1153: true,
    endpoints: [
      { url: 'https://linea.drpc.org', latencyMs: 56, eip1153: true },
      { url: 'https://59144.rpc.thirdweb.com', latencyMs: 120, eip1153: true },
      { url: 'https://linea-rpc.publicnode.com', latencyMs: 121, eip1153: true },
      { url: 'https://rpc.linea.build', latencyMs: 126, eip1153: true },
      { url: 'https://1rpc.io/linea', latencyMs: 132, eip1153: true },
    ],
  },
  /**
   * Robinhood Chain — Robinhood's own L2. Five probed endpoints, five operators.
   *
   * All five answered `eth_chainId` with 4663, served `eth_blockNumber`, and executed a
   * TSTORE probe, so EIP-1153 is confirmed per endpoint rather than inferred from one.
   * Ordered fastest-first by measured round trip; the canonical Robinhood endpoint is
   * included even though four others were quicker.
   *
   * Two candidates were REJECTED rather than padded in:
   *   `lb.routeme.sh/rpc/evm/4663`  returned no usable JSON-RPC response at all.
   *   `robinhood.drpc.org`          answers eth_chainId with the correct 4663 from a
   *                                 config table while rejecting eth_blockNumber and
   *                                 eth_call — alive to a chain-id check, dead to a real
   *                                 request. Listing it would spend a fallback attempt on
   *                                 a provider that cannot answer.
   * The two `wss://` endpoints are out of scope: the transports here are http.
   */
  robinhood: {
    chainId: 4663,
    name: 'Robinhood Chain',
    supportsEip1153: true,
    endpoints: [
      { url: 'https://rpc.nodeflare.app/robinhood/public', latencyMs: 545, eip1153: true },
      { url: 'https://robinhood.rpc.blxrbdn.com', latencyMs: 606, eip1153: true },
      { url: 'https://rpc-robinhood.blockmachine.io', latencyMs: 671, eip1153: true },
      { url: 'https://rpc.ordofi.network', latencyMs: 707, eip1153: true },
      { url: 'https://rpc.mainnet.chain.robinhood.com', latencyMs: 825, eip1153: true },
    ],
  },
  /** Ink — Kraken's OP-Stack L2. Two of the five are Ink's own gel/qnd nodes. */
  ink: {
    chainId: 57073,
    name: 'Ink',
    supportsEip1153: true,
    endpoints: [
      { url: 'https://ink.drpc.org', latencyMs: 47, eip1153: true },
      { url: 'https://rpc-qnd.inkonchain.com', latencyMs: 110, eip1153: true },
      { url: 'https://ink.gateway.tenderly.co', latencyMs: 143, eip1153: true },
      { url: 'https://rpc-gel.inkonchain.com', latencyMs: 182, eip1153: true },
      { url: 'https://57073.rpc.thirdweb.com', latencyMs: 214, eip1153: true },
    ],
  },
  /**
   * X Layer — OKX's Polygon-CDK zkEVM. FOUR endpoints, not five.
   *
   * X Layer's own canonical endpoint `rpc.xlayer.tech` could not be reached from
   * the probing machine (TLS handshake refused before any HTTP; see the header).
   * It is unverified rather than dead, and if it answers from your network it
   * should be added. `xlayerrpc.okx.com` is OKX-operated and does answer, so the
   * operator is represented either way.
   *
   * Same zkEVM caveat as Linea: TSTORE succeeded in `eth_call` on three
   * independent endpoints, which is not the same as a proven transaction.
   * `BackendGuard` decides at deploy time.
   */
  xlayer: {
    chainId: 196,
    name: 'X Layer',
    supportsEip1153: true,
    endpoints: [
      { url: 'https://xlayer.drpc.org', latencyMs: 63, eip1153: true },
      { url: 'https://xlayerrpc.okx.com', latencyMs: 167, eip1153: true },
      { url: 'https://196.rpc.thirdweb.com', latencyMs: 221, eip1153: true },
      { url: 'https://api.zan.top/xlayer-mainnet', latencyMs: 237, eip1153: null },
    ],
  },
  hyperevm: {
    chainId: 999,
    name: 'HyperEVM',
    supportsEip1153: true,
    endpoints: [
      { url: 'https://rpc.purroofgroup.com', latencyMs: 39, eip1153: true },
      { url: 'https://hyperliquid.drpc.org', latencyMs: 62, eip1153: true },
      { url: 'https://999.rpc.thirdweb.com', latencyMs: 105, eip1153: true },
      { url: 'https://rpc.hyperliquid.xyz/evm', latencyMs: 130, eip1153: true },
      { url: 'https://rpc.hypurrscan.io', latencyMs: 144, eip1153: true },
    ],
  },
  monad: {
    chainId: 143,
    name: 'Monad',
    supportsEip1153: true,
    endpoints: [
      { url: 'https://rpc.monad.xyz', latencyMs: 69, eip1153: true },
      { url: 'https://143.rpc.thirdweb.com', latencyMs: 69, eip1153: true },
      { url: 'https://rpc2.monad.xyz', latencyMs: 95, eip1153: true },
      { url: 'https://monad.gateway.tenderly.co', latencyMs: 112, eip1153: true },
      { url: 'https://api.zan.top/monad-mainnet', latencyMs: 233, eip1153: null },
    ],
  },
  /** Plasma — stablecoin-settlement L1. THREE endpoints; no fourth exists publicly. */
  plasma: {
    chainId: 9745,
    name: 'Plasma',
    supportsEip1153: true,
    endpoints: [
      { url: 'https://rpc.plasma.to', latencyMs: 99, eip1153: true },
      { url: 'https://plasma.gateway.tenderly.co', latencyMs: 115, eip1153: true },
      { url: 'https://9745.rpc.thirdweb.com', latencyMs: 116, eip1153: true },
    ],
  },
  /** Stable — stablecoin-gas L1. FOUR endpoints. */
  stable: {
    chainId: 988,
    name: 'Stable',
    supportsEip1153: true,
    endpoints: [
      { url: 'https://stable.drpc.org', latencyMs: 80, eip1153: true },
      { url: 'https://stable.gateway.tenderly.co', latencyMs: 97, eip1153: true },
      { url: 'https://rpc.stable.xyz', latencyMs: 234, eip1153: true },
      { url: 'https://988.rpc.thirdweb.com', latencyMs: 254, eip1153: true },
    ],
  },
  sepolia: {
    chainId: 11155111,
    name: 'Ethereum Sepolia',
    supportsEip1153: true,
    endpoints: [
      { url: 'https://11155111.rpc.thirdweb.com', latencyMs: 50, eip1153: true },
      { url: 'https://gateway.tenderly.co/public/sepolia', latencyMs: 110, eip1153: true },
      { url: 'https://ethereum-sepolia-rpc.publicnode.com', latencyMs: 124, eip1153: true },
      { url: 'https://1rpc.io/sepolia', latencyMs: 154, eip1153: true },
      { url: 'https://0xrpc.io/sep', latencyMs: 205, eip1153: true },
    ],
  },
  monadTestnet: {
    chainId: 10143,
    name: 'Monad Testnet',
    supportsEip1153: true,
    endpoints: [
      { url: 'https://10143.rpc.thirdweb.com', latencyMs: 53, eip1153: true },
      { url: 'https://monad-testnet.drpc.org', latencyMs: 85, eip1153: null },
      { url: 'https://testnet-rpc.monad.xyz', latencyMs: 97, eip1153: true },
      { url: 'https://monad-testnet.gateway.tenderly.co', latencyMs: 110, eip1153: true },
      { url: 'https://api.zan.top/monad-testnet', latencyMs: 247, eip1153: null },
    ],
  },
  /** Stable Testnet. THREE endpoints. */
  stableTestnet: {
    chainId: 2201,
    name: 'Stable Testnet',
    supportsEip1153: true,
    endpoints: [
      { url: 'https://stable-testnet.gateway.tenderly.co', latencyMs: 103, eip1153: true },
      { url: 'https://rpc.testnet.stable.xyz', latencyMs: 184, eip1153: true },
      { url: 'https://2201.rpc.thirdweb.com', latencyMs: 230, eip1153: true },
    ],
  },
  /**
   * Arc Testnet — Circle's USDC-gas L1, testnet.
   *
   * Nine hostnames answer, but they front only FIVE operators: Circle, dRPC,
   * QuickNode, Blockdaemon and thirdweb. Circle publishes each partner on both
   * `*.arc.io` (its docs) and `*.arc.network` (ethereum-lists), and dRPC answers
   * on `arc-testnet.drpc.org` as well. One hostname per operator is listed here,
   * because two names in front of one node is not failover — it is one outage
   * counted twice.
   */
  arcTestnet: {
    chainId: 5042002,
    name: 'Arc Testnet',
    supportsEip1153: true,
    endpoints: [
      { url: 'https://rpc.drpc.testnet.arc.io', latencyMs: 47, eip1153: true },
      { url: 'https://rpc.quicknode.testnet.arc.io', latencyMs: 48, eip1153: true },
      { url: 'https://5042002.rpc.thirdweb.com', latencyMs: 50, eip1153: true },
      { url: 'https://rpc.testnet.arc.io', latencyMs: 61, eip1153: true },
      { url: 'https://rpc.blockdaemon.testnet.arc.io', latencyMs: 172, eip1153: true },
    ],
  },
} as const satisfies Record<string, ChainRpcConfig>

export type ChainKey = keyof typeof CHAIN_RPCS

/**
 * Chains with only ONE verified public endpoint, where a fallback transport cannot
 * fail over at all.
 *
 * As of the 2026-09-10 probe this is EMPTY: every target chain has at least three
 * independent public endpoints. It was not empty before — Monad, Plasma, Stable,
 * Sepolia, Stable Testnet and Arc Testnet each had exactly one on 2026-09-09.
 *
 * Kept as an exported, empty list rather than deleted, because it is the assertion
 * a deploy check should make, and it will stop being empty the moment a chain is
 * added ahead of its provider ecosystem.
 */
export const SINGLE_ENDPOINT_CHAINS: readonly ChainKey[] = []

/**
 * Chains carrying FEWER than the five-endpoint target.
 *
 * These are not failures of the probe: no fifth public endpoint was found for them.
 * They still fail over, but with less headroom, and on a rate-limited day they will
 * degrade first. On these chains treat a paid or self-hosted node supplied through
 * `LATCH_RPC_<chainId>` as a requirement rather than an optimisation.
 */
export const THIN_ENDPOINT_CHAINS: readonly ChainKey[] = ['xlayer', 'plasma', 'stable', 'stableTestnet']

/** The number of public endpoints this file aims to carry per chain. */
export const ENDPOINT_TARGET = 5

const BY_ID = new Map<number, ChainRpcConfig>(
  Object.values(CHAIN_RPCS).map((c) => [c.chainId, c]),
)

export function chainById(chainId: number): ChainRpcConfig | undefined {
  return BY_ID.get(chainId)
}

/**
 * Ordered endpoint URLs for a chain, private providers first.
 *
 * A keyed provider is always preferable to a public one: public endpoints rate-limit,
 * lag, and disappear. Supply yours via env (`LATCH_RPC_<CHAINID>`, comma-separated for
 * several) and they are tried before the public list, which then acts as a safety net.
 *
 * @param chainId target chain
 * @param env process environment, injected so this stays testable and browser-safe
 */
export function resolveEndpoints(
  chainId: number,
  env: Record<string, string | undefined> = {},
): string[] {
  const priv = (env[`LATCH_RPC_${chainId}`] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const pub = chainById(chainId)?.endpoints.map((e) => e.url) ?? []

  // de-dupe while preserving order, private first
  return [...new Set([...priv, ...pub])]
}
