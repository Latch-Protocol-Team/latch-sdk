// SPDX-License-Identifier: MIT
/**
 * Balance deltas.
 *
 * The protocol reports the outcome of an operation as a pair of signed 128-bit
 * amounts packed into one 256-bit word: `amount0` occupies the high 128 bits and
 * `amount1` the low 128 bits. Signs are from the caller's point of view -
 * negative means the caller owes the vault, positive means the vault owes the
 * caller.
 */

const BITS_128 = 128n;
const MASK_128 = (1n << BITS_128) - 1n;
const MIN_INT128 = -(1n << 127n);
const MAX_INT128 = (1n << 127n) - 1n;

/** A packed `(amount0, amount1)` pair, as it appears on-chain. */
export type BalanceDelta = bigint;

/** A balance delta split into its two signed components. */
export interface BalanceDeltaAmounts {
  readonly amount0: bigint;
  readonly amount1: bigint;
}

/** The zero delta: nothing owed in either direction. */
export const ZERO_BALANCE_DELTA: BalanceDelta = 0n;

function assertInt128(value: bigint, label: string): void {
  if (value < MIN_INT128 || value > MAX_INT128) {
    throw new Error(`${label} does not fit in int128: ${value}`);
  }
}

/** Reinterprets the low `bits` of `value` as a two's-complement signed integer. */
function asSigned(value: bigint, bits: bigint): bigint {
  const mask = (1n << bits) - 1n;
  const truncated = value & mask;
  const signBit = 1n << (bits - 1n);
  return truncated & signBit ? truncated - (1n << bits) : truncated;
}

/** Packs two signed 128-bit amounts into a single balance delta. */
export function toBalanceDelta(amount0: bigint, amount1: bigint): BalanceDelta {
  assertInt128(amount0, "amount0");
  assertInt128(amount1, "amount1");
  return asSigned((amount0 << BITS_128) | (amount1 & MASK_128), 256n);
}

/** Extracts the signed `amount0` component (high 128 bits). */
export function balanceDeltaAmount0(delta: BalanceDelta): bigint {
  return asSigned(asSigned(delta, 256n) >> BITS_128, BITS_128);
}

/** Extracts the signed `amount1` component (low 128 bits). */
export function balanceDeltaAmount1(delta: BalanceDelta): bigint {
  return asSigned(delta, BITS_128);
}

/** Splits a packed delta into both components. */
export function unpackBalanceDelta(delta: BalanceDelta): BalanceDeltaAmounts {
  return {
    amount0: balanceDeltaAmount0(delta),
    amount1: balanceDeltaAmount1(delta),
  };
}

/** Adds two deltas component-wise. Throws if either component overflows int128. */
export function addBalanceDeltas(a: BalanceDelta, b: BalanceDelta): BalanceDelta {
  return toBalanceDelta(
    balanceDeltaAmount0(a) + balanceDeltaAmount0(b),
    balanceDeltaAmount1(a) + balanceDeltaAmount1(b),
  );
}

/** Subtracts `b` from `a` component-wise. Throws if either component overflows int128. */
export function subBalanceDeltas(a: BalanceDelta, b: BalanceDelta): BalanceDelta {
  return toBalanceDelta(
    balanceDeltaAmount0(a) - balanceDeltaAmount0(b),
    balanceDeltaAmount1(a) - balanceDeltaAmount1(b),
  );
}
