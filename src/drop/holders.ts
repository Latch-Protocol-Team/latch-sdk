// SPDX-License-Identifier: MIT
/**
 * An airdrop to a token's HOLDERS, built from the chain.
 *
 * Two halves, kept apart so the arithmetic is testable without a node:
 *
 *   readHolderSnapshot   the holder set of `token` at `snapshotBlock`, reduced
 *                        from its `Transfer` logs `fromBlock..snapshotBlock`,
 *                        scanned in windows (a public RPC refuses one huge
 *                        range) and CHECKED: the sum of balances must equal
 *                        `totalSupply()` read AT the snapshot block, and no
 *                        balance may go negative. A scan that cannot be
 *                        completed or checked THROWS; it never returns a list
 *                        that might be partial.
 *
 *   planHolderAirdrop    pure: holders + mode + options -> recipients, with
 *                        every exclusion and every unit of dust accounted for.
 *
 * EXACT INTEGER MATH. Pro-rata is `floor(budget * balance / eligibleBalance)`
 * per holder; equal split is `floor(budget / n)`. The remainder is DUST: it is
 * not distributed, it is reported, and the sum sent is never above the budget.
 *
 * CONTRACT HOLDERS. A Merkle drop (`LatchMerkleDrop`) pays a leaf whose account
 * has code only when that account calls `claim` itself - a pool, a locker or a
 * token cannot. A multisend pushes to any address, contracts included (a
 * contract that refuses native makes the whole batch revert). So excluding
 * contracts is an option, off by default for a multisend and worth turning on
 * for a drop; which addresses have code is read by the caller (`getCode`) and
 * passed in, so this stays pure.
 */

import { getAddress, parseAbiItem, zeroAddress, type Address, type PublicClient } from "viem";

import type { LatchDeployment } from "../deployments/index.js";
import type { Recipient } from "./amounts.js";

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const TOTAL_SUPPLY_ABI = [{ type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] }] as const;

/** The conventional burn address. Not chain-specific: the same 20 bytes everywhere. */
export const DEAD_ADDRESS: Address = "0x000000000000000000000000000000000000dEaD";

/* ------------------------------------------------------------ exclusions --- */

export interface HolderExclusionRule {
  readonly address: Address;
  /** Why, in words a table can show: "the Vault (pool reserves)". */
  readonly reason: string;
}

type ExclusionBook = Pick<LatchDeployment, "vault" | "clPoolManager" | "binPoolManager" | "positionLock" | "tokenLock" | "dropFactory" | "multisend"> & {
  readonly launchpadV2: Pick<LatchDeployment["launchpadV2"], "clLPLocker" | "binLPLocker" | "launchpadKitV2">;
};

/**
 * The addresses an airdrop to holders skips by default, read from the address
 * book (never a per-chain literal): the Vault and both pool managers (pool
 * reserves, not a person), both LP lockers (a launch's permanently locked
 * seed), the position and token lock contracts (held for someone else), the
 * multisend and drop factory, the kit, the zero and dead addresses, and the
 * token itself. A `null` in the book is skipped, not guessed.
 */
export function defaultHolderExclusions(book: ExclusionBook, token: Address): HolderExclusionRule[] {
  const rows: [Address | null, string][] = [
    [zeroAddress, "the zero address"],
    [DEAD_ADDRESS, "the dead (burn) address"],
    [token, "the token contract itself"],
    [book.vault, "the Vault (every pool's reserves)"],
    [book.clPoolManager, "the CL pool manager"],
    [book.binPoolManager, "the Bin pool manager"],
    [book.launchpadV2.clLPLocker, "the CL LP locker (locked launch liquidity)"],
    [book.launchpadV2.binLPLocker, "the Bin LP locker (locked launch liquidity)"],
    [book.launchpadV2.launchpadKitV2, "LaunchpadKitV2"],
    [book.positionLock, "LatchPositionLock (held for lock owners)"],
    [book.tokenLock, "LatchTokenLock (held for beneficiaries)"],
    [book.dropFactory, "LatchDropFactory"],
    [book.multisend, "LatchMultisend"],
  ];
  const seen = new Set<string>();
  const out: HolderExclusionRule[] = [];
  for (const [a, reason] of rows) {
    if (a === null) continue;
    const k = a.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ address: getAddress(a), reason });
  }
  return out;
}

/* -------------------------------------------------------------- the plan --- */

export interface HolderBalance {
  readonly address: Address;
  readonly balance: bigint;
}

export type HolderAirdropMode =
  /** `floor(budget * balance / eligibleBalance)` each. */
  | { readonly kind: "pro-rata"; readonly budget: bigint }
  /** `floor(budget / n)` each. */
  | { readonly kind: "equal"; readonly budget: bigint }
  /** The same amount to every eligible holder; the total is `amountEach * n`. */
  | { readonly kind: "fixed"; readonly amountEach: bigint };

export interface HolderAirdropOptions {
  /** Holders below this balance are skipped (inclusive threshold: `balance >= minBalance` qualifies). */
  readonly minBalance?: bigint;
  /** Addresses to skip, with the reason shown. `defaultHolderExclusions` is the usual start. */
  readonly exclude?: readonly HolderExclusionRule[];
  /** Skip every address in `contracts` (addresses the caller found code at). */
  readonly excludeContracts?: boolean;
  /** Lower-cased (or any case) addresses that have code. Needed only with `excludeContracts`. */
  readonly contracts?: Iterable<string>;
  /** Keep only the largest N eligible holders (ties broken by address, ascending). */
  readonly topN?: number;
}

export type HolderExclusionKind = "listed" | "contract" | "below-minimum" | "beyond-top-n" | "rounds-to-zero";

export interface HolderExclusion extends HolderBalance {
  readonly kind: HolderExclusionKind;
  readonly reason: string;
}

export interface HolderAirdropRecipient extends Recipient {
  /** The holder's balance at the snapshot. */
  readonly balance: bigint;
}

export interface HolderAirdropPlan {
  readonly mode: HolderAirdropMode["kind"];
  /** Largest balance first. */
  readonly recipients: readonly HolderAirdropRecipient[];
  /** Sum of `recipients[].amount`. Never above `budget`. */
  readonly total: bigint;
  /** The budget given (`null` for a fixed amount each). */
  readonly budget: bigint | null;
  /** `budget - total`: not distributed. `0n` for a fixed amount each. */
  readonly dust: bigint;
  /** Sum of the balances the amounts were computed over (after every filter). */
  readonly eligibleBalance: bigint;
  readonly holdersIn: number;
  readonly excluded: readonly HolderExclusion[];
}

export class HolderAirdropError extends Error {
  override readonly name = "HolderAirdropError";
}

const byBalanceDesc = (a: HolderBalance, b: HolderBalance): number =>
  a.balance === b.balance ? (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : a.address.toLowerCase() > b.address.toLowerCase() ? 1 : 0) : a.balance > b.balance ? -1 : 1;

/**
 * Recipients and amounts for an airdrop to `holders` (pure, exact).
 *
 * Order of filters: listed exclusions, then contracts (if asked), then the
 * minimum balance, then the top-N cap; amounts are computed over what is left.
 * A pro-rata or equal amount that floors to zero is dropped (a zero payment or
 * leaf is pointless) and its holder listed as excluded; its share stays in the
 * dust. Duplicate holder addresses are merged first.
 */
export function planHolderAirdrop(holders: readonly HolderBalance[], mode: HolderAirdropMode, opts: HolderAirdropOptions = {}): HolderAirdropPlan {
  const budget = mode.kind === "fixed" ? null : mode.budget;
  if (budget !== null && budget < 0n) throw new HolderAirdropError("The budget cannot be negative.");
  if (mode.kind === "fixed" && mode.amountEach <= 0n) throw new HolderAirdropError("The amount each must be above zero.");
  const minBalance = opts.minBalance ?? 0n;
  if (minBalance < 0n) throw new HolderAirdropError("The minimum balance cannot be negative.");
  if (opts.topN !== undefined && (!Number.isInteger(opts.topN) || opts.topN < 1)) throw new HolderAirdropError("Top N must be a whole number of at least 1.");

  // Merge duplicates (a list stitched from two scans), drop non-positive balances.
  const merged = new Map<string, HolderBalance>();
  for (const h of holders) {
    const k = h.address.toLowerCase();
    const cur = merged.get(k);
    merged.set(k, { address: cur?.address ?? getAddress(h.address), balance: (cur?.balance ?? 0n) + h.balance });
  }
  const listed = new Map<string, string>();
  for (const r of opts.exclude ?? []) if (!listed.has(r.address.toLowerCase())) listed.set(r.address.toLowerCase(), r.reason);
  const contracts = new Set<string>();
  for (const c of opts.contracts ?? []) contracts.add(c.toLowerCase());

  const excluded: HolderExclusion[] = [];
  let pool: HolderBalance[] = [];
  for (const h of [...merged.values()].sort(byBalanceDesc)) {
    if (h.balance <= 0n) continue;
    const k = h.address.toLowerCase();
    const why = listed.get(k);
    if (why !== undefined) excluded.push({ ...h, kind: "listed", reason: why });
    else if (opts.excludeContracts === true && contracts.has(k)) excluded.push({ ...h, kind: "contract", reason: "a contract account (has code)" });
    else if (h.balance < minBalance) excluded.push({ ...h, kind: "below-minimum", reason: "below the minimum balance" });
    else pool.push(h);
  }
  if (opts.topN !== undefined && pool.length > opts.topN) {
    for (const h of pool.slice(opts.topN)) excluded.push({ ...h, kind: "beyond-top-n", reason: `not in the top ${opts.topN}` });
    pool = pool.slice(0, opts.topN);
  }

  const eligibleBalance = pool.reduce((s, h) => s + h.balance, 0n);
  const recipients: HolderAirdropRecipient[] = [];
  const zero = (h: HolderBalance) => excluded.push({ ...h, kind: "rounds-to-zero", reason: "its share rounds down to zero" });
  if (mode.kind === "fixed") {
    for (const h of pool) recipients.push({ account: h.address, amount: mode.amountEach, balance: h.balance });
  } else if (mode.kind === "equal") {
    const each = pool.length === 0 ? 0n : mode.budget / BigInt(pool.length);
    for (const h of pool) {
      if (each === 0n) zero(h);
      else recipients.push({ account: h.address, amount: each, balance: h.balance });
    }
  } else {
    for (const h of pool) {
      const amount = eligibleBalance === 0n ? 0n : (mode.budget * h.balance) / eligibleBalance;
      if (amount === 0n) zero(h);
      else recipients.push({ account: h.address, amount, balance: h.balance });
    }
  }
  const total = recipients.reduce((s, r) => s + r.amount, 0n);
  if (budget !== null && total > budget) throw new HolderAirdropError(`Internal: ${total} above the budget ${budget}.`);
  return {
    mode: mode.kind,
    recipients,
    total,
    budget,
    dust: budget === null ? 0n : budget - total,
    eligibleBalance,
    holdersIn: merged.size,
    excluded,
  };
}

/* --------------------------------------------------------------- the scan --- */

export interface HolderSnapshot {
  readonly token: Address;
  readonly fromBlock: bigint;
  readonly snapshotBlock: bigint;
  /** The snapshot block's `timestamp`. */
  readonly snapshotTimestamp: bigint;
  /** `totalSupply()` read AT `snapshotBlock`; equals the sum of `holders`. */
  readonly totalSupply: bigint;
  /** Every address with a positive balance, largest first. */
  readonly holders: readonly HolderBalance[];
  readonly transfers: number;
  /** How many `eth_getLogs` windows the scan took. */
  readonly windows: number;
}

export class HolderScanError extends Error {
  override readonly name = "HolderScanError";
  constructor(
    message: string,
    readonly kind: "logs" | "supply" | "incomplete",
  ) {
    super(message);
  }
}

export interface ReadHolderSnapshotOptions {
  /** Where the reduction starts. Must be at or before the token's first transfer (its mint), or the check fails. */
  readonly fromBlock: bigint;
  /** Default: the latest block. */
  readonly snapshotBlock?: bigint;
  /** First window size. Default 50,000 blocks; halved on each refusal down to `minWindow`. */
  readonly window?: bigint;
  /** Default 500 blocks: below it the RPC is refusing for another reason and the scan stops. */
  readonly minWindow?: bigint;
  /** Called after each window, for a progress line. */
  readonly onProgress?: (scannedTo: bigint, snapshotBlock: bigint) => void;
  readonly signal?: AbortSignal;
}

/** Reduce Transfer logs to balances (pure). Negative balances are kept: they prove the window started too late. */
export function reduceTransfers(logs: readonly { readonly from: Address; readonly to: Address; readonly value: bigint }[]): Map<string, bigint> {
  const balances = new Map<string, bigint>();
  for (const l of logs) {
    const from = l.from.toLowerCase();
    const to = l.to.toLowerCase();
    if (from !== zeroAddress) balances.set(from, (balances.get(from) ?? 0n) - l.value);
    if (to !== zeroAddress) balances.set(to, (balances.get(to) ?? 0n) + l.value);
  }
  return balances;
}

/**
 * Every holder of `token` at `snapshotBlock`, from its Transfer logs, VERIFIED
 * against `totalSupply()` at that block. Throws `HolderScanError` when a log
 * window cannot be read even at `minWindow` blocks, when `totalSupply` at the
 * snapshot cannot be read (a node without that block's state), or when the
 * reduction does not add up (the scan started after the token's first mint,
 * or the token changes balances without Transfer events - rebasing, reflection).
 */
export async function readHolderSnapshot(client: PublicClient, token: Address, opts: ReadHolderSnapshotOptions): Promise<HolderSnapshot> {
  const snapshotBlock = opts.snapshotBlock ?? (await client.getBlockNumber());
  if (opts.fromBlock > snapshotBlock) throw new HolderScanError(`The scan starts at block ${opts.fromBlock}, after the snapshot block ${snapshotBlock}.`, "incomplete");
  const minWindow = opts.minWindow ?? 500n;
  let window = opts.window ?? 50_000n;
  const transfers: { from: Address; to: Address; value: bigint }[] = [];
  let windows = 0;
  for (let start = opts.fromBlock; start <= snapshotBlock; ) {
    if (opts.signal?.aborted === true) throw new HolderScanError("The scan was cancelled.", "incomplete");
    const end = start + window - 1n > snapshotBlock ? snapshotBlock : start + window - 1n;
    let logs;
    try {
      logs = await client.getLogs({ address: token, event: TRANSFER, fromBlock: start, toBlock: end });
    } catch (e) {
      if (window / 2n >= minWindow) {
        window /= 2n;
        continue;
      }
      const msg = e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message) : String(e);
      throw new HolderScanError(`The RPC refused Transfer logs for blocks ${start}-${end} even in ${window}-block windows: ${msg.split("\n")[0]}`, "logs");
    }
    windows++;
    for (const l of logs) transfers.push({ from: l.args.from as Address, to: l.args.to as Address, value: l.args.value as bigint });
    opts.onProgress?.(end, snapshotBlock);
    start = end + 1n;
  }
  let totalSupply: bigint;
  let snapshotTimestamp: bigint;
  try {
    [totalSupply, snapshotTimestamp] = await Promise.all([
      client.readContract({ address: token, abi: TOTAL_SUPPLY_ABI, functionName: "totalSupply", blockNumber: snapshotBlock }),
      client.getBlock({ blockNumber: snapshotBlock }).then((b) => b.timestamp),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message) : String(e);
    throw new HolderScanError(
      `totalSupply() at block ${snapshotBlock} could not be read, so the list cannot be checked (the RPC may not keep that block's state; a recent snapshot usually works): ${msg.split("\n")[0]}`,
      "supply",
    );
  }
  const balances = reduceTransfers(transfers);
  let sum = 0n;
  for (const [a, b] of balances) {
    if (b < 0n) {
      throw new HolderScanError(
        `${a} sent more than it received between blocks ${opts.fromBlock} and ${snapshotBlock}: the scan starts after the token's first transfers. Start at or before the token's creation block.`,
        "incomplete",
      );
    }
    sum += b;
  }
  if (sum !== totalSupply) {
    throw new HolderScanError(
      `The balances reduced from Transfer logs add up to ${sum}, but totalSupply() at block ${snapshotBlock} is ${totalSupply}. Either the scan starts after the token's creation block, or the token moves balances without Transfer events (rebasing, reflection). The list is not complete and is not used.`,
      "incomplete",
    );
  }
  const holders = [...balances.entries()]
    .filter(([, b]) => b > 0n)
    .map(([a, b]) => ({ address: getAddress(a), balance: b }))
    .sort(byBalanceDesc);
  return { token: getAddress(token), fromBlock: opts.fromBlock, snapshotBlock, snapshotTimestamp, totalSupply, holders, transfers: transfers.length, windows };
}

/**
 * Which of `addresses` have code at `blockNumber` (default latest), lower-cased.
 * An EIP-7702-delegated EOA has code too, and is reported as a contract.
 */
export async function readContractAccounts(client: PublicClient, addresses: readonly Address[], opts: { readonly blockNumber?: bigint; readonly concurrency?: number } = {}): Promise<Set<string>> {
  const out = new Set<string>();
  const step = opts.concurrency ?? 16;
  for (let i = 0; i < addresses.length; i += step) {
    const chunk = addresses.slice(i, i + step);
    const codes = await Promise.all(chunk.map((a) => client.getCode(opts.blockNumber === undefined ? { address: a } : { address: a, blockNumber: opts.blockNumber })));
    codes.forEach((c, j) => {
      if (c !== undefined && c !== "0x") out.add((chunk[j] as Address).toLowerCase());
    });
  }
  return out;
}
