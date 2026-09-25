// Probes candidate public RPC endpoints for every Latch target chain.
// Records only endpoints that actually answer, prove they are ON THE RIGHT CHAIN, and
// report whether they support EIP-1153 (TSTORE) so the backend choice stays verified.
//
// Run:  node scripts/probe-rpcs.mjs                     # every chain
//       node scripts/probe-rpcs.mjs linea ink xlayer    # only the named chains
//       PROBE_CONCURRENCY=3 node scripts/probe-rpcs.mjs # faster, less accurate
//
// Writes rpc-probe-results.json into the cwd. That file is an ARTEFACT, not a source
// of truth — `src/chains/endpoints.ts` is, and it is edited BY HAND from these
// results, so a bad probe run cannot silently rewrite the shipped list.
//
// Candidates are also hand-maintained. `scripts/harvest-rpcs.mjs` reads
// chainid.network/chains.json and PRINTS the ones we do not already carry; they are
// pasted into `candidates` below deliberately, for the same reason — a list nobody
// read is a list nobody can defend.
//
// NEVER add a credentialed URL to `candidates`. This file is committed.
//
// ---------------------------------------------------------------------------
// CHAIN ID IS NOT AN IDENTITY. Every candidate must also match a pinned GENESIS.
// ---------------------------------------------------------------------------
//
// Chain ids are not unique in practice, and the collision is not hypothetical:
// chainid.network lists **Wanchain Testnet at chain id 999**, which is also HyperEVM's
// id. Wanchain answers `eth_chainId` with 0x3e7 and serves `eth_blockNumber` happily,
// so a chainId-only check ACCEPTS a Wanchain node as a HyperEVM endpoint — and the
// SDK would then quote prices, read balances and simulate transactions against the
// wrong chain while every health check reported green.
//
// So identity is proven a second way, against `IDENTITY` below:
//
//   1. GENESIS PIN (primary). `eth_getBlockByNumber("0x0")` must return the pinned
//      hash. A genesis hash is unique per chain, immutable, and one cheap call.
//      A MISMATCH is an IMPOSTOR: rejected loudly, never silently dropped, because
//      the candidate looked healthy and that is exactly what makes it dangerous.
//
//   2. LIVE CROSS-CHECK (fallback). Several chains prune history — Stable (988) and
//      Stable Testnet (2201) serve no block older than roughly head-100k from ANY
//      endpoint, so they have no usable genesis pin at all, and some HyperEVM and
//      Monad endpoints refuse low blocks while serving the chain fine. For those, the
//      candidate is asked for the hash of a settled block (`CROSSCHECK_DEPTH` behind
//      the lower of the two heads) and it must match what a REFERENCE endpoint — one
//      already shipped in `src/chains/endpoints.ts`, named in `IDENTITY.reference` —
//      says about the same block number. Same verdicts: match, impostor, inconclusive.
//
// A candidate that fails BOTH inconclusively is recorded `unverified` and MUST NOT be
// shipped: "we could not tell which chain this is" is not a pass.
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

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
export const CHAINS = {
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
      // harvested from chains.json 2026-09-19
      'https://api.mycryptoapi.com/eth',
      'https://mainnet.gateway.tenderly.co',
      'https://rpc.blocknative.com/boost',
      'https://rpc.flashbots.net/fast',
      'https://rpc.mevblocker.io/fast',
      'https://rpc.mevblocker.io/noreverts',
      'https://rpc.mevblocker.io/fullprivacy',
      'https://xrpc.cl/eth',
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
      // harvested from chains.json 2026-09-19
      'https://developer-access-mainnet.base.org',
      'https://rpcfree.com/base-rpc',
      'https://rpc.baseazul.dev',
      'https://rpc.satelink.network/rpc/base',
      'https://xrpc.cl/base',
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
      // harvested from chains.json 2026-09-19
      'https://bsc-dataseed1.bnbchain.org',
      'https://bsc-dataseed2.defibit.io',
      'https://bsc-dataseed3.defibit.io',
      'https://bsc-dataseed4.defibit.io',
      'https://bsc-dataseed2.ninicoin.io',
      'https://bsc-dataseed3.ninicoin.io',
      'https://bsc-dataseed4.ninicoin.io',
      'https://bsc-rpc-public.chainpulse.cc',
      'https://xrpc.cl/bsc',
    ],
  },
  // Robinhood Chain — our primary chain, and until 2026-09-19 it had NO candidate list
  // here at all while carrying five endpoints in `src/chains/endpoints.ts`. The two
  // documented rejects are kept as candidates on purpose, so each run re-tests them:
  // `lb.routeme.sh` returned no usable JSON-RPC, and `robinhood.drpc.org` answered
  // eth_chainId out of a config table while refusing eth_blockNumber and eth_call.
  robinhood: {
    id: 4663,
    candidates: [
      'https://rpc.mainnet.chain.robinhood.com',
      'https://robinhood.rpc.blxrbdn.com',
      'https://rpc-robinhood.blockmachine.io',
      'https://rpc.ordofi.network',
      'https://rpc.nodeflare.app/robinhood/public',
      'https://robinhood.drpc.org',
      'https://lb.routeme.sh/rpc/evm/4663',
      // harvested from chains.json 2026-09-19
      'https://robinhood-rpc.publicnode.com',
      'https://rpc.arrowrpc.com',
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
  // HyperEVM. chain id 999 is SHARED with Wanchain Testnet, which is why the last
  // candidate below is here: it is a NEGATIVE CONTROL, not a candidate we hope works.
  // It is chainid.network's own entry for id 999, it answers `eth_chainId` with 0x3e7
  // and serves `eth_blockNumber`, and under a chainId-only check it PASSES. Leaving it
  // in means every run exercises the genesis check and prints the rejection, so if
  // anyone ever weakens that check the probe says so on the next run instead of
  // quietly accepting a Wanchain node as HyperEVM. Do not delete it because it fails.
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
      'https://gwan-ssl.wandevs.org:46891/', // NEGATIVE CONTROL — Wanchain Testnet, also id 999
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
      // harvested from chains.json 2026-09-19
      'https://rpc.beamrpc.com',
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
      // harvested from chains.json 2026-09-19. The same entry also carried a FILLED-IN
      // Alchemy key (`eth-sepolia.g.alchemy.com/v2/<key>`); the harvester rejects it and
      // it must never be pasted here — see harvest-rpcs.mjs.
      'https://rpc.sepolia.ethpandaops.io',
      'https://xrpc.cl/sepolia',
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

/**
 * Per-chain identity, beyond the chain id.
 *
 * `genesis` — the hash of block 0. PINNED HERE BY HAND, and every one of them was READ
 * OFF A LIVE NODE on 2026-09-19, never copied from a list or a block explorer: the
 * reader asked EVERY endpoint already shipped in `src/chains/endpoints.ts` for block 0
 * and every chain below came back UNANIMOUS across independent operators (the vote
 * count is recorded per line). `null` means no endpoint could serve block 0 — see
 * `reference`. Re-derive with `scripts/read-genesis.mjs` if you ever doubt one; do not
 * edit a hash to make a probe pass.
 *
 * `reference` — endpoints from the SHIPPED list, used for the live cross-check when
 * genesis is unavailable. They are peers we already trust, not authorities: if one and
 * the candidate disagree the run says so rather than picking a winner. TWO are listed
 * per chain because the candidate is often one of them (an endpoint cannot vouch for
 * itself) and because the first may be down.
 */
export const IDENTITY = {
  1: {
    genesis: '0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3', votes: 4,
    reference: ['https://eth.drpc.org', 'https://1.rpc.thirdweb.com'],
  },
  8453: {
    genesis: '0xf712aa9241cc24369b143cf6dce85f0902a9731e70d66818a3a5845b296c73dd', votes: 5,
    reference: ['https://mainnet.base.org', 'https://base.drpc.org'],
  },
  56: {
    genesis: '0x0d21840abff46b96c84b2ac9e10e4f5cdaeb5693cb665db62a2f3b02d2d57b5b', votes: 5,
    reference: ['https://bsc-dataseed.bnbchain.org', 'https://56.rpc.thirdweb.com'],
  },
  59144: {
    genesis: '0xb6762a65689107b2326364aefc18f94cda413209fab35c00d4af51eaa20ffbc6', votes: 4,
    reference: ['https://rpc.linea.build', 'https://linea.drpc.org'],
  },
  4663: {
    genesis: '0xaad15f3d702aaea00caf3e9bb56395efe9127bc3b31b24921abf1eee3409305c', votes: 4,
    reference: ['https://rpc.mainnet.chain.robinhood.com', 'https://robinhood.rpc.blxrbdn.com'],
  },
  57073: {
    genesis: '0x23a2658170ba70d014ba0d0d2709f8fbfe2fa660cd868c5f282f991eecbe38ee', votes: 4,
    reference: ['https://rpc-gel.inkonchain.com', 'https://ink.drpc.org'],
  },
  196: {
    genesis: '0x11f32f605beb94a1acb783cb3b6da6d7975461ce3addf441e7ad60c2ec95e88f', votes: 4,
    reference: ['https://xlayerrpc.okx.com', 'https://xlayer.drpc.org'],
  },
  // HyperEVM. Only 2 of 5 shipped endpoints serve block 0 — Hyperliquid's OWN canonical
  // node answers "invalid block height: 0" while serving block 1 — so most candidates
  // here are settled by the cross-check. This is the id Wanchain Testnet collides with.
  999: {
    genesis: '0xd8fcc13b6a195b88b7b2da3722ff6cad767b13a8c1e9ffb1c73aa9d216d895f0', votes: 2,
    reference: ['https://rpc.purroofgroup.com', 'https://hyperliquid.drpc.org'],
  },
  143: {
    genesis: '0x0c47353304f22b1c15706367d739b850cda80b5c87bbc335014fef3d88deaac9', votes: 3,
    reference: ['https://rpc.monad.xyz', 'https://143.rpc.thirdweb.com'],
  },
  9745: {
    genesis: '0x0d0ccca452bdb244100115e37de64ca640a255585d5a94df5610052a6dada558', votes: 2,
    reference: ['https://rpc.plasma.to', 'https://9745.rpc.thirdweb.com'],
  },
  // Stable and Stable Testnet: NO genesis pin is possible. Every shipped endpoint
  // returns null for block 0, and for blocks 1, 2, 10, 1_000, 100_000 and 1_000_000 as
  // well, while serving head-100_000 fine — they are pruned nodes with a moving floor,
  // so any fixed low block would rot out from under the pin. Identity on these two
  // chains rests entirely on the live cross-check.
  988: {
    genesis: null, votes: 0,
    reference: ['https://rpc.stable.xyz', 'https://stable.drpc.org'],
  },
  2201: {
    genesis: null, votes: 0,
    reference: ['https://rpc.testnet.stable.xyz', 'https://2201.rpc.thirdweb.com'],
  },
  11155111: {
    genesis: '0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9', votes: 3,
    reference: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://11155111.rpc.thirdweb.com'],
  },
  // Monad Testnet (10143) was REMOVED 2026-09-24 by owner decision. Its pin was genesis
  // 0x298034669ee44327d2da9744b9b2782848e2f2a6959756b7b0471b09a404f5c9 (2 votes), kept here
  // only so it need not be re-derived if the chain ever returns. Monad MAINNET (143) stays.
  5042002: {
    genesis: '0xe20e653af4441e8c6088e172b129d56420139824400477287b46e7101ae2bb1f', votes: 5,
    reference: ['https://rpc.testnet.arc.io', 'https://rpc.drpc.testnet.arc.io'],
  },
  // Arc MAINNET. Until 2026-09-19 this had no pin and no reference, because Arc
  // mainnet had no public RPC at all and every candidate came back `unverified` —
  // which was the honest answer, and is why nothing from chain 5042 was ever shipped
  // on the strength of a chainId check. That changed: on 2026-09-19 eight hosts
  // answered chain id 5042 at head ~21,746,650 and agreed UNANIMOUSLY on this genesis
  // (Circle's rpc.mainnet.arc.io and its drpc/quicknode/blockdaemon variants,
  // arc.drpc.org, arc-mainnet.drpc.org, 5042.rpc.thirdweb.com, rpc.beamrpc.com).
  // The chain is still absent from src/chains/endpoints.ts on purpose — see its
  // header. Pinning it here only means the probe can now tell truth from impostor.
  5042: {
    genesis: '0x09944e07412986bb417fd0006c89ffb71ee523d68ce2017ec2dabc944c42edad', votes: 8,
    reference: ['https://rpc.mainnet.arc.io', 'https://5042.rpc.thirdweb.com'],
  },
}

/**
 * How far behind the head the live cross-check reads.
 *
 * Deep enough that a reorg or a slightly lagging node cannot make two honest endpoints
 * disagree and get one of them branded an impostor; shallow enough that the pruned
 * nodes (Stable, zan.top) still hold it — they serve head-100_000, so 1_024 is safe on
 * both counts. It is measured from the LOWER of the two heads, so a lagging candidate
 * is compared on a block it actually has.
 */
const CROSSCHECK_DEPTH = 1024

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

async function blockHash(url, height) {
  const b = await rpc(url, 'eth_getBlockByNumber', ['0x' + height.toString(16), false])
  if (b.err) return { err: b.err }
  if (!b.ok || !b.ok.hash) return { err: 'no such block' } // a null result is a NON-ANSWER
  return { hash: b.ok.hash.toLowerCase() }
}

/**
 * Prove a candidate is on the chain it claims, beyond its chain id.
 *
 * Returns one of:
 *   { verdict: 'genesis'  }               block 0 matched the pin
 *   { verdict: 'crosscheck' }             a settled block matched the reference endpoint
 *   { verdict: 'impostor', ... }          a hash DIFFERED — a different chain wearing this id
 *   { verdict: 'unverified', ... }        nobody could answer; not a pass
 *
 * `candidateHead` is reused from the latency probe so this costs one or two calls.
 */
async function proveIdentity(url, id, candidateHead) {
  const pin = IDENTITY[id]
  if (!pin) return { verdict: 'unverified', how: `no IDENTITY entry for chain ${id}` }

  if (pin.genesis) {
    const g = await blockHash(url, 0)
    if (g.hash) {
      if (g.hash === pin.genesis.toLowerCase()) return { verdict: 'genesis' }
      return { verdict: 'impostor', how: 'genesis', expected: pin.genesis, got: g.hash }
    }
    // could not be asked — fall through to the cross-check rather than concluding
    var genesisNote = `genesis unavailable (${g.err})`
  }
  const why = genesisNote ?? 'no genesis pin'

  // An endpoint cannot vouch for itself, so a candidate that IS a reference is
  // cross-checked against the other one.
  const refs = (pin.reference ?? []).filter((r) => r !== url)
  if (refs.length === 0) return { verdict: 'unverified', how: `${why}; no reference endpoint available` }

  let lastNote = why
  for (const ref of refs) {
    const refHead = await rpc(ref, 'eth_blockNumber', [])
    if (refHead.err) {
      lastNote = `${why}; reference ${ref} unreachable (${refHead.err})`
      continue
    }
    const height = Math.min(Number(refHead.ok), candidateHead) - CROSSCHECK_DEPTH
    if (!Number.isFinite(height) || height < 1) {
      lastNote = `${why}; chain too short to cross-check`
      continue
    }

    const [mine, theirs] = [await blockHash(url, height), await blockHash(ref, height)]
    if (mine.err || theirs.err) {
      lastNote =
        `${why}; cross-check at block ${height} unanswerable ` +
        `(candidate: ${mine.err ?? 'ok'}, reference ${ref}: ${theirs.err ?? 'ok'})`
      continue
    }
    if (mine.hash !== theirs.hash) {
      return { verdict: 'impostor', how: `cross-check at block ${height} against ${ref}`, expected: theirs.hash, got: mine.hash }
    }
    return { verdict: 'crosscheck', how: `block ${height} agrees with ${ref}` }
  }
  return { verdict: 'unverified', how: lastNote }
}

async function probeChain(name, id, candidates) {
  const working = []
  const failed = []
  const impostors = []
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

    // Identity BEFORE anything expensive, and before the endpoint can be recorded as
    // working: a node on the wrong chain must not reach the shipped list by any route.
    const ident = await proveIdentity(url, id, lat.block)
    if (ident.verdict === 'impostor') {
      impostors.push({ url, ...ident })
      console.log(
        `  ${name.padEnd(14)} ${url} -> !!! IMPOSTOR !!! chainId says ${id} but ${ident.how} does not:\n` +
          `  ${' '.repeat(14)}   expected ${ident.expected}\n` +
          `  ${' '.repeat(14)}   got      ${ident.got}\n` +
          `  ${' '.repeat(14)}   This endpoint is a DIFFERENT CHAIN wearing chain id ${id}. Never ship it.`,
      )
      continue
    }
    if (ident.verdict === 'unverified') {
      failed.push({ url, reason: `identity unverified: ${ident.how}` })
      console.log(`  ${name.padEnd(14)} ${url} -> UNVERIFIED identity: ${ident.how}`)
      continue
    }

    const eip1153 = await probeEip1153(url)
    working.push({ url, latencyMs: lat.ms, block: lat.block, eip1153, identity: ident.verdict })
    console.log(
      `  ${name.padEnd(14)} ${url} -> OK ${lat.ms}ms block ${lat.block} ` +
        `eip1153=${eip1153 ?? 'unprobeable'} id=${ident.verdict}`,
    )
  }
  working.sort((a, b) => a.latencyMs - b.latencyMs)
  return { chainId: id, endpoints: working, failed, impostors }
}

// Importable: `scripts/harvest-rpcs.mjs` reads CHAINS to dedupe its findings against
// what is already a candidate. Probing only happens when this file is RUN.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
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
  let totalImpostors = 0
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
    totalImpostors += v.impostors.length
    console.log(
      `  ${n.padEnd(14)} ${String(v.endpoints.length).padStart(2)} working / ` +
        `${String(v.endpoints.length + v.failed.length + v.impostors.length).padStart(2)} tried   ` +
        `eip1153=${verdict}${v.impostors.length ? `   ${v.impostors.length} IMPOSTOR(S)` : ''}`,
    )
  }
  if (totalImpostors) {
    console.log('\n=== IMPOSTORS — endpoints on a DIFFERENT chain than their chain id claims ===')
    for (const [n, v] of Object.entries(ordered)) {
      for (const i of v.impostors) {
        console.log(`  ${n.padEnd(14)} ${i.url}\n     ${i.how}: expected ${i.expected}, got ${i.got}`)
      }
    }
  }
}
