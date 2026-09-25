// SPDX-License-Identifier: MIT
/**
 * Emits the ABIs a DEX front end encodes calldata against: the router, the
 * quoters and both position managers.
 *
 * WHY THIS EXISTS. Until now the SDK shipped an address book that named
 * `universalRouter`, `clQuoter` and `clPositionManager`, and no way to call any
 * of them. Every ABI the package exported was either an EVENT ABI (for
 * indexing) or the registry and launchpad. So an integrator was told exactly
 * where the three contracts they need are, and then had to fetch their
 * interfaces from a block explorer and paste them into their own repo.
 *
 * That is worse than it sounds. A pasted ABI is a snapshot with no provenance:
 * nothing says which deployment it came from, nothing fails when the contract
 * is redeployed with a changed signature, and an explorer's "similar contract
 * match" can be a DIFFERENT contract that verifies against the same bytecode
 * hash prefix. The failure mode is a decode that returns a plausible number.
 *
 * Same licence firewall as the other generators: this reads the *ABI JSON* out
 * of the Foundry build artifacts of GPL-licensed Solidity and emits
 * MIT-licensed TypeScript. It never reads Solidity sources, comments or
 * NatSpec, so nothing expressive crosses the boundary — an ABI is a
 * machine-generated interface description.
 *
 * Usage: node scripts/generate-trading-abi.mjs [--check]
 */

import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { emitModule, renderAbiModule } from "./lib/curated-abi.mjs";

const SCRIPT = "generate-trading-abi.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "..");
const REPO_PACKAGES = resolve(PKG_ROOT, "..");
const OUT_FILE = join(PKG_ROOT, "src", "trading", "generated", "abi.ts");

/**
 * Curated on purpose. A full ABI dump of `UniversalRouter` carries pausing,
 * ownership and stable-swap plumbing that no integrator calls and that would
 * bury the two functions they do.
 *
 * Every name is checked against the artifact, so a rename upstream fails the
 * generator rather than quietly shrinking what we emit.
 */
const SOURCES = [
  {
    constant: "UNIVERSAL_ROUTER_ABI",
    doc:
      "`UniversalRouter` — the swap entrypoint. Two `execute` overloads and the full error " +
      "surface, which is what turns a failed swap into a diagnosable one.",
    contract: "UniversalRouter",
    artifact: join(REPO_PACKAGES, "router", "foundry-out", "UniversalRouter.sol", "UniversalRouter.json"),
    keep: {
      function: [
        "execute",
        "clPoolManager",
        "binPoolManager",
        "vault",
        "paused",
      ],
      /* `Paused`/`Unpaused` only. A router that is paused reverts every swap,
         and an integrator watching for that is watching for the right thing;
         ownership and stable-swap events are governance, not trading. */
      event: ["Paused", "Unpaused"],
      error: null, // every error: this is the diagnostic surface for a reverted swap
    },
  },
  {
    constant: "CL_QUOTER_ABI",
    doc:
      "`CLQuoter` — simulated swap output. Every function here REVERTS with the answer " +
      "encoded in the revert data, so these are `eth_call`-only and cost gas if sent.",
    contract: "CLQuoter",
    /* NOT `foundry-out/lens/CLQuoter.sol/...`. That path exists in older local
       trees as a stale artifact Foundry never deleted; a clean build of
       src/pool-cl/lens/CLQuoter.sol writes it here. CI builds clean, so a
       stale path fails the `generated-abis` job instead of reading a dead file. */
    artifact: join(REPO_PACKAGES, "periphery", "foundry-out", "CLQuoter.sol", "CLQuoter.json"),
    keep: {
      function: [
        "quoteExactInputSingle",
        "quoteExactOutputSingle",
        "quoteExactInput",
        "quoteExactOutput",
        "quoteExactInputSingleList",
        "poolManager",
        "vault",
      ],
      event: [], // a lens emits nothing
      error: null,
    },
  },
  {
    constant: "BIN_QUOTER_ABI",
    doc:
      "`BinQuoter` — simulated swap output for liquidity-book pools. Same `QuoteExactSingleParams` " +
      "shape as the CL quoter (`zeroForOne` is `swapForY`), same revert-with-the-answer mechanics: " +
      "`eth_call`-only.",
    contract: "BinQuoter",
    artifact: join(REPO_PACKAGES, "periphery", "foundry-out", "BinQuoter.sol", "BinQuoter.json"),
    keep: {
      function: [
        "quoteExactInputSingle",
        "quoteExactOutputSingle",
        "quoteExactInput",
        "quoteExactOutput",
        "quoteExactInputSingleList",
        "poolManager",
        "vault",
      ],
      event: [],
      error: null,
    },
  },
  {
    constant: "CL_POSITION_MANAGER_ABI",
    doc:
      "`CLPositionManager` — liquidity positions as ERC-721. `modifyLiquidities` takes an " +
      "encoded action plan, not named arguments; the reads below are what a portfolio screen needs.",
    contract: "CLPositionManager",
    artifact: join(
      REPO_PACKAGES,
      "periphery",
      "foundry-out",
      "CLPositionManager.sol",
      "CLPositionManager.json",
    ),
    keep: {
      function: [
        "modifyLiquidities",
        "modifyLiquiditiesWithoutLock",
        "initializePool",
        "getPoolAndPositionInfo",
        "getPositionLiquidity",
        "positions",
        "poolKeys",
        "positionInfo",
        "nextTokenId",
        "ownerOf",
        "balanceOf",
        "tokenURI",
        "approve",
        "setApprovalForAll",
        "isApprovedForAll",
        "getApproved",
        "transferFrom",
        "permit2",
        "clPoolManager",
        "vault",
        "WETH9",
      ],
      /* What a portfolio screen indexes. `Transfer` is how a position changes
         hands and how `ownerOf` is reconstructed from logs; `MintPosition` and
         `ModifyLiquidity` are the position's own history. */
      event: ["Transfer", "Approval", "ApprovalForAll", "MintPosition", "ModifyLiquidity"],
      error: null,
    },
  },
  {
    constant: "BIN_POSITION_MANAGER_ABI",
    doc:
      "`BinPositionManager` — liquidity-book positions as per-bin fungible shares (ERC-1155-like, " +
      "no `uri` and no receiver callback). `modifyLiquidities` takes the same encoded action plan; " +
      "`initializePool` opens a pool at a bin id; the reads are what a positions screen needs.",
    contract: "BinPositionManager",
    artifact: join(
      REPO_PACKAGES,
      "periphery",
      "foundry-out",
      "BinPositionManager.sol",
      "BinPositionManager.json",
    ),
    keep: {
      function: [
        "modifyLiquidities",
        "modifyLiquiditiesWithoutLock",
        "initializePool",
        "positions",
        "balanceOf",
        "balanceOfBatch",
        "totalSupply",
        "approveForAll",
        "isApprovedForAll",
        "batchTransferFrom",
        "permit2",
        "binPoolManager",
        "vault",
        "WETH9",
      ],
      /* `TransferBatch` is the only transfer event: mints, burns and transfers
         all emit it, so a holder's bins are reconstructed from it. */
      event: ["TransferBatch", "ApprovalForAll"],
      error: null,
    },
  },
];

function main() {
  const checkOnly = process.argv.slice(2).includes("--check");
  const { contents, slices } = renderAbiModule(SCRIPT, SOURCES);

  const upToDate = emitModule(OUT_FILE, contents, checkOnly);

  if (checkOnly) {
    if (!upToDate) {
      console.error("Generated trading ABIs are stale. Run `npm run generate`.");
      process.exit(1);
    }
    console.log("trading ABIs are up to date.");
    return;
  }

  for (const { source, abi } of slices) {
    console.log(`  ${source.constant.padEnd(26)} ${String(abi.length).padStart(3)} members`);
  }
  const total = slices.reduce((n, s) => n + s.abi.length, 0);
  console.log(`generated ${total} ABI members into src/trading/generated/abi.ts`);
}

main();
