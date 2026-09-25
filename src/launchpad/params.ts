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

   TWO KIT GENERATIONS, ONE PARAMETER TYPE. `LaunchParams.decaySeconds` is
   always seconds. The timestamp kit (Option B, 2026-09-13) takes it as-is. The
   block-numbered kit still deployed on Robinhood takes `decayBlocks`, and
   `launchParamsToBlockTuple` converts at that kit's DECLARED block time — the
   same conversion the kit applies to its own presets. Every "how long does this
   really last" answer for a block kit then uses the chain's REAL contract block
   time, because on Robinhood those two numbers are 120x apart.

   The rule the checks follow: ERROR on what the chain would refuse, WARN on
   what the chain would accept but a human probably did not mean.
   ============================================================================ */

import type { Address } from "viem";

import type { DurationClock } from "../deployments/index.js";
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

/** Mirrors the timestamp kit's `struct LaunchParams`, field for field and in order. */
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
  /**
   * Ignored unless `preset === PRESET.Custom`. SECONDS of `block.timestamp`,
   * inside [60 s, 30 days] on the timestamp hook.
   */
  readonly decaySeconds: number;
  /** Ignored unless `preset === PRESET.Custom`. */
  readonly enabled: boolean;
  /** Seconds from THIS TRANSACTION LANDING until trading opens. */
  readonly startDelaySeconds: number;
  /** Per-TRANSACTION cap on a buy's input, in quote units. `0n` disables. NOT per wallet. */
  readonly maxBuyPerTx: bigint;
  /** May reconfigure until trading opens. Zero address means `msg.sender`. Not transferable. */
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

/**
 * Deployment facts the validator cannot know and must not assume.
 *
 * A discriminated union on `durationClock`, taken from
 * `LatchDeployment.durationClocks.launchpadKit`. The two generations need
 * different facts, and a block kit without its two block times is refused by the
 * type checker rather than rendered with a guess.
 */
export type LaunchLimits = TimestampLaunchLimits | BlockLaunchLimits;

/** The timestamp kit: nothing about the chain's cadence is needed. */
export interface TimestampLaunchLimits {
  readonly durationClock: "timestamp";
}

/** The block-numbered kit still deployed on Robinhood. */
export interface BlockLaunchLimits {
  readonly durationClock: "contract-block";
  /**
   * From the kit's `blockTimeCentis()`. Hundredths of a second. What the KIT
   * BELIEVES and uses to turn seconds into blocks — a conversion input, not a
   * fact about the chain. The live Robinhood kit declares 10.
   */
  readonly blockTimeCentis: number;
  /**
   * The REAL cadence of `block.number` as the hook sees it, in hundredths of a
   * second — `LatchDeployment.contractBlockTimeCentis`. Required, not defaulted
   * to `blockTimeCentis`, because the two are 120x apart on Robinhood.
   */
  readonly contractBlockTimeCentis: number;
  /** From that hook's `MAX_DECAY_BLOCKS()`. */
  readonly maxDecayBlocks?: bigint;
  /** From that hook's `MAX_START_DELAY()`. */
  readonly maxStartDelayBlocks?: bigint;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Real / declared block time for a block kit, or `null` when they agree within
 * a factor of 1.5 (or the kit is timestamp-clocked, where there is no stretch).
 */
function clockStretchOf(limits: LaunchLimits): number | null {
  if (limits.durationClock === "timestamp") return null;
  if (limits.blockTimeCentis <= 0 || limits.contractBlockTimeCentis <= 0) {
    throw new RangeError("blockTimeCentis and contractBlockTimeCentis must be positive");
  }
  const ratio = limits.contractBlockTimeCentis / limits.blockTimeCentis;
  return ratio > 1.5 || ratio < 1 / 1.5 ? ratio : null;
}

function formatStretch(stretch: number): string {
  return stretch >= 1
    ? `${Number.parseFloat(stretch.toFixed(1))}x longer than declared`
    : `${Number.parseFloat((1 / stretch).toFixed(1))}x shorter than declared`;
}

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
    /* THE ZERO-VALUE TRAP. Custom is 0, so an unset field lands here. */
    if (p.initialFeeBips === 0 && p.finalFeeBips === 0 && p.decaySeconds === 0 && !p.enabled) {
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
      validateCustomDecay(p, limits, err, warn);
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
    if (p.initialFeeBips !== 0 || p.finalFeeBips !== 0 || p.decaySeconds !== 0 || p.enabled) {
      warn(
        "preset",
        `Preset ${name} OVERWRITES initialFeeBips, finalFeeBips, decaySeconds and enabled. ` +
          "The values you set in those fields are ignored — set preset to Custom to use them.",
      );
    }
    if (limits.durationClock === "contract-block") {
      const stretch = clockStretchOf(limits);
      const blocks = secondsToBlocks(pp.windowSeconds, limits.blockTimeCentis);
      if (stretch !== null) {
        warn(
          "preset",
          `Preset ${name} promises a ${humanDuration(pp.windowSeconds)} window, but this block-numbered kit ` +
            `converts seconds at ${limits.blockTimeCentis / 100}s per block while the hook's block.number ` +
            `advances every ${limits.contractBlockTimeCentis / 100}s. The window is ${blocks} blocks, which ` +
            `really lasts ${humanDuration(blocksToSeconds(blocks, limits.contractBlockTimeCentis))} ` +
            `(${formatStretch(stretch)}).`,
        );
      }
      if (limits.maxDecayBlocks !== undefined && blocks > limits.maxDecayBlocks) {
        err(
          "preset",
          `Preset ${name}'s ${pp.windowSeconds}s window is ${blocks} blocks on this kit, ` +
            `above MAX_DECAY_BLOCKS (${limits.maxDecayBlocks}).`,
          "DecayWindowTooLong(uint256)",
        );
      }
    }
  }

  /* ---- start delay ---- */
  if (p.startDelaySeconds < 0) {
    err("startDelaySeconds", "startDelaySeconds must not be negative.");
  } else if (limits.durationClock === "timestamp") {
    if (p.startDelaySeconds > LAUNCH_GUARD_LIMITS.MAX_START_DELAY_SECONDS) {
      err(
        "startDelaySeconds",
        `A ${humanDuration(p.startDelaySeconds)} delay is above the hook's MAX_START_DELAY_SECONDS ` +
          `(${humanDuration(LAUNCH_GUARD_LIMITS.MAX_START_DELAY_SECONDS)}).`,
        "StartDelayTooLong(uint256)",
      );
    }
  } else if (p.startDelaySeconds > 0) {
    const blocks = secondsToBlocks(p.startDelaySeconds, limits.blockTimeCentis);
    const stretch = clockStretchOf(limits);
    if (stretch !== null) {
      warn(
        "startDelaySeconds",
        `A ${humanDuration(p.startDelaySeconds)} delay becomes ${blocks} blocks at this kit's declared ` +
          `${limits.blockTimeCentis / 100}s per block, and trading really opens after ` +
          `${humanDuration(blocksToSeconds(blocks, limits.contractBlockTimeCentis))} (${formatStretch(stretch)}).`,
      );
    }
    if (limits.maxStartDelayBlocks !== undefined && blocks > limits.maxStartDelayBlocks) {
      err(
        "startDelaySeconds",
        `A ${humanDuration(p.startDelaySeconds)} delay is ${blocks} blocks on this kit, ` +
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
        "address that can reconfigure before trading opens, it freezes when trading opens, and it " +
        "is not transferable — so make it deliberate rather than incidental.",
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

function validateCustomDecay(
  p: LaunchParams,
  limits: LaunchLimits,
  err: (field: string, message: string, contractError?: string) => void,
  warn: (field: string, message: string) => void,
): void {
  if (limits.durationClock === "timestamp") {
    if (p.decaySeconds < LAUNCH_GUARD_LIMITS.MIN_DECAY_SECONDS) {
      err(
        "decaySeconds",
        `decaySeconds ${p.decaySeconds} is below the hook's MIN_DECAY_SECONDS ` +
          `(${LAUNCH_GUARD_LIMITS.MIN_DECAY_SECONDS}). A shorter window is within sequencer clock skew.`,
        "InvalidDecaySeconds(uint32)",
      );
    } else if (p.decaySeconds > LAUNCH_GUARD_LIMITS.MAX_DECAY_SECONDS) {
      err(
        "decaySeconds",
        `decaySeconds ${p.decaySeconds} (${humanDuration(p.decaySeconds)}) is above the hook's ` +
          `MAX_DECAY_SECONDS (${humanDuration(LAUNCH_GUARD_LIMITS.MAX_DECAY_SECONDS)}).`,
        "InvalidDecaySeconds(uint32)",
      );
    }
    return;
  }

  if (p.decaySeconds <= 0) {
    err("decaySeconds", "decaySeconds must be positive.", "InvalidDecayBlocks(uint32)");
    return;
  }
  const blocks = secondsToBlocks(p.decaySeconds, limits.blockTimeCentis);
  if (limits.maxDecayBlocks !== undefined && blocks > limits.maxDecayBlocks) {
    err(
      "decaySeconds",
      `decaySeconds ${p.decaySeconds} is ${blocks} blocks on this block-numbered kit, above ` +
        `MAX_DECAY_BLOCKS (${limits.maxDecayBlocks}).`,
      "InvalidDecayBlocks(uint32)",
    );
  }
  const stretch = clockStretchOf(limits);
  if (stretch !== null) {
    warn(
      "decaySeconds",
      `${humanDuration(p.decaySeconds)} becomes ${blocks} blocks at this kit's declared ` +
        `${limits.blockTimeCentis / 100}s per block, which really lasts ` +
        `${humanDuration(blocksToSeconds(blocks, limits.contractBlockTimeCentis))} (${formatStretch(stretch)}).`,
    );
  }
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
  /** Which kit generation this summary describes. */
  readonly durationClock: DurationClock;
  /** Fee at the start of the window. */
  readonly initialFee: string;
  /** Fee once the window has elapsed. */
  readonly finalFee: string;
  /** Seconds the configuration asks for (the preset's own, or `decaySeconds` for Custom). */
  readonly decaySeconds: number;
  /** Block kits only: the window in contract blocks. `null` on a timestamp kit. */
  readonly decayBlocks: bigint | null;
  /** The window as REAL wall-clock time on this chain. The number that matters. */
  readonly decayWindow: string;
  /** What the configuration promises. Equals `decayWindow` except on a mis-sized block kit. */
  readonly declaredDecayWindow: string;
  /** When trading really opens, relative to the transaction landing. */
  readonly opensAfter: string;
  /** `contractBlockTimeCentis / blockTimeCentis` on a mis-sized block kit, else `null`. */
  readonly clockStretch: number | null;
  readonly gated: boolean;
  readonly maxBuyPerTx: bigint;
  /** What this configuration does not protect against. Never empty. */
  readonly doesNotProtectAgainst: string;
}

/**
 * Resolves a `LaunchParams` into the summary a launcher should read before
 * broadcasting — with the decay window in real time, not blocks.
 *
 * This is a local preview. `previewSchedule(params)` on the deployed kit is
 * the authoritative one and should be shown beside it.
 */
export function describeLaunch(p: LaunchParams, limits: LaunchLimits): LaunchSummary {
  const preset = parsePreset(p.preset);
  const name = presetName(preset);
  const stretch = clockStretchOf(limits);
  const custom = name === "Custom";
  const pp = custom ? undefined : PRESET_PARAMS[name];
  const seconds = pp === undefined ? p.decaySeconds : pp.windowSeconds;

  const real = (s: number): { blocks: bigint | null; seconds: number } => {
    if (limits.durationClock === "timestamp") return { blocks: null, seconds: s };
    const blocks = secondsToBlocks(s, limits.blockTimeCentis);
    return { blocks, seconds: blocksToSeconds(blocks, limits.contractBlockTimeCentis) };
  };

  const decay = real(seconds);
  const opensAfter = p.startDelaySeconds === 0 ? "immediately" : humanDuration(real(p.startDelaySeconds).seconds);

  return {
    preset: name,
    durationClock: limits.durationClock,
    initialFee: formatPips(pp === undefined ? p.initialFeeBips : pp.initialFeeBips),
    finalFee: formatPips(pp === undefined ? p.finalFeeBips : pp.finalFeeBips),
    decaySeconds: seconds,
    decayBlocks: decay.blocks,
    decayWindow: humanDuration(decay.seconds),
    declaredDecayWindow: humanDuration(seconds),
    opensAfter,
    clockStretch: stretch,
    gated: pp === undefined ? p.enabled : pp.enabled,
    maxBuyPerTx: p.maxBuyPerTx,
    doesNotProtectAgainst:
      pp === undefined
        ? "whatever this custom schedule does not cover. No preset here offers a per-wallet cap, " +
          "an allowlist, or protection on any other venue."
        : pp.doesNotProtectAgainst,
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
    readonly decaySeconds: number;
    readonly enabled: boolean;
  };
  readonly listing?: HookListingParams;
}): LaunchParams {
  const preset = parsePreset(input.preset);
  if (preset === PRESET.Custom && input.custom === undefined) {
    throw new Error(
      "preset is Custom but no `custom` schedule was supplied. Custom reads initialFeeBips, " +
        "finalFeeBips, decaySeconds and enabled — leaving them at zero produces an unprotected " +
        "launch that the chain accepts without complaint.",
    );
  }
  const custom = input.custom ?? { initialFeeBips: 0, finalFeeBips: 0, decaySeconds: 0, enabled: false };

  return {
    launchToken: input.launchToken,
    quoteToken: input.quoteToken,
    tickSpacing: input.tickSpacing,
    sqrtPriceX96: input.sqrtPriceX96,
    preset,
    initialFeeBips: custom.initialFeeBips,
    finalFeeBips: custom.finalFeeBips,
    decaySeconds: custom.decaySeconds,
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

function seedAndListing(p: LaunchParams) {
  return {
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

/**
 * The tuple `viem` wants for the TIMESTAMP kit's `createLaunch` (`LAUNCHPAD_KIT_ABI`),
 * in ABI field order. If a field is added upstream, this stops compiling.
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
    decaySeconds: p.decaySeconds,
    enabled: p.enabled,
    startDelaySeconds: p.startDelaySeconds,
    maxBuyPerTx: p.maxBuyPerTx,
    launchOperator: p.launchOperator,
    ...seedAndListing(p),
  } as const;
}

/**
 * The tuple for the BLOCK-NUMBERED kit's `createLaunch` (`LAUNCHPAD_KIT_BLOCK_ABI`).
 *
 * `decaySeconds` is converted to `decayBlocks` at the kit's DECLARED block time,
 * which is exactly what that kit does to its own presets. It is NOT converted at
 * the real contract clock, because the kit would then disagree with itself; the
 * real duration is what `describeLaunch` reports.
 */
export function launchParamsToBlockTuple(p: LaunchParams, limits: BlockLaunchLimits) {
  const decayBlocks = p.decaySeconds === 0 ? 0n : secondsToBlocks(p.decaySeconds, limits.blockTimeCentis);
  if (decayBlocks > 0xffff_ffffn) throw new RangeError("decayBlocks does not fit uint32");
  return {
    launchToken: p.launchToken,
    quoteToken: p.quoteToken,
    tickSpacing: p.tickSpacing,
    sqrtPriceX96: p.sqrtPriceX96,
    preset: p.preset,
    initialFeeBips: p.initialFeeBips,
    finalFeeBips: p.finalFeeBips,
    decayBlocks: Number(decayBlocks),
    enabled: p.enabled,
    startDelaySeconds: p.startDelaySeconds,
    maxBuyPerTx: p.maxBuyPerTx,
    launchOperator: p.launchOperator,
    ...seedAndListing(p),
  } as const;
}
