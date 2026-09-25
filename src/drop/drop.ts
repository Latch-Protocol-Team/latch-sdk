// SPDX-License-Identifier: MIT
/**
 * `LatchDropFactory` and `LatchMerkleDrop`: claimable airdrops.
 *
 * `createDrop` clones a drop, funds it and lists it in one transaction, for one
 * flat native fee. Native: `msg.value` = amount + fee. ERC-20: approve the
 * FACTORY for `amount` first; the tokens move from the creator straight to the
 * drop, and the drop records what it actually received (a fee-on-transfer
 * token funds its net amount, so build the tree for that).
 *
 * A claim always pays the leaf's account. Anyone may submit the claim of an
 * account with no code (gas-sponsored claims); an account WITH code must claim
 * for itself. After `expiresAt` nothing can be claimed and the creator sweeps
 * the remainder.
 */

import { encodeFunctionData, getAddress, type Address, type Hex, type PublicClient } from "viem";

import { LATCH_DROP_FACTORY_ABI, LATCH_MERKLE_DROP_ABI } from "../launchpad/generated/abi.js";
import { feeSafeValue, isNative, type FeeGateTerms, type UtilityCall } from "../utilities/feeGate.js";
import type { DropClaim } from "./merkle.js";

/** `MIN_DURATION` / `MAX_DURATION` / `MAX_METADATA_BYTES`. */
export const DROP_MIN_DURATION_SECONDS = 86_400n;
export const DROP_MAX_DURATION_SECONDS = 5n * 365n * 86_400n;
export const DROP_MAX_METADATA_BYTES = 2048;

const ZERO_ROOT = `0x${"0".repeat(64)}` as Hex;
const utf8 = new TextEncoder();

export interface DropDraftIssue {
  readonly field: "amount" | "merkleRoot" | "expiresAt" | "metadataURI" | "currency";
  readonly message: string;
}

/** The rules `createDrop` enforces, checked before asking a wallet. */
export function validateDropDraft(args: {
  readonly amount: bigint;
  readonly merkleRoot: Hex;
  readonly expiresAt: bigint;
  readonly metadataURI: string;
  readonly nowSeconds: bigint;
}): DropDraftIssue[] {
  const issues: DropDraftIssue[] = [];
  if (args.amount <= 0n) issues.push({ field: "amount", message: "A drop needs an amount above zero." });
  if (args.merkleRoot.toLowerCase() === ZERO_ROOT) issues.push({ field: "merkleRoot", message: "The Merkle root cannot be zero." });
  if (args.expiresAt < args.nowSeconds + DROP_MIN_DURATION_SECONDS) issues.push({ field: "expiresAt", message: "A drop must stay claimable at least 1 day." });
  else if (args.expiresAt > args.nowSeconds + DROP_MAX_DURATION_SECONDS) issues.push({ field: "expiresAt", message: "A drop can stay open at most 5 years." });
  const bytes = utf8.encode(args.metadataURI).length;
  if (bytes > DROP_MAX_METADATA_BYTES) issues.push({ field: "metadataURI", message: `The metadata URI is ${bytes} bytes; at most ${DROP_MAX_METADATA_BYTES}.` });
  return issues;
}

/**
 * `createDrop(currency, amount, merkleRoot, expiresAt, metadataURI)`. The
 * value is `amount` + the fee's safe value for native, the fee's safe value
 * for an ERC-20 (after `approve(factory, amount)`). The surplus is refunded.
 */
export function buildCreateDrop(args: {
  readonly factory: Address;
  readonly currency: Address;
  readonly amount: bigint;
  readonly merkleRoot: Hex;
  readonly expiresAt: bigint;
  readonly metadataURI: string;
  readonly terms: Pick<FeeGateTerms, "feeWei" | "pendingFee">;
}): UtilityCall {
  const fee = feeSafeValue(args.terms);
  return {
    to: args.factory,
    data: encodeFunctionData({
      abi: LATCH_DROP_FACTORY_ABI,
      functionName: "createDrop",
      args: [getAddress(args.currency), args.amount, args.merkleRoot, args.expiresAt, args.metadataURI],
    }),
    value: isNative(args.currency) ? args.amount + fee : fee,
  };
}

/** `claim(index, account, amount, proof)`: pays `account`. */
export function buildClaimDrop(args: { readonly drop: Address; readonly claim: Pick<DropClaim, "index" | "account" | "amount" | "proof"> }): UtilityCall {
  const c = args.claim;
  return {
    to: args.drop,
    data: encodeFunctionData({
      abi: LATCH_MERKLE_DROP_ABI,
      functionName: "claim",
      args: [BigInt(c.index), getAddress(c.account), BigInt(c.amount), [...c.proof]],
    }),
    value: 0n,
  };
}

/** Creator only, after `expiresAt`: everything left, to `to`. */
export function buildSweepDrop(args: { readonly drop: Address; readonly to: Address }): UtilityCall {
  return { to: args.drop, data: encodeFunctionData({ abi: LATCH_MERKLE_DROP_ABI, functionName: "sweep", args: [getAddress(args.to)] }), value: 0n };
}

/** Creator only, any time: an ERC-20 that is NOT the drop's currency. */
export function buildRescueDropOtherToken(args: { readonly drop: Address; readonly token: Address; readonly to: Address }): UtilityCall {
  return {
    to: args.drop,
    data: encodeFunctionData({ abi: LATCH_MERKLE_DROP_ABI, functionName: "rescueOtherToken", args: [getAddress(args.token), getAddress(args.to)] }),
    value: 0n,
  };
}

/* ------------------------------------------------------------------- reads --- */

export interface DropInfo {
  readonly address: Address;
  readonly factory: Address;
  readonly creator: Address;
  /** Zero address = native. */
  readonly currency: Address;
  readonly merkleRoot: Hex;
  /** Unix seconds; claims stop at this timestamp (`block.timestamp >= expiresAt` reverts). */
  readonly expiresAt: bigint;
  /** What the drop received at creation. */
  readonly totalAmount: bigint;
  /** Sum of every successful claim. */
  readonly claimedAmount: bigint;
  /** The drop's current balance of its currency (after a sweep: what was forced in since). */
  readonly balance: bigint;
  readonly metadataURI: string;
  /** `claimedAmount / totalAmount` in basis points (floor). */
  readonly claimedBps: number;
}

const BALANCE_OF_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

export async function readDrop(client: PublicClient, drop: Address): Promise<DropInfo> {
  const r = <F extends "FACTORY" | "creator" | "currency" | "merkleRoot" | "expiresAt" | "totalAmount" | "claimedAmount" | "metadataURI">(functionName: F) =>
    client.readContract({ address: drop, abi: LATCH_MERKLE_DROP_ABI, functionName });
  const [factory, creator, currency, merkleRoot, expiresAt, totalAmount, claimedAmount, metadataURI] = await Promise.all([
    r("FACTORY"),
    r("creator"),
    r("currency"),
    r("merkleRoot"),
    r("expiresAt"),
    r("totalAmount"),
    r("claimedAmount"),
    r("metadataURI"),
  ]);
  const balance = isNative(currency)
    ? await client.getBalance({ address: drop })
    : await client.readContract({ address: currency, abi: BALANCE_OF_ABI, functionName: "balanceOf", args: [drop] });
  return {
    address: drop,
    factory,
    creator,
    currency,
    merkleRoot,
    expiresAt: BigInt(expiresAt),
    totalAmount,
    claimedAmount,
    balance,
    metadataURI,
    claimedBps: totalAmount === 0n ? 0 : Number((claimedAmount * 10_000n) / totalAmount),
  };
}

export async function readDropClaimed(client: PublicClient, drop: Address, indices: readonly (number | bigint)[]): Promise<boolean[]> {
  return Promise.all(indices.map((i) => client.readContract({ address: drop, abi: LATCH_MERKLE_DROP_ABI, functionName: "isClaimed", args: [BigInt(i)] })));
}

/** Every drop the factory made (newest `max`), or every drop of one creator, read in full. */
export async function readDropDirectory(
  client: PublicClient,
  factory: Address,
  opts: { readonly creator?: Address; readonly max?: number } = {},
): Promise<{ readonly drops: readonly DropInfo[]; readonly total: number; readonly truncated: boolean }> {
  const max = BigInt(opts.max ?? 500);
  let addresses: readonly Address[];
  let total: number;
  if (opts.creator !== undefined) {
    const creator = opts.creator;
    const out: Address[] = [];
    for (let s = 0n; ; s += 500n) {
      const page = await client.readContract({ address: factory, abi: LATCH_DROP_FACTORY_ABI, functionName: "dropsOf", args: [creator, s, s + 500n] });
      out.push(...page);
      if (page.length < 500) break;
    }
    total = out.length;
    addresses = out.slice(Math.max(0, out.length - Number(max)));
  } else {
    const count = await client.readContract({ address: factory, abi: LATCH_DROP_FACTORY_ABI, functionName: "dropCount" });
    total = Number(count);
    const start = count > max ? count - max : 0n;
    addresses = await client.readContract({ address: factory, abi: LATCH_DROP_FACTORY_ABI, functionName: "drops", args: [start, count] });
  }
  const drops = await Promise.all(addresses.map((a) => readDrop(client, a)));
  return { drops: drops.reverse(), total, truncated: addresses.length < total };
}

/** `isDrop(address)` on the factory: whether an address is one of its drops. */
export function readIsDrop(client: PublicClient, factory: Address, drop: Address): Promise<boolean> {
  return client.readContract({ address: factory, abi: LATCH_DROP_FACTORY_ABI, functionName: "isDrop", args: [drop] });
}

