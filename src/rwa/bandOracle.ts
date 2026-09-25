// SPDX-License-Identifier: MIT
/* ============================================================================
   A VERIFIED CHAINLINK EQUITY FEED -> `ChainlinkPriceBandAdapter.configureFeed`
   AND `MarketHoursModule.configureMarket`, WITH THE CHECKS THOSE CONTRACTS MAKE.

   `ChainlinkPriceBandAdapter` has existed for a while with no real feed to point at.
   This is the missing half: it turns a record from `deployments/stockFeeds.ts` into the
   exact arguments the two contracts take, and refuses — here, in TypeScript, before
   anything is signed — every input they would refuse on chain, plus two they cannot
   check for themselves.

   THE TWO THIS FILE CHECKS AND THE CONTRACTS CANNOT
   -------------------------------------------------
   `baseIsCurrency0`. The adapter's own comment says it: "This is the field that
   inverts the band if it is wrong. It is not derivable here - this contract never sees
   the pool's tokens." It IS derivable from a pool key, because a PoolKey sorts its
   currencies, so `baseIsCurrency0` is `stockToken < quoteToken` by address. That is
   what `baseIsCurrency0For` does, and passing the two token addresses is always better
   than asserting the boolean by hand.

   THE BAND FLOOR. A price band narrower than the feed's own deviation threshold halts
   the pool on the feed's NORMAL behaviour. Chainlink publishes a new round when the
   price moves by `thresholdPercent` (0.5% for most equity feeds) or when the heartbeat
   expires, whichever comes first - so between rounds the reference is expected to sit
   up to that far from the market. A 0.3% band around a reference that is allowed to be
   0.5% wrong is a pool that stops trading for reasons no operator will be able to
   explain. `bandFloorPpm` is that floor; `marketSettingsFor` refuses anything under it.

   The floor is a FLOOR, not a recommendation. The reference is also up to `heartbeat`
   old, and a tokenised equity gapping over a weekend moves far more than 0.5%; see
   `WEEKEND` below and `rwa/marketHours.ts`.

   WEEKEND
   -------
   A `us_equities_24/5` feed stops publishing at the Friday close and resumes after the
   Sunday open. With `heartbeat` at the feed's own 86,400 s, the adapter reverts
   `AnswerTooOld` for the whole closure — correct, since the session gate has shut the
   pool anyway — and ALSO for the first moments after the weekly open, until the feed
   prints its first round of the week. Widening `heartbeat` to cover the closure is
   possible (the adapter's ceiling is 7 days) and is the WRONG trade: it lets the first
   swap of the week band against a reference from before the weekend gap, which is
   exactly the reference an equity's weekend news has invalidated. `weekendTolerant`
   exists so the choice is explicit; it defaults to false and says why in `warnings`.
   ============================================================================ */

import type { Address } from "viem";

import type { StockFeedRecord } from "../deployments/stockFeeds.js";
import { marketSessionFor, PPM, type DaylightPhase, type MarketSession } from "./marketHours.js";

/** `ChainlinkPriceBandAdapter.MAX_HEARTBEAT`. */
export const MAX_HEARTBEAT_SECONDS = 7 * 24 * 60 * 60;

/** `ChainlinkPriceBandAdapter.MAX_DECIMALS`. */
export const MAX_FEED_DECIMALS = 36;

/**
 * `ChainlinkPriceBandAdapter.Feed`, field for field and in declaration order, so the
 * object can be spread straight into a `configureFeed` call.
 */
export interface ChainlinkFeedConfig {
  readonly aggregator: Address;
  readonly baseIsCurrency0: boolean;
  readonly baseDecimals: number;
  readonly quoteDecimals: number;
  readonly feedDecimals: number;
  readonly heartbeat: number;
}

/**
 * `MarketHoursModule.MarketSettings`, field for field and in declaration order.
 * `oracle` is the `ChainlinkPriceBandAdapter` instance, not the aggregator.
 */
export interface MarketSettingsConfig {
  readonly issuer: Address;
  readonly oracle: Address;
  readonly maxUpPpm: number;
  readonly maxDownPpm: number;
  readonly maxPriceAge: number;
  readonly openSecondOfDay: number;
  readonly closeSecondOfDay: number;
  readonly weekdayMask: number;
  readonly sessionEnabled: boolean;
  readonly bandEnabled: boolean;
  readonly gateLiquidity: boolean;
}

/**
 * Which of a pool's two currencies the feed's BASE asset is.
 *
 * A `PoolKey` sorts its currencies by address, so this is decidable from the two token
 * addresses alone and never needs to be asserted. Native (`address(0)`) sorts first,
 * which is why the comparison is on the full 20-byte value and not on a symbol.
 */
export function baseIsCurrency0For(baseToken: Address, quoteToken: Address): boolean {
  const a = baseToken.toLowerCase();
  const b = quoteToken.toLowerCase();
  if (a === b) throw new Error(`a pool cannot pair ${baseToken} with itself`);
  return a < b;
}

/**
 * The narrowest price band that does not fight the feed, in PPM.
 *
 * `thresholdPercent` is the deviation that makes Chainlink publish a new round, so it
 * is the amount the reference is ALLOWED to lag the market between rounds. A band
 * narrower than this halts the pool while nothing is wrong.
 *
 * `null` when the directory publishes no threshold for the feed: there is then no
 * floor this SDK can defend, and `marketSettingsFor` will say so rather than invent one.
 */
export function bandFloorPpm(feed: StockFeedRecord): number | null {
  if (feed.thresholdPercent === null || !Number.isFinite(feed.thresholdPercent)) return null;
  return Math.ceil((feed.thresholdPercent / 100) * PPM);
}

export interface ChainlinkFeedConfigOptions {
  readonly feed: StockFeedRecord;
  /** The tokenised stock's ERC-20 address (the feed's base asset). */
  readonly baseToken: Address;
  /** The quote token's ERC-20 address. */
  readonly quoteToken: Address;
  /** `decimals()` of the stock token, READ FROM THE CHAIN. Not guessed here: issuers
   *  differ (Robinhood, Coinbase, Backed and Ondo do not all use 18). */
  readonly baseDecimals: number;
  /** `decimals()` of the quote token, read from the chain. */
  readonly quoteDecimals: number;
  /** See the WEEKEND note in this file's header. Defaults to false. */
  readonly weekendTolerant?: boolean;
}

export interface ChainlinkFeedConfigResult {
  readonly config: ChainlinkFeedConfig;
  /** The aggregator chosen, and why, when the record publishes two. */
  readonly aggregatorNote: string;
  readonly warnings: readonly string[];
}

/** Seconds a `us_equities_24/5` market is shut over a weekend: Friday 20:00 to Sunday
 *  20:00 New York. Exactly 48 hours — the daylight shift moves both ends together. */
export const US_WEEKEND_CLOSURE_SECONDS = 48 * 60 * 60;

/**
 * Build the `configureFeed` argument for a pool, refusing what the contract would.
 *
 * The primary `proxyAddress` is always chosen. Several records also carry a
 * `secondaryProxyAddress` (Robinhood publishes a "shared-SVR" variant of every feed);
 * it is verified and recorded, but which of the two a deployment should use is a
 * decision about value recapture, not about price, and this SDK does not take it.
 */
export function chainlinkFeedConfig(options: ChainlinkFeedConfigOptions): ChainlinkFeedConfigResult {
  const { feed, baseToken, quoteToken, baseDecimals, quoteDecimals } = options;
  const warnings: string[] = [];

  if (!Number.isInteger(baseDecimals) || baseDecimals < 0 || baseDecimals > MAX_FEED_DECIMALS) {
    throw new Error(`baseDecimals ${baseDecimals} is outside 0..${MAX_FEED_DECIMALS}; configureFeed reverts InvalidDecimals`);
  }
  if (!Number.isInteger(quoteDecimals) || quoteDecimals < 0 || quoteDecimals > MAX_FEED_DECIMALS) {
    throw new Error(`quoteDecimals ${quoteDecimals} is outside 0..${MAX_FEED_DECIMALS}; configureFeed reverts InvalidDecimals`);
  }
  if (feed.decimals > MAX_FEED_DECIMALS) {
    throw new Error(`feed decimals ${feed.decimals} exceed MAX_DECIMALS ${MAX_FEED_DECIMALS}`);
  }

  const heartbeat = options.weekendTolerant ? feed.heartbeat + US_WEEKEND_CLOSURE_SECONDS : feed.heartbeat;
  if (heartbeat <= 0 || heartbeat > MAX_HEARTBEAT_SECONDS) {
    throw new Error(`heartbeat ${heartbeat}s is outside 1..${MAX_HEARTBEAT_SECONDS}s; configureFeed reverts InvalidHeartbeat`);
  }
  if (options.weekendTolerant) {
    warnings.push(
      `heartbeat widened to ${heartbeat}s to survive the weekend closure. The pool will then band against a reference up to ${heartbeat}s old at the weekly open - which is the reference a weekend's news has already invalidated. Prefer leaving the pool shut until the feed prints.`,
    );
  } else if (feed.marketHours === "us_equities_24/5") {
    warnings.push(
      `heartbeat is the feed's own ${feed.heartbeat}s, so refresh() reverts AnswerTooOld from the Friday 20:00 New York close until the feed publishes after the Sunday 20:00 open. Expect the first swap of the week to fail while the session already reads open.`,
    );
  }
  if (feed.feedCategory === "deprecating") {
    warnings.push(
      `Chainlink labels this feed "deprecating". Do not point a pool at it: when it stops, every swap reverts AnswerTooOld and the only repair is an owner configureFeed to a replacement.`,
    );
  }
  if (!feed.freshAtVerification) {
    warnings.push(
      `the feed's last round was ${feed.verifiedAgeSeconds}s old when this table was generated (a reading outside the trading session). Re-read latestRoundData() before configuring.`,
    );
  }

  return {
    config: {
      aggregator: feed.proxyAddress,
      baseIsCurrency0: baseIsCurrency0For(baseToken, quoteToken),
      baseDecimals,
      quoteDecimals,
      feedDecimals: feed.decimals,
      heartbeat,
    },
    aggregatorNote: feed.secondaryProxyAddress
      ? `primary proxy ${feed.proxyAddress}; the record also carries a verified secondary proxy ${feed.secondaryProxyAddress} (a shared-SVR variant). Choosing it is a value-recapture decision, not a price one.`
      : `primary proxy ${feed.proxyAddress}; the directory publishes no second proxy for this feed.`,
    warnings,
  };
}

export interface MarketSettingsOptions {
  readonly feed: StockFeedRecord;
  /** The per-pool operator. `MarketSettings.issuer`; `address(0)` reverts MarketZeroAddress. */
  readonly issuer: Address;
  /** The `ChainlinkPriceBandAdapter` instance. NOT the aggregator. */
  readonly oracle: Address;
  /** Permitted deviation above the reference, PPM. Must be at least `bandFloorPpm`. */
  readonly maxUpPpm: number;
  /** Permitted deviation below the reference, PPM. Must be at least `bandFloorPpm`. */
  readonly maxDownPpm: number;
  /** `standard` / `daylight`, or a date for the statutory rule to decide. */
  readonly phase: DaylightPhase | Date;
  /** Whether the halt and the calendar also block ADDING liquidity. Defaults to true:
   *  a pool that accepts liquidity while its price source is shut is a pool somebody
   *  can seed at a price nobody is checking. */
  readonly gateLiquidity?: boolean;
  /** Staleness window for the reference. Defaults to the feed's heartbeat. 0 disables
   *  the check inside the module, which means trusting the adapter's own — legitimate,
   *  but it has to be chosen. */
  readonly maxPriceAge?: number;
}

export interface MarketSettingsResult {
  readonly settings: MarketSettingsConfig;
  readonly session: MarketSession;
  readonly bandFloorPpm: number | null;
  readonly warnings: readonly string[];
}

/**
 * Build the `configureMarket` argument for a pool priced by `feed`.
 *
 * Refuses: a zero issuer or oracle (the module reverts), a band under the feed's own
 * deviation threshold (nothing refuses this on chain — it just halts the pool), and
 * `maxDownPpm > PPM` (the module reverts `InvalidBandWidth`).
 */
export function marketSettingsFor(options: MarketSettingsOptions): MarketSettingsResult {
  const { feed, issuer, oracle, maxUpPpm, maxDownPpm } = options;
  const warnings: string[] = [];
  const ZERO = "0x0000000000000000000000000000000000000000";

  if (!issuer || issuer.toLowerCase() === ZERO) throw new Error("issuer is address(0); configureMarket reverts MarketZeroAddress");
  if (!oracle || oracle.toLowerCase() === ZERO) throw new Error("oracle is address(0); bandEnabled with no oracle reverts BandEnabledWithoutOracle");
  if (!Number.isInteger(maxUpPpm) || maxUpPpm < 0) throw new Error(`maxUpPpm ${maxUpPpm} must be a non-negative integer`);
  if (!Number.isInteger(maxDownPpm) || maxDownPpm < 0) throw new Error(`maxDownPpm ${maxDownPpm} must be a non-negative integer`);
  if (maxDownPpm > PPM) throw new Error(`maxDownPpm ${maxDownPpm} exceeds PPM ${PPM}; configureMarket reverts InvalidBandWidth`);

  const floor = bandFloorPpm(feed);
  if (floor === null) {
    warnings.push(
      "the directory publishes no deviation threshold for this feed, so there is no floor under the band that this SDK can defend. Read the feed's own deviation policy before choosing one.",
    );
  } else {
    if (maxUpPpm < floor || maxDownPpm < floor) {
      throw new Error(
        `band ${maxUpPpm}/${maxDownPpm} ppm is under this feed's ${floor} ppm deviation threshold (${feed.thresholdPercent}%). ` +
          "Chainlink only republishes when the price moves that far, so the reference is ALLOWED to sit that far from the market: " +
          "a narrower band halts the pool on the feed behaving normally. Raise the band, or point the pool at a tighter feed.",
      );
    }
    if (maxUpPpm < floor * 2 || maxDownPpm < floor * 2) {
      warnings.push(
        `band ${maxUpPpm}/${maxDownPpm} ppm is inside twice the feed's ${floor} ppm threshold. It is above the floor, so it will not halt on a single deviation, but it leaves almost no room for the reference's lag plus real price movement inside one heartbeat.`,
      );
    }
  }

  const session = marketSessionFor(feed.marketHours, options.phase);
  if (session.gapSeconds > 0) {
    warnings.push(
      `this encoding closes the pool for ${session.gapSeconds}s a day at second ${session.gapAtSecondOfDay} UTC. See rwa/marketHours.ts: the module refuses open == close, so a 24-hour day is not expressible.`,
    );
  }
  warnings.push(
    `holidays are NOT in this configuration. ${session.profile} shuts on days no feed metadata records; the issuer writes them with setHolidays. An empty calendar means the pool trades on days the exchange is shut.`,
  );
  if (options.phase instanceof Date) {
    warnings.push(
      `phase "${session.phase}" was chosen by the statutory rule (${session.rule}). It is NOT automatic on chain: the issuer must call setSessionHours at the next change.`,
    );
  }

  const maxPriceAge = options.maxPriceAge ?? feed.heartbeat;
  if (maxPriceAge === 0) {
    warnings.push(
      "maxPriceAge is 0, so the module performs no staleness check of its own and trusts the adapter's heartbeat entirely. Legitimate, but it must be a decision.",
    );
  }

  return {
    settings: {
      issuer,
      oracle,
      maxUpPpm,
      maxDownPpm,
      maxPriceAge,
      openSecondOfDay: session.openSecondOfDay,
      closeSecondOfDay: session.closeSecondOfDay,
      weekdayMask: session.weekdayMask,
      sessionEnabled: true,
      bandEnabled: true,
      gateLiquidity: options.gateLiquidity ?? true,
    },
    session,
    bandFloorPpm: floor,
    warnings,
  };
}
