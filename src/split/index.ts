// SPDX-License-Identifier: MIT
/**
 * Team splits: `LatchSplitFactory` and `LatchSplit`.
 *
 * A split is a fixed list of payees and weights with no owner. Anything that
 * reaches it - native currency or any ERC-20, sent directly or pulled from a
 * Latch revenue source with `collect` - is owed to the payees in proportion to
 * their weights, after a protocol share frozen into the split at creation.
 * Payouts are pull: anyone may `release` a slot (the money always goes to that
 * slot's payee) or `releaseAll`; a payee may `releaseTo` another address.
 *
 * Independently authored against the contracts' compiled ABI and their
 * documented rules (`packages/launchpad/src/split/*.sol`). Every figure a
 * reader here returns is read from chain; nothing is estimated.
 */

import {
  encodeFunctionData,
  getAddress,
  isAddress,
  parseAbiItem,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { LATCH_SPLIT_ABI, LATCH_SPLIT_FACTORY_ABI } from "../launchpad/generated/abi.js";

export { LATCH_SPLIT_ABI, LATCH_SPLIT_FACTORY_ABI };

/* ---------------------------------------------------------- constants --- */

/** Weights are any positive scale on chain; the UI uses basis points. */
export const SPLIT_BPS = 10_000;
export const SPLIT_MAX_PAYEES = 100;
export const SPLIT_MAX_NAME_BYTES = 64;
export const SPLIT_MAX_LABEL_BYTES = 32;
/** `LatchSplit.MAX_PROTOCOL_SHARE_BPS`: no factory can ever go above it. */
export const SPLIT_HARD_CAP_PROTOCOL_SHARE_BPS = 500;
/** The currency id of native (ETH, HYPE, ...) in every Latch contract. */
export const NATIVE_CURRENCY: Address = zeroAddress;

const utf8 = new TextEncoder();
const byteLength = (s: string): number => utf8.encode(s).length;

/* -------------------------------------------------------------- draft --- */

export interface SplitDraftPayee {
  readonly address: string;
  /** Basis points in the UI; any positive integer on chain. */
  readonly weight: bigint | number;
  /** Display name, emitted at creation and never stored. */
  readonly label?: string;
}

export interface SplitDraft {
  readonly name: string;
  readonly payees: readonly SplitDraftPayee[];
}

export interface SplitDraftIssue {
  readonly field: "name" | "payees" | "address" | "weight" | "label";
  /** The payee row, for the per-payee fields. */
  readonly index?: number;
  readonly message: string;
}

/**
 * Every rule `LatchSplit.initialize` enforces, checked before a wallet is
 * asked to sign. (The split's own address cannot be a payee either; that one
 * is only knowable at creation and the simulation catches it.)
 */
export function validateSplitDraft(draft: SplitDraft): readonly SplitDraftIssue[] {
  const issues: SplitDraftIssue[] = [];
  const nameBytes = byteLength(draft.name);
  if (nameBytes === 0) issues.push({ field: "name", message: "A split needs a name." });
  else if (nameBytes > SPLIT_MAX_NAME_BYTES) {
    issues.push({ field: "name", message: `The name is ${nameBytes} bytes; a split stores at most ${SPLIT_MAX_NAME_BYTES}.` });
  }
  if (draft.payees.length === 0) issues.push({ field: "payees", message: "Add at least one payee." });
  if (draft.payees.length > SPLIT_MAX_PAYEES) {
    issues.push({ field: "payees", message: `${draft.payees.length} payees; a split holds at most ${SPLIT_MAX_PAYEES}.` });
  }
  const seen = new Map<string, number>();
  draft.payees.forEach((p, index) => {
    const raw = p.address.trim();
    if (!isAddress(raw, { strict: false })) {
      issues.push({ field: "address", index, message: "Not an address." });
    } else {
      const a = raw.toLowerCase();
      if (a === zeroAddress) issues.push({ field: "address", index, message: "The zero address cannot be paid." });
      const first = seen.get(a);
      if (first !== undefined) {
        issues.push({ field: "address", index, message: `Same address as payee ${first + 1}. Each address holds one slot.` });
      } else {
        seen.set(a, index);
      }
    }
    const w = typeof p.weight === "bigint" ? p.weight : Number.isInteger(p.weight) ? BigInt(p.weight) : -1n;
    if (w <= 0n) issues.push({ field: "weight", index, message: "The share must be a whole number above zero." });
    else if (w >= 2n ** 96n) issues.push({ field: "weight", index, message: "The share does not fit a uint96." });
    const label = p.label ?? "";
    if (byteLength(label) > SPLIT_MAX_LABEL_BYTES) {
      issues.push({ field: "label", index, message: `At most ${SPLIT_MAX_LABEL_BYTES} bytes.` });
    }
  });
  return issues;
}

/* --------------------------------------------------------- factory terms --- */

export interface PendingChange<T> {
  readonly value: T;
  /** Unix seconds (`block.timestamp`). */
  readonly effectiveAt: bigint;
}

/** What `createSplit` costs and what a new split is born with, read live. */
export interface SplitFactoryTerms {
  /** `splitFeeWei()`: the creation fee in the block that was read. */
  readonly feeWei: bigint;
  readonly pendingFee: PendingChange<bigint> | null;
  readonly capFeeWei: bigint;
  /** `protocolShareBps()`: the share a split created now is frozen with. */
  readonly protocolShareBps: number;
  readonly pendingProtocolShare: PendingChange<number> | null;
  readonly capProtocolShareBps: number;
  readonly noticeSeconds: number;
  /** The Safe: the only address creation fees and protocol shares are paid to. */
  readonly recipient: Address;
  readonly owedWei: bigint;
}

export async function readSplitFactoryTerms(client: PublicClient, factory: Address): Promise<SplitFactoryTerms> {
  const r = <
    F extends
      | "splitFeeWei"
      | "pendingSplitFee"
      | "maxSplitFeeWei"
      | "protocolShareBps"
      | "pendingProtocolShare"
      | "maxProtocolShareBps"
      | "noticeSeconds"
      | "protocolFeeRecipient"
      | "protocolFeesOwed",
  >(
    functionName: F,
  ) => client.readContract({ address: factory, abi: LATCH_SPLIT_FACTORY_ABI, functionName });
  const [feeWei, pendingFee, capFeeWei, share, pendingShare, capShare, notice, recipient, owedWei] = await Promise.all([
    r("splitFeeWei"),
    r("pendingSplitFee"),
    r("maxSplitFeeWei"),
    r("protocolShareBps"),
    r("pendingProtocolShare"),
    r("maxProtocolShareBps"),
    r("noticeSeconds"),
    r("protocolFeeRecipient"),
    r("protocolFeesOwed"),
  ]);
  return {
    feeWei,
    pendingFee: pendingFee[1] === 0n ? null : { value: pendingFee[0], effectiveAt: pendingFee[1] },
    capFeeWei,
    protocolShareBps: Number(share),
    pendingProtocolShare: pendingShare[1] === 0n ? null : { value: Number(pendingShare[0]), effectiveAt: pendingShare[1] },
    capProtocolShareBps: Number(capShare),
    noticeSeconds: Number(notice),
    recipient,
    owedWei,
  };
}

/**
 * `max(fee, pending fee)`: a `msg.value` that cannot revert `InsufficientSplitFee`
 * whichever side of a scheduled increase the transaction lands. The factory
 * refunds the difference in the same call.
 */
export function splitSafeValue(terms: Pick<SplitFactoryTerms, "feeWei" | "pendingFee">): bigint {
  const pending = terms.pendingFee === null ? 0n : terms.pendingFee.value;
  return pending > terms.feeWei ? pending : terms.feeWei;
}

/* ------------------------------------------------------------- create --- */

export function encodeCreateSplit(args: {
  readonly name: string;
  readonly payees: readonly SplitDraftPayee[];
  /** The highest protocol share the creator accepts (frozen forever). Default: the share in force when read. */
  readonly maxProtocolShareBps: number;
}): Hex {
  return encodeFunctionData({
    abi: LATCH_SPLIT_FACTORY_ABI,
    functionName: "createSplit",
    args: [
      args.name,
      args.payees.map((p) => getAddress(p.address.trim())),
      args.payees.map((p) => BigInt(p.weight)),
      args.payees.map((p) => p.label ?? ""),
      args.maxProtocolShareBps,
    ],
  });
}

/**
 * The whole `createSplit` transaction. The value pays the creation fee on
 * either side of a scheduled increase; `maxProtocolShareBps` is the share the
 * creator was shown, so an increase that lands first reverts instead of being
 * frozen into the split.
 */
export function buildCreateSplit(args: {
  readonly factory: Address;
  readonly draft: SplitDraft;
  readonly terms: Pick<SplitFactoryTerms, "feeWei" | "pendingFee" | "protocolShareBps">;
}): { readonly to: Address; readonly data: Hex; readonly value: bigint } {
  const issues = validateSplitDraft(args.draft);
  if (issues.length > 0) throw new Error(`invalid split: ${issues.map((i) => i.message).join(" ")}`);
  return {
    to: args.factory,
    data: encodeCreateSplit({ name: args.draft.name, payees: args.draft.payees, maxProtocolShareBps: args.terms.protocolShareBps }),
    value: splitSafeValue(args.terms),
  };
}

/* -------------------------------------------------------------- reads --- */

export interface SplitSlot {
  readonly slot: number;
  readonly payee: Address;
  readonly weight: bigint;
  /** `weight / totalWeight` of the part left after the protocol share, in basis points (rounded down). */
  readonly shareBps: number;
  /** An address the payee offered its slot to, not yet accepted. */
  readonly pendingPayee: Address | null;
}

export interface SplitInfo {
  readonly address: Address;
  readonly name: string;
  readonly protocolShareBps: number;
  readonly totalWeight: bigint;
  readonly slots: readonly SplitSlot[];
  readonly factory: Address;
  readonly protocolRecipient: Address;
}

export async function readSplit(client: PublicClient, split: Address): Promise<SplitInfo> {
  const r = <F extends "name" | "protocolShareBps" | "totalWeight" | "payees" | "FACTORY" | "PROTOCOL_RECIPIENT">(
    functionName: F,
  ) => client.readContract({ address: split, abi: LATCH_SPLIT_ABI, functionName });
  const [name, share, totalWeight, payees, factory, recipient] = await Promise.all([
    r("name"),
    r("protocolShareBps"),
    r("totalWeight"),
    r("payees"),
    r("FACTORY"),
    r("PROTOCOL_RECIPIENT"),
  ]);
  const [accounts, weights] = payees;
  const pendings = await Promise.all(
    accounts.map((_, i) =>
      client.readContract({ address: split, abi: LATCH_SPLIT_ABI, functionName: "pendingPayee", args: [BigInt(i)] }),
    ),
  );
  const shareN = Number(share);
  return {
    address: split,
    name,
    protocolShareBps: shareN,
    totalWeight,
    slots: accounts.map((payee, i) => ({
      slot: i,
      payee,
      weight: weights[i]!,
      shareBps: totalWeight === 0n ? 0 : Number((weights[i]! * BigInt(SPLIT_BPS)) / totalWeight),
      pendingPayee: pendings[i] === zeroAddress ? null : pendings[i]!,
    })),
    factory,
    protocolRecipient: recipient,
  };
}

export interface SplitCurrencyState {
  readonly currency: Address;
  /** `balance + totalReleased`: every unit that ever arrived. */
  readonly totalReceived: bigint;
  readonly totalReleased: bigint;
  /** What each slot can be paid now, slot order. */
  readonly releasable: readonly bigint[];
  readonly protocolReleasable: bigint;
}

/** Per-currency books of one split. `slotCount` from `readSplit`. */
export async function readSplitBalances(
  client: PublicClient,
  split: Address,
  slotCount: number,
  currencies: readonly Address[],
): Promise<readonly SplitCurrencyState[]> {
  return Promise.all(
    currencies.map(async (currency) => {
      const [totalReceived, totalReleased, protocolReleasable, releasable] = await Promise.all([
        client.readContract({ address: split, abi: LATCH_SPLIT_ABI, functionName: "totalReceived", args: [currency] }),
        client.readContract({ address: split, abi: LATCH_SPLIT_ABI, functionName: "totalReleased", args: [currency] }),
        client.readContract({ address: split, abi: LATCH_SPLIT_ABI, functionName: "protocolReleasable", args: [currency] }),
        Promise.all(
          Array.from({ length: slotCount }, (_, i) =>
            client.readContract({ address: split, abi: LATCH_SPLIT_ABI, functionName: "releasable", args: [BigInt(i), currency] }),
          ),
        ),
      ]);
      return { currency, totalReceived, totalReleased, releasable, protocolReleasable };
    }),
  );
}

const SPLIT_INITIALIZED = parseAbiItem(
  "event SplitInitialized(address indexed creator, string name, address[] payees, uint96[] weights, string[] labels, uint16 protocolShareBps)",
);

export interface SplitCreation {
  readonly creator: Address;
  readonly labels: readonly string[];
  readonly blockNumber: bigint;
  readonly transactionHash: Hex;
}

/**
 * The creation record: who created the split and the payee labels (emitted,
 * never stored). `fromBlock` bounds the log scan; pass the chain's deployment
 * block. `null` when the log is not found in range.
 */
export async function readSplitCreation(
  client: PublicClient,
  split: Address,
  fromBlock: bigint,
  toBlock?: bigint,
): Promise<SplitCreation | null> {
  const logs = await client.getLogs({ address: split, event: SPLIT_INITIALIZED, fromBlock, toBlock: toBlock ?? "latest" });
  const log = logs[0];
  if (log === undefined || log.args.creator === undefined) return null;
  return {
    creator: log.args.creator,
    labels: log.args.labels ?? [],
    blockNumber: log.blockNumber,
    transactionHash: log.transactionHash,
  };
}

export interface SplitDirectoryRow {
  readonly address: Address;
  readonly name: string;
  readonly payeeCount: number;
  readonly protocolShareBps: number;
}

/** Every split the factory made, creation order: three reads per split. */
export async function readSplitDirectory(client: PublicClient, factory: Address): Promise<readonly SplitDirectoryRow[]> {
  const count = await client.readContract({ address: factory, abi: LATCH_SPLIT_FACTORY_ABI, functionName: "splitCount" });
  if (count === 0n) return [];
  const addresses = await client.readContract({
    address: factory,
    abi: LATCH_SPLIT_FACTORY_ABI,
    functionName: "splits",
    args: [0n, count],
  });
  return Promise.all(
    addresses.map(async (address) => {
      const [name, payeeCount, share] = await Promise.all([
        client.readContract({ address, abi: LATCH_SPLIT_ABI, functionName: "name" }),
        client.readContract({ address, abi: LATCH_SPLIT_ABI, functionName: "payeeCount" }),
        client.readContract({ address, abi: LATCH_SPLIT_ABI, functionName: "protocolShareBps" }),
      ]);
      return { address, name, payeeCount: Number(payeeCount), protocolShareBps: Number(share) };
    }),
  );
}

/* ------------------------------------------------ credits at the sources --- */

/** A Latch contract that credits the split. */
export type SplitSource =
  /** `claimable(account, currency)` + `claim(currency, to)`: both lockers, both launch guards (creator tax), RevShareHook. */
  | { readonly kind: "claim"; readonly address: Address; readonly label: string }
  /** `feesOwed(account)` + `claimFees(to)`: `LaunchpadKitV2`, native only. */
  | { readonly kind: "kitFees"; readonly address: Address; readonly label: string };

const CLAIMABLE_ABI = [
  {
    type: "function",
    name: "claimable",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "currency", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const FEES_OWED_ABI = [
  {
    type: "function",
    name: "feesOwed",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface SplitCredit {
  readonly source: SplitSource;
  readonly currency: Address;
  readonly amount: bigint;
}

/**
 * What each source owes the split right now, per currency (the kit only in
 * native). A read that reverts is reported as `null` amount, never as zero.
 * Note: the creator tax must be `settleTax`d into `claimable` first; this
 * reads what is claimable, not what is pending in a pool's pot.
 */
export async function readSplitCredits(
  client: PublicClient,
  split: Address,
  sources: readonly SplitSource[],
  currencies: readonly Address[],
): Promise<readonly (SplitCredit | { readonly source: SplitSource; readonly currency: Address; readonly amount: null })[]> {
  const jobs: Promise<SplitCredit | { source: SplitSource; currency: Address; amount: null }>[] = [];
  for (const source of sources) {
    if (source.kind === "kitFees") {
      jobs.push(
        client
          .readContract({ address: source.address, abi: FEES_OWED_ABI, functionName: "feesOwed", args: [split] })
          .then((amount) => ({ source, currency: NATIVE_CURRENCY, amount }))
          .catch(() => ({ source, currency: NATIVE_CURRENCY, amount: null })),
      );
      continue;
    }
    for (const currency of currencies) {
      jobs.push(
        client
          .readContract({ address: source.address, abi: CLAIMABLE_ABI, functionName: "claimable", args: [split, currency] })
          .then((amount) => ({ source, currency, amount }))
          .catch(() => ({ source, currency, amount: null })),
      );
    }
  }
  return Promise.all(jobs);
}

/* ------------------------------------------------------------ encoding --- */

export function encodeCollect(source: Address, currency: Address): Hex {
  return encodeFunctionData({ abi: LATCH_SPLIT_ABI, functionName: "collect", args: [source, currency] });
}

export function encodeCollectKitFees(kit: Address): Hex {
  return encodeFunctionData({ abi: LATCH_SPLIT_ABI, functionName: "collectKitFees", args: [kit] });
}

export function encodeRelease(slot: number, currency: Address): Hex {
  return encodeFunctionData({ abi: LATCH_SPLIT_ABI, functionName: "release", args: [BigInt(slot), currency] });
}

export function encodeReleaseTo(currency: Address, to: Address): Hex {
  return encodeFunctionData({ abi: LATCH_SPLIT_ABI, functionName: "releaseTo", args: [currency, to] });
}

export function encodeReleaseProtocol(currency: Address): Hex {
  return encodeFunctionData({ abi: LATCH_SPLIT_ABI, functionName: "releaseProtocol", args: [currency] });
}

export function encodeReleaseAll(currency: Address): Hex {
  return encodeFunctionData({ abi: LATCH_SPLIT_ABI, functionName: "releaseAll", args: [currency] });
}

export function encodeTransferPayee(newPayee: Address): Hex {
  return encodeFunctionData({ abi: LATCH_SPLIT_ABI, functionName: "transferPayee", args: [newPayee] });
}

export function encodeAcceptPayee(slot: number): Hex {
  return encodeFunctionData({ abi: LATCH_SPLIT_ABI, functionName: "acceptPayee", args: [BigInt(slot)] });
}

export function encodeAcceptCreator(locker: Address, lockId: bigint): Hex {
  return encodeFunctionData({ abi: LATCH_SPLIT_ABI, functionName: "acceptCreator", args: [locker, lockId] });
}

/** Several split calls in one transaction (e.g. collect from each source, then `releaseAll`). */
export function encodeSplitMulticall(calls: readonly Hex[]): Hex {
  return encodeFunctionData({ abi: LATCH_SPLIT_ABI, functionName: "multicall", args: [[...calls]] });
}

/**
 * One transaction that pulls every non-zero credit into the split and pays
 * everybody out, per currency touched. Skips credits of zero or unknown amount.
 */
export function buildCollectAndReleaseAll(args: {
  readonly split: Address;
  readonly credits: readonly { readonly source: SplitSource; readonly currency: Address; readonly amount: bigint | null }[];
  /** Currencies to pay out even if nothing is collected now (the split already holds them). */
  readonly alsoRelease?: readonly Address[];
}): { readonly to: Address; readonly data: Hex; readonly value: 0n } {
  const calls: Hex[] = [];
  const touched = new Set<string>((args.alsoRelease ?? []).map((a) => a.toLowerCase()));
  for (const c of args.credits) {
    if (c.amount === null || c.amount === 0n) continue;
    calls.push(c.source.kind === "kitFees" ? encodeCollectKitFees(c.source.address) : encodeCollect(c.source.address, c.currency));
    touched.add(c.currency.toLowerCase());
  }
  for (const currency of touched) calls.push(encodeReleaseAll(getAddress(currency)));
  if (calls.length === 0) throw new Error("nothing to collect or release");
  return { to: args.split, data: encodeSplitMulticall(calls), value: 0n };
}

/* ---------------------------------------------------------- owner calls --- */

/** `setSplitFee` calldata, for a Safe transaction. */
export function encodeSetSplitFee(feeWei: bigint): Hex {
  return encodeFunctionData({ abi: LATCH_SPLIT_FACTORY_ABI, functionName: "setSplitFee", args: [feeWei] });
}

/** `setProtocolShare` calldata, for a Safe transaction. Affects NEW splits only. */
export function encodeSetProtocolShare(bps: number): Hex {
  return encodeFunctionData({ abi: LATCH_SPLIT_FACTORY_ABI, functionName: "setProtocolShare", args: [bps] });
}

/** `flushProtocolFees` calldata (permissionless; pays only the Safe). */
export function encodeFlushSplitFees(): Hex {
  return encodeFunctionData({ abi: LATCH_SPLIT_FACTORY_ABI, functionName: "flushProtocolFees", args: [] });
}
