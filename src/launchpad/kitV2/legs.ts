// SPDX-License-Identifier: MIT
/* ============================================================================
   Kit v2 legs: pool keys, supply split, and the CL single-sided rule.

   POOL KEYS. A leg's key is fully determined by the launch token, the quote and
   the leg's kind and spacing - the kit never takes a fee or hook from the caller:

     currency0/1   the token and the quote, sorted by address (native = 0x0 sorts first)
     hooks         kit.clHook() for CL, kit.binHook() for Bin
     poolManager   kit.clPoolManager() / kit.binPoolManager()
     fee           0x800000, the dynamic-fee flag (a static fee would silently discard the guard's fee)
     parameters    CL: bitmap 0x41 | tickSpacing << 16    Bin: bitmap 0x45 | binStep << 16

   `computeKitV2LegKey` builds it off chain; `kit.computeLegKey(token, leg)` is
   the on-chain twin. `test/kitV2.test.ts` checks both kinds and both token sides
   against the kit's own answers.

   THE CL SIDE RULE, strict, against the tick core stores after `initialize`:

     launch token = currency0   tickLower  >  tick     (range entirely ABOVE the price)
     launch token = currency1   tickUpper  <= tick     (range entirely BELOW the price)

   Core keeps a position in range for `tickLower <= tick < tickUpper`, so a
   currency0 range whose lower tick EQUALS the current tick already needs quote
   currency - which nobody sent - and the kit refuses it (`RangeNotSingleSided`).
   ============================================================================ */

import type { Address, Hex } from "viem";

import { encodeBinPoolParameters, encodeCLPoolParameters } from "../../types/parameters.js";
import { poolKeyToId, type PoolKey } from "../../types/poolKey.js";
import { MAX_SQRT_RATIO, MIN_SQRT_RATIO } from "../price.js";
import {
  MAX_TICK_SPACING,
  MIN_TICK_SPACING,
  maxUsableTick,
  minUsableTick,
  singleSidedLiquidity,
  sqrtRatioAtTick,
  tickAtSqrtRatio,
} from "../tickMath.js";
import {
  KIT_V2_BIN_HOOK_BITMAP,
  KIT_V2_BPS,
  KIT_V2_CL_HOOK_BITMAP,
  KIT_V2_LEG_FEE,
  LEG_KIND,
  type CLLegParamsV2,
} from "./types.js";

const MAX_UINT128 = (1n << 128n) - 1n;

/** The four kit immutables a leg key is built from. Read them off the kit once. */
export interface KitV2LegEnv {
  readonly clHook: Address;
  readonly binHook: Address;
  readonly clPoolManager: Address;
  readonly binPoolManager: Address;
}

export interface KitV2LegKey {
  readonly key: PoolKey;
  readonly poolId: Hex;
  readonly launchTokenIsCurrency0: boolean;
}

/** True when the launch token sorts first: `uint160(token) < uint160(quote)`. */
export function launchTokenIsCurrency0(token: Address, quote: Address): boolean {
  const t = BigInt(token);
  const q = BigInt(quote);
  if (t === q) throw new RangeError(`quote ${quote} is the launch token itself (QuoteIsLaunchToken)`);
  return t < q;
}

/** `LaunchpadKitV2.computeLegKey`, off chain. */
export function computeKitV2LegKey(args: {
  readonly env: KitV2LegEnv;
  readonly token: Address;
  readonly quote: Address;
  readonly kind: number;
  /** `cl.tickSpacing` for a CL leg, `bin.binStep` for a Bin leg. */
  readonly tickSpacingOrBinStep: number;
}): KitV2LegKey {
  const is0 = launchTokenIsCurrency0(args.token, args.quote);
  const [currency0, currency1] = is0 ? [args.token, args.quote] : [args.quote, args.token];
  let key: PoolKey;
  if (args.kind === LEG_KIND.CL) {
    key = {
      currency0,
      currency1,
      hooks: args.env.clHook,
      poolManager: args.env.clPoolManager,
      fee: KIT_V2_LEG_FEE,
      parameters: encodeCLPoolParameters(KIT_V2_CL_HOOK_BITMAP, args.tickSpacingOrBinStep),
    };
  } else if (args.kind === LEG_KIND.Bin) {
    key = {
      currency0,
      currency1,
      hooks: args.env.binHook,
      poolManager: args.env.binPoolManager,
      fee: KIT_V2_LEG_FEE,
      parameters: encodeBinPoolParameters(KIT_V2_BIN_HOOK_BITMAP, args.tickSpacingOrBinStep),
    };
  } else {
    throw new RangeError(`${args.kind} is not a LegKind (0 CL, 1 Bin)`);
  }
  return { key, poolId: poolKeyToId(key), launchTokenIsCurrency0: is0 };
}

/**
 * Launch-token units each leg seeds: `seedSupply * weightBps / 10_000`, floored,
 * with the LAST leg taking the remainder - the kit's own split.
 *
 * @returns per-leg supplies, plus the first problem the kit would revert with.
 */
export function kitV2LegSupplies(
  seedSupply: bigint,
  weightsBps: readonly number[],
): {
  readonly supplies: readonly bigint[];
  readonly problem:
    | null
    | { readonly error: "LegWeightsDoNotSum"; readonly sum: number }
    | { readonly error: "EmptyLeg" | "LegTooLarge"; readonly index: number };
} {
  const supplies: bigint[] = [];
  let remaining = seedSupply;
  let sum = 0;
  for (let i = 0; i < weightsBps.length; i++) {
    const w = weightsBps[i] as number;
    sum += w;
    const supply = i + 1 === weightsBps.length ? remaining : (seedSupply * BigInt(w)) / BigInt(KIT_V2_BPS);
    if (supply > remaining) {
      // Solidity's checked `remaining -= supply` would revert; only reachable with weights over 100%.
      return { supplies, problem: { error: "LegWeightsDoNotSum", sum } };
    }
    remaining -= supply;
    if (supply === 0n) return { supplies, problem: { error: "EmptyLeg", index: i } };
    if (supply > MAX_UINT128) return { supplies, problem: { error: "LegTooLarge", index: i } };
    supplies.push(supply);
  }
  if (sum !== KIT_V2_BPS) return { supplies, problem: { error: "LegWeightsDoNotSum", sum } };
  return { supplies, problem: null };
}

/** Why a CL leg would revert, or `null`. */
export interface CLLegProblem {
  readonly error:
    | "InvalidTickSpacing"
    | "InvalidSqrtPrice"
    | "InvalidTickRange"
    | "TickMisaligned"
    | "TickOutOfBounds"
    | "RangeNotSingleSided"
    | "SeedProducesNoLiquidity";
  readonly message: string;
}

/**
 * Every reason a CL leg fails before it reaches the position manager: spacing,
 * price range, tick alignment and bounds, the strict side rule, and zero
 * liquidity for the leg's supply.
 *
 * `error` names the kit error where one exists (`RangeNotSingleSided`,
 * `SeedProducesNoLiquidity`); the others are core/position-manager reverts,
 * named descriptively.
 */
export function checkKitV2CLLeg(args: {
  readonly cl: CLLegParamsV2;
  readonly launchTokenIsCurrency0: boolean;
  /** The leg's launch-token supply (`kitV2LegSupplies`). Omit to skip the liquidity check. */
  readonly supply?: bigint;
}): { readonly currentTick: number | null; readonly problem: CLLegProblem | null } {
  const { tickSpacing, sqrtPriceX96, tickLower, tickUpper } = args.cl;
  if (!Number.isInteger(tickSpacing) || tickSpacing < MIN_TICK_SPACING || tickSpacing > MAX_TICK_SPACING) {
    return {
      currentTick: null,
      problem: { error: "InvalidTickSpacing", message: `tickSpacing must be in [1, 32767], got ${tickSpacing}.` },
    };
  }
  if (sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 >= MAX_SQRT_RATIO) {
    return {
      currentTick: null,
      problem: {
        error: "InvalidSqrtPrice",
        message: `sqrtPriceX96 must be in [${MIN_SQRT_RATIO}, ${MAX_SQRT_RATIO}); build it with sqrtPriceForLaunch().`,
      },
    };
  }
  const currentTick = tickAtSqrtRatio(sqrtPriceX96);
  if (tickLower >= tickUpper) {
    return { currentTick, problem: { error: "InvalidTickRange", message: "tickLower must be below tickUpper." } };
  }
  if (tickLower % tickSpacing !== 0 || tickUpper % tickSpacing !== 0) {
    return {
      currentTick,
      problem: { error: "TickMisaligned", message: `Both ticks must be multiples of tickSpacing (${tickSpacing}).` },
    };
  }
  if (tickLower < minUsableTick(tickSpacing) || tickUpper > maxUsableTick(tickSpacing)) {
    return {
      currentTick,
      problem: {
        error: "TickOutOfBounds",
        message: `Ticks must lie in [${minUsableTick(tickSpacing)}, ${maxUsableTick(tickSpacing)}] for spacing ${tickSpacing}.`,
      },
    };
  }
  const singleSided = args.launchTokenIsCurrency0 ? tickLower > currentTick : tickUpper <= currentTick;
  if (!singleSided) {
    return {
      currentTick,
      problem: {
        error: "RangeNotSingleSided",
        message: args.launchTokenIsCurrency0
          ? `The launch token is currency0, so the range must start strictly above the price's tick: ` +
            `tickLower ${tickLower} must be > ${currentTick}.`
          : `The launch token is currency1, so the range must end at or below the price's tick: ` +
            `tickUpper ${tickUpper} must be <= ${currentTick}.`,
      },
    };
  }
  if (args.supply !== undefined) {
    let liquidity: bigint;
    try {
      liquidity = singleSidedLiquidity({ sqrtPriceX96, tickLower, tickUpper, amount: args.supply });
    } catch (e) {
      return {
        currentTick,
        problem: { error: "SeedProducesNoLiquidity", message: e instanceof Error ? e.message : String(e) },
      };
    }
    if (liquidity === 0n) {
      return {
        currentTick,
        problem: {
          error: "SeedProducesNoLiquidity",
          message: `A supply of ${args.supply} over [${tickLower}, ${tickUpper}) is zero liquidity; raise the supply or narrow the range.`,
        },
      };
    }
  }
  return { currentTick, problem: null };
}

function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/**
 * A single-sided CL range adjacent to the opening price, on the side the kit
 * requires, `widthInSpacings` spacings wide.
 *
 *   currency0 launch: tickLower = the first multiple of spacing STRICTLY above
 *                     the price's tick; tickUpper = tickLower + width.
 *   currency1 launch: tickUpper = the last multiple of spacing AT OR below the
 *                     price's tick; tickLower = tickUpper - width.
 *
 * With `snapPrice`, the opening price is moved onto the range edge so the first
 * buy trades against liquidity instead of jumping the gap between the price and
 * the nearest boundary (up to one spacing): `sqrtRatioAtTick(tickLower) - 1` for
 * a currency0 launch (its tick is `tickLower - 1`, still strictly below), and
 * `sqrtRatioAtTick(tickUpper)` for a currency1 launch (its tick equals
 * `tickUpper`, which the rule allows). Snapping CHANGES the price, by less than
 * one spacing: show the resulting price, not the typed one.
 *
 * @throws RangeError when the range would leave the usable tick space.
 */
export function kitV2CLLaunchRange(args: {
  readonly launchTokenIsCurrency0: boolean;
  readonly sqrtPriceX96: bigint;
  readonly tickSpacing: number;
  readonly widthInSpacings: number;
  readonly snapPrice?: boolean;
}): CLLegParamsV2 {
  const s = args.tickSpacing;
  if (!Number.isInteger(s) || s < MIN_TICK_SPACING || s > MAX_TICK_SPACING) {
    throw new RangeError(`tickSpacing must be in [1, 32767], got ${s}`);
  }
  if (!Number.isInteger(args.widthInSpacings) || args.widthInSpacings < 1) {
    throw new RangeError("widthInSpacings must be a positive integer");
  }
  const tick = tickAtSqrtRatio(args.sqrtPriceX96);
  const width = args.widthInSpacings * s;
  let tickLower: number;
  let tickUpper: number;
  if (args.launchTokenIsCurrency0) {
    tickLower = floorDiv(tick, s) * s + s;
    tickUpper = tickLower + width;
  } else {
    tickUpper = floorDiv(tick, s) * s;
    tickLower = tickUpper - width;
  }
  if (tickLower < minUsableTick(s) || tickUpper > maxUsableTick(s)) {
    throw new RangeError(
      `the range [${tickLower}, ${tickUpper}) leaves the usable ticks [${minUsableTick(s)}, ${maxUsableTick(s)}]; ` +
        "narrow it or move the price",
    );
  }
  let sqrtPriceX96 = args.sqrtPriceX96;
  if (args.snapPrice === true) {
    sqrtPriceX96 = args.launchTokenIsCurrency0 ? sqrtRatioAtTick(tickLower) - 1n : sqrtRatioAtTick(tickUpper);
    if (sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 >= MAX_SQRT_RATIO) {
      throw new RangeError("the snapped price is outside the representable range; do not snap at the tick extremes");
    }
  }
  return { tickSpacing: s, sqrtPriceX96, tickLower, tickUpper };
}
