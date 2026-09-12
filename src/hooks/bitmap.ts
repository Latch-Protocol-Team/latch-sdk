// SPDX-License-Identifier: MIT
/**
 * Hook permission bitmaps.
 *
 * ## Why this differs from Uniswap v4
 *
 * In Uniswap v4 a hook's permissions are read from the *address* of the hook
 * contract: each callback is a bit of the address, so shipping a hook means
 * grinding a CREATE2 salt until the deployed address happens to carry the right
 * low bits. Change your mind about a callback and you redeploy at a new address.
 *
 * LatchProtocol takes the permissions out of the address entirely. They live in
 * the low 16 bits of `poolKey.parameters`, and the pool manager cross-checks
 * that word against the hook's own `getHooksRegistrationBitmap()` view when the
 * pool is initialized. Any address can host a hook; no salt mining, and a single
 * deployed hook can back pools with different callback sets (as long as it
 * reports the matching bitmap).
 *
 * ## Layout
 *
 * ```text
 * bit  0  beforeInitialize
 * bit  1  afterInitialize
 * bit  2  beforeAddLiquidity   (CL)  /  beforeMint          (bin)
 * bit  3  afterAddLiquidity    (CL)  /  afterMint           (bin)
 * bit  4  beforeRemoveLiquidity(CL)  /  beforeBurn          (bin)
 * bit  5  afterRemoveLiquidity (CL)  /  afterBurn           (bin)
 * bit  6  beforeSwap
 * bit  7  afterSwap
 * bit  8  beforeDonate
 * bit  9  afterDonate
 * bit 10  beforeSwapReturnsDelta
 * bit 11  afterSwapReturnsDelta
 * bit 12  afterAddLiquidityReturnsDelta (CL) / afterMintReturnsDelta (bin)
 * bit 13  afterBurnReturnsDelta         (CL) / afterBurnReturnsDelta (bin)
 * bits 14-15 unassigned, must be zero
 * ```
 *
 * The two pool types share every offset; only the names of bits 2-5, 12 and 13
 * differ, matching the operation each pool type actually performs.
 */

import { isAddressEqual, type Address } from "viem";
import {
  DYNAMIC_FEE_FLAG,
  isDynamicLPFee,
} from "../types/fee.js";
import {
  getHooksRegistrationBitmap,
  setHooksRegistrationBitmap,
  EMPTY_PARAMETERS,
  type PoolParameters,
} from "../types/parameters.js";

/** The two pool flavours the singleton supports. */
export type PoolType = "CL" | "BIN";

/** Highest assigned bit in the registration bitmap. */
export const MAX_HOOK_FLAG_OFFSET = 13;

/** Mask covering every assigned bit (bits 0-13). */
export const HOOK_BITMAP_MASK = 0x3fff;

/** Widest value the bitmap field can hold (it is a `uint16`). */
export const HOOK_BITMAP_MAX = 0xffff;

/** Bit offsets for concentrated-liquidity hook callbacks. */
export const CL_HOOK_FLAGS = {
  beforeInitialize: 0,
  afterInitialize: 1,
  beforeAddLiquidity: 2,
  afterAddLiquidity: 3,
  beforeRemoveLiquidity: 4,
  afterRemoveLiquidity: 5,
  beforeSwap: 6,
  afterSwap: 7,
  beforeDonate: 8,
  afterDonate: 9,
  beforeSwapReturnsDelta: 10,
  afterSwapReturnsDelta: 11,
  afterAddLiquidityReturnsDelta: 12,
  afterRemoveLiquidityReturnsDelta: 13,
} as const;

/** Bit offsets for liquidity-book (bin) hook callbacks. */
export const BIN_HOOK_FLAGS = {
  beforeInitialize: 0,
  afterInitialize: 1,
  beforeMint: 2,
  afterMint: 3,
  beforeBurn: 4,
  afterBurn: 5,
  beforeSwap: 6,
  afterSwap: 7,
  beforeDonate: 8,
  afterDonate: 9,
  beforeSwapReturnsDelta: 10,
  afterSwapReturnsDelta: 11,
  afterMintReturnsDelta: 12,
  afterBurnReturnsDelta: 13,
} as const;

export type CLHookFlagName = keyof typeof CL_HOOK_FLAGS;
export type BinHookFlagName = keyof typeof BIN_HOOK_FLAGS;

/** A fully-specified concentrated-liquidity permission set. */
export type CLHookPermissions = Record<CLHookFlagName, boolean>;
/** A fully-specified liquidity-book permission set. */
export type BinHookPermissions = Record<BinHookFlagName, boolean>;

/** Permission set with every flag optional; omitted flags default to `false`. */
export type CLHookPermissionsInput = Partial<CLHookPermissions>;
/** Permission set with every flag optional; omitted flags default to `false`. */
export type BinHookPermissionsInput = Partial<BinHookPermissions>;

/** Maps a pool type to its flag table. */
export type HookFlagTable<T extends PoolType> = T extends "CL"
  ? typeof CL_HOOK_FLAGS
  : typeof BIN_HOOK_FLAGS;

/** Maps a pool type to its permission record. */
export type HookPermissions<T extends PoolType> = T extends "CL"
  ? CLHookPermissions
  : BinHookPermissions;

/** Maps a pool type to its partial permission record. */
export type HookPermissionsInput<T extends PoolType> = T extends "CL"
  ? CLHookPermissionsInput
  : BinHookPermissionsInput;

/** Returns the flag table for a pool type. */
export function hookFlagsFor(poolType: PoolType): Record<string, number> {
  return poolType === "CL" ? CL_HOOK_FLAGS : BIN_HOOK_FLAGS;
}

/**
 * Callbacks that only make sense alongside another callback.
 *
 * A hook that returns a delta from a callback must also be registered for the
 * callback itself, otherwise the pool manager would never invoke it and the
 * delta could never be produced. The pool managers reject such a combination at
 * initialization; the same rules are applied here so the mistake surfaces
 * before a transaction is sent.
 */
export const HOOK_PERMISSION_DEPENDENCIES: Readonly<Record<PoolType, ReadonlyArray<readonly [number, number]>>> = {
  CL: [
    [CL_HOOK_FLAGS.beforeSwapReturnsDelta, CL_HOOK_FLAGS.beforeSwap],
    [CL_HOOK_FLAGS.afterSwapReturnsDelta, CL_HOOK_FLAGS.afterSwap],
    [CL_HOOK_FLAGS.afterAddLiquidityReturnsDelta, CL_HOOK_FLAGS.afterAddLiquidity],
    [CL_HOOK_FLAGS.afterRemoveLiquidityReturnsDelta, CL_HOOK_FLAGS.afterRemoveLiquidity],
  ],
  BIN: [
    [BIN_HOOK_FLAGS.beforeSwapReturnsDelta, BIN_HOOK_FLAGS.beforeSwap],
    [BIN_HOOK_FLAGS.afterSwapReturnsDelta, BIN_HOOK_FLAGS.afterSwap],
    [BIN_HOOK_FLAGS.afterMintReturnsDelta, BIN_HOOK_FLAGS.afterMint],
    [BIN_HOOK_FLAGS.afterBurnReturnsDelta, BIN_HOOK_FLAGS.afterBurn],
  ],
};

// ---------------------------------------------------------------------------
// Bit-level helpers
// ---------------------------------------------------------------------------

/** True when the bit at `offset` is set. */
export function hasHookPermission(bitmap: number, offset: number): boolean {
  return ((bitmap >>> offset) & 1) === 1;
}

/** Returns `bitmap` with the bit at `offset` set or cleared. */
export function setHookPermission(bitmap: number, offset: number, enabled: boolean): number {
  return enabled ? bitmap | (1 << offset) : bitmap & ~(1 << offset);
}

/** Builds a bitmap from a list of bit offsets. */
export function bitmapFromOffsets(offsets: readonly number[]): number {
  let bitmap = 0;
  for (const offset of offsets) {
    if (!Number.isInteger(offset) || offset < 0 || offset > 15) {
      throw new Error(`hook flag offset must be an integer in [0, 15], received: ${offset}`);
    }
    bitmap |= 1 << offset;
  }
  return bitmap >>> 0;
}

// ---------------------------------------------------------------------------
// Encode / decode
// ---------------------------------------------------------------------------

function encodeWithTable(
  table: Record<string, number>,
  permissions: Record<string, boolean | undefined>,
): number {
  let bitmap = 0;
  for (const [name, enabled] of Object.entries(permissions)) {
    const offset = table[name];
    if (offset === undefined) {
      throw new Error(
        `unknown hook permission "${name}"; expected one of: ${Object.keys(table).join(", ")}`,
      );
    }
    if (enabled === true) bitmap |= 1 << offset;
  }
  return bitmap >>> 0;
}

function decodeWithTable(
  table: Record<string, number>,
  bitmap: number,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [name, offset] of Object.entries(table)) {
    out[name] = hasHookPermission(bitmap, offset);
  }
  return out;
}

/** Encodes a concentrated-liquidity permission set into a `uint16` bitmap. */
export function encodeCLHookPermissions(permissions: CLHookPermissionsInput): number {
  return encodeWithTable(CL_HOOK_FLAGS, permissions);
}

/** Encodes a liquidity-book permission set into a `uint16` bitmap. */
export function encodeBinHookPermissions(permissions: BinHookPermissionsInput): number {
  return encodeWithTable(BIN_HOOK_FLAGS, permissions);
}

/** Expands a bitmap into a concentrated-liquidity permission set. */
export function decodeCLHookPermissions(bitmap: number): CLHookPermissions {
  assertUint16(bitmap);
  return decodeWithTable(CL_HOOK_FLAGS, bitmap) as CLHookPermissions;
}

/** Expands a bitmap into a liquidity-book permission set. */
export function decodeBinHookPermissions(bitmap: number): BinHookPermissions {
  assertUint16(bitmap);
  return decodeWithTable(BIN_HOOK_FLAGS, bitmap) as BinHookPermissions;
}

/** Encodes a permission set for either pool type. */
export function encodeHookPermissions<T extends PoolType>(
  poolType: T,
  permissions: HookPermissionsInput<T>,
): number {
  return encodeWithTable(hookFlagsFor(poolType), permissions as Record<string, boolean | undefined>);
}

/** Decodes a bitmap for either pool type. */
export function decodeHookPermissions<T extends PoolType>(
  poolType: T,
  bitmap: number,
): HookPermissions<T> {
  assertUint16(bitmap);
  return decodeWithTable(hookFlagsFor(poolType), bitmap) as HookPermissions<T>;
}

/** Names of every callback enabled in `bitmap`, in bit order. */
export function enabledHookNames(poolType: PoolType, bitmap: number): string[] {
  const table = hookFlagsFor(poolType);
  return Object.entries(table)
    .filter(([, offset]) => hasHookPermission(bitmap, offset))
    .sort((a, b) => a[1] - b[1])
    .map(([name]) => name);
}

/** Human-readable one-line summary, useful in logs and indexer output. */
export function formatHookPermissions(poolType: PoolType, bitmap: number): string {
  const names = enabledHookNames(poolType, bitmap);
  const hex = `0x${bitmap.toString(16).padStart(4, "0")}`;
  return names.length === 0 ? `${hex} (no callbacks)` : `${hex} (${names.join(", ")})`;
}

function assertUint16(bitmap: number): void {
  if (!Number.isInteger(bitmap) || bitmap < 0 || bitmap > HOOK_BITMAP_MAX) {
    throw new Error(`hook bitmap must be an integer in [0, ${HOOK_BITMAP_MAX}], received: ${bitmap}`);
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Machine-readable reason a bitmap or hook configuration was rejected. */
export type HookValidationCode =
  | "BITMAP_OUT_OF_RANGE"
  | "UNASSIGNED_BIT_SET"
  | "MISSING_DEPENDENCY"
  | "BITMAP_MISMATCH"
  | "HOOKLESS_POOL_WITH_BITMAP"
  | "HOOKLESS_POOL_WITH_DYNAMIC_FEE";

/** A single validation failure. */
export interface HookValidationIssue {
  readonly code: HookValidationCode;
  readonly message: string;
}

/** Outcome of a validation pass. */
export interface HookValidationResult {
  readonly valid: boolean;
  readonly issues: readonly HookValidationIssue[];
}

/**
 * Checks a bitmap in isolation: range, unassigned bits, and the
 * returns-delta dependency rules the pool managers enforce.
 */
export function validateHookRegistrationBitmap(
  poolType: PoolType,
  bitmap: number,
): HookValidationResult {
  const issues: HookValidationIssue[] = [];

  if (!Number.isInteger(bitmap) || bitmap < 0 || bitmap > HOOK_BITMAP_MAX) {
    return {
      valid: false,
      issues: [
        {
          code: "BITMAP_OUT_OF_RANGE",
          message: `bitmap must be an integer in [0, ${HOOK_BITMAP_MAX}], received: ${bitmap}`,
        },
      ],
    };
  }

  if ((bitmap & ~HOOK_BITMAP_MASK) !== 0) {
    issues.push({
      code: "UNASSIGNED_BIT_SET",
      message:
        `bits above ${MAX_HOOK_FLAG_OFFSET} are unassigned and must be zero; ` +
        `bitmap 0x${bitmap.toString(16)} sets at least one of them`,
    });
  }

  const table = hookFlagsFor(poolType);
  const nameOf = (offset: number): string =>
    Object.entries(table).find(([, o]) => o === offset)?.[0] ?? `bit${offset}`;

  for (const [dependent, required] of HOOK_PERMISSION_DEPENDENCIES[poolType]) {
    if (hasHookPermission(bitmap, dependent) && !hasHookPermission(bitmap, required)) {
      issues.push({
        code: "MISSING_DEPENDENCY",
        message: `${nameOf(dependent)} (bit ${dependent}) requires ${nameOf(required)} (bit ${required})`,
      });
    }
  }

  return { valid: issues.length === 0, issues };
}

/** Throws when {@link validateHookRegistrationBitmap} reports any issue. */
export function assertValidHookRegistrationBitmap(poolType: PoolType, bitmap: number): void {
  const result = validateHookRegistrationBitmap(poolType, bitmap);
  if (!result.valid) {
    throw new Error(
      `invalid hook registration bitmap: ${result.issues.map((i) => i.message).join("; ")}`,
    );
  }
}

/** The parts of a pool key the hook configuration check needs. */
export interface HookConfigCheckInput {
  readonly poolType: PoolType;
  /** Hook contract address; the zero address means the pool has no hook. */
  readonly hooks: Address;
  /** The pool key's `fee` field. */
  readonly fee: number;
  /** The pool key's packed `parameters` word. */
  readonly parameters: PoolParameters;
  /**
   * Value returned by the hook's `getHooksRegistrationBitmap()` view, if it has
   * been fetched. When supplied it is compared against the bitmap in
   * `parameters` - the same equality the pool manager checks on initialization.
   */
  readonly onChainBitmap?: number;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

/**
 * Reproduces the pool manager's initialization-time hook checks.
 *
 * Rules:
 * 1. A pool with no hook must carry an all-zero bitmap and a static fee.
 * 2. A pool with a hook must carry a bitmap identical to the value the hook
 *    reports from `getHooksRegistrationBitmap()`.
 * 3. Every returns-delta callback requires its base callback.
 *
 * Rule 2 is only checked when `onChainBitmap` is provided; read it from the
 * hook contract first if you want the full check.
 */
export function validateHookConfig(input: HookConfigCheckInput): HookValidationResult {
  const bitmap = getHooksRegistrationBitmap(input.parameters);
  const issues: HookValidationIssue[] = [];

  if (isAddressEqual(input.hooks, ZERO_ADDRESS)) {
    if (bitmap !== 0) {
      issues.push({
        code: "HOOKLESS_POOL_WITH_BITMAP",
        message: `pool has no hook but parameters register callbacks (bitmap 0x${bitmap.toString(16)})`,
      });
    }
    if (isDynamicLPFee(input.fee)) {
      issues.push({
        code: "HOOKLESS_POOL_WITH_DYNAMIC_FEE",
        message:
          `pool has no hook but its fee is the dynamic-fee marker ` +
          `(0x${DYNAMIC_FEE_FLAG.toString(16)}); a dynamic fee needs a hook to supply it`,
      });
    }
    return { valid: issues.length === 0, issues };
  }

  issues.push(...validateHookRegistrationBitmap(input.poolType, bitmap).issues);

  if (input.onChainBitmap !== undefined && input.onChainBitmap !== bitmap) {
    issues.push({
      code: "BITMAP_MISMATCH",
      message:
        `parameters register 0x${bitmap.toString(16)} but the hook at ${input.hooks} ` +
        `reports 0x${input.onChainBitmap.toString(16)}`,
    });
  }

  return { valid: issues.length === 0, issues };
}

/** Throws when {@link validateHookConfig} reports any issue. */
export function assertValidHookConfig(input: HookConfigCheckInput): void {
  const result = validateHookConfig(input);
  if (!result.valid) {
    throw new Error(
      `invalid hook configuration: ${result.issues.map((i) => i.message).join("; ")}`,
    );
  }
}

/**
 * Convenience builder: validates a permission set and returns the parameter
 * word carrying it, leaving the pool-type-specific fields untouched.
 */
export function parametersWithHookPermissions<T extends PoolType>(
  poolType: T,
  permissions: HookPermissionsInput<T>,
  base: PoolParameters = EMPTY_PARAMETERS,
): PoolParameters {
  const bitmap = encodeHookPermissions(poolType, permissions);
  assertValidHookRegistrationBitmap(poolType, bitmap);
  return setHooksRegistrationBitmap(base, bitmap);
}
