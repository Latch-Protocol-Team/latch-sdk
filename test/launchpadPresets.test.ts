// SPDX-License-Identifier: MIT
/**
 * The preset table in the SDK is a MIRROR of `LaunchPresets.sol`, and mirrors
 * drift. The parity block below reads the Solidity and asserts every number,
 * so a change to a preset breaks this test rather than shipping a UI that
 * describes a schedule the chain will not run.
 *
 * If it fails: the Solidity is right and `src/launchpad/presets.ts` is wrong.
 *
 * The rest of the file covers the zero-value trap — `Preset.Custom` is 0, so
 * an unset field is a launch with no protection that the chain accepts without
 * complaint.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  LAUNCH_GUARD_LIMITS,
  PRESET,
  PRESET_NAMES,
  PRESET_PARAMS,
  blocksToSeconds,
  formatPips,
  humanDuration,
  parsePreset,
  presetName,
  secondsToBlocks,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
/* Monorepo-only; the public mirror has no Solidity. See launchpadPrice.test.ts. */
const PRESETS_SOL = join(HERE, "..", "..", "launchpad", "src", "libraries", "LaunchPresets.sol");
const HOOK_SOL = join(HERE, "..", "..", "hooks", "src", "launch", "LaunchGuardHook.sol");

/** Robinhood Chain's deployed kit: 10 centis = 0.10s per block. */
const ROBINHOOD_CENTIS = 10;
/** What a 12-second chain would be. Kept as the contrast case. */
const TWELVE_SECOND_CENTIS = 1200;

describe("Preset enum", () => {
  it("Custom is ZERO — the whole reason this module exists", () => {
    expect(PRESET.Custom).toBe(0);
  });

  it("declaration order is the wire encoding", () => {
    expect(PRESET_NAMES).toEqual([
      "Custom",
      "FairLaunch",
      "AntiSniperAggressive",
      "Stealth",
      "NoTax",
    ]);
    expect(PRESET.FairLaunch).toBe(1);
    expect(PRESET.AntiSniperAggressive).toBe(2);
    expect(PRESET.Stealth).toBe(3);
    expect(PRESET.NoTax).toBe(4);
  });

  it("parsePreset refuses the unknown rather than falling back to Custom", () => {
    expect(parsePreset("FairLaunch")).toBe(1);
    expect(parsePreset(3)).toBe(3);
    expect(() => parsePreset(5)).toThrow(RangeError);
    expect(() => parsePreset(-1)).toThrow(RangeError);
    expect(() => parsePreset("fairlaunch" as never)).toThrow(RangeError);
  });

  it("presetName round-trips every value", () => {
    for (const name of PRESET_NAMES) {
      expect(presetName(PRESET[name])).toBe(name);
    }
  });
});

describe("secondsToBlocks", () => {
  it("rounds UP, because a window rounded to zero is rejected by the hook", () => {
    expect(secondsToBlocks(1, TWELVE_SECOND_CENTIS)).toBe(1n);
    expect(secondsToBlocks(12, TWELVE_SECOND_CENTIS)).toBe(1n);
    expect(secondsToBlocks(13, TWELVE_SECOND_CENTIS)).toBe(2n);
  });

  it("never returns zero", () => {
    expect(secondsToBlocks(0, TWELVE_SECOND_CENTIS)).toBe(1n);
  });

  it("THE 118x GAP: the same window is a wildly different block count per chain", () => {
    const threeDays = 3 * 86_400;
    expect(secondsToBlocks(threeDays, TWELVE_SECOND_CENTIS)).toBe(21_600n);
    expect(secondsToBlocks(threeDays, ROBINHOOD_CENTIS)).toBe(2_592_000n);
    // 120x here because the kit is configured at 0.10s, rounded down from 0.102s.
    expect(secondsToBlocks(threeDays, ROBINHOOD_CENTIS) / secondsToBlocks(threeDays, TWELVE_SECOND_CENTIS)).toBe(120n);
  });

  it("blocksToSeconds inverts it", () => {
    expect(blocksToSeconds(2_592_000n, ROBINHOOD_CENTIS)).toBe(3 * 86_400);
    expect(blocksToSeconds(21_600n, TWELVE_SECOND_CENTIS)).toBe(3 * 86_400);
  });

  it("refuses a zero block time instead of dividing by it", () => {
    expect(() => secondsToBlocks(60, 0)).toThrow(RangeError);
    expect(() => blocksToSeconds(60, 0)).toThrow(RangeError);
  });
});

describe("formatting", () => {
  it("renders pips as the percentage a human reads", () => {
    expect(formatPips(1_000_000)).toBe("100%");
    expect(formatPips(500_000)).toBe("50%");
    expect(formatPips(100_000)).toBe("10%");
    expect(formatPips(3_000)).toBe("0.3%");
  });

  it("renders a duration as wall clock, which is the point", () => {
    expect(humanDuration(300)).toBe("5m");
    expect(humanDuration(1800)).toBe("30m");
    expect(humanDuration(86_400)).toBe("1d");
    expect(humanDuration(90_000)).toBe("1d 1h");
    expect(humanDuration(30)).toBe("30s");
  });
});

describe("every preset states what it does NOT protect against", () => {
  it("is never empty", () => {
    for (const name of PRESET_NAMES) {
      if (name === "Custom") continue;
      const p = PRESET_PARAMS[name];
      expect(p.doesNotProtectAgainst.length).toBeGreaterThan(20);
    }
  });

  it("every preset stays inside the hook's own ceilings", () => {
    for (const name of PRESET_NAMES) {
      if (name === "Custom") continue;
      const p = PRESET_PARAMS[name];
      expect(p.initialFeeBips).toBeLessThanOrEqual(LAUNCH_GUARD_LIMITS.MAX_INITIAL_FEE);
      expect(p.finalFeeBips).toBeLessThanOrEqual(LAUNCH_GUARD_LIMITS.MAX_FINAL_FEE);
      expect(p.initialFeeBips).toBeGreaterThanOrEqual(p.finalFeeBips);
      expect(p.windowSeconds).toBeGreaterThan(0);
    }
  });
});

describe.skipIf(!existsSync(PRESETS_SOL))("PRESET_PARAMS matches LaunchPresets.sol", () => {
  const src = existsSync(PRESETS_SOL) ? readFileSync(PRESETS_SOL, "utf8") : "";

  /** Pulls one preset's returned struct out of the Solidity source. */
  function solidityParams(name: string): Record<string, string> {
    const start = src.indexOf(`if (preset == Preset.${name})`);
    expect(start, `${name} not found in LaunchPresets.sol`).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("}", src.indexOf("return PresetParams({", start)));
    const out: Record<string, string> = {};
    for (const m of body.matchAll(/(\w+):\s*([\w_]+)/g)) {
      const key = m[1];
      const value = m[2];
      if (key !== undefined && value !== undefined) out[key] = value.replace(/_/g, "");
    }
    return out;
  }

  it.each(["FairLaunch", "AntiSniperAggressive", "Stealth", "NoTax"] as const)(
    "%s",
    (name) => {
      const sol = solidityParams(name);
      const ts = PRESET_PARAMS[name];
      expect(Number(sol["initialFeeBips"])).toBe(ts.initialFeeBips);
      expect(Number(sol["finalFeeBips"])).toBe(ts.finalFeeBips);
      expect(Number(sol["windowSeconds"])).toBe(ts.windowSeconds);
      expect(sol["enabled"] === "true").toBe(ts.enabled);
      expect(sol["requiresMaxBuyPerTx"] === "true").toBe(ts.requiresMaxBuyPerTx);
    },
  );

  it("the enum order in Solidity is the order encoded here", () => {
    const block = /enum Preset \{([^}]+)\}/.exec(src)?.[1] ?? "";
    const names = block
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(names).toEqual([...PRESET_NAMES]);
  });

  it("secondsToBlocks matches the Solidity's round-up formula", () => {
    expect(src).toContain("blocks = (centis + blockTimeCentis - 1) / blockTimeCentis;");
    expect(src).toContain("if (blocks == 0) blocks = 1;");
  });
});

describe.skipIf(!existsSync(HOOK_SOL))("LAUNCH_GUARD_LIMITS matches LaunchGuardHook.sol", () => {
  it("the fee ceilings are transcribed correctly", () => {
    const src = readFileSync(HOOK_SOL, "utf8");
    const initial = /uint24 public constant MAX_INITIAL_FEE = ([\d_]+);/.exec(src)?.[1];
    const final = /uint24 public constant MAX_FINAL_FEE = ([\d_]+);/.exec(src)?.[1];
    expect(Number(initial?.replace(/_/g, ""))).toBe(LAUNCH_GUARD_LIMITS.MAX_INITIAL_FEE);
    expect(Number(final?.replace(/_/g, ""))).toBe(LAUNCH_GUARD_LIMITS.MAX_FINAL_FEE);
  });

  it("MAX_DECAY_BLOCKS is an immutable, so the SDK must NOT hardcode it", () => {
    const src = readFileSync(HOOK_SOL, "utf8");
    expect(src).toContain("uint32 public immutable MAX_DECAY_BLOCKS;");
    expect(src).toContain("uint48 public immutable MAX_START_DELAY;");
    expect(LAUNCH_GUARD_LIMITS).not.toHaveProperty("MAX_DECAY_BLOCKS");
    expect(LAUNCH_GUARD_LIMITS).not.toHaveProperty("MAX_START_DELAY");
  });
});
