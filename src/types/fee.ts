// SPDX-License-Identifier: MIT
/**
 * Fee encoding.
 *
 * Two independent fees apply to a swap:
 *
 * - the **LP fee**, held in `poolKey.fee`, either a fixed rate in hundredths of
 *   a basis point ("pips", 1e6 = 100%) or a marker saying the fee is dynamic and
 *   supplied by the hook at swap time;
 * - the **protocol fee**, stored per pool and set by the protocol fee
 *   controller, packed as two directional 12-bit rates in one `uint24`.
 */

/** Denominator for fee rates: 1_000_000 pips = 100%. */
export const PIPS_DENOMINATOR = 1_000_000;

/** LP fee equal to 100%. Also the cap for a concentrated-liquidity swap fee. */
export const ONE_HUNDRED_PERCENT_FEE = 1_000_000;

/** LP fee equal to 10%. Also the cap for a liquidity-book swap fee. */
export const TEN_PERCENT_FEE = 100_000;

/**
 * Marker stored in `poolKey.fee` to declare a dynamic-fee pool.
 *
 * When set, the pool's LP fee is not read from the key at all; the hook supplies
 * it. A pool key with this flag is only valid if the key also names a hook.
 */
export const DYNAMIC_FEE_FLAG = 0x800000;

/**
 * Marker a hook may set on a fee it returns from `beforeSwap` to override the
 * stored LP fee for that swap only.
 */
export const OVERRIDE_FEE_FLAG = 0x400000;

/** Mask that strips {@link OVERRIDE_FEE_FLAG} from a hook-returned fee. */
export const OVERRIDE_FEE_MASK = 0xbfffff;

/** Largest directional protocol fee, in pips (0.4%). */
export const MAX_PROTOCOL_FEE = 4000;

/** True when `fee` carries the dynamic-fee marker. */
export function isDynamicLPFee(fee: number): boolean {
  return fee === DYNAMIC_FEE_FLAG;
}

/** True when a hook-returned fee asks to override the stored LP fee. */
export function hasOverrideFlag(fee: number): boolean {
  return (fee & OVERRIDE_FEE_FLAG) !== 0;
}

/** Strips the override marker, leaving the raw rate. */
export function removeOverrideFlag(fee: number): number {
  return fee & OVERRIDE_FEE_MASK;
}

/** True when `fee` is a usable static LP fee, or the dynamic-fee marker. */
export function isValidLPFee(fee: number): boolean {
  if (isDynamicLPFee(fee)) return true;
  return Number.isInteger(fee) && fee >= 0 && fee <= ONE_HUNDRED_PERCENT_FEE;
}

/** Converts a fee in pips to a fraction, e.g. `3000 -> 0.003`. */
export function feeToFraction(feePips: number): number {
  return feePips / PIPS_DENOMINATOR;
}

/** Converts a fee in pips to a percentage, e.g. `3000 -> 0.3`. */
export function feeToPercent(feePips: number): number {
  return (feePips / PIPS_DENOMINATOR) * 100;
}

/** The two directional halves of a packed protocol fee. */
export interface ProtocolFee {
  /** Rate applied when swapping currency0 for currency1, in pips. */
  readonly zeroForOne: number;
  /** Rate applied when swapping currency1 for currency0, in pips. */
  readonly oneForZero: number;
}

/** Reads the zero-for-one half (low 12 bits) of a packed protocol fee. */
export function getZeroForOneProtocolFee(protocolFee: number): number {
  return protocolFee & 0xfff;
}

/** Reads the one-for-zero half (high 12 bits) of a packed protocol fee. */
export function getOneForZeroProtocolFee(protocolFee: number): number {
  return (protocolFee >> 12) & 0xfff;
}

/** Splits a packed protocol fee into its two directional rates. */
export function decodeProtocolFee(protocolFee: number): ProtocolFee {
  return {
    zeroForOne: getZeroForOneProtocolFee(protocolFee),
    oneForZero: getOneForZeroProtocolFee(protocolFee),
  };
}

/**
 * Packs two directional rates into the `uint24` the pool manager stores.
 *
 * @throws if either rate exceeds {@link MAX_PROTOCOL_FEE}.
 */
export function encodeProtocolFee(fee: ProtocolFee): number {
  for (const [label, value] of [
    ["zeroForOne", fee.zeroForOne],
    ["oneForZero", fee.oneForZero],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || value > MAX_PROTOCOL_FEE) {
      throw new Error(
        `protocol fee ${label} must be an integer in [0, ${MAX_PROTOCOL_FEE}], received: ${value}`,
      );
    }
  }
  return (fee.oneForZero << 12) | fee.zeroForOne;
}

/** True when both halves of a packed protocol fee are within bounds. */
export function isValidProtocolFee(protocolFee: number): boolean {
  return (
    getZeroForOneProtocolFee(protocolFee) <= MAX_PROTOCOL_FEE &&
    getOneForZeroProtocolFee(protocolFee) <= MAX_PROTOCOL_FEE
  );
}
