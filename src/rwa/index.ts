// SPDX-License-Identifier: MIT
/* ============================================================================
   REAL-WORLD-ASSET WIRING: the MIT half of `packages/hooks-rwa`.

   `MarketHoursHook`, `StockPairHook` and `ChainlinkPriceBandAdapter` are GPL Solidity.
   This is the configuration side of them, independently authored and MIT, so an
   integrator can build a stock pair against Latch without importing GPL code — the same
   rule the rest of this SDK follows.

   Three things live here and nothing else:
     marketHours   Chainlink's session profile -> the module's UTC weekly schedule,
                   with the daylight-saving and one-second-gap caveats stated.
     bandOracle    a verified feed -> configureFeed / configureMarket arguments, with
                   the contracts' own refusals applied here and two they cannot make.
     pairs         the join between the feed table and the stock-token table, and an
                   honest account of which half is missing where.

   Nothing in this module reads a network, writes a transaction, or decides an
   ownership. It turns verified data into the exact arguments a Safe will sign.
   ============================================================================ */

export {
  dayIndexOf,
  daylightPhaseFor,
  holidayRecipe,
  isKnownMarketHoursProfile,
  KNOWN_MARKET_HOURS_PROFILES,
  marketSessionFor,
  nextSessionChange,
  PPM,
  SECONDS_PER_DAY,
  ukIsDaylight,
  usEasternIsDaylight,
  weekdayOf,
  WEEKDAYS_MON_FRI,
} from "./marketHours.js";
export type { DaylightPhase, MarketSession } from "./marketHours.js";

export {
  baseIsCurrency0For,
  bandFloorPpm,
  chainlinkFeedConfig,
  marketSettingsFor,
  MAX_FEED_DECIMALS,
  MAX_HEARTBEAT_SECONDS,
  US_WEEKEND_CLOSURE_SECONDS,
} from "./bandOracle.js";
export type {
  ChainlinkFeedConfig,
  ChainlinkFeedConfigOptions,
  ChainlinkFeedConfigResult,
  MarketSettingsConfig,
  MarketSettingsOptions,
  MarketSettingsResult,
} from "./bandOracle.js";

export { stockPairCoverage, stockPairReadiness } from "./pairs.js";
export type { StockPairBlocker, StockPairCoverage, StockPairReadiness } from "./pairs.js";
