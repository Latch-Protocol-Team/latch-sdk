// SPDX-License-Identifier: MIT
/**
 * Latch lockers: `LatchPositionLock` (time-locked CL liquidity positions) and
 * `LatchTokenLock` (ERC-20 / native time-locks and vesting).
 *
 * Readers return what the chain says; builders return `{ to, data, value }`
 * and never send. Each lock pays one flat native fee, ENFORCED BY THE
 * CONTRACT (`LatchFeeGate`); `readFeeGate` reads it and the builders size
 * `msg.value` with `feeSafeValue`, which the contract refunds any surplus of.
 * Addresses come from the address book (`LatchDeployment.positionLock`,
 * `LatchDeployment.tokenLock`); `null` there means not deployed.
 */

export { LATCH_POSITION_LOCK_ABI, LATCH_TOKEN_LOCK_ABI } from "../launchpad/generated/abi.js";
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
export { positionAmounts } from "./clAmounts.js";
export type { PositionAmounts } from "./clAmounts.js";
export * from "./position.js";
export * from "./token.js";
export * from "./lpLockers.js";
