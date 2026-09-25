// SPDX-License-Identifier: MIT
/**
 * What a native/USD answer IS, including where it came from.
 *
 * PROVENANCE IS PART OF THE VALUE, NOT A COMMENT. CLAUDE.md's no-invented-data rule says
 * "Label the provenance" and the reason is specific: this number turns into a dollar figure
 * a creator reads while choosing an opening market cap for a pool whose LP will be locked
 * forever. A reader who cannot tell which oracle said it, at which address, at which block,
 * and how old the round was, cannot judge whether to believe it. So the provenance travels
 * inside the return value and the UI is required to display it.
 *
 * THE ANSWER IS NEVER A FLOAT. `answer` and `answerDecimals` are the feed's own shape,
 * carried through unchanged, so nothing between the aggregator and the price a creator
 * signs has been through binary floating point. {@link NativeUsdQuote} is directly a
 * {@link NativeUsdRate}, which is what `marketCap.ts` consumes.
 */

import type { Address } from "viem";

import type { NativeUsdTier } from "../deployments/nativeFeeds.js";
import type { NativeUsdRate } from "./marketCap.js";

export type { NativeUsdTier };

/** Why there is no price. Every one of these is a legitimate answer, not an error state. */
export type NativeUsdUnavailableReason =
  /** The chain is not in `deployments/nativeFeeds.ts` at all — nobody has surveyed it. */
  | "chain-not-surveyed"
  /** Surveyed, and no source of any tier was found. The caller prices in native units. */
  | "no-source-on-chain"
  /**
   * A Pyth price-feed id is known for this chain but no Pyth CONTRACT address was supplied,
   * and none is committed in this SDK because none was verified. See `pyth.ts`.
   */
  | "pyth-contract-not-supplied"
  /** Tier 3 exists in the type system and nowhere else. See `pool.ts`. */
  | "pool-twap-not-implemented"
  /**
   * The chain is a testnet. Its native asset has no market price; a Chainlink feed deployed
   * there prices the MAINNET asset, which is a real number about a different thing. Opt in
   * with `allowTestnetUsd` if you are knowingly using it as a stand-in.
   */
  | "testnet-native-has-no-market-price"
  /** Every source that was tried reverted, timed out, or could not be reached. */
  | "read-failed"
  /** A source answered, and the answer was refused. `staleness` or `rejection` says why. */
  | "answer-refused";

/** Where an answer came from, in enough detail to check it by hand. */
export interface NativeUsdProvenance {
  readonly tier: NativeUsdTier;
  /** "Chainlink", "Pyth", "Latch pool" — the organisation whose number this is. */
  readonly source: string;
  /** The contract that was read. Null only where the tier has no contract. */
  readonly address: Address | null;
  readonly chainId: number;
  /** The block the read was executed against, when the transport reported one. */
  readonly blockNumber: bigint | null;
  /** The oracle's own timestamp for the answer — `updatedAt`, `publishTime`. Unix seconds. */
  readonly updatedAt: number;
  /** Age of that timestamp when it was read, in seconds. Can be slightly negative. */
  readonly ageSeconds: number;
  /** The age past which this source's answer would have been refused. */
  readonly staleAfterSeconds: number;
  /** The oracle's own round identifier, where it has one. */
  readonly roundId: string | null;
  /** `description()` or the feed's published symbol — the string that proves identity. */
  readonly description: string | null;
  /**
   * One line a UI can render verbatim under a dollar figure, e.g.
   * `Chainlink ETH / USD at 0x5f4e…8419 on Ethereum, round 129127208515966895171, 928 s old`.
   */
  readonly label: string;
  /**
   * Anything a reader must know that the fields above do not say — an SVR feed rather than
   * the canonical one, a testnet stand-in, an inferred native decimals. Empty when there is
   * nothing to warn about. A UI SHOULD render these; it must not silently drop them.
   */
  readonly caveats: readonly string[];
}

/** A price, with where it came from. */
export interface NativeUsdQuote extends NativeUsdRate {
  readonly ok: true;
  /** Dollars per ONE WHOLE unit of the native currency: `answer / 10 ** answerDecimals`. */
  readonly answer: bigint;
  readonly answerDecimals: number;
  /** The native currency this prices, and its decimals — needed for every conversion. */
  readonly nativeSymbol: string;
  readonly nativeDecimals: number;
  readonly provenance: NativeUsdProvenance;
}

/** No price, and exactly why. Never a zero, never a guess. */
export interface NativeUsdUnavailable {
  readonly ok: false;
  readonly reason: NativeUsdUnavailableReason;
  /** A sentence a UI may render. Written for a user, not a log. */
  readonly detail: string;
  readonly chainId: number;
  /** The native currency, when the chain is known at all — a caller still needs it to price in native units. */
  readonly nativeSymbol: string | null;
  readonly nativeDecimals: number | null;
  /** Every tier that was tried and what happened, in order. For diagnostics, not for users. */
  readonly attempts: readonly NativeUsdAttempt[];
}

/** One tier's outcome during a resolve. */
export interface NativeUsdAttempt {
  readonly tier: NativeUsdTier;
  readonly address: Address | null;
  readonly outcome: "ok" | "skipped" | "stale" | "refused" | "error";
  readonly detail: string;
}

export type NativeUsdResult = NativeUsdQuote | NativeUsdUnavailable;

/** Narrowing helper, so a caller never reads `answer` off an unavailable result. */
export function isNativeUsdQuote(r: NativeUsdResult): r is NativeUsdQuote {
  return r.ok;
}
