// SPDX-License-Identifier: MIT
/**
 * The shape `readTokenTrust` returns: for one token, every fact the Latch
 * contracts hold about it that bears on trust, each with the contract it was
 * read from.
 *
 * Every section is one of four things, and a renderer must keep them apart:
 *
 *   - `not-configured`  the contract that would answer is not deployed on
 *                       this chain (the address book has `null`). Nothing was
 *                       read, and nothing may be implied.
 *   - `error`           the contract exists and the read failed. Say so.
 *   - `read`            the answer, with its `sources`.
 *   - (pool-level only) `no-hook` / `not-a-launch-pool`, which are READ facts.
 *
 * A registry listing is not an audit, and nothing here says "safe". The words
 * are in `./format.ts` and say only what was read.
 */

import type { Address, Hex } from "viem";

import type { HookWarning, Listing, PermissionSource, RiskClass, Verification } from "../registry/types.js";

/** Where a figure came from: the contract, its address and the view that was called. */
export interface TrustSource {
  /** The contract's name, e.g. `LatchTokenLock`. */
  readonly contract: string;
  readonly address: Address;
  /** The view(s) called, e.g. `currencyLockIds, getLock, totalHeld`. */
  readonly call: string;
}

/** The blocks the whole read spans. Every row was read at `latest` between the two (RPC block numbers). */
export interface TrustReadAt {
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
  /** `block.timestamp` of the latest block when the read began: the clock every expiry is judged against. */
  readonly chainNow: bigint;
}

export type TrustSection<T> =
  | { readonly status: "not-configured"; readonly reason: string }
  | { readonly status: "error"; readonly message: string; readonly source: TrustSource | null }
  | ({ readonly status: "read"; readonly sources: readonly TrustSource[] } & T);

/* ------------------------------------------------------------------ launch --- */

export interface LaunchFacts {
  /** `null`: the Kit v2 kit has no launch for this token (`legsOf` empty). */
  readonly launch: {
    readonly creator: Address;
    readonly tenant: Address;
    readonly operator: Address;
    readonly integrator: Address;
    /** `block.timestamp` trading opens (the kit's record). */
    readonly startTime: bigint;
    readonly legCount: number;
  } | null;
}

/* ------------------------------------------------------------- token locks --- */

export interface TokenLockFacts {
  readonly lockCount: number;
  /** `totalHeld(token)`: owed to every lock, vested-but-unclaimed included. */
  readonly totalHeld: bigint;
  /** Not yet vested: no beneficiary can take it now. */
  readonly unvested: bigint;
  readonly totalSupply: bigint | null;
  readonly heldBps: number | null;
  readonly unvestedBps: number | null;
  /** Soonest cliff or end among locks still vesting. */
  readonly nextRelease: bigint | null;
  readonly lastEnd: bigint | null;
}

/* ------------------------------------------------------------------- pools --- */

export type PoolKind = "CL" | "Bin";

/** How the pool was found. A token's pools are NOT enumerated exhaustively; see `TokenTrust.discovery`. */
export type PoolOrigin = "launch-leg" | "lp-locker" | "position-lock" | "given";

export interface PoolLiquidityFacts {
  /**
   * CL: in-range liquidity that cannot leave now (time-locked before unlock +
   * permanent LP locker) / the pool's ACTIVE liquidity, bps. `null` when the
   * pool has no active liquidity or its state was not readable.
   * Bin: the locked fraction of the ACTIVE bin (permanent only), bps.
   */
  readonly lockedActiveBps: number | null;
  readonly permanentActiveBps: number | null;
  readonly timeLockedActiveBps: number | null;
  /** Time locks still before their unlock date. */
  readonly timeLockedCount: number;
  /** Time locks past their date and not withdrawn. */
  readonly unlockableCount: number;
  /** CL positions / Bin locks held forever by an LP locker. */
  readonly permanentCount: number;
  /** Locked positions whose range does not contain the current price (not in the share). */
  readonly outOfRange: number;
  readonly nextUnlockAt: bigint | null;
  readonly lastUnlockAt: bigint | null;
  /** `false` when the pool had no liquidity at the current price (or no state), so no share is measurable. */
  readonly measurable: boolean;
}

export type LpFeeFacts =
  /** The launch guard's `currentFee(poolId)`: the LP fee a swap pays now, pips. */
  | { readonly kind: "launch-guard"; readonly pips: number; readonly source: TrustSource }
  /** A static fee from the pool key, pips. */
  | { readonly kind: "static"; readonly pips: number; readonly source: TrustSource }
  /** Dynamic: the hook sets it per swap and it could not be read as one number. */
  | { readonly kind: "dynamic"; readonly reason: string; readonly source: TrustSource | null };

export interface ProtocolFeeFacts {
  /** Pips of the swap amount, per direction (core caps each at 4000 = 0.4%). */
  readonly zeroForOne: number;
  readonly oneForZero: number;
}

export interface CreatorTaxFacts {
  /** `getTax(poolId)`, or `null` when the pool has none (every field zero). */
  readonly tax: {
    readonly buyBps: number;
    readonly sellBps: number;
    readonly expiresAt: bigint;
    readonly creator: Address;
    readonly integrator: Address;
    readonly creatorBps: number;
    readonly protocolBps: number;
    readonly integratorBps: number;
  } | null;
  /** `currentTaxRates(poolId)`: what a swap pays now (0 once expired). */
  readonly buyBpsNow: number;
  readonly sellBpsNow: number;
}

export type PoolTaxTrust =
  /** The pool's hook is not a Latch launch guard: there is no creator tax to read. */
  | { readonly status: "not-a-launch-pool" }
  | TrustSection<CreatorTaxFacts>;

export interface RegistryFacts {
  /** `false`: `isRegistered(hook)` is false. */
  readonly listed: boolean;
  readonly name: string | null;
  readonly listing: Listing | null;
  readonly verification: Verification | null;
  readonly riskClass: RiskClass | null;
  readonly permissionSource: PermissionSource | null;
  readonly attestationCount: number;
  /** The registry's listing is `Malicious`. */
  readonly flagged: boolean;
  readonly warnings: readonly HookWarning[];
}

export type PoolRegistryTrust = { readonly status: "no-hook" } | TrustSection<RegistryFacts>;

export interface PoolTrust {
  readonly poolId: Hex;
  readonly kind: PoolKind;
  readonly currency0: Address;
  readonly currency1: Address;
  /** The other currency of the pool. */
  readonly pairedWith: Address;
  /** `poolKey.hooks` (zero = no hook). */
  readonly hooks: Address;
  /** `poolKey.fee` as stored (may carry the dynamic flag). */
  readonly keyFee: number;
  readonly poolManager: Address;
  readonly origins: readonly PoolOrigin[];
  /** Whether `hooks` is this chain's Kit v2 launch guard. */
  readonly launchGuard: boolean;
  readonly liquidity: TrustSection<PoolLiquidityFacts>;
  readonly lpFee: LpFeeFacts | { readonly kind: "error"; readonly message: string };
  readonly protocolFee: TrustSection<ProtocolFeeFacts>;
  readonly tax: PoolTaxTrust;
  readonly registry: PoolRegistryTrust;
}

/** A pool that was found but could not be described (its key did not read). */
export interface PoolTrustFailure {
  readonly poolId: Hex;
  readonly kind: PoolKind;
  readonly origins: readonly PoolOrigin[];
  readonly message: string;
}

export interface TokenTrust {
  readonly token: Address;
  readonly native: boolean;
  readonly symbol: string;
  /** `null`: `decimals()` did not answer; amounts are base units. */
  readonly decimals: number | null;
  readonly readAt: TrustReadAt;
  readonly launch: TrustSection<LaunchFacts>;
  readonly tokenLocks: TrustSection<TokenLockFacts>;
  readonly pools: readonly PoolTrust[];
  readonly failedPools: readonly PoolTrustFailure[];
  /**
   * How pools were found. A token can trade in pools that no Latch lock or
   * launch knows about; those are not listed, and a renderer must not imply
   * the list is every pool of the token.
   */
  readonly discovery: {
    readonly searched: readonly PoolOrigin[];
    /** More pools were found than `maxPools`; the rest were not read. */
    readonly truncated: boolean;
    /** Position locks scanned (newest first) when the lock contract holds more than the bound. */
    readonly positionLocksTruncated: boolean;
  };
}
