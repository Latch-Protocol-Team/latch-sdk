// SPDX-License-Identifier: MIT
/* ============================================================================
   What a Kit v2 launch costs in native currency, and the tenant it runs under.

   `createLaunch` is payable and requires

       msg.value >= launchFeeWei() + integratorLaunchFeeWei

   and REFUNDS any excess to `msg.sender` at the end of the call. Two things make
   "just read launchFeeWei()" not quite enough:

   1. A SCHEDULED INCREASE. The Safe may announce a higher fee; it becomes the fee
      BY ITSELF at `effectiveAt` (no apply transaction). `launchFeeWei()` answers
      for the block it is read in, `pendingLaunchFee()` returns the announced
      value and its timestamp. A transaction signed before `effectiveAt` and
      mined after it pays the new fee or reverts `InsufficientLaunchFee`. Sending
      the higher of the two is safe: the surplus comes back in the same call.

   2. THE TENANT. A launch naming a tenant must restate that tenant's stored
      `integrator`, `integratorBps` and `integratorLaunchFeeWei` exactly
      (`TenantConfigMismatch`), and the tenant must be `active`. So the integrator
      fee is READ from `tenantConfig(tenant)`, never typed.

   Nothing here is a price. These are wei amounts; a USD figure would need an
   oracle the kit does not have.
   ============================================================================ */

import type { Address, PublicClient } from "viem";

import { LAUNCHPAD_KIT_V2_ABI } from "../generated/abi.js";
import { PRESET_NAMES, type PresetName } from "../presets.js";
import { BIN_SHAPE_NAMES, type BinShapeName, type KitV2Caps, type TenantConfigV2 } from "./types.js";

const ZERO = "0x0000000000000000000000000000000000000000";

/** `pendingLaunchFee()`, with its `(0, 0)` "none" answer turned into `null`. */
export interface PendingLaunchFee {
  readonly feeWei: bigint;
  /** Unix seconds (`block.timestamp`). */
  readonly effectiveAt: bigint;
}

export interface LaunchValueQuote {
  /** The protocol launch fee a launch in the block that was read pays. */
  readonly launchFeeWei: bigint;
  /** The tenant's (or the direct launcher's chosen) integrator fee. */
  readonly integratorFeeWei: bigint;
  /** `launchFeeWei + integratorFeeWei`: the minimum `msg.value` right now. */
  readonly minimumValue: bigint;
  /** An announced increase not yet in force, or `null`. */
  readonly pending: PendingLaunchFee | null;
  /**
   * `max(minimumValue, pending.feeWei + integratorFeeWei)`: a value that cannot
   * revert `InsufficientLaunchFee` whichever side of `effectiveAt` the transaction
   * lands. The kit refunds the difference to the sender in the same call.
   */
  readonly safeValue: bigint;
}

/** Pure form of the quote, from values already read. */
export function computeLaunchValue(args: {
  readonly launchFeeWei: bigint;
  readonly pending: PendingLaunchFee | null;
  readonly integratorFeeWei: bigint;
}): LaunchValueQuote {
  if (args.launchFeeWei < 0n || args.integratorFeeWei < 0n) throw new RangeError("fees are non-negative");
  const minimumValue = args.launchFeeWei + args.integratorFeeWei;
  const atPending = args.pending === null ? 0n : args.pending.feeWei + args.integratorFeeWei;
  return {
    launchFeeWei: args.launchFeeWei,
    integratorFeeWei: args.integratorFeeWei,
    minimumValue,
    pending: args.pending,
    safeValue: atPending > minimumValue ? atPending : minimumValue,
  };
}

/** `pendingLaunchFee()` decoded. `(0, 0)` means none. */
export function decodePendingLaunchFee(raw: readonly [bigint, bigint]): PendingLaunchFee | null {
  const [feeWei, effectiveAt] = raw;
  return effectiveAt === 0n ? null : { feeWei, effectiveAt };
}

/** A `TenantConfig` with its two bitmasks expanded into names. */
export interface DecodedTenantConfig {
  readonly integrator: Address;
  readonly integratorBps: number;
  readonly integratorLaunchFeeWei: bigint;
  readonly allowedPresets: readonly PresetName[];
  /** Empty means the tenant forbids Bin legs entirely. */
  readonly allowedBinShapes: readonly BinShapeName[];
  readonly restrictQuotes: boolean;
  readonly active: boolean;
  /** Highest creator-tax rate (buy or sell, bps) a launch through this tenant may set. 0 forbids a tax. */
  readonly maxTaxBps: number;
  /** The tax's integrator bucket (bps of the tax) a launch through this tenant must restate. */
  readonly taxIntegratorBps: number;
  /** `false` for a tenant that never called `setTenantConfig`: every field is zero. */
  readonly configured: boolean;
}

function maskNames<T extends string>(mask: number, names: readonly T[]): T[] {
  return names.filter((_, i) => ((mask >> i) & 1) === 1);
}

/** Decodes `tenantConfig(tenant)`. Bit i of `allowedPresets` allows `Preset(i)`; of `allowedBinShapes`, `BinShape(i)`. */
export function decodeTenantConfig(c: TenantConfigV2): DecodedTenantConfig {
  return {
    integrator: c.integrator,
    integratorBps: c.integratorBps,
    integratorLaunchFeeWei: c.integratorLaunchFeeWei,
    allowedPresets: maskNames(c.allowedPresets, PRESET_NAMES),
    allowedBinShapes: maskNames(c.allowedBinShapes, BIN_SHAPE_NAMES),
    restrictQuotes: c.restrictQuotes,
    active: c.active,
    maxTaxBps: c.maxTaxBps,
    taxIntegratorBps: c.taxIntegratorBps,
    configured: c.allowedPresets !== 0,
  };
}

/** `tenantConfig(tenant)`, decoded. */
export async function readTenantConfig(client: PublicClient, kit: Address, tenant: Address): Promise<DecodedTenantConfig> {
  const raw = await client.readContract({
    address: kit,
    abi: LAUNCHPAD_KIT_V2_ABI,
    functionName: "tenantConfig",
    args: [tenant],
  });
  return decodeTenantConfig(raw);
}

/**
 * The `msg.value` quote for a launch.
 *
 * - `tenant` set: the integrator fee is the tenant's stored one, and a tenant
 *   that is not `active` throws (the launch would revert `TenantNotActive`).
 * - `tenant` absent or zero: a direct launch; `integratorLaunchFeeWei` is the
 *   caller's own choice (default 0) and must not exceed `maxIntegratorLaunchFeeWei()`.
 */
export async function readLaunchValue(
  client: PublicClient,
  kit: Address,
  opts: { readonly tenant?: Address; readonly integratorLaunchFeeWei?: bigint } = {},
): Promise<LaunchValueQuote & { readonly tenant: DecodedTenantConfig | null }> {
  const [launchFeeWei, pendingRaw] = await Promise.all([
    client.readContract({ address: kit, abi: LAUNCHPAD_KIT_V2_ABI, functionName: "launchFeeWei" }),
    client.readContract({ address: kit, abi: LAUNCHPAD_KIT_V2_ABI, functionName: "pendingLaunchFee" }),
  ]);
  const pending = decodePendingLaunchFee(pendingRaw);

  const tenantAddress = opts.tenant;
  if (tenantAddress !== undefined && tenantAddress.toLowerCase() !== ZERO) {
    const tenant = await readTenantConfig(client, kit, tenantAddress);
    if (!tenant.active) {
      throw new Error(`tenant ${tenantAddress} has no active config on ${kit}; the launch would revert TenantNotActive`);
    }
    if (opts.integratorLaunchFeeWei !== undefined && opts.integratorLaunchFeeWei !== tenant.integratorLaunchFeeWei) {
      throw new Error(
        `integratorLaunchFeeWei ${opts.integratorLaunchFeeWei} differs from tenant ${tenantAddress}'s stored ` +
          `${tenant.integratorLaunchFeeWei}; the launch would revert TenantConfigMismatch`,
      );
    }
    return { ...computeLaunchValue({ launchFeeWei, pending, integratorFeeWei: tenant.integratorLaunchFeeWei }), tenant };
  }

  const integratorFeeWei = opts.integratorLaunchFeeWei ?? 0n;
  if (integratorFeeWei > 0n) {
    const cap = await client.readContract({
      address: kit,
      abi: LAUNCHPAD_KIT_V2_ABI,
      functionName: "maxIntegratorLaunchFeeWei",
    });
    if (integratorFeeWei > cap) {
      throw new Error(`integratorLaunchFeeWei ${integratorFeeWei} is above the kit's cap ${cap} (IntegratorFeeAboveCap)`);
    }
  }
  return { ...computeLaunchValue({ launchFeeWei, pending, integratorFeeWei }), tenant: null };
}

/** The deployment's launch caps, read off the kit. The authority over `KIT_V2_DEPLOY_SCRIPT_CAPS`. */
export async function readKitV2Caps(client: PublicClient, kit: Address): Promise<KitV2Caps> {
  const [maxLegs, maxBinsPerLeg] = await Promise.all([
    client.readContract({ address: kit, abi: LAUNCHPAD_KIT_V2_ABI, functionName: "maxLegs" }),
    client.readContract({ address: kit, abi: LAUNCHPAD_KIT_V2_ABI, functionName: "maxBinsPerLeg" }),
  ]);
  return { maxLegs, maxBinsPerLeg };
}
