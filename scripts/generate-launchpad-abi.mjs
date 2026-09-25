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
        "EXPECTED_HOOK_BITMAP",
        "CLOCK_MODE",
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
        "MIN_DECAY_SECONDS",
        "MAX_DECAY_SECONDS",
        "MAX_START_DELAY_SECONDS",
        "CLOCK_MODE",
        "clock",
        "LAUNCH_TOKEN_FACTORY",
        "launchClaimerOf",
        "setLaunchClaimer",
        // the creator tax (LaunchTaxModule)
        "configureTax",
        "getTax",
        "taxRatesAt",
        "currentTaxRates",
        "pendingTax",
        "claimable",
        "totalOwed",
        "backing",
        "settleTax",
        "claim",
        "claimFrom",
        "redeem",
        "skim",
        "protocolRecipient",
        "vault",
        "MAX_TAX_BPS",
        "MIN_PROTOCOL_BPS",
        "MAX_PROTOCOL_BPS",
        "MAX_INTEGRATOR_BPS",
        "MAX_TAX_DURATION_SECONDS",
      ],
      event: [
        "LaunchClaimed",
        "LaunchConfigured",
        "LaunchStarted",
        "LaunchClaimerSet",
        "TaxConfigured",
        "TaxTaken",
        "TaxSettled",
        "TaxClaimed",
        "TaxRedeemed",
        "TaxSkimmed",
      ],
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
        "MIN_DECAY_SECONDS",
        "MAX_DECAY_SECONDS",
        "MAX_START_DELAY_SECONDS",
        "CLOCK_MODE",
        "clock",
        "LAUNCH_TOKEN_FACTORY",
        "launchClaimerOf",
        "setLaunchClaimer",
        // the creator tax (LaunchTaxModule)
        "configureTax",
        "getTax",
        "taxRatesAt",
        "currentTaxRates",
        "pendingTax",
        "claimable",
        "totalOwed",
        "backing",
        "settleTax",
        "claim",
        "claimFrom",
        "redeem",
        "skim",
        "protocolRecipient",
        "vault",
        "MAX_TAX_BPS",
        "MIN_PROTOCOL_BPS",
        "MAX_PROTOCOL_BPS",
        "MAX_INTEGRATOR_BPS",
        "MAX_TAX_DURATION_SECONDS",
      ],
      event: [
        "LaunchClaimed",
        "LaunchConfigured",
        "LaunchStarted",
        "LaunchClaimerSet",
        "TaxConfigured",
        "TaxTaken",
        "TaxSettled",
        "TaxClaimed",
        "TaxRedeemed",
        "TaxSkimmed",
      ],
      error: null,
    },
  },
  /* ---------------------------------------------------------------- kit v2 */
  {
    constant: "LAUNCHPAD_KIT_V2_ABI",
    doc: "`LaunchpadKitV2` - locked, multi-pool (CL and Bin) launches with a Safe-owned launch fee.",
    contract: "LaunchpadKitV2",
    artifact: join(REPO_PACKAGES, "launchpad", "foundry-out", "LaunchpadKitV2.sol", "LaunchpadKitV2.json"),
    keep: {
      function: [
        // launcher, operator, tenant
        "createLaunch",
        "reconfigureLaunch",
        "setTenantConfig",
        "setTenantQuote",
        "claimFees",
        // permissionless
        "flushProtocolFees",
        "registerLaunchpad",
        // owner (the Safe) - encoded for a Safe transaction, never sent by a keeper
        "setLaunchFee",
        "cancelPendingLaunchFee",
        "rescueERC20",
        // views
        "launchFeeWei",
        "pendingLaunchFee",
        "predictLaunchToken",
        "computeLegKey",
        "isLockedLaunch",
        "launchOriginOf",
        "getLeg",
        "getLaunch",
        "legsOf",
        "tenantConfig",
        "tenantQuoteAllowed",
        "feesOwed",
        "totalFeesOwed",
        "owner",
        "pendingOwner",
        "protocolFeeRecipient",
        "launchpadSteward",
        "maxLaunchFeeWei",
        "launchFeeNoticeSeconds",
        "maxIntegratorLaunchFeeWei",
        "maxLegs",
        "maxBinsPerLeg",
        "maxIntegratorBps",
        "maxTaxBps",
        "maxTaxIntegratorBps",
        "tokenFactory",
        "launchRegistry",
        "clPoolManager",
        "binPoolManager",
        "clPositionManager",
        "binPositionManager",
        "clHook",
        "binHook",
        "clLocker",
        "binLocker",
        "CL_HOOK_BITMAP",
        "BIN_HOOK_BITMAP",
        "PROTOCOL_LP_FLOOR_BPS",
        "MAX_LEGS_HARD_CAP",
        "MIN_FEE_NOTICE_SECONDS",
        "MAX_FEE_NOTICE_SECONDS",
        "MAX_START_DELAY_SECONDS",
        "CLOCK_MODE",
      ],
      event: null,
      error: null,
    },
  },
  {
    constant: "LAUNCH_LEGS_ABI",
    doc:
      "`LaunchLegs` - the kit's linked library. Errors only: it runs by DELEGATECALL inside `createLaunch`, so " +
      "its reverts (every `BinShape*` rule R1-R6 among them) surface from the KIT's address. Merge it with " +
      "`LAUNCHPAD_KIT_V2_ABI` to decode a failed launch.",
    contract: "LaunchLegs",
    artifact: join(REPO_PACKAGES, "launchpad", "foundry-out", "LaunchLegs.sol", "LaunchLegs.json"),
    keep: { error: null },
  },
  {
    constant: "LAUNCH_TOKEN_FACTORY_ABI",
    doc: "`LaunchTokenFactory` - deterministic launch tokens; `launchTokenInitCodeHash` feeds off-chain prediction.",
    contract: "LaunchTokenFactory",
    artifact: join(REPO_PACKAGES, "launchpad", "foundry-out", "LaunchTokenFactory.sol", "LaunchTokenFactory.json"),
    keep: {
      function: [
        "predictTokenAddress",
        "launchTokenInitCodeHash",
        "isLaunchToken",
        "deployerOf",
        "MAX_NAME_BYTES",
        "MAX_SYMBOL_BYTES",
        "MAX_METADATA_URI_BYTES",
      ],
      event: null,
      error: null,
    },
  },
  {
    constant: "LATCH_LP_LOCKER_ABI",
    doc: "`LatchLPLocker` - the permanent CL position locker. `collectFees` and `skim` are permissionless.",
    contract: "LatchLPLocker",
    artifact: join(REPO_PACKAGES, "launchpad", "foundry-out", "LatchLPLocker.sol", "LatchLPLocker.json"),
    keep: {
      function: [
        "collectFees",
        "claim",
        "skim",
        "transferCreator",
        "acceptCreator",
        "claimable",
        "totalOwed",
        "getLock",
        "isLocked",
        "lockCount",
        "pendingCreator",
        "splitAmount",
        "positionManager",
        "vault",
        "protocolRecipient",
        "minProtocolBps",
        "maxProtocolBps",
        "maxIntegratorBps",
        "BPS_DENOMINATOR",
      ],
      event: null,
      error: null,
    },
  },
  {
    constant: "LATCH_BIN_LP_LOCKER_ABI",
    doc: "`LatchBinLPLocker` - the permanent Bin share locker. `collectFees` and `skim` are permissionless.",
    contract: "LatchBinLPLocker",
    artifact: join(REPO_PACKAGES, "launchpad", "foundry-out", "LatchBinLPLocker.sol", "LatchBinLPLocker.json"),
    keep: {
      function: [
        "lock",
        "collectFees",
        "claim",
        "skim",
        "transferCreator",
        "acceptCreator",
        "claimable",
        "totalOwed",
        "getLock",
        "getPoolKey",
        "getLockedBins",
        "previewCollect",
        "harvestableShares",
        "isLocked",
        "lockCount",
        "pendingCreator",
        "splitAmount",
        "positionManager",
        "binPoolManager",
        "vault",
        "protocolRecipient",
        "minProtocolBps",
        "maxProtocolBps",
        "maxIntegratorBps",
        "maxBinsPerLock",
        "BPS_DENOMINATOR",
        "MAX_BINS_HARD_CAP",
      ],
      event: null,
      error: null,
    },
  },
  {
    constant: "LATCH_PAD_FACTORY_ABI",
    doc:
      "`LatchPadFactory` - clones a `LatchPad` per caller and makes it a kit tenant in one transaction, for a flat " +
      "site fee (payable `createPad`; the Safe sets the fee inside an immutable cap, increases behind a notice).",
    contract: "LatchPadFactory",
    artifact: join(REPO_PACKAGES, "launchpad", "foundry-out", "LatchPadFactory.sol", "LatchPadFactory.json"),
    keep: {
      function: [
        // anyone
        "createPad",
        "flushProtocolFees",
        // owner (the Safe) - encoded for a Safe transaction, never sent by a keeper
        "setPadFee",
        "cancelPendingPadFee",
        "rescueERC20",
        // views
        "padCount",
        "padAt",
        "pads",
        "isPad",
        "padFeeWei",
        "pendingPadFee",
        "protocolFeesOwed",
        "owner",
        "pendingOwner",
        "KIT",
        "IMPLEMENTATION",
        "protocolFeeRecipient",
        "maxPadFeeWei",
        "padFeeNoticeSeconds",
        // multi-chain identity: the same pad address on every chain, bound to its creator
        "predictPad",
        "padSalt",
        "padOrigin",
        "MIN_FEE_NOTICE_SECONDS",
        "MAX_FEE_NOTICE_SECONDS",
      ],
      event: null,
      error: null,
    },
  },
  {
    constant: "LATCH_SPLIT_FACTORY_ABI",
    doc:
      "`LatchSplitFactory` - Team splits: clones a `LatchSplit` for anyone. Two protocol levers set by the Safe inside " +
      "immutable caps (a flat creation fee in native, and a protocol share of each split's inflow frozen into the " +
      "split at creation); increases behind a notice, decreases immediate.",
    contract: "LatchSplitFactory",
    artifact: join(REPO_PACKAGES, "launchpad", "foundry-out", "LatchSplitFactory.sol", "LatchSplitFactory.json"),
    keep: {
      function: [
        // anyone
        "createSplit",
        "flushProtocolFees",
        // owner (the Safe) - encoded for a Safe transaction
        "setSplitFee",
        "cancelPendingSplitFee",
        "setProtocolShare",
        "cancelPendingProtocolShare",
        "rescueERC20",
        // views
        "splitCount",
        "splitAt",
        "splits",
        "isSplit",
        "splitFeeWei",
        "pendingSplitFee",
        "protocolShareBps",
        "pendingProtocolShare",
        "protocolFeesOwed",
        "owner",
        "pendingOwner",
        "IMPLEMENTATION",
        "protocolFeeRecipient",
        "maxSplitFeeWei",
        "maxProtocolShareBps",
        "noticeSeconds",
      ],
      event: null,
      error: null,
    },
  },
  {
    constant: "LATCH_SPLIT_ABI",
    doc:
      "`LatchSplit` - a team's revenue split: fixed payees and weights, no owner, pull payouts in native or any " +
      "ERC-20, `collect` from Latch lockers / launch guards / RevShareHook and `collectKitFees` from the kit.",
    contract: "LatchSplit",
    artifact: join(REPO_PACKAGES, "launchpad", "foundry-out", "LatchSplit.sol", "LatchSplit.json"),
    keep: {
      function: null,
      event: null,
      error: null,
    },
  },
  {
    constant: "LATCH_POSITION_LOCK_ABI",
    doc:
      "`LatchPositionLock` - time-lock any CLPositionManager position NFT until a date; the lock owner keeps " +
      "collecting its fees, withdraws after `unlockAt`, may only extend. Flat native fee per lock (`LatchFeeGate`).",
    contract: "LatchPositionLock",
    artifact: join(REPO_PACKAGES, "launchpad", "foundry-out", "LatchPositionLock.sol", "LatchPositionLock.json"),
    keep: { function: null, event: null, error: null },
  },
  {
    constant: "LATCH_TOKEN_LOCK_ABI",
    doc:
      "`LatchTokenLock` - ERC-20 / native time-locks and cliff + linear vesting with a fixed schedule; two-step " +
      "beneficiary; flat native fee per lock (`LatchFeeGate`).",
    contract: "LatchTokenLock",
    artifact: join(REPO_PACKAGES, "launchpad", "foundry-out", "LatchTokenLock.sol", "LatchTokenLock.json"),
    keep: { function: null, event: null, error: null },
  },
  {
    constant: "LATCH_MULTISEND_ABI",
    doc:
      "`LatchMultisend` - push native or an ERC-20 to up to 1,000 recipients in one atomic call; flat native fee " +
      "per call (`LatchFeeGate`).",
    contract: "LatchMultisend",
    artifact: join(REPO_PACKAGES, "launchpad", "foundry-out", "LatchMultisend.sol", "LatchMultisend.json"),
    keep: { function: null, event: null, error: null },
  },
  {
    constant: "LATCH_DROP_FACTORY_ABI",
    doc:
      "`LatchDropFactory` - clones, funds and lists a `LatchMerkleDrop` in one call; flat native fee per drop " +
      "(`LatchFeeGate`).",
    contract: "LatchDropFactory",
    artifact: join(REPO_PACKAGES, "launchpad", "foundry-out", "LatchDropFactory.sol", "LatchDropFactory.json"),
    keep: { function: null, event: null, error: null },
  },
  {
    constant: "LATCH_MERKLE_DROP_ABI",
    doc:
      "`LatchMerkleDrop` - one airdrop: a Merkle root of (index, account, amount), claimable until `expiresAt`, " +
      "then swept by its creator. Contract accounts must claim for themselves.",
    contract: "LatchMerkleDrop",
    artifact: join(REPO_PACKAGES, "launchpad", "foundry-out", "LatchMerkleDrop.sol", "LatchMerkleDrop.json"),
    keep: { function: null, event: null, error: null },
  },
  {
    constant: "LATCH_PAD_ABI",
    doc:
      "`LatchPad` - one transferable `LaunchpadKitV2` tenant. The pad is the tenant; the owner configures it; " +
      "fees go to the integrator wallet the owner names, never to the pad.",
    contract: "LatchPad",
    artifact: join(REPO_PACKAGES, "launchpad", "foundry-out", "LatchPad.sol", "LatchPad.json"),
    keep: {
      function: [
        "owner",
        "pendingOwner",
        "name",
        "metadataURI",
        "tenantConfig",
        "configure",
        "setQuote",
        "setMetadata",
        "transferOwnership",
        "acceptOwnership",
        "renounceOwnership",
        "rescueERC20",
        "rescueERC721",
        "rescueNative",
        "KIT",
        "FACTORY",
        "MIN_NAME_BYTES",
        "MAX_NAME_BYTES",
        "MAX_METADATA_URI_BYTES",
      ],
      event: null,
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
