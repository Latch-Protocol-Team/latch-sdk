// SPDX-License-Identifier: MIT
/**
 * `LatchPositionLock`: time-locked CL liquidity positions.
 *
 * A lock holds one `CLPositionManager` NFT until `unlockAt`. Until then nobody
 * can remove its liquidity or move the NFT; the lock owner keeps collecting
 * its swap fees (`collectFees`, permissionless, pays only the lock owner) and
 * withdraws the NFT after `unlockAt`. A lock can be extended, never shortened.
 * The lock owner rotates two-step.
 *
 * HOW MUCH OF A POOL IS LOCKED, and why it is not "% of LP tokens". A CL pool
 * has no LP token and no single "total liquidity": liquidity lives in tick
 * ranges. The one pool-wide figure core stores is the ACTIVE liquidity at the
 * current tick (`CLPoolManager.getLiquidity(poolId)`), which is exactly the sum
 * of the liquidity of every position whose range contains the current tick.
 * A locked position contributes to it when `tickLower <= tick < tickUpper`.
 * So `lockedActiveBps` = (liquidity of live, in-range locked positions) /
 * (pool active liquidity), in the same units, exact at the block read. It says
 * nothing about liquidity outside the current price, and it moves when the
 * price moves. Locked positions out of range are listed with their token
 * amounts and counted separately (`outOfRangeLive`).
 *
 * Independently authored against the contract's compiled ABI and documented
 * rules (`packages/launchpad/src/lock/LatchPositionLock.sol`).
 */

import { encodeFunctionData, getAddress, isAddress, zeroAddress, type Address, type Hex, type PublicClient } from "viem";

import { CL_POSITION_MANAGER_ABI } from "../trading/generated/abi.js";
import { LATCH_POSITION_LOCK_ABI } from "../launchpad/generated/abi.js";
import { feeSafeValue, type FeeGateTerms, type UtilityCall } from "../utilities/feeGate.js";
import { positionAmounts } from "./clAmounts.js";
import { findClLpLockerTokenIds, readClLpLockerPositions, type PermanentClPosition } from "./lpLockers.js";

/** `MAX_LOCK_SECONDS`: the longest lock accepted, from the block it is made in. */
export const POSITION_LOCK_MAX_SECONDS = 100n * 365n * 86_400n;

const CL_POOL_STATE_ABI = [
  {
    type: "function",
    name: "getSlot0",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
  {
    type: "function",
    name: "getLiquidity",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [{ name: "liquidity", type: "uint128" }],
  },
] as const;

/* ------------------------------------------------------------------ status --- */

/**
 * - `locked`: the NFT is held and `unlockAt` is in the future.
 * - `unlockable`: past `unlockAt`, still held; the lock owner may withdraw.
 * - `withdrawn`: the lock owner took the NFT back.
 */
export type PositionLockStatus = "locked" | "unlockable" | "withdrawn";

export interface PositionLockRecord {
  readonly lock: Address;
  readonly tokenId: bigint;
  readonly owner: Address;
  /** Offered the lock and not yet accepted, or `null`. */
  readonly pendingOwner: Address | null;
  /** Unix seconds. */
  readonly lockedAt: bigint;
  readonly unlockAt: bigint;
  readonly poolId: Hex;
  readonly currency0: Address;
  readonly currency1: Address;
  readonly withdrawn: boolean;
}

export function positionLockStatus(r: Pick<PositionLockRecord, "withdrawn" | "unlockAt">, nowSeconds: bigint): PositionLockStatus {
  if (r.withdrawn) return "withdrawn";
  return nowSeconds < r.unlockAt ? "locked" : "unlockable";
}

/** Seconds until `unlockAt` (0 once reached). */
export function secondsUntil(target: bigint, nowSeconds: bigint): bigint {
  return target > nowSeconds ? target - nowSeconds : 0n;
}

interface RawPositionLock {
  readonly owner: Address;
  readonly lockedAt: number | bigint;
  readonly unlockAt: number | bigint;
  readonly pendingOwner: Address;
  readonly poolId: Hex;
  readonly currency0: Address;
  readonly currency1: Address;
  readonly withdrawn: boolean;
}

/** `getLock(tokenId)` → a record, or `null` when the position was never locked here. */
export function decodePositionLock(lock: Address, tokenId: bigint, raw: RawPositionLock): PositionLockRecord | null {
  if (raw.owner === zeroAddress) return null;
  return {
    lock,
    tokenId,
    owner: raw.owner,
    pendingOwner: raw.pendingOwner === zeroAddress ? null : raw.pendingOwner,
    lockedAt: BigInt(raw.lockedAt),
    unlockAt: BigInt(raw.unlockAt),
    poolId: raw.poolId,
    currency0: raw.currency0,
    currency1: raw.currency1,
    withdrawn: raw.withdrawn,
  };
}

/* ------------------------------------------------------------------- reads --- */

export interface PositionLockContext {
  readonly lock: Address;
  /** `positionManager()`: the one CLPositionManager this lock accepts NFTs from. */
  readonly positionManager: Address;
  /** `positionManager.clPoolManager()`. */
  readonly poolManager: Address;
}

export async function readPositionLockContext(client: PublicClient, lock: Address): Promise<PositionLockContext> {
  const positionManager = await client.readContract({ address: lock, abi: LATCH_POSITION_LOCK_ABI, functionName: "positionManager" });
  const poolManager = await client.readContract({ address: positionManager, abi: CL_POSITION_MANAGER_ABI, functionName: "clPoolManager" });
  return { lock, positionManager, poolManager };
}

export async function readPositionLock(client: PublicClient, lock: Address, tokenId: bigint): Promise<PositionLockRecord | null> {
  const raw = await client.readContract({ address: lock, abi: LATCH_POSITION_LOCK_ABI, functionName: "getLock", args: [tokenId] });
  return decodePositionLock(lock, tokenId, raw);
}

async function readAllPages(count: bigint, page: (start: bigint, end: bigint) => Promise<readonly bigint[]>, pageSize: bigint): Promise<bigint[]> {
  const out: bigint[] = [];
  for (let start = 0n; start < count; start += pageSize) {
    out.push(...(await page(start, start + pageSize)));
  }
  return out;
}

/**
 * Every token id ever locked (in lock order), or every one in `poolId`. The
 * contract's lists include withdrawn locks; `getLock` tells them apart.
 */
export async function readPositionLockIds(
  client: PublicClient,
  lock: Address,
  opts: { readonly poolId?: Hex; readonly pageSize?: bigint } = {},
): Promise<bigint[]> {
  const pageSize = opts.pageSize ?? 500n;
  if (opts.poolId !== undefined) {
    const poolId = opts.poolId;
    const count = await client.readContract({ address: lock, abi: LATCH_POSITION_LOCK_ABI, functionName: "poolLockCount", args: [poolId] });
    return readAllPages(
      count,
      (s, e) => client.readContract({ address: lock, abi: LATCH_POSITION_LOCK_ABI, functionName: "poolLockIds", args: [poolId, s, e] }),
      pageSize,
    );
  }
  const count = await client.readContract({ address: lock, abi: LATCH_POSITION_LOCK_ABI, functionName: "lockCount" });
  return readAllPages(count, (s, e) => client.readContract({ address: lock, abi: LATCH_POSITION_LOCK_ABI, functionName: "lockIds", args: [s, e] }), pageSize);
}

/** A lock with its position's range and liquidity (read from the position manager). */
export interface LockedPosition extends PositionLockRecord {
  readonly status: PositionLockStatus;
  /** `null` for a withdrawn lock: the NFT is no longer the lock's to describe. */
  readonly tickLower: number | null;
  readonly tickUpper: number | null;
  readonly liquidity: bigint | null;
  /** Token amounts at the pool's current price (rounded down), `null` when withdrawn or the pool was not read. */
  readonly amount0: bigint | null;
  readonly amount1: bigint | null;
  readonly inRange: boolean | null;
}

export interface CLPoolState {
  readonly poolId: Hex;
  readonly sqrtPriceX96: bigint;
  readonly tick: number;
  readonly lpFee: number;
  /** `getLiquidity(poolId)`: active liquidity at the current tick. */
  readonly activeLiquidity: bigint;
}

export async function readCLPoolState(client: PublicClient, poolManager: Address, poolId: Hex): Promise<CLPoolState> {
  const [slot0, activeLiquidity] = await Promise.all([
    client.readContract({ address: poolManager, abi: CL_POOL_STATE_ABI, functionName: "getSlot0", args: [poolId] }),
    client.readContract({ address: poolManager, abi: CL_POOL_STATE_ABI, functionName: "getLiquidity", args: [poolId] }),
  ]);
  // An uninitialized id reads as zeros on the CL manager (a Bin pool id, say): no state, not a zero price.
  if (slot0[0] === 0n) throw new Error(`pool ${poolId} is not initialized on this CL pool manager`);
  return { poolId, sqrtPriceX96: slot0[0], tick: Number(slot0[1]), lpFee: Number(slot0[3]), activeLiquidity };
}

export interface PoolLockSummary {
  readonly poolId: Hex;
  readonly currency0: Address;
  readonly currency1: Address;
  /** `null` when the pool's state could not be read (e.g. not initialized on this manager). */
  readonly pool: CLPoolState | null;
  readonly locks: readonly LockedPosition[];
  /** Locks not withdrawn (locked or unlockable). */
  readonly liveCount: number;
  /** TIME locks still before their `unlockAt`. */
  readonly lockedCount: number;
  /**
   * In-range liquidity that cannot leave now: time-locked positions before
   * `unlockAt` PLUS positions held permanently by the protocol's CL LP locker.
   */
  readonly lockedActiveLiquidity: bigint;
  /**
   * `lockedActiveLiquidity / pool.activeLiquidity` in basis points (floor), or
   * `null` when the pool has no active liquidity or was not read. See the module
   * header for exactly what it measures. Split below into its two sources.
   */
  readonly lockedActiveBps: number | null;
  /** Token amounts of every position that cannot leave now (both sources), at the current price. */
  readonly lockedAmount0: bigint;
  readonly lockedAmount1: bigint;
  /** Time-locked (before `unlockAt`) positions whose range does not contain the current tick. */
  readonly outOfRangeLocked: number;
  /** Time locks only (`LatchPositionLock`, "time-locked until <date>"). */
  readonly timeLockedActiveLiquidity: bigint;
  readonly timeLockedActiveBps: number | null;
  readonly timeLockedAmount0: bigint;
  readonly timeLockedAmount1: bigint;
  /** Positions held forever by `LatchLPLocker` ("locked permanently (LP locker)"). */
  readonly permanent: readonly PermanentClPosition[];
  readonly permanentActiveLiquidity: bigint;
  readonly permanentActiveBps: number | null;
  readonly permanentAmount0: bigint;
  readonly permanentAmount1: bigint;
  readonly permanentOutOfRange: number;
  /** Earliest / latest `unlockAt` among locks still before it; `null` when none. */
  readonly nextUnlockAt: bigint | null;
  readonly lastUnlockAt: bigint | null;
}

/** Unix seconds of the latest block: the clock `unlockAt` is compared against. */
export async function readChainNow(client: PublicClient): Promise<bigint> {
  const b = await client.getBlock({ blockTag: "latest" });
  return b.timestamp;
}

async function describeLocks(
  client: PublicClient,
  ctx: PositionLockContext,
  records: readonly PositionLockRecord[],
  now: bigint,
  pools: Map<string, CLPoolState | null>,
): Promise<LockedPosition[]> {
  return Promise.all(
    records.map(async (r): Promise<LockedPosition> => {
      const status = positionLockStatus(r, now);
      if (status === "withdrawn") {
        return { ...r, status, tickLower: null, tickUpper: null, liquidity: null, amount0: null, amount1: null, inRange: null };
      }
      const p = await client.readContract({ address: ctx.positionManager, abi: CL_POSITION_MANAGER_ABI, functionName: "positions", args: [r.tokenId] });
      const tickLower = Number(p[1]);
      const tickUpper = Number(p[2]);
      const liquidity = p[3];
      const pool = pools.get(r.poolId.toLowerCase()) ?? null;
      if (pool === null) return { ...r, status, tickLower, tickUpper, liquidity, amount0: null, amount1: null, inRange: null };
      const a = positionAmounts({ liquidity, tickLower, tickUpper, tick: pool.tick, sqrtPriceX96: pool.sqrtPriceX96 });
      return { ...r, status, tickLower, tickUpper, liquidity, amount0: a.amount0, amount1: a.amount1, inRange: a.inRange };
    }),
  );
}

/** Pure: the per-pool figures from its described locks. */
export function summarizePoolLocks(args: {
  readonly poolId: Hex;
  readonly currency0: Address;
  readonly currency1: Address;
  readonly pool: CLPoolState | null;
  readonly locks: readonly LockedPosition[];
  /** Positions the protocol's CL LP locker holds in this pool (permanent). */
  readonly permanent?: readonly PermanentClPosition[];
}): PoolLockSummary {
  let liveCount = 0;
  let lockedCount = 0;
  let lockedActiveLiquidity = 0n;
  let lockedAmount0 = 0n;
  let lockedAmount1 = 0n;
  let outOfRangeLocked = 0;
  let nextUnlockAt: bigint | null = null;
  let lastUnlockAt: bigint | null = null;
  for (const l of args.locks) {
    if (l.status === "withdrawn") continue;
    liveCount += 1;
    if (l.status !== "locked") continue;
    lockedCount += 1;
    if (nextUnlockAt === null || l.unlockAt < nextUnlockAt) nextUnlockAt = l.unlockAt;
    if (lastUnlockAt === null || l.unlockAt > lastUnlockAt) lastUnlockAt = l.unlockAt;
    lockedAmount0 += l.amount0 ?? 0n;
    lockedAmount1 += l.amount1 ?? 0n;
    if (l.inRange === true && l.liquidity !== null) lockedActiveLiquidity += l.liquidity;
    else if (l.inRange === false) outOfRangeLocked += 1;
  }
  const permanent = args.permanent ?? [];
  let permanentActiveLiquidity = 0n;
  let permanentAmount0 = 0n;
  let permanentAmount1 = 0n;
  let permanentOutOfRange = 0;
  for (const p of permanent) {
    permanentAmount0 += p.amount0 ?? 0n;
    permanentAmount1 += p.amount1 ?? 0n;
    if (p.inRange === true) permanentActiveLiquidity += p.liquidity;
    else if (p.inRange === false) permanentOutOfRange += 1;
  }
  const active = args.pool?.activeLiquidity ?? 0n;
  const bps = (v: bigint): number | null => (active === 0n ? null : Number((v * 10_000n) / active));
  return {
    timeLockedActiveLiquidity: lockedActiveLiquidity,
    timeLockedActiveBps: bps(lockedActiveLiquidity),
    timeLockedAmount0: lockedAmount0,
    timeLockedAmount1: lockedAmount1,
    permanent,
    permanentActiveLiquidity,
    permanentActiveBps: bps(permanentActiveLiquidity),
    permanentAmount0,
    permanentAmount1,
    permanentOutOfRange,
    poolId: args.poolId,
    currency0: args.currency0,
    currency1: args.currency1,
    pool: args.pool,
    locks: args.locks,
    liveCount,
    lockedCount,
    lockedActiveLiquidity: lockedActiveLiquidity + permanentActiveLiquidity,
    lockedActiveBps: bps(lockedActiveLiquidity + permanentActiveLiquidity),
    lockedAmount0: lockedAmount0 + permanentAmount0,
    lockedAmount1: lockedAmount1 + permanentAmount1,
    outOfRangeLocked,
    nextUnlockAt,
    lastUnlockAt,
  };
}

async function readRecords(client: PublicClient, lock: Address, ids: readonly bigint[]): Promise<PositionLockRecord[]> {
  const recs = await Promise.all(ids.map((id) => readPositionLock(client, lock, id)));
  return recs.filter((r): r is PositionLockRecord => r !== null);
}

async function readPools(client: PublicClient, poolManager: Address, poolIds: readonly Hex[]): Promise<Map<string, CLPoolState | null>> {
  const unique = [...new Set(poolIds.map((p) => p.toLowerCase()))] as Hex[];
  const states = await Promise.all(unique.map((id) => readCLPoolState(client, poolManager, id).catch(() => null)));
  return new Map(unique.map((id, i) => [id, states[i] ?? null]));
}

/** Every lock in one pool, with the pool's state and the locked share of its active liquidity. */
export async function readPoolLocks(
  client: PublicClient,
  lock: Address,
  poolId: Hex,
  opts: {
    readonly context?: PositionLockContext;
    readonly now?: bigint;
    /**
     * The protocol's CL LP locker. Its positions in the pool are counted as
     * permanent: pass their token ids (`lpLockerTokenIds`) when you have them
     * (e.g. from the kit's `LaunchLegCreated` logs or a windowed
     * `findClLpLockerTokenIds`), else give `lpLockerLogRange` and one
     * `PositionLocked` scan is made over it.
     */
    readonly lpLocker?: Address | null;
    readonly lpLockerTokenIds?: readonly bigint[];
    readonly lpLockerLogRange?: { readonly fromBlock: bigint; readonly toBlock: bigint };
  } = {},
): Promise<PoolLockSummary & { readonly now: bigint }> {
  const ctx = opts.context ?? (await readPositionLockContext(client, lock));
  const [ids, now] = await Promise.all([readPositionLockIds(client, lock, { poolId }), opts.now ?? readChainNow(client)]);
  const records = await readRecords(client, lock, ids);
  const pools = await readPools(client, ctx.poolManager, [poolId]);
  const locks = await describeLocks(client, ctx, records, now, pools);
  const first = records[0];
  const pool = pools.get(poolId.toLowerCase()) ?? null;
  let permanent: PermanentClPosition[] = [];
  if (opts.lpLocker) {
    const ids =
      opts.lpLockerTokenIds ??
      (opts.lpLockerLogRange ? (await findClLpLockerTokenIds(client, opts.lpLocker, opts.lpLockerLogRange, poolId)).map((x) => x.tokenId) : []);
    permanent = (await readClLpLockerPositions(client, opts.lpLocker, ids, pools)).filter((p) => p.poolId.toLowerCase() === poolId.toLowerCase());
  }
  const c0 = first?.currency0 ?? permanent[0]?.currency0 ?? zeroAddress;
  const c1 = first?.currency1 ?? permanent[0]?.currency1 ?? zeroAddress;
  return {
    ...summarizePoolLocks({ poolId, currency0: c0, currency1: c1, pool, locks, permanent }),
    now,
  };
}

/**
 * The explorer: every pool with at least one lock, each summarised. Reads
 * every lock record (paged) and every live position once. `maxLocks` bounds
 * the read on a very large lock contract; the result says when it was hit.
 */
export async function readPositionLockDirectory(
  client: PublicClient,
  lock: Address,
  opts: {
    readonly context?: PositionLockContext;
    readonly now?: bigint;
    readonly maxLocks?: number;
    /** The protocol's CL LP locker and the token ids it holds (from a windowed `findClLpLockerTokenIds`): their pools join the directory as permanent locks. */
    readonly lpLocker?: Address | null;
    readonly lpLockerTokenIds?: readonly bigint[];
  } = {},
): Promise<{ readonly pools: readonly PoolLockSummary[]; readonly totalLocks: number; readonly truncated: boolean; readonly now: bigint; readonly permanentPositions: number }> {
  const ctx = opts.context ?? (await readPositionLockContext(client, lock));
  const [allIds, now] = await Promise.all([readPositionLockIds(client, lock), opts.now ?? readChainNow(client)]);
  const max = opts.maxLocks ?? 2_000;
  const ids = allIds.length > max ? allIds.slice(allIds.length - max) : allIds;
  const records = await readRecords(client, lock, ids);
  // Permanent positions first (without prices), so their pools are read with the rest.
  const bare = opts.lpLocker && opts.lpLockerTokenIds && opts.lpLockerTokenIds.length > 0 ? await readClLpLockerPositions(client, opts.lpLocker, opts.lpLockerTokenIds) : [];
  const pools = await readPools(client, ctx.poolManager, [...records.filter((r) => !r.withdrawn).map((r) => r.poolId), ...bare.map((p) => p.poolId)]);
  const permanent = bare.map((p) => {
    const pool = pools.get(p.poolId.toLowerCase()) ?? null;
    if (pool === null) return p;
    const a = positionAmounts({ liquidity: p.liquidity, tickLower: p.tickLower, tickUpper: p.tickUpper, tick: pool.tick, sqrtPriceX96: pool.sqrtPriceX96 });
    return { ...p, amount0: a.amount0, amount1: a.amount1, inRange: a.inRange };
  });
  const locks = await describeLocks(client, ctx, records, now, pools);
  const byPool = new Map<string, { locks: LockedPosition[]; permanent: PermanentClPosition[]; poolId: Hex; c0: Address; c1: Address }>();
  const slot = (poolId: Hex, c0: Address, c1: Address) => {
    const k = poolId.toLowerCase();
    let e = byPool.get(k);
    if (!e) byPool.set(k, (e = { locks: [], permanent: [], poolId, c0, c1 }));
    return e;
  };
  for (const l of locks) slot(l.poolId, l.currency0, l.currency1).locks.push(l);
  for (const p of permanent) slot(p.poolId, p.currency0, p.currency1).permanent.push(p);
  const out: PoolLockSummary[] = [];
  for (const e of byPool.values()) {
    out.push(summarizePoolLocks({ poolId: e.poolId, currency0: e.c0, currency1: e.c1, pool: pools.get(e.poolId.toLowerCase()) ?? null, locks: e.locks, permanent: e.permanent }));
  }
  return { pools: out, totalLocks: allIds.length, truncated: allIds.length > ids.length, now, permanentPositions: permanent.length };
}

/** Every lock (any pool) whose CURRENT lock owner or pending owner is `account`. */
export async function readPositionLocksOf(
  client: PublicClient,
  lock: Address,
  account: Address,
  opts: { readonly maxLocks?: number } = {},
): Promise<PositionLockRecord[]> {
  const ids = await readPositionLockIds(client, lock);
  const max = opts.maxLocks ?? 2_000;
  const records = await readRecords(client, lock, ids.length > max ? ids.slice(ids.length - max) : ids);
  const a = account.toLowerCase();
  return records.filter((r) => r.owner.toLowerCase() === a || r.pendingOwner?.toLowerCase() === a);
}

/* ------------------------------------------------------------------ builds --- */

export interface PositionLockIssue {
  readonly field: "unlockAt" | "owner" | "tokenId";
  readonly message: string;
}

/** The rules `lock` enforces on its arguments, checked before asking a wallet. */
export function validatePositionLock(args: { readonly unlockAt: bigint; readonly owner: string; readonly nowSeconds: bigint; readonly lock?: Address }): PositionLockIssue[] {
  const issues: PositionLockIssue[] = [];
  if (args.unlockAt <= args.nowSeconds) issues.push({ field: "unlockAt", message: "The unlock date must be in the future." });
  else if (args.unlockAt > args.nowSeconds + POSITION_LOCK_MAX_SECONDS) {
    issues.push({ field: "unlockAt", message: "A lock may last at most 100 years from now." });
  }
  if (args.unlockAt >= 2n ** 48n) issues.push({ field: "unlockAt", message: "The unlock date does not fit a uint48." });
  if (!isAddress(args.owner.trim(), { strict: false })) issues.push({ field: "owner", message: "The lock owner is not an address." });
  else {
    const o = args.owner.trim().toLowerCase();
    if (o === zeroAddress) issues.push({ field: "owner", message: "The lock owner cannot be the zero address." });
    if (args.lock !== undefined && o === args.lock.toLowerCase()) issues.push({ field: "owner", message: "The lock contract cannot own a lock." });
  }
  return issues;
}

/** `positionManager.approve(lock, tokenId)`: the step before `lock`. */
export function buildApprovePositionForLock(args: { readonly positionManager: Address; readonly lock: Address; readonly tokenId: bigint }): UtilityCall {
  return {
    to: args.positionManager,
    data: encodeFunctionData({ abi: CL_POSITION_MANAGER_ABI, functionName: "approve", args: [args.lock, args.tokenId] }),
    value: 0n,
  };
}

/** Whether `lock` may already move `tokenId` for `owner` (approved for the token, or for all). */
export async function readPositionApproval(client: PublicClient, args: { readonly positionManager: Address; readonly lock: Address; readonly tokenId: bigint; readonly owner: Address }): Promise<boolean> {
  const [approved, forAll] = await Promise.all([
    client.readContract({ address: args.positionManager, abi: CL_POSITION_MANAGER_ABI, functionName: "getApproved", args: [args.tokenId] }),
    client.readContract({ address: args.positionManager, abi: CL_POSITION_MANAGER_ABI, functionName: "isApprovedForAll", args: [args.owner, args.lock] }),
  ]);
  return forAll || approved.toLowerCase() === args.lock.toLowerCase();
}

/** `lock(tokenId, unlockAt, owner)` with the fee's safe value (the surplus is refunded in the same call). */
export function buildLockPosition(args: {
  readonly lock: Address;
  readonly tokenId: bigint;
  readonly unlockAt: bigint;
  readonly owner: Address;
  readonly terms: Pick<FeeGateTerms, "feeWei" | "pendingFee">;
}): UtilityCall {
  return {
    to: args.lock,
    data: encodeFunctionData({ abi: LATCH_POSITION_LOCK_ABI, functionName: "lock", args: [args.tokenId, Number(args.unlockAt), getAddress(args.owner)] }),
    value: feeSafeValue(args.terms),
  };
}

export function buildExtendPositionLock(args: { readonly lock: Address; readonly tokenId: bigint; readonly newUnlockAt: bigint }): UtilityCall {
  return {
    to: args.lock,
    data: encodeFunctionData({ abi: LATCH_POSITION_LOCK_ABI, functionName: "extend", args: [args.tokenId, Number(args.newUnlockAt)] }),
    value: 0n,
  };
}

/** Permissionless; the fees always go to the lock owner. */
export function buildCollectLockedFees(args: { readonly lock: Address; readonly tokenId: bigint }): UtilityCall {
  return { to: args.lock, data: encodeFunctionData({ abi: LATCH_POSITION_LOCK_ABI, functionName: "collectFees", args: [args.tokenId] }), value: 0n };
}

export function buildWithdrawPosition(args: { readonly lock: Address; readonly tokenId: bigint; readonly to: Address }): UtilityCall {
  return {
    to: args.lock,
    data: encodeFunctionData({ abi: LATCH_POSITION_LOCK_ABI, functionName: "withdraw", args: [args.tokenId, getAddress(args.to)] }),
    value: 0n,
  };
}

/** Offer the lock to `newOwner` (zero withdraws a pending offer). */
export function buildTransferLockOwner(args: { readonly lock: Address; readonly tokenId: bigint; readonly newOwner: Address }): UtilityCall {
  return {
    to: args.lock,
    data: encodeFunctionData({ abi: LATCH_POSITION_LOCK_ABI, functionName: "transferLockOwner", args: [args.tokenId, getAddress(args.newOwner)] }),
    value: 0n,
  };
}

export function buildAcceptLockOwner(args: { readonly lock: Address; readonly tokenId: bigint }): UtilityCall {
  return { to: args.lock, data: encodeFunctionData({ abi: LATCH_POSITION_LOCK_ABI, functionName: "acceptLockOwner", args: [args.tokenId] }), value: 0n };
}
