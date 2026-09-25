// SPDX-License-Identifier: MIT
/**
 * `readTokenTrust`: one token's trust facts from the Latch contracts, composed
 * from the SDK's existing readers.
 *
 *   launch        `LaunchpadKitV2.legsOf / getLaunch / getLeg` - is it a Kit v2 launch
 *   token locks   `readCurrencyLocks` on `LatchTokenLock`
 *   pools         found from the launch legs, the LP lockers' locks, the time
 *                 locks of `LatchPositionLock`, and any pools the caller names;
 *                 each described by:
 *     liquidity   `readPoolLocks` / `readClPoolPermanent` (CL), the Bin LP locker (Bin)
 *     LP fee      the launch guard's `currentFee(poolId)` on a guard pool; the
 *                 key's fee when static; "dynamic (hook-set)" otherwise
 *     protocol    the pool manager's `getSlot0` protocol fee, both directions
 *     creator tax `getTax` + `currentTaxRates` on the launch guard
 *     registry    `LatchRegistry.isRegistered / getLatch` for the pool's hook
 *
 * A contract that is not deployed (`null` in `contracts`) makes its section
 * `not-configured`; a read that fails makes it `error`; neither is ever filled
 * with a default. Only the first reads (block number, token metadata) throw,
 * so a chain that does not answer at all is an error, not an empty panel.
 */

import { BaseError, ContractFunctionRevertedError, ExecutionRevertedError, parseAbi, zeroAddress, type Address, type Hex, type PublicClient } from "viem";

import { BIN_LAUNCH_GUARD_HOOK_ABI, LAUNCHPAD_KIT_V2_ABI, LAUNCH_GUARD_HOOK_ABI } from "../launchpad/generated/abi.js";
import { readTokenMeta } from "../launchpad/kitV2/reads.js";
import { LATCH_HOOK_REGISTRY_ABI } from "../registry/generated/abi.js";
import { decodeLatchRecord, summarizeLatch, type RawLatchRecord } from "../registry/types.js";
import { decodeProtocolFee, isDynamicLPFee } from "../types/fee.js";
import { readBinLpLockerLocks, readClLpLockerPositions, summarizeBinPermanent, type PermanentBinLock } from "../lock/lpLockers.js";
import { readClPoolPermanent } from "../lock/lpLockers.js";
import { readPoolLocks, readPositionLock, readPositionLockIds, summarizePoolLocks, type PoolLockSummary } from "../lock/position.js";
import { readCurrencyLocks } from "../lock/token.js";
import type {
  CreatorTaxFacts,
  LaunchFacts,
  LpFeeFacts,
  PoolKind,
  PoolLiquidityFacts,
  PoolOrigin,
  PoolRegistryTrust,
  PoolTaxTrust,
  PoolTrust,
  PoolTrustFailure,
  ProtocolFeeFacts,
  TokenLockFacts,
  TokenTrust,
  TrustSection,
  TrustSource,
} from "./types.js";

/** The contracts `readTokenTrust` reads. `null` / omitted = not deployed on this chain. */
export interface TrustContracts {
  readonly clPoolManager: Address;
  readonly binPoolManager: Address;
  readonly launchpadKitV2?: Address | null;
  /** Launch guards. Read from the kit when it is given; these are the fallback. */
  readonly clLaunchGuardHook?: Address | null;
  readonly binLaunchGuardHook?: Address | null;
  readonly positionLock?: Address | null;
  readonly tokenLock?: Address | null;
  readonly clLpLocker?: Address | null;
  readonly binLpLocker?: Address | null;
  /** `LatchRegistry`, the HOOK registry (not `LatchLaunchRegistry`). */
  readonly registry?: Address | null;
}

export interface ReadTokenTrustOptions {
  readonly token: Address;
  readonly contracts: TrustContracts;
  /** Pools the caller knows the token trades in (e.g. from a pool directory). */
  readonly pools?: readonly { readonly poolId: Hex; readonly kind: PoolKind }[];
  /**
   * Position ids the CL LP locker holds (from its `PositionLocked` logs). The
   * launch legs' ids are always included; this adds any others, e.g. from a
   * windowed log scan the caller already made.
   */
  readonly lpLockerTokenIds?: readonly bigint[];
  /** Native currency display facts (for the zero address). Default ETH, 18. */
  readonly native?: { readonly symbol: string; readonly decimals: number };
  /** Newest position locks scanned for pools of this token. Default 500. */
  readonly maxPositionLocks?: number;
  /** Bin LP-locker locks scanned. Default 500. */
  readonly maxBinLocks?: number;
  /** Pools described. Default 12; the rest are counted as truncated. */
  readonly maxPools?: number;
}

const POOL_MANAGER_ABI = parseAbi([
  "function poolIdToPoolKey(bytes32 id) view returns (address currency0, address currency1, address hooks, address poolManager, uint24 fee, bytes32 parameters)",
]);
const CL_SLOT0_ABI = parseAbi(["function getSlot0(bytes32 id) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)"]);
const BIN_POOL_ABI = parseAbi([
  "function getSlot0(bytes32 id) view returns (uint24 activeId, uint24 protocolFee, uint24 lpFee)",
  "function getBin(bytes32 id, uint24 binId) view returns (uint128 binReserveX, uint128 binReserveY, uint256 binLiquidity, uint256 totalShares)",
]);

const lower = (a: string): string => a.toLowerCase();
const isZero = (a: string): boolean => /^0x0{40}$/i.test(a);

/** A contract-level revert (as opposed to a transport failure). */
export function isContractRevert(error: unknown): boolean {
  return (
    error instanceof BaseError &&
    error.walk((x: unknown) => x instanceof ExecutionRevertedError || x instanceof ContractFunctionRevertedError) !== null
  );
}

/** One short line for a failed read. */
export function trustErrorMessage(error: unknown): string {
  const base = error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : String(error);
  const line = (base.split("\n")[0] ?? "").trim();
  if (isContractRevert(error)) return `the contract refused the read (${line.slice(0, 140)})`;
  return line === "" ? "the read failed" : line.slice(0, 160);
}

async function section<T>(source: TrustSource | null, run: () => Promise<T>): Promise<TrustSection<T> & ({ status: "read" } | { status: "error" })> {
  try {
    const value = await run();
    return { status: "read", sources: source === null ? [] : [source], ...value } as TrustSection<T> & { status: "read" };
  } catch (error) {
    return { status: "error", message: trustErrorMessage(error), source };
  }
}

/* --------------------------------------------------------------- discovery --- */

interface Candidate {
  poolId: Hex;
  kind: PoolKind;
  origins: PoolOrigin[];
}

/**
 * Pure: merge pool candidates from several sources, one per pool id (the
 * first kind seen wins), origins unioned, order of first appearance kept.
 */
export function mergePoolCandidates(
  lists: readonly (readonly { readonly poolId: Hex; readonly kind: PoolKind; readonly origin: PoolOrigin }[])[],
): { poolId: Hex; kind: PoolKind; origins: PoolOrigin[] }[] {
  const by = new Map<string, Candidate>();
  for (const list of lists) {
    for (const c of list) {
      const k = lower(c.poolId);
      const e = by.get(k);
      if (e === undefined) by.set(k, { poolId: c.poolId, kind: c.kind, origins: [c.origin] });
      else if (!e.origins.includes(c.origin)) e.origins.push(c.origin);
    }
  }
  return [...by.values()];
}

/* -------------------------------------------------------------------- read --- */

export async function readTokenTrust(client: PublicClient, opts: ReadTokenTrustOptions): Promise<TokenTrust> {
  const c = opts.contracts;
  const token = opts.token;
  const native = isZero(token);
  const nativeMeta = opts.native ?? { symbol: "ETH", decimals: 18 };
  const maxPools = opts.maxPools ?? 12;

  const [fromBlock, latest, meta] = await Promise.all([
    client.getBlockNumber(),
    client.getBlock({ blockTag: "latest" }),
    native ? Promise.resolve(null) : readTokenMeta(client, token),
  ]);
  const chainNow = latest.timestamp;
  const symbol = native ? nativeMeta.symbol : (meta?.symbol ?? `${token.slice(0, 6)}…${token.slice(-4)}`);
  const decimals = native ? nativeMeta.decimals : (meta?.decimals ?? null);

  /* ---- launch (Kit v2) and its legs */
  const kit = c.launchpadKitV2 ?? null;
  let legs: { poolId: Hex; kind: PoolKind; lockId: bigint }[] = [];
  let clGuard: Address | null = c.clLaunchGuardHook ?? null;
  let binGuard: Address | null = c.binLaunchGuardHook ?? null;
  let launch: TrustSection<LaunchFacts>;
  if (kit === null) {
    launch = { status: "not-configured", reason: "Launches are coming soon on this chain" };
  } else {
    const src: TrustSource = { contract: "LaunchpadKitV2", address: kit, call: "legsOf, getLaunch, getLeg" };
    launch = await section<LaunchFacts>(src, async () => {
      const [poolIds, rec, kitCl, kitBin] = await Promise.all([
        client.readContract({ address: kit, abi: LAUNCHPAD_KIT_V2_ABI, functionName: "legsOf", args: [token] }),
        client.readContract({ address: kit, abi: LAUNCHPAD_KIT_V2_ABI, functionName: "getLaunch", args: [token] }),
        client.readContract({ address: kit, abi: LAUNCHPAD_KIT_V2_ABI, functionName: "clHook" }),
        client.readContract({ address: kit, abi: LAUNCHPAD_KIT_V2_ABI, functionName: "binHook" }),
      ]);
      clGuard = kitCl;
      binGuard = kitBin;
      if (poolIds.length === 0 || isZero(rec.creator)) return { launch: null };
      const legRecs = await Promise.all(poolIds.map((id) => client.readContract({ address: kit, abi: LAUNCHPAD_KIT_V2_ABI, functionName: "getLeg", args: [id] })));
      legs = poolIds.map((poolId, i) => ({ poolId, kind: Number(legRecs[i]!.kind) === 1 ? "Bin" : "CL", lockId: legRecs[i]!.lockId }));
      return {
        launch: {
          creator: rec.creator,
          tenant: rec.tenant,
          operator: rec.operator,
          integrator: rec.integrator,
          startTime: BigInt(rec.startTime),
          legCount: Number(rec.legCount),
        },
      };
    });
  }

  /* ---- token locks */
  const tokenLock = c.tokenLock ?? null;
  const tokenLocks: TrustSection<TokenLockFacts> =
    tokenLock === null
      ? { status: "not-configured", reason: "Token locks are coming soon on this chain" }
      : await section<TokenLockFacts>({ contract: "LatchTokenLock", address: tokenLock, call: "currencyLockIds, getLock, totalHeld; totalSupply" }, async () => {
          const s = await readCurrencyLocks(client, tokenLock, token, { now: chainNow });
          return {
            lockCount: s.locks.length,
            totalHeld: s.totalHeld,
            unvested: s.unvested,
            totalSupply: s.totalSupply,
            heldBps: s.heldBps,
            unvestedBps: s.unvestedBps,
            nextRelease: s.nextCliffOrEnd,
            lastEnd: s.lastEnd,
          };
        });

  /* ---- pool discovery */
  const searched: PoolOrigin[] = [];
  const clLpLocker = c.clLpLocker ?? null;
  const binLpLocker = c.binLpLocker ?? null;
  const positionLock = c.positionLock ?? null;
  const clLockerIds = [...new Set([...legs.filter((l) => l.kind === "CL").map((l) => l.lockId), ...(opts.lpLockerTokenIds ?? [])].map(String))].map(BigInt);

  const legCands = legs.map((l) => ({ poolId: l.poolId, kind: l.kind, origin: "launch-leg" as const }));
  if (kit !== null) searched.push("launch-leg");

  const [clLpCands, binLocks, posCands] = await Promise.all([
    clLpLocker !== null && clLockerIds.length > 0
      ? readClLpLockerPositions(client, clLpLocker, clLockerIds)
          .then((ps) => ps.filter((p) => lower(p.currency0) === lower(token) || lower(p.currency1) === lower(token)).map((p) => ({ poolId: p.poolId, kind: "CL" as const, origin: "lp-locker" as const })))
          .catch(() => [])
      : Promise.resolve([]),
    binLpLocker !== null ? readBinLpLockerLocks(client, binLpLocker, { maxLocks: opts.maxBinLocks ?? 500 }).catch(() => null) : Promise.resolve(null),
    positionLock !== null ? discoverPositionLockPools(client, positionLock, token, opts.maxPositionLocks ?? 500).catch(() => null) : Promise.resolve(null),
  ]);
  if (clLpLocker !== null || binLpLocker !== null) searched.push("lp-locker");
  if (positionLock !== null) searched.push("position-lock");
  const binCands = (binLocks?.locks ?? [])
    .filter((l) => lower(l.currency0) === lower(token) || lower(l.currency1) === lower(token))
    .map((l) => ({ poolId: l.poolId, kind: "Bin" as const, origin: "lp-locker" as const }));
  const given = (opts.pools ?? []).map((p) => ({ poolId: p.poolId, kind: p.kind, origin: "given" as const }));
  if (given.length > 0) searched.push("given");

  const all = mergePoolCandidates([legCands, given, clLpCands, binCands, posCands?.pools ?? []]);
  const picked = all.slice(0, maxPools);

  const guards = { cl: clGuard as Address | null, bin: binGuard as Address | null };
  const described = await Promise.all(
    picked.map((cand) =>
      describePool(client, cand, {
        token,
        chainNow,
        contracts: c,
        guards,
        clLockerIds,
        binLocks: binLocks?.locks ?? null,
      }),
    ),
  );
  const pools = described.filter((d): d is PoolTrust => "liquidity" in d);
  const failedPools = described.filter((d): d is PoolTrustFailure => !("liquidity" in d));

  const toBlock = await client.getBlockNumber().catch(() => fromBlock);
  return {
    token,
    native,
    symbol,
    decimals,
    readAt: { fromBlock, toBlock: toBlock < fromBlock ? fromBlock : toBlock, chainNow },
    launch,
    tokenLocks,
    pools,
    failedPools,
    discovery: { searched, truncated: all.length > picked.length, positionLocksTruncated: posCands?.truncated ?? false },
  };
}

async function discoverPositionLockPools(
  client: PublicClient,
  lock: Address,
  token: Address,
  max: number,
): Promise<{ pools: { poolId: Hex; kind: "CL"; origin: "position-lock" }[]; truncated: boolean }> {
  const ids = await readPositionLockIds(client, lock);
  const recent = ids.length > max ? ids.slice(ids.length - max) : ids;
  const recs = await Promise.all(recent.map((id) => readPositionLock(client, lock, id)));
  const pools = recs
    .filter((r) => r !== null && (lower(r.currency0) === lower(token) || lower(r.currency1) === lower(token)))
    .map((r) => ({ poolId: r!.poolId, kind: "CL" as const, origin: "position-lock" as const }));
  return { pools, truncated: ids.length > recent.length };
}

interface DescribeCtx {
  readonly token: Address;
  readonly chainNow: bigint;
  readonly contracts: TrustContracts;
  readonly guards: { readonly cl: Address | null; readonly bin: Address | null };
  readonly clLockerIds: readonly bigint[];
  readonly binLocks: readonly PermanentBinLock[] | null;
}

async function describePool(client: PublicClient, cand: Candidate, ctx: DescribeCtx): Promise<PoolTrust | PoolTrustFailure> {
  const c = ctx.contracts;
  const manager = cand.kind === "CL" ? c.clPoolManager : c.binPoolManager;
  const managerName = cand.kind === "CL" ? "CLPoolManager" : "BinPoolManager";
  let key: readonly [Address, Address, Address, Address, number, Hex];
  try {
    key = await client.readContract({ address: manager, abi: POOL_MANAGER_ABI, functionName: "poolIdToPoolKey", args: [cand.poolId] });
  } catch (error) {
    return { poolId: cand.poolId, kind: cand.kind, origins: cand.origins, message: `${managerName}.poolIdToPoolKey: ${trustErrorMessage(error)}` };
  }
  const [currency0, currency1, hooks, , keyFee] = key;
  if (isZero(key[3])) {
    return { poolId: cand.poolId, kind: cand.kind, origins: cand.origins, message: `${managerName} has no pool with this id` };
  }
  const guard = cand.kind === "CL" ? ctx.guards.cl : ctx.guards.bin;
  const launchGuard = guard !== null && !isZero(hooks) && lower(hooks) === lower(guard);
  const guardAbi = cand.kind === "CL" ? LAUNCH_GUARD_HOOK_ABI : BIN_LAUNCH_GUARD_HOOK_ABI;
  const guardName = cand.kind === "CL" ? "LaunchGuardHook" : "BinLaunchGuardHook";

  const slot0Src: TrustSource = { contract: managerName, address: manager, call: "getSlot0" };
  const [liquidity, slot0, lpFee, tax, registry] = await Promise.all([
    readLiquidity(client, cand, ctx),
    section<ProtocolFeeFacts & { lpFee: number }>(slot0Src, async () => {
      if (cand.kind === "CL") {
        const s = await client.readContract({ address: manager, abi: CL_SLOT0_ABI, functionName: "getSlot0", args: [cand.poolId] });
        const pf = decodeProtocolFee(Number(s[2]));
        return { zeroForOne: pf.zeroForOne, oneForZero: pf.oneForZero, lpFee: Number(s[3]) };
      }
      const s = await client.readContract({ address: manager, abi: BIN_POOL_ABI, functionName: "getSlot0", args: [cand.poolId] });
      const pf = decodeProtocolFee(Number(s[1]));
      return { zeroForOne: pf.zeroForOne, oneForZero: pf.oneForZero, lpFee: Number(s[2]) };
    }),
    readLpFee(client, cand.poolId, Number(keyFee), launchGuard ? { address: hooks, abi: guardAbi, name: guardName } : null, { contract: managerName, address: manager, call: "poolIdToPoolKey (fee)" }),
    launchGuard ? readTax(client, cand.poolId, { address: hooks, abi: guardAbi, name: guardName }) : Promise.resolve<PoolTaxTrust>({ status: "not-a-launch-pool" }),
    readRegistry(client, hooks, c.registry ?? null),
  ]);
  const protocolFee: TrustSection<ProtocolFeeFacts> =
    slot0.status === "read" ? { status: "read", sources: slot0.sources, zeroForOne: slot0.zeroForOne, oneForZero: slot0.oneForZero } : slot0;
  return {
    poolId: cand.poolId,
    kind: cand.kind,
    currency0,
    currency1,
    pairedWith: lower(currency0) === lower(ctx.token) ? currency1 : currency0,
    hooks,
    keyFee: Number(keyFee),
    poolManager: manager,
    origins: cand.origins,
    launchGuard,
    liquidity,
    lpFee,
    protocolFee,
    tax,
    registry,
  };
}

/** Pure: the liquidity facts of a CL pool from its lock summary. */
export function clLiquidityFacts(s: Pick<PoolLockSummary, "locks" | "lockedCount" | "lockedActiveBps" | "permanentActiveBps" | "timeLockedActiveBps" | "permanent" | "outOfRangeLocked" | "permanentOutOfRange" | "nextUnlockAt" | "lastUnlockAt" | "pool">): PoolLiquidityFacts {
  const unlockable = s.locks.filter((l) => l.status === "unlockable").length;
  return {
    lockedActiveBps: s.lockedActiveBps,
    permanentActiveBps: s.permanent.length > 0 ? s.permanentActiveBps : null,
    timeLockedActiveBps: s.lockedCount > 0 ? s.timeLockedActiveBps : null,
    timeLockedCount: s.lockedCount,
    unlockableCount: unlockable,
    permanentCount: s.permanent.length,
    outOfRange: s.outOfRangeLocked + s.permanentOutOfRange,
    nextUnlockAt: s.nextUnlockAt,
    lastUnlockAt: s.lastUnlockAt,
    measurable: s.pool !== null && s.pool.activeLiquidity > 0n,
  };
}

async function readLiquidity(client: PublicClient, cand: Candidate, ctx: DescribeCtx): Promise<TrustSection<PoolLiquidityFacts>> {
  const c = ctx.contracts;
  if (cand.kind === "Bin") {
    const locker = c.binLpLocker ?? null;
    if (locker === null) return { status: "not-configured", reason: "No Bin LP locker is deployed on this chain (time locks cover CL positions only)" };
    return section<PoolLiquidityFacts>({ contract: "LatchBinLPLocker", address: locker, call: "lockCount, getLock, getLockedBins; BinPoolManager.getSlot0, getBin" }, async () => {
      const locks = (ctx.binLocks ?? (await readBinLpLockerLocks(client, locker)).locks).filter((l) => lower(l.poolId) === lower(cand.poolId));
      const active = await client
        .readContract({ address: c.binPoolManager, abi: BIN_POOL_ABI, functionName: "getSlot0", args: [cand.poolId] })
        .then(async ([activeId]) => {
          const bin = await client.readContract({ address: c.binPoolManager, abi: BIN_POOL_ABI, functionName: "getBin", args: [cand.poolId, Number(activeId)] });
          return { activeId: Number(activeId), totalShares: bin[3] };
        })
        .catch(() => null);
      const b = summarizeBinPermanent(cand.poolId, locks, active);
      return {
        lockedActiveBps: b.activeBinLockedBps,
        permanentActiveBps: b.activeBinLockedBps,
        timeLockedActiveBps: null,
        timeLockedCount: 0,
        unlockableCount: 0,
        permanentCount: b.locks.length,
        outOfRange: 0,
        nextUnlockAt: null,
        lastUnlockAt: null,
        measurable: active !== null && active.totalShares > 0n,
      };
    });
  }
  const positionLock = c.positionLock ?? null;
  const lpLocker = c.clLpLocker ?? null;
  if (positionLock === null && lpLocker === null) {
    return { status: "not-configured", reason: "Neither LatchPositionLock nor the CL LP locker is deployed on this chain" };
  }
  const sources: TrustSource[] = [];
  if (positionLock !== null) sources.push({ contract: "LatchPositionLock", address: positionLock, call: "poolLockIds, getLock; positions; getSlot0, getLiquidity" });
  if (lpLocker !== null) sources.push({ contract: "LatchLPLocker", address: lpLocker, call: "isLocked, getLock (launch-leg and scanned position ids)" });
  try {
    let s: PoolLockSummary;
    if (positionLock !== null) {
      s = await readPoolLocks(client, positionLock, cand.poolId, { now: ctx.chainNow, lpLocker, lpLockerTokenIds: ctx.clLockerIds });
    } else {
      const perm = await readClPoolPermanent(client, lpLocker as Address, cand.poolId, { tokenIds: ctx.clLockerIds });
      const f = perm.permanent[0];
      s = summarizePoolLocks({ poolId: cand.poolId, currency0: f?.currency0 ?? zeroAddress, currency1: f?.currency1 ?? zeroAddress, pool: perm.pool, locks: [], permanent: perm.permanent });
    }
    return { status: "read", sources, ...clLiquidityFacts(s) };
  } catch (error) {
    return { status: "error", message: trustErrorMessage(error), source: sources[0] ?? null };
  }
}

type GuardRef = { readonly address: Address; readonly abi: typeof LAUNCH_GUARD_HOOK_ABI | typeof BIN_LAUNCH_GUARD_HOOK_ABI; readonly name: string };

async function readLpFee(client: PublicClient, poolId: Hex, keyFee: number, guard: GuardRef | null, keySource: TrustSource): Promise<PoolTrust["lpFee"]> {
  if (guard !== null) {
    const source: TrustSource = { contract: guard.name, address: guard.address, call: "currentFee" };
    try {
      const pips = await client.readContract({ address: guard.address, abi: guard.abi as typeof LAUNCH_GUARD_HOOK_ABI, functionName: "currentFee", args: [poolId] });
      return { kind: "launch-guard", pips: Number(pips), source } satisfies LpFeeFacts;
    } catch (error) {
      if (isContractRevert(error)) return { kind: "dynamic", reason: "the launch guard's currentFee reverted for this pool", source };
      return { kind: "error", message: trustErrorMessage(error) };
    }
  }
  if (isDynamicLPFee(keyFee)) return { kind: "dynamic", reason: "the pool key's fee is the dynamic-fee flag: the hook sets the fee per swap", source: keySource };
  return { kind: "static", pips: keyFee, source: keySource };
}

async function readTax(client: PublicClient, poolId: Hex, guard: GuardRef): Promise<PoolTaxTrust> {
  return section<CreatorTaxFacts>({ contract: guard.name, address: guard.address, call: "getTax, currentTaxRates" }, async () => {
    const abi = guard.abi as typeof LAUNCH_GUARD_HOOK_ABI;
    const [t, rates] = await Promise.all([
      client.readContract({ address: guard.address, abi, functionName: "getTax", args: [poolId] }),
      client.readContract({ address: guard.address, abi, functionName: "currentTaxRates", args: [poolId] }),
    ]);
    const none = Number(t.expiresAt) === 0;
    return {
      tax: none
        ? null
        : {
            buyBps: Number(t.buyBps),
            sellBps: Number(t.sellBps),
            expiresAt: BigInt(t.expiresAt),
            creator: t.creator,
            integrator: t.integrator,
            creatorBps: Number(t.creatorBps),
            protocolBps: Number(t.protocolBps),
            integratorBps: Number(t.integratorBps),
          },
      buyBpsNow: Number(rates[0]),
      sellBpsNow: Number(rates[1]),
    };
  });
}

async function readRegistry(client: PublicClient, hook: Address, registry: Address | null): Promise<PoolRegistryTrust> {
  if (isZero(hook)) return { status: "no-hook" };
  if (registry === null) return { status: "not-configured", reason: "The Latch Marketplace is coming soon on this chain" };
  const source: TrustSource = { contract: "LatchRegistry", address: registry, call: "isRegistered, getLatch" };
  return section(source, async () => {
    const listed = await client.readContract({ address: registry, abi: LATCH_HOOK_REGISTRY_ABI, functionName: "isRegistered", args: [hook] });
    if (!listed) {
      return { listed: false, name: null, listing: null, verification: null, riskClass: null, permissionSource: null, attestationCount: 0, flagged: false, warnings: [] };
    }
    const raw = await client.readContract({ address: registry, abi: LATCH_HOOK_REGISTRY_ABI, functionName: "getLatch", args: [hook] });
    const summary = summarizeLatch(decodeLatchRecord(hook, raw as unknown as RawLatchRecord));
    const name = (raw as unknown as RawLatchRecord).metadata.name;
    return {
      listed: true,
      name: name === "" ? null : name,
      listing: summary.listing,
      verification: summary.verification,
      riskClass: summary.riskClass,
      permissionSource: summary.permissionSource,
      attestationCount: summary.attestationCount,
      flagged: summary.listing === "Malicious",
      warnings: summary.warnings,
    };
  });
}
