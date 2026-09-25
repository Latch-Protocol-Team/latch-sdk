// SPDX-License-Identifier: MIT
/**
 * Token amounts a CL position's liquidity is worth at a price, rounded DOWN
 * (what a full withdrawal would return, before fees). The standard
 * concentrated-liquidity identities:
 *
 *   price below the range:  amount0 = L * (sb - sa) * 2^96 / (sb * sa), amount1 = 0
 *   price inside the range: amount0 = L * (sb - sp) * 2^96 / (sb * sp),
 *                           amount1 = L * (sp - sa) / 2^96
 *   price above the range:  amount0 = 0, amount1 = L * (sb - sa) / 2^96
 *
 * with sa, sb the range edges' sqrt prices (`sqrtRatioAtTick`) and sp the
 * pool's `sqrtPriceX96`. "Inside" follows core: tickLower <= tick < tickUpper.
 */

import { sqrtRatioAtTick } from "../launchpad/tickMath.js";

const Q96 = 2n ** 96n;

export interface PositionAmounts {
  readonly amount0: bigint;
  readonly amount1: bigint;
  /** `tickLower <= tick < tickUpper`: the position's liquidity is part of the pool's active liquidity. */
  readonly inRange: boolean;
}

function amount0Delta(sa: bigint, sb: bigint, liquidity: bigint): bigint {
  if (sa > sb) [sa, sb] = [sb, sa];
  if (sa === 0n) return 0n;
  // Two floor divisions, like core's getAmount0Delta(roundUp = false).
  return ((liquidity * Q96 * (sb - sa)) / sb) / sa;
}

function amount1Delta(sa: bigint, sb: bigint, liquidity: bigint): bigint {
  if (sa > sb) [sa, sb] = [sb, sa];
  return (liquidity * (sb - sa)) / Q96;
}

export function positionAmounts(args: {
  readonly liquidity: bigint;
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly tick: number;
  readonly sqrtPriceX96: bigint;
}): PositionAmounts {
  const { liquidity, tickLower, tickUpper, tick, sqrtPriceX96 } = args;
  const sa = sqrtRatioAtTick(tickLower);
  const sb = sqrtRatioAtTick(tickUpper);
  if (tick < tickLower) return { amount0: amount0Delta(sa, sb, liquidity), amount1: 0n, inRange: false };
  if (tick >= tickUpper) return { amount0: 0n, amount1: amount1Delta(sa, sb, liquidity), inRange: false };
  return {
    amount0: amount0Delta(sqrtPriceX96, sb, liquidity),
    amount1: amount1Delta(sa, sqrtPriceX96, liquidity),
    inRange: true,
  };
}
