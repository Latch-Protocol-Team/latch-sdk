// SPDX-License-Identifier: MIT
/**
 * TIER 3 — a Latch native/stablecoin pool on our own core.
 *
 * DELIBERATELY UNIMPLEMENTED. This file contains the tier's definition, the reason it is
 * empty, and the two properties any future implementation must have. It contains no reader,
 * and adding one that lacks either property would be a regression even if it were switched
 * off by default.
 *
 * WHY THE TIER IS WANTED. It removes the third-party dependency entirely: a price Latch
 * derives from its own pools needs no Chainlink, no Pyth and no HTTP service, and it works
 * on every chain Latch deploys to including the four that have no feed at all today. That
 * is the long-run answer and it is worth building — later, correctly.
 *
 * WHY IT IS NOT BUILT AS A SPOT READ, which was the first design and was wrong
 * ----------------------------------------------------------------------------
 * The obvious implementation is `CLPoolManager.getSlot0(poolId)` on a native/stablecoin
 * pool: one call, no history, exact. It is also a SPOT price, and a spot price in a pool
 * with thin depth is moved by a single swap. Whoever can move it can set what a creator's
 * token is worth at birth — and the LP is locked forever, so there is no correcting it
 * afterwards. Of all the numbers in this system, the opening price is the one that most
 * needs to be expensive to move. A spot read gives it the opposite property.
 *
 * So tier 3, if it is ever built, is a TIME-WEIGHTED AVERAGE over a stated window, and the
 * window goes in the provenance next to the price, because a TWAP whose window nobody
 * states is not a claim anyone can check.
 *
 * AND A TWAP ALONE IS NOT ENOUGH. Averaging over time raises the cost of manipulation in
 * proportion to the DEPTH being moved; over a near-empty pool it is still cheap, because
 * holding a wrong price for the whole window costs almost nothing when almost nothing is
 * there to arbitrage it back. So any implementation must ALSO refuse to answer below a
 * stated depth threshold, and refusing is the correct behaviour — the resolver falls
 * through to tier 4 and the launch is priced in native units, which is honest.
 *
 * WHY NEITHER IS PRACTICAL FROM WHAT THE SDK CAN READ TODAY
 * ---------------------------------------------------------
 * 1. LATCH CORE KEEPS NO PRICE HISTORY. `packages/core/src` contains no observation array
 *    and no oracle of any kind — checked, not assumed: `CLPoolManager.getSlot0` returns
 *    `(sqrtPriceX96, tick, protocolFee, lpFee)` and nothing else, and there is no
 *    `observe`, `increaseObservationCardinality` or equivalent anywhere in the package.
 *    Infinity architecture, like Uniswap v4, moved that job out of the pool and into a
 *    hook. Latch ships no oracle hook, so there is no on-chain average to read.
 * 2. THE ONLY ALTERNATIVE IS LOG RECONSTRUCTION, and it is a different thing wearing the
 *    same name. `src/market/` can rebuild a price series from `Swap` logs
 *    (`readPoolTrades`, `buildCandles`), but an average assembled off chain from logs is
 *    not anchored by anything a contract enforces: it is only as good as the log range the
 *    reader chose, and it is exactly as manipulable over that range as the pool is.
 *    Calling it a TWAP would be borrowing the word's credibility without its mechanism.
 * 3. THERE IS NO POOL TO READ. Latch has no native/stablecoin pool with meaningful depth on
 *    any chain, so even a correct implementation would return nothing today.
 *
 * WHAT WOULD MAKE IT BUILDABLE, in the order the dependencies fall:
 *   * an oracle hook on Latch core that accumulates tick-seconds, so an average has an
 *     on-chain anchor rather than an off-chain reconstruction;
 *   * a native/stablecoin Latch pool with real depth on the chain being priced;
 *   * a depth floor chosen with a number behind it — a manipulation cost per basis point
 *     of price move, not a round figure someone liked — read from `getLiquidity(poolId)`
 *     and checked at the same block as the average.
 *
 * Until all three exist, `resolveNativeUsd` reports
 * `"pool-twap-not-implemented"` and falls through to tier 4. An unimplemented tier is fine.
 * A manipulable one is not, and one that merely defaults to off is one edit away from being
 * a manipulable one.
 */

import type { NativeUsdAttempt } from "./types.js";

/**
 * What tier 3 would need before it could answer. Exported so the reason is a value a UI or
 * a test can assert on, rather than a comment only a reader of this file sees.
 */
export const POOL_TWAP_PREREQUISITES: readonly string[] = Object.freeze([
  "An oracle hook on Latch core: `packages/core/src` has no observation array and no `observe`, so there is no on-chain average to read.",
  "A Latch native/stablecoin pool with real depth on the chain being priced.",
  "A depth floor with a manipulation-cost argument behind it, read at the same block as the average.",
]);

/**
 * The tier-3 attempt, always a skip.
 *
 * It exists so a resolve's `attempts` records that tier 3 was considered and why it did not
 * answer — the same reason the generated feed table commits its rejections. A tier that is
 * silently absent teaches nobody anything.
 */
export function poolTwapAttempt(): NativeUsdAttempt {
  return {
    tier: "latch-pool-twap",
    address: null,
    outcome: "skipped",
    detail:
      "not implemented: a spot read would be manipulable by a single swap, and the time-weighted " +
      "alternative needs an on-chain average Latch core does not keep. " +
      POOL_TWAP_PREREQUISITES.join(" "),
  };
}
