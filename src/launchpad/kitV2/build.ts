// SPDX-License-Identifier: MIT
/* ============================================================================
   Building a `LaunchpadKitV2.createLaunch` call from a form draft.

   The kit mints the token, so there is no approval step and nothing the
   launcher must hold: the only thing the wallet sends is native currency for
   the launch fees (`msg.value`), and the kit refunds any surplus in the same
   call. Everything else - the pools, the seeded positions, the locks, the
   registry record - is a consequence of the argument built here.

   Proven end to end on a Robinhood (4663) anvil fork as the create-latch-dex
   template's `createLaunchV2.ts` (2026-09-17); moved here so the template, the
   hosted pad sites and the widgets build a launch through one implementation.

   Three things this module refuses to guess:

     * THE TOKEN ADDRESS. A leg's pool id contains the launch token's address,
       and so does the CL side rule (which side of the price the range must sit
       on) and the Bin id mapping. The kit makes the address predictable from
       the launcher and a salt; `buildLaunchV2` cross-checks its own computation
       against the kit's `predictLaunchToken` before any pool id is derived from
       it, and the pure `buildLaunchParamsV2` takes the address as an input.
     * THE OPENING PRICE'S ENCODING. A CL leg takes a `sqrtPriceX96`, a Bin leg
       an `activeId`; both fold in token order and decimals, and both are
       snapped - a CL price onto the range edge, a Bin price onto a bin. The
       snapped price is returned so a screen can show what will be set, not
       what was typed.
     * THE TENANT'S TERMS. With a tenant configured, `integrator`,
       `integratorBps` and `integratorLaunchFeeWei` are the STORED values, read
       off the kit by `readKitV2Limits`; the kit reverts a launch that restates
       them differently.

   Nothing here sends anything. The result carries calldata for a wallet and
   the SDK's findings against it; the caller simulates the exact bytes first.
   ============================================================================ */

import { encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";

import { LAUNCHPAD_KIT_V2_ABI } from "../generated/abi.js";
import { PRESET } from "../presets.js";
import { priceFromSqrtPriceX96, sqrtPriceForLaunch } from "../price.js";
import { predictLaunchTokenChecked } from "./address.js";
import { binActiveIdForLaunch, binLaunchPriceAtId } from "./binPrice.js";
import { computeKitV2LegKey, kitV2CLLaunchRange, type KitV2LegKey } from "./legs.js";
import { NATIVE_ADDRESS, type KitV2Limits } from "./reads.js";
import {
  BIN_SHAPE,
  EMPTY_BIN_LEG,
  EMPTY_CL_LEG,
  KIT_V2_BPS,
  LEG_KIND,
  NO_TAX,
  type BinLegParamsV2,
  type BinShapeName,
  type CLLegParamsV2,
  type LaunchParamsV2,
  type LegParamsV2,
  type TaxParamsV2,
} from "./types.js";
import { MAX_TELEGRAM_HANDLE_BYTES, MAX_X_HANDLE_BYTES, assertHandle, type LaunchListingInput } from "./listing.js";
import { validateLaunchParamsV2, type LaunchV2Issue, type LaunchV2ValidationContext } from "./validate.js";

/** The kit's factory mints 18-decimal tokens (`LaunchToken` is a plain ERC-20). */
export const LAUNCH_TOKEN_DECIMALS = 18;

/** One leg as a form holds it. The CL fields are read for a CL leg, the Bin fields for a Bin leg. */
export interface LegDraftV2 {
  readonly kind: "CL" | "Bin";
  /** The zero address for the chain's native asset. */
  readonly quote: Address;
  readonly quoteDecimals: number;
  /** Share of `seedSupply` this leg seeds, in basis points. All legs must sum to 10000. */
  readonly weightBps: number;
  /** Opening price: whole quote tokens per whole launch token, as a decimal string. */
  readonly quotePerLaunchToken: string;
  /** Raw quote units. `0n` means uncapped. */
  readonly maxBuyPerTx: bigint;
  /* CL */
  readonly tickSpacing: number;
  /** Width of the single-sided range, in tick spacings. */
  readonly widthInSpacings: number;
  /* Bin */
  readonly binStep: number;
  readonly shape: BinShapeName;
  readonly binCount: number;
}

/** A launch as a form holds it. */
export interface LaunchDraftV2 {
  readonly name: string;
  readonly symbol: string;
  readonly metadataURI: string;
  /** Raw 18-decimal units. */
  readonly totalSupply: bigint;
  readonly seedSupply: bigint;
  /** Receives `totalSupply - seedSupply`. Required when that is non-zero. */
  readonly allocationRecipient: Address;
  readonly creator: Address;
  readonly operator: Address;
  readonly steward: Address;
  /** The protocol's share of LP fees, in basis points, inside the lockers' bounds. */
  readonly protocolBps: number;
  readonly schedule: {
    readonly preset: number;
    readonly initialFeeBips: number;
    readonly finalFeeBips: number;
    readonly decaySeconds: number;
    readonly startDelaySeconds: number;
  };
  /**
   * The creator tax, or `undefined` / both rates zero for none. The integrator's share of it is
   * NOT a draft field: it is the tenant's stored `taxIntegratorBps` (or the direct terms), exactly
   * as the LP-lock integrator share is. `creatorBps` is what is left after protocol and integrator.
   */
  readonly tax?: {
    readonly buyBps: number;
    readonly sellBps: number;
    /** Seconds of tax after trading opens. */
    readonly taxSeconds: number;
    /** The protocol's share of the tax, bps, inside the guard's [10%, 50%]. */
    readonly protocolBps: number;
  };
  readonly legs: readonly LegDraftV2[];
  /**
   * The registry listing, exactly `LaunchMetadata`'s four strings. Handles are
   * bare (`latchprotocol`, no "@", no URL); the builder reports a malformed one
   * as an error issue naming `InvalidHandle`, the contract's own refusal.
   */
  readonly listing: LaunchListingInput;
  /** Folded with the launcher into the token's CREATE2 salt. Random per form session. */
  readonly userSalt: Hex;
  /** The account that will send the transaction. Determines the token address. */
  readonly launcher: Address;
}

/** What one leg resolved to, for the screen. */
export interface ResolvedLegV2 {
  readonly key: KitV2LegKey;
  readonly kind: "CL" | "Bin";
  /** The opening price the pool will actually be born at, quote per launch token (8 significant digits). */
  readonly openingPrice: string;
  /** How far the snap moved the typed price, as a fraction (0.01 = 1%). */
  readonly snapFraction: number;
}

/** What the pure builder needs beside the draft. */
export interface BuildLaunchV2Context {
  /** The launch token's address, from `predictLaunchTokenChecked`. */
  readonly token: Address;
  /** `readKitV2Limits(client, kit, { tenant | direct })`: env, caps, locker bounds, tenant, integrator terms and value. */
  readonly limits: KitV2Limits;
}

/** `createLaunch`'s argument with everything the SDK can say about it. */
export interface LaunchBuildV2 {
  readonly params: LaunchParamsV2;
  readonly legs: readonly ResolvedLegV2[];
  /** The SDK's findings. Any `error` means the kit would revert; the caller must not send. */
  readonly issues: readonly LaunchV2Issue[];
  /** `msg.value`: the limits' `safeValue`, so a scheduled fee increase cannot make the call revert. */
  readonly value: bigint;
}

/** A `createLaunch` call for a wallet. */
export interface BuiltLaunchV2 extends LaunchBuildV2 {
  /** The kit. */
  readonly to: Address;
  readonly data: Hex;
  /** The predicted launch token, cross-checked against the kit. */
  readonly token: Address;
}

function fraction(typed: string, actual: number): number {
  const t = Number(typed);
  if (!Number.isFinite(t) || t <= 0) return 0;
  return Math.abs(actual - t) / t;
}

function resolveCLLeg(
  leg: LegDraftV2,
  token: Address,
  is0: boolean,
): { cl: CLLegParamsV2; openingPrice: string; snapFraction: number } {
  const price = sqrtPriceForLaunch({
    launchToken: token,
    quoteToken: leg.quote,
    launchDecimals: LAUNCH_TOKEN_DECIMALS,
    quoteDecimals: leg.quoteDecimals,
    quotePerLaunchToken: leg.quotePerLaunchToken,
  });
  /* Snap the price onto the range edge so the first buy meets liquidity instead
     of crossing an empty gap up to one spacing wide. The snapped price is what
     the pool is initialized at, and it is what gets shown. */
  const cl = kitV2CLLaunchRange({
    launchTokenIsCurrency0: is0,
    sqrtPriceX96: price.sqrtPriceX96,
    tickSpacing: leg.tickSpacing,
    widthInSpacings: leg.widthInSpacings,
    snapPrice: true,
  });
  const [decimals0, decimals1] = is0
    ? [LAUNCH_TOKEN_DECIMALS, leg.quoteDecimals]
    : [leg.quoteDecimals, LAUNCH_TOKEN_DECIMALS];
  const poolPrice = priceFromSqrtPriceX96(cl.sqrtPriceX96, decimals0, decimals1, 18);
  /* The pool prices currency1 per currency0; a human wants quote per launch token. */
  const opening = is0 ? Number(poolPrice) : 1 / Number(poolPrice);
  return { cl, openingPrice: opening.toPrecision(8), snapFraction: fraction(leg.quotePerLaunchToken, opening) };
}

function resolveBinLeg(leg: LegDraftV2, is0: boolean): { bin: BinLegParamsV2; openingPrice: string; snapFraction: number } {
  const typed = Number(leg.quotePerLaunchToken);
  if (!Number.isFinite(typed) || typed <= 0) {
    throw new RangeError(`the opening price must be a positive number, received "${leg.quotePerLaunchToken}"`);
  }
  const activeId = binActiveIdForLaunch({
    launchTokenIsCurrency0: is0,
    launchDecimals: LAUNCH_TOKEN_DECIMALS,
    quoteDecimals: leg.quoteDecimals,
    quotePerLaunchToken: typed,
    binStep: leg.binStep,
  });
  const opening = binLaunchPriceAtId(activeId, {
    launchTokenIsCurrency0: is0,
    launchDecimals: LAUNCH_TOKEN_DECIMALS,
    quoteDecimals: leg.quoteDecimals,
    binStep: leg.binStep,
  });
  const bin: BinLegParamsV2 = {
    binStep: leg.binStep,
    activeId,
    shape: BIN_SHAPE[leg.shape],
    binCount: leg.binCount,
    offsets: [],
    weights: [],
    floorBins: 0,
  };
  return { bin, openingPrice: opening.toPrecision(8), snapFraction: fraction(leg.quotePerLaunchToken, opening) };
}

/**
 * The `createLaunch` argument for `draft`, and every objection the SDK can
 * raise to it. Pure: no RPC, no clock.
 *
 * - Each leg's pool key is computed from the token, the quote and the kind;
 *   which currency the token sorts to decides the CL side and the Bin id.
 * - A CL leg's price is snapped onto its range edge and a Bin leg's onto its
 *   bin; `legs[i].openingPrice` is the price the pool is born at.
 * - `integrator`, `integratorBps` and `integratorLaunchFeeWei` are
 *   `ctx.limits.integrator` - the tenant's stored terms when there is a tenant.
 * - `creatorBps` is the remainder after the protocol's and the integrator's
 *   shares. A negative remainder is sent as 0 and reported as an issue
 *   (`BpsDoNotSumToDenominator`) rather than encoded as a wrapped number.
 * - A named preset supplies its own fee fields, so the draft's custom fields
 *   are zeroed for it; `PRESET.Custom` keeps them.
 * - `allocationRecipient` is the zero address when the whole supply is seeded.
 *
 * @throws RangeError when a price or range cannot be represented at all (a
 * non-positive price, a range leaving the usable ticks). Everything the kit
 * itself would refuse is reported in `issues`, not thrown.
 */
export function buildLaunchParamsV2(draft: LaunchDraftV2, ctx: BuildLaunchV2Context): LaunchBuildV2 {
  const { token, limits } = ctx;
  const env = limits.env;

  const legs: LegParamsV2[] = [];
  const resolved: ResolvedLegV2[] = [];
  for (const leg of draft.legs) {
    const key = computeKitV2LegKey({
      env,
      token,
      quote: leg.quote,
      kind: leg.kind === "CL" ? LEG_KIND.CL : LEG_KIND.Bin,
      tickSpacingOrBinStep: leg.kind === "CL" ? leg.tickSpacing : leg.binStep,
    });
    const is0 = key.launchTokenIsCurrency0;
    if (leg.kind === "CL") {
      const r = resolveCLLeg(leg, token, is0);
      legs.push({ kind: LEG_KIND.CL, quote: leg.quote, weightBps: leg.weightBps, maxBuyPerTx: leg.maxBuyPerTx, cl: r.cl, bin: EMPTY_BIN_LEG });
      resolved.push({ key, kind: "CL", openingPrice: r.openingPrice, snapFraction: r.snapFraction });
    } else {
      const r = resolveBinLeg(leg, is0);
      legs.push({ kind: LEG_KIND.Bin, quote: leg.quote, weightBps: leg.weightBps, maxBuyPerTx: leg.maxBuyPerTx, cl: EMPTY_CL_LEG, bin: r.bin });
      resolved.push({ key, kind: "Bin", openingPrice: r.openingPrice, snapFraction: r.snapFraction });
    }
  }

  const integrator = limits.integrator;
  const creatorBps = KIT_V2_BPS - draft.protocolBps - integrator.bps;
  const custom = draft.schedule.preset === PRESET.Custom;
  const dt = draft.tax;
  const hasTax = dt !== undefined && (dt.buyBps !== 0 || dt.sellBps !== 0);
  const taxIntegratorBps = hasTax ? integrator.taxBps : 0;
  const taxCreatorBps = hasTax ? KIT_V2_BPS - dt.protocolBps - taxIntegratorBps : 0;
  const tax: TaxParamsV2 = hasTax
    ? {
        buyBps: dt.buyBps,
        sellBps: dt.sellBps,
        taxSeconds: dt.taxSeconds,
        creatorBps: taxCreatorBps < 0 ? 0 : taxCreatorBps,
        protocolBps: dt.protocolBps,
        integratorBps: taxIntegratorBps,
      }
    : NO_TAX;

  const params: LaunchParamsV2 = {
    name: draft.name,
    symbol: draft.symbol,
    metadataURI: draft.metadataURI,
    userSalt: draft.userSalt,
    totalSupply: draft.totalSupply,
    seedSupply: draft.seedSupply,
    allocationRecipient: draft.seedSupply < draft.totalSupply ? draft.allocationRecipient : NATIVE_ADDRESS,
    creator: draft.creator,
    launchOperator: draft.operator,
    launchSteward: draft.steward,
    tenant: limits.tenantAddress ?? NATIVE_ADDRESS,
    integrator: integrator.address,
    integratorBps: integrator.bps,
    integratorLaunchFeeWei: integrator.launchFeeWei,
    creatorBps: creatorBps < 0 ? 0 : creatorBps,
    protocolBps: draft.protocolBps,
    schedule: {
      preset: draft.schedule.preset,
      /* A named preset supplies the fee fields itself; the kit ignores what is
         sent for them. They are zeroed so nobody reads a Custom-looking value. */
      initialFeeBips: custom ? draft.schedule.initialFeeBips : 0,
      finalFeeBips: custom ? draft.schedule.finalFeeBips : 0,
      decaySeconds: custom ? draft.schedule.decaySeconds : 0,
      enabled: true,
      startDelaySeconds: draft.schedule.startDelaySeconds,
    },
    tax,
    legs,
    listing: draft.listing,
  };

  const validation: LaunchV2ValidationContext = {
    caps: limits.caps,
    token,
    kit: env.kit,
    maxIntegratorLaunchFeeWei: limits.maxIntegratorLaunchFeeWei,
    lockerBounds: limits.locker,
    taxBounds: limits.tax,
    ...(limits.tenant === null ? {} : { tenantConfig: limits.tenant, tenantAllowedQuotes: limits.tenantAllowedQuotes }),
  };
  const issues = [...validateLaunchParamsV2(params, validation), ...listingIssues(draft.listing)];

  return { params, legs: resolved, issues, value: limits.value.safeValue };
}

/**
 * The registry's handle rules (`LatchLaunchRegistry._boundHandle`), reported as
 * issues rather than thrown, so a wizard can show them beside the field. The
 * URI members are deliberately not judged here — see `prepareLaunchListing`.
 */
function listingIssues(listing: LaunchListingInput): LaunchV2Issue[] {
  const out: LaunchV2Issue[] = [];
  const check = (field: "xHandle" | "telegramHandle", max: number): void => {
    try {
      assertHandle(listing[field], max, field);
    } catch (e) {
      out.push({ severity: "error", field: `listing.${field}`, message: e instanceof Error ? e.message : String(e), contractError: "InvalidHandle" });
    }
  };
  check("xHandle", MAX_X_HANDLE_BYTES);
  check("telegramHandle", MAX_TELEGRAM_HANDLE_BYTES);
  return out;
}

/** `encodeFunctionData` for `createLaunch(params)`. */
export function encodeCreateLaunchV2(params: LaunchParamsV2): Hex {
  return encodeFunctionData({ abi: LAUNCHPAD_KIT_V2_ABI, functionName: "createLaunch", args: [params] });
}

/**
 * The whole call: predicts the token (kit and SDK cross-checked), builds and
 * validates the parameters, and encodes `createLaunch`.
 *
 * `limits` must have been read for the same kit (`limits.env.kit === kit`) and
 * for the tenant the launch runs under; its integrator terms are what the call
 * carries.
 */
export async function buildLaunchV2(
  client: PublicClient,
  kit: Address,
  draft: LaunchDraftV2,
  limits: KitV2Limits,
): Promise<BuiltLaunchV2> {
  if (limits.env.kit.toLowerCase() !== kit.toLowerCase()) {
    throw new Error(`limits were read for kit ${limits.env.kit}, not ${kit}; read them for the kit the launch is sent to`);
  }
  const token = await predictLaunchTokenChecked(client, kit, draft.launcher, draft.userSalt);
  const built = buildLaunchParamsV2(draft, { token, limits });
  return { ...built, to: kit, data: encodeCreateLaunchV2(built.params), token };
}
