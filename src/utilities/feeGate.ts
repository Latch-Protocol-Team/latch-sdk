// SPDX-License-Identifier: MIT
/**
 * The flat native fee every Latch utility charges (lockers, multisend, the
 * Merkle drop factory): one mechanism, read the same way on every contract.
 *
 * What the contracts guarantee, and therefore what this reader reports:
 *   - `feeWei()` is the fee an action pays in the block the read was made in.
 *   - An increase is announced and applies by itself `feeNoticeSeconds` later;
 *     `pendingFee()` returns it until then, `(0, 0)` when there is none. A
 *     decrease applies at once. Nothing is retroactive.
 *   - The owner (the governance Safe) can never set a fee above `maxFeeWei`.
 *   - A call that carries more than the fee is refunded the surplus in the same
 *     transaction, so sending `feeSafeValue(terms)` never overpays in the end
 *     and never reverts on a fee increase that lands between read and mine.
 *
 * The fee is ENFORCED BY THE CONTRACT. This module only reads it and sizes
 * `msg.value`; a caller who skips the SDK pays exactly the same.
 */

import { encodeFunctionData, zeroAddress, type Address, type Hex, type PublicClient } from "viem";

import { LATCH_MULTISEND_ABI } from "../launchpad/generated/abi.js";

/** The `LatchFeeGate` members every utility shares (same selectors on each). */
const FEE_GATE_ABI = LATCH_MULTISEND_ABI;

export interface PendingUtilityFee {
  readonly feeWei: bigint;
  /** Unix seconds (`block.timestamp`) the increase applies from. */
  readonly effectiveAt: bigint;
}

/** One utility's fee terms, read live. */
export interface FeeGateTerms {
  /** The contract the terms were read from. */
  readonly address: Address;
  /** `feeWei()`: what an action pays now, in native wei. */
  readonly feeWei: bigint;
  /** An announced increase not yet in force, or `null`. */
  readonly pendingFee: PendingUtilityFee | null;
  /** `maxFeeWei`: the immutable ceiling. */
  readonly capWei: bigint;
  /** `feeNoticeSeconds`: how long an increase waits (immutable). */
  readonly noticeSeconds: number;
  /** `protocolFeeRecipient`: the only address fees are paid to (immutable). */
  readonly recipient: Address;
  /** `protocolFeesOwed`: fees credited and not yet flushed. */
  readonly owedWei: bigint;
  /** `owner()`: who may change the fee (inside the cap). */
  readonly owner: Address;
}

export async function readFeeGate(client: PublicClient, address: Address): Promise<FeeGateTerms> {
  const r = <
    F extends "feeWei" | "pendingFee" | "maxFeeWei" | "feeNoticeSeconds" | "protocolFeeRecipient" | "protocolFeesOwed" | "owner",
  >(
    functionName: F,
  ) => client.readContract({ address, abi: FEE_GATE_ABI, functionName });
  const [feeWei, pending, capWei, notice, recipient, owedWei, owner] = await Promise.all([
    r("feeWei"),
    r("pendingFee"),
    r("maxFeeWei"),
    r("feeNoticeSeconds"),
    r("protocolFeeRecipient"),
    r("protocolFeesOwed"),
    r("owner"),
  ]);
  return {
    address,
    feeWei,
    pendingFee: decodePendingUtilityFee(pending),
    capWei,
    noticeSeconds: Number(notice),
    recipient,
    owedWei,
    owner,
  };
}

/** `pendingFee()`'s `(newFeeWei, effectiveAt)`; `effectiveAt == 0` means none. */
export function decodePendingUtilityFee(raw: readonly [bigint, bigint | number]): PendingUtilityFee | null {
  const effectiveAt = BigInt(raw[1]);
  if (effectiveAt === 0n) return null;
  return { feeWei: raw[0], effectiveAt };
}

/**
 * The fee part of `msg.value`: `max(fee, pending fee)`. Covers a scheduled
 * increase that lands before the transaction mines; the contract refunds the
 * difference in the same call.
 */
export function feeSafeValue(terms: Pick<FeeGateTerms, "feeWei" | "pendingFee">): bigint {
  const pending = terms.pendingFee === null ? 0n : terms.pendingFee.feeWei;
  return pending > terms.feeWei ? pending : terms.feeWei;
}

/** `true` when the fee a transaction pays may still change before it mines (an increase is announced). */
export function feeMayRise(terms: Pick<FeeGateTerms, "feeWei" | "pendingFee">): boolean {
  return terms.pendingFee !== null && terms.pendingFee.feeWei > terms.feeWei;
}

/** One transaction a utility builder returns: send exactly these three fields. */
export interface UtilityCall {
  readonly to: Address;
  readonly data: Hex;
  readonly value: bigint;
}

/** Permissionless: pays every unit of native that is not held for users to the immutable recipient. */
export function buildFlushProtocolFees(address: Address): UtilityCall {
  return { to: address, data: encodeFunctionData({ abi: FEE_GATE_ABI, functionName: "flushProtocolFees" }), value: 0n };
}

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** `token.approve(spender, amount)`: an exact approval, never an unlimited one. */
export function buildErc20Approve(args: { readonly token: Address; readonly spender: Address; readonly amount: bigint }): UtilityCall {
  return {
    to: args.token,
    data: encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [args.spender, args.amount] }),
    value: 0n,
  };
}

export function readErc20Allowance(client: PublicClient, token: Address, owner: Address, spender: Address): Promise<bigint> {
  return client.readContract({ address: token, abi: ERC20_APPROVE_ABI, functionName: "allowance", args: [owner, spender] });
}

/** The zero address: native currency in every Latch contract. */
export const NATIVE: Address = zeroAddress;

export function isNative(currency: string): boolean {
  return currency.toLowerCase() === zeroAddress;
}
