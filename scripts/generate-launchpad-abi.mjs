// SPDX-License-Identifier: MIT
/**
 * Emits the launchpad ABIs the SDK's `launchpad` module encodes calldata against.
 *
 * Same licence firewall as `generate-events.mjs`: this reads the *ABI JSON* out of
 * the Foundry build artifacts of the GPL-licensed Solidity packages and emits
 * MIT-licensed TypeScript. It never reads Solidity sources, comments or NatSpec,
 * so nothing expressive crosses the boundary - an ABI is a machine-generated
 * interface description, which is exactly what an MIT consumer is entitled to
 * build against without inheriting the GPL of the implementation behind it.
 *
 * Usage: node scripts/generate-launchpad-abi.mjs [--check]
 */

import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { emitModule, renderAbiModule } from "./lib/curated-abi.mjs";

const SCRIPT = "generate-launchpad-abi.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "..");
const REPO_PACKAGES = resolve(PKG_ROOT, "..");
const OUT_FILE = join(PKG_ROOT, "src", "launchpad", "generated", "abi.ts");

/**
 * Each entry names one exported constant and the artifact it is read from.
 * Only the members the SDK actually encodes or decodes are kept, so the emitted
 * file stays reviewable rather than being a dump of every internal getter.
 *
 * Every name below is checked against the artifact; a rename upstream fails the
 * generator instead of quietly shrinking the emitted ABI.
 */
const SOURCES = [
  {
    constant: "LAUNCHPAD_KIT_ABI",
    doc: "`LaunchpadKit` - the one-call launch factory.",
    contract: "LaunchpadKit",
    artifact: join(REPO_PACKAGES, "launchpad", "foundry-out", "LaunchpadKit.sol", "LaunchpadKit.json"),
    keep: {
      function: [
        "createLaunch",
        "reconfigureLaunch",
        "computePoolKey",
        "previewSchedule",
        "getLaunchRecord",
        "listHook",
        "hook",
        "clPoolManager",
        "positionManager",
        "permit2",
        "registry",
        "hookBitmap",
        "blockTimeCentis",
        "EXPECTED_HOOK_BITMAP",
      ],
      event: ["LaunchCreated", "LaunchSeeded", "LaunchReconfigured", "HookListed"],
      error: null, // keep every error: they are the diagnostic surface
    },
  },
  {
    constant: "LAUNCH_GUARD_HOOK_ABI",
    doc: "`LaunchGuardHook` - the CL launch hook the kit drives.",
    contract: "LaunchGuardHook",
    artifact: join(REPO_PACKAGES, "hooks", "foundry-out", "LaunchGuardHook.sol", "LaunchGuardHook.json"),
    keep: {
      function: [
        "configureLaunch",
        "getLaunch",
        "launchOwner",
        "feeAt",
        "currentFee",
        "getHooksRegistrationBitmap",
        "poolManager",
        "MAX_INITIAL_FEE",
        "MAX_FINAL_FEE",
        "MAX_DECAY_BLOCKS",
        "MAX_START_DELAY",
      ],
      event: ["LaunchClaimed", "LaunchConfigured", "LaunchStarted"],
      error: null,
    },
  },
  {
    constant: "BIN_LAUNCH_GUARD_HOOK_ABI",
    doc: "`BinLaunchGuardHook` - the liquidity-book variant, including `beforeMint`.",
    contract: "BinLaunchGuardHook",
    artifact: join(REPO_PACKAGES, "hooks", "foundry-out", "BinLaunchGuardHook.sol", "BinLaunchGuardHook.json"),
    keep: {
      function: [
        "configureLaunch",
        "getLaunch",
        "launchOwner",
        "feeAt",
        "currentFee",
        "getHooksRegistrationBitmap",
        "poolManager",
        "MAX_INITIAL_FEE",
        "MAX_FINAL_FEE",
        "MAX_DECAY_BLOCKS",
        "MAX_START_DELAY",
      ],
      event: ["LaunchClaimed", "LaunchConfigured", "LaunchStarted"],
      error: null,
    },
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const checkOnly = process.argv.slice(2).includes("--check");
  const { contents, slices } = renderAbiModule(SCRIPT, SOURCES);

  const upToDate = emitModule(OUT_FILE, contents, checkOnly);

  if (checkOnly) {
    if (!upToDate) {
      console.error("Generated launchpad ABIs are stale. Run `npm run generate`.");
      process.exit(1);
    }
    console.log("launchpad ABIs are up to date.");
    return;
  }

  for (const { source, abi } of slices) {
    console.log(`  ${source.constant.padEnd(26)} ${String(abi.length).padStart(3)} members`);
  }
  const total = slices.reduce((n, s) => n + s.abi.length, 0);
  console.log(`generated ${total} ABI members into src/launchpad/generated/abi.ts`);
}

main();
