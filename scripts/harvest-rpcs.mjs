// Harvests RPC CANDIDATES for our target chains from chainid.network/chains.json.
//
// Run:  node scripts/harvest-rpcs.mjs              # use the cache if present
//       node scripts/harvest-rpcs.mjs --refresh    # re-download chains.json
//       node scripts/harvest-rpcs.mjs base bsc     # only the named chain keys
//
// It prints a paste-ready block of URLs we do NOT already carry, and writes
// `rpc-harvest.json` as an artefact. It deliberately does NOT edit anything:
//   * candidates are pasted into `scripts/probe-rpcs.mjs` by hand, then PROBED;
//   * `src/chains/endpoints.ts` is only ever edited by hand from the probe results.
// A list that nobody read is a list nobody can defend, and chains.json is a
// community-maintained file — see WHAT IT IS AND IS NOT below.
//
// THIS IS A DEVELOPMENT-TIME TOOL. Nothing in the SDK fetches chains.json at runtime:
// the shipped endpoint list has to be reviewable in a diff, and a runtime fetch of a
// third-party list would let anyone who can edit that list choose where our users'
// `eth_call`s go.
//
// ---------------------------------------------------------------------------
// WHAT chains.json IS AND IS NOT
// ---------------------------------------------------------------------------
//
// It is a directory, contributed to by anyone, of `chainId -> metadata`. It is useful
// for finding hosts we had not heard of. It is NOT a source of truth about which chain
// a host serves, and on our chain ids it is wrong in a way that matters:
//
//   * chain id 999 in chains.json is **Wanchain Testnet**, not HyperEVM. HyperEVM
//     mainnet is ABSENT from the file entirely (only "Hyperliquid EVM Testnet" at 998
//     is listed). Wanchain's node answers `eth_chainId` with 0x3e7 = 999 and serves
//     `eth_blockNumber`, so harvesting chain id 999 and trusting the chain id would
//     wire a Wanchain node into HyperEVM's fallback list. Chain id 999 is therefore
//     SKIPPED here (`SKIP_CHAIN_IDS`) and `probe-rpcs.mjs` additionally proves every
//     candidate against a pinned genesis hash. Do not "fix" this by trusting the list.
//
// So: harvest is a source of CANDIDATES. The probe decides what is real.
//
// ---------------------------------------------------------------------------
// WHAT IS FILTERED OUT, AND WHY
// ---------------------------------------------------------------------------
//
//   * anything not `https://` — ws/wss are a different transport, http:// is not
//     usable from a browser page we serve over https
//   * any URL containing `${...}` — a key placeholder (`${INFURA_API_KEY}` and the
//     like). Those are not public endpoints, and a filled-in one would be a
//     credential, which must never reach this repo
//   * any URL with embedded credentials (`user:pass@host`) — same reason
//   * `*.gateway.tatum.io` — answers, but the free tier is FIVE requests per minute
//     and `eth_call` is paid-only. It would 429 in normal use
//   * NAMED thirdweb aliases (`plasma.rpc.thirdweb.com`) — thirdweb's named alias for
//     "plasma" answers chain id 9746, not 9745. The numeric form is the correct one
//   * anything already shipped in `src/chains/endpoints.ts` or already a candidate in
//     `scripts/probe-rpcs.mjs`
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { CHAINS } from './probe-rpcs.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const ENDPOINTS_TS = resolve(here, '../src/chains/endpoints.ts')
const CACHE_DIR = resolve(here, '.cache')
const CACHE = resolve(CACHE_DIR, 'chains.json')
const CACHE_META = resolve(CACHE_DIR, 'chains.fetched.json')
const SOURCE_URL = 'https://chainid.network/chains.json'

/**
 * Chain ids where the chains.json entry is a DIFFERENT CHAIN than ours.
 * Harvesting them would produce candidates that pass a chain-id check and serve the
 * wrong chain. Each needs a reason, and the reason must be a fact about the file.
 */
const SKIP_CHAIN_IDS = new Map([
  [999, 'chains.json id 999 is Wanchain Testnet; HyperEVM mainnet is absent from the file'],
])

const EXCLUDE_HOST = [
  { re: /\.gateway\.tatum\.io$/i, why: 'tatum free tier is 5 req/min and eth_call is paid-only' },
  {
    re: /^(?![0-9]+\.)[a-z0-9-]+\.rpc\.thirdweb\.com$/i,
    why: "thirdweb NAMED alias — 'plasma' answers 9746, not 9745; use the numeric form",
  },
]

/* ------------------------------------------------------------------ inputs */

function shippedUrls() {
  const src = readFileSync(ENDPOINTS_TS, 'utf8')
  const urls = [...src.matchAll(/url:\s*'([^']+)'/g)].map((m) => m[1])
  if (urls.length < 40) throw new Error(`only ${urls.length} urls parsed from ${ENDPOINTS_TS} — shape changed?`)
  return urls
}

async function chainsJson(refresh) {
  mkdirSync(CACHE_DIR, { recursive: true })
  if (!refresh && existsSync(CACHE)) {
    const meta = existsSync(CACHE_META) ? JSON.parse(readFileSync(CACHE_META, 'utf8')) : {}
    console.log(`chains.json from cache, fetched ${meta.fetchedAt ?? statSync(CACHE).mtime.toISOString()}`)
    return { list: JSON.parse(readFileSync(CACHE, 'utf8')), fetchedAt: meta.fetchedAt ?? null, cached: true }
  }
  console.log(`downloading ${SOURCE_URL} ...`)
  const r = await fetch(SOURCE_URL)
  if (!r.ok) throw new Error(`${SOURCE_URL} -> HTTP ${r.status}`)
  const text = await r.text()
  const list = JSON.parse(text)
  if (!Array.isArray(list) || list.length < 100) throw new Error('chains.json did not parse to a chain list')
  const fetchedAt = new Date().toISOString()
  writeFileSync(CACHE, text)
  writeFileSync(CACHE_META, JSON.stringify({ source: SOURCE_URL, fetchedAt, chains: list.length }, null, 2))
  console.log(`  ${list.length} chains, cached at ${CACHE} (${fetchedAt})`)
  return { list, fetchedAt, cached: false }
}

/* ------------------------------------------------------------------ filter */

const normalise = (u) => u.trim().replace(/\/+$/, '')

/**
 * A rejected URL still has to be REPORTED, and a report is a file we commit. Printing the
 * credential we just refused to ship would publish it just as surely as shipping it would — the
 * rule in CLAUDE.md is "never commit an RPC URL containing an API key", and an evidence file is a
 * commit. So every key-shaped path segment is replaced by its length before the URL reaches stdout
 * or the artefact; the host and shape stay legible, which is all a reader needs to judge the call.
 *
 * This is deliberately applied to EVERY rejected URL rather than only the ones rejected AS keys:
 * a URL refused for another reason can still carry one.
 */
function redact(url) {
  try {
    const u = new URL(url)
    u.username = ''
    u.password = ''
    u.pathname = u.pathname
      .split('/')
      .map((seg) => (seg.length >= 20 && /^[A-Za-z0-9_-]+$/.test(seg) && /[0-9]/.test(seg) && /[A-Za-z]/.test(seg) ? `<redacted:${seg.length}>` : seg))
      .join('/')
    u.search = u.search === '' ? '' : '?<redacted>'
    return u.toString()
  } catch {
    return '<unparseable url, redacted>'
  }
}

function reject(url) {
  if (url.includes('${') || url.includes('%7B')) return 'key placeholder'
  if (!/^https:\/\//i.test(url)) return url.startsWith('ws') ? 'websocket transport' : 'not https'
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return 'unparseable'
  }
  if (parsed.username || parsed.password) return 'embedded credentials'
  // A long opaque path segment is how providers carry an API key, and chains.json
  // really does contain FILLED-IN ones, not only `${...}` placeholders: on 2026-09-19
  // its Sepolia entry carried a live `eth-sepolia.g.alchemy.com/v2/<32-char key>`.
  // A placeholder check alone would have let that through, and committing it would
  // have published somebody's credential. So: any path segment that is 20+ characters
  // of mixed letters and digits with no word structure is treated as a key.
  for (const seg of parsed.pathname.split('/')) {
    if (seg.length >= 20 && /^[A-Za-z0-9_-]+$/.test(seg) && /[0-9]/.test(seg) && /[A-Za-z]/.test(seg)) {
      return 'opaque path segment — an embedded api key'
    }
  }
  for (const { re, why } of EXCLUDE_HOST) if (re.test(parsed.hostname)) return why
  return null
}

/* -------------------------------------------------------------------- main */

const args = process.argv.slice(2)
const refresh = args.includes('--refresh')
const only = args.filter((a) => !a.startsWith('--'))

const { list, fetchedAt, cached } = await chainsJson(refresh)
const byId = new Map()
for (const c of list) (byId.get(c.chainId) ?? byId.set(c.chainId, []).get(c.chainId)).push(c)

const known = new Set(shippedUrls().map(normalise))
for (const { candidates } of Object.values(CHAINS)) for (const u of candidates) known.add(normalise(u))

const selected = Object.entries(CHAINS).filter(([n]) => only.length === 0 || only.includes(n))
const out = { source: SOURCE_URL, fetchedAt, cached, chains: {} }

for (const [name, { id }] of selected) {
  const skip = SKIP_CHAIN_IDS.get(id)
  if (skip) {
    out.chains[name] = { chainId: id, skipped: skip, fresh: [], rejected: [], duplicate: [] }
    console.log(`\n${name} (${id})  SKIPPED: ${skip}`)
    continue
  }

  const entries = byId.get(id) ?? []
  if (entries.length === 0) {
    out.chains[name] = { chainId: id, absent: true, fresh: [], rejected: [], duplicate: [] }
    console.log(`\n${name} (${id})  ABSENT from chains.json`)
    continue
  }

  const fresh = []
  const rejected = []
  const duplicate = []
  const seen = new Set()
  for (const entry of entries) {
    for (const raw of entry.rpc ?? []) {
      const url = normalise(raw)
      if (seen.has(url)) continue
      seen.add(url)
      const why = reject(url)
      if (why) {
        rejected.push({ url: redact(raw), why })
        continue
      }
      if (known.has(url)) {
        duplicate.push(url)
        continue
      }
      fresh.push(url)
    }
  }

  out.chains[name] = {
    chainId: id,
    listedAs: entries.map((e) => e.name),
    fresh,
    duplicate,
    rejected,
  }
  console.log(
    `\n${name} (${id})  listed as ${entries.map((e) => e.name).join(' / ')}` +
      `\n  ${fresh.length} new, ${duplicate.length} already carried, ${rejected.length} rejected`,
  )
  for (const { url, why } of rejected) console.log(`    reject  ${url}  (${why})`) // url is already redacted
  for (const u of fresh) console.log(`    NEW     ${u}`)
}

writeFileSync('rpc-harvest.json', JSON.stringify(out, null, 2))

const total = Object.values(out.chains).reduce((n, c) => n + c.fresh.length, 0)
console.log(`\n=== ${total} new candidate(s). Paste into scripts/probe-rpcs.mjs by hand, then probe. ===`)
for (const [name, c] of Object.entries(out.chains)) {
  if (!c.fresh.length) continue
  console.log(`\n  // ${name}`)
  for (const u of c.fresh) console.log(`      '${u}',`)
}
