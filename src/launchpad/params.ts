// SPDX-License-Identifier: MIT
/* ============================================================================
   `LaunchParams`, typed — and refused before it is broadcast.

   `LaunchpadKit.createLaunch` takes a fourteen-field struct with three nested
   ones, several fields that are ignored unless another field holds a
   particular value, and one field whose zero value silently disables the
   protection the caller thinks they are buying. Hand-building that from an ABI
   is a reasonable thing to get wrong.

   WHAT THIS MODULE IS FOR, AND WHAT IT IS NOT. Almost every check here is a
   LOCAL restatement of a check the contract already makes. It cannot be the
   authority and does not try to be — `LaunchpadKit` and `LaunchGuardHook` run
   on chain and they are what actually protects a launch.

   The value is in WHEN the answer arrives. A reverted gas estimate says
   `MaxBuyRequiredByPreset(2)` after the user has filled in a form, connected a
   wallet and pressed the button. `validateLaunchParams` says the same thing
   while they are still typing, in a sentence, with the field named.

   And two of these do NOT revert on chain at all:

     * a `Custom` preset with empty fee fields — which is what an unset preset
       field decays to, because Custom is the zero value;
     * a `sqrtPriceX96` that is valid but means something other than the price
       the launcher had in mind, because sorting or decimals were missed.

   Both succeed permanently at the wrong settings. Those two are why this file
   exists; the rest is ergonomics.

   The rule the checks follow: ERROR on what the chain would refuse, WARN on
   what the chain would accept but a human probably did not mean.
   ============================================================================ */

import type { Address } from "viem";

import {
  LAUNCH_GUARD_LIMITS,
  PRESET,
  PRESET_PARAMS,
  type PresetName,
  blocksToSeconds,
  formatPips,
  humanDuration,
  parsePreset,
  presetName,
  secondsToBlocks,
} from "./presets.js";
import { MAX_SQRT_RATIO, MIN_SQRT_RATIO } from "./price.js";

/** Mirrors `struct SeedParams`. Amounts are RAW units. */
export interface SeedParams {
  readonly tickLower: number;
  readonly tickUpper: number;
  /** Maximum launch-token units to spend. Unused amounts are refunded in the same tx. */
  readonly launchTokenAmount: bigint;
  /** Maximum quote units to spend. When the quote is native this MUST equal `msg.value`. */
  readonly quoteTokenAmount: bigint;
  /** Recipient of the position NFT. Zero address means `msg.sender`. */
  readonly positionRecipient: Address;
  /** Forwarded to the position manager. `0n` means `block.timestamp`. */
  readonly deadline: bigint;
}

/** Mirrors `struct LatchMetadata` from the registry. */
export interface LatchMetadataInput {
  readonly name: string;
  readonly description: string;
  readonly sourceURI: string;
  readonly auditURI: string;
  readonly chainIds: readonly bigint[];
}

/** Mirrors `struct HookListingParams`. */
export interface HookListingParams {
  readonly register: boolean;
  /** Ends up holding the listing's edit right. Zero address means `msg.sender`. */
  readonly steward: Address;
  readonly metadata: LatchMetadataInput;
}

/** Mirrors `struct LaunchParams`, field for field and in order. */
export interface LaunchParams {
  readonly launchToken: Address;
  /** `0x0000…0000` is the chain's native asset. The LAUNCH token may not be native. */
  readonly quoteToken: Address;
  readonly tickSpacing: number;
  /** Use `sqrtPriceForLaunch` from `./price.js`. Permanent at `initialize`. */
  readonly sqrtPriceX96: bigint;
  readonly preset: number;
  /** Ignored unless `preset === PRESET.Custom`. */
  readonly initialFeeBips: number;
  /** Ignored unless `preset === PRESET.Custom`. */
  readonly finalFeeBips: number;
  /** Ignored unless `preset === PRESET.Custom`. **In BLOCKS, not seconds.** */
  readonly decayBlocks: number;
  /** Ignored unless `preset === PRESET.Custom`. */
  readonly enabled: boolean;
  /** Seconds from THIS TRANSACTION LANDING until trading opens. Converted at the kit's block time. */
  readonly startDelaySeconds: number;
  /** Per-TRANSACTION cap on a buy's input, in quote units. `0n` disables. NOT per wallet. */
  readonly maxBuyPerTx: bigint;
  /** May reconfigure until `startBlock`. Zero address means `msg.sender`. Not transferable. */
  readonly launchOperator: Address;
  readonly seed: SeedParams;
  readonly listing: HookListingParams;
}

/** One finding. `error` blocks a launch; `warning` is a "did you mean this?". */
export interface LaunchIssue {
  readonly severity: "error" | "warning";
  /** The `LaunchParams` field it concerns, dotted for nested ones. */
  readonly field: string;
  readonly message: string;
  /**
   * The contract error this would surface as, when there is one. Absent means
   * the chain accepts this and the objection is ours.
   */
  readonly contractError?: string;
}

/** Deployment facts the validator cannot know and must not assume. */
export interface LaunchLimits {
  /**
   * From the kit's `blockTimeCentis()`. Hundredths of a second.
   * Robinhood's kit is 10; a 12-second chain is 1200.
   */
  readonly blockTimeCentis: number;
  /**
   * From `LaunchGuardHook.MAX_DECAY_BLOCKS()` — SCREAMING_SNAKE on chain, and
   * there is no camelCase alias. A probe for `maxDecayBlocks()` reverts.
   */
  readonly maxDecayBlocks?: bigint;
  /** From `LaunchGuardHook.MAX_START_DELAY()`. Same naming caveat. */
  readonly maxStartDelayBlocks?: bigint;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Every objection to a `LaunchParams`, cheapest checks first.
 *
 * Returns findings rather than throwing, so a form can render all of them at
 * once instead of revealing one per submit. `assertLaunchParams` is the
 * throwing wrapper for scripts.
 */
export function validateLaunchParams(p: LaunchParams, limits: LaunchLimits): readonly LaunchIssue[] {
  const issues: LaunchIssue[] = [];
  const err = (field: string, message: string, contractError?: string): void => {
    issues.push(contractError === undefined
      ? { severity: "error", field, message }
      : { severity: "error", field, message, contractError });
  };
  const warn = (field: string, message: string): void => {
    issues.push({ severity: "warning", field, message });
  };

  /* ---- the pair ---- */
  const launch = p.launchToken.toLowerCase();
  const quote = p.quoteToken.toLowerCase();
  if (launch === ZERO_ADDRESS) {
    err("launchToken", "The native asset cannot be launched.", "LaunchTokenCannotBeNative()");
  }
  if (launch === quote) {
    err("quoteToken", "launchToken and quoteToken are the same address.", "IdenticalCurrencies(address)");
  }

  /* ---- pool shape ---- */
  if (!Number.isInteger(p.tickSpacing) || p.tickSpacing < 1 || p.tickSpacing > 32767) {
    err("tickSpacing", `tickSpacing must be in [1, 32767], got ${p.tickSpacing}.`, "TickSpacingTooLarge/Small");
  }
  if (p.sqrtPriceX96 < MIN_SQRT_RATIO || p.sqrtPriceX96 > MAX_SQRT_RATIO) {
    err(
      "sqrtPriceX96",
      `sqrtPriceX96 is outside TickMath's range [${MIN_SQRT_RATIO}, ${MAX_SQRT_RATIO}]. ` +
        "Build it with sqrtPriceForLaunch() rather than by hand.",
      "InvalidSqrtPrice",
    );
  }

  /* ---- the schedule ---- */
  let preset: number;
  try {
    preset = parsePreset(p.preset);
  } catch {
    err("preset", `${p.preset} is not a valid Preset (0-4).`);
    preset = -1;
  }

  if (preset === PRESET.Custom) {
    /* THE ZERO-VALUE TRAP. Custom is 0, so an unset field lands here. The
       chain accepts a coherent Custom happily; what it cannot know is that
       nobody chose it. An all-zero Custom is not a launch configuration, it is
       a missing one. */
    if (p.initialFeeBips === 0 && p.finalFeeBips === 0 && p.decayBlocks === 0 && !p.enabled) {
      err(
        "preset",
        "preset is Custom (the ZERO value) with every custom field empty — which is what an " +
          "unset preset looks like. If you meant a named preset, pass PRESET.FairLaunch (1) or " +
          "another by name. If you really meant Custom, fill in the fee schedule.",
      );
    } else {
      if (p.initialFeeBips < p.finalFeeBips) {
        err(
          "initialFeeBips",
          `A launch must DECAY: initialFeeBips (${p.initialFeeBips}) is below finalFeeBips (${p.finalFeeBips}).`,
          "InvalidFeeSchedule(uint24,uint24)",
        );
      }
      if (p.initialFeeBips > LAUNCH_GUARD_LIMITS.MAX_INITIAL_FEE) {
        err(
          "initialFeeBips",
          `initialFeeBips ${formatPips(p.initialFeeBips)} exceeds the hook's ceiling of ` +
            `${formatPips(LAUNCH_GUARD_LIMITS.MAX_INITIAL_FEE)}.`,
          "InvalidFeeSchedule(uint24,uint24)",
        );
      }
      if (p.finalFeeBips > LAUNCH_GUARD_LIMITS.MAX_FINAL_FEE) {
        err(
          "finalFeeBips",
          `finalFeeBips ${formatPips(p.finalFeeBips)} exceeds the hook's ceiling of ` +
            `${formatPips(LAUNCH_GUARD_LIMITS.MAX_FINAL_FEE)}.`,
          "InvalidFeeSchedule(uint24,uint24)",
        );
      }
      if (p.decayBlocks === 0) {
        err("decayBlocks", "decayBlocks must be non-zero.", "InvalidDecayBlocks(uint32)");
      } else if (limits.maxDecayBlocks !== undefined && BigInt(p.decayBlocks) > limits.maxDecayBlocks) {
        err(
          "decayBlocks",
          `decayBlocks ${p.decayBlocks} exceeds this deployment's MAX_DECAY_BLOCKS ` +
            `(${limits.maxDecayBlocks}).`,
          "DecayWindowTooLong(uint256)",
        );
      }
      /* decayBlocks is in BLOCKS while every other duration here is in seconds.
         On a 0.102s chain the difference is 118x, so say what it means. */
      if (p.decayBlocks > 0) {
        const seconds = blocksToSeconds(p.decayBlocks, limits.blockTimeCentis);
        if (seconds < 60) {
          warn(
            "decayBlocks",
            `${p.decayBlocks} blocks is only ${humanDuration(seconds)} on this chain ` +
              `(${limits.blockTimeCentis / 100}s per block). decayBlocks is in BLOCKS, not seconds.`,
          );
        }
      }
    }
  } else if (preset >= 1) {
    const name = presetName(preset) as Exclude<PresetName, "Custom">;
    const pp = PRESET_PARAMS[name];
    if (pp.requiresMaxBuyPerTx && p.maxBuyPerTx === 0n) {
      err(
        "maxBuyPerTx",
        `Preset ${name} is incoherent without a per-transaction cap and the kit rejects it.`,
        "MaxBuyRequiredByPreset(uint8)",
      );
    }
    if (
      p.initialFeeBips !== 0 ||
      p.finalFeeBips !== 0 ||
      p.decayBlocks !== 0 ||
      p.enabled
    ) {
      warn(
        "preset",
        `Preset ${name} OVERWRITES initialFeeBips, finalFeeBips, decayBlocks and enabled. ` +
          "The values you set in those fields are ignored — set preset to Custom to use them.",
      );
    }
    if (limits.maxDecayBlocks !== undefined) {
      const blocks = secondsToBlocks(pp.windowSeconds, limits.blockTimeCentis);
      if (blocks > limits.maxDecayBlocks) {
        err(
          "preset",
          `Preset ${name}'s ${pp.windowSeconds}s window is ${blocks} blocks on this chain, ` +
            `above MAX_DECAY_BLOCKS (${limits.maxDecayBlocks}).`,
          "DecayWindowTooLong(uint256)",
        );
      }
    }
  }

  /* ---- start delay ---- */
  if (p.startDelaySeconds < 0) {
    err("startDelaySeconds", "startDelaySeconds must not be negative.");
  } else if (p.startDelaySeconds > 0 && limits.maxStartDelayBlocks !== undefined) {
    const blocks = secondsToBlocks(p.startDelaySeconds, limits.blockTimeCentis);
    if (blocks > limits.maxStartDelayBlocks) {
      err(
        "startDelaySeconds",
        `A ${humanDuration(p.startDelaySeconds)} delay is ${blocks} blocks on this chain, ` +
          `above MAX_START_DELAY (${limits.maxStartDelayBlocks}).`,
        "StartDelayTooLong(uint256)",
      );
    }
  }

  /* ---- seed ---- */
  if (p.seed.tickLower >= p.seed.tickUpper) {
    err("seed.tickLower", "tickLower must be below tickUpper.", "InvalidTickRange(int24,int24)");
  }
  if (p.tickSpacing > 0) {
    if (p.seed.tickLower % p.tickSpacing !== 0) {
      err("seed.tickLower", `tickLower must be a multiple of tickSpacing (${p.tickSpacing}).`);
    }
    if (p.seed.tickUpper % p.tickSpacing !== 0) {
      err("seed.tickUpper", `tickUpper must be a multiple of tickSpacing (${p.tickSpacing}).`);
    }
  }
  if (p.seed.launchTokenAmount === 0n && p.seed.quoteTokenAmount === 0n) {
    warn(
      "seed",
      "Both seed amounts are zero, so no liquidity is added. The pool opens empty and the first " +
        "trade reverts. If that is deliberate, seed it in a later transaction.",
    );
  }

  /* ---- governance ---- */
  if (p.launchOperator === ZERO_ADDRESS) {
    warn(
      "launchOperator",
      "launchOperator is the zero address, which means msg.sender. The operator is the ONLY " +
        "address that can reconfigure before trading opens, it freezes at startBlock, and it is " +
        "not transferable — so make it deliberate rather than incidental.",
    );
  }
  if (p.maxBuyPerTx > 0n) {
    warn(
      "maxBuyPerTx",
      "maxBuyPerTx caps ONE TRANSACTION, not one wallet. Splitting a buy across transactions or " +
        "addresses defeats it entirely. Do not label it a per-person limit in a UI.",
    );
  }

  return issues;
}

/** {@link validateLaunchParams}, throwing on the first error. For scripts. */
export function assertLaunchParams(p: LaunchParams, limits: LaunchLimits): void {
  const errors = validateLaunchParams(p, limits).filter((i) => i.severity === "error");
  if (errors.length > 0) {
    throw new Error(
      `LaunchParams is invalid:\n` +
        errors.map((e) => `  - ${e.field}: ${e.message}`).join("\n"),
    );
  }
}

/** The resolved, human-readable shape of a launch. */
export interface LaunchSummary {
  readonly preset: PresetName;
  /** Fee at the first block of the window. */
  readonly initialFee: string;
  /** Fee once the window has elapsed. */
  readonly finalFee: string;
  /** Decay window in blocks, resolved through the preset where one applies. */
  readonly decayBlocks: bigint;
  /** The same window as wall-clock time on THIS chain. The number that matters. */
  readonly decayWindow: string;
  /** When trading opens, relative to the transaction landing. */
  readonly opensAfter: string;
  readonly gated: boolean;
  readonly maxBuyPerTx: bigint;
  /** What this configuration does not protect against. Never empty. */
  readonly doesNotProtectAgainst: string;
}

/**
 * Resolves a `LaunchParams` into the summary a launcher should read before
 * broadcasting — with the decay window in HOURS, not blocks.
 *
 * This is a local preview. `previewSchedule(params)` on the deployed kit is
 * the authoritative one and should be shown beside it; they agreeing is itself
 * a useful check that the SDK's block time matches the kit's.
 */
export function describeLaunch(p: LaunchParams, limits: LaunchLimits): LaunchSummary {
  const preset = parsePreset(p.preset);
  const name = presetName(preset);

  if (name === "Custom") {
    const seconds = blocksToSeconds(p.decayBlocks, limits.blockTimeCentis);
    return {
      preset: name,
      initialFee: formatPips(p.initialFeeBips),
      finalFee: formatPips(p.finalFeeBips),
      decayBlocks: BigInt(p.decayBlocks),
      decayWindow: humanDuration(seconds),
      opensAfter: p.startDelaySeconds === 0 ? "immediately" : humanDuration(p.startDelaySeconds),
      gated: p.enabled,
      maxBuyPerTx: p.maxBuyPerTx,
      doesNotProtectAgainst:
        "whatever this custom schedule does not cover. No preset here offers a per-wallet cap, " +
        "an allowlist, or protection on any other venue.",
    };
  }

  const pp = PRESET_PARAMS[name];
  const blocks = secondsToBlocks(pp.windowSeconds, limits.blockTimeCentis);
  return {
    preset: name,
    initialFee: formatPips(pp.initialFeeBips),
    finalFee: formatPips(pp.finalFeeBips),
    decayBlocks: blocks,
    decayWindow: humanDuration(pp.windowSeconds),
    opensAfter: p.startDelaySeconds === 0 ? "immediately" : humanDuration(p.startDelaySeconds),
    gated: pp.enabled,
    maxBuyPerTx: p.maxBuyPerTx,
    doesNotProtectAgainst: pp.doesNotProtectAgainst,
  };
}

/**
 * A `LaunchParams` with every field present, built from the few a launch
 * actually has to decide.
 *
 * The defaults are the boring ones — no listing, no cap, operator is the
 * caller, deadline is `block.timestamp` — so that a caller supplies the pair,
 * the price, the preset and the seed, and nothing is left implicitly zero by
 * accident. `preset` has NO default: see the header of `./presets.ts`.
 */
export function buildLaunchParams(input: {
  readonly launchToken: Address;
  readonly quoteToken: Address;
  readonly tickSpacing: number;
  readonly sqrtPriceX96: bigint;
  readonly preset: PresetName | number;
  readonly seed: SeedParams;
  readonly startDelaySeconds?: number;
  readonly maxBuyPerTx?: bigint;
  readonly launchOperator?: Address;
  readonly custom?: {
    readonly initialFeeBips: number;
    readonly finalFeeBips: number;
    readonly decayBlocks: number;
    readonly enabled: boolean;
  };
  readonly listing?: HookListingParams;
}): LaunchParams {
  const preset = parsePreset(input.preset);
  if (preset === PRESET.Custom && input.custom === undefined) {
    throw new Error(
      "preset is Custom but no `custom` schedule was supplied. Custom reads initialFeeBips, " +
        "finalFeeBips, decayBlocks and enabled — leaving them at zero produces an unprotected " +
        "launch that the chain accepts without complaint.",
    );
  }
  const custom = input.custom ?? { initialFeeBips: 0, finalFeeBips: 0, decayBlocks: 0, enabled: false };

  return {
    launchToken: input.launchToken,
    quoteToken: input.quoteToken,
    tickSpacing: input.tickSpacing,
    sqrtPriceX96: input.sqrtPriceX96,
    preset,
    initialFeeBips: custom.initialFeeBips,
    finalFeeBips: custom.finalFeeBips,
    decayBlocks: custom.decayBlocks,
    enabled: custom.enabled,
    startDelaySeconds: input.startDelaySeconds ?? 0,
    maxBuyPerTx: input.maxBuyPerTx ?? 0n,
    launchOperator: input.launchOperator ?? (ZERO_ADDRESS as Address),
    seed: input.seed,
    listing: input.listing ?? {
      register: false,
      steward: ZERO_ADDRESS as Address,
      metadata: { name: "", description: "", sourceURI: "", auditURI: "", chainIds: [] },
    },
  };
}

/**
 * The tuple `viem` wants for `createLaunch`, in ABI field order.
 *
 * Kept beside the interface so the two cannot drift: if a field is added to
 * `LaunchParams` upstream, this function stops compiling.
 */
export function launchParamsToTuple(p: LaunchParams) {
  return {
    launchToken: p.launchToken,
    quoteToken: p.quoteToken,
    tickSpacing: p.tickSpacing,
    sqrtPriceX96: p.sqrtPriceX96,
    preset: p.preset,
    initialFeeBips: p.initialFeeBips,
    finalFeeBips: p.finalFeeBips,
    decayBlocks: p.decayBlocks,
    enabled: p.enabled,
    startDelaySeconds: p.startDelaySeconds,
    maxBuyPerTx: p.maxBuyPerTx,
    launchOperator: p.launchOperator,
    seed: {
      tickLower: p.seed.tickLower,
      tickUpper: p.seed.tickUpper,
      launchTokenAmount: p.seed.launchTokenAmount,
      quoteTokenAmount: p.seed.quoteTokenAmount,
      positionRecipient: p.seed.positionRecipient,
      deadline: p.seed.deadline,
    },
    listing: {
      register: p.listing.register,
      steward: p.listing.steward,
      metadata: {
        name: p.listing.metadata.name,
        description: p.listing.metadata.description,
        sourceURI: p.listing.metadata.sourceURI,
        auditURI: p.listing.metadata.auditURI,
        chainIds: [...p.listing.metadata.chainIds],
      },
    },
  } as const;
}
