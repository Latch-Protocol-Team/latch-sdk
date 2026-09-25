// SPDX-License-Identifier: MIT
/**
 * `LatchMultisend`: push native or one ERC-20 to up to `MAX_RECIPIENTS` (1,000)
 * addresses per call. Each call is atomic (every recipient is paid exactly or
 * the call reverts whole) and pays the flat fee once. A longer list is split
 * into batches here; each batch is its own transaction and pays its own fee.
 *
 * ERC-20 moves straight from the sender to each recipient, so the sender
 * approves the multisend contract for the SUM of every batch it will send
 * (`plan.approval`), exactly, never unlimited.
 */

import { encodeFunctionData, getAddress, type Address } from "viem";

import { LATCH_MULTISEND_ABI } from "../launchpad/generated/abi.js";
import { feeSafeValue, isNative, type FeeGateTerms, type UtilityCall } from "../utilities/feeGate.js";
import type { Recipient } from "./amounts.js";

/** `MAX_RECIPIENTS`. */
export const MULTISEND_MAX_RECIPIENTS = 1_000;

/** Split a list into consecutive batches of at most `size` (default 1,000). */
export function batchRecipients<T>(rows: readonly T[], size: number = MULTISEND_MAX_RECIPIENTS): T[][] {
  if (!Number.isInteger(size) || size < 1 || size > MULTISEND_MAX_RECIPIENTS) throw new RangeError(`batch size must be 1..${MULTISEND_MAX_RECIPIENTS}`);
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

function sum(rows: readonly Recipient[]): bigint {
  return rows.reduce((s, r) => s + r.amount, 0n);
}

function checkBatch(rows: readonly Recipient[]): void {
  if (rows.length === 0) throw new RangeError("A multisend needs at least one recipient.");
  if (rows.length > MULTISEND_MAX_RECIPIENTS) throw new RangeError(`${rows.length} recipients; one call takes at most ${MULTISEND_MAX_RECIPIENTS}.`);
}

/** `multisendNative(recipients, amounts)`: value = the batch's sum + the fee's safe value. */
export function buildMultisendNative(args: {
  readonly multisend: Address;
  readonly recipients: readonly Recipient[];
  readonly terms: Pick<FeeGateTerms, "feeWei" | "pendingFee">;
}): UtilityCall {
  checkBatch(args.recipients);
  return {
    to: args.multisend,
    data: encodeFunctionData({
      abi: LATCH_MULTISEND_ABI,
      functionName: "multisendNative",
      args: [args.recipients.map((r) => getAddress(r.account)), args.recipients.map((r) => r.amount)],
    }),
    value: sum(args.recipients) + feeSafeValue(args.terms),
  };
}

/** `multisendToken(token, recipients, amounts)`: value = the fee's safe value. */
export function buildMultisendToken(args: {
  readonly multisend: Address;
  readonly token: Address;
  readonly recipients: readonly Recipient[];
  readonly terms: Pick<FeeGateTerms, "feeWei" | "pendingFee">;
}): UtilityCall {
  checkBatch(args.recipients);
  return {
    to: args.multisend,
    data: encodeFunctionData({
      abi: LATCH_MULTISEND_ABI,
      functionName: "multisendToken",
      args: [getAddress(args.token), args.recipients.map((r) => getAddress(r.account)), args.recipients.map((r) => r.amount)],
    }),
    value: feeSafeValue(args.terms),
  };
}

export interface MultisendBatch {
  readonly call: UtilityCall;
  readonly recipients: number;
  /** Sum sent to recipients in this batch, base units of the currency. */
  readonly amount: bigint;
}

export interface MultisendPlan {
  readonly batches: readonly MultisendBatch[];
  /** ERC-20 only: approve the multisend contract for exactly this before the first batch. */
  readonly approval: { readonly token: Address; readonly spender: Address; readonly amount: bigint } | null;
  /** Sum of every amount, base units. */
  readonly totalAmount: bigint;
  /** Fees at the safe value, summed (each batch refunds its surplus). */
  readonly totalFeeValue: bigint;
  /** Native only: every wei the sender needs for the whole plan (amounts + fee values). */
  readonly totalValue: bigint;
}

/** The whole send: batches of at most 1,000, the approval an ERC-20 needs, and the totals. */
export function planMultisend(args: {
  readonly multisend: Address;
  /** Zero address = native. */
  readonly currency: Address;
  readonly recipients: readonly Recipient[];
  readonly terms: Pick<FeeGateTerms, "feeWei" | "pendingFee">;
  readonly batchSize?: number;
}): MultisendPlan {
  if (args.recipients.length === 0) throw new RangeError("A multisend needs at least one recipient.");
  const native = isNative(args.currency);
  const batches = batchRecipients(args.recipients, args.batchSize).map((rows): MultisendBatch => ({
    call: native
      ? buildMultisendNative({ multisend: args.multisend, recipients: rows, terms: args.terms })
      : buildMultisendToken({ multisend: args.multisend, token: args.currency, recipients: rows, terms: args.terms }),
    recipients: rows.length,
    amount: sum(rows),
  }));
  const totalAmount = sum(args.recipients);
  const totalFeeValue = feeSafeValue(args.terms) * BigInt(batches.length);
  return {
    batches,
    approval: native ? null : { token: getAddress(args.currency), spender: args.multisend, amount: totalAmount },
    totalAmount,
    totalFeeValue,
    totalValue: batches.reduce((s, b) => s + b.call.value, 0n),
  };
}
