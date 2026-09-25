// SPDX-License-Identifier: MIT
/**
 * Native-currency/USD pricing, and the market-cap conversion the launch wizard needs.
 *
 * Two independent halves, deliberately separable:
 *
 *   `marketCap.ts`  PURE integer arithmetic. No network, no clock, no config. Converts a
 *                   USD opening market cap into a price per token and back. This is the
 *                   half that must never be wrong, and it is the half that is exhaustively
 *                   testable.
 *
 *   the resolver    `resolveNativeUsd`, which turns a chain id into dollars-per-native WITH
 *                   PROVENANCE, or into an explicit "no source, price in native units".
 *                   Four tiers, described in `resolve.ts`; the feed table behind it is
 *                   generated and on-chain-verified in `deployments/nativeFeeds.ts`.
 *
 * The separation matters because tier 4 is a normal outcome. A chain with no feed still
 * gets a launch: the creator chooses a cap in native units, `openingPriceFromNativeMarketCap`
 * converts it, and no dollar figure is rendered anywhere. Nothing in the pure half depends
 * on a price existing.
 *
 * @packageDocumentation
 */

export {
  DEFAULT_OPENING_MARKET_CAP_USD,
  formatUsdAmount,
  marketCapFromOpeningPrice,
  nativeMarketCapFromOpeningPrice,
  openingPriceFromMarketCap,
  openingPriceFromNativeMarketCap,
  usdWholeDollars,
} from "./marketCap.js";
export type {
  MarketCapFromOpeningPriceInput,
  NativeUsdRate,
  OpeningPriceFromMarketCapInput,
  OpeningPriceFromNativeCapInput,
  RoundingMode,
  UsdAmount,
} from "./marketCap.js";

export { CHAINLINK_AGGREGATOR_ABI, FUTURE_SKEW_SECONDS, readChainlinkNativeUsd } from "./chainlink.js";
export type { ChainlinkReadResult, ReadChainlinkNativeUsdOptions } from "./chainlink.js";

export { PYTH_ABI, readPythNativeUsd } from "./pyth.js";
export type { PythReadResult, ReadPythNativeUsdOptions } from "./pyth.js";

export { POOL_TWAP_PREREQUISITES, poolTwapAttempt } from "./pool.js";

export { resolveNativeUsd } from "./resolve.js";
export type { ResolveNativeUsdOptions } from "./resolve.js";

export { isNativeUsdQuote } from "./types.js";
export type {
  NativeUsdAttempt,
  NativeUsdProvenance,
  NativeUsdQuote,
  NativeUsdResult,
  NativeUsdTier,
  NativeUsdUnavailable,
  NativeUsdUnavailableReason,
} from "./types.js";

export {
  NATIVE_FEEDS,
  NATIVE_FEED_CHAIN_IDS,
  NATIVE_FEED_DIRECTORY_BASE,
  NATIVE_FEEDS_VERIFIED_AT,
  NATIVE_FEEDS_VERIFIED_INSTANT,
  NATIVE_USD_NO_SOURCE_CHAIN_IDS,
  NATIVE_USD_PYTH_ONLY_CHAIN_IDS,
  NATIVE_USD_TIER1_CHAIN_IDS,
  PYTH_HERMES_BASE,
  STALE_GRACE_SECONDS,
  nativeFeedFor,
  staleAfterSeconds,
} from "../deployments/nativeFeeds.js";
export type {
  ChainlinkFeedVariant,
  ChainlinkNativeFeed,
  ChainlinkNativeFeedRejection,
  NativeCurrencyFact,
  NativeFeedRecord,
  PythNativeFeed,
} from "../deployments/nativeFeeds.js";
