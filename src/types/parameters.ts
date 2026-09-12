// SPDX-License-Identifier: MIT
/**
 * The `parameters` word of a pool key.
 *
 * Every pool key carries one `bytes32` of packed configuration. The layout is
 * shared at the bottom and pool-type specific above it:
 *
 * ```text
 * bits [  0 .. 15]  hook registration bitmap (uint16) - all pool types
 * bits [ 16 .. 39]  tickSpacing (int24)               - concentrated liquidity
 * bits [ 16 .. 31]  binStep (uint16)                  - liquidity book (bin)
 * bits [ 40 .. 255] unused, must be zero              - concentrated liquidity
 * bits [ 32 .. 255] unused, must be zero              - liquidity book (bin)
 * ```
 *
 * Pool managers reject a key whose unused high bits are non-zero, so the
 * writers here always clear them.
 */

import { pad, toHex, type Hex } from "viem";

/** A 32-byte packed parameter word, as `0x`-prefixed hex. */
export type PoolParameters = Hex;

/** All-zero parameter word. */
export const EMPTY_PARAMETERS: PoolParameters =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

/** Bit offset of the hook registration bitmap. */
export const OFFSET_HOOKS_BITMAP = 0;
/** Width in bits of the hook registration bitmap. */
export const HOOKS_BITMAP_BITS = 16;

/** Bit offset of `tickSpacing` in a concentrated-liquidity parameter word. */
export const OFFSET_TICK_SPACING = 16;
/** First bit that must be zero in a concentrated-liquidity parameter word. */
export const CL_MOST_SIGNIFICANT_UNUSED_BIT = 40;

/** Bit offset of `binStep` in a liquidity-book parameter word. */
export const OFFSET_BIN_STEP = 16;
/** First bit that must be zero in a liquidity-book parameter word. */
export const BIN_MOST_SIGNIFICANT_UNUSED_BIT = 32;

const MASK_UINT16 = 0xffffn;
const MASK_UINT24 = 0xffffffn;

/** Converts a parameter word to a bigint for bit manipulation. */
export function parametersToBigInt(parameters: PoolParameters): bigint {
  return BigInt(parameters);
}

/** Converts a bigint back to a padded 32-byte parameter word. */
export function bigIntToParameters(value: bigint): PoolParameters {
  if (value < 0n || value >= 1n << 256n) {
    throw new Error(`parameters value out of range for bytes32: ${value}`);
  }
  return pad(toHex(value), { size: 32 });
}

/** Reads `bits` bits starting at `offset`. */
export function readBits(parameters: PoolParameters, offset: number, bits: number): bigint {
  const mask = (1n << BigInt(bits)) - 1n;
  return (parametersToBigInt(parameters) >> BigInt(offset)) & mask;
}

/** Returns a copy of `parameters` with `bits` bits at `offset` replaced by `value`. */
export function writeBits(
  parameters: PoolParameters,
  offset: number,
  bits: number,
  value: bigint,
): PoolParameters {
  const mask = (1n << BigInt(bits)) - 1n;
  if (value < 0n || value > mask) {
    throw new Error(`value ${value} does not fit in ${bits} bits`);
  }
  const cleared = parametersToBigInt(parameters) & ~(mask << BigInt(offset));
  return bigIntToParameters(cleared | (value << BigInt(offset)));
}

/** Reads a single flag bit. */
export function readFlag(parameters: PoolParameters, offset: number): boolean {
  return ((parametersToBigInt(parameters) >> BigInt(offset)) & 1n) === 1n;
}

/** Returns a copy of `parameters` with the flag at `offset` set to `enabled`. */
export function writeFlag(
  parameters: PoolParameters,
  offset: number,
  enabled: boolean,
): PoolParameters {
  return writeBits(parameters, offset, 1, enabled ? 1n : 0n);
}

/** Extracts the 16-bit hook registration bitmap. */
export function getHooksRegistrationBitmap(parameters: PoolParameters): number {
  return Number(readBits(parameters, OFFSET_HOOKS_BITMAP, HOOKS_BITMAP_BITS));
}

/** Returns a copy of `parameters` carrying `bitmap` in its low 16 bits. */
export function setHooksRegistrationBitmap(
  parameters: PoolParameters,
  bitmap: number,
): PoolParameters {
  if (!Number.isInteger(bitmap) || bitmap < 0 || BigInt(bitmap) > MASK_UINT16) {
    throw new Error(`hook bitmap must be a uint16, received: ${bitmap}`);
  }
  return writeBits(parameters, OFFSET_HOOKS_BITMAP, HOOKS_BITMAP_BITS, BigInt(bitmap));
}

/** Extracts `tickSpacing` from a concentrated-liquidity parameter word. */
export function getTickSpacing(parameters: PoolParameters): number {
  const raw = readBits(parameters, OFFSET_TICK_SPACING, 24);
  // int24, two's complement.
  return Number(raw >= 1n << 23n ? raw - (1n << 24n) : raw);
}

/** Returns a copy of `parameters` carrying `tickSpacing`. */
export function setTickSpacing(
  parameters: PoolParameters,
  tickSpacing: number,
): PoolParameters {
  if (!Number.isInteger(tickSpacing) || tickSpacing < -(2 ** 23) || tickSpacing >= 2 ** 23) {
    throw new Error(`tickSpacing must be an int24, received: ${tickSpacing}`);
  }
  const raw = BigInt(tickSpacing) & MASK_UINT24;
  return writeBits(parameters, OFFSET_TICK_SPACING, 24, raw);
}

/** Extracts `binStep` from a liquidity-book parameter word. */
export function getBinStep(parameters: PoolParameters): number {
  return Number(readBits(parameters, OFFSET_BIN_STEP, 16));
}

/** Returns a copy of `parameters` carrying `binStep`. */
export function setBinStep(parameters: PoolParameters, binStep: number): PoolParameters {
  if (!Number.isInteger(binStep) || binStep < 0 || BigInt(binStep) > MASK_UINT16) {
    throw new Error(`binStep must be a uint16, received: ${binStep}`);
  }
  return writeBits(parameters, OFFSET_BIN_STEP, 16, BigInt(binStep));
}

/**
 * Checks that every bit at or above `mostSignificantUnusedBit` is zero.
 *
 * Pool managers perform the same check on initialization; running it locally
 * turns a failed transaction into a caught exception.
 */
export function assertUnusedBitsZero(
  parameters: PoolParameters,
  mostSignificantUnusedBit: number,
): void {
  if (parametersToBigInt(parameters) >> BigInt(mostSignificantUnusedBit) !== 0n) {
    throw new Error(
      `parameters ${parameters} has non-zero bits at or above bit ${mostSignificantUnusedBit}`,
    );
  }
}

/** Builds a concentrated-liquidity parameter word from a hook bitmap and tick spacing. */
export function encodeCLPoolParameters(
  hooksRegistrationBitmap: number,
  tickSpacing: number,
): PoolParameters {
  return setTickSpacing(
    setHooksRegistrationBitmap(EMPTY_PARAMETERS, hooksRegistrationBitmap),
    tickSpacing,
  );
}

/** Builds a liquidity-book parameter word from a hook bitmap and bin step. */
export function encodeBinPoolParameters(
  hooksRegistrationBitmap: number,
  binStep: number,
): PoolParameters {
  return setBinStep(
    setHooksRegistrationBitmap(EMPTY_PARAMETERS, hooksRegistrationBitmap),
    binStep,
  );
}

/** Decoded view of a concentrated-liquidity parameter word. */
export interface CLPoolParameters {
  readonly hooksRegistrationBitmap: number;
  readonly tickSpacing: number;
}

/** Decoded view of a liquidity-book parameter word. */
export interface BinPoolParameters {
  readonly hooksRegistrationBitmap: number;
  readonly binStep: number;
}

/** Decodes a concentrated-liquidity parameter word. */
export function decodeCLPoolParameters(parameters: PoolParameters): CLPoolParameters {
  assertUnusedBitsZero(parameters, CL_MOST_SIGNIFICANT_UNUSED_BIT);
  return {
    hooksRegistrationBitmap: getHooksRegistrationBitmap(parameters),
    tickSpacing: getTickSpacing(parameters),
  };
}

/** Decodes a liquidity-book parameter word. */
export function decodeBinPoolParameters(parameters: PoolParameters): BinPoolParameters {
  assertUnusedBitsZero(parameters, BIN_MOST_SIGNIFICANT_UNUSED_BIT);
  return {
    hooksRegistrationBitmap: getHooksRegistrationBitmap(parameters),
    binStep: getBinStep(parameters),
  };
}
