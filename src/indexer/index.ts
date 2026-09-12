// SPDX-License-Identifier: MIT
/**
 * Indexer helpers.
 *
 * The entity types in `./entities` describe the shape of the store;
 * these functions build the deterministic ids the store is keyed by, and turn a
 * hook bitmap into the flattened permission row the schema expects.
 */

import type { Hex } from "viem";
import {
  BIN_HOOK_FLAGS,
  CL_HOOK_FLAGS,
  hasHookPermission,
  type PoolType,
} from "../hooks/bitmap.js";
import type { HookPermissionsEntity } from "./entities.js";

export * from "./entities.js";

/** Zero address, used for hookless pools and the native currency. */
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** The single Protocol row's id. */
export const PROTOCOL_ENTITY_ID = "latchprotocol";

/** Id for a log-derived entity: `${transactionHash}-${logIndex}`. */
export function eventId(transactionHash: Hex, logIndex: number): string {
  return `${transactionHash.toLowerCase()}-${logIndex}`;
}

/** Id for an address-keyed entity (Token, Hook, PoolManager, Vault, Account). */
export function addressId(address: string): string {
  return address.toLowerCase();
}

/** Id for a Pool row: the pool id itself, lowercased. */
export function poolEntityId(poolId: Hex): string {
  return poolId.toLowerCase();
}

/** Id for a HookPermissions row, shared by every pool with the same bitmap. */
export function hookPermissionsId(poolType: PoolType, bitmap: number): string {
  return `${poolType}-0x${bitmap.toString(16).padStart(4, "0")}`;
}

/** Id for a concentrated-liquidity position. */
export function clPositionId(
  poolId: Hex,
  owner: string,
  tickLower: number,
  tickUpper: number,
  salt: Hex,
): string {
  return [
    poolEntityId(poolId),
    owner.toLowerCase(),
    tickLower,
    tickUpper,
    salt.toLowerCase(),
  ].join("-");
}

/** Id for a liquidity-book position. */
export function binPositionId(
  poolId: Hex,
  owner: string,
  binId: bigint | number,
  salt: Hex,
): string {
  return [poolEntityId(poolId), owner.toLowerCase(), binId.toString(), salt.toLowerCase()].join(
    "-",
  );
}

/** Id for a vault claim-token balance. */
export function vaultBalanceId(account: string, currency: string): string {
  return `${account.toLowerCase()}-${currency.toLowerCase()}`;
}

/** True when an address field means "absent" rather than a real contract. */
export function isZeroAddress(address: string): boolean {
  return address.toLowerCase() === ZERO_ADDRESS;
}

/**
 * Flattens a registration bitmap into the HookPermissions row.
 *
 * Flags belonging to the other pool type are set to `false`, so a consumer can
 * read either naming without branching on `poolType` first.
 */
export function buildHookPermissionsEntity(
  poolType: PoolType,
  bitmap: number,
): HookPermissionsEntity {
  const cl = poolType === "CL";
  const bin = poolType === "BIN";
  const at = (offset: number, applies: boolean): boolean =>
    applies && hasHookPermission(bitmap, offset);

  return {
    id: hookPermissionsId(poolType, bitmap),
    poolType,
    bitmap,

    beforeInitialize: hasHookPermission(bitmap, CL_HOOK_FLAGS.beforeInitialize),
    afterInitialize: hasHookPermission(bitmap, CL_HOOK_FLAGS.afterInitialize),

    beforeAddLiquidity: at(CL_HOOK_FLAGS.beforeAddLiquidity, cl),
    afterAddLiquidity: at(CL_HOOK_FLAGS.afterAddLiquidity, cl),
    beforeRemoveLiquidity: at(CL_HOOK_FLAGS.beforeRemoveLiquidity, cl),
    afterRemoveLiquidity: at(CL_HOOK_FLAGS.afterRemoveLiquidity, cl),

    beforeMint: at(BIN_HOOK_FLAGS.beforeMint, bin),
    afterMint: at(BIN_HOOK_FLAGS.afterMint, bin),
    beforeBurn: at(BIN_HOOK_FLAGS.beforeBurn, bin),
    afterBurn: at(BIN_HOOK_FLAGS.afterBurn, bin),

    beforeSwap: hasHookPermission(bitmap, CL_HOOK_FLAGS.beforeSwap),
    afterSwap: hasHookPermission(bitmap, CL_HOOK_FLAGS.afterSwap),
    beforeDonate: hasHookPermission(bitmap, CL_HOOK_FLAGS.beforeDonate),
    afterDonate: hasHookPermission(bitmap, CL_HOOK_FLAGS.afterDonate),
    beforeSwapReturnsDelta: hasHookPermission(bitmap, CL_HOOK_FLAGS.beforeSwapReturnsDelta),
    afterSwapReturnsDelta: hasHookPermission(bitmap, CL_HOOK_FLAGS.afterSwapReturnsDelta),

    afterAddLiquidityReturnsDelta: at(CL_HOOK_FLAGS.afterAddLiquidityReturnsDelta, cl),
    afterRemoveLiquidityReturnsDelta: at(CL_HOOK_FLAGS.afterRemoveLiquidityReturnsDelta, cl),
    afterMintReturnsDelta: at(BIN_HOOK_FLAGS.afterMintReturnsDelta, bin),
    afterBurnReturnsDelta: at(BIN_HOOK_FLAGS.afterBurnReturnsDelta, bin),
  };
}

/**
 * Direction of a swap, inferred from its signed amounts.
 *
 * A positive `amount0` means currency0 entered the pool, which is a
 * zero-for-one swap.
 */
export function swapIsZeroForOne(amount0: bigint): boolean {
  return amount0 > 0n;
}
