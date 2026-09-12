// SPDX-License-Identifier: MIT
/**
 * Pool keys and pool ids.
 *
 * A pool is not a contract. It is a row inside the singleton, addressed by the
 * hash of the six fields that define it. Two pools differing in any single
 * field - including the hook or a single bit of `parameters` - are different
 * pools with different ids.
 */

import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import {
  currenciesAreSorted,
  type Currency,
} from "./currency.js";
import { isValidLPFee } from "./fee.js";
import {
  decodeBinPoolParameters,
  decodeCLPoolParameters,
  encodeBinPoolParameters,
  encodeCLPoolParameters,
  getHooksRegistrationBitmap,
  type PoolParameters,
} from "./parameters.js";

/** keccak256 of a pool key: the singleton's handle for one pool. */
export type PoolId = Hex;

/**
 * The six fields that identify a pool.
 *
 * Field order matters: the id is the hash of these values in exactly this
 * sequence, so never reorder them when encoding.
 */
export interface PoolKey {
  /** Lower-sorted currency of the pair. */
  readonly currency0: Currency;
  /** Higher-sorted currency of the pair. */
  readonly currency1: Currency;
  /** Hook contract, or the zero address for a pool with no hook. */
  readonly hooks: Address;
  /** Pool manager that owns this pool (concentrated liquidity or bin). */
  readonly poolManager: Address;
  /** LP fee in pips, or the dynamic-fee marker. */
  readonly fee: number;
  /** Packed hook bitmap plus pool-type-specific configuration. */
  readonly parameters: PoolParameters;
}

/** ABI encoding of the pool key fields, in struct order. */
const POOL_KEY_ABI_PARAMETERS = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "hooks", type: "address" },
  { name: "poolManager", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "parameters", type: "bytes32" },
] as const;

/**
 * Computes the pool id.
 *
 * The singleton hashes the key's six words in place, which is byte-identical to
 * hashing their standard ABI encoding, so this reproduces the on-chain value
 * exactly.
 */
export function poolKeyToId(key: PoolKey): PoolId {
  return keccak256(
    encodeAbiParameters(POOL_KEY_ABI_PARAMETERS, [
      key.currency0,
      key.currency1,
      key.hooks,
      key.poolManager,
      key.fee,
      key.parameters,
    ]),
  );
}

/** Positional form of a pool key, for contract calls that take a struct. */
export function poolKeyToTuple(
  key: PoolKey,
): readonly [Currency, Currency, Address, Address, number, PoolParameters] {
  return [
    key.currency0,
    key.currency1,
    key.hooks,
    key.poolManager,
    key.fee,
    key.parameters,
  ] as const;
}

/** Rebuilds a pool key from its positional form. */
export function poolKeyFromTuple(
  tuple: readonly [Currency, Currency, Address, Address, number, PoolParameters],
): PoolKey {
  return {
    currency0: tuple[0],
    currency1: tuple[1],
    hooks: tuple[2],
    poolManager: tuple[3],
    fee: tuple[4],
    parameters: tuple[5],
  };
}

/** Structural equality of two pool keys (equivalent to comparing their ids). */
export function poolKeysEqual(a: PoolKey, b: PoolKey): boolean {
  return poolKeyToId(a) === poolKeyToId(b);
}

/** The hook registration bitmap carried by a key's `parameters`. */
export function poolKeyHookBitmap(key: PoolKey): number {
  return getHooksRegistrationBitmap(key.parameters);
}

/**
 * Sanity-checks a key before it is hashed or submitted.
 *
 * Catches the two mistakes that silently produce a different pool than intended:
 * unsorted currencies and an out-of-range fee.
 */
export function assertValidPoolKey(key: PoolKey): void {
  if (!currenciesAreSorted(key.currency0, key.currency1)) {
    throw new Error(
      `pool key currencies must be sorted ascending; received currency0=${key.currency0}, currency1=${key.currency1}`,
    );
  }
  if (!isValidLPFee(key.fee)) {
    throw new Error(`pool key fee is out of range: ${key.fee}`);
  }
}

/** Arguments for building a concentrated-liquidity pool key. */
export interface CreateCLPoolKeyArgs {
  readonly currency0: Currency;
  readonly currency1: Currency;
  readonly hooks: Address;
  readonly poolManager: Address;
  readonly fee: number;
  readonly tickSpacing: number;
  readonly hooksRegistrationBitmap?: number;
}

/** Arguments for building a liquidity-book pool key. */
export interface CreateBinPoolKeyArgs {
  readonly currency0: Currency;
  readonly currency1: Currency;
  readonly hooks: Address;
  readonly poolManager: Address;
  readonly fee: number;
  readonly binStep: number;
  readonly hooksRegistrationBitmap?: number;
}

/** Builds and validates a concentrated-liquidity pool key. */
export function createCLPoolKey(args: CreateCLPoolKeyArgs): PoolKey {
  const key: PoolKey = {
    currency0: args.currency0,
    currency1: args.currency1,
    hooks: args.hooks,
    poolManager: args.poolManager,
    fee: args.fee,
    parameters: encodeCLPoolParameters(args.hooksRegistrationBitmap ?? 0, args.tickSpacing),
  };
  assertValidPoolKey(key);
  return key;
}

/** Builds and validates a liquidity-book pool key. */
export function createBinPoolKey(args: CreateBinPoolKeyArgs): PoolKey {
  const key: PoolKey = {
    currency0: args.currency0,
    currency1: args.currency1,
    hooks: args.hooks,
    poolManager: args.poolManager,
    fee: args.fee,
    parameters: encodeBinPoolParameters(args.hooksRegistrationBitmap ?? 0, args.binStep),
  };
  assertValidPoolKey(key);
  return key;
}

/** Decoded concentrated-liquidity view of a key's parameters. */
export function readCLPoolKeyParameters(key: PoolKey): ReturnType<typeof decodeCLPoolParameters> {
  return decodeCLPoolParameters(key.parameters);
}

/** Decoded liquidity-book view of a key's parameters. */
export function readBinPoolKeyParameters(key: PoolKey): ReturnType<typeof decodeBinPoolParameters> {
  return decodeBinPoolParameters(key.parameters);
}
