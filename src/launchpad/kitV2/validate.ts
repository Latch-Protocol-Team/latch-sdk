// SPDX-License-Identifier: MIT
/* ============================================================================
   `LaunchParamsV2`, refused before it is broadcast.

   Every check here restates a check `LaunchpadKitV2`, `LaunchLegs`,
   `BinLaunchShapes`, the lockers or core make on chain. The chain stays the
   authority; the point is to answer while a form is still being filled in, with
   the field named, instead of after a reverted gas estimate.

   THE CAPS a UI must enforce, and where each comes from:

     legs <= maxLegs              kit immutable (deploy script: 4)       InvalidLegCount
     bins per leg <= maxBinsPerLeg kit immutable (deploy script: 20)     BinShapeBadCount
     no schedule opening above 10% on a launch with ANY Bin leg          PresetUnavailableOnBin
       - so AntiSniperAggressive and Stealth (50%) are unavailable there,
         and so is a Custom schedule starting above 10%.

   `caps` is a required argument, not a default: pass `readKitV2Caps(kit)` or,
   before a kit exists, `KIT_V2_DEPLOY_SCRIPT_CAPS` knowingly.

   WHAT NEEDS THE TOKEN ADDRESS. The CL side rule and the Bin id mapping depend
   on which currency the launch token sorts to, which depends on its address. Pass
   `token` (from `predictLaunchTokenChecked`) or those checks are skipped and a
   warning says so.
   ============================================================================ */

import type { Address } from "viem";

import { LAUNCH_GUARD_LIMITS, PRESET, PRESET_NAMES, PRESET_PARAMS, type PresetName } from "../presets.js";
import { binLegIds, buildBinShape, validateBinDistribution, type BinDistribution } from "./binShapes.js";
import { checkKitV2CLLeg, kitV2LegSupplies, launchTokenIsCurrency0 } from "./legs.js";
import type { DecodedTenantConfig } from "./fees.js";
import {
  BIN_LEG_MAX_INITIAL_FEE_PIPS,
  BIN_SHAPE,
  BIN_SHAPE_NAMES,
  KIT_V2_BPS,
  KIT_V2_MAX_START_DELAY_SECONDS,
  LAUNCH_TAX_LIMITS,
  LEG_KIND,
  type KitV2Caps,
  type LaunchParamsV2,
  type TaxParamsV2,
} from "./types.js";

const ZERO = "0x0000000000000000000000000000000000000000";

export interface LaunchV2Issue {
  readonly severity: "error" | "warning";
  /** Dotted path into `LaunchParamsV2`, e.g. `legs[1].bin.weights`. */
  readonly field: string;
  readonly message: string;
  /** The contract error this surfaces as, when there is one. */
  readonly contractError?: string;
  /** For Bin shape findings: the rule (R1-R6) broken. */
  readonly rule?: string;
}

export interface LaunchV2ValidationContext {
  /** `readKitV2Caps(kit)`. */
  readonly caps: KitV2Caps;
  /** The predicted launch token. Without it the side-dependent checks are skipped. */
  readonly token?: Address;
  /** The kit address, refused as creator / integrator / allocation recipient (`InvalidRecipient`). */
  readonly kit?: Address;
  /** `maxIntegratorLaunchFeeWei()`, when known. */
  readonly maxIntegratorLaunchFeeWei?: bigint;
  /** The lockers' bounds (`minProtocolBps`, `maxProtocolBps`, `maxIntegratorBps`), when known. */
  readonly lockerBounds?: { readonly minProtocolBps: number; readonly maxProtocolBps: number; readonly maxIntegratorBps: number };
  /** `readTenantConfig(kit, p.tenant)` when `p.tenant` is set. */
  readonly tenantConfig?: DecodedTenantConfig;
  /** The guards' creator-tax bounds (`readKitV2Limits(...).tax`). Defaults to `LAUNCH_TAX_LIMITS`. */
  readonly taxBounds?: TaxBounds;
  /** Quotes on the tenant's allowlist (`tenantQuoteAllowed`), consulted when the tenant restricts quotes. */
  readonly tenantAllowedQuotes?: readonly Address[];
}

/** The schedule the kit resolves, for the fee ceiling checks. */
function resolvedInitialFee(p: LaunchParamsV2): { initial: number; requiresMaxBuy: boolean; name: PresetName | null } {
  const name = PRESET_NAMES[p.schedule.preset] ?? null;
  if (name === null || name === "Custom") {
    return { initial: p.schedule.initialFeeBips, requiresMaxBuy: false, name };
  }
  const pp = PRESET_PARAMS[name];
  return { initial: pp.initialFeeBips, requiresMaxBuy: pp.requiresMaxBuyPerTx, name };
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** The creator tax's bounds as `LaunchTaxModule` publishes them. */
export interface TaxBounds {
  readonly maxTaxBps: number;
  readonly minProtocolBps: number;
  readonly maxProtocolBps: number;
  readonly maxIntegratorBps: number;
  readonly maxTaxDurationSeconds: number;
}

export const DEFAULT_TAX_BOUNDS: TaxBounds = {
  maxTaxBps: LAUNCH_TAX_LIMITS.MAX_TAX_BPS,
  minProtocolBps: LAUNCH_TAX_LIMITS.MIN_PROTOCOL_BPS,
  maxProtocolBps: LAUNCH_TAX_LIMITS.MAX_PROTOCOL_BPS,
  maxIntegratorBps: LAUNCH_TAX_LIMITS.MAX_INTEGRATOR_BPS,
  maxTaxDurationSeconds: LAUNCH_TAX_LIMITS.MAX_TAX_DURATION_SECONDS,
};

/** `true` when a tax block is the all-zero "no tax" value the kit skips entirely. */
export function isNoTax(t: TaxParamsV2): boolean {
  return t.buyBps === 0 && t.sellBps === 0 && t.taxSeconds === 0 && t.creatorBps === 0 && t.protocolBps === 0 && t.integratorBps === 0;
}

/** Every objection to a `LaunchParamsV2`, cheapest first. Returns findings; never throws on bad input. */
export function validateLaunchParamsV2(p: LaunchParamsV2, ctx: LaunchV2ValidationContext): readonly LaunchV2Issue[] {
  const issues: LaunchV2Issue[] = [];
  const err = (field: string, message: string, contractError?: string, rule?: string): void => {
    issues.push({
      severity: "error",
      field,
      message,
      ...(contractError === undefined ? {} : { contractError }),
      ...(rule === undefined ? {} : { rule }),
    });
  };
  const warn = (field: string, message: string): void => {
    issues.push({ severity: "warning", field, message });
  };

  /* ---- shape of the launch ---- */
  const n = p.legs.length;
  if (n === 0 || n > ctx.caps.maxLegs) {
    err("legs", `${n} legs; this kit takes 1 to ${ctx.caps.maxLegs}.`, "InvalidLegCount");
  }
  if (p.seedSupply === 0n || p.seedSupply > p.totalSupply) {
    err("seedSupply", "seedSupply must be above zero and at most totalSupply.", "InvalidSeedSupply");
  }
  if (p.seedSupply < p.totalSupply && same(p.allocationRecipient, ZERO)) {
    err("allocationRecipient", "Part of the supply is not seeded, so it needs a recipient.", "AllocationRecipientRequired");
  }
  if (ctx.kit !== undefined) {
    for (const f of ["creator", "integrator", "allocationRecipient"] as const) {
      if (same(p[f], ctx.kit)) err(f, "The kit itself can never claim; naming it strands the value.", "InvalidRecipient");
    }
  }

  /* ---- schedule ---- */
  const sched = resolvedInitialFee(p);
  if (sched.name === null) err("schedule.preset", `${p.schedule.preset} is not a Preset (0-4).`);
  if (sched.name === "Custom" && p.schedule.initialFeeBips === 0 && p.schedule.finalFeeBips === 0 && p.schedule.decaySeconds === 0 && !p.schedule.enabled) {
    err(
      "schedule.preset",
      "preset is Custom (the ZERO value) with every custom field empty - what an unset preset looks like. " +
        "Pick a named preset, or fill in the schedule.",
    );
  }
  if (sched.name === "Custom" && p.schedule.initialFeeBips > LAUNCH_GUARD_LIMITS.MAX_INITIAL_FEE) {
    err("schedule.initialFeeBips", "initialFeeBips is above the guard's 50% ceiling.", "InvalidFeeSchedule");
  }
  if (p.schedule.startDelaySeconds > KIT_V2_MAX_START_DELAY_SECONDS) {
    err("schedule.startDelaySeconds", "A start delay may be at most 30 days.", "StartDelayTooLong");
  }

  /* ---- fees and the split ---- */
  if (p.integratorLaunchFeeWei > 0n && same(p.integrator, ZERO)) {
    err("integrator", "An integrator launch fee needs an integrator to pay it to.", "IntegratorFeeWithoutIntegrator");
  }
  if (ctx.maxIntegratorLaunchFeeWei !== undefined && p.integratorLaunchFeeWei > ctx.maxIntegratorLaunchFeeWei) {
    err("integratorLaunchFeeWei", `Above the kit's cap of ${ctx.maxIntegratorLaunchFeeWei} wei.`, "IntegratorFeeAboveCap");
  }
  const splitSum = p.creatorBps + p.integratorBps + p.protocolBps;
  if (splitSum !== KIT_V2_BPS) {
    err("creatorBps", `creatorBps + integratorBps + protocolBps is ${splitSum}; it must be exactly 10000.`, "BpsDoNotSumToDenominator");
  }
  if (p.integratorBps > 0 && same(p.integrator, ZERO)) {
    err("integrator", "integratorBps is non-zero but there is no integrator.", "InvalidIntegrator");
  }
  if (ctx.lockerBounds !== undefined) {
    const b = ctx.lockerBounds;
    if (p.protocolBps < b.minProtocolBps || p.protocolBps > b.maxProtocolBps) {
      err("protocolBps", `protocolBps must be in [${b.minProtocolBps}, ${b.maxProtocolBps}].`, "ProtocolBpsOutOfRange");
    }
    if (p.integratorBps > b.maxIntegratorBps) {
      err("integratorBps", `integratorBps may be at most ${b.maxIntegratorBps}.`, "IntegratorBpsTooHigh");
    }
  }

  /* ---- tenant ---- */
  const hasTenant = !same(p.tenant, ZERO);
  const t = ctx.tenantConfig;
  if (hasTenant && t === undefined) {
    warn("tenant", "A tenant is named but its config was not supplied, so the tenant rules were not checked.");
  }
  if (hasTenant && t !== undefined) {
    if (!t.active) err("tenant", "This tenant has no active config.", "TenantNotActive");
    if (!same(t.integrator, p.integrator) || t.integratorBps !== p.integratorBps || t.integratorLaunchFeeWei !== p.integratorLaunchFeeWei) {
      err("tenant", "integrator, integratorBps and integratorLaunchFeeWei must equal the tenant's stored values.", "TenantConfigMismatch");
    }
    if (sched.name !== null && !t.allowedPresets.includes(sched.name)) {
      err("schedule.preset", `This tenant does not allow the ${sched.name} preset.`, "PresetNotAllowed");
    }
  }

  /* ---- the creator tax: every rule `LaunchTaxModule._configureTax` applies, plus the kit's tenant policy ---- */
  const tax = p.tax;
  const tb = ctx.taxBounds ?? DEFAULT_TAX_BOUNDS;
  if (!isNoTax(tax)) {
    if (tax.buyBps === 0 && tax.sellBps === 0) {
      err("tax", "A tax with both rates zero must be the all-zero block (no tax).", "TaxWithoutRate");
    }
    if (tax.buyBps > tb.maxTaxBps) err("tax.buyBps", `buyBps is above the guard's cap of ${tb.maxTaxBps} bps.`, "TaxRateTooHigh");
    if (tax.sellBps > tb.maxTaxBps) err("tax.sellBps", `sellBps is above the guard's cap of ${tb.maxTaxBps} bps.`, "TaxRateTooHigh");
    if (tax.taxSeconds === 0) {
      err("tax.taxSeconds", "The tax would expire the moment trading opens (and revert if trading opens now).", "TaxExpiryOutOfRange");
    }
    if (p.schedule.startDelaySeconds + tax.taxSeconds > tb.maxTaxDurationSeconds) {
      err(
        "tax.taxSeconds",
        `The tax would run past ${tb.maxTaxDurationSeconds} s from the launch transaction (start delay + taxSeconds); no permanent tax.`,
        "TaxExpiryOutOfRange",
      );
    }
    const taxSum = tax.creatorBps + tax.protocolBps + tax.integratorBps;
    if (taxSum !== KIT_V2_BPS) {
      err("tax.creatorBps", `tax.creatorBps + protocolBps + integratorBps is ${taxSum}; it must be exactly 10000.`, "TaxSplitDoesNotSum");
    }
    if (tax.protocolBps < tb.minProtocolBps || tax.protocolBps > tb.maxProtocolBps) {
      err(
        "tax.protocolBps",
        `The protocol's share of the tax must be in [${tb.minProtocolBps}, ${tb.maxProtocolBps}] bps; the floor is the guard's, not the kit's.`,
        "TaxProtocolShareOutOfBounds",
      );
    }
    if (tax.integratorBps > tb.maxIntegratorBps) {
      err("tax.integratorBps", `The integrator's share of the tax may be at most ${tb.maxIntegratorBps} bps.`, "TaxIntegratorShareTooHigh");
    }
    if (tax.integratorBps > 0 && same(p.integrator, ZERO)) {
      err("integrator", "The tax names an integrator share but there is no integrator.", "TaxRecipientMismatch");
    }
    if (tax.creatorBps === 0 && tax.integratorBps === 0) warn("tax.creatorBps", "Every unit of this tax goes to the protocol.");
    if (hasTenant && t !== undefined) {
      if (tax.buyBps > t.maxTaxBps || tax.sellBps > t.maxTaxBps) {
        err("tax", t.maxTaxBps === 0 ? "This tenant does not allow a creator tax." : `This tenant caps the tax at ${t.maxTaxBps} bps.`, "TaxNotAllowed");
      }
      if (tax.integratorBps !== t.taxIntegratorBps) {
        err("tax.integratorBps", `A launch through this tenant must restate its tax integrator share, ${t.taxIntegratorBps} bps.`, "TaxNotAllowed");
      }
    }
  }

  /* ---- legs ---- */
  const { supplies, problem } = kitV2LegSupplies(p.seedSupply, p.legs.map((l) => l.weightBps));
  if (problem !== null) {
    if (problem.error === "LegWeightsDoNotSum") {
      err("legs", `Leg weights sum to ${problem.sum} bps; they must sum to exactly 10000.`, "LegWeightsDoNotSum");
    } else {
      err(`legs[${problem.index}].weightBps`, problem.error === "EmptyLeg" ? "This leg would seed zero tokens." : "This leg's supply does not fit uint128.", problem.error);
    }
  }
  const hasBinLeg = p.legs.some((l) => l.kind === LEG_KIND.Bin);
  if (hasBinLeg && sched.initial > BIN_LEG_MAX_INITIAL_FEE_PIPS) {
    err(
      "schedule.preset",
      `This launch has a Bin leg, and core caps a Bin pool's fee at 10%; a schedule opening at ${sched.initial / 10_000}% ` +
        "is refused. AntiSniperAggressive and Stealth are unavailable on launches with a Bin leg.",
      "PresetUnavailableOnBin",
    );
  }
  if (ctx.token === undefined) {
    warn("legs", "No predicted token address was supplied, so the CL side rule and the Bin id range were not checked.");
  }

  const seenQuotesByKind = new Set<string>();
  p.legs.forEach((leg, i) => {
    const at = `legs[${i}]`;
    if (ctx.token !== undefined && same(leg.quote, ctx.token)) {
      err(`${at}.quote`, "The quote is the launch token itself.", "QuoteIsLaunchToken");
      return;
    }
    if (hasTenant && t !== undefined && t.restrictQuotes) {
      const allowed = (ctx.tenantAllowedQuotes ?? []).some((q) => same(q, leg.quote));
      if (!allowed) err(`${at}.quote`, "This tenant restricts quotes and this one is not on its list.", "QuoteNotAllowed");
    }
    const supply = supplies[i];
    const is0 = ctx.token === undefined ? undefined : launchTokenIsCurrency0(ctx.token, leg.quote);

    if (leg.kind === LEG_KIND.CL) {
      const spacingKey = `cl:${leg.quote.toLowerCase()}:${leg.cl.tickSpacing}`;
      if (seenQuotesByKind.has(spacingKey)) err(at, "Two legs resolve to the same pool.", "DuplicateLegPool");
      seenQuotesByKind.add(spacingKey);
      if (sched.requiresMaxBuy && leg.maxBuyPerTx === 0n) {
        err(`${at}.maxBuyPerTx`, `Preset ${sched.name} requires a per-transaction buy cap on every CL leg.`, "MaxBuyRequiredByPreset");
      }
      if (is0 !== undefined) {
        const r = checkKitV2CLLeg({ cl: leg.cl, launchTokenIsCurrency0: is0, ...(supply === undefined ? {} : { supply }) });
        if (r.problem !== null) err(`${at}.cl`, r.problem.message, r.problem.error);
      }
      return;
    }
    if (leg.kind !== LEG_KIND.Bin) {
      err(`${at}.kind`, `${leg.kind} is not a LegKind (0 CL, 1 Bin).`);
      return;
    }

    /* Bin leg */
    const b = leg.bin;
    const binKey = `bin:${leg.quote.toLowerCase()}:${b.binStep}`;
    if (seenQuotesByKind.has(binKey)) err(at, "Two legs resolve to the same pool.", "DuplicateLegPool");
    seenQuotesByKind.add(binKey);
    if (!Number.isInteger(b.binStep) || b.binStep < 1 || b.binStep > 0xffff) {
      err(`${at}.bin.binStep`, "binStep must be at least 1 (and at most the Bin manager's maxBinStep()).", "BinStepTooSmall");
    }
    if (!Number.isInteger(b.activeId) || b.activeId < 0 || b.activeId > 0xffffff) {
      err(`${at}.bin.activeId`, "activeId must be a uint24.");
      return;
    }
    const shapeName = BIN_SHAPE_NAMES[b.shape];
    if (shapeName === undefined) {
      err(`${at}.bin.shape`, `${b.shape} is not a BinShape (0-4).`);
      return;
    }
    if (hasTenant && t !== undefined && !t.allowedBinShapes.includes(shapeName)) {
      err(`${at}.bin.shape`, `This tenant does not allow the ${shapeName} Bin shape.`, "BinShapeNotAllowed");
    }
    let dist: BinDistribution;
    if (b.shape === BIN_SHAPE.Custom) {
      dist = { offsets: b.offsets, weights: b.weights, floorBins: b.floorBins };
    } else {
      if (!Number.isInteger(b.binCount) || b.binCount < 1 || b.binCount > ctx.caps.maxBinsPerLeg) {
        err(`${at}.bin.binCount`, `${b.binCount} bins; a leg holds 1 to ${ctx.caps.maxBinsPerLeg}.`, "BinShapeBadCount", "R4");
        return;
      }
      dist = buildBinShape(b.shape, b.binCount, ctx.caps.maxBinsPerLeg);
    }
    if (supply !== undefined) {
      const v = validateBinDistribution(dist, ctx.caps.maxBinsPerLeg, supply);
      if (v !== null) {
        err(`${at}.bin${v.index === undefined ? "" : `[${v.index}]`}`, v.message, v.error ?? undefined, v.rule);
        return;
      }
    }
    if (is0 !== undefined) {
      const ids = binLegIds({ activeId: b.activeId, offsets: dist.offsets, launchTokenIsCurrency0: is0 });
      if (ids.outOfRangeIndex !== null) {
        err(
          `${at}.bin.offsets`,
          is0
            ? `Bin ${ids.outOfRangeIndex} would sit above the highest bin id (2^24 - 1).`
            : `Bin ${ids.outOfRangeIndex} would sit at or below bin id 0; lower offsets or raise activeId.`,
          "BinIdOutOfRange",
        );
      }
    }
  });

  if (p.schedule.preset === PRESET.Custom && sched.initial < p.schedule.finalFeeBips) {
    err("schedule.initialFeeBips", "A launch schedule must decay: initialFeeBips is below finalFeeBips.", "InvalidFeeSchedule");
  }
  return issues;
}
