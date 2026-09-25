// Re-derives the genesis pins in `scripts/probe-rpcs.mjs` (`IDENTITY`) from live nodes.
//
// This is how those hashes were obtained and it is the only way they should ever be
// changed: it asks EVERY endpoint already shipped in `src/chains/endpoints.ts` for
// block 0 and reports, per chain, how many DISTINCT hashes came back. One distinct
// hash across independent operators is a pin. Two is an incident — do not pick one.
//
// Run:  node scripts/read-genesis.mjs                # print, and write rpc-genesis.json
//       node scripts/read-genesis.mjs ethereum base  # only the named chain keys
//
// A chain where no endpoint serves block 0 (Stable and Stable Testnet: pruned nodes with
// a moving history floor) has NO pin, and `probe-rpcs.mjs` falls back to its live
// cross-check there. That is a real gap, recorded rather than papered over — see the
// identity section of that file's header.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const SOURCE = resolve(here, '../src/chains/endpoints.ts')

/**
 * The shipped list, read from the TypeScript source rather than from `dist/`, so this
 * runs on a clean checkout with nothing built. It is a deliberate regex over a literal
 * we control; if the shape of `CHAIN_RPCS` ever changes this throws instead of
 * silently probing an empty list.
 */
function shippedChains() {
  const src = readFileSync(SOURCE, 'utf8')
  const start = src.indexOf('export const CHAIN_RPCS')
  const end = src.indexOf('} as const satisfies')
  if (start < 0 || end < 0) throw new Error(`cannot find CHAIN_RPCS in ${SOURCE}`)
  const body = src.slice(start, end)

  const heads = [...body.matchAll(/^ {2}(\w+): \{$/gm)].map((m) => [m[1], m.index])
  if (heads.length === 0) throw new Error('CHAIN_RPCS parsed to zero chains')

  const chains = {}
  for (let i = 0; i < heads.length; i++) {
    const seg = body.slice(heads[i][1], i + 1 < heads.length ? heads[i + 1][1] : body.length)
    const id = /chainId:\s*(\d+)/.exec(seg)
    const urls = [...seg.matchAll(/url:\s*'([^']+)'/g)].map((m) => m[1])
    if (!id || urls.length === 0) throw new Error(`CHAIN_RPCS entry ${heads[i][0]} parsed to nothing`)
    chains[heads[i][0]] = { chainId: Number(id[1]), urls }
  }
  return chains
}

async function rpc(url, method, params, timeoutMs = 15000) {
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

const only = process.argv.slice(2)
const chains = Object.entries(shippedChains()).filter(([n]) => only.length === 0 || only.includes(n))

const out = {}
for (const [name, { chainId, urls }] of chains) {
  const votes = {}
  const unanswered = []
  for (const url of urls) {
    const b = await rpc(url, 'eth_getBlockByNumber', ['0x0', false])
    // A null RESULT is a non-answer ("this node has no block 0"), not a mismatch.
    const hash = b.ok && b.ok.hash ? b.ok.hash.toLowerCase() : null
    if (!hash) {
      unanswered.push({ url, reason: b.err ?? 'null result — no block 0 on this node' })
      console.log(`  ${name.padEnd(14)} ${url} -> ${b.err ?? 'no block 0'}`)
      continue
    }
    ;(votes[hash] ??= []).push(url)
    console.log(`  ${name.padEnd(14)} ${url} -> ${hash}`)
  }
  out[name] = { chainId, votes, unanswered }
}

writeFileSync('rpc-genesis.json', JSON.stringify(out, null, 2))

console.log('\n=== GENESIS PINS ===')
let conflicts = 0
for (const [name, v] of Object.entries(out)) {
  const hashes = Object.keys(v.votes)
  if (hashes.length === 1) {
    console.log(`  ${name.padEnd(14)} ${hashes[0]}  (${v.votes[hashes[0]].length} independent endpoints agree)`)
  } else if (hashes.length === 0) {
    console.log(`  ${name.padEnd(14)} NO PIN — no endpoint serves block 0 (${v.unanswered.length} tried)`)
  } else {
    conflicts++
    console.log(`  ${name.padEnd(14)} CONFLICT — ${hashes.length} distinct hashes, DO NOT PIN EITHER:`)
    for (const h of hashes) console.log(`  ${' '.repeat(14)}   ${h}  <- ${v.votes[h].join(', ')}`)
  }
}
if (conflicts) {
  console.error(`\n${conflicts} chain(s) disagree about their own genesis. Investigate before pinning.`)
  process.exitCode = 1
}
