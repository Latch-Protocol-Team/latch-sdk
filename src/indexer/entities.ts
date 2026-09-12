// SPDX-License-Identifier: MIT
/**
 * Indexer entity model.
 *
 * A TypeScript mirror of `schema.graphql`. Use these types in an indexer's
 * handlers, in the API layer that serves an analytics dashboard, or as the
 * contract between the two.
 *
 * Conventions:
 * - `Ref<T>` marks a foreign key. A store returns the id; a resolver returns
 *   the entity. Both fit, so the same types describe raw rows and hydrated ones.
 * - On-chain integers wider than 48 bits are `bigint`; narrower ones are
 *   `number`, matching the generated event types.
 * - Signed amounts follow the pool's point of view: negative left the pool.
 */

import type { Address, Hex } from "viem";
import type { PoolType } from "../hooks/bitmap.js";

export type { PoolType };

/**
 * A reference to another entity: its id before hydration, the entity after.
 */
export type Ref<T extends { id: string }> = string | T;

/** Resolves a {@link Ref} to an id regardless of hydration state. */
export function refId<T extends { id: string }>(ref: Ref<T>): string {
  return typeof ref === "string" ? ref : ref.id;
}

/** Direction of a liquidity change. */
export type LiquidityChangeType = "ADD" | "REMOVE";

/** Whether a pool manager was paused or unpaused. */
export type PauseState = "PAUSED" | "UNPAUSED";

/** Fields carried by every entity derived from a single log. */
export interface EventSourced {
  /** `${transactionHash}-${logIndex}` */
  readonly id: string;
  readonly transaction: Ref<Transaction>;
  readonly timestamp: bigint;
  readonly blockNumber: bigint;
  readonly logIndex: number;
}

// ---------------------------------------------------------------------------
// Protocol-level singletons
// ---------------------------------------------------------------------------

/** Global roll-up; exactly one row. */
export interface Protocol {
  readonly id: string;
  readonly vault?: Ref<Vault>;
  readonly poolCount: bigint;
  readonly hookCount: bigint;
  readonly swapCount: bigint;
  readonly protocolFeeController?: Address;
}

/** The singleton that custodies balances and settles deltas. */
export interface Vault {
  readonly id: string;
  readonly address: Address;
  readonly owner?: Address;
  readonly pendingOwner?: Address;
  readonly registeredAppCount: bigint;
}

/** A pool manager contract: the source of pool lifecycle events. */
export interface PoolManager {
  readonly id: string;
  readonly address: Address;
  readonly poolType: PoolType;
  readonly protocol: Ref<Protocol>;
  readonly vault?: Ref<Vault>;
  readonly owner?: Address;
  readonly protocolFeeController?: Address;
  readonly paused: boolean;
  readonly poolCount: bigint;
  /** Bin manager only. */
  readonly maxBinStep?: number;
  /** Bin manager only. */
  readonly minBinSharesForDonate?: bigint;
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

/** An ERC-20, or the native asset at the zero address. */
export interface Token {
  readonly id: string;
  readonly address: Address;
  readonly symbol?: string;
  readonly name?: string;
  readonly decimals?: number;
  readonly isNative: boolean;
  readonly poolCount: bigint;
}

/**
 * A hook contract.
 *
 * Permissions are not encoded in the address, so one hook may back pools with
 * different bitmaps; `observedBitmaps` records every distinct value seen.
 */
export interface Hook {
  readonly id: string;
  readonly address: Address;
  readonly registrationBitmap?: number;
  readonly observedBitmaps: readonly number[];
  readonly poolCount: bigint;
  readonly swapCount: bigint;
  readonly firstSeenBlock: bigint;
  readonly firstSeenTimestamp: bigint;
}

/**
 * The decoded permission set behind a registration bitmap.
 *
 * Both pool types share bit offsets, so both naming schemes appear; the flags
 * that do not apply to a pool type are always `false`.
 */
export interface HookPermissionsEntity {
  /** `${poolType}-0x${bitmap.toString(16).padStart(4, "0")}` */
  readonly id: string;
  readonly poolType: PoolType;
  readonly bitmap: number;

  readonly beforeInitialize: boolean;
  readonly afterInitialize: boolean;
  readonly beforeAddLiquidity: boolean;
  readonly afterAddLiquidity: boolean;
  readonly beforeRemoveLiquidity: boolean;
  readonly afterRemoveLiquidity: boolean;
  readonly beforeMint: boolean;
  readonly afterMint: boolean;
  readonly beforeBurn: boolean;
  readonly afterBurn: boolean;
  readonly beforeSwap: boolean;
  readonly afterSwap: boolean;
  readonly beforeDonate: boolean;
  readonly afterDonate: boolean;
  readonly beforeSwapReturnsDelta: boolean;
  readonly afterSwapReturnsDelta: boolean;
  readonly afterAddLiquidityReturnsDelta: boolean;
  readonly afterRemoveLiquidityReturnsDelta: boolean;
  readonly afterMintReturnsDelta: boolean;
  readonly afterBurnReturnsDelta: boolean;
}

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

/** One pool inside the singleton, keyed by its pool id. */
export interface Pool {
  /** keccak256 of the six pool-key words. */
  readonly id: string;
  readonly poolType: PoolType;
  readonly poolManager: Ref<PoolManager>;

  readonly token0: Ref<Token>;
  readonly token1: Ref<Token>;
  readonly currency0: Address;
  readonly currency1: Address;
  /** Absent when the pool runs without a hook. */
  readonly hook?: Ref<Hook>;
  readonly hooksAddress: Address;

  readonly feeRaw: number;
  readonly staticLpFee?: number;
  readonly isDynamicFee: boolean;
  readonly parameters: Hex;

  readonly hooksRegistrationBitmap: number;
  readonly hookPermissions: Ref<HookPermissionsEntity>;
  /** Concentrated liquidity only. */
  readonly tickSpacing?: number;
  /** Liquidity book only. */
  readonly binStep?: number;

  readonly currentLpFee?: number;
  readonly protocolFee: number;
  readonly protocolFeeZeroForOne: number;
  readonly protocolFeeOneForZero: number;
  readonly sqrtPriceX96?: bigint;
  readonly tick?: number;
  readonly liquidity?: bigint;
  readonly activeId?: number;

  readonly swapCount: bigint;
  readonly liquidityChangeCount: bigint;
  readonly donateCount: bigint;
  readonly volumeToken0: bigint;
  readonly volumeToken1: bigint;

  readonly createdAtBlock: bigint;
  readonly createdAtTimestamp: bigint;
  readonly createdAtTransaction: Hex;
}

// ---------------------------------------------------------------------------
// Event-derived facts
// ---------------------------------------------------------------------------

/** A transaction that touched the protocol. */
export interface Transaction {
  readonly id: string;
  readonly hash: Hex;
  readonly blockNumber: bigint;
  readonly timestamp: bigint;
  readonly from: Address;
  readonly gasUsed?: bigint;
  readonly gasPrice?: bigint;
}

/** One swap, from either pool manager. */
export interface Swap extends EventSourced {
  readonly pool: Ref<Pool>;
  readonly poolType: PoolType;
  readonly hook?: Ref<Hook>;
  readonly sender: Address;
  readonly amount0: bigint;
  readonly amount1: bigint;
  readonly zeroForOne: boolean;
  readonly fee: number;
  readonly protocolFee: number;
  /** Concentrated liquidity only. */
  readonly sqrtPriceX96?: bigint;
  /** Concentrated liquidity only. */
  readonly tick?: number;
  /** Concentrated liquidity only. */
  readonly liquidity?: bigint;
  /** Liquidity book only. */
  readonly activeId?: number;
}

/** A liquidity change, unifying CL `ModifyLiquidity` with bin `Mint`/`Burn`. */
export interface LiquidityChange extends EventSourced {
  readonly pool: Ref<Pool>;
  readonly poolType: PoolType;
  readonly hook?: Ref<Hook>;
  readonly changeType: LiquidityChangeType;
  readonly sender: Address;
  readonly salt: Hex;

  /** Concentrated liquidity only. */
  readonly tickLower?: number;
  /** Concentrated liquidity only. */
  readonly tickUpper?: number;
  /** Concentrated liquidity only. */
  readonly liquidityDelta?: bigint;
  /** Concentrated liquidity only. */
  readonly clPosition?: Ref<CLPosition>;

  /** Liquidity book only. */
  readonly binIds?: readonly bigint[];
  /** Liquidity book only: one packed word per bin id. */
  readonly binAmounts?: readonly Hex[];
  /** Liquidity book, mint only. */
  readonly compositionFeeAmount?: Hex;
  /** Liquidity book, mint only. */
  readonly feeAmountToProtocol?: Hex;
}

/** A donation straight to liquidity providers. */
export interface Donate extends EventSourced {
  readonly pool: Ref<Pool>;
  readonly poolType: PoolType;
  readonly hook?: Ref<Hook>;
  readonly sender: Address;
  readonly amount0: bigint;
  readonly amount1: bigint;
  /** Concentrated liquidity only. */
  readonly tick?: number;
  /** Liquidity book only. */
  readonly binId?: number;
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

/** A concentrated-liquidity position. */
export interface CLPosition {
  /** `${poolId}-${owner}-${tickLower}-${tickUpper}-${salt}` */
  readonly id: string;
  readonly pool: Ref<Pool>;
  readonly owner: Address;
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly salt: Hex;
  readonly liquidity: bigint;
  readonly createdAtBlock: bigint;
  readonly createdAtTimestamp: bigint;
  readonly lastUpdatedBlock: bigint;
}

/** Shares held in a single bin. */
export interface BinPosition {
  /** `${poolId}-${owner}-${binId}-${salt}` */
  readonly id: string;
  readonly pool: Ref<Pool>;
  readonly owner: Address;
  readonly binId: bigint;
  readonly salt: Hex;
  readonly shares: bigint;
  readonly createdAtBlock: bigint;
  readonly createdAtTimestamp: bigint;
  readonly lastUpdatedBlock: bigint;
}

// ---------------------------------------------------------------------------
// Fee governance
// ---------------------------------------------------------------------------

/** A change to a pool's protocol fee. */
export interface ProtocolFeeUpdate extends EventSourced {
  readonly pool: Ref<Pool>;
  readonly previousProtocolFee?: number;
  readonly protocolFee: number;
  readonly protocolFeeZeroForOne: number;
  readonly protocolFeeOneForZero: number;
}

/** A dynamic LP fee update pushed by a hook. */
export interface DynamicLpFeeUpdate extends EventSourced {
  readonly pool: Ref<Pool>;
  readonly hook?: Ref<Hook>;
  readonly previousLpFee?: number;
  readonly dynamicLpFee: number;
}

/** A change of the address allowed to set protocol fees. */
export interface ProtocolFeeControllerUpdate extends EventSourced {
  readonly poolManager: Ref<PoolManager>;
  readonly previousController?: Address;
  readonly controller: Address;
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

/** A pause or unpause of a pool manager. */
export interface PauseEvent extends EventSourced {
  readonly poolManager: Ref<PoolManager>;
  readonly state: PauseState;
  readonly account: Address;
}

/** An ownership handover, including the pending first step. */
export interface OwnershipTransfer extends EventSourced {
  readonly contractAddress: Address;
  readonly previousOwner: Address;
  readonly newOwner: Address;
  /** True for the two-step start, false for completion. */
  readonly pending: boolean;
}

/** A pool manager accepted by the vault as a settlement app. */
export interface AppRegistration extends EventSourced {
  readonly vault: Ref<Vault>;
  readonly app: Address;
}

// ---------------------------------------------------------------------------
// Vault claim tokens
// ---------------------------------------------------------------------------

/** A holder of vault claim tokens. */
export interface Account {
  readonly id: string;
  readonly address: Address;
}

/** One account's claim-token balance in one currency. */
export interface VaultBalance {
  /** `${account}-${currency}` */
  readonly id: string;
  readonly account: Ref<Account>;
  readonly token: Ref<Token>;
  readonly currency: Address;
  readonly balance: bigint;
  readonly lastUpdatedBlock: bigint;
}

/** A claim-token transfer inside the vault. */
export interface VaultTransfer extends EventSourced {
  readonly caller: Address;
  readonly from: Address;
  readonly to: Address;
  readonly token: Ref<Token>;
  readonly currency: Address;
  readonly amount: bigint;
}

/** A claim-token allowance change. */
export interface VaultApproval extends EventSourced {
  readonly owner: Address;
  readonly spender: Address;
  readonly token: Ref<Token>;
  readonly currency: Address;
  readonly amount: bigint;
}

/** An account-wide operator grant or revocation. */
export interface VaultOperatorSet extends EventSourced {
  readonly owner: Address;
  readonly operator: Address;
  readonly approved: boolean;
}

/** Every entity in the model, keyed by its GraphQL type name. */
export interface IndexerEntities {
  Protocol: Protocol;
  Vault: Vault;
  PoolManager: PoolManager;
  Token: Token;
  Hook: Hook;
  HookPermissions: HookPermissionsEntity;
  Pool: Pool;
  Transaction: Transaction;
  Swap: Swap;
  LiquidityChange: LiquidityChange;
  Donate: Donate;
  CLPosition: CLPosition;
  BinPosition: BinPosition;
  ProtocolFeeUpdate: ProtocolFeeUpdate;
  DynamicLpFeeUpdate: DynamicLpFeeUpdate;
  ProtocolFeeControllerUpdate: ProtocolFeeControllerUpdate;
  PauseEvent: PauseEvent;
  OwnershipTransfer: OwnershipTransfer;
  AppRegistration: AppRegistration;
  Account: Account;
  VaultBalance: VaultBalance;
  VaultTransfer: VaultTransfer;
  VaultApproval: VaultApproval;
  VaultOperatorSet: VaultOperatorSet;
}

/** Name of any entity in the model. */
export type IndexerEntityName = keyof IndexerEntities;
