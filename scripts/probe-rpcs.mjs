// Probes candidate public RPC endpoints for every Latch target chain.
// Records only endpoints that actually answer AND report the right chainId,
// plus whether each supports EIP-1153 (TSTORE) so the backend choice stays verified.
//
// Run:  node scripts/probe-rpcs.mjs                     # every chain
//       node scripts/probe-rpcs.mjs linea ink xlayer    # only the named chains
//       PROBE_CONCURRENCY=3 node scripts/probe-rpcs.mjs # faster, less accurate
//
// Writes rpc-probe-results.json into the cwd. That file is an ARTEFACT, not a source
// of truth — `src/chains/endpoints.ts` is, and it is edited BY HAND from these
// results, so a bad probe run cannot silently rewrite the shipped list.
//
// NEVER add a credentialed URL to `candidates`. This file is committed.
import { writeFileSync } from 'node:fs'

const TSTORE = '0x600060005D60006000F3' // PUSH1 0, PUSH1 0, TSTORE, PUSH1 0, PUSH1 0, RETURN
const SSTORE = '0x600060005560006000F3' // same with SSTORE — valid on every EVM, the control

// A note on the shared multi-chain gateways that appear throughout the list below
// (`<chainId>.rpc.thirdweb.com`, `api.zan.top/<chain>`, `<chain>.gateway.tenderly.co`,
// `<chain>.drpc.org`, `1rpc.io/<chain>`): they are keyless, and they are genuinely
// independent operators, which is the whole point of a fallback list. They are also
// rate-limited per client, which is why probing is serial by default.
//
// Two things that answer but are deliberately kept OUT of the shipped list:
//   * `*.gateway.tatum.io` — free tier is 5 requests per MINUTE, and eth_call is
//     paid-only. An endpoint that 429s on the 4th call is worse than no endpoint:
//     a fallback transport burns its retry budget there before reaching a live one.
//   * `plasma.rpc.thirdweb.com` — thirdweb's NAMED alias for "plasma" answers
//     0x2612 (9746), not 9745. The numeric form `9745.rpc.thirdweb.com` is correct.
//     Named aliases are not trustworthy, which is why every candidate is chainId-checked.
const CHAINS = {
  ethereum: {
    id: 1,
    candidates: [
      'https://eth.drpc.org',
      'https://ethereum-rpc.publicnode.com',
      'https://rpc.flashbots.net',
      'https://eth.merkle.io',
      'https://1rpc.io/eth',
      'https://cloudflare-eth.com',
      'https://eth.llamarpc.com',
      'https://rpc.mevblocker.io',
      'https://ethereum.blockpi.network/v1/rpc/public',
      'https://rpc.payload.de',
      'https://eth.rpc.blxrbdn.com',
      'https://eth-mainnet.public.blastapi.io',
      'https://gateway.tenderly.co/public/mainnet',
      'https://endpoints.omniatech.io/v1/eth/mainnet/public',
      'https://eth.api.onfinality.io/public',
      'https://api.securerpc.com/v1',
      'https://eth.meowrpc.com',
      'https://1.rpc.thirdweb.com',
      'https://api.zan.top/eth-mainnet',
      'https://0xrpc.io/eth',
    ],
  },
  base: {
    id: 8453,
    candidates: [
      'https://mainnet.base.org',
      'https://base.drpc.org',
      'https://base-rpc.publicnode.com',
      'https://base.llamarpc.com',
      'https://1rpc.io/base',
      'https://base.meowrpc.com',
      'https://base.gateway.tenderly.co',
      'https://base.blockpi.network/v1/rpc/public',
      'https://base-mainnet.public.blastapi.io',
      'https://endpoints.omniatech.io/v1/base/mainnet/public',
      'https://base.api.onfinality.io/public',
      'https://8453.rpc.thirdweb.com',
      'https://api.zan.top/base-mainnet',
    ],
  },
  bsc: {
    id: 56,
    candidates: [
      'https://bsc-dataseed.bnbchain.org',
      'https://bsc-dataseed1.defibit.io',
      'https://bsc-rpc.publicnode.com',
      'https://bsc.drpc.org',
      'https://1rpc.io/bnb',
      'https://binance.llamarpc.com',
      'https://bsc-dataseed2.bnbchain.org',
      'https://bsc-dataseed3.bnbchain.org',
      'https://bsc-dataseed4.bnbchain.org',
      'https://bsc-dataseed1.ninicoin.io',
      'https://bsc.blockpi.network/v1/rpc/public',
      'https://bsc.meowrpc.com',
      'https://bsc-mainnet.public.blastapi.io',
      'https://56.rpc.thirdweb.com',
      'https://api.zan.top/bsc-mainnet',
    ],
  },
  linea: {
    id: 59144,
    candidates: [
      'https://rpc.linea.build',
      'https://linea-rpc.publicnode.com',
      'https://linea.drpc.org',
      'https://1rpc.io/linea',
      'https://linea.gateway.tenderly.co',
      'https://59144.rpc.thirdweb.com',
      'https://linea.blockpi.network/v1/rpc/public',
      'https://endpoints.omniatech.io/v1/linea/mainnet/public',
      'https://linea-mainnet.public.blastapi.io',
      'https://linea.decubate.com',
      'https://linea.api.onfinality.io/public',
    ],
  },
  ink: {
    id: 57073,
    candidates: [
      'https://rpc-gel.inkonchain.com',
      'https://rpc-qnd.inkonchain.com',
      'https://ink.drpc.org',
      'https://ink.gateway.tenderly.co',
      'https://57073.rpc.thirdweb.com',
      'https://ink-rpc.publicnode.com',
      'https://ink-mainnet.public.blastapi.io',
      'https://rpc.inkonchain.com',
      'https://ink.api.onfinality.io/public',
      'https://ink.blockpi.network/v1/rpc/public',
      'https://ink-json-rpc.stakely.io',
    ],
  },
  xlayer: {
    id: 196,
    candidates: [
      'https://rpc.xlayer.tech',
      'https://xlayerrpc.okx.com',
      'https://xlayer.drpc.org',
      'https://196.rpc.thirdweb.com',
      'https://api.zan.top/xlayer-mainnet',
      'https://endpoints.omniatech.io/v1/xlayer/mainnet/public',
      'https://xlayer-rpc.publicnode.com',
      'https://xlayer-mainnet.public.blastapi.io',
      'https://rpc.ankr.com/xlayer',
      'https://xlayer.blockpi.network/v1/rpc/public',
      'https://1rpc.io/xlayer',
      'https://xlayer.gateway.tenderly.co',
      'https://xlayer-json-rpc.stakely.io',
    ],
  },
  hyperevm: {
    id: 999,
    candidates: [
      'https://rpc.hyperliquid.xyz/evm',
      'https://rpc.hypurrscan.io',
      'https://hyperliquid.drpc.org',
      'https://rpc.hyperlend.finance',
      'https://hyperliquid-json-rpc.stakely.io',
      'https://rpc.purroofgroup.com',
      'https://1rpc.io/hyperliquid',
      'https://999.rpc.thirdweb.com',
      'https://api.zan.top/hyperliquid-mainnet',
      'https://hyperliquid.api.onfinality.io/public',
      'https://hyperliquid-rpc.publicnode.com',
    ],
  },
  monad: {
    id: 143,
    candidates: [
      'https://rpc.monad.xyz',
      'https://rpc1.monad.xyz',
      'https://rpc2.monad.xyz',
      'https://monad.drpc.org',
      'https://143.rpc.thirdweb.com',
      'https://monad.gateway.tenderly.co',
      'https://api.zan.top/monad-mainnet',
      'https://monad-rpc.publicnode.com',
      'https://monad-mainnet.public.blastapi.io',
      'https://monad.blockpi.network/v1/rpc/public',
      'https://rpc.ankr.com/monad',
      'https://1rpc.io/monad',
    ],
  },
  plasma: {
    id: 9745,
    candidates: [
      'https://rpc.plasma.to',
      'https://plasma.gateway.tenderly.co',
      'https://9745.rpc.thirdweb.com',
      'https://plasma.drpc.org',
      'https://plasma-rpc.publicnode.com',
      'https://plasma.blockpi.network/v1/rpc/public',
      'https://plasma-mainnet.public.blastapi.io',
      'https://plasma.api.onfinality.io/public',
      'https://plasma-json-rpc.stakely.io',
      'https://rpc.ankr.com/plasma',
    ],
  },
  stable: {
    id: 988,
    candidates: [
      'https://rpc.stable.xyz',
      'https://stable.drpc.org',
      'https://stable.gateway.tenderly.co',
      'https://988.rpc.thirdweb.com',
      'https://rpc.stablescan.xyz',
      'https://stable-rpc.publicnode.com',
    ],
  },
  // Arc MAINNET. Kept here so the next person does not have to rediscover that it has
  // NO public RPC: Circle's own mainnet hosts resolve but answer 401/403, and
  // thirdweb's `5042.rpc.thirdweb.com` answers eth_chainId out of its config table
  // while failing every eth_blockNumber — a dead endpoint that looks alive from a
  // chainId check alone. Arc mainnet is therefore absent from `src/chains/endpoints.ts`.
  arc: {
    id: 5042,
    candidates: [
      'https://rpc.arc.io',
      'https://rpc.mainnet.arc.io',
      'https://rpc.drpc.mainnet.arc.io',
      'https://rpc.quicknode.mainnet.arc.io',
      'https://rpc.blockdaemon.mainnet.arc.io',
      'https://arc.drpc.org',
      'https://arc-mainnet.drpc.org',
      'https://5042.rpc.thirdweb.com',
      'https://arc.gateway.tenderly.co',
      'https://rpc.arc.network',
      'https://rpc.mainnet.arc.network',
    ],
  },
  sepolia: {
    id: 11155111,
    candidates: [
      'https://ethereum-sepolia-rpc.publicnode.com',
      'https://11155111.rpc.thirdweb.com',
      'https://gateway.tenderly.co/public/sepolia',
      'https://1rpc.io/sepolia',
      'https://0xrpc.io/sep',
      'https://sepolia.drpc.org',
      'https://rpc.sepolia.org',
      'https://rpc2.sepolia.org',
      'https://eth-sepolia.public.blastapi.io',
      'https://sepolia.gateway.tenderly.co',
      'https://endpoints.omniatech.io/v1/eth/sepolia/public',
      'https://rpc-sepolia.rockx.com',
      'https://ethereum-sepolia.rpc.subquery.network/public',
      'https://sepolia.blockpi.network/v1/rpc/public',
      'https://eth-sepolia.api.onfinality.io/public',
      'https://sepolia.meowrpc.com',
    ],
  },
  monadTestnet: {
    id: 10143,
    candidates: [
      'https://testnet-rpc.monad.xyz',
      'https://10143.rpc.thirdweb.com',
      'https://monad-testnet.gateway.tenderly.co',
      'https://api.zan.top/monad-testnet',
      'https://monad-testnet.drpc.org',
      'https://monad-testnet-rpc.publicnode.com',
      'https://monad-testnet.blockpi.network/v1/rpc/public',
    ],
  },
  stableTestnet: {
    id: 2201,
    candidates: [
      'https://rpc.testnet.stable.xyz',
      'https://stable-testnet.gateway.tenderly.co',
      'https://2201.rpc.thirdweb.com',
      'https://stable-testnet.drpc.org',
      'https://rpc.testnet.stablescan.xyz',
    ],
  },
  // Arc testnet answers on TWO domains: `arc.io` (what Circle's docs publish) and
  // `arc.network` (what ethereum-lists carries). Both front the same five operators.
  // Probing both keeps that recorded; the shipped list takes ONE hostname per
  // operator, because two names in front of one node is not failover.
  arcTestnet: {
    id: 5042002,
    candidates: [
      'https://rpc.testnet.arc.io',
      'https://rpc.drpc.testnet.arc.io',
      'https://rpc.quicknode.testnet.arc.io',
      'https://rpc.blockdaemon.testnet.arc.io',
      'https://5042002.rpc.thirdweb.com',
      'https://arc-testnet.drpc.org',
      'https://rpc.testnet.arc.network',
      'https://rpc.quicknode.testnet.arc.network',
      'https://rpc.blockdaemon.testnet.arc.network',
    ],
  },
}

async function rpc(url, method, params, timeoutMs = 12000) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ac.signal,
    })
    if (!r.ok) return { err: `HTTP ${r.status}` }
    const j = await r.json()
    if (j.error) return { err: j.error.message ?? 'rpc error' }
    return { ok: j.result }
  } catch (e) {
    return { err: e.name === 'AbortError' ? 'timeout' : String(e.message ?? e) }
  } finally {
    clearTimeout(t)
  }
}

/**
 * Latency as the MEDIAN of three eth_blockNumber round trips, not one sample.
 * One sample against a public endpoint is mostly noise, and the ordering written
 * into endpoints.ts is only worth anything if the first entry is genuinely fastest.
 */
async function medianLatency(url, samples = 3) {
  const ms = []
  let block = 0
  for (let i = 0; i < samples; i++) {
    const t0 = Date.now()
    const r = await rpc(url, 'eth_blockNumber', [])
    if (r.err) return { err: r.err }
    ms.push(Date.now() - t0)
    block = Number(r.ok)
  }
  ms.sort((a, b) => a - b)
  return { ms: ms[Math.floor(ms.length / 2)], block }
}

/**
 * Errors that say something about the PROVIDER, not about the EVM.
 *
 * A rate-limited or plan-gated eth_call must resolve to `null` ("could not be
 * asked"), never to `false`. Collapsing those two is how a chain that DOES support
 * EIP-1153 gets recorded as one that does not — and `supportsEip1153` selects the
 * compiled transient-storage backend, so that mistake ships contracts that revert on
 * every lock. This guard exists because it already happened: rpc.hyperlend.finance
 * reported "false" for HyperEVM purely because the TSTORE call tripped its limit.
 */
const INFRA_ERROR =
  /rate.?limit|429|too many|upstream|timeout|unavailable|capacity|paid plan|not available|unauthoriz|api key|upgrade your|forbidden|internal error|try again/i

/**
 * TSTORE probe, guarded on BOTH sides by the SSTORE control.
 *
 * The control runs before and after. If the endpoint stopped answering in between —
 * usually the probe itself tripping a per-minute limit — the TSTORE failure carries
 * no information, and the answer is `null` rather than `false`.
 */
async function probeEip1153(url) {
  const before = await rpc(url, 'eth_call', [{ data: SSTORE }, 'latest'])
  if (before.err) return null

  const tst = await rpc(url, 'eth_call', [{ data: TSTORE }, 'latest'])
  if (!tst.err) return true
  if (INFRA_ERROR.test(tst.err)) return null

  const after = await rpc(url, 'eth_call', [{ data: SSTORE }, 'latest'])
  if (after.err) return null // the control went away with it — inconclusive
  return false
}

async function probeChain(name, id, candidates) {
  const working = []
  const failed = []
  for (const url of candidates) {
    const cid = await rpc(url, 'eth_chainId', [])
    if (cid.err) {
      failed.push({ url, reason: cid.err })
      console.log(`  ${name.padEnd(14)} ${url} -> ${cid.err}`)
      continue
    }
    const got = Number(cid.ok)
    if (got !== id) {
      failed.push({ url, reason: `wrong chain ${got}` })
      console.log(`  ${name.padEnd(14)} ${url} -> WRONG CHAIN ${got}`)
      continue
    }

    const lat = await medianLatency(url)
    if (lat.err) {
      failed.push({ url, reason: `no blockNumber (${lat.err})` })
      console.log(`  ${name.padEnd(14)} ${url} -> no blockNumber: ${lat.err}`)
      continue
    }

    const eip1153 = await probeEip1153(url)
    working.push({ url, latencyMs: lat.ms, block: lat.block, eip1153 })
    console.log(
      `  ${name.padEnd(14)} ${url} -> OK ${lat.ms}ms block ${lat.block} ` +
        `eip1153=${eip1153 ?? 'unprobeable'}`,
    )
  }
  working.sort((a, b) => a.latencyMs - b.latencyMs)
  return { chainId: id, endpoints: working, failed }
}

const only = process.argv.slice(2)
const selected = Object.entries(CHAINS).filter(([n]) => only.length === 0 || only.includes(n))

// Endpoints WITHIN a chain are always probed sequentially, so the latency numbers
// that decide the ordering are comparable. Chains may overlap, but the default is 1:
// several gateways above are rate-limited per client, so probing three chains at once
// makes the prober 429 itself and record a live endpoint as dead.
const CONCURRENCY = Number(process.env.PROBE_CONCURRENCY ?? 1)
const out = {}
const queue = [...selected]
await Promise.all(
  Array.from({ length: Math.max(1, Math.min(CONCURRENCY, queue.length)) }, async () => {
    for (;;) {
      const next = queue.shift()
      if (!next) return
      const [name, { id, candidates }] = next
      out[name] = await probeChain(name, id, candidates)
    }
  }),
)

// Declaration order in the artefact, regardless of completion order.
const ordered = {}
for (const [name] of selected) if (out[name]) ordered[name] = out[name]

writeFileSync('rpc-probe-results.json', JSON.stringify(ordered, null, 2))
console.log('\n=== SUMMARY ===')
for (const [n, v] of Object.entries(ordered)) {
  const votes = v.endpoints.map((e) => e.eip1153).filter((x) => x !== null)
  const verdict =
    votes.length === 0
      ? 'UNPROBEABLE'
      : votes.every(Boolean)
        ? 'yes'
        : votes.some(Boolean)
          ? 'MIXED — investigate before trusting'
          : 'no'
  console.log(
    `  ${n.padEnd(14)} ${String(v.endpoints.length).padStart(2)} working / ` +
      `${String(v.endpoints.length + v.failed.length).padStart(2)} tried   eip1153=${verdict}`,
  )
}
