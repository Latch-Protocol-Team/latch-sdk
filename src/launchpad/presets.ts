// SPDX-License-Identifier: MIT
/* ============================================================================
   The launch presets, as values a TypeScript caller can name.

   WHY. `Preset` reached the SDK only as the string `"enum Preset"` buried in
   the generated ABI JSON. Encoding a `createLaunch` call therefore meant
   knowing, from reading Solidity, that `FairLaunch` is 1 — and, much worse,
   that `Custom` is 0.

   CUSTOM IS THE ZERO VALUE. That is the trap this module exists to close. An
   unset form field, a missing property, a `?? 0` default, a struct built from
   `{}` — every one of those means `Preset.Custom`, and Custom then reads
   `initialFeeBips`, `finalFeeBips`, `decaySeconds` and `enabled` from fields a
   preset-driven UI never filled in. The kit does not reject it. You get a
   launch with no anti-sniper protection and no error anywhere.

   So `PRESET` is exported as named constants, `parsePreset` refuses anything
   it does not recognise, and `validateLaunchParams` (in `./params.ts`) treats
   a Custom with empty fields as an error rather than a default.

   THE NUMBERS BELOW ARE A MIRROR, AND MIRRORS DRIFT. `PRESET_PARAMS` restates
   what `LaunchPresets.sol` returns, so a UI can render a schedule without an
   RPC round trip. `test/launchpadPresets.test.ts` reads the Solidity and
   asserts every field matches. If that test fails, the Solidity is right and
   this file is wrong — never the other way round.

   The authority at runtime is still the chain: `previewSchedule(params)` on
   the deployed kit resolves the preset exactly as a launch would. Use it
   before broadcasting. This table is for rendering, not for deciding.

   TWO KIT GENERATIONS. The timestamp kit (Option B, 2026-09-13) writes these
   seconds to the hook unconverted. The block-numbered kit still deployed on
   Robinhood converts them to blocks at its declared `blockTimeCentis` (10),
   and the hook then waits those blocks on the real ~12 s contract clock, so
   the same preset runs ~120x long there. Which kit a deployment points at is
   `LatchDeployment.durationClocks.launchpadKit`; `describeLaunch` takes it.
   ============================================================================ */

/**
 * `enum Preset` from `packages/launchpad/src/libraries/LaunchPresets.sol`.
 *
 * Declaration order IS the wire encoding. Do not reorder, and do not insert.
 */
export const PRESET = {
  /** Use the numbers I passed. **The zero value — see the module header.** */
  Custom: 0,
  /** 10% decaying to 0.30% over five minutes. */
  FairLaunch: 1,
  /** 50% decaying to 1% over thirty minutes. Requires `maxBuyPerTx`. */
  AntiSniperAggressive: 2,
  /** 50% decaying to 0.30% over two minutes. Pairs with a start delay. */
  Stealth: 3,
  /** No gate, no decay: a flat 0.30% pool with the launch plumbing attached. */
  NoTax: 4,
} as const;

export type PresetName = keyof typeof PRESET;
export type PresetValue = (typeof PRESET)[PresetName];

/** Every preset name, in declaration order. */
export const PRESET_NAMES = Object.keys(PRESET) as readonly PresetName[];

/** The parameters a preset fixes. Mirrors `struct PresetParams`. */
export interface PresetParams {
  /** LP fee at the start of the window, in pips (1e6 == 100%). */
  readonly initialFeeBips: number;
  /** LP fee once the window has elapsed, in pips. */
  readonly finalFeeBips: number;
  /** Length of the decay window IN SECONDS. A timestamp kit writes it as-is; a block kit converts. */
  readonly windowSeconds: number;
  /** When false the hook applies no gate and pins the fee at `finalFeeBips`. */
  readonly enabled: boolean;
  /** When true, a launch without `maxBuyPerTx` reverts `MaxBuyRequiredByPreset`. */
  readonly requiresMaxBuyPerTx: boolean;
  /**
   * What this preset does NOT do. Copied from the Solidity, because a preset
   * name is a promise and these are the parts of it that are not true.
   */
  readonly doesNotProtectAgainst: string;
}

/**
 * @see the module header — this is a mirror of `LaunchPresets.params`, checked
 * against the Solidity by a parity test.
 *
 * `Custom` is absent on purpose: `LaunchPresets.params(Custom)` reverts
 * `NoParametersForCustomPreset`, and a lookup that returns `undefined` here
 * says the same thing in TypeScript.
 */
export const PRESET_PARAMS: Readonly<Record<Exclude<PresetName, "Custom">, PresetParams>> = {
  FairLaunch: {
    initialFeeBips: 100_000,
    finalFeeBips: 3_000,
    windowSeconds: 300,
    enabled: true,
    requiresMaxBuyPerTx: false,
    doesNotProtectAgainst:
      "a buyer who simply waits five minutes. It removes free money at the open, nothing more.",
  },
  AntiSniperAggressive: {
    initialFeeBips: 500_000,
    finalFeeBips: 10_000,
    windowSeconds: 1800,
    enabled: true,
    requiresMaxBuyPerTx: true,
    doesNotProtectAgainst:
      "sybil splitting across wallets or transactions. Thirty minutes of elevated fees also taxes " +
      "genuine buyers and deters arbitrage, so the price can stay dislocated for the whole window.",
  },
  Stealth: {
    initialFeeBips: 500_000,
    finalFeeBips: 3_000,
    windowSeconds: 120,
    enabled: true,
    requiresMaxBuyPerTx: false,
    doesNotProtectAgainst:
      "observation. The pool, the config and the exact start time are public the moment the " +
      "transaction lands; a bot reading the chain knows your open before you announce it.",
  },
  NoTax: {
    initialFeeBips: 3_000,
    finalFeeBips: 3_000,
    /* The hook's MIN_DECAY_SECONDS. Irrelevant to the fee: the schedule is flat
       and disabled, but the timestamp hook validates every config against it. */
    windowSeconds: 60,
    enabled: false,
    requiresMaxBuyPerTx: false,
    doesNotProtectAgainst: "anything. It is a plain 0.30% pool with a hook attached.",
  },
};

/**
 * Hard caps enforced by `LaunchGuardHook._validateConfig`, for pre-flighting a
 * `Custom` preset locally instead of paying for a reverted estimate.
 *
 * The three `*_SECONDS` bounds are CONSTANTS on the timestamp hook and are
 * mirrored here with a parity test against the Solidity. They do NOT describe the
 * block-numbered hook still deployed on Robinhood, whose `MAX_DECAY_BLOCKS` and
 * `MAX_START_DELAY` are per-deployment immutables: read those off that hook.
 */
export const LAUNCH_GUARD_LIMITS = {
  /** 50%. `initialFeeBips` may not exceed this. */
  MAX_INITIAL_FEE: 500_000,
  /** 10%. `finalFeeBips` may not exceed this. */
  MAX_FINAL_FEE: 100_000,
  /** Pips denominator, matching core. */
  PIPS: 1_000_000,
  /** Timestamp hook: shortest decay window, seconds. Sized against sequencer clock skew. */
  MIN_DECAY_SECONDS: 60,
  /** Timestamp hook: longest decay window, seconds (30 days). */
  MAX_DECAY_SECONDS: 2_592_000,
  /** Timestamp hook: furthest a start may be scheduled, seconds (30 days). */
  MAX_START_DELAY_SECONDS: 2_592_000,
} as const;

/**
 * Accepts a name or a raw uint8 and returns the wire value.
 *
 * Deliberately strict: an unknown string or an out-of-range number throws
 * rather than falling back to 0, because falling back to 0 is falling back to
 * Custom.
 */
export function parsePreset(preset: PresetName | number): PresetValue {
  if (typeof preset === "number") {
    const match = PRESET_NAMES.find((n) => PRESET[n] === preset);
    if (match === undefined) {
      throw new RangeError(
        `${preset} is not a Preset. Valid values are 0-4 (${PRESET_NAMES.join(", ")}).`,
      );
    }
    return PRESET[match];
  }
  const value = PRESET[preset];
  if (value === undefined) {
    throw new RangeError(`"${preset}" is not a Preset. Valid names: ${PRESET_NAMES.join(", ")}.`);
  }
  return value;
}

/** The name for a wire value, for rendering a launch read back off chain. */
export function presetName(value: number): PresetName {
  const match = PRESET_NAMES.find((n) => PRESET[n] === value);
  if (match === undefined) throw new RangeError(`${value} is not a Preset`);
  return match;
}

/**
 * `LaunchPresets.secondsToBlocks` of the BLOCK-NUMBERED kit, to the block.
 * The timestamp kit has no such conversion; this exists to describe the
 * deployed block kit truthfully.
 *
 * Rounds UP, and floors at 1, exactly as that Solidity did — a window rounded
 * down to zero blocks is rejected by the hook, so the safe direction is one
 * block too many.
 *
 * @param blockTimeCentis Block time in HUNDREDTHS of a second. To reproduce
 * what a deployed kit will compute, pass the kit's own `blockTimeCentis()`. To
 * learn how long those blocks REALLY last, convert back with the chain's
 * `contractBlockTimeCentis` (see `chains/clock`), not with the same number:
 * the live Robinhood kit declares 10 (0.1 s) but the hook's `block.number` is
 * Ethereum's and advances every ~12 s, so its windows run 120x longer than the
 * seconds they came from.
 */
export function secondsToBlocks(secondsValue: number | bigint, blockTimeCentis: number | bigint): bigint {
  const s = BigInt(secondsValue);
  const centis = BigInt(blockTimeCentis);
  if (centis <= 0n) throw new RangeError("blockTimeCentis must be positive");
  if (s < 0n) throw new RangeError("seconds must not be negative");
  const blocks = (s * 100n + centis - 1n) / centis;
  return blocks === 0n ? 1n : blocks;
}

/**
 * Inverse of {@link secondsToBlocks}. Real wall clock only when
 * `blockTimeCentis` is the chain's REAL contract cadence
 * (`contractBlockTimeCentis`), not a contract's declared one.
 */
export function blocksToSeconds(blocks: number | bigint, blockTimeCentis: number | bigint): number {
  const b = BigInt(blocks);
  const centis = BigInt(blockTimeCentis);
  if (centis <= 0n) throw new RangeError("blockTimeCentis must be positive");
  return Number((b * centis) / 100n);
}

/**
 * A duration in words. Exists because "26000000 blocks" tells a reviewer
 * nothing and "3611d" (9.9 years) tells them everything — and on Robinhood, where a
 * contract block is ~12 s, those are the same quantity.
 */
export function humanDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "unknown";
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
  const units: ReadonlyArray<readonly [string, number]> = [
    ["d", 86_400],
    ["h", 3_600],
    ["m", 60],
  ];
  let rest = Math.round(totalSeconds);
  const parts: string[] = [];
  for (const [suffix, size] of units) {
    const n = Math.floor(rest / size);
    if (n > 0) {
      parts.push(`${n}${suffix}`);
      rest -= n * size;
    }
    if (parts.length === 2) break;
  }
  return parts.length > 0 ? parts.join(" ") : `${rest}s`;
}

/** Renders a pip fee as a percentage string: `100_000` -> `"10%"`. */
export function formatPips(pips: number): string {
  const pct = (pips / LAUNCH_GUARD_LIMITS.PIPS) * 100;
  return `${Number.parseFloat(pct.toFixed(4))}%`;
}
