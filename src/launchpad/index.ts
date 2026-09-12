// SPDX-License-Identifier: MIT
/**
 * The launchpad.
 *
 * `LaunchpadKit` is the one-call launch factory: it creates the pool, configures
 * the launch-guard hook's fee decay schedule, seeds liquidity and lists the hook
 * in the registry. This module exposes the ABIs needed to encode those calls and
 * to decode the events they emit.
 *
 * `./generated/abi.js` is produced by `npm run generate:launchpad` from the
 * compiled artifacts; it is a curated slice, not the full ABI of each contract.
 */

import {
  BIN_LAUNCH_GUARD_HOOK_ABI,
  LAUNCHPAD_KIT_ABI,
  LAUNCH_GUARD_HOOK_ABI,
} from "./generated/abi.js";

export * from "./generated/abi.js";

/** Launchpad ABIs re-exported under short names, matching `events`' `EventAbis`. */
export const LaunchpadAbis = {
  LaunchpadKit: LAUNCHPAD_KIT_ABI,
  LaunchGuardHook: LAUNCH_GUARD_HOOK_ABI,
  BinLaunchGuardHook: BIN_LAUNCH_GUARD_HOOK_ABI,
} as const;
