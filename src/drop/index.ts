// SPDX-License-Identifier: MIT
/**
 * Latch distribution: `LatchMultisend` (push native or an ERC-20 to up to
 * 1,000 addresses per call) and `LatchDropFactory` / `LatchMerkleDrop`
 * (claimable Merkle airdrops).
 *
 * Readers return what the chain says; builders return `{ to, data, value }`
 * and never send. Every multisend call and every drop pays one flat native
 * fee, ENFORCED BY THE CONTRACT (`LatchFeeGate`). Addresses come from the
 * address book (`LatchDeployment.multisend`, `LatchDeployment.dropFactory`).
 */

export { LATCH_DROP_FACTORY_ABI, LATCH_MERKLE_DROP_ABI, LATCH_MULTISEND_ABI } from "../launchpad/generated/abi.js";
export {
  NATIVE,
  buildErc20Approve,
  buildFlushProtocolFees,
  decodePendingUtilityFee,
  feeMayRise,
  feeSafeValue,
  isNative,
  readErc20Allowance,
  readFeeGate,
} from "../utilities/feeGate.js";
export type { FeeGateTerms, PendingUtilityFee, UtilityCall } from "../utilities/feeGate.js";
export * from "./amounts.js";
export * from "./multisend.js";
export * from "./merkle.js";
export * from "./drop.js";
export * from "./holders.js";
