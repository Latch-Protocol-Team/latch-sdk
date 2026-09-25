// SPDX-License-Identifier: MIT
/**
 * LaunchpadKitV2: locked, multi-pool launches (single-sided CL ranges and shaped
 * Bin distributions) on the shared Latch core.
 *
 * Independently authored against the kit's compiled ABI and its documented
 * rules (`packages/launchpad/docs/kit-v2-integration.md` section 11); golden
 * values come from the Solidity via `test/fixtures/kitV2Vectors.json`.
 *
 * NOT DEPLOYED on any chain as of this build: `LatchDeployment.launchpadV2`
 * is all `null`. Everything here that reads the chain takes a kit address.
 */

export * from "./types.js";
export * from "./address.js";
export * from "./binShapes.js";
export * from "./binPrice.js";
export * from "./legs.js";
export * from "./fees.js";
export * from "./validate.js";
export * from "./pads.js";
export * from "./reads.js";
export * from "./listing.js"
export * from "./tokenMetadata.js";
export * from "./build.js";
export * from "./allocation.js";
