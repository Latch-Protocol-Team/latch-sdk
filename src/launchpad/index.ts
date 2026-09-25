// SPDX-License-Identifier: MIT
/**
 * The launchpad.
 *
 * `LaunchpadKit` is the one-call launch factory: it creates the pool, configures
 * the launch-guard hook's fee decay schedule, seeds liquidity and lists the hook
 * in the registry. This module exposes the ABIs needed to encode those calls and
 * to decode the events they emit.
 *
 * `LaunchpadKitV2` (not deployed yet) launches a fresh token into 1..N LOCKED
 * pools - single-sided CL ranges and shaped Bin distributions - in one call. Its
 * helpers live in `./kitV2/`.
 *
 * `./generated/abi.js` is produced by `npm run generate:launchpad` from the
 * compiled artifacts; it is a curated slice, not the full ABI of each contract.
 */

import {
  BIN_LAUNCH_GUARD_HOOK_ABI,
  LATCH_BIN_LP_LOCKER_ABI,
  LATCH_PAD_ABI,
  LATCH_PAD_FACTORY_ABI,
  LATCH_LP_LOCKER_ABI,
  LAUNCHPAD_KIT_ABI,
  LAUNCHPAD_KIT_V2_ABI,
  LAUNCH_GUARD_HOOK_ABI,
  LAUNCH_LEGS_ABI,
  LAUNCH_TOKEN_FACTORY_ABI,
} from "./generated/abi.js";
import { LAUNCHPAD_KIT_BLOCK_ABI, LAUNCH_GUARD_HOOK_BLOCK_ABI } from "./legacy/blockAbi.js";

export * from "./generated/abi.js";
/* Frozen ABIs of the block-numbered kit and hook still deployed on Robinhood. */
export * from "./legacy/blockAbi.js";

/* The pieces `LaunchpadKit` assumes a caller has. `sqrtPriceForLaunch` is
   named in the contract's own docstring; before this it did not exist. */
export * from "./price.js";
export * from "./presets.js";
export * from "./params.js";
/* Exact tick math: the tick core stores for a price decides the kit v2 CL side rule. */
export * from "./tickMath.js";
/* LaunchpadKitV2: address prediction, leg keys, CL ranges, Bin shapes, fees, validation. */
export * from "./kitV2/index.js";

/** Launchpad ABIs re-exported under short names, matching `events`' `EventAbis`. */
export const LaunchpadAbis = {
  LaunchpadKit: LAUNCHPAD_KIT_ABI,
  LaunchGuardHook: LAUNCH_GUARD_HOOK_ABI,
  BinLaunchGuardHook: BIN_LAUNCH_GUARD_HOOK_ABI,
  LaunchpadKitV2: LAUNCHPAD_KIT_V2_ABI,
  LaunchLegs: LAUNCH_LEGS_ABI,
  LaunchTokenFactory: LAUNCH_TOKEN_FACTORY_ABI,
  LatchLPLocker: LATCH_LP_LOCKER_ABI,
  LatchBinLPLocker: LATCH_BIN_LP_LOCKER_ABI,
  LatchPadFactory: LATCH_PAD_FACTORY_ABI,
  LatchPad: LATCH_PAD_ABI,
} as const;

/** The block-numbered generation, by the same short names. */
export const LaunchpadBlockAbis = {
  LaunchpadKit: LAUNCHPAD_KIT_BLOCK_ABI,
  LaunchGuardHook: LAUNCH_GUARD_HOOK_BLOCK_ABI,
} as const;

/**
 * Every error a failed `createLaunch` can revert with FROM THE KIT'S ADDRESS:
 * the kit's own errors plus `LaunchLegs`', which runs by DELEGATECALL inside it
 * (every `BinShape*` rule among them). Pass it to viem's `decodeErrorResult`.
 * Errors raised inside the guards, lockers, factory or core bubble up unchanged
 * and need those contracts' ABIs as well.
 */
export const LAUNCHPAD_KIT_V2_REVERT_ABI = [
  ...LAUNCHPAD_KIT_V2_ABI.filter((x) => x.type === "error"),
  ...LAUNCH_LEGS_ABI.filter((x) => !LAUNCHPAD_KIT_V2_ABI.some((k) => k.type === "error" && k.name === x.name)),
];
