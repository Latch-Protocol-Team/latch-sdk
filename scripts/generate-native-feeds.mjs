// Generates `src/deployments/nativeFeeds.ts` — the NATIVE-CURRENCY/USD price sources for
// the chains Latch targets, every Chainlink address READ FROM THE CHAIN before it is
// written down, and every Pyth id READ FROM HERMES before it is written down.
//
// Run:  node scripts/generate-native-feeds.mjs                # fetch, verify, write
//       node scripts/generate-native-feeds.mjs --check        # fail if the file is stale
//       node scripts/generate-native-feeds.mjs --refresh      # ignore the download cache
//       node scripts/generate-native-feeds.mjs --chains=base,robinhood
//       node scripts/generate-native-feeds.mjs --report       # print the facts, write nothing
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
// The launch wizard is market-cap-first and defaults to a $3.5K-equivalent opening
// market cap on every chain (CLAUDE.md, owner decision 2026-09-20). Turning "$3,500"
// into a price per token needs one number per chain: how many dollars one unit of the
// chain's native currency is worth. `deployments/stockFeeds.ts` is EQUITY feeds only and
// answers nothing about ETH, BNB, MON or XPL.
//
// The no-invented-data rule binds here harder than anywhere else in the SDK, because the
// output is a dollar figure a human will read and act on: a creator who is shown $3,500
// and gets $35,000 has a permanently mispriced launch behind a locked LP. So the rule is
// the same one `generate-stock-feeds.mjs` follows — a feed address that could not be read
// is NOT written down, and the chain is recorded as having no source, which is a correct
// and expected answer for several chains.
//
// ---------------------------------------------------------------------------
// WHY THE LIST IS GENERATED AND COMMITTED, AND NEVER FETCHED AT RUNTIME
// ---------------------------------------------------------------------------
// Identical to the stock-feed generator's reasoning, and it matters more here. If the SDK
// resolved the ETH/USD address from Chainlink's directory at runtime, whoever can edit that
// document could change what every Latch launch on the chain is priced against, between one
// page load and the next. It is downloaded here, verified against the chain here, and
// committed as source a human reads in a diff.
//
// ---------------------------------------------------------------------------
// WHICH FEED, WHEN A CHAIN PUBLISHES SEVERAL
// ---------------------------------------------------------------------------
// Most chains carry two or three ETH/USD aggregators. They are not interchangeable and the
// directory's `path` is what separates them:
//
//   `eth-usd`                 the standard Data Feed. Preferred, always.
//   `eth-usd-svr`             Chainlink SVR (Smart Value Recapture). The same price data
//   `eth-usd-shared-svr`      delivered through an OEV auction, so an update can land
//   `eth-usd-shared-svr-2`    later on chain than the standard feed's. SVR exists for
//                             lending liquidations; it is a fine price and a worse clock.
//
// The rule: take the canonical `<base>-usd` when it exists. Where the ONLY aggregator on a
// chain is an SVR one — which is the case on Robinhood and on Arc — take it, and record
// `variant: "svr"` on the record so the difference is visible at the call site rather than
// buried here. Every candidate is verified either way, and the ones not selected are
// committed as `alternatives` so the choice can be re-litigated from data.
//
// Where a chain publishes both an 8-decimal and an 18-decimal aggregator for the same pair,
// both are read and both are kept; the selection prefers the canonical path first and
// decimals only as a tie-break. Decimals are handled by the consumer, never assumed.
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE CANNOT GIVE YOU
// ---------------------------------------------------------------------------
// A native currency's SYMBOL and DECIMALS are not on-chain facts — there is no contract to
// ask. They come from `chainid.network/chains.json`, the same source
// `scripts/harvest-rpcs.mjs` already uses, and every record says so in `nativeSource`.
// chains.json has two known holes on our target list and both are handled explicitly
// rather than papered over; see `NATIVE_OVERRIDES`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const CACHE_DIR = join(HERE, ".cache", "chainlink");
const CHAINS_JSON = join(HERE, ".cache", "chains.json");
const OUT_FILE = join(ROOT, "src", "deployments", "nativeFeeds.ts");

/* ------------------------------------------------------------------ inputs */

/**
 * Every chain in `src/chains/endpoints.ts`, plus Arc mainnet.
 *
 * `file` is the Chainlink reference-data directory document, or `null` where none exists —
 * checked by fetching it, not assumed, and the 404 is committed in `NATIVE_FEED_SURVEY`.
 * The file names are not guessable: Base is `feeds-ethereum-mainnet-base-1`, Robinhood is
 * `feeds-robinhood-mainnet`, Arc is `feeds-arc-mainnet`.
 *
 * `rpcKey` is the key in `CHAIN_RPCS`. Arc mainnet is deliberately absent from that table
 * (it is not one of the target chains), so it carries its own endpoints here — the owner's
 * `rpc.mainnet.arc.io`, which CLAUDE.md records as live on 2026-09-20.
 */
const CHAINS = {
  ethereum: { chainId: 1, file: "feeds-mainnet", rpcKey: "ethereum" },
  bsc: { chainId: 56, file: "feeds-bsc-mainnet", rpcKey: "bsc" },
  base: { chainId: 8453, file: "feeds-ethereum-mainnet-base-1", rpcKey: "base" },
  robinhood: { chainId: 4663, file: "feeds-robinhood-mainnet", rpcKey: "robinhood" },
  ink: { chainId: 57073, file: "feeds-ethereum-mainnet-ink-1", rpcKey: "ink" },
  linea: { chainId: 59144, file: "feeds-ethereum-mainnet-linea-1", rpcKey: "linea" },
  xlayer: { chainId: 196, file: "feeds-ethereum-mainnet-xlayer-1", rpcKey: "xlayer" },
  hyperevm: { chainId: 999, file: "feeds-hyperliquid-mainnet", rpcKey: "hyperevm" },
  monad: { chainId: 143, file: "feeds-monad-mainnet", rpcKey: "monad" },
  plasma: { chainId: 9745, file: "feeds-plasma-mainnet", rpcKey: "plasma" },
  stable: { chainId: 988, file: "feeds-stable-mainnet", rpcKey: "stable" },
  arc: {
    chainId: 5042,
    file: "feeds-arc-mainnet",
    rpcKey: null,
    rpcs: ["https://rpc.mainnet.arc.io", "https://5042.rpc.thirdweb.com"],
  },
  sepolia: { chainId: 11155111, file: "feeds-ethereum-testnet-sepolia", rpcKey: "sepolia", testnet: true },
  // Monad Testnet (10143) was REMOVED 2026-09-24 by owner decision; its `rpcKey` no longer exists in
  // `CHAIN_RPCS`. Monad MAINNET (143) stays above.
  stableTestnet: { chainId: 2201, file: "feeds-stable-testnet", rpcKey: "stableTestnet", testnet: true },
  arcTestnet: { chainId: 5042002, file: "feeds-arc-testnet", rpcKey: "arcTestnet", testnet: true },
};

const DIRECTORY_BASE = "https://reference-data-directory.vercel.app";
const CHAINS_JSON_URL = "https://chainid.network/chains.json";

/**
 * Where chains.json is WRONG or ABSENT for one of our chains, with the reason and the
 * substitute source. Both holes are the same ones `scripts/harvest-rpcs.mjs` records.
 *
 * There is no third case: every other target chain is present in chains.json under the
 * right id, and each was read rather than assumed.
 */
const NATIVE_OVERRIDES = {
  999: {
    symbol: "HYPE",
    decimals: 18,
    source:
      "chains.json id 999 is WANCHAIN TESTNET, not HyperEVM — the same collision " +
      "scripts/harvest-rpcs.mjs guards against. HyperEVM mainnet is absent from chains.json " +
      "entirely. Symbol and decimals taken from chains.json id 998 (Hyperliquid EVM Testnet, " +
      'nativeCurrency {"name":"HYPE","symbol":"HYPE","decimals":18}), which is the same VM and ' +
      "the same gas asset. THIS IS AN INFERENCE, not a reading of chain 999.",
    inferred: true,
  },
};

/**
 * Notes a human wrote, appended to the generated `note` for that chain.
 *
 * These exist for the cases where the honest answer is "no source" but the reason is a
 * JUDGEMENT rather than a 404, and the next person to look will otherwise re-derive it and
 * possibly decide differently without knowing a decision was taken.
 */
const CURATED_NOTES = {
  988: [
    "Stable's native gas asset is USDT0, which is NOT USDT: pricing one with the other's",
    "feed asserts a peg this SDK has not verified, so no USDT/USD feed is substituted here.",
    "Pyth does publish a distinct Crypto.USDT0/USD feed and its id is recorded above, but",
    "reading it needs a Pyth contract address on chain 988 that this run did not verify, so",
    "Stable resolves at tier 4 today — launches there default in native units, which is the",
    "correct answer rather than a gap. Verify a Pyth contract on 988 to promote it to tier 2.",
  ].join(" "),
  2201: "Same as chain 988: the native asset is USDT0, and the Pyth id is recorded but unusable without a verified Pyth contract on this chain.",
  11155111:
    "Sepolia's Chainlink ETH/USD feed prices REAL ether, not Sepolia ether, which has no " +
    "market price at all. The feed is recorded because it exists and was verified; the " +
    "resolver refuses to spend it on a USD figure for a testnet unless a caller opts in.",
  5042002: "Arc Testnet publishes no Chainlink directory document (HTTP 404 on 2026-09-20).",
};

/**
 * Pyth Hermes — the tier-2 source, used only where Chainlink publishes nothing.
 *
 * Hermes is an HTTP service Pyth operates. Reading a price from it is NOT an on-chain read
 * and the two must never be conflated: Hermes hands you a signed update that anyone COULD
 * post on chain, but nothing says anyone has, so the number has no on-chain finality and no
 * on-chain audit trail. That is acceptable for a UI default a human reviews and is recorded
 * as a different tier so the UI can say which it is.
 *
 * The feed id is not hardcoded from memory: `v2/price_feeds` is queried for the symbol and
 * the id is taken from the entry whose `attributes.base` matches, then a live price is read
 * back through `v2/updates/price/latest` before the id is written down.
 */
const HERMES_BASE = "https://hermes.pyth.network";

/** Clock skew tolerated on `updatedAt` before it is called a future timestamp. */
const FUTURE_SKEW_SECONDS = 120;

/* ---------------------------------------------------------------------------
   FRESHNESS IS A REJECTION HERE, UNLIKE THE EQUITY FEEDS — AND THE DIFFERENCE
   IS THE MARKET HOURS PROFILE, NOT A CHANGE OF POLICY.
   ---------------------------------------------------------------------------
   `generate-stock-feeds.mjs` records staleness without rejecting, because a
   `us_equities_24/5` feed stops when the market does and a Saturday reading is the
   schedule working. Every feed in THIS file carries `marketHours: "Crypto"`, which
   is 24/7/365. A crypto feed past its own heartbeat is not a closed market; it is a
   feed that is not doing what it says.

   It is still recorded rather than silently dropped: a stale candidate goes to
   `rejected` with its age, so a reader can tell "no feed exists" from "the feed
   exists and was not publishing when we looked".
   --------------------------------------------------------------------------- */

/**
 * Grace added to a feed's own heartbeat before its answer is called stale, in seconds.
 *
 * `updatedAt` is the timestamp of the block that INCLUDED the update, not of the
 * observation, so a feed that publishes exactly on its heartbeat can still read a little
 * over it through ordinary block-time jitter and sequencer timestamp latitude. Five minutes
 * absorbs that on every chain here and is negligible against the 3,600 s and 86,400 s
 * heartbeats; on BNB's 27 s heartbeat the grace dominates, which is correct — one missed
 * 27-second beat is noise, not a fault.
 *
 * The same constant is exported to the runtime resolver, so the table and the reader agree
 * by construction rather than by two people remembering the same number.
 */
const STALE_GRACE_SECONDS = 300;

/* ---------------------------------------------------------------- arguments */

const argv = process.argv.slice(2);
const CHECK = argv.includes("--check");
const REFRESH = argv.includes("--refresh");
const REPORT_ONLY = argv.includes("--report");
const only = (argv.find((a) => a.startsWith("--chains=")) ?? "").slice("--chains=".length);
const CHAIN_KEYS = only ? only.split(",").map((s) => s.trim()).filter(Boolean) : Object.keys(CHAINS);
for (const k of CHAIN_KEYS) {
  if (!CHAINS[k]) {
    console.error(`unknown chain key ${k}; known: ${Object.keys(CHAINS).join(", ")}`);
    process.exit(2);
  }
}

/* ------------------------------------------------------------------ helpers */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errText = (e) => String(e?.shortMessage ?? e?.message ?? e).split("\n")[0].slice(0, 200);

async function directory(key) {
  const { file } = CHAINS[key];
  const url = `${DIRECTORY_BASE}/${file}.json`;
  const cached = join(CACHE_DIR, `${file}.json`);
  if (!REFRESH && existsSync(cached)) {
    return { url, feeds: JSON.parse(readFileSync(cached, "utf8")), cached: true };
  }
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    return { url, feeds: null, status: 0, error: errText(e), cached: false };
  }
  if (!res.ok) return { url, feeds: null, status: res.status, cached: false };
  const text = await res.text();
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cached, text);
  return { url, feeds: JSON.parse(text), cached: false };
}

async function chainsJson() {
  if (!REFRESH && existsSync(CHAINS_JSON)) return JSON.parse(readFileSync(CHAINS_JSON, "utf8"));
  const res = await fetch(CHAINS_JSON_URL);
  if (!res.ok) throw new Error(`chains.json HTTP ${res.status}`);
  const text = await res.text();
  mkdirSync(dirname(CHAINS_JSON), { recursive: true });
  writeFileSync(CHAINS_JSON, text);
  return JSON.parse(text);
}

/* ------------------------------------------------------------ chain reading */

let CHAIN_RPCS;
try {
  ({ CHAIN_RPCS } = await import("../dist/chains/endpoints.js"));
} catch (e) {
  console.error(`Build the SDK first (npm run build in packages/sdk): ${errText(e)}`);
  process.exit(2);
}

const { createPublicClient, http, getAddress } = await import("viem");

const AGGREGATOR_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "description", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint80" }, { type: "int256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint80" }],
  },
];

function clientsFor(key) {
  const cfg = CHAINS[key];
  const urls = cfg.rpcKey ? (CHAIN_RPCS[cfg.rpcKey]?.endpoints ?? []).map((e) => e.url) : (cfg.rpcs ?? []);
  if (urls.length === 0) throw new Error(`no endpoints for chain key ${key}`);
  return urls.map((url) => ({
    url,
    client: createPublicClient({ transport: http(url, { timeout: 20_000, retryCount: 0 }) }),
  }));
}

/** Try each endpoint in turn; the first that answers wins. A chain-level failure is never
 *  allowed to look like a feed-level rejection, so the caller distinguishes them. */
async function withFallback(clients, fn) {
  let last;
  for (const { url, client } of clients) {
    try {
      return { value: await fn(client), endpoint: url };
    } catch (e) {
      last = e;
      await sleep(120);
    }
  }
  throw last ?? new Error("no endpoint");
}

/**
 * Read one aggregator and decide whether it may be shipped.
 *
 * Every check is one a consumer would otherwise have to trust us about:
 *   code        — an EOA answers nothing; `getCode` is the cheapest proof there is a feed
 *   decimals    — must agree with the directory, or one of the two is lying about scale,
 *                 and scale errors here are factor-of-10^10 errors in a dollar figure
 *   description — must name the base asset. A record that says ETH/USD pointing at an
 *                 aggregator describing itself as something else is the one error nobody
 *                 downstream can catch
 *   answer      — positive, complete round, not in the future
 *   age         — within heartbeat + grace. Crypto feeds are 24/7; see the note above
 */
async function verifyAggregator(clients, address, entry, base, nowSeconds) {
  const out = { address, ok: false, reasons: [] };
  let code;
  try {
    ({ value: code, endpoint: out.endpoint } = await withFallback(clients, (c) => c.getCode({ address })));
  } catch (e) {
    out.reasons.push(`unreadable: ${errText(e)}`);
    return out;
  }
  if (!code || code === "0x") {
    out.reasons.push("no code at the address");
    return out;
  }
  out.codeSize = (code.length - 2) / 2;

  for (const fn of ["decimals", "description", "latestRoundData"]) {
    try {
      const { value } = await withFallback(clients, (c) =>
        c.readContract({ address, abi: AGGREGATOR_ABI, functionName: fn }),
      );
      out[fn] = value;
    } catch (e) {
      out.reasons.push(`${fn}() failed: ${errText(e)}`);
    }
  }
  if (out.reasons.length) return out;

  out.decimals = Number(out.decimals);
  const [roundId, answer, startedAt, updatedAt] = out.latestRoundData;
  out.roundId = roundId.toString();
  out.answer = answer.toString();
  out.updatedAt = Number(updatedAt);
  out.ageSeconds = nowSeconds - out.updatedAt;
  delete out.latestRoundData;

  if (out.decimals !== Number(entry.decimals)) {
    out.reasons.push(`decimals ${out.decimals} on chain, directory says ${entry.decimals}`);
  }
  // The description must name the base asset on a boundary, so a two- or three-letter
  // symbol cannot match a substring of an unrelated word.
  const desc = String(out.description ?? "").toUpperCase();
  const bounded = new RegExp(`(^|[^A-Z0-9])${base.toUpperCase().replace(/[^A-Z0-9]/g, "")}([^A-Z0-9]|$)`);
  if (!bounded.test(desc)) {
    out.reasons.push(`description "${out.description}" does not name the base asset "${base}"`);
  }
  if (answer <= 0n) out.reasons.push(`non-positive answer ${answer}`);
  if (roundId === 0n) out.reasons.push("round id 0");
  if (startedAt === 0n || updatedAt === 0n) out.reasons.push("incomplete round (startedAt or updatedAt is 0)");
  if (out.updatedAt > nowSeconds + FUTURE_SKEW_SECONDS) {
    out.reasons.push(`updatedAt ${out.updatedAt} is in the future (now ${nowSeconds})`);
  }
  const heartbeat = Number(entry.heartbeat ?? 0);
  if (!heartbeat) out.reasons.push("directory gives no heartbeat");
  else if (out.ageSeconds > heartbeat + STALE_GRACE_SECONDS) {
    out.reasons.push(
      `stale: last round ${out.ageSeconds}s ago, heartbeat ${heartbeat}s (+${STALE_GRACE_SECONDS}s grace). ` +
        `This is a 24/7 crypto feed, so age past the heartbeat is a fault, not a closed market.`,
    );
  }

  out.ok = out.reasons.length === 0;
  return out;
}

/* ------------------------------------------------------------------- pyth */

/**
 * Find and verify a Pyth price feed id for `<symbol>/USD`, against Hermes itself.
 *
 * WHAT CHANGED UNDER US, 2026-09-20. The brief for this work said Hermes is "free,
 * keyless". Its METADATA endpoint still is — `v2/price_feeds` answers 200 with no
 * credential. Its PRICE endpoints are not: `v2/updates/price/latest` and the older
 * `api/latest_price_feeds` both answer `401 unauthorized`, on the documented public host
 * and on `hermes-beta`, with and without the `0x` prefix on the id. So a price cannot be
 * read from Hermes keylessly today and this generator does not pretend it can: the id is
 * verified and committed, the price read is attempted and its outcome is committed as a
 * string, and `verifiedPrice` stays null when the read did not happen.
 *
 * The consequence for the resolver is in `src/price/pyth.ts`: tier 2 reads the Pyth
 * CONTRACT on chain instead, and it will only do so with a contract address the caller
 * supplies, because no Pyth contract address has been verified by this run and an
 * unverified address is exactly what the rules here forbid.
 */
async function verifyPyth(symbol, nowSeconds) {
  const out = { ok: false, reasons: [], symbol };
  let list;
  try {
    const res = await fetch(`${HERMES_BASE}/v2/price_feeds?query=${encodeURIComponent(symbol)}&asset_type=crypto`);
    if (!res.ok) {
      out.reasons.push(`price_feeds HTTP ${res.status}`);
      return out;
    }
    list = await res.json();
  } catch (e) {
    out.reasons.push(`price_feeds unreachable: ${errText(e)}`);
    return out;
  }
  // Hermes publishes no `base` attribute. The identifier is `attributes.symbol`, which is
  // exactly `Crypto.<BASE>/USD` for a crypto pair, so the match is on the WHOLE string and
  // not on a substring: a `query=ETH` search returns ETHFI, CBETH, WETH and eleven others,
  // and every one of them would pass a `startsWith` or an `includes`.
  const wanted = `Crypto.${symbol.toUpperCase()}/USD`;
  const matches = (Array.isArray(list) ? list : []).filter((f) => {
    const a = f?.attributes ?? {};
    return (
      String(a.symbol ?? "") === wanted &&
      String(a.quote_currency ?? "").toUpperCase() === "USD" &&
      String(a.asset_type ?? "").toLowerCase() === "crypto"
    );
  });
  if (matches.length === 0) {
    out.reasons.push(`Hermes lists no crypto ${symbol}/USD feed`);
    return out;
  }
  if (matches.length > 1) {
    out.candidates = matches.map((m) => `${m.id}:${m.attributes?.symbol}`);
  }
  if (matches.length > 1) {
    // Never pick one of several. The id is what a contract will be pointed at.
    out.reasons.push(`Hermes lists ${matches.length} feeds called ${wanted}; refusing to pick one`);
    return out;
  }
  const chosen = matches[0];
  out.priceFeedId = `0x${String(chosen.id).replace(/^0x/, "")}`;
  out.hermesSymbol = chosen.attributes?.symbol ?? null;
  out.displaySymbol = chosen.attributes?.display_symbol ?? null;
  out.description = chosen.attributes?.description ?? null;

  // Attempted, recorded, and NOT a rejection: an id whose price could not be read is still
  // a correctly identified id, and the reason it could not be read is the thing worth
  // committing.
  try {
    const res = await fetch(`${HERMES_BASE}/v2/updates/price/latest?ids[]=${out.priceFeedId}&parsed=true`);
    if (!res.ok) {
      out.priceCheck = `v2/updates/price/latest returned HTTP ${res.status}${res.status === 401 ? " (unauthorized — this endpoint is no longer keyless)" : ""}`;
    } else {
      const body = await res.json();
      const p = body?.parsed?.[0];
      if (!p) {
        out.priceCheck = "v2/updates/price/latest returned no parsed price";
      } else {
        out.price = String(p.price?.price ?? "");
        out.expo = Number(p.price?.expo);
        out.publishTime = Number(p.price?.publish_time);
        out.ageSeconds = nowSeconds - out.publishTime;
        if (!(BigInt(out.price || "0") > 0n)) out.priceCheck = `non-positive price ${out.price}`;
        else if (!Number.isFinite(out.expo) || out.expo > 0) out.priceCheck = `unexpected expo ${out.expo}`;
        else if (out.publishTime > nowSeconds + FUTURE_SKEW_SECONDS) out.priceCheck = "publish time in the future";
        else out.priceCheck = "read and sane";
      }
    }
  } catch (e) {
    out.priceCheck = `v2/updates/price/latest unreachable: ${errText(e)}`;
  }
  if (out.priceCheck !== "read and sane") {
    out.price = null;
    out.expo = null;
    out.publishTime = null;
    out.ageSeconds = null;
  }
  out.ok = out.reasons.length === 0;
  return out;
}

/* --------------------------------------------------------------------- run */

const startedAt = new Date();
const nowSeconds = Math.floor(startedAt.getTime() / 1000);

const chainsList = await chainsJson();
const chainsById = new Map(chainsList.map((c) => [c.chainId, c]));

const rows = [];

for (const key of CHAIN_KEYS) {
  const cfg = CHAINS[key];
  const { chainId } = cfg;
  const row = {
    key,
    chainId,
    testnet: Boolean(cfg.testnet),
    candidates: [],
    rejected: [],
    alternatives: [],
    selected: null,
    pyth: null,
  };

  /* ---- native currency, from chains.json unless an override says otherwise ---- */
  const override = NATIVE_OVERRIDES[chainId];
  const cj = chainsById.get(chainId);
  if (override) {
    row.native = { symbol: override.symbol, decimals: override.decimals, source: override.source, inferred: true };
  } else if (cj?.nativeCurrency?.symbol && Number.isInteger(cj.nativeCurrency.decimals)) {
    row.native = {
      symbol: cj.nativeCurrency.symbol,
      decimals: cj.nativeCurrency.decimals,
      source: `chainid.network/chains.json id ${chainId} (${cj.name}), nativeCurrency ${JSON.stringify(cj.nativeCurrency)}`,
      inferred: false,
    };
  } else {
    row.native = null;
    row.note = `chains.json has no usable nativeCurrency for id ${chainId}; nothing can be priced without knowing what the native asset is`;
    rows.push(row);
    console.error(`${key.padEnd(14)} ${String(chainId).padEnd(9)} NO NATIVE CURRENCY`);
    continue;
  }
  // OUR name first, chains.json's only as a fallback. This is not cosmetic: chain id 999
  // is HyperEVM to us and WANCHAIN TESTNET in chains.json, so taking the name from there
  // labelled a verified HYPE/USD feed "Wanchain Testnet" — the same collision
  // `NATIVE_OVERRIDES` exists for, showing up in a second field. Arc has no entry in
  // `CHAIN_RPCS` (it is not a target chain) and correctly falls through to chains.json.
  row.chainName = CHAIN_RPCS[cfg.rpcKey ?? ""]?.name ?? cj?.name ?? key;

  /* --------------------------- tier 2, always probed --------------------------- */
  // Probed on EVERY chain, not only the ones Chainlink misses, so the table records what
  // the fallback would have said. Costs two HTTP calls and makes a future Chainlink
  // outage a data question rather than a research question.
  const pyth = await verifyPyth(row.native.symbol, nowSeconds);
  row.pyth = pyth.ok
    ? {
        priceFeedId: pyth.priceFeedId,
        hermesSymbol: pyth.hermesSymbol,
        displaySymbol: pyth.displaySymbol,
        description: pyth.description,
        priceCheck: pyth.priceCheck,
        verifiedPrice: pyth.price,
        verifiedExpo: pyth.expo,
        verifiedPublishTime: pyth.publishTime,
        verifiedAgeSeconds: pyth.ageSeconds,
      }
    : null;
  row.pythRejection = pyth.ok ? null : pyth.reasons.join("; ");

  /* --------------------------- tier 1, Chainlink ------------------------------- */
  const dir = await directory(key);
  row.directoryUrl = dir.url;
  row.directoryCached = dir.cached;
  if (!dir.feeds) {
    row.directoryStatus = dir.status ?? 0;
    row.note = `no Chainlink directory document for this chain (HTTP ${dir.status})`;
    rows.push(row);
    console.error(`${key.padEnd(14)} ${String(chainId).padEnd(9)} directory HTTP ${dir.status}`);
    continue;
  }
  row.directoryEntries = dir.feeds.length;

  const base = row.native.symbol.toUpperCase();
  const candidates = dir.feeds.filter((f) => {
    const d = f.docs ?? {};
    if (d.productTypeCode === "PoR") return false; // a proof-of-reserve feed is not a price
    if (!f.proxyAddress) return false;
    if (!Number(f.heartbeat ?? 0)) return false;
    if (String(d.marketHours ?? "") !== "Crypto") return false;
    // A DERIVED product is not a price. Sepolia publishes "ETH-USD 7-Day Realized
    // Volatility" under `eth-usd-realvol7day`, with `baseAssetEntityId: "crypto-ETH"` and
    // `quoteAssetEntityId: "forex-USD"` — it matches every identity test below and its
    // answer is a volatility in 5 decimals, not a dollar price. Chainlink separates them
    // with `attributeType` ("cex_price" vs "realized_volatility") and `productSubType`
    // ("Reference" vs "Realized Volatility"); both are checked, and both are checked only
    // when present, because the testnet documents omit them.
    if (d.attributeType && String(d.attributeType) !== "cex_price") return false;
    if (d.productSubType && String(d.productSubType) !== "Reference") return false;

    // The MAINNET documents carry `docs.baseAsset` / `docs.quoteAsset` / `docs.assetClass`.
    // The TESTNET documents carry none of the three: their `docs` is
    // `{ baseAssetEntityId: "crypto-ETH", quoteAssetEntityId: "forex-USD", marketHours }`
    // and the top-level `pair` array is sometimes filled instead. Both shapes are read
    // explicitly rather than with one loose regex, because a loose match here selects the
    // wrong aggregator and nothing downstream can tell.
    const baseAsset = String(d.baseAsset ?? "").toUpperCase();
    const quoteAsset = String(d.quoteAsset ?? "").toUpperCase();
    if (baseAsset && quoteAsset) {
      if (String(d.assetClass ?? "") !== "Crypto") return false;
      return baseAsset === base && quoteAsset === "USD";
    }
    const entityBase = String(d.baseAssetEntityId ?? "");
    const entityQuote = String(d.quoteAssetEntityId ?? "");
    if (entityBase && entityQuote) {
      return entityBase.toUpperCase() === `CRYPTO-${base}` && entityQuote.toUpperCase() === "FOREX-USD";
    }
    const pair = Array.isArray(f.pair) ? f.pair : [];
    if (pair.length === 2 && pair[0] && pair[1]) {
      return String(pair[0]).toUpperCase() === base && String(pair[1]).toUpperCase() === "USD";
    }
    return false;
  });
  row.candidateCount = candidates.length;
  if (candidates.length === 0) {
    row.note = `${dir.feeds.length} feeds in the directory, none of them ${base}/USD`;
    rows.push(row);
    console.error(`${key.padEnd(14)} ${String(chainId).padEnd(9)} ${dir.feeds.length} feeds, no ${base}/USD`);
    continue;
  }

  let clients;
  try {
    clients = clientsFor(key);
  } catch (e) {
    row.note = `no RPC endpoints: ${errText(e)}`;
    rows.push(row);
    continue;
  }
  // Prove which chain we are reading before believing anything it says.
  try {
    const { value: id, endpoint } = await withFallback(clients, (c) => c.getChainId());
    row.readChainId = id;
    row.readEndpoint = endpoint;
    if (id !== chainId) {
      row.note = `endpoint answered chain id ${id}, expected ${chainId} — nothing verified`;
      rows.push(row);
      console.error(`${key}: WRONG CHAIN (${id})`);
      continue;
    }
  } catch (e) {
    row.note = `chain unreachable: ${errText(e)}`;
    rows.push(row);
    console.error(`${key.padEnd(14)} ${String(chainId).padEnd(9)} unreachable`);
    continue;
  }

  const verified = [];
  for (const entry of candidates) {
    const proxy = getAddress(entry.proxyAddress);
    const path = String(entry.path ?? "");
    const variant = path === `${base.toLowerCase()}-usd` ? "canonical" : /svr/i.test(path) ? "svr" : "other";
    const shared = {
      proxyAddress: proxy,
      secondaryProxyAddress: entry.secondaryProxyAddress ? getAddress(entry.secondaryProxyAddress) : null,
      path,
      variant,
      feedName: entry.name ?? null,
      assetName: entry.assetName || null,
      marketHours: entry.docs?.marketHours ?? null,
      feedCategory: entry.feedCategory || null,
      decimals: Number(entry.decimals),
      heartbeat: Number(entry.heartbeat),
      thresholdPercent: entry.threshold ?? null,
      contractVersion: Number(entry.contractVersion ?? 0) || null,
    };
    const v = await verifyAggregator(clients, proxy, entry, base, nowSeconds);
    if (!v.ok) {
      row.rejected.push({ ...shared, reason: v.reasons.join("; ") });
      console.error(`  REJECT ${key} ${base.padEnd(6)} ${proxy} — ${v.reasons.join("; ")}`);
      continue;
    }
    verified.push({
      ...shared,
      description: v.description,
      codeSize: v.codeSize,
      verifiedRoundId: v.roundId,
      verifiedAnswer: v.answer,
      verifiedUpdatedAt: v.updatedAt,
      verifiedAgeSeconds: v.ageSeconds,
      verifiedEndpoint: v.endpoint,
    });
  }

  if (verified.length === 0) {
    row.note = row.note ?? `${candidates.length} ${base}/USD candidate(s), none verified — see rejected`;
    rows.push(row);
    continue;
  }

  // Canonical path first; then the lower `decimals` (8 is what every consumer in this repo
  // already handles and what `ChainlinkPriceBandAdapter` is written around); then the
  // shorter heartbeat, which is the feed that promises to move sooner.
  const rank = (f) => (f.variant === "canonical" ? 0 : f.variant === "svr" ? 1 : 2);
  verified.sort((a, b) => rank(a) - rank(b) || a.decimals - b.decimals || a.heartbeat - b.heartbeat);
  row.selected = verified[0];
  row.alternatives = verified.slice(1);
  rows.push(row);
  console.error(
    `${key.padEnd(14)} ${String(chainId).padEnd(9)} ${base.padEnd(6)} ${row.selected.proxyAddress} ` +
      `${row.selected.variant.padEnd(9)} dec=${row.selected.decimals} hb=${row.selected.heartbeat} ` +
      `age=${row.selected.verifiedAgeSeconds}s  alt=${row.alternatives.length} rej=${row.rejected.length}`,
  );
}

/* ------------------------------------------------------------------- emit */

const q = (s) => JSON.stringify(String(s));
const qn = (v) => (v === null || v === undefined ? "null" : JSON.stringify(v));

function emitChainlink(f, indent) {
  const i = " ".repeat(indent);
  return [
    `${i}{`,
    `${i}  proxyAddress: ${q(f.proxyAddress)},`,
    `${i}  secondaryProxyAddress: ${qn(f.secondaryProxyAddress)},`,
    `${i}  path: ${q(f.path)},`,
    `${i}  variant: ${q(f.variant)},`,
    `${i}  feedName: ${qn(f.feedName)},`,
    `${i}  assetName: ${qn(f.assetName)},`,
    `${i}  marketHours: ${qn(f.marketHours)},`,
    `${i}  feedCategory: ${qn(f.feedCategory)},`,
    `${i}  decimals: ${f.decimals},`,
    `${i}  heartbeat: ${f.heartbeat},`,
    `${i}  thresholdPercent: ${qn(f.thresholdPercent)},`,
    `${i}  contractVersion: ${qn(f.contractVersion)},`,
    `${i}  description: ${q(f.description)},`,
    `${i}  codeSize: ${f.codeSize},`,
    `${i}  verifiedRoundId: ${q(f.verifiedRoundId)},`,
    `${i}  verifiedAnswer: ${q(f.verifiedAnswer)},`,
    `${i}  verifiedUpdatedAt: ${f.verifiedUpdatedAt},`,
    `${i}  verifiedAgeSeconds: ${f.verifiedAgeSeconds},`,
    `${i}},`,
  ].join("\n");
}

function emitRow(r) {
  const L = [];
  L.push(`  ${r.chainId}: {`);
  L.push(`    chainId: ${r.chainId},`);
  L.push(`    chainKey: ${q(r.key)},`);
  L.push(`    chainName: ${q(r.chainName ?? r.key)},`);
  L.push(`    testnet: ${r.testnet},`);
  L.push(`    native: {`);
  L.push(`      symbol: ${q(r.native.symbol)},`);
  L.push(`      decimals: ${r.native.decimals},`);
  L.push(`      inferred: ${r.native.inferred},`);
  L.push(`      source: ${q(r.native.source)},`);
  L.push(`    },`);
  if (r.selected) {
    L.push(`    chainlink: ${emitChainlink(r.selected, 4).trimStart()}`);
  } else {
    L.push(`    chainlink: null,`);
  }
  L.push(`    chainlinkAlternatives: [`);
  for (const a of r.alternatives) L.push(emitChainlink(a, 6));
  L.push(`    ],`);
  L.push(`    chainlinkRejections: [`);
  for (const a of r.rejected) {
    L.push(`      { proxyAddress: ${q(a.proxyAddress)}, path: ${q(a.path)}, feedName: ${qn(a.feedName)}, decimals: ${a.decimals}, heartbeat: ${a.heartbeat}, reason: ${q(a.reason)} },`);
  }
  L.push(`    ],`);
  if (r.pyth) {
    L.push(`    pyth: {`);
    L.push(`      priceFeedId: ${q(r.pyth.priceFeedId)},`);
    L.push(`      hermesSymbol: ${qn(r.pyth.hermesSymbol)},`);
    L.push(`      displaySymbol: ${qn(r.pyth.displaySymbol)},`);
    L.push(`      description: ${qn(r.pyth.description)},`);
    L.push(`      priceCheck: ${q(r.pyth.priceCheck)},`);
    L.push(`      verifiedPrice: ${qn(r.pyth.verifiedPrice)},`);
    L.push(`      verifiedExpo: ${qn(r.pyth.verifiedExpo)},`);
    L.push(`      verifiedPublishTime: ${qn(r.pyth.verifiedPublishTime)},`);
    L.push(`      verifiedAgeSeconds: ${qn(r.pyth.verifiedAgeSeconds)},`);
    L.push(`    },`);
  } else {
    L.push(`    pyth: null,`);
  }
  L.push(`    pythRejection: ${qn(r.pythRejection)},`);
  const curated = CURATED_NOTES[r.chainId];
  const note = [r.note, curated].filter(Boolean).join(" — ") || null;
  L.push(`    note: ${qn(note)},`);
  L.push(`    directoryUrl: ${qn(r.directoryUrl ?? null)},`);
  L.push(`    verifiedEndpoint: ${qn(r.readEndpoint ?? null)},`);
  L.push(`  },`);
  return L.join("\n");
}

const header = `// SPDX-License-Identifier: MIT
/* ============================================================================
   NATIVE-CURRENCY / USD PRICE SOURCES, PER CHAIN.

   GENERATED by \`scripts/generate-native-feeds.mjs\` — do not edit by hand.
   Regenerate with \`npm run generate:nativefeeds\`; \`--check\` fails when the ADDRESSES
   OR SCALES in this file no longer match the chain (the timestamps are expected to
   move, so they are not part of that comparison).

   WHAT IT IS FOR. The launch wizard is market-cap-first and defaults to a
   $3.5K-equivalent opening market cap on every chain (CLAUDE.md, owner decision
   2026-09-20). Turning "$3,500" into a price per token needs exactly one number per
   chain: what one unit of the chain's native currency is worth in dollars. This table
   is where that number's SOURCES live; \`src/price/\` is where they are read.

   HOW EVERY CHAINLINK ROW WAS ESTABLISHED. Chainlink's reference-data directory said
   which address to go and look at. Then the address itself was read: it has code,
   \`decimals()\` agrees with the directory, \`description()\` names the base asset on a
   word boundary, and \`latestRoundData()\` returned a positive, complete, non-future
   round inside its own heartbeat plus {@link STALE_GRACE_SECONDS}. A candidate that
   failed any of those is in \`chainlinkRejections\` with the reason, NOT in \`chainlink\`.
   The directory is trusted for which addresses to look at and for the heartbeat and
   deviation threshold, which have no on-chain counterpart. It is trusted for nothing
   else.

   HOW EVERY PYTH ROW WAS ESTABLISHED. The price-feed id was not typed from memory: it
   was found by querying Hermes' own \`v2/price_feeds\` for the symbol and taking the id
   whose \`attributes.base\` and \`quote_currency\` match, then read back through
   \`v2/updates/price/latest\` to prove the id resolves to a live, positive price. That
   is verification against Pyth's own service and is WEAKER than an on-chain read — see
   the tier note below.

   THE TIERS, AND WHY THEY ARE NOT INTERCHANGEABLE
   -----------------------------------------------
   TIER 1  Chainlink aggregator, read on chain with \`eth_call\`. The answer is a value
           that exists in state at a block, so it has a block number, a round id and an
           audit trail, and it is the source this repository already trusts everywhere
           else (\`ChainlinkPriceBandAdapter\`, \`src/rwa/\`).

   TIER 2  Pyth, read from the Hermes HTTP service. Hermes hands back a signed update
           that anyone COULD post on chain — nothing says anyone has. So there is no
           block, no finality and no on-chain audit trail, and a compromised or merely
           wrong HTTP response is not caught by anything downstream. Acceptable for a
           UI default a human reviews before signing; NEVER to be shown as though it
           were an on-chain reading, and never to be fed to a contract.

   TIER 3  A Latch native/stablecoin pool on our own core. UNIMPLEMENTED ON PURPOSE —
           see \`src/price/pool.ts\` for the reason, which is that the honest version of
           it needs a time-weighted average and a depth floor that Latch cannot supply
           today.

   TIER 4  No source. The caller defaults in NATIVE units and shows no dollars at all.
           This is a correct and expected answer for several chains and must never be
           papered over with a number from somewhere else.

   WHAT A RECORD IS NOT
   --------------------
     * NOT a promise the feed is publishing NOW. \`verifiedAgeSeconds\` is one reading on
       one day. Every consumer re-checks the age against \`staleAfterSeconds()\` at read
       time; the table is a list of addresses worth asking, not a price.
     * NOT a token address. Chainlink publishes the feed, never an ERC-20.
     * NOT interchangeable with \`deployments/stockFeeds.ts\`. That file is tokenised
       EQUITIES on a trading session; everything here is \`marketHours: "Crypto"\`, which
       is 24/7/365. The difference changes what staleness MEANS: a stale equity feed on
       a Saturday is the schedule working, a stale crypto feed at any hour is a fault.
       That is why this generator rejects a stale candidate and the stock one does not.

   THE NATIVE CURRENCY'S SYMBOL AND DECIMALS ARE NOT ON-CHAIN FACTS. There is no
   contract to ask. They come from \`chainid.network/chains.json\` — the source
   \`scripts/harvest-rpcs.mjs\` already uses — and every record carries the exact entry
   it came from in \`native.source\`. Where chains.json is wrong or absent for one of our
   chains, \`native.inferred\` is true and \`native.source\` says what was done instead.
   ============================================================================ */

/** Which of the four tiers an answer came from. See the header. */
export type NativeUsdTier = "chainlink-onchain" | "pyth-hermes" | "latch-pool-twap" | "none";

/**
 * Which Chainlink aggregator a row points at, when a chain publishes several.
 *
 * \`canonical\`  the directory path is exactly \`<base>-usd\`: the standard Data Feed.
 * \`svr\`        a Smart Value Recapture feed (\`-svr\`, \`-shared-svr\`, \`-shared-svr-2\`).
 *              The same price data delivered through an OEV auction, so an update can
 *              land later on chain than the standard feed's. Selected only where it is
 *              the ONLY aggregator for the pair on that chain, which today means
 *              Robinhood and Arc.
 * \`other\`      neither — recorded rather than guessed at.
 */
export type ChainlinkFeedVariant = "canonical" | "svr" | "other";

/** One verified Chainlink native/USD aggregator. */
export interface ChainlinkNativeFeed {
  /** The proxy a consumer calls. Never the implementation behind it. */
  readonly proxyAddress: \`0x\${string}\`;
  /** Chainlink's second published proxy for the same feed, where there is one. */
  readonly secondaryProxyAddress: \`0x\${string}\` | null;
  /** The directory's path slug, e.g. "eth-usd" or "eth-usd-shared-svr". */
  readonly path: string;
  readonly variant: ChainlinkFeedVariant;
  /** The directory's feed name, e.g. "ETH / USD". */
  readonly feedName: string | null;
  readonly assetName: string | null;
  /** Chainlink's trading-session profile, verbatim. "Crypto" on every row here. */
  readonly marketHours: string | null;
  /** Chainlink's own risk category: "low", "medium", "new", "deprecating". */
  readonly feedCategory: string | null;
  /** \`decimals()\`, READ FROM THE AGGREGATOR and cross-checked against the directory. */
  readonly decimals: number;
  /** Seconds Chainlink undertakes to publish within, even if the price does not move. */
  readonly heartbeat: number;
  /** Price move, in percent, that triggers a round before the heartbeat expires. */
  readonly thresholdPercent: number | null;
  readonly contractVersion: number | null;
  /** \`description()\`, read from the aggregator. This is the string that proves identity. */
  readonly description: string;
  /** Bytes of runtime code at the proxy, at verification. Non-zero proves it is not an EOA. */
  readonly codeSize: number;
  readonly verifiedRoundId: string;
  /** \`latestRoundData().answer\` at verification, base-10, scaled by \`decimals\`. */
  readonly verifiedAnswer: string;
  /** \`latestRoundData().updatedAt\` at verification, unix seconds. */
  readonly verifiedUpdatedAt: number;
  /** How old that round was when it was read. Always within \`heartbeat\` + grace, or the row would not exist. */
  readonly verifiedAgeSeconds: number;
}

/**
 * One Pyth price feed IDENTIFIER, established against Hermes' metadata endpoint.
 *
 * It is an id, not a price. \`v2/price_feeds\` (open, keyless, HTTP 200) was queried for the
 * symbol and this is the single entry whose \`attributes.symbol\` is exactly
 * \`Crypto.<SYMBOL>/USD\`; a query that matched more than one was refused rather than
 * resolved by picking.
 *
 * \`verifiedPrice\` is usually null and \`priceCheck\` says why: as of 2026-09-20 Hermes'
 * PRICE endpoints (\`v2/updates/price/latest\`, \`api/latest_price_feeds\`) answer
 * \`401 unauthorized\` without a credential, on the documented public host and on
 * hermes-beta alike. Only the metadata endpoint is still keyless. So an off-chain Hermes
 * read is not a route this SDK can take without a key, and tier 2 reads the Pyth CONTRACT
 * on chain instead — see \`src/price/pyth.ts\`.
 */
export interface PythNativeFeed {
  /** Pyth's 32-byte price-feed id, \`0x\`-prefixed. This is the part that was verified. */
  readonly priceFeedId: \`0x\${string}\`;
  /** Hermes' own symbol for the feed, e.g. "Crypto.ETH/USD". The string that was matched. */
  readonly hermesSymbol: string | null;
  readonly displaySymbol: string | null;
  readonly description: string | null;
  /** What happened when a price read was attempted: "read and sane", or the failure. */
  readonly priceCheck: string;
  /** \`price.price\` at verification, base-10, scaled by \`10 ** verifiedExpo\`. Null when unread. */
  readonly verifiedPrice: string | null;
  /** \`price.expo\`, negative in practice. Null when unread. */
  readonly verifiedExpo: number | null;
  readonly verifiedPublishTime: number | null;
  readonly verifiedAgeSeconds: number | null;
}

/** A candidate that was read and REFUSED, with the reason, so a diff shows what changed. */
export interface ChainlinkNativeFeedRejection {
  readonly proxyAddress: \`0x\${string}\`;
  readonly path: string;
  readonly feedName: string | null;
  readonly decimals: number;
  readonly heartbeat: number;
  readonly reason: string;
}

/** What the chain's native currency is. NOT an on-chain fact — see the header. */
export interface NativeCurrencyFact {
  readonly symbol: string;
  readonly decimals: number;
  /** True when the value could not be read for this chain id and was taken from elsewhere. */
  readonly inferred: boolean;
  /** Exactly where it came from, quoted, so a wrong one is arguable rather than mysterious. */
  readonly source: string;
}

/** One chain's whole native/USD survey: what exists, what was refused, and why. */
export interface NativeFeedRecord {
  readonly chainId: number;
  readonly chainKey: string;
  readonly chainName: string;
  readonly testnet: boolean;
  readonly native: NativeCurrencyFact;
  /** The selected tier-1 source, or \`null\` when the chain has none. */
  readonly chainlink: ChainlinkNativeFeed | null;
  /** Other VERIFIED aggregators for the same pair, not selected. Kept so the choice is auditable. */
  readonly chainlinkAlternatives: readonly ChainlinkNativeFeed[];
  readonly chainlinkRejections: readonly ChainlinkNativeFeedRejection[];
  /** The tier-2 source, or \`null\`. Probed on every chain, not only the ones Chainlink misses. */
  readonly pyth: PythNativeFeed | null;
  /** Why there is no Pyth row, when there is none. */
  readonly pythRejection: string | null;
  /** Why there is no Chainlink row, when there is none. */
  readonly note: string | null;
  readonly directoryUrl: string | null;
  /** The RPC endpoint that answered the verification reads. */
  readonly verifiedEndpoint: string | null;
}
`;

const body = [
  header.trimEnd(),
  "",
  `/** When the table below was produced. Every \`verified*\` number is one reading at this instant. */`,
  `export const NATIVE_FEEDS_VERIFIED_AT = ${q(startedAt.toISOString())};`,
  ``,
  `/** The same instant as a unix second, so an age can be recomputed without parsing a string. */`,
  `export const NATIVE_FEEDS_VERIFIED_INSTANT = ${nowSeconds};`,
  ``,
  `/** Chainlink's reference-data directory, the document the addresses came from. */`,
  `export const NATIVE_FEED_DIRECTORY_BASE = ${q(DIRECTORY_BASE)};`,
  ``,
  `/** Pyth's Hermes service, the endpoint the tier-2 ids and prices came from. */`,
  `export const PYTH_HERMES_BASE = ${q(HERMES_BASE)};`,
  ``,
  `/**`,
  ` * Grace added to a feed's own heartbeat before an answer is called stale, in seconds.`,
  ` *`,
  ` * \`updatedAt\` is the timestamp of the block that INCLUDED the update, not of the`,
  ` * observation, so a feed publishing exactly on its heartbeat can still read a little over`,
  ` * it through block-time jitter and sequencer timestamp latitude. Five minutes absorbs that`,
  ` * on every chain here and is negligible against a 3,600 s or 86,400 s heartbeat; against`,
  ` * BNB's 27 s heartbeat the grace dominates, which is correct — one missed 27-second beat`,
  ` * is noise, not a fault.`,
  ` *`,
  ` * The generator applies exactly this constant when it decides whether to ship a feed, so`,
  ` * the committed table and the runtime reader cannot drift apart.`,
  ` */`,
  `export const STALE_GRACE_SECONDS = ${STALE_GRACE_SECONDS};`,
  ``,
  `/** Every chain that was surveyed, whether or not a source was found. */`,
  `export const NATIVE_FEEDS: Readonly<Record<number, NativeFeedRecord>> = {`,
  ...rows.map(emitRow),
  `};`,
  ``,
  `/** Every chain this survey covers, whether or not it found anything. */`,
  `export const NATIVE_FEED_CHAIN_IDS: readonly number[] = Object.values(NATIVE_FEEDS)`,
  `  .map((r) => r.chainId)`,
  `  .sort((a, b) => a - b);`,
  ``,
  `/**`,
  ` * Chain ids the SDK can price UNAIDED — a verified Chainlink aggregator it can read with`,
  ` * nothing but an RPC endpoint. This is the only list a caller should treat as "we have a`,
  ` * price here": a Pyth id is an identifier, not a reachable source, until somebody supplies`,
  ` * a verified Pyth contract address for that chain.`,
  ` */`,
  `export const NATIVE_USD_TIER1_CHAIN_IDS: readonly number[] = Object.values(NATIVE_FEEDS)`,
  `  .filter((r) => r.chainlink !== null)`,
  `  .map((r) => r.chainId)`,
  `  .sort((a, b) => a - b);`,
  ``,
  `/**`,
  ` * Chain ids with a verified Pyth price-feed ID and no Chainlink aggregator. Reaching the`,
  ` * price still needs a Pyth contract address on that chain, which this survey does NOT`,
  ` * supply — see \`src/price/pyth.ts\`.`,
  ` */`,
  `export const NATIVE_USD_PYTH_ONLY_CHAIN_IDS: readonly number[] = Object.values(NATIVE_FEEDS)`,
  `  .filter((r) => r.chainlink === null && r.pyth !== null)`,
  `  .map((r) => r.chainId)`,
  `  .sort((a, b) => a - b);`,
  ``,
  `/** Chain ids that were surveyed and where nothing at all was found. */`,
  `export const NATIVE_USD_NO_SOURCE_CHAIN_IDS: readonly number[] = Object.values(NATIVE_FEEDS)`,
  `  .filter((r) => r.chainlink === null && r.pyth === null)`,
  `  .map((r) => r.chainId)`,
  `  .sort((a, b) => a - b);`,
  ``,
  `/** The survey row for \`chainId\`; \`undefined\` when the chain was never surveyed. */`,
  `export function nativeFeedFor(chainId: number): NativeFeedRecord | undefined {`,
  `  return NATIVE_FEEDS[chainId];`,
  `}`,
  ``,
  `/**`,
  ` * When an answer from \`feed\` stops being usable, in seconds of age.`,
  ` *`,
  ` * The feed's own published heartbeat plus {@link STALE_GRACE_SECONDS}. It is the feed's`,
  ` * number, not ours: a consumer that picks its own threshold is picking a number the`,
  ` * publisher never agreed to.`,
  ` */`,
  `export function staleAfterSeconds(feed: ChainlinkNativeFeed): number {`,
  `  return feed.heartbeat + STALE_GRACE_SECONDS;`,
  `}`,
  ``,
].join("\n");

if (REPORT_ONLY) {
  console.log(body);
  process.exit(0);
}

const existing = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, "utf8") : "";
// The verification timestamps change on every run, so a byte comparison would always be
// "stale". --check compares the parts that are a CLAIM: the addresses and the scales.
const claimOf = (s) =>
  s
    .split("\n")
    .filter((l) => /proxyAddress|priceFeedId|decimals:|heartbeat:|variant:|path:|symbol:/.test(l))
    .join("\n");

if (CHECK) {
  if (claimOf(existing) !== claimOf(body)) {
    console.error("nativeFeeds.ts is STALE — the addresses or scales on chain differ from the committed table.");
    process.exit(1);
  }
  console.error("nativeFeeds.ts is current.");
  process.exit(0);
}

writeFileSync(OUT_FILE, body);
console.error(`\nwrote ${OUT_FILE}`);
console.error(
  `${rows.filter((r) => r.selected).length}/${rows.length} chains with a verified Chainlink feed; ` +
    `${rows.filter((r) => !r.selected && r.pyth).length} with Pyth only; ` +
    `${rows.filter((r) => !r.selected && !r.pyth).length} with no source.`,
);
