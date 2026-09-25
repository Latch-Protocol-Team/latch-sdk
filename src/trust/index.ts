// SPDX-License-Identifier: MIT
/**
 * Token trust: one read of everything the Latch contracts hold about a token
 * that bears on trusting it - liquidity locks (time-locked and permanent LP
 * locker, per pool), vesting / token locks, the creator tax a Kit v2 launch
 * guard takes, each pool's LP and protocol fee, and what `LatchRegistry`
 * records about each pool's hook - every figure with the contract it came from.
 *
 * `readTokenTrust` reads; `./format.ts` turns a read into words. Neither says
 * "safe": a registry listing is what the registry records, not an audit.
 */

export * from "./types.js";
export { readTokenTrust, mergePoolCandidates, clLiquidityFacts, isContractRevert, trustErrorMessage } from "./read.js";
export type { ReadTokenTrustOptions, TrustContracts } from "./read.js";
export * from "./format.js";
