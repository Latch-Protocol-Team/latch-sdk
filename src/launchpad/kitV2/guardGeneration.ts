// SPDX-License-Identifier: MIT
/* ============================================================================
   Which launch guard is this? Two generations exist, and a pool stays on the
   guard it was born on for good, because a hook's address is part of the pool's
   identity. Everything off chain therefore has to serve both.

     "lp-fee"     The guard returns its fee as an LP FEE OVERRIDE. Core charges
                  it on the swap's INPUT (quote on a buy, launch token on a
                  sell) and credits the pool's liquidity; on a kit launch that
                  is the locked position, paid out through the lockers. The
                  creator tax is taken on the unspecified side.
                  Bitmaps: CL 0x08C1, Bin 0x08C5.

     "quote-fee"  The guard takes the fee AND the tax itself, in the pool's
                  QUOTE currency on every swap shape, into its own per-pool
                  pots. On a BUY it leaves a share of the fee to the pool as
                  its LP fee (`LP_SHARE_BPS`, fixed per guard, at most 50%,
                  possibly zero), so the pool's liquidity, the locked position
                  included, earns that part, in the quote. On a SELL the pool's
                  LP fee is zero and the guard takes the whole fee. Read the
                  parts, never assume them (`readGuardFeeParts`).
                  Bitmaps: CL 0x0CC1, Bin 0x0CC5 (bit 10, `beforeSwapReturnsDelta`).

   The names say where the fee goes, because that is the question every caller
   is really asking: which contract do I read, and in which currency.

   HOW TO TELL. Read `getHooksRegistrationBitmap()` from the guard and classify
   the answer. Never by an address list and never by chain: a chain carries both
   as soon as a second guard is deployed on it.

   AN ANSWER IS ONLY EVER ONE OF THE FOUR BITMAPS. Testing bit 10 alone would
   call any hook that returns a delta from `beforeSwap` a launch guard, and the
   functions this SDK would then call on it do not exist there. So a bitmap that
   is not exactly a guard's is "unknown", and so is a guard that does not answer.
   "unknown" is a state to render, never a generation to assume.
   ============================================================================ */

import type { Address, PublicClient } from "viem";

import { isRevertError } from "../../chains/revert.js";

import { CL_HOOK_FLAGS } from "../../hooks/bitmap.js";
import { decodeBinPoolParameters, decodeCLPoolParameters } from "../../types/parameters.js";
import type { PoolKey } from "../../types/poolKey.js";
import { LAUNCH_GUARD_HOOK_ABI } from "../generated/abi.js";
import { KIT_V2_BIN_HOOK_BITMAP, KIT_V2_CL_HOOK_BITMAP } from "./types.js";

/** Where a guard's trade fee goes. See the header. */
export type GuardGeneration = "lp-fee" | "quote-fee";
/** A generation, or `unknown` for a bitmap that is no launch guard's and for a guard that did not answer. */
export type GuardGenerationRead = GuardGeneration | "unknown";
/** Which pool type a guard serves. The same words as a leg's `kind`. */
export type GuardKind = "CL" | "Bin";

/** Bit 10, `beforeSwapReturnsDelta`: what lets a guard take its fee on the specified side. Same offset on CL and Bin. */
export const GUARD_QUOTE_FEE_BIT = 1 << CL_HOOK_FLAGS.beforeSwapReturnsDelta;

/**
 * `getHooksRegistrationBitmap()` of every launch guard, by generation and pool type.
 *
 * - lp-fee CL: `beforeInitialize | beforeSwap | afterSwap | afterSwapReturnsDelta`; Bin adds `beforeMint`.
 * - quote-fee: the same plus `beforeSwapReturnsDelta`.
 */
export const LAUNCH_GUARD_BITMAPS = {
  "lp-fee": { CL: KIT_V2_CL_HOOK_BITMAP, Bin: KIT_V2_BIN_HOOK_BITMAP },
  "quote-fee": { CL: KIT_V2_CL_HOOK_BITMAP | GUARD_QUOTE_FEE_BIT, Bin: KIT_V2_BIN_HOOK_BITMAP | GUARD_QUOTE_FEE_BIT },
} as const satisfies Record<GuardGeneration, Record<GuardKind, number>>;

const GENERATIONS = ["lp-fee", "quote-fee"] as const satisfies readonly GuardGeneration[];
const KINDS = ["CL", "Bin"] as const satisfies readonly GuardKind[];

/**
 * The generation a bitmap belongs to, or `unknown`.
 *
 * With `kind`, the bitmap must be that pool type's: a CL guard answering the Bin
 * bitmap is not a guard this SDK knows how to read. Without it, either pool
 * type's bitmap is accepted.
 */
export function guardGenerationOf(bitmap: number | null | undefined, kind?: GuardKind): GuardGenerationRead {
  if (bitmap === null || bitmap === undefined) return "unknown";
  for (const generation of GENERATIONS) {
    for (const k of KINDS) {
      if (kind !== undefined && kind !== k) continue;
      if (LAUNCH_GUARD_BITMAPS[generation][k] === bitmap) return generation;
    }
  }
  return "unknown";
}

/**
 * `getHooksRegistrationBitmap()` as `guard` answers it, or `null` when the
 * contract REVERTED or has no such function (an address with no code included).
 *
 * A transport failure is not an answer: it throws, so a flaky endpoint can never
 * turn a guard into "unknown" and hide a fee pot behind it.
 */
export async function readGuardBitmap(client: PublicClient, guard: Address): Promise<number | null> {
  try {
    return Number(await client.readContract({ address: guard, abi: LAUNCH_GUARD_HOOK_ABI, functionName: "getHooksRegistrationBitmap" }));
  } catch (error) {
    if (isRevertError(error, { zeroData: true })) return null;
    throw error;
  }
}

/** What `readGuardGeneration` found. `bitmap` is `null` when the guard did not answer. */
export interface GuardGenerationReading {
  readonly guard: Address;
  readonly bitmap: number | null;
  readonly generation: GuardGenerationRead;
}

/**
 * Reads the bitmap off `guard` and classifies it. Pass `kind` when the pool type
 * is known (a kit's `clHook` is a CL guard), so the other type's bitmap reads as
 * `unknown`.
 *
 * Call this BEFORE any function that exists on one generation only
 * (`getFeeSplit`, `pendingFee`, `settleFee`, `transferCreator` on the guard).
 */
export async function readGuardGeneration(client: PublicClient, guard: Address, kind?: GuardKind): Promise<GuardGenerationReading> {
  const bitmap = await readGuardBitmap(client, guard);
  return { guard, bitmap, generation: guardGenerationOf(bitmap, kind) };
}

/**
 * The generation a pool KEY's bitmap belongs to, with no read at all.
 *
 * A key carries its hook's registration bitmap in `parameters`, and core refuses
 * to initialize a pool whose key says anything other than what the hook answers
 * from `getHooksRegistrationBitmap()`. So for a pool that EXISTS, this is the
 * guard's own answer, recorded at the pool's birth.
 *
 * IT SAYS NOTHING ABOUT WHOSE HOOK IT IS. Any hook may register these callbacks.
 * Use it only for a pool whose `hooks` address is already known to be a launch
 * guard (the kit's `clHook` / `binHook`, or an address-book guard); for anything
 * else the answer is a coincidence of bits. A key whose parameters do not decode
 * is `unknown`.
 */
export function guardGenerationOfKey(key: Pick<PoolKey, "parameters">, kind: GuardKind): GuardGenerationRead {
  try {
    const decoded = kind === "CL" ? decodeCLPoolParameters(key.parameters) : decodeBinPoolParameters(key.parameters);
    return guardGenerationOf(decoded.hooksRegistrationBitmap, kind);
  } catch {
    return "unknown";
  }
}

