// SPDX-License-Identifier: MIT
/**
 * `LatchTokenLock`: ERC-20 / native time-locks and vesting.
 *
 * A lock holds `amount` of one currency for a beneficiary and releases it on a
 * schedule fixed at creation: nothing before `cliff`, then linearly from
 * `start` to `end` (a plain time-lock is `start == cliff == end`). No key can
 * shorten, revoke or redirect it. The beneficiary claims to any address and
 * rotates two-step.
 *
 *   vested(t) = 0                                  if t < cliff
 *             = amount                             if t >= end
 *             = floor(amount * (t - start) / (end - start))   otherwise
 *
 * `vestedAt` here is that formula, bit for bit, so a UI can draw the schedule
 * without a read per point; `claimable` on chain stays the authority.
 *
 * "% OF SUPPLY LOCKED" is computed two ways, and both are labelled:
 *   - `heldBps`: `totalHeld(currency)` / `totalSupply()`: what the contract
 *     still holds for locks, vested-but-unclaimed included;
 *   - `unvestedBps`: sum of (amount - vested(now)) / `totalSupply()`: what no
 *     beneficiary can take yet.
 * Native has no `totalSupply`, so both are `null` for it.
 *
 * Independently authored against the compiled ABI and the documented rules of
 * `packages/launchpad/src/lock/LatchTokenLock.sol`.
 */

import { encodeFunctionData, getAddress, isAddress, zeroAddress, type Address, type PublicClient } from "viem";

import { LATCH_TOKEN_LOCK_ABI } from "../launchpad/generated/abi.js";
import { feeSafeValue, isNative, type FeeGateTerms, type UtilityCall } from "../utilities/feeGate.js";
import { readChainNow } from "./position.js";

/** `MAX_LOCK_SECONDS`: `end` at most this far after the block the lock is made in. */
export const TOKEN_LOCK_MAX_SECONDS = 100n * 365n * 86_400n;

/* ---------------------------------------------------------------- schedule --- */

export interface VestingSchedule {
  /** Unix seconds. `start <= cliff <= end`. */
  readonly start: bigint;
  readonly cliff: bigint;
  readonly end: bigint;
}

/** A plain time-lock: everything at `unlockAt`. */
export function timeLockSchedule(unlockAt: bigint): VestingSchedule {
  return { start: unlockAt, cliff: unlockAt, end: unlockAt };
}

/**
 * Cliff + linear: vesting accrues from `start`, nothing is claimable before
 * `start + cliffSeconds`, everything is vested at `start + durationSeconds`.
 * `cliffSeconds = 0` is plain linear vesting.
 */
export function cliffLinearSchedule(args: { readonly start: bigint; readonly cliffSeconds: bigint; readonly durationSeconds: bigint }): VestingSchedule {
  return { start: args.start, cliff: args.start + args.cliffSeconds, end: args.start + args.durationSeconds };
}

/** The contract's `_vested`, exactly (floor division). */
export function vestedAt(lock: Pick<TokenLockRecord, "amount"> & VestingSchedule, t: bigint): bigint {
  if (t < lock.cliff) return 0n;
  if (t >= lock.end) return lock.amount;
  return (lock.amount * (t - lock.start)) / (lock.end - lock.start);
}

/** Vested and not yet claimed at `t`. */
export function claimableAt(lock: Pick<TokenLockRecord, "amount" | "claimed"> & VestingSchedule, t: bigint): bigint {
  const v = vestedAt(lock, t);
  return v > lock.claimed ? v - lock.claimed : 0n;
}

export interface TokenLockIssue {
  readonly field: "amount" | "beneficiary" | "schedule" | "currency";
  readonly message: string;
}

/** The rules `lock` enforces on its arguments. */
export function validateTokenLock(args: {
  readonly currency: string;
  readonly amount: bigint;
  readonly beneficiary: string;
  readonly schedule: VestingSchedule;
  readonly nowSeconds: bigint;
  readonly lock?: Address;
}): TokenLockIssue[] {
  const issues: TokenLockIssue[] = [];
  if (!isAddress(args.currency.trim(), { strict: false })) issues.push({ field: "currency", message: "The token is not an address." });
  if (args.amount <= 0n) issues.push({ field: "amount", message: "Lock an amount above zero." });
  if (!isAddress(args.beneficiary.trim(), { strict: false })) issues.push({ field: "beneficiary", message: "The beneficiary is not an address." });
  else {
    const b = args.beneficiary.trim().toLowerCase();
    if (b === zeroAddress) issues.push({ field: "beneficiary", message: "The beneficiary cannot be the zero address." });
    if (args.lock !== undefined && b === args.lock.toLowerCase()) issues.push({ field: "beneficiary", message: "The lock contract cannot be the beneficiary." });
  }
  const { start, cliff, end } = args.schedule;
  if (!(start <= cliff && cliff <= end)) issues.push({ field: "schedule", message: "The schedule must satisfy start <= cliff <= end." });
  if (end <= args.nowSeconds) issues.push({ field: "schedule", message: "The end of the schedule must be in the future." });
  else if (end > args.nowSeconds + TOKEN_LOCK_MAX_SECONDS) issues.push({ field: "schedule", message: "The schedule may end at most 100 years from now." });
  if (start < 0n || end >= 2n ** 48n) issues.push({ field: "schedule", message: "Dates must fit a uint48." });
  return issues;
}

/* ------------------------------------------------------------------- reads --- */

export interface TokenLockRecord extends VestingSchedule {
  readonly lock: Address;
  readonly lockId: bigint;
  /** Zero address = native. */
  readonly currency: Address;
  readonly beneficiary: Address;
  readonly pendingBeneficiary: Address | null;
  /** What arrived (a fee-on-transfer token locks the net amount). */
  readonly amount: bigint;
  readonly claimed: bigint;
  readonly creator: Address;
}

export interface TokenLockView extends TokenLockRecord {
  readonly vested: bigint;
  readonly claimable: bigint;
  /** Not yet vested: nobody can take it. */
  readonly unvested: bigint;
  readonly status: "cliff" | "vesting" | "vested" | "claimed";
}

interface RawTokenLock {
  readonly currency: Address;
  readonly beneficiary: Address;
  readonly start: number | bigint;
  readonly cliff: number | bigint;
  readonly end: number | bigint;
  readonly pendingBeneficiary: Address;
  readonly amount: bigint;
  readonly claimed: bigint;
  readonly creator: Address;
}

export function decodeTokenLock(lock: Address, lockId: bigint, raw: RawTokenLock): TokenLockRecord {
  return {
    lock,
    lockId,
    currency: raw.currency,
    beneficiary: raw.beneficiary,
    pendingBeneficiary: raw.pendingBeneficiary === zeroAddress ? null : raw.pendingBeneficiary,
    start: BigInt(raw.start),
    cliff: BigInt(raw.cliff),
    end: BigInt(raw.end),
    amount: raw.amount,
    claimed: raw.claimed,
    creator: raw.creator,
  };
}

export function viewTokenLock(r: TokenLockRecord, now: bigint): TokenLockView {
  const vested = vestedAt(r, now);
  const claimable = vested > r.claimed ? vested - r.claimed : 0n;
  const status: TokenLockView["status"] =
    r.claimed >= r.amount ? "claimed" : now < r.cliff ? "cliff" : now >= r.end ? "vested" : "vesting";
  return { ...r, vested, claimable, unvested: r.amount - vested, status };
}

export async function readTokenLock(client: PublicClient, lock: Address, lockId: bigint): Promise<TokenLockRecord> {
  const raw = await client.readContract({ address: lock, abi: LATCH_TOKEN_LOCK_ABI, functionName: "getLock", args: [lockId] });
  return decodeTokenLock(lock, lockId, raw);
}

async function pages(count: bigint, page: (s: bigint, e: bigint) => Promise<readonly bigint[]>, size = 500n): Promise<bigint[]> {
  const out: bigint[] = [];
  for (let s = 0n; s < count; s += size) out.push(...(await page(s, s + size)));
  return out;
}

async function readViews(client: PublicClient, lock: Address, ids: readonly bigint[], now: bigint): Promise<TokenLockView[]> {
  const recs = await Promise.all(ids.map((id) => readTokenLock(client, lock, id)));
  return recs.map((r) => viewTokenLock(r, now));
}

export interface CurrencyLockSummary {
  readonly currency: Address;
  readonly locks: readonly TokenLockView[];
  /** `totalHeld(currency)`: owed to every lock of it (amount - claimed, summed). */
  readonly totalHeld: bigint;
  readonly unvested: bigint;
  /** `null` for native or a token without `totalSupply()`. */
  readonly totalSupply: bigint | null;
  readonly heldBps: number | null;
  readonly unvestedBps: number | null;
  /** Soonest `cliff` / `end` among locks not fully vested; `null` when none. */
  readonly nextCliffOrEnd: bigint | null;
  readonly lastEnd: bigint | null;
}

const TOTAL_SUPPLY_ABI = [{ type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] }] as const;

export function summarizeCurrencyLocks(args: {
  readonly currency: Address;
  readonly locks: readonly TokenLockView[];
  readonly totalHeld: bigint;
  readonly totalSupply: bigint | null;
  readonly now: bigint;
}): CurrencyLockSummary {
  let unvested = 0n;
  let nextCliffOrEnd: bigint | null = null;
  let lastEnd: bigint | null = null;
  for (const l of args.locks) {
    unvested += l.unvested;
    if (l.unvested === 0n) continue;
    const next = args.now < l.cliff ? l.cliff : l.end;
    if (nextCliffOrEnd === null || next < nextCliffOrEnd) nextCliffOrEnd = next;
    if (lastEnd === null || l.end > lastEnd) lastEnd = l.end;
  }
  const ts = args.totalSupply;
  const bps = (v: bigint): number | null => (ts === null || ts === 0n ? null : Number((v * 10_000n) / ts));
  return {
    currency: args.currency,
    locks: args.locks,
    totalHeld: args.totalHeld,
    unvested,
    totalSupply: ts,
    heldBps: bps(args.totalHeld),
    unvestedBps: bps(unvested),
    nextCliffOrEnd,
    lastEnd,
  };
}

/** Every lock of one currency, with its totals and share of supply. */
export async function readCurrencyLocks(
  client: PublicClient,
  lock: Address,
  currency: Address,
  opts: { readonly now?: bigint } = {},
): Promise<CurrencyLockSummary & { readonly now: bigint }> {
  const [count, totalHeld, totalSupply, now] = await Promise.all([
    client.readContract({ address: lock, abi: LATCH_TOKEN_LOCK_ABI, functionName: "currencyLockCount", args: [currency] }),
    client.readContract({ address: lock, abi: LATCH_TOKEN_LOCK_ABI, functionName: "totalHeld", args: [currency] }),
    isNative(currency)
      ? Promise.resolve(null)
      : client.readContract({ address: currency, abi: TOTAL_SUPPLY_ABI, functionName: "totalSupply" }).catch(() => null),
    opts.now ?? readChainNow(client),
  ]);
  const ids = await pages(count, (s, e) => client.readContract({ address: lock, abi: LATCH_TOKEN_LOCK_ABI, functionName: "currencyLockIds", args: [currency, s, e] }));
  const locks = await readViews(client, lock, ids, now);
  return { ...summarizeCurrencyLocks({ currency, locks, totalHeld, totalSupply, now }), now };
}

/**
 * Locks `account` is the CURRENT beneficiary of, or has been offered. The
 * contract's per-beneficiary list keeps past beneficiaries too; they are
 * filtered out here by reading each lock.
 */
export async function readBeneficiaryLocks(
  client: PublicClient,
  lock: Address,
  account: Address,
  opts: { readonly now?: bigint } = {},
): Promise<{ readonly locks: readonly TokenLockView[]; readonly now: bigint }> {
  const now = opts.now ?? (await readChainNow(client));
  // The per-beneficiary list has no count view; page until a short page.
  const ids: bigint[] = [];
  const size = 500n;
  for (let s = 0n; ; s += size) {
    const page = await client.readContract({ address: lock, abi: LATCH_TOKEN_LOCK_ABI, functionName: "beneficiaryLockIds", args: [account, s, s + size] });
    ids.push(...page);
    if (BigInt(page.length) < size) break;
  }
  const unique = [...new Set(ids)];
  const views = await readViews(client, lock, unique, now);
  const a = account.toLowerCase();
  return { locks: views.filter((v) => v.beneficiary.toLowerCase() === a), now };
}

/**
 * Every lock (newest `maxLocks`), grouped by currency with totals and share of
 * supply. Also the way to find a lock offered to an address: an offer is not
 * in the new beneficiary's own list until it is accepted.
 */
export async function readTokenLockDirectory(
  client: PublicClient,
  lock: Address,
  opts: { readonly now?: bigint; readonly maxLocks?: number } = {},
): Promise<{ readonly currencies: readonly CurrencyLockSummary[]; readonly totalLocks: number; readonly truncated: boolean; readonly now: bigint }> {
  const [count, now] = await Promise.all([
    client.readContract({ address: lock, abi: LATCH_TOKEN_LOCK_ABI, functionName: "lockCount" }),
    opts.now ?? readChainNow(client),
  ]);
  const total = Number(count);
  const max = opts.maxLocks ?? 2_000;
  const first = total > max ? total - max : 0;
  const ids: bigint[] = [];
  for (let i = first; i < total; i++) ids.push(BigInt(i));
  const views = await readViews(client, lock, ids, now);
  const by = new Map<string, TokenLockView[]>();
  for (const v of views) {
    const k = v.currency.toLowerCase();
    const l = by.get(k);
    if (l) l.push(v);
    else by.set(k, [v]);
  }
  const currencies = await Promise.all(
    [...by.values()].map(async (locks) => {
      const currency = (locks[0] as TokenLockView).currency;
      const [totalHeld, totalSupply] = await Promise.all([
        client.readContract({ address: lock, abi: LATCH_TOKEN_LOCK_ABI, functionName: "totalHeld", args: [currency] }),
        isNative(currency) ? Promise.resolve(null) : client.readContract({ address: currency, abi: TOTAL_SUPPLY_ABI, functionName: "totalSupply" }).catch(() => null),
      ]);
      return summarizeCurrencyLocks({ currency, locks, totalHeld, totalSupply, now });
    }),
  );
  return { currencies, totalLocks: total, truncated: first > 0, now };
}

/* ------------------------------------------------------------------ builds --- */

/**
 * `lock(currency, amount, beneficiary, start, cliff, end)`. Native: the value
 * is `amount` plus the fee's safe value; ERC-20: the fee only, after an exact
 * `approve(lock, amount)` (see `buildErc20Approve`). The surplus is refunded.
 */
export function buildTokenLock(args: {
  readonly lock: Address;
  readonly currency: Address;
  readonly amount: bigint;
  readonly beneficiary: Address;
  readonly schedule: VestingSchedule;
  readonly terms: Pick<FeeGateTerms, "feeWei" | "pendingFee">;
}): UtilityCall {
  const fee = feeSafeValue(args.terms);
  return {
    to: args.lock,
    data: encodeFunctionData({
      abi: LATCH_TOKEN_LOCK_ABI,
      functionName: "lock",
      args: [
        getAddress(args.currency),
        args.amount,
        getAddress(args.beneficiary),
        Number(args.schedule.start),
        Number(args.schedule.cliff),
        Number(args.schedule.end),
      ],
    }),
    value: isNative(args.currency) ? args.amount + fee : fee,
  };
}

export function buildClaimTokenLock(args: { readonly lock: Address; readonly lockId: bigint; readonly to: Address }): UtilityCall {
  return {
    to: args.lock,
    data: encodeFunctionData({ abi: LATCH_TOKEN_LOCK_ABI, functionName: "claim", args: [args.lockId, getAddress(args.to)] }),
    value: 0n,
  };
}

export function buildTransferBeneficiary(args: { readonly lock: Address; readonly lockId: bigint; readonly newBeneficiary: Address }): UtilityCall {
  return {
    to: args.lock,
    data: encodeFunctionData({ abi: LATCH_TOKEN_LOCK_ABI, functionName: "transferBeneficiary", args: [args.lockId, getAddress(args.newBeneficiary)] }),
    value: 0n,
  };
}

export function buildAcceptBeneficiary(args: { readonly lock: Address; readonly lockId: bigint }): UtilityCall {
  return { to: args.lock, data: encodeFunctionData({ abi: LATCH_TOKEN_LOCK_ABI, functionName: "acceptBeneficiary", args: [args.lockId] }), value: 0n };
}
