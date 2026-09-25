// SPDX-License-Identifier: MIT
/* ============================================================================
   WHAT A STOCK PAIR STILL NEEDS — the join between two tables that do not meet.

   Latch has two independently verified registries and they are about different things:

     `deployments/stockFeeds.ts`   Chainlink's PRICE FEED for a ticker on a chain.
                                   Published by Chainlink. Never a token address.
     `deployments/stocks.ts`       The tokenised stock's ERC-20 on a chain.
                                   Sourced from each issuer. Never a price.

   A tradable stock pair on Latch needs BOTH, plus a quote token and a pool. This module
   joins them by (chain, ticker) and reports exactly which of the four is missing,
   because the interesting answer on most chains is "one of them".

   WHY THE JOIN IS BY TICKER AND WHAT THAT COSTS
   ---------------------------------------------
   Neither side publishes the other's identifier. Chainlink names an asset ("NVDA"),
   the issuer names a token ("RHNVDA", "NVDAx", "wNVDAx", "NVDAon"). The only field
   they share is the underlying's exchange ticker, and both tables carry it as `ticker`
   derived by a rule that is recorded on the record.

   That join is a CLAIM, not a proof: it asserts that a feed labelled NVDA prices the
   token labelled NVDA. On a chain with one issuer that is safe. Where a chain carries
   two issuers' versions of the same underlying — Base has Coinbase and Dinari, HyperEVM
   has three — the join returns EVERY candidate and refuses to choose, because choosing
   would mean asserting that one issuer's token tracks another issuer's feed. The
   deployment runbook picks, and records why.
   ============================================================================ */

import { stockFeedsFor, type StockFeedRecord } from "../deployments/stockFeeds.js";
import { stockTokensFor, type StockTokenRecord } from "../deployments/stocks.js";
import { isKnownMarketHoursProfile } from "./marketHours.js";

/** Why a (chain, ticker) is not a pair Latch can offer yet. */
export type StockPairBlocker =
  | "no-feed"
  | "no-token"
  | "token-rebasing"
  | "feed-prices-the-underlying-share"
  | "feed-deprecating"
  | "feed-stale-at-verification"
  | "unknown-market-hours-profile"
  | "ambiguous-issuer";

export interface StockPairReadiness {
  readonly chainId: number;
  readonly ticker: string;
  /** Every verified feed for this ticker on this chain. More than one is normal. */
  readonly feeds: readonly StockFeedRecord[];
  /** Every verified stock token for this ticker on this chain. */
  readonly tokens: readonly StockTokenRecord[];
  /** Tokens that cannot be a pool currency at all — a rebasing balance breaks the
   *  Vault's amount-based reserve accounting. Excluded from `tokens`' usable count. */
  readonly rebasingTokens: readonly StockTokenRecord[];
  /** Empty exactly when a pool could be configured from these two tables today. */
  readonly blockers: readonly StockPairBlocker[];
  /** One line per blocker, in the words a runbook needs. */
  readonly notes: readonly string[];
}

/** Everything the two tables say about one ticker on one chain. */
export function stockPairReadiness(chainId: number, ticker: string): StockPairReadiness {
  const t = ticker.trim().toUpperCase();
  const feeds = stockFeedsFor(chainId).filter((f) => f.ticker.toUpperCase() === t);
  const all = stockTokensFor(chainId).filter((s) => s.ticker.toUpperCase() === t);
  const rebasingTokens = all.filter((s) => s.controls.rebasing);
  const tokens = all.filter((s) => !s.controls.rebasing);

  const blockers: StockPairBlocker[] = [];
  const notes: string[] = [];

  if (feeds.length === 0) {
    blockers.push("no-feed");
    notes.push(
      `no verified Chainlink equity feed for ${t} on chain ${chainId}. A pool can still exist without a price band, but MarketHoursHook's band and StockPairHook's circuit breaker cannot be enabled: bandEnabled with no oracle reverts BandEnabledWithoutOracle.`,
    );
  }
  if (tokens.length === 0) {
    blockers.push("no-token");
    if (rebasingTokens.length > 0) {
      notes.push(
        `${t} exists on chain ${chainId} only as a REBASING token (${rebasingTokens.map((s) => s.symbol).join(", ")}). The Vault accounts reserves by amount, not by share, so a rebase either strands value or makes the Vault insolvent for that currency. Not a pool currency at any price.`,
      );
    } else {
      notes.push(
        `no verified tokenised ${t} in the Latch address book on chain ${chainId}. Chainlink publishes the feed and never the token; the address must come from the issuer's own source and be read on chain before it is written down.`,
      );
    }
  }
  if (rebasingTokens.length > 0 && tokens.length > 0) {
    blockers.push("token-rebasing");
    notes.push(
      `${rebasingTokens.map((s) => s.symbol).join(", ")} on chain ${chainId} rebase and must never be offered as a pool currency, even though a usable ${t} token also exists. A UI that lists by ticker will show both.`,
    );
  }
  for (const f of feeds) {
    if (f.feedCategory === "deprecating") {
      blockers.push("feed-deprecating");
      notes.push(`feed ${f.proxyAddress} (${f.feedName}) is labelled "deprecating" by Chainlink. Do not point a pool at it.`);
    }
    if (!f.freshAtVerification) {
      blockers.push("feed-stale-at-verification");
      notes.push(
        `feed ${f.proxyAddress} was ${f.verifiedAgeSeconds}s past its ${f.heartbeat}s heartbeat when the table was generated. Normal outside a trading session; re-read latestRoundData() before configuring.`,
      );
    }
    if (!isKnownMarketHoursProfile(f.marketHours)) {
      blockers.push("unknown-market-hours-profile");
      notes.push(
        `feed ${f.proxyAddress} uses market-hours profile "${f.marketHours}", which rwa/marketHours.ts does not map. Configure the session by hand; do not guess it.`,
      );
    }
  }
  /* The hazard that is easiest to miss, because both halves are present and verified.
     A feed can price the underlying SHARE rather than the issuer's token, and the two
     are different numbers: a UI-multiplier token's raw unit stops being one share at
     the first split, an Ondo `…on` token drifts above the share price with every
     dividend, and a Backed wrapper is a share count times a multiplier. The feed table
     records which with `prices`; this is where it has to be acted on. */
  if (feeds.length > 0 && feeds.every((f) => f.prices === "underlying-share")) {
    blockers.push("feed-prices-the-underlying-share");
    notes.push(
      `every ${t} feed on chain ${chainId} prices the UNDERLYING SHARE (Chainlink productTypeCode RefPrice), not a tokenised version of it. ` +
        "Banding a pool of issuer tokens against it is wrong by the token's own multiplier or total-return drift, which grows and which nothing on chain will report. " +
        "Either find a feed whose `prices` is tokenized-instrument, or apply the issuer's shares-per-token conversion in a wrapper oracle before the band sees it.",
    );
  }
  if (feeds.length > 1 || tokens.length > 1) {
    blockers.push("ambiguous-issuer");
    notes.push(
      `chain ${chainId} carries ${feeds.length} feed(s) and ${tokens.length} usable token(s) for ${t}. Pairing one issuer's token with another issuer's feed is an assertion nobody has checked; the runbook must name the pair and say why.`,
    );
  }

  return { chainId, ticker: t, feeds, tokens, rebasingTokens, blockers: [...new Set(blockers)], notes };
}

export interface StockPairCoverage {
  readonly chainId: number;
  /**
   * Tickers with a usable token AND a feed that prices THAT TOKEN. The only list from
   * which a correctly banded pool can be built with nothing further to source.
   */
  readonly both: readonly string[];
  /**
   * Tickers with a usable token and a feed, where every feed prices the underlying
   * SHARE. A pool can exist; banding it on that feed is wrong by the token's own
   * multiplier or total-return drift. Separated from `both` deliberately — summing
   * them is the mistake this split exists to prevent.
   */
  readonly bothButSharePriced: readonly string[];
  /** Tickers with a feed and no usable token on this chain. */
  readonly feedOnly: readonly string[];
  /** Tickers with a usable token and no feed on this chain. */
  readonly tokenOnly: readonly string[];
  /** Tickers whose only token on this chain rebases. */
  readonly rebasingOnly: readonly string[];
}

/**
 * The honest per-chain summary: how many tickers have both halves, and how many have
 * exactly one. `feedOnly` is the list of token addresses still to be sourced;
 * `tokenOnly` is the list of pairs that can exist but cannot be banded.
 */
export function stockPairCoverage(chainId: number): StockPairCoverage {
  const feeds = stockFeedsFor(chainId);
  const feedTickers = new Set(feeds.map((f) => f.ticker.toUpperCase()));
  const tokenPricedTickers = new Set(
    feeds.filter((f) => f.prices === "tokenized-instrument").map((f) => f.ticker.toUpperCase()),
  );
  const tokens = stockTokensFor(chainId);
  const usableTickers = new Set(tokens.filter((s) => !s.controls.rebasing).map((s) => s.ticker.toUpperCase()));
  const anyTokenTickers = new Set(tokens.map((s) => s.ticker.toUpperCase()));

  const both: string[] = [];
  const bothButSharePriced: string[] = [];
  const feedOnly: string[] = [];
  const tokenOnly: string[] = [];
  const rebasingOnly: string[] = [];

  for (const t of feedTickers) {
    if (!usableTickers.has(t)) feedOnly.push(t);
    else if (tokenPricedTickers.has(t)) both.push(t);
    else bothButSharePriced.push(t);
  }
  for (const t of usableTickers) if (!feedTickers.has(t)) tokenOnly.push(t);
  for (const t of anyTokenTickers) if (!usableTickers.has(t)) rebasingOnly.push(t);

  const s = (a: string[]) => a.sort((x, y) => x.localeCompare(y));
  return {
    chainId,
    both: s(both),
    bothButSharePriced: s(bothButSharePriced),
    feedOnly: s(feedOnly),
    tokenOnly: s(tokenOnly),
    rebasingOnly: s(rebasingOnly),
  };
}
