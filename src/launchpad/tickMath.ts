// SPDX-License-Identifier: MIT
/* ============================================================================
   Tick <-> sqrtPriceX96, and single-sided liquidity, in exact bigint.

   WHY THE SDK NEEDS THIS. `LaunchpadKitV2` decides whether a CL leg is
   single-sided against the tick CORE reports after `initialize`, not against the
   price the launcher typed. A range that looks single-sided at the typed price
   but shares a tick boundary with it reverts `RangeNotSingleSided`. So a UI that
   wants to answer "will this revert?" before the wallet opens has to compute the
   same tick core computes, to the unit.

   The two functions below reproduce the DEFINITIONS core uses:

     sqrtRatioAtTick(t)  = sqrt(1.0001^t) * 2^96, rounded UP to Q64.96
     tickAtSqrtRatio(p)  = the greatest t with sqrtRatioAtTick(t) <= p

   `sqrtRatioAtTick` evaluates 1.0001^(-|t|/2) as a product of per-bit Q128.128
   factors (the published constants of this curve: 2^128 / 1.0001^(2^(i-1))),
   inverts for positive ticks, and rounds up. `tickAtSqrtRatio` is a plain binary
   search over that function, so its correctness follows from the first one and
   from monotonicity, not from a second transcription. Both are checked against
   values read off the Solidity (`test/fixtures/kitV2Vectors.json`).
   ============================================================================ */

/** Lowest tick core accepts. */
export const MIN_TICK = -887272;
/** Highest tick core accepts. */
export const MAX_TICK = 887272;
/** Smallest `tickSpacing` a CL pool accepts. */
export const MIN_TICK_SPACING = 1;
/** Largest `tickSpacing` a CL pool accepts (`type(int16).max`). */
export const MAX_TICK_SPACING = 32767;

const SQRT_MIN = 4295128739n;
const SQRT_MAX = 1461446703485210103287273052203988822378723970342n;
const Q32 = 1n << 32n;
const Q96 = 1n << 96n;
const Q128 = 1n << 128n;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT128 = (1n << 128n) - 1n;

/** Q128.128 factor for bit i of |tick|: 2^128 / sqrt(1.0001)^(2^i). Index 0 is bit 0x1. */
const BIT_FACTORS: readonly bigint[] = [
  0xfffcb933bd6fad37aa2d162d1a594001n,
  0xfff97272373d413259a46990580e213an,
  0xfff2e50f5f656932ef12357cf3c7fdccn,
  0xffe5caca7e10e4e61c3624eaa0941cd0n,
  0xffcb9843d60f6159c9db58835c926644n,
  0xff973b41fa98c081472e6896dfb254c0n,
  0xff2ea16466c96a3843ec78b326b52861n,
  0xfe5dee046a99a2a811c461f1969c3053n,
  0xfcbe86c7900a88aedcffc83b479aa3a4n,
  0xf987a7253ac413176f2b074cf7815e54n,
  0xf3392b0822b70005940c7a398e4b70f3n,
  0xe7159475a2c29b7443b29c7fa6e889d9n,
  0xd097f3bdfd2022b8845ad8f792aa5825n,
  0xa9f746462d870fdf8a65dc1f90e061e5n,
  0x70d869a156d2a1b890bb3df62baf32f7n,
  0x31be135f97d08fd981231505542fcfa6n,
  0x9aa508b5b7a84e1c677de54f3e99bc9n,
  0x5d6af8dedb81196699c329225ee604n,
  0x2216e584f5fa1ea926041bedfe98n,
  0x48a170391f7dc42444e8fa2n,
];

function assertTick(tick: number): void {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) {
    throw new RangeError(`tick ${tick} is outside [${MIN_TICK}, ${MAX_TICK}]`);
  }
}

/** `sqrt(1.0001^tick) * 2^96` as core computes it (rounded up). */
export function sqrtRatioAtTick(tick: number): bigint {
  assertTick(tick);
  const abs = Math.abs(tick);
  let ratio = Q128;
  for (let i = 0; i < BIT_FACTORS.length; i++) {
    if ((abs >> i) & 1) ratio = (ratio * (BIT_FACTORS[i] as bigint)) >> 128n;
  }
  // `ratio` is 1.0001^(-|t|/2) in Q128.128; for t=0 the loop leaves exactly 2^128.
  if (tick > 0) ratio = MAX_UINT256 / ratio;
  return (ratio >> 32n) + (ratio % Q32 === 0n ? 0n : 1n);
}

/**
 * The tick core stores for a `sqrtPriceX96`: the greatest tick whose sqrt ratio
 * is <= the price. Accepts `[MIN_SQRT_RATIO, MAX_SQRT_RATIO)`, as core does.
 */
export function tickAtSqrtRatio(sqrtPriceX96: bigint): number {
  if (sqrtPriceX96 < SQRT_MIN || sqrtPriceX96 >= SQRT_MAX) {
    throw new RangeError(`sqrtPriceX96 ${sqrtPriceX96} is outside [${SQRT_MIN}, ${SQRT_MAX})`);
  }
  let lo = MIN_TICK; // sqrtRatioAtTick(lo) <= p always holds
  let hi = MAX_TICK; // sqrtRatioAtTick(hi) > p always holds, since p < SQRT_MAX
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (sqrtRatioAtTick(mid) <= sqrtPriceX96) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** `(MIN_TICK / spacing) * spacing`, truncating toward zero as Solidity does. */
export function minUsableTick(tickSpacing: number): number {
  return Math.trunc(MIN_TICK / tickSpacing) * tickSpacing;
}

/** `(MAX_TICK / spacing) * spacing`. */
export function maxUsableTick(tickSpacing: number): number {
  return Math.trunc(MAX_TICK / tickSpacing) * tickSpacing;
}

function toUint128(v: bigint): bigint {
  if (v > MAX_UINT128) throw new RangeError(`liquidity ${v} does not fit uint128`);
  return v;
}

/**
 * `LiquidityAmounts.getLiquidityForAmounts` for the two shapes a single-sided
 * launch uses: price at or below the range (currency0 only) and price at or
 * above it (currency1 only). An in-range price is refused rather than computed:
 * the kit never seeds one, and the answer would invite a launch that reverts.
 *
 * @throws RangeError on uint128 overflow, as `SafeCast.toUint128` reverts.
 */
export function singleSidedLiquidity(args: {
  readonly sqrtPriceX96: bigint;
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly amount: bigint;
}): bigint {
  const a = sqrtRatioAtTick(args.tickLower);
  const b = sqrtRatioAtTick(args.tickUpper);
  if (a >= b) throw new RangeError("tickLower must be below tickUpper");
  if (args.sqrtPriceX96 <= a) {
    const intermediate = (a * b) / Q96;
    return toUint128((args.amount * intermediate) / (b - a));
  }
  if (args.sqrtPriceX96 >= b) {
    return toUint128((args.amount * Q96) / (b - a));
  }
  throw new RangeError("the price is inside the range, so the position is not single-sided");
}
