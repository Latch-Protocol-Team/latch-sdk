// SPDX-License-Identifier: MIT
/**
 * The three contracts a DEX front end actually calls: the router, the quoter
 * and the position manager.
 *
 * Until this module the SDK named their addresses and shipped no way to call
 * them — every exported ABI was either an event ABI, the registry, or the
 * launchpad. An integrator was told where the contracts are and left to paste
 * their interfaces out of a block explorer.
 *
 * A pasted ABI is a snapshot with no provenance. Nothing records which
 * deployment it came from, nothing fails when a signature changes, and an
 * explorer's "similar contract" match can be a different contract entirely.
 * The failure mode is a decode that returns a plausible number rather than an
 * error, which is the same shape as every expensive bug this repo has hit.
 *
 * `./generated/abi.js` is produced by `npm run generate:trading` from the
 * compiled Foundry artifacts; it is a curated slice, and the generator fails
 * if a name it asks for has been renamed upstream.
 */

import type { Abi, Address, Hex } from "viem";

import {
  CL_POSITION_MANAGER_ABI,
  CL_QUOTER_ABI,
  UNIVERSAL_ROUTER_ABI,
} from "./generated/abi.js";
import type { PoolKey } from "../types/poolKey.js";

export * from "./generated/abi.js";

/** Trading ABIs under short names, matching `LaunchpadAbis` and `EventAbis`. */
export const TradingAbis = {
  UniversalRouter: UNIVERSAL_ROUTER_ABI,
  CLQuoter: CL_QUOTER_ABI,
  CLPositionManager: CL_POSITION_MANAGER_ABI,
} as const satisfies Record<string, Abi>;

/** `IQuoter.QuoteExactSingleParams`. */
export interface QuoteExactSingleParams {
  readonly poolKey: PoolKey;
  /**
   * Swap direction. `true` spends `currency0` for `currency1`.
   *
   * This is NOT "am I buying" — it is decided by address sorting, which has
   * nothing to do with which token you think of as the quote. Derive it with
   * {@link zeroForOne} rather than by hand.
   */
  readonly zeroForOne: boolean;
  /** Exact input amount, in RAW units of the token being spent. */
  readonly exactAmount: bigint;
  /** Passed through to the hook. `0x` when the pool's hook takes none. */
  readonly hookData: Hex;
}

/**
 * Which direction a swap of `tokenIn` is, for a given pool.
 *
 * Exists because `zeroForOne` is the single easiest thing to invert in a quote:
 * it is a fact about address ordering, and getting it backwards produces a
 * valid quote for the trade you did not want.
 */
export function zeroForOne(key: PoolKey, tokenIn: Address): boolean {
  const inLower = tokenIn.toLowerCase();
  const c0 = key.currency0.toLowerCase();
  const c1 = key.currency1.toLowerCase();
  if (inLower === c0) return true;
  if (inLower === c1) return false;
  throw new Error(
    `${tokenIn} is not in this pool. Its currencies are ${key.currency0} and ${key.currency1}.`,
  );
}

/**
 * Arguments for a `readContract` against `quoteExactInputSingle`.
 *
 * ```ts
 * const { result } = await client.simulateContract(
 *   quoteExactInputSingle({ quoter, poolKey, tokenIn, amountIn })
 * )
 * const [amountOut, gasEstimate] = result
 * ```
 *
 * **The quoter is `eth_call` only.** Its functions are not `view`: they execute
 * the swap against real state and revert with the answer encoded in the revert
 * data, which the ABI decodes back for you. Sending one as a transaction burns
 * gas and reverts. Never put a quoter call in a wallet's `sendTransaction`.
 */
export function quoteExactInputSingle(args: {
  readonly quoter: Address;
  readonly poolKey: PoolKey;
  /** The token being spent. `zeroForOne` is derived from it. */
  readonly tokenIn: Address;
  /** Raw units of `tokenIn`. */
  readonly amountIn: bigint;
  readonly hookData?: Hex;
}) {
  return {
    address: args.quoter,
    abi: CL_QUOTER_ABI,
    functionName: "quoteExactInputSingle",
    args: [
      {
        poolKey: args.poolKey,
        zeroForOne: zeroForOne(args.poolKey, args.tokenIn),
        exactAmount: args.amountIn,
        hookData: args.hookData ?? "0x",
      },
    ],
  } as const;
}

/**
 * Arguments for a `readContract` against `quoteExactOutputSingle`.
 *
 * @param tokenOut The token you want a fixed amount OF. The direction is
 * derived from it and then inverted, which is the part worth not hand-rolling.
 * @see quoteExactInputSingle for why this must be an `eth_call`.
 */
export function quoteExactOutputSingle(args: {
  readonly quoter: Address;
  readonly poolKey: PoolKey;
  readonly tokenOut: Address;
  /** Raw units of `tokenOut`. */
  readonly amountOut: bigint;
  readonly hookData?: Hex;
}) {
  return {
    address: args.quoter,
    abi: CL_QUOTER_ABI,
    functionName: "quoteExactOutputSingle",
    args: [
      {
        poolKey: args.poolKey,
        // Spending the OTHER token, so the direction is the inverse of tokenOut's.
        zeroForOne: !zeroForOne(args.poolKey, args.tokenOut),
        exactAmount: args.amountOut,
        hookData: args.hookData ?? "0x",
      },
    ],
  } as const;
}

/**
 * Minimum acceptable output for a quoted amount, at a slippage tolerance.
 *
 * Integer maths, floor-rounded — the caller's protection is never rounded UP.
 *
 * @param toleranceBps Basis points. 50 = 0.5%.
 */
export function applySlippage(amountOut: bigint, toleranceBps: number): bigint {
  if (!Number.isInteger(toleranceBps) || toleranceBps < 0 || toleranceBps > 10_000) {
    throw new RangeError(`toleranceBps must be an integer in [0, 10000], got ${toleranceBps}`);
  }
  return (amountOut * BigInt(10_000 - toleranceBps)) / 10_000n;
}

/**
 * Maximum input for a quoted amount, at a slippage tolerance. Rounds UP, for
 * the same reason {@link applySlippage} rounds down: the bound must never be
 * tighter than the caller asked for.
 */
export function applySlippageToInput(amountIn: bigint, toleranceBps: number): bigint {
  if (!Number.isInteger(toleranceBps) || toleranceBps < 0 || toleranceBps > 10_000) {
    throw new RangeError(`toleranceBps must be an integer in [0, 10000], got ${toleranceBps}`);
  }
  const scaled = amountIn * BigInt(10_000 + toleranceBps);
  return scaled % 10_000n === 0n ? scaled / 10_000n : scaled / 10_000n + 1n;
}
