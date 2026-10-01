// SPDX-License-Identifier: MIT
/* ============================================================================
   The trade fee a "quote-fee" launch guard takes, off chain: how a pot splits,
   what a swap pays, why a swap is refused, and the calls that move the fee.

   EVERYTHING HERE APPLIES TO "quote-fee" GUARDS ONLY. On an "lp-fee" guard the
   trade fee is an LP fee: the pool charges it, the lockers pay it out, and none
   of the functions encoded below exist. Read the generation first
   (`readGuardGeneration`).

   THE TRADE FEE HAS TWO PARTS ON A BUY. A guard leaves a share of the trade fee
   to the pool's liquidity providers: `LP_SHARE_BPS`, fixed when the guard was
   deployed, at most 50%, and it may be zero. It is paid on buys only, which is
   what keeps it in the quote currency (a pool charges its LP fee on a swap's
   input, and a sell's input is the launch token):

       buy    the pool charges   lp    = floor(fee * LP_SHARE_BPS / 10_000)
              the guard takes    fee - lp
       sell   the pool charges   nothing
              the guard takes    fee

   all in hundredths of a bip, and every part is paid in the quote. Read the
   parts from the guard (`readGuardFeeParts`): `currentFeeParts(poolId)` is the
   authority, and a guard that does not answer it has a split nobody knows.
   NEVER ASSUME THE SHARE IS ZERO.

   ONE BASE, TWO RATES. What the GUARD takes and the tax are each a rate on the
   swap's QUOTE amount, and each is floored on its own:

       fee  = floor(quote * guardPips / 1_000_000)
       tax  = floor(quote * taxBps    / 10_000)
       take = fee + tax

   `guardPips` is the guard's part for the swap's direction, not the whole trade
   fee. Neither is charged on the other. Where the quote amount comes from
   depends on the swap's shape:

       buy,  exact input    the quote NAMED        taken before the swap
       sell, exact output   the quote NAMED        taken before the swap
       sell, exact input    the quote the pool pays out     taken after it
       buy,  exact output   the quote the pool asks for     taken after it

   THE TWO "NAMED" SHAPES CAN BE REFUSED. They are charged before the pool has
   computed anything, so the pool must then trade exactly what was named less the
   take (exact input) or plus it (exact output). A CL pool that can only fill
   part of that makes the guard revert `SwapNotFilled(expected, traded)`: a buy
   larger than a launch range can absorb is refused, not filled in part. Size it
   from a quote (`largestExactInputFor`). A Bin pool reverts on its own
   (`BinPool__OutOfLiquidity`) and never reaches the guard's check.

   A BUYER NEVER PAYS MORE THAN THE TRADE FEE. On a buy that names its output
   both parts are rates on the same amount, the quote the pool asks for, and add
   up to the fee. On a buy that names its input the guard takes its part (and
   the tax) of the amount named and the pool charges its part on what is left,
   so the buyer pays a little less than the fee.

   A POT SPLITS THE WAY THE CONTRACT SPLITS IT: the creator's and the
   integrator's shares are floored, and the protocol takes what is left, so a pot
   always drains to zero.

   Amounts are raw units of the pool's quote currency. Nothing here is a price.
   ============================================================================ */

import {
  decodeErrorResult,
  encodeErrorResult,
  encodeFunctionData,
  getAbiItem,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { isRevertError } from "../../chains/revert.js";
import { UNIVERSAL_ROUTER_ABI } from "../../trading/generated/abi.js";
import { LAUNCH_GUARD_HOOK_ABI } from "../generated/abi.js";
import { KIT_V2_BPS } from "./types.js";

/** Denominator of the trade fee: hundredths of a bip, 1_000_000 = 100%. */
export const GUARD_FEE_PIPS_DENOMINATOR = 1_000_000;

/**
 * The bound on the liquidity providers' share of the trade fee, a constant in
 * both quote-fee guards' bytecode (`MAX_LP_SHARE_BPS`). A default for a form;
 * the deployed guard's own constant is the authority.
 */
export const GUARD_LP_SHARE_LIMITS = {
  MAX_LP_SHARE_BPS: 5_000,
} as const;

/* --------------------------------------------------------------- parts --- */

/**
 * The parts of a trade fee, in hundredths of a bip, as `feePartsAt` and
 * `currentFeeParts` answer them. `buyLpPips + buyGuardPips` is the whole trade
 * fee, and so is `sellGuardPips`.
 */
export interface GuardFeeParts {
  /** What the POOL charges a buy as its LP fee, on the quote it takes in. Paid to the pool's liquidity providers. */
  readonly buyLpPips: number;
  /** What the GUARD takes from a buy, in the quote. */
  readonly buyGuardPips: number;
  /** What the GUARD takes from a sell, in the quote: the whole trade fee. The pool charges a sell nothing. */
  readonly sellGuardPips: number;
}

function assertPips(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > GUARD_FEE_PIPS_DENOMINATOR) {
    throw new RangeError(`${name} must be an integer in [0, ${GUARD_FEE_PIPS_DENOMINATOR}], received ${value}`);
  }
}

/**
 * The parts of a trade fee of `feePips` on a guard whose `LP_SHARE_BPS` is
 * `lpShareBps`, exactly as the guard computes them: the pool's part is floored,
 * so the rounding pip goes to the guard's three parties.
 *
 * For a fee resolved off chain (a schedule and a clock, `guardFeeAt`). With a
 * chain to hand, read `currentFeeParts(poolId)` instead (`readGuardFeeParts`).
 * `lpShareBps` must have been READ from the guard: there is no default.
 */
export function guardFeeParts(feePips: number, lpShareBps: number): GuardFeeParts {
  assertPips(feePips, "feePips");
  if (!Number.isInteger(lpShareBps) || lpShareBps < 0 || lpShareBps > KIT_V2_BPS) {
    throw new RangeError(`lpShareBps must be an integer in [0, ${KIT_V2_BPS}], received ${lpShareBps}`);
  }
  const buyLpPips = Number((BigInt(feePips) * BigInt(lpShareBps)) / BigInt(KIT_V2_BPS));
  return { buyLpPips, buyGuardPips: feePips - buyLpPips, sellGuardPips: feePips };
}

/** The two rates one swap pays: the guard's take and the pool's LP fee, both in hundredths of a bip. */
export interface GuardSwapRates {
  /** What the guard takes, of the swap's quote amount. Feed this to `guardQuoteTake` as `feePips`. */
  readonly guardPips: number;
  /** What the pool charges as its LP fee. Zero on every sell. */
  readonly lpPips: number;
}

/** The rates a swap in one direction pays under `parts`. */
export function guardSwapRates(parts: GuardFeeParts, isBuy: boolean): GuardSwapRates {
  return isBuy ? { guardPips: parts.buyGuardPips, lpPips: parts.buyLpPips } : { guardPips: parts.sellGuardPips, lpPips: 0 };
}

/** What `readGuardFeeParts` found. Each half is `null` when the guard did not answer it. */
export interface GuardFeePartsReading {
  /**
   * `LP_SHARE_BPS()`: the share of the trade fee the guard leaves to the pool on
   * buys, in basis points. `null`: the guard did not answer. Unknown, NOT zero.
   */
  readonly lpShareBps: number | null;
  /** `currentFeeParts(poolId)`. `null`: the guard did not answer, or has no launch for this pool. */
  readonly parts: GuardFeeParts | null;
}

/**
 * `null` for a contract that reverted or has no such function; rethrows a transport failure.
 * A guard that simply has no `currentFeeParts` reads as "not answered" (`chains/revert.ts`).
 */
async function nullWhenUnanswered<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (isRevertError(error, { zeroData: true })) return null;
    throw error;
  }
}

/**
 * `LP_SHARE_BPS()` of a "quote-fee" guard: the share of the trade fee it leaves
 * to the pool's liquidity providers on buys, in basis points. One value per
 * guard, fixed when it was deployed; zero is a real answer.
 *
 * `null` when the guard did not answer (it reverted, or has no such function):
 * the share is then unknown, never zero. A transport failure throws.
 */
export async function readGuardLpShareBps(client: PublicClient, guard: Address): Promise<number | null> {
  const share = await nullWhenUnanswered(client.readContract({ address: guard, abi: LAUNCH_GUARD_HOOK_ABI, functionName: "LP_SHARE_BPS" }));
  return share === null ? null : Number(share);
}

/**
 * The parts of the trade fee a swap on `poolId` pays now, and the guard's share
 * for liquidity providers, read from a "quote-fee" guard.
 *
 * CALL IT ON A "quote-fee" GUARD ONLY (`readGuardGeneration`): an "lp-fee" guard
 * has neither function, and there the whole trade fee is the pool's LP fee.
 *
 * A guard that does not answer is reported as `null`, never as a share of zero:
 * the trade fee is still `currentFee(poolId)`, and who receives which part of it
 * is not known. A transport failure throws.
 */
export async function readGuardFeeParts(client: PublicClient, guard: Address, poolId: Hex): Promise<GuardFeePartsReading> {
  const [lpShareBps, parts] = await Promise.all([
    readGuardLpShareBps(client, guard),
    nullWhenUnanswered(client.readContract({ address: guard, abi: LAUNCH_GUARD_HOOK_ABI, functionName: "currentFeeParts", args: [poolId] })),
  ]);
  return {
    lpShareBps,
    parts: parts === null ? null : { buyLpPips: Number(parts[0]), buyGuardPips: Number(parts[1]), sellGuardPips: Number(parts[2]) },
  };
}

/**
 * The fee split's bounds, constants in both quote-fee guards' bytecode. They are
 * the lockers' figures, since this fee replaces what a lock earned.
 * Defaults for a form; the deployed guard's own constants are the authority.
 */
export const LAUNCH_FEE_SPLIT_LIMITS = {
  /** The protocol's floor on every trade fee: 20%. Enforced by the guard, never by the kit. */
  MIN_FEE_PROTOCOL_BPS: 2_000,
  MAX_PROTOCOL_BPS: 5_000,
  MAX_INTEGRATOR_BPS: 2_000,
} as const;

/* ---------------------------------------------------------------- pots --- */

/** The two shares of a split that are rates. The protocol's is the remainder, so it is not an input. */
export interface GuardSplitShares {
  readonly creatorBps: number;
  readonly integratorBps: number;
}

export interface GuardPotSplit {
  readonly toCreator: bigint;
  readonly toIntegrator: bigint;
  /** `pot - toCreator - toIntegrator`: the protocol's share plus every rounding unit. */
  readonly toProtocol: bigint;
}

function assertBps(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > KIT_V2_BPS) {
    throw new RangeError(`${name} must be an integer in [0, ${KIT_V2_BPS}], received ${value}`);
  }
}

/**
 * What settling `pot` credits to each party, exactly as the guard computes it
 * (`settleFee` and `settleTax` share the arithmetic).
 */
export function splitGuardPot(pot: bigint, shares: GuardSplitShares): GuardPotSplit {
  if (pot < 0n) throw new RangeError(`a pot is non-negative, received ${pot}`);
  assertBps(shares.creatorBps, "creatorBps");
  assertBps(shares.integratorBps, "integratorBps");
  if (shares.creatorBps + shares.integratorBps > KIT_V2_BPS) {
    throw new RangeError(`creatorBps + integratorBps is ${shares.creatorBps + shares.integratorBps}, above ${KIT_V2_BPS}`);
  }
  const toCreator = (pot * BigInt(shares.creatorBps)) / BigInt(KIT_V2_BPS);
  const toIntegrator = (pot * BigInt(shares.integratorBps)) / BigInt(KIT_V2_BPS);
  return { toCreator, toIntegrator, toProtocol: pot - toCreator - toIntegrator };
}

/* --------------------------------------------------------------- swaps --- */

/** Where the guard charges a swap: on the amount named, before the pool trades, or on what the pool traded. */
export type GuardChargePoint = "beforeSwap" | "afterSwap";

/**
 * The quote currency is the specified side of an exact-input buy and of an
 * exact-output sell; those two are charged in `beforeSwap`, on the amount named,
 * and are the two a CL guard can refuse with `SwapNotFilled`.
 */
export function guardChargePoint(swap: { readonly isBuy: boolean; readonly exactInput: boolean }): GuardChargePoint {
  return swap.isBuy === swap.exactInput ? "beforeSwap" : "afterSwap";
}

export interface GuardTake {
  /** The guard's part of the trade fee. The pool's part, on a buy, is not in it. */
  readonly fee: bigint;
  readonly tax: bigint;
  /** `fee + tax`. */
  readonly take: bigint;
  /**
   * For a swap charged on the amount NAMED: what must reach the pool in the quote
   * currency. `amount - take` on exact input, `amount + take` on exact output.
   * This is `SwapNotFilled`'s `expected`. On a buy the pool charges its own LP
   * fee out of this amount (`guardBuyCharges`).
   */
  readonly poolAmount: bigint;
}

/**
 * What the GUARD takes from a swap whose quote amount is `amount`.
 *
 * @param args.amount The swap's quote amount, raw units: the amount named for the
 * two shapes charged before the swap, the pool's own quote amount otherwise
 * (on a buy that names its output, that amount includes the pool's LP fee).
 * @param args.feePips THE GUARD'S PART of the trade fee for the swap's direction
 * and the second it lands in: `buyGuardPips` on a buy, `sellGuardPips` on a sell
 * (`currentFeeParts(poolId)`, or `guardSwapRates`). Not `currentFee(poolId)`,
 * which is the whole trade fee: on a buy the pool charges part of that itself.
 * @param args.taxBps The LIVE tax rate for the swap's direction (`currentTaxRates(poolId)`):
 * zero once the tax has expired, whatever the stored rate says.
 * @param args.exactInput Whether the swap names its input.
 */
export function guardQuoteTake(args: {
  readonly amount: bigint;
  readonly feePips: number;
  readonly taxBps: number;
  readonly exactInput: boolean;
}): GuardTake {
  if (args.amount < 0n) throw new RangeError(`an amount is non-negative, received ${args.amount}`);
  assertPips(args.feePips, "feePips");
  assertBps(args.taxBps, "taxBps");
  const fee = (args.amount * BigInt(args.feePips)) / BigInt(GUARD_FEE_PIPS_DENOMINATOR);
  const tax = (args.amount * BigInt(args.taxBps)) / BigInt(KIT_V2_BPS);
  const take = fee + tax;
  if (args.exactInput && take > args.amount) {
    throw new RangeError(`the rates take ${take} of ${args.amount}: more than the swap (core reverts HookDeltaExceedsSwapAmount)`);
  }
  return { fee, tax, take, poolAmount: args.exactInput ? args.amount - take : args.amount + take };
}

/** What a buy that names its input pays, part by part, in raw units of the quote. */
export interface GuardBuyCharges {
  /** The guard's part of the trade fee: `floor(amount * buyGuardPips / 1_000_000)`. */
  readonly guardFee: bigint;
  /** The creator tax: `floor(amount * taxBps / 10_000)`. */
  readonly tax: bigint;
  /** `guardFee + tax`: what the guard takes before the pool trades. */
  readonly take: bigint;
  /** `amount - take`: what reaches the pool. `SwapNotFilled`'s `expected`. */
  readonly poolAmount: bigint;
  /** The pool's LP fee, charged on `poolAmount` and paid to the pool's liquidity providers. See the note on rounding. */
  readonly lpFee: bigint;
  /** `poolAmount - lpFee`: the quote that buys tokens. */
  readonly traded: bigint;
  /** `guardFee + lpFee`: the whole trade fee this buy pays. Never more than the trade fee's rate on `amount`. */
  readonly tradeFee: bigint;
}

/**
 * What an exact-input BUY of `amount` quote pays: the guard takes its part of
 * the trade fee and the tax from the amount named, and the pool charges its
 * part on what is left.
 *
 * ROUNDING. `guardFee` and `tax` are the guard's own arithmetic, to the unit.
 * `lpFee` is rounded up, the way a CL pool rounds one price step; a swap that
 * crosses several steps, or a Bin pool, can differ from it by a few units. It
 * is a figure to show and to tell a fee from price impact, never an amount to
 * send: a quote is the authority on what a trade returns.
 *
 * @param args.parts The parts of the trade fee, READ from the guard.
 * @param args.taxBps The LIVE buy tax rate.
 */
export function guardBuyCharges(args: { readonly amount: bigint; readonly parts: GuardFeeParts; readonly taxBps: number }): GuardBuyCharges {
  assertPips(args.parts.buyLpPips, "buyLpPips");
  const guard = guardQuoteTake({ amount: args.amount, feePips: args.parts.buyGuardPips, taxBps: args.taxBps, exactInput: true });
  const denominator = BigInt(GUARD_FEE_PIPS_DENOMINATOR);
  const lpFee = (guard.poolAmount * BigInt(args.parts.buyLpPips) + denominator - 1n) / denominator;
  return {
    guardFee: guard.fee,
    tax: guard.tax,
    take: guard.take,
    poolAmount: guard.poolAmount,
    lpFee,
    traded: guard.poolAmount - lpFee,
    tradeFee: guard.fee + lpFee,
  };
}

/**
 * The largest exact-input amount whose `poolAmount` does not exceed `poolCapacity`:
 * the most quote a buy can NAME against a pool that can absorb `poolCapacity` of
 * it (from a quoter), without the guard refusing the swap as filled in part.
 *
 * `poolCapacity` is what the pool can take IN, its own LP fee included, and
 * `feePips` is the guard's part of the trade fee on a buy (`buyGuardPips`): the
 * pool's part is charged inside the pool and takes nothing from the capacity.
 *
 * Rates that take the whole amount leave nothing to size, so they throw.
 */
export function largestExactInputFor(args: { readonly poolCapacity: bigint; readonly feePips: number; readonly taxBps: number }): bigint {
  if (args.poolCapacity < 0n) throw new RangeError(`a capacity is non-negative, received ${args.poolCapacity}`);
  const reaches = (amount: bigint): bigint => guardQuoteTake({ amount, feePips: args.feePips, taxBps: args.taxBps, exactInput: true }).poolAmount;
  /* Parts per 1e6 of the amount that are NOT taken, ignoring the floors (which only ever leave more). */
  const kept = BigInt(GUARD_FEE_PIPS_DENOMINATOR) - BigInt(args.feePips) - BigInt(args.taxBps) * BigInt(GUARD_FEE_PIPS_DENOMINATOR / KIT_V2_BPS);
  if (kept <= 0n) throw new RangeError("the fee and the tax together take the whole amount; no amount can be sized");
  /* `reaches` never decreases, so the answer is the last amount at or under the capacity. */
  let low = args.poolCapacity; // takes nothing away from the capacity: reaches(low) <= low
  let high = (args.poolCapacity * BigInt(GUARD_FEE_PIPS_DENOMINATOR)) / kept + 2n;
  while (reaches(high) <= args.poolCapacity) high *= 2n;
  while (high - low > 1n) {
    const mid = (low + high) / 2n;
    if (reaches(mid) <= args.poolCapacity) low = mid;
    else high = mid;
  }
  return low;
}

/* -------------------------------------------------------------- errors --- */

const SWAP_NOT_FILLED = getAbiItem({ abi: LAUNCH_GUARD_HOOK_ABI, name: "SwapNotFilled" });
const EXECUTION_FAILED = getAbiItem({ abi: UNIVERSAL_ROUTER_ABI, name: "ExecutionFailed" });

/**
 * ERC-7751's wrapper, which core puts around every revert that comes out of a
 * hook: `reason` is the hook's own revert data. Written from the standard's
 * public signature; core builds it in assembly, so no compiled ABI lists it.
 */
export const WRAPPED_ERROR_ABI = [
  {
    type: "error",
    name: "WrappedError",
    inputs: [
      { name: "target", type: "address" },
      { name: "selector", type: "bytes4" },
      { name: "reason", type: "bytes" },
      { name: "details", type: "bytes" },
    ],
  },
] as const;

/**
 * What both quoters put around a revert they did not expect while simulating a
 * swap: `revertData` is the revert they met. A QUOTE of a swap the guard refuses
 * arrives inside it (the quoter, around core's wrapper, around the guard's
 * error), so a front end sizing a trade from a failed quote needs it unwrapped.
 * Written from the quoters' public signature; it is the same on CL and Bin.
 */
export const UNEXPECTED_REVERT_BYTES_ABI = [
  {
    type: "error",
    name: "UnexpectedRevertBytes",
    inputs: [{ name: "revertData", type: "bytes" }],
  },
] as const;

/** `SwapNotFilled`'s selector, for a caller matching revert data itself. */
export const SWAP_NOT_FILLED_SELECTOR = encodeErrorResult({ abi: [SWAP_NOT_FILLED], args: [0n, 0n] }).slice(0, 10) as Hex;

const UNWRAP_ABI = [SWAP_NOT_FILLED, EXECUTION_FAILED, ...WRAPPED_ERROR_ABI, ...UNEXPECTED_REVERT_BYTES_ABI] as const;
/** A guard's revert reaches a wallet inside core's wrapper, inside the router's or a quoter's. Four covers that with room. */
const MAX_UNWRAP_DEPTH = 4;

export interface SwapNotFilled {
  /** What the pool had to trade in the quote currency: the amount named, less the take (exact input) or plus it (exact output). */
  readonly expected: bigint;
  /** What the pool did trade in the quote currency. */
  readonly traded: bigint;
  /** The guard that refused, when core's wrapper named it; `null` for bare revert data. */
  readonly guard: Address | null;
}

/**
 * `SwapNotFilled(expected, traded)` out of a failed swap's revert data, or `null`
 * when the data is some other error.
 *
 * Accepts the bare error, core's `WrappedError` around it, and around that the
 * router's `ExecutionFailed` (a swap) or a quoter's `UnexpectedRevertBytes` (a
 * quote). It decodes only what it can name at each layer: revert data is never
 * searched for the selector.
 */
export function decodeSwapNotFilled(data: Hex): SwapNotFilled | null {
  let current: Hex = data;
  let guard: Address | null = null;
  for (let depth = 0; depth <= MAX_UNWRAP_DEPTH; depth++) {
    let decoded;
    try {
      decoded = decodeErrorResult({ abi: UNWRAP_ABI, data: current });
    } catch {
      return null;
    }
    if (decoded.errorName === "SwapNotFilled") {
      return { expected: decoded.args[0], traded: decoded.args[1], guard };
    }
    if (decoded.errorName === "WrappedError") {
      guard = decoded.args[0];
      current = decoded.args[2];
    } else if (decoded.errorName === "UnexpectedRevertBytes") {
      current = decoded.args[0];
    } else {
      current = decoded.args[1];
    }
  }
  return null;
}

/* --------------------------------------------------------------- calls --- */

/**
 * The number the guard's creator functions take for a pool: the pool id read as
 * a `uint256`. They speak the lockers' signatures, where the same argument is a
 * lock id.
 */
export function feeCreatorIdOf(poolId: Hex): bigint {
  if (!/^0x[0-9a-fA-F]{64}$/.test(poolId)) throw new RangeError(`${poolId} is not a 32-byte pool id`);
  return BigInt(poolId);
}

/** `settleFee(poolId, currency)`: permissionless; splits the pool's fee pot into its three buckets. Send to the guard. */
export function encodeSettleFee(poolId: Hex, currency: Address): Hex {
  return encodeFunctionData({ abi: LAUNCH_GUARD_HOOK_ABI, functionName: "settleFee", args: [poolId, currency] });
}

/**
 * `transferCreator(id, newCreator)`: the fee split's CURRENT creator nominates
 * its successor; the zero address withdraws a nomination. Nothing moves until
 * the nominee accepts. A pot settled after the handover is split for the new
 * creator, so settle first. Send to the guard.
 */
export function encodeTransferFeeCreator(poolId: Hex, newCreator: Address): Hex {
  return encodeFunctionData({ abi: LAUNCH_GUARD_HOOK_ABI, functionName: "transferCreator", args: [feeCreatorIdOf(poolId), newCreator] });
}

/** `acceptCreator(id)`: the nominee takes over the creator's share of the pool's trade fee. Send to the guard. */
export function encodeAcceptFeeCreator(poolId: Hex): Hex {
  return encodeFunctionData({ abi: LAUNCH_GUARD_HOOK_ABI, functionName: "acceptCreator", args: [feeCreatorIdOf(poolId)] });
}
