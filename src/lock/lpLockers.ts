// SPDX-License-Identifier: MIT
/**
 * Liquidity held PERMANENTLY by the protocol's LP lockers: `LatchLPLocker`
 * (CL position NFTs) and `LatchBinLPLocker` (Bin shares). Every Kit v2 launch
 * seeds its pools into them. Neither contract has any withdraw path: a
 * position or a share that enters is never removed (only its fees are
 * harvested). So these read as "locked permanently (LP locker)", distinct from
 * `LatchPositionLock`'s "time-locked until <date>".
 *
 * DISCOVERY.
 *   CL   The locker keys locks by position token id, which is not a sequence,
 *        so the positions in a pool are found from its `PositionLocked` logs
 *        (`poolId` is an indexed topic). `findClLpLockerTokenIds` scans ONE
 *        block range; a caller whose RPC caps log ranges windows it.
 *        `readClLpLockerPositions` then reads each record and the position.
 *   Bin  Lock ids are `1..lockCount`, so every lock is enumerable with no log
 *        scan; `readBinLpLockerLocks({ poolId })` keeps those of the pool.
 *
 * WHAT A BIN LOCK'S SHARE MEANS. A Bin pool has no single "active liquidity";
 * liquidity sits in discrete bins, each with its own shares. For every locked
 * bin the locked fraction is exact: locked shares / `getBin(...).totalShares`,
 * and the tokens it is worth are that fraction of the bin's reserves (floor).
 * The pool-level figure reported is the locked fraction of the ACTIVE bin (the
 * one that trades at the current price), the Bin analogue of CL active
 * liquidity. A pool-wide percentage across all bins is NOT computed: it would
 * need every bin of the pool, and a sum of shares across bins is not a common
 * unit. Amounts across locked bins are summed per token and are exact.
 */

import { getAbiItem, parseAbiItem, type Address, type Hex, type PublicClient } from "viem";

import { CL_POSITION_MANAGER_ABI } from "../trading/generated/abi.js";
import { LATCH_BIN_LP_LOCKER_ABI, LATCH_LP_LOCKER_ABI } from "../launchpad/generated/abi.js";
import { positionAmounts } from "./clAmounts.js";
import { readCLPoolState, type CLPoolState } from "./position.js";

const CL_POSITION_LOCKED = getAbiItem({ abi: LATCH_LP_LOCKER_ABI, name: "PositionLocked" });

const BIN_POOL_ABI = [
  parseAbiItem("function getSlot0(bytes32 id) view returns (uint24 activeId, uint24 protocolFee, uint24 lpFee)"),
  parseAbiItem("function getBin(bytes32 id, uint24 binId) view returns (uint128 binReserveX, uint128 binReserveY, uint256 binLiquidity, uint256 totalShares)"),
] as const;

/* --------------------------------------------------------------------- CL --- */

export interface PermanentClPosition {
  readonly kind: "cl-lp-locker";
  readonly locker: Address;
  readonly tokenId: bigint;
  readonly poolId: Hex;
  readonly currency0: Address;
  readonly currency1: Address;
  /** Receives the creator share of fees. Rotatable; it cannot withdraw. */
  readonly creator: Address;
  readonly lockedAt: bigint;
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly liquidity: bigint;
  /** At the pool's current price (rounded down); `null` when the pool state was not given. */
  readonly amount0: bigint | null;
  readonly amount1: bigint | null;
  readonly inRange: boolean | null;
}

/** Token ids the CL LP locker received for `poolId` (or for any pool when omitted) in one block range. */
export async function findClLpLockerTokenIds(
  client: PublicClient,
  locker: Address,
  range: { readonly fromBlock: bigint; readonly toBlock: bigint },
  poolId?: Hex,
): Promise<{ readonly tokenId: bigint; readonly poolId: Hex }[]> {
  const logs = await client.getLogs({
    address: locker,
    event: CL_POSITION_LOCKED,
    ...(poolId !== undefined ? { args: { poolId } } : {}),
    fromBlock: range.fromBlock,
    toBlock: range.toBlock,
  });
  const out: { tokenId: bigint; poolId: Hex }[] = [];
  for (const l of logs) {
    const tokenId = l.args.tokenId;
    const pid = l.args.poolId as Hex | undefined;
    if (tokenId === undefined || pid === undefined) continue;
    if (!out.some((o) => o.tokenId === tokenId)) out.push({ tokenId, poolId: pid });
  }
  return out;
}

/** The CL LP locker's record and position for each token id (non-locked ids are dropped). */
export async function readClLpLockerPositions(
  client: PublicClient,
  locker: Address,
  tokenIds: readonly bigint[],
  pools: ReadonlyMap<string, CLPoolState | null> = new Map(),
): Promise<PermanentClPosition[]> {
  if (tokenIds.length === 0) return [];
  const posm = await client.readContract({ address: locker, abi: LATCH_LP_LOCKER_ABI, functionName: "positionManager" });
  const rows = await Promise.all(
    tokenIds.map(async (tokenId): Promise<PermanentClPosition | null> => {
      const [locked, rec, p] = await Promise.all([
        client.readContract({ address: locker, abi: LATCH_LP_LOCKER_ABI, functionName: "isLocked", args: [tokenId] }),
        client.readContract({ address: locker, abi: LATCH_LP_LOCKER_ABI, functionName: "getLock", args: [tokenId] }),
        client.readContract({ address: posm, abi: CL_POSITION_MANAGER_ABI, functionName: "positions", args: [tokenId] }),
      ]);
      if (!locked) return null;
      const tickLower = Number(p[1]);
      const tickUpper = Number(p[2]);
      const liquidity = p[3];
      const poolId = rec.poolId as Hex;
      const pool = pools.get(poolId.toLowerCase()) ?? null;
      const a = pool === null ? null : positionAmounts({ liquidity, tickLower, tickUpper, tick: pool.tick, sqrtPriceX96: pool.sqrtPriceX96 });
      return {
        kind: "cl-lp-locker",
        locker,
        tokenId,
        poolId,
        currency0: rec.currency0 as Address,
        currency1: rec.currency1 as Address,
        creator: rec.creator,
        lockedAt: BigInt(rec.lockedAt),
        tickLower,
        tickUpper,
        liquidity,
        amount0: a?.amount0 ?? null,
        amount1: a?.amount1 ?? null,
        inRange: a?.inRange ?? null,
      };
    }),
  );
  return rows.filter((r): r is PermanentClPosition => r !== null);
}

/* -------------------------------------------------------------------- Bin --- */

export interface PermanentBinLockBin {
  readonly binId: number;
  /** Shares the lock holds in this bin now (fee harvests burn only growth above principal). */
  readonly shares: bigint;
  readonly totalShares: bigint;
  /** `shares / totalShares` in bps (floor); `null` when the bin has no shares. */
  readonly shareBps: number | null;
  readonly amountX: bigint;
  readonly amountY: bigint;
}

export interface PermanentBinLock {
  readonly kind: "bin-lp-locker";
  readonly locker: Address;
  readonly lockId: bigint;
  readonly poolId: Hex;
  /** currency0 / currency1 of the pool key (X / Y). */
  readonly currency0: Address;
  readonly currency1: Address;
  readonly creator: Address;
  readonly lockedAt: bigint;
  readonly bins: readonly PermanentBinLockBin[];
  /** Sum over the lock's bins of each bin's pro-rata reserves (floor per bin). */
  readonly amount0: bigint;
  readonly amount1: bigint;
}

export interface BinPoolPermanentSummary {
  readonly poolId: Hex;
  readonly activeId: number | null;
  readonly locks: readonly PermanentBinLock[];
  readonly amount0: bigint;
  readonly amount1: bigint;
  /** Locked shares of the ACTIVE bin / its total shares, bps; `null` when no lock holds the active bin or it has no shares. */
  readonly activeBinLockedBps: number | null;
}

/** Every Bin LP-locker lock, or those of one pool, with per-bin exact shares and amounts. */
export async function readBinLpLockerLocks(
  client: PublicClient,
  locker: Address,
  opts: { readonly poolId?: Hex; readonly maxLocks?: number } = {},
): Promise<{ readonly locks: readonly PermanentBinLock[]; readonly total: number; readonly truncated: boolean }> {
  const [count, poolManager] = await Promise.all([
    client.readContract({ address: locker, abi: LATCH_BIN_LP_LOCKER_ABI, functionName: "lockCount" }),
    client.readContract({ address: locker, abi: LATCH_BIN_LP_LOCKER_ABI, functionName: "binPoolManager" }),
  ]);
  const total = Number(count);
  const max = opts.maxLocks ?? 2_000;
  const first = total > max ? total - max + 1 : 1;
  const ids: bigint[] = [];
  for (let i = first; i <= total; i++) ids.push(BigInt(i));
  const recs = await Promise.all(ids.map((id) => client.readContract({ address: locker, abi: LATCH_BIN_LP_LOCKER_ABI, functionName: "getLock", args: [id] })));
  const want = opts.poolId?.toLowerCase();
  const picked = ids.map((id, i) => ({ id, rec: recs[i]! })).filter((x) => want === undefined || (x.rec.poolId as string).toLowerCase() === want);
  const locks = await Promise.all(
    picked.map(async ({ id, rec }): Promise<PermanentBinLock> => {
      const [key, bins] = await Promise.all([
        client.readContract({ address: locker, abi: LATCH_BIN_LP_LOCKER_ABI, functionName: "getPoolKey", args: [id] }),
        client.readContract({ address: locker, abi: LATCH_BIN_LP_LOCKER_ABI, functionName: "getLockedBins", args: [id] }),
      ]);
      const [binIds, shares] = bins;
      const poolId = rec.poolId as Hex;
      const states = await Promise.all(binIds.map((b) => client.readContract({ address: poolManager, abi: BIN_POOL_ABI, functionName: "getBin", args: [poolId, Number(b)] })));
      let amount0 = 0n;
      let amount1 = 0n;
      const out: PermanentBinLockBin[] = binIds.map((b, i) => {
        const [rx, ry, , ts] = states[i]!;
        const s = shares[i] ?? 0n;
        const x = ts === 0n ? 0n : (BigInt(rx) * s) / ts;
        const y = ts === 0n ? 0n : (BigInt(ry) * s) / ts;
        amount0 += x;
        amount1 += y;
        return { binId: Number(b), shares: s, totalShares: ts, shareBps: ts === 0n ? null : Number((s * 10_000n) / ts), amountX: x, amountY: y };
      });
      return {
        kind: "bin-lp-locker",
        locker,
        lockId: id,
        poolId,
        currency0: key.currency0 as Address,
        currency1: key.currency1 as Address,
        creator: rec.creator,
        lockedAt: BigInt(rec.lockedAt),
        bins: out,
        amount0,
        amount1,
      };
    }),
  );
  return { locks, total, truncated: first > 1 };
}

/** Pure: a Bin pool's permanent summary from its locks and its active bin. */
export function summarizeBinPermanent(poolId: Hex, locks: readonly PermanentBinLock[], active: { readonly activeId: number; readonly totalShares: bigint } | null): BinPoolPermanentSummary {
  let amount0 = 0n;
  let amount1 = 0n;
  let activeShares = 0n;
  for (const l of locks) {
    amount0 += l.amount0;
    amount1 += l.amount1;
    for (const b of l.bins) if (active !== null && b.binId === active.activeId) activeShares += b.shares;
  }
  const activeBinLockedBps = active === null || active.totalShares === 0n || activeShares === 0n ? null : Number((activeShares * 10_000n) / active.totalShares);
  return { poolId, activeId: active?.activeId ?? null, locks, amount0, amount1, activeBinLockedBps };
}

/** One Bin pool's permanent locks, its active bin, and the locked fraction of that bin. */
export async function readBinPoolPermanent(client: PublicClient, locker: Address, poolId: Hex): Promise<BinPoolPermanentSummary> {
  const { locks } = await readBinLpLockerLocks(client, locker, { poolId });
  const poolManager = await client.readContract({ address: locker, abi: LATCH_BIN_LP_LOCKER_ABI, functionName: "binPoolManager" });
  const active = await client
    .readContract({ address: poolManager, abi: BIN_POOL_ABI, functionName: "getSlot0", args: [poolId] })
    .then(async ([activeId]) => {
      const [, , , ts] = await client.readContract({ address: poolManager, abi: BIN_POOL_ABI, functionName: "getBin", args: [poolId, Number(activeId)] });
      return { activeId: Number(activeId), totalShares: ts };
    })
    .catch(() => null);
  return summarizeBinPermanent(poolId, locks, active);
}

/* ------------------------------------------------------------ per token --- */

export interface TokenPermanentPool {
  readonly poolId: Hex;
  readonly kind: "cl-lp-locker" | "bin-lp-locker";
  /** The other currency of the pool. */
  readonly pairedWith: Address;
  /** How much of THIS token the locked liquidity is worth at the current price (CL) / in its bins (Bin). */
  readonly amount: bigint;
  readonly locks: number;
}

/**
 * Pure: how much of `token` the protocol's LP lockers hold permanently, per
 * pool. CL amounts need prices (positions read with pool states); a position
 * without them counts 0 and `unpriced` says how many were skipped.
 */
export function permanentTokenPools(
  token: Address,
  cl: readonly PermanentClPosition[],
  bin: readonly PermanentBinLock[],
): { readonly pools: readonly TokenPermanentPool[]; readonly total: bigint; readonly unpriced: number } {
  const t = token.toLowerCase();
  const by = new Map<string, { poolId: Hex; kind: TokenPermanentPool["kind"]; pairedWith: Address; amount: bigint; locks: number }>();
  let unpriced = 0;
  const add = (poolId: Hex, kind: TokenPermanentPool["kind"], c0: Address, c1: Address, a0: bigint | null, a1: bigint | null) => {
    const is0 = c0.toLowerCase() === t;
    if (!is0 && c1.toLowerCase() !== t) return;
    const amt = is0 ? a0 : a1;
    if (amt === null) unpriced += 1;
    const k = `${kind}:${poolId.toLowerCase()}`;
    const e = by.get(k) ?? { poolId, kind, pairedWith: is0 ? c1 : c0, amount: 0n, locks: 0 };
    e.amount += amt ?? 0n;
    e.locks += 1;
    by.set(k, e);
  };
  for (const p of cl) add(p.poolId, p.kind, p.currency0, p.currency1, p.amount0, p.amount1);
  for (const l of bin) add(l.poolId, l.kind, l.currency0, l.currency1, l.amount0, l.amount1);
  const pools = [...by.values()];
  return { pools, total: pools.reduce((s, p) => s + p.amount, 0n), unpriced };
}

/**
 * `readClLpLockerPositions` with prices: reads the locker's position manager,
 * its CL pool manager and each pool's state, so every position carries its
 * token amounts and whether it is in range.
 */
export async function readClLpLockerPositionsPriced(client: PublicClient, locker: Address, tokenIds: readonly bigint[]): Promise<PermanentClPosition[]> {
  const bare = await readClLpLockerPositions(client, locker, tokenIds);
  if (bare.length === 0) return bare;
  const posm = await client.readContract({ address: locker, abi: LATCH_LP_LOCKER_ABI, functionName: "positionManager" });
  const poolManager = await client.readContract({ address: posm, abi: CL_POSITION_MANAGER_ABI, functionName: "clPoolManager" });
  const ids = [...new Set(bare.map((p) => p.poolId.toLowerCase()))] as Hex[];
  const states = await Promise.all(ids.map((id) => readCLPoolState(client, poolManager, id).catch(() => null)));
  const pools = new Map<string, CLPoolState | null>(ids.map((id, i) => [id, states[i] ?? null]));
  return bare.map((p) => {
    const pool = pools.get(p.poolId.toLowerCase()) ?? null;
    if (pool === null) return p;
    const a = positionAmounts({ liquidity: p.liquidity, tickLower: p.tickLower, tickUpper: p.tickUpper, tick: pool.tick, sqrtPriceX96: pool.sqrtPriceX96 });
    return { ...p, amount0: a.amount0, amount1: a.amount1, inRange: a.inRange };
  });
}

/** One CL pool's permanent positions and its state, from the CL LP locker alone (no time-lock contract needed). */
export async function readClPoolPermanent(
  client: PublicClient,
  locker: Address,
  poolId: Hex,
  src: { readonly tokenIds?: readonly bigint[]; readonly logRange?: { readonly fromBlock: bigint; readonly toBlock: bigint } },
): Promise<{ readonly pool: CLPoolState | null; readonly permanent: readonly PermanentClPosition[] }> {
  const posm = await client.readContract({ address: locker, abi: LATCH_LP_LOCKER_ABI, functionName: "positionManager" });
  const poolManager = await client.readContract({ address: posm, abi: CL_POSITION_MANAGER_ABI, functionName: "clPoolManager" });
  const ids = src.tokenIds ?? (src.logRange ? (await findClLpLockerTokenIds(client, locker, src.logRange, poolId)).map((x) => x.tokenId) : []);
  const pool = await readCLPoolState(client, poolManager, poolId).catch(() => null);
  const pools = new Map<string, CLPoolState | null>([[poolId.toLowerCase(), pool]]);
  const permanent = (await readClLpLockerPositions(client, locker, ids, pools)).filter((p) => p.poolId.toLowerCase() === poolId.toLowerCase());
  return { pool, permanent };
}
