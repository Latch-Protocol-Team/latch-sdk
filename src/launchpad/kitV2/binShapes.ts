// SPDX-License-Identifier: MIT
/* ============================================================================
   Bin launch shapes: the named distributions, and the R1-R6 pre-validator.

   A Bin leg spreads its launch-token supply over bins on the launch token's side
   of the active bin. Offsets and weights are in FILL ORDER: offset 1 is the bin
   next to the active bin, and buyers consume bins in increasing offset. The kit
   maps them onto ids itself (above active when the launch token is currency0,
   below when it is currency1), so a caller cannot put a shape on the quote side.

   THE NAMED SHAPES are a promise a UI can describe in one word, so their
   parameters are fixed by the kit, not chosen by the caller:

     Flat         every bin equal
     Linear       bin k proportional to (n - k)
     Exponential  each bin 9/10 of the previous one
     Stepped      tiers of 4 contiguous bins, tier weight decreasing, 2 empty
                  bins between tiers; offsets 1 + k + 2*floor(k/4)

   Weights are floored to 1e18 precision and the LAST bin takes the remainder, so
   they sum to exactly 1e18. `buildBinShape` reproduces that arithmetic exactly;
   `test/kitV2BinShapes.test.ts` checks it against arrays read off the Solidity
   for every shape at ten sizes.

   THE RULES a custom distribution must satisfy, in the order the kit checks them
   (the FIRST failure is the one the transaction reverts with, and this module
   reports that same one):

     R4 count      1 <= n <= maxBinsPerLeg              BinShapeBadCount
     R4 lengths    weights.length == offsets.length     BinShapeLengthMismatch
     R3 floor      1 <= floorBins <= n                  BinShapeInvalidFloor
     per bin k, in order:
       R1          offsets[k] >= 1                      BinShapeNotSingleSided(k)
       R2          offsets[k] > offsets[k-1]            BinShapeNotMonotonic(k)
       R3          k < floorBins => offsets[k] == k+1   BinShapeGapBelowFloor(k)
       R6          weights[k] > 0                       BinShapeZeroWeight(k)
       R6          floor(supply * weights[k] / 1e18) > 0 BinShapeDustBin(k)
     R5 total      sum(weights) == 1e18                 BinShapeWeightsDoNotSum(sum)

   Named shapes pass through the same validator on chain, so a named shape can
   still fail R6 when the leg's supply is tiny. Validate both kinds.
   ============================================================================ */

import { BIN_SHAPE, BIN_WEIGHT_PRECISION, type BinShapeName } from "./types.js";

const EXP_RATIO_NUM = 9n;
const EXP_RATIO_DEN = 10n;
const STEP_TIER_BINS = 4;
const STEP_GAP_BINS = 2;
const MAX_UINT24 = 0xffffff;
const MAX_UINT64 = (1n << 64n) - 1n;

/** The arrays a shape resolves to, as the kit passes them to its validator. */
export interface BinDistribution {
  /** Distances from the active bin, fill order. `uint24[]`. */
  readonly offsets: readonly number[];
  /** 1e18-precision fractions of the leg's supply. `uint64[]`. */
  readonly weights: readonly bigint[];
  readonly floorBins: number;
}

/** Which rule a distribution breaks, and the kit error it would revert with. */
export interface BinShapeViolation {
  readonly rule: "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "encoding";
  /** The `BinLaunchShapes` custom error, by name. `encoding` has none: the call would not even encode. */
  readonly error:
    | "BinShapeBadCount"
    | "BinShapeLengthMismatch"
    | "BinShapeInvalidFloor"
    | "BinShapeNotSingleSided"
    | "BinShapeNotMonotonic"
    | "BinShapeGapBelowFloor"
    | "BinShapeZeroWeight"
    | "BinShapeDustBin"
    | "BinShapeWeightsDoNotSum"
    | null;
  /** The bin index at fault, for the per-bin rules. */
  readonly index?: number;
  readonly message: string;
}

function shapeValue(shape: BinShapeName | number): number {
  const value = typeof shape === "number" ? shape : BIN_SHAPE[shape];
  if (value === undefined || !Number.isInteger(value) || value < 0 || value > BIN_SHAPE.Stepped) {
    throw new RangeError(`${String(shape)} is not a BinShape (0-4)`);
  }
  return value;
}

/**
 * `BinLaunchShapes.build`: the distribution a NAMED shape resolves to.
 *
 * @throws RangeError for `Custom` (it has no parameters: the caller supplies the
 * arrays) and for `binCount` outside `[1, maxBins]` (on chain: `BinShapeBadCount`).
 */
export function buildBinShape(shape: BinShapeName | number, binCount: number, maxBins: number): BinDistribution {
  const s = shapeValue(shape);
  if (s === BIN_SHAPE.Custom) {
    throw new RangeError("BinShape.Custom has no built distribution; pass offsets, weights and floorBins yourself");
  }
  if (!Number.isInteger(binCount) || binCount <= 0 || binCount > maxBins) {
    throw new RangeError(`binCount ${binCount} is outside [1, ${maxBins}] (BinShapeBadCount)`);
  }
  const n = binCount;
  const raw: bigint[] = [];
  const offsets: number[] = [];
  const tiers = BigInt(Math.floor((n + STEP_TIER_BINS - 1) / STEP_TIER_BINS));
  let total = 0n;
  let r = BIN_WEIGHT_PRECISION;
  for (let k = 0; k < n; k++) {
    let w: bigint;
    if (s === BIN_SHAPE.Linear) {
      w = BigInt(n - k);
    } else if (s === BIN_SHAPE.Exponential) {
      w = r;
      r = (r * EXP_RATIO_NUM) / EXP_RATIO_DEN;
    } else if (s === BIN_SHAPE.Stepped) {
      w = tiers - BigInt(Math.floor(k / STEP_TIER_BINS));
    } else {
      w = 1n;
    }
    raw.push(w);
    total += w;
    offsets.push(s === BIN_SHAPE.Stepped ? 1 + k + STEP_GAP_BINS * Math.floor(k / STEP_TIER_BINS) : 1 + k);
  }
  const weights: bigint[] = [];
  let sum = 0n;
  for (let k = 0; k + 1 < n; k++) {
    const w = ((raw[k] as bigint) * BIN_WEIGHT_PRECISION) / total;
    weights.push(w);
    sum += w;
  }
  weights.push(BIN_WEIGHT_PRECISION - sum);
  const floorBins = s === BIN_SHAPE.Stepped && n > STEP_TIER_BINS ? STEP_TIER_BINS : n;
  return { offsets, weights, floorBins };
}

/**
 * `BinLaunchShapes.validate`, locally: `null` when the distribution passes, or
 * the FIRST rule it breaks, in the kit's own order.
 *
 * @param maxBins the kit's `maxBinsPerLeg()`.
 * @param supply the launch-token units this leg seeds (see `legSupplies`).
 */
export function validateBinDistribution(
  d: BinDistribution,
  maxBins: number,
  supply: bigint,
): BinShapeViolation | null {
  const n = d.offsets.length;
  for (let k = 0; k < n; k++) {
    const off = d.offsets[k] as number;
    if (!Number.isInteger(off) || off < 0 || off > MAX_UINT24) {
      return { rule: "encoding", error: null, index: k, message: `offsets[${k}] = ${off} is not a uint24` };
    }
  }
  for (let k = 0; k < d.weights.length; k++) {
    const w = d.weights[k] as bigint;
    if (w < 0n || w > MAX_UINT64) {
      return { rule: "encoding", error: null, index: k, message: `weights[${k}] = ${w} is not a uint64` };
    }
  }
  if (!Number.isInteger(d.floorBins) || d.floorBins < 0 || d.floorBins > 0xffff) {
    return { rule: "encoding", error: null, message: `floorBins ${d.floorBins} is not a uint16` };
  }

  if (n === 0 || n > maxBins) {
    return { rule: "R4", error: "BinShapeBadCount", message: `${n} bins; a leg holds 1 to ${maxBins}.` };
  }
  if (d.weights.length !== n) {
    return {
      rule: "R4",
      error: "BinShapeLengthMismatch",
      message: `${n} offsets but ${d.weights.length} weights; they must pair one to one.`,
    };
  }
  if (d.floorBins === 0 || d.floorBins > n) {
    return {
      rule: "R3",
      error: "BinShapeInvalidFloor",
      message: `floorBins ${d.floorBins} must be between 1 and the bin count (${n}).`,
    };
  }
  let sum = 0n;
  for (let k = 0; k < n; k++) {
    const off = d.offsets[k] as number;
    if (off === 0) {
      return {
        rule: "R1",
        error: "BinShapeNotSingleSided",
        index: k,
        message: `offsets[${k}] is 0, the active bin itself; every launch bin must sit at least one bin away.`,
      };
    }
    if (k !== 0 && off <= (d.offsets[k - 1] as number)) {
      return {
        rule: "R2",
        error: "BinShapeNotMonotonic",
        index: k,
        message: `offsets[${k}] (${off}) does not increase on offsets[${k - 1}]; bin prices must move away from spot.`,
      };
    }
    if (k < d.floorBins && off !== k + 1) {
      return {
        rule: "R3",
        error: "BinShapeGapBelowFloor",
        index: k,
        message: `offsets[${k}] must be ${k + 1}: the first ${d.floorBins} bins may not leave a gap near the opening price.`,
      };
    }
    const w = d.weights[k] as bigint;
    if (w === 0n) {
      return { rule: "R6", error: "BinShapeZeroWeight", index: k, message: `weights[${k}] is zero; every bin must hold supply.` };
    }
    if ((supply * w) / BIN_WEIGHT_PRECISION === 0n) {
      return {
        rule: "R6",
        error: "BinShapeDustBin",
        index: k,
        message: `bin ${k} would receive floor(${supply} * ${w} / 1e18) = 0 units; raise the leg's supply or its weight.`,
      };
    }
    sum += w;
  }
  if (sum !== BIN_WEIGHT_PRECISION) {
    return {
      rule: "R5",
      error: "BinShapeWeightsDoNotSum",
      message: `weights sum to ${sum}; they must sum to exactly 1e18.`,
    };
  }
  return null;
}

/**
 * The bin ids a leg seeds, ascending (the order the Bin locker records), and
 * whether any falls outside core's id space - the kit's `BinIdOutOfRange`.
 *
 * Launch token = currency0: ids `activeId + offset`, which must stay <= 2^24 - 1.
 * Launch token = currency1: ids `activeId - offset`, which requires offset < activeId.
 */
export function binLegIds(args: {
  readonly activeId: number;
  readonly offsets: readonly number[];
  readonly launchTokenIsCurrency0: boolean;
}): { readonly binIds: readonly number[]; readonly outOfRangeIndex: number | null } {
  const ids: number[] = [];
  for (let k = 0; k < args.offsets.length; k++) {
    const off = args.offsets[k] as number;
    if (args.launchTokenIsCurrency0) {
      if (args.activeId + off > MAX_UINT24) return { binIds: [], outOfRangeIndex: k };
      ids.push(args.activeId + off);
    } else {
      if (off >= args.activeId) return { binIds: [], outOfRangeIndex: k };
      ids.push(args.activeId - off);
    }
  }
  return { binIds: ids.sort((a, b) => a - b), outOfRangeIndex: null };
}
