// Generates `src/deployments/stockFeeds.ts` — the Chainlink price feeds for TOKENISED
// EQUITIES on the chains Latch deploys on, every one of them READ FROM THE CHAIN before
// it is written down.
//
// Run:  node scripts/generate-stock-feeds.mjs                 # fetch, verify, write
//       node scripts/generate-stock-feeds.mjs --check         # fail if the file is stale
//       node scripts/generate-stock-feeds.mjs --refresh       # ignore the download cache
//       node scripts/generate-stock-feeds.mjs --chains=robinhood,base
//       node scripts/generate-stock-feeds.mjs --report        # print the facts, write nothing
//
// ---------------------------------------------------------------------------
// WHY THE LIST IS GENERATED AND COMMITTED, AND NEVER FETCHED AT RUNTIME
// ---------------------------------------------------------------------------
// Chainlink's reference-data directory decides which ticker a feed claims to price. If
// the SDK read it live, whoever can edit that document could change what a Latch UI calls
// a stock, and what a price band is measured against, between one page load and the next.
// So it is downloaded here, verified against the chain here, and committed as source that
// a human reads in a diff. `docs.chain.link/data-feeds/tokenized-equity-feeds` — the page
// the owner pointed at — is JS-rendered and its tables are not fetchable; the directory
// JSON behind it is, and it is the same data.
//
// ---------------------------------------------------------------------------
// WHAT THE DIRECTORY IS TRUSTED FOR, AND WHAT IT IS NOT
// ---------------------------------------------------------------------------
// Trusted for: which addresses to go and look at, and the metadata that has no on-chain
// counterpart (asset class, market-hours profile, deviation threshold, feed category).
// NOT trusted for: decimals, the description, or that the feed is alive. Each of those is
// read from the aggregator itself and a disagreement REJECTS the feed rather than being
// written down. A feed that cannot be read at all is rejected too: "we could not check
// this one" is not a pass.
//
// The rejections are committed alongside the survivors, with their reasons, because a
// list that silently drops rows teaches nobody anything.
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE CANNOT GIVE YOU
// ---------------------------------------------------------------------------
// A feed address is not a token address. Chainlink publishes the PRICE FEED for a
// tokenised equity and never the ERC-20 the price is about. The stock tokens live in
// `src/deployments/stocks.ts`, sourced from each issuer and verified separately. Joining
// the two is `stockFeedForTicker` in `src/rwa/`, and on several chains the join is empty
// in one direction or the other. That gap is real and is stated, not papered over.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const CACHE_DIR = join(HERE, ".cache", "chainlink");
const OUT_FILE = join(ROOT, "src", "deployments", "stockFeeds.ts");

/* ------------------------------------------------------------------ inputs */

/**
 * Every chain Latch targets, INCLUDING the ones with no equity feed, so the table records
 * that somebody looked. `file` is the directory document; `null` means no such document
 * exists (checked, not assumed — see `MISSING_DIRECTORY_PROBES` in the emitted file).
 *
 * The file names are not guessable from the chain name: X Layer is
 * `feeds-ethereum-mainnet-xlayer-1`, Robinhood is `feeds-robinhood-mainnet`. Each was
 * confirmed by fetching it and reading the `docs.blockchainName` inside.
 */
const CHAINS = {
  ethereum: { chainId: 1, file: "feeds-mainnet" },
  bsc: { chainId: 56, file: "feeds-bsc-mainnet" },
  base: { chainId: 8453, file: "feeds-ethereum-mainnet-base-1" },
  robinhood: { chainId: 4663, file: "feeds-robinhood-mainnet" },
  ink: { chainId: 57073, file: "feeds-ethereum-mainnet-ink-1" },
  linea: { chainId: 59144, file: "feeds-ethereum-mainnet-linea-1" },
  xlayer: { chainId: 196, file: "feeds-ethereum-mainnet-xlayer-1" },
  hyperevm: { chainId: 999, file: "feeds-hyperliquid-mainnet" },
  monad: { chainId: 143, file: "feeds-monad-mainnet" },
  plasma: { chainId: 9745, file: "feeds-plasma-mainnet" },
};

const DIRECTORY_BASE = "https://reference-data-directory.vercel.app";

/**
 * The asset classes that are an EQUITY-LIKE instrument with a trading session.
 *
 * `Equity` is the common one. `TokenizedEquities` is what Ink's entries carry for exactly
 * the same kind of feed — a filter on `Equity` alone silently loses them, which is why the
 * class is recorded verbatim on every record rather than normalised away.
 *
 * `ETF` is included because SPY and QQQ are already in the Latch stock-token registry on
 * three chains: excluding the class would leave those tokens with no price source while
 * the identical instrument, listed as `Equity` on Robinhood, kept one. Commodity (XAU,
 * XAG, WTI) and the fund/treasury classes are NOT stocks and are out.
 */
const EQUITY_CLASSES = new Set(["Equity", "TokenizedEquities", "ETF"]);

/* ---------------------------------------------------------------------------
   FRESHNESS IS NOT A STRUCTURAL CHECK, AND FINDING THAT OUT COST A RUN
   ---------------------------------------------------------------------------
   The first version of this script rejected any feed whose latest answer was older
   than its own heartbeat, on the reasoning that `ChainlinkPriceBandAdapter.refresh`
   rejects exactly that (`AnswerTooOld`). Run on a Saturday, that rejected 49 of 49
   feeds on Robinhood, Base and Ink — and the reason was not that they are broken.
   Their last rounds landed between 23:10 and 23:52 UTC on the Friday, which is
   19:10–19:52 New York time: minutes before the `us_equities_24/5` weekly close at
   Friday 20:00 ET. The feeds had stopped because the market had.

   So the checks are split, and both verdicts are committed:

     STRUCTURAL — code at the address, the three ABI methods answer, `decimals()`
       agrees with the directory, `description()` names the asset, the answer is
       positive, the round is complete and not in the future. A failure here is a
       REJECTION: the record would be a claim nobody checked.

     FRESHNESS — age against the heartbeat. Recorded on the record as
       `freshAtVerification` and `verifiedAgeSeconds`, never a rejection. Stale
       outside a session is the schedule working. Stale INSIDE one would be a real
       fault, which is why the run's own timestamp is committed too: a reader can
       tell which kind of run produced the row.

   The consequence for a deployment is the interesting half and it is stated in
   `src/rwa/`: a pool whose band oracle is one of these feeds WILL fail
   `AnswerTooOld` all weekend at any heartbeat under about 65 hours. That is the
   correct behaviour — the session gate should have closed the pool anyway — but it
   means the band and the session must be configured together, not separately.
   --------------------------------------------------------------------------- */

/** Clock skew tolerated on `updatedAt` before it is called a future timestamp. */
const FUTURE_SKEW_SECONDS = 120;

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
  const res = await fetch(url);
  if (!res.ok) return { url, feeds: null, status: res.status, cached: false };
  const text = await res.text();
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cached, text);
  return { url, feeds: JSON.parse(text), cached: false };
}

/**
 * The exchange ticker, from `docs.baseAsset`, by an ENUMERATED rule — never a regex that
 * happens to fit. The rule applied is recorded on every record, so a wrong one is visible
 * in the diff instead of hidden in a transformation.
 */
function deriveTicker(baseAsset, assetName) {
  const b = String(baseAsset ?? "");
  // Backed's wrapped xStocks: `wNVDAx` is a wrapper share whose underlying is NVDA.
  if (/^w[A-Z0-9]{1,8}x$/.test(b)) return { ticker: b.slice(1, -1), rule: "backed-wrapper" };
  // Ondo Global Markets: the `on` suffix is the issuer's, not part of the ticker.
  if (/^[A-Z0-9]{1,8}(on|ON)$/.test(b) && b.length > 2) return { ticker: b.slice(0, -2), rule: "ondo-suffix" };
  // Robinhood's own entries are mostly bare tickers; `RHDELL` is the exception.
  if (/^RH[A-Z]{2,6}$/.test(b) && String(assetName ?? "").toUpperCase().includes(b.slice(2))) {
    return { ticker: b.slice(2), rule: "rh-prefix" };
  }
  return { ticker: b, rule: "verbatim" };
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
  { type: "function", name: "aggregator", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
];

function clientsFor(key) {
  const cfg = CHAIN_RPCS[key];
  if (!cfg) throw new Error(`no endpoints for chain key ${key}`);
  return cfg.endpoints.map((e) => ({
    url: e.url,
    client: createPublicClient({ transport: http(e.url, { timeout: 20_000, retryCount: 0 }) }),
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
 * Every check below is one the price-band adapter also makes, or one whose failure would
 * make the adapter's own check meaningless:
 *   code      — `configureFeed` calls `decimals()`; an EOA answers nothing
 *   decimals  — the adapter stores it and re-checks it on every refresh (`DecimalsChanged`)
 *   answer    — `NonPositiveAnswer`, `IncompleteRound`
 *   age       — `AnswerTooOld(updatedAt, heartbeat, now)`
 *   ticker    — not the adapter's business, but it is OUR claim: a record that says NVDA
 *               and a contract that describes itself as something else is the one error
 *               nobody downstream can catch.
 */
async function verifyAggregator(clients, address, entry, ticker, nowSeconds) {
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
  // The description must name EITHER the directory's base asset verbatim ("SPYon",
  // "wNVDAx") or the ticker derived from it ("DELL" for base asset "RHDELL", whose feed
  // describes itself "Robinhood DELL-USD"). The derived form is matched on a boundary so
  // that a two-letter ticker cannot match a substring of an unrelated word.
  const base = String(entry.docs?.baseAsset ?? "").toUpperCase();
  const desc = String(out.description ?? "").toUpperCase();
  const bounded = new RegExp(`(^|[^A-Z0-9])${ticker.toUpperCase().replace(/[^A-Z0-9]/g, "")}([^A-Z0-9]|$)`);
  if (!base || !(desc.includes(base) || bounded.test(desc))) {
    out.reasons.push(
      `description "${out.description}" names neither the base asset "${entry.docs?.baseAsset}" nor the ticker "${ticker}"`,
    );
  }
  if (answer <= 0n) out.reasons.push(`non-positive answer ${answer}`);
  if (roundId === 0n) out.reasons.push("round id 0");
  if (startedAt === 0n || updatedAt === 0n) out.reasons.push("incomplete round (startedAt or updatedAt is 0)");
  if (out.updatedAt > nowSeconds + FUTURE_SKEW_SECONDS) {
    out.reasons.push(`updatedAt ${out.updatedAt} is in the future (now ${nowSeconds})`);
  }
  const heartbeat = Number(entry.heartbeat ?? 0);
  if (!heartbeat) out.reasons.push("directory gives no heartbeat");

  // Freshness: recorded, never a rejection. See the note at the top of this file.
  out.fresh = heartbeat > 0 && out.ageSeconds <= heartbeat;

  out.ok = out.reasons.length === 0;
  return out;
}

/* --------------------------------------------------------------------- run */

const startedAt = new Date();
const nowSeconds = Math.floor(startedAt.getTime() / 1000);
const chains = [];

for (const key of CHAIN_KEYS) {
  const { chainId } = CHAINS[key];
  const row = { key, chainId, feeds: [], rejected: [], candidates: 0 };
  const dir = await directory(key);
  row.directoryUrl = dir.url;
  row.directoryCached = dir.cached;
  if (!dir.feeds) {
    row.directoryStatus = dir.status ?? 0;
    row.note = `no directory document (HTTP ${dir.status})`;
    chains.push(row);
    console.error(`${key.padEnd(10)} ${String(chainId).padEnd(8)} directory HTTP ${dir.status}`);
    continue;
  }
  row.directoryEntries = dir.feeds.length;

  const candidates = dir.feeds.filter((f) => {
    const d = f.docs ?? {};
    if (!EQUITY_CLASSES.has(d.assetClass)) return false;
    // A proof-of-reserve feed is not a price. It carries no quote asset and no session.
    if (d.productTypeCode === "PoR") return false;
    if (!d.quoteAsset || !d.marketHours) return false;
    return Boolean(f.proxyAddress);
  });
  row.candidates = candidates.length;
  if (candidates.length === 0) {
    chains.push(row);
    console.error(`${key.padEnd(10)} ${String(chainId).padEnd(8)} ${dir.feeds.length} feeds, 0 equity`);
    continue;
  }

  let clients;
  try {
    clients = clientsFor(key);
  } catch (e) {
    row.note = `no RPC endpoints: ${errText(e)}`;
    chains.push(row);
    continue;
  }
  // Prove which chain we are reading before believing anything it says.
  try {
    const { value: id, endpoint } = await withFallback(clients, (c) => c.getChainId());
    row.readChainId = id;
    row.readEndpoint = endpoint;
    if (id !== chainId) {
      row.note = `endpoint answered chain id ${id}, expected ${chainId} — nothing verified`;
      chains.push(row);
      console.error(`${key}: WRONG CHAIN (${id})`);
      continue;
    }
  } catch (e) {
    row.note = `chain unreachable: ${errText(e)}`;
    chains.push(row);
    console.error(`${key}: unreachable`);
    continue;
  }

  for (const entry of candidates) {
    const proxy = getAddress(entry.proxyAddress);
    const { ticker, rule } = deriveTicker(entry.docs.baseAsset, entry.assetName);
    const v = await verifyAggregator(clients, proxy, entry, ticker, nowSeconds);
    const shared = {
      ticker,
      tickerRule: rule,
      baseAsset: entry.docs.baseAsset,
      quoteAsset: entry.docs.quoteAsset,
      feedName: entry.name,
      assetName: entry.assetName || null,
      assetClass: entry.docs.assetClass,
      marketHours: entry.docs.marketHours,
      productSubType: entry.docs.productSubType ?? null,
      productTypeCode: entry.docs.productTypeCode ?? null,
      prices: entry.docs.productTypeCode === "primaryTokenizedPrice" ? "tokenized-instrument" : "underlying-share",
      feedCategory: entry.feedCategory || null,
      proxyAddress: proxy,
      secondaryProxyAddress: entry.secondaryProxyAddress ? getAddress(entry.secondaryProxyAddress) : null,
      decimals: Number(entry.decimals),
      heartbeat: Number(entry.heartbeat ?? 0),
      thresholdPercent: entry.threshold ?? null,
    };
    if (!v.ok) {
      row.rejected.push({ ...shared, reasons: v.reasons });
      console.error(`  REJECT ${key} ${ticker.padEnd(8)} ${proxy} — ${v.reasons.join("; ")}`);
      continue;
    }
    // The SVR/secondary proxy is verified too when there is one: it is an address a
    // deployer may reasonably choose, so shipping it unread would be shipping a guess.
    let secondary = null;
    if (shared.secondaryProxyAddress) {
      const s = await verifyAggregator(clients, shared.secondaryProxyAddress, entry, ticker, nowSeconds);
      secondary = s.ok ? shared.secondaryProxyAddress : null;
      if (!s.ok) row.rejected.push({ ...shared, proxyAddress: shared.secondaryProxyAddress, secondaryProxyAddress: null, reasons: [`secondary proxy: ${s.reasons.join("; ")}`] });
    }
    row.feeds.push({
      ...shared,
      secondaryProxyAddress: secondary,
      onChain: {
        description: v.description,
        decimals: v.decimals,
        answer: v.answer,
        roundId: v.roundId,
        updatedAt: v.updatedAt,
        ageSeconds: v.ageSeconds,
        fresh: v.fresh,
      },
    });
    console.error(
      `  ok     ${key} ${ticker.padEnd(8)} ${proxy} "${v.description}" age ${v.ageSeconds}s${v.fresh ? "" : "  STALE (past heartbeat)"}`,
    );
  }
  row.feeds.sort(
    (a, b) =>
      a.ticker.localeCompare(b.ticker) ||
      // token-priced before share-priced: the first is what a pool of that token needs
      Number(a.prices === "underlying-share") - Number(b.prices === "underlying-share") ||
      a.proxyAddress.localeCompare(b.proxyAddress),
  );
  row.rejected.sort((a, b) => a.ticker.localeCompare(b.ticker) || a.proxyAddress.localeCompare(b.proxyAddress));
  chains.push(row);
}

/* ------------------------------------------------------------------ report */

const pad = (s, n) => String(s).padEnd(n);
console.log("");
console.log(
  `run ${startedAt.toISOString()} (${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][startedAt.getUTCDay()]} UTC)`,
);
console.log(
  `${pad("chain", 11)}${pad("id", 8)}${pad("entries", 9)}${pad("equity", 8)}${pad("verified", 10)}${pad("fresh", 7)}rejected`,
);
for (const r of chains) {
  const fresh = r.feeds.filter((f) => f.onChain.fresh).length;
  console.log(
    `${pad(r.key, 11)}${pad(r.chainId, 8)}${pad(r.directoryEntries ?? "-", 9)}${pad(r.candidates, 8)}${pad(r.feeds.length, 10)}${pad(`${fresh}/${r.feeds.length}`, 7)}${r.rejected.length}${r.note ? `  ${r.note}` : ""}`,
  );
}
if (REPORT_ONLY) process.exit(0);

/* ------------------------------------------------------------------- emit */

const q = (s) => (s === null || s === undefined ? "null" : JSON.stringify(String(s)));

function emitFeed(f) {
  return `    {
      ticker: ${q(f.ticker)},
      baseAsset: ${q(f.baseAsset)},
      tickerRule: ${q(f.tickerRule)},
      quoteAsset: ${q(f.quoteAsset)},
      feedName: ${q(f.feedName)},
      assetName: ${q(f.assetName)},
      assetClass: ${q(f.assetClass)},
      marketHours: ${q(f.marketHours)},
      prices: ${q(f.prices)},
      productTypeCode: ${q(f.productTypeCode)},
      productSubType: ${q(f.productSubType)},
      feedCategory: ${q(f.feedCategory)},
      proxyAddress: ${q(f.proxyAddress)},
      secondaryProxyAddress: ${q(f.secondaryProxyAddress)},
      decimals: ${f.decimals},
      heartbeat: ${f.heartbeat},
      thresholdPercent: ${f.thresholdPercent === null ? "null" : f.thresholdPercent},
      description: ${q(f.onChain.description)},
      verifiedAnswer: ${q(f.onChain.answer)},
      verifiedUpdatedAt: ${f.onChain.updatedAt},
      verifiedAgeSeconds: ${f.onChain.ageSeconds},
      freshAtVerification: ${f.onChain.fresh ? "true" : "false"},
    },`;
}

function emitRejection(r) {
  return `    { ticker: ${q(r.ticker)}, proxyAddress: ${q(r.proxyAddress)}, feedName: ${q(r.feedName)}, reason: ${q(r.reasons.join("; "))} },`;
}

const day = startedAt.toISOString().slice(0, 10);
const chainBlocks = chains
  .filter((c) => c.feeds.length)
  .map((c) => `  ${c.chainId}: [\n${c.feeds.map(emitFeed).join("\n")}\n  ],`)
  .join("\n");
const rejectionBlocks = chains
  .filter((c) => c.rejected.length)
  .map((c) => `  ${c.chainId}: [\n${c.rejected.map(emitRejection).join("\n")}\n  ],`)
  .join("\n");
const surveyRows = chains
  .map(
    (c) =>
      `  { chainId: ${c.chainId}, key: ${q(c.key)}, directoryUrl: ${q(c.directoryUrl)}, directoryStatus: ${c.directoryStatus ?? 200}, directoryEntries: ${c.directoryEntries ?? 0}, equityCandidates: ${c.candidates}, verified: ${c.feeds.length}, rejected: ${c.rejected.length}${c.note ? `, note: ${q(c.note)}` : ""} },`,
  )
  .join("\n");

const header = `// SPDX-License-Identifier: MIT
/* ============================================================================
   CHAINLINK PRICE FEEDS FOR TOKENISED EQUITIES, PER CHAIN.

   GENERATED by \`scripts/generate-stock-feeds.mjs\` on ${day} — do not edit by hand.
   Regenerate with \`npm run generate:stockfeeds\`; \`--check\` fails when this file is
   stale. Every address below was READ FROM THE CHAIN on that day: the aggregator has
   code, \`decimals()\` agrees with the directory, \`description()\` names the asset, and
   \`latestRoundData()\` returned a positive, complete, non-future round. A feed that
   failed any of those is in \`STOCK_FEED_REJECTIONS\` with the reason, not here.

   FRESHNESS IS RECORDED, NOT ENFORCED. \`freshAtVerification\` says whether the round
   was inside its own heartbeat at the instant of the read, and \`false\` is the NORMAL
   answer for a tokenised-equity feed read outside its trading session: these feeds stop
   when the market does. \`STOCK_FEEDS_VERIFIED_WEEKDAY\` is committed so a reader can
   tell a weekend reading from a fault. A consumer must apply its own heartbeat check
   against the chain — \`ChainlinkPriceBandAdapter\` does, and will revert \`AnswerTooOld\`
   on any of these all weekend. See \`src/rwa/marketHours.ts\`.

   WHAT THE FEED IS ABOUT. \`prices\` separates a feed that prices the ISSUER'S TOKEN
   (\`tokenized-instrument\`) from one that prices the UNDERLYING SHARE
   (\`underlying-share\`). They are different numbers and the gap grows: on BNB Chain
   every equity feed is a share feed, while the tokens listed there are UI-multiplier
   bStocks whose raw unit stops being one share at the first split. A pool banded on the
   wrong one is wrong by that drift and nothing on chain will say so.

   WHAT A RECORD IS NOT:
     * NOT a token address. Chainlink publishes the feed, never the ERC-20 it prices.
       The stock tokens are in \`stocks.ts\`; joining them is \`src/rwa/\`.
     * NOT a promise the feed keeps answering. \`feedCategory\` "deprecating" means
       Chainlink has said it will stop; \`verifiedAgeSeconds\` is one reading on one day.
     * NOT a statement that the pair is tradable on Latch. It is one of four things a
       stock pair needs, and usually the one that is already there.

   MARKET HOURS. \`marketHours\` is Chainlink's profile name, verbatim
   ("us_equities_24/5", "NYSE", "LSE"). It is a SESSION, not a number, and mapping it
   onto \`MarketHoursHook\` is \`src/rwa/marketHours.ts\` — including the part that cannot
   be automated, which is that the module keeps UTC and an exchange keeps local time
   with daylight saving.
   ============================================================================ */

import type { Address } from "viem";

/** Chainlink's own asset-class string, verbatim. Never normalised: Ink files the same
 *  instrument as \`TokenizedEquities\` that Robinhood files as \`Equity\`, and a reader
 *  filtering on one would lose the other without noticing. */
export type StockFeedAssetClass = "Equity" | "TokenizedEquities" | "ETF";

/** Chainlink's trading-session profile name, verbatim. See \`src/rwa/marketHours.ts\`. */
export type StockFeedMarketHours = string;

/** Which rule turned \`baseAsset\` into \`ticker\`. Recorded so a wrong one shows in a diff. */
export type StockFeedTickerRule = "verbatim" | "ondo-suffix" | "backed-wrapper" | "rh-prefix";

export interface StockFeedRecord {
  /** Exchange ticker of the underlying, derived from \`baseAsset\` by \`tickerRule\`. */
  readonly ticker: string;
  /** \`docs.baseAsset\` exactly as the directory publishes it (e.g. "wNVDAx", "SPYon"). */
  readonly baseAsset: string;
  readonly tickerRule: StockFeedTickerRule;
  /** \`docs.quoteAsset\`, in practice always "USD" today. */
  readonly quoteAsset: string;
  /** The directory's feed name, e.g. "Robinhood NVDA / USD". */
  readonly feedName: string;
  /** The directory's human asset name; \`null\` when it publishes none. */
  readonly assetName: string | null;
  readonly assetClass: StockFeedAssetClass;
  readonly marketHours: StockFeedMarketHours;
  /**
   * WHAT THE NUMBER IS ABOUT, and the field most likely to be skipped past.
   *
   * \`tokenized-instrument\` (Chainlink \`productTypeCode: primaryTokenizedPrice\`) — the
   * feed prices the ISSUER'S TOKEN. That is what a pool holding that token needs.
   *
   * \`underlying-share\` (\`RefPrice\`) — the feed prices the share or ETF on its
   * exchange. A tokenised version of it is NOT the same number: a Robinhood or Binance
   * UI-multiplier token's raw unit is worth a fraction of a share after a split, an
   * Ondo \`…on\` token is a total-return tracker whose value drifts above the share price
   * with every dividend, and a Backed wrapper's value is a share count times a
   * multiplier. Banding a pool of tokens against a share feed is wrong by exactly that
   * drift, and the drift grows. Use it only when you have the conversion and apply it.
   */
  readonly prices: "tokenized-instrument" | "underlying-share";
  /** Chainlink's \`docs.productTypeCode\`, verbatim: what \`prices\` was derived from. */
  readonly productTypeCode: string | null;
  /** Chainlink's \`docs.productSubType\`, verbatim. */
  readonly productSubType: string | null;
  /** Chainlink's own lifecycle label. **"deprecating" means do not wire this feed.** */
  readonly feedCategory: string | null;
  /** The \`AggregatorV3\` proxy — what \`ChainlinkPriceBandAdapter.configureFeed\` takes. */
  readonly proxyAddress: Address;
  /** A second proxy the directory publishes for the same feed (Robinhood's shared-SVR
   *  variants). Present ONLY when it passed the same on-chain checks as the primary. */
  readonly secondaryProxyAddress: Address | null;
  /** \`decimals()\`, read from the aggregator and equal to the directory's. */
  readonly decimals: number;
  /** Seconds. The oldest answer Chainlink undertakes to leave in place. */
  readonly heartbeat: number;
  /** Deviation threshold in PERCENT (0.5 means 0.5%). The floor under any price band:
   *  a band narrower than this halts a pool on the feed's own normal behaviour. */
  readonly thresholdPercent: number | null;
  /** \`description()\` as read. Often unlike \`feedName\` ("RHNVDA / USD"). */
  readonly description: string;
  /** \`latestRoundData().answer\` at verification, base units of \`decimals\`. Evidence
   *  the feed was alive, NOT a price to render. */
  readonly verifiedAnswer: string;
  /** \`latestRoundData().updatedAt\` at verification (unix seconds). */
  readonly verifiedUpdatedAt: number;
  /** How old that round was when it was read. */
  readonly verifiedAgeSeconds: number;
  /**
   * Whether \`verifiedAgeSeconds <= heartbeat\` AT THE MOMENT OF THE READ. \`false\` is
   * normal for a tokenised-equity feed read outside its trading session — the market was
   * shut — and says nothing about the feed now. NEVER render this as "live".
   */
  readonly freshAtVerification: boolean;
}

export interface StockFeedRejection {
  readonly ticker: string;
  readonly proxyAddress: Address;
  readonly feedName: string;
  readonly reason: string;
}

export interface StockFeedSurveyRow {
  readonly chainId: number;
  /** The chain key in \`src/chains/endpoints.ts\`. */
  readonly key: string;
  readonly directoryUrl: string;
  /** 200, or the HTTP status when no such document exists. 404 is a FACT, not an error. */
  readonly directoryStatus: number;
  readonly directoryEntries: number;
  readonly equityCandidates: number;
  readonly verified: number;
  readonly rejected: number;
  readonly note?: string;
}

/** The day of the reads behind every record in this file (UTC). */
export const STOCK_FEEDS_VERIFIED_AT = ${q(day)};

/**
 * The exact instant of the run, and the UTC weekday it fell on. Both matter: a
 * \`freshAtVerification: false\` row read on a Saturday is a closed market, and the same
 * row read on a Wednesday afternoon would be a fault. Without this, a reader cannot tell
 * which they are looking at.
 */
export const STOCK_FEEDS_VERIFIED_INSTANT = ${q(startedAt.toISOString())};
export const STOCK_FEEDS_VERIFIED_WEEKDAY = ${q(
  ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][startedAt.getUTCDay()],
)};

/** Where the directory documents were downloaded from. */
export const STOCK_FEED_DIRECTORY_BASE = ${q(DIRECTORY_BASE)};

/**
 * Every chain that was surveyed, including the ones with nothing. A chain absent from
 * \`STOCK_FEEDS\` because it has no equity feed and a chain absent because nobody looked
 * are different facts, and only this table tells them apart.
 */
export const STOCK_FEED_SURVEY: readonly StockFeedSurveyRow[] = [
${surveyRows}
];

/** Verified feeds, by chain id. Sorted by ticker, then address. */
export const STOCK_FEEDS: Readonly<Record<number, readonly StockFeedRecord[]>> = {
${chainBlocks}
};

/**
 * Candidates that were REJECTED, with the reason. Committed on purpose: a generator that
 * silently drops rows is a generator whose output nobody can audit, and a feed that went
 * stale between two runs should be visible in the diff as exactly that.
 */
export const STOCK_FEED_REJECTIONS: Readonly<Record<number, readonly StockFeedRejection[]>> = {
${rejectionBlocks}
};

/** Chain ids with at least one verified equity feed. */
export const STOCK_FEED_CHAIN_IDS: readonly number[] = Object.keys(STOCK_FEEDS)
  .map(Number)
  .sort((a, b) => a - b);

/** Every verified feed on \`chainId\`; empty when there is none. */
export function stockFeedsFor(chainId: number): readonly StockFeedRecord[] {
  return STOCK_FEEDS[chainId] ?? [];
}

/**
 * Every verified feed for \`ticker\` on \`chainId\`. An ARRAY, not one feed: Ethereum
 * publishes two aggregators for several Ondo tickers (a calculated one and an API one)
 * and picking between them is a deployment decision, not something to guess here.
 */
export function stockFeedsForTicker(chainId: number, ticker: string): readonly StockFeedRecord[] {
  const t = ticker.trim().toUpperCase();
  return stockFeedsFor(chainId).filter((f) => f.ticker.toUpperCase() === t);
}

/** The feed at \`address\` on \`chainId\`, matching either published proxy. */
export function stockFeedByAddress(chainId: number, address: string): StockFeedRecord | undefined {
  const a = address.trim().toLowerCase();
  return stockFeedsFor(chainId).find(
    (f) => f.proxyAddress.toLowerCase() === a || f.secondaryProxyAddress?.toLowerCase() === a,
  );
}

/** Why a candidate on \`chainId\` is not in the table. */
export function stockFeedRejectionsFor(chainId: number): readonly StockFeedRejection[] {
  return STOCK_FEED_REJECTIONS[chainId] ?? [];
}
`;

if (CHECK) {
  const current = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, "utf8") : "";
  // The verification timestamps move on every run by construction, so --check compares
  // everything EXCEPT them. A changed address, ticker or rejection still fails.
  const strip = (s) =>
    s
      .replace(/^\s*(verified(Answer|UpdatedAt|AgeSeconds)|freshAtVerification):.*$/gm, "")
      .replace(/STOCK_FEEDS_VERIFIED_(AT|INSTANT|WEEKDAY) = "[^"]*"/g, "")
      .replace(/on \d{4}-\d{2}-\d{2} —/g, "");
  if (strip(current) !== strip(header)) {
    console.error("\nstockFeeds.ts is STALE — run `npm run generate:stockfeeds`");
    process.exit(1);
  }
  console.error("\nstockFeeds.ts is up to date");
  process.exit(0);
}

writeFileSync(OUT_FILE, header);
console.error(`\nwrote ${OUT_FILE}`);
