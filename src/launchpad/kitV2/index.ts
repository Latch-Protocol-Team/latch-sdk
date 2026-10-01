// SPDX-License-Identifier: MIT
/**
 * LaunchpadKitV2: locked, multi-pool launches (single-sided CL ranges and shaped
 * Bin distributions) on the shared Latch core.
 *
 * Independently authored against the kit's compiled ABI and its documented
 * rules (`packages/launchpad/docs/kit-v2-integration.md` section 11); golden
 * values come from the Solidity via `test/fixtures/kitV2Vectors.json`.
 *
 * Everything here that reads the chain takes a kit address. A chain may serve more than one kit
 * generation (`launchpadV2Generations`); `generations.ts` reads them all and merges.
 */

export * from "./types.js";
export * from "./guardGeneration.js";
export * from "./guardFees.js";
export * from "./feeSchedule.js";
export * from "./earningsPlan.js";
export * from "./address.js";
export * from "./binShapes.js";
export * from "./binPrice.js";
export * from "./legs.js";
export * from "./fees.js";
export * from "./validate.js";
export * from "./pads.js";
export * from "./reads.js";
export * from "./generations.js";
export * from "./listing.js"
export * from "./tokenMetadata.js";
export * from "./build.js";
export * from "./allocation.js";
