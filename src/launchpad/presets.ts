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
   `initialFeeBips`, `finalFeeBips`, `decayBlocks` and `enabled` from fields a
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
   the deployed kit resolves the preset with the kit's own block time. Use it
   before broadcasting. This table is for rendering, not for deciding.
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
  /** LP fee at the first block of the window, in pips (1e6 == 100%). */
  readonly initialFeeBips: number;
  /** LP fee once the window has elapsed, in pips. */
  readonly finalFeeBips: number;
  /** Length of the decay window IN SECONDS. The kit converts to blocks. */
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
      "observation. The pool, the config and the exact startBlock are public the moment the " +
      "transaction lands; a bot reading the chain knows your open block before you announce it.",
  },
  NoTax: {
    initialFeeBips: 3_000,
    finalFeeBips: 3_000,
    windowSeconds: 1,
    enabled: false,
    requiresMaxBuyPerTx: false,
    doesNotProtectAgainst: "anything. It is a plain 0.30% pool with a hook attached.",
  },
};

/**
 * Hard caps enforced by `LaunchGuardHook._validateConfig`, for pre-flighting a
 * `Custom` preset locally instead of paying for a reverted estimate.
 *
 * `MAX_DECAY_BLOCKS` and `MAX_START_DELAY` are NOT here — they are immutables
 * set per deployment from the chain's real block time, so read them off the
 * hook. Hardcoding them is the exact 12-second assumption that made them
 * immutable in the first place.
 */
export const LAUNCH_GUARD_LIMITS = {
  /** 50%. `initialFeeBips` may not exceed this. */
  MAX_INITIAL_FEE: 500_000,
  /** 10%. `finalFeeBips` may not exceed this. */
  MAX_FINAL_FEE: 100_000,
  /** Pips denominator, matching core. */
  PIPS: 1_000_000,
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
 * `LaunchPresets.secondsToBlocks`, to the block.
 *
 * Rounds UP, and floors at 1, exactly as the Solidity does — a window rounded
 * down to zero blocks is rejected by the hook, so the safe direction is one
 * block too many.
 *
 * @param blockTimeCentis Block time in HUNDREDTHS of a second. Read it from
 * the deployed kit (`blockTimeCentis()`), do not assume: Robinhood Chain's kit
 * is configured at 10 (0.10s), while a 12-second chain would be 1200. This
 * single number is the difference between a three-day launch and a
 * thirty-five-minute one.
 */
export function secondsToBlocks(secondsValue: number | bigint, blockTimeCentis: number | bigint): bigint {
  const s = BigInt(secondsValue);
  const centis = BigInt(blockTimeCentis);
  if (centis <= 0n) throw new RangeError("blockTimeCentis must be positive");
  if (s < 0n) throw new RangeError("seconds must not be negative");
  const blocks = (s * 100n + centis - 1n) / centis;
  return blocks === 0n ? 1n : blocks;
}

/** Inverse of {@link secondsToBlocks}, for turning a block count into wall clock. */
export function blocksToSeconds(blocks: number | bigint, blockTimeCentis: number | bigint): number {
  const b = BigInt(blocks);
  const centis = BigInt(blockTimeCentis);
  if (centis <= 0n) throw new RangeError("blockTimeCentis must be positive");
  return Number((b * centis) / 100n);
}

/**
 * A duration in words. Exists because "1000000 blocks" tells a reviewer
 * nothing and "28 hours" tells them everything — and on a 0.102s chain those
 * are the same quantity.
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
