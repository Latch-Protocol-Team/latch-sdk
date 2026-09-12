// SPDX-License-Identifier: MIT
/**
 * `validateLaunchParams` earns its place on two cases the CHAIN ACCEPTS:
 *
 *   1. a Custom preset with empty fields — what an unset preset decays to;
 *   2. a preset whose custom fields were filled in and will be ignored.
 *
 * Neither reverts. Both produce a launch that is not the one the launcher
 * described. Everything else here is a local restatement of a contract check,
 * and is tested to name the right field and cite the right custom error, since
 * a validator that says "invalid" is barely better than the revert.
 */
import { describe, expect, it } from "vitest";

import {
  PRESET,
  Q96,
  assertLaunchParams,
  buildLaunchParams,
  describeLaunch,
  launchParamsToTuple,
  sqrtPriceForLaunch,
  validateLaunchParams,
  type LaunchLimits,
  type LaunchParams,
  type SeedParams,
} from "../src/index.js";

const LAUNCH = "0x1111111111111111111111111111111111111111" as const;
const QUOTE = "0x2222222222222222222222222222222222222222" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

/** Robinhood Chain: kit at 10 centis, hook immutables read off chain. */
const LIMITS: LaunchLimits = {
  blockTimeCentis: 10,
  maxDecayBlocks: 2_592_000n, // 3 days at 0.10s
  maxStartDelayBlocks: 2_592_000n,
};

const SEED: SeedParams = {
  tickLower: -60,
  tickUpper: 60,
  launchTokenAmount: 1_000n * 10n ** 18n,
  quoteTokenAmount: 1_000n * 10n ** 6n,
  positionRecipient: ZERO,
  deadline: 0n,
};

function params(over: Partial<LaunchParams> = {}): LaunchParams {
  const base = buildLaunchParams({
    launchToken: LAUNCH,
    quoteToken: QUOTE,
    tickSpacing: 60,
    sqrtPriceX96: Q96,
    preset: "FairLaunch",
    seed: SEED,
  });
  return { ...base, ...over };
}

const errorsOf = (p: LaunchParams) =>
  validateLaunchParams(p, LIMITS).filter((i) => i.severity === "error");
const fieldsOf = (p: LaunchParams) => validateLaunchParams(p, LIMITS).map((i) => i.field);

describe("the zero-value trap", () => {
  it("Custom with every field empty is an ERROR, not a launch", () => {
    const issues = errorsOf(params({ preset: PRESET.Custom }));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.field).toBe("preset");
    expect(issues[0]?.message).toContain("ZERO value");
  });

  it("a coherent Custom is accepted", () => {
    const p = params({
      preset: PRESET.Custom,
      initialFeeBips: 100_000,
      finalFeeBips: 3_000,
      decayBlocks: 3_000,
      enabled: true,
    });
    expect(errorsOf(p)).toHaveLength(0);
  });

  it("buildLaunchParams refuses Custom without a schedule at construction time", () => {
    expect(() =>
      buildLaunchParams({
        launchToken: LAUNCH,
        quoteToken: QUOTE,
        tickSpacing: 60,
        sqrtPriceX96: Q96,
        preset: "Custom",
        seed: SEED,
      }),
    ).toThrow(/no `custom` schedule/);
  });

  it("warns when a named preset will silently overwrite custom fields", () => {
    const p = params({ preset: PRESET.FairLaunch, initialFeeBips: 250_000 });
    const issues = validateLaunchParams(p, LIMITS);
    const warn = issues.find((i) => i.severity === "warning" && i.field === "preset");
    expect(warn?.message).toContain("OVERWRITES");
    // The chain does not reject this, so it must not be an error here either.
    expect(errorsOf(p)).toHaveLength(0);
  });
});

describe("checks that mirror a contract revert", () => {
  it("AntiSniperAggressive without a cap cites MaxBuyRequiredByPreset", () => {
    const p = params({ preset: PRESET.AntiSniperAggressive, maxBuyPerTx: 0n });
    const issue = errorsOf(p).find((i) => i.field === "maxBuyPerTx");
    expect(issue?.contractError).toBe("MaxBuyRequiredByPreset(uint8)");
  });

  it("AntiSniperAggressive with a cap passes", () => {
    const p = params({ preset: PRESET.AntiSniperAggressive, maxBuyPerTx: 10n ** 6n });
    expect(errorsOf(p)).toHaveLength(0);
  });

  it("a native launch token is refused", () => {
    const issue = errorsOf(params({ launchToken: ZERO })).find((i) => i.field === "launchToken");
    expect(issue?.contractError).toBe("LaunchTokenCannotBeNative()");
  });

  it("an identical pair is refused", () => {
    const issue = errorsOf(params({ quoteToken: LAUNCH })).find((i) => i.field === "quoteToken");
    expect(issue?.contractError).toBe("IdenticalCurrencies(address)");
  });

  it("an inverted tick range is refused", () => {
    const p = params({ seed: { ...SEED, tickLower: 60, tickUpper: -60 } });
    expect(errorsOf(p).some((i) => i.field === "seed.tickLower")).toBe(true);
  });

  it("ticks off the spacing grid are refused", () => {
    const p = params({ seed: { ...SEED, tickLower: -61, tickUpper: 60 } });
    expect(errorsOf(p).some((i) => i.field === "seed.tickLower")).toBe(true);
  });

  it("a sqrtPriceX96 outside TickMath's range is refused", () => {
    expect(errorsOf(params({ sqrtPriceX96: 1n })).some((i) => i.field === "sqrtPriceX96")).toBe(true);
  });

  it("a fee schedule that rises instead of decaying is refused", () => {
    const p = params({
      preset: PRESET.Custom,
      initialFeeBips: 3_000,
      finalFeeBips: 100_000,
      decayBlocks: 3_000,
      enabled: true,
    });
    const issue = errorsOf(p).find((i) => i.field === "initialFeeBips");
    expect(issue?.contractError).toBe("InvalidFeeSchedule(uint24,uint24)");
  });

  it("fees above the hook's ceilings are refused", () => {
    const p = params({
      preset: PRESET.Custom,
      initialFeeBips: 600_000,
      finalFeeBips: 200_000,
      decayBlocks: 3_000,
      enabled: true,
    });
    const fields = errorsOf(p).map((i) => i.field);
    expect(fields).toContain("initialFeeBips");
    expect(fields).toContain("finalFeeBips");
  });

  it("a decay window past this deployment's immutable is refused", () => {
    const p = params({
      preset: PRESET.Custom,
      initialFeeBips: 100_000,
      finalFeeBips: 3_000,
      decayBlocks: 9_000_000,
      enabled: true,
    });
    const issue = errorsOf(p).find((i) => i.field === "decayBlocks");
    expect(issue?.contractError).toBe("DecayWindowTooLong(uint256)");
  });

  it("a start delay past this deployment's immutable is refused", () => {
    const p = params({ startDelaySeconds: 30 * 86_400 });
    const issue = errorsOf(p).find((i) => i.field === "startDelaySeconds");
    expect(issue?.contractError).toBe("StartDelayTooLong(uint256)");
  });
});

describe("warnings the chain will not give you", () => {
  it("warns that decayBlocks is BLOCKS when the window is implausibly short", () => {
    const p = params({
      preset: PRESET.Custom,
      initialFeeBips: 100_000,
      finalFeeBips: 3_000,
      decayBlocks: 300, // reads like "5 minutes"; it is 30 seconds here
      enabled: true,
    });
    const warn = validateLaunchParams(p, LIMITS).find((i) => i.field === "decayBlocks");
    expect(warn?.severity).toBe("warning");
    expect(warn?.message).toContain("BLOCKS, not seconds");
  });

  it("warns that maxBuyPerTx is per transaction, not per wallet", () => {
    const warn = validateLaunchParams(params({ maxBuyPerTx: 1n }), LIMITS).find(
      (i) => i.field === "maxBuyPerTx",
    );
    expect(warn?.message).toContain("not one wallet");
  });

  it("warns about an incidental launchOperator", () => {
    expect(fieldsOf(params())).toContain("launchOperator");
  });

  it("warns when the seed adds no liquidity", () => {
    const p = params({ seed: { ...SEED, launchTokenAmount: 0n, quoteTokenAmount: 0n } });
    expect(fieldsOf(p)).toContain("seed");
  });
});

describe("describeLaunch", () => {
  it("reports the window in wall clock, not blocks", () => {
    const s = describeLaunch(params({ preset: PRESET.FairLaunch }), LIMITS);
    expect(s.preset).toBe("FairLaunch");
    expect(s.initialFee).toBe("10%");
    expect(s.finalFee).toBe("0.3%");
    expect(s.decayWindow).toBe("5m");
    expect(s.decayBlocks).toBe(3_000n); // 300s at 0.10s
    expect(s.gated).toBe(true);
    expect(s.doesNotProtectAgainst).not.toBe("");
  });

  it("the same preset is a different block count on a 12s chain", () => {
    const s = describeLaunch(params({ preset: PRESET.FairLaunch }), {
      blockTimeCentis: 1200,
    });
    expect(s.decayWindow).toBe("5m");
    expect(s.decayBlocks).toBe(25n);
  });

  it("NoTax is honest about protecting against nothing", () => {
    const s = describeLaunch(params({ preset: PRESET.NoTax }), LIMITS);
    expect(s.gated).toBe(false);
    expect(s.doesNotProtectAgainst).toContain("anything");
  });
});

describe("assertLaunchParams", () => {
  it("throws with the offending fields named", () => {
    expect(() => assertLaunchParams(params({ preset: PRESET.Custom }), LIMITS)).toThrow(/preset/);
  });

  it("passes a valid launch silently", () => {
    expect(() => assertLaunchParams(params(), LIMITS)).not.toThrow();
  });

  it("does not throw on warnings alone", () => {
    expect(() => assertLaunchParams(params({ maxBuyPerTx: 1n }), LIMITS)).not.toThrow();
  });
});

describe("end to end, the way an integrator would use it", () => {
  it("price -> params -> validate -> tuple", () => {
    const price = sqrtPriceForLaunch({
      launchToken: LAUNCH,
      quoteToken: QUOTE,
      launchDecimals: 18,
      quoteDecimals: 6,
      quotePerLaunchToken: "0.05",
    });
    const p = buildLaunchParams({
      launchToken: LAUNCH,
      quoteToken: QUOTE,
      tickSpacing: 60,
      sqrtPriceX96: price.sqrtPriceX96,
      preset: "FairLaunch",
      seed: SEED,
      startDelaySeconds: 3600,
      launchOperator: QUOTE,
    });
    expect(errorsOf(p)).toHaveLength(0);

    const tuple = launchParamsToTuple(p);
    expect(tuple.preset).toBe(PRESET.FairLaunch);
    expect(tuple.sqrtPriceX96).toBe(price.sqrtPriceX96);
    expect(tuple.seed.launchTokenAmount).toBe(SEED.launchTokenAmount);
    expect(tuple.listing.register).toBe(false);
    expect(Object.keys(tuple)).toHaveLength(14);
  });
});
