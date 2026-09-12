// SPDX-License-Identifier: MIT
/**
 * `sqrtPriceX96` is permanent at `initialize`, so these tests are about
 * EXACTNESS, not about the functions merely running.
 *
 * Three properties carry the weight:
 *   - algebraic identities that must hold to the last bit (1:1 is exactly 2^96);
 *   - the decimals shift, which is the 10^12 bug this repo has already hit twice;
 *   - address sorting, which silently inverts a price nobody checked.
 *
 * The TickMath bounds are additionally checked against the Solidity itself,
 * because a bound copied by hand is a bound that can drift.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  InvalidPriceError,
  MAX_SQRT_RATIO,
  MIN_SQRT_RATIO,
  PriceOutOfRangeError,
  Q96,
  bigintSqrt,
  parseDecimal,
  priceFromSqrtPriceX96,
  sqrtPriceForLaunch,
  sqrtPriceX96FromPrice,
  sqrtPriceX96FromRatio,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
/* Monorepo-only. The public mirror ships `test/` but not the Solidity, so the
   parity blocks below skip there rather than fail. A skipped parity test in
   the mirror is correct; a failing one would just teach people to ignore it. */
const TICK_MATH = join(HERE, "..", "..", "core", "src", "pool-cl", "libraries", "TickMath.sol");

const LOWER = "0x1111111111111111111111111111111111111111" as const;
const HIGHER = "0x2222222222222222222222222222222222222222" as const;

describe("bigintSqrt", () => {
  it("is the exact floor of the square root", () => {
    for (const n of [0n, 1n, 2n, 3n, 4n, 8n, 9n, 10n, 99n, 100n, 101n]) {
      const r = bigintSqrt(n);
      expect(r * r <= n).toBe(true);
      expect((r + 1n) * (r + 1n) > n).toBe(true);
    }
  });

  it("holds at sizes a double cannot represent", () => {
    // 2^200 has 61 significant digits; a double carries ~15.
    const n = 1n << 200n;
    expect(bigintSqrt(n)).toBe(1n << 100n);
    // One below a perfect square must floor to one below the root.
    expect(bigintSqrt(n - 1n)).toBe((1n << 100n) - 1n);
  });

  it("refuses a negative radicand", () => {
    expect(() => bigintSqrt(-1n)).toThrow(RangeError);
  });
});

describe("parseDecimal", () => {
  it("is exact — no float anywhere, and always in lowest terms", () => {
    expect(parseDecimal("0.1")).toEqual({ numerator: 1n, denominator: 10n });
    // The canonical float failure: 0.1 + 0.2 !== 0.3. As rationals it is exact.
    expect(parseDecimal("0.3")).toEqual({ numerator: 3n, denominator: 10n });
    // Reduced: gcd(12345678, 10000) === 2. Canonical form is part of the contract.
    expect(parseDecimal("1234.5678")).toEqual({ numerator: 6172839n, denominator: 5000n });
  });

  it("handles scientific notation in both directions", () => {
    expect(parseDecimal("2.5e6")).toEqual({ numerator: 2500000n, denominator: 1n });
    expect(parseDecimal("4.2e-3")).toEqual({ numerator: 21n, denominator: 5000n });
  });

  it("equal prices written differently produce the identical rational", () => {
    expect(parseDecimal("2.5e6")).toEqual(parseDecimal("2500000"));
    expect(parseDecimal("0.50")).toEqual(parseDecimal("0.5"));
    expect(parseDecimal("1e0")).toEqual(parseDecimal("1"));
  });

  it("rejects anything that is not an exact decimal", () => {
    for (const bad of ["", "abc", "-1", "1,5", "0x10", "1.2.3", "Infinity", " 1 2 "]) {
      expect(() => parseDecimal(bad)).toThrow(InvalidPriceError);
    }
  });

  it("rejects zero, which is not a price", () => {
    expect(() => parseDecimal("0")).toThrow(InvalidPriceError);
    expect(() => parseDecimal("0.000")).toThrow(InvalidPriceError);
  });
});

describe("sqrtPriceX96FromRatio", () => {
  it("a 1:1 ratio is exactly 2^96", () => {
    expect(sqrtPriceX96FromRatio({ numerator: 1n, denominator: 1n })).toBe(Q96);
  });

  it("a 4:1 ratio is exactly 2 * 2^96", () => {
    expect(sqrtPriceX96FromRatio({ numerator: 4n, denominator: 1n })).toBe(2n * Q96);
  });

  it("a 1:4 ratio is exactly 2^96 / 2", () => {
    expect(sqrtPriceX96FromRatio({ numerator: 1n, denominator: 4n })).toBe(Q96 / 2n);
  });
});

describe("sqrtPriceX96FromPrice — the decimals shift", () => {
  it("matched decimals leave the price alone", () => {
    expect(sqrtPriceX96FromPrice({ price: "1", decimals0: 18, decimals1: 18 })).toBe(Q96);
  });

  it("A PRICE OF 1 IS NOT 2^96 WHEN DECIMALS DIFFER", () => {
    /* THE BUG THIS FILE EXISTS FOR. currency0 has 6 decimals, currency1 has 18.
       One whole currency0 buys one whole currency1, but in RAW units that is
       1e18 per 1e6 — a ratio of 1e12, whose square root is 1e6. Anyone who
       assumes 18/18 here is off by exactly a factor of a million in sqrt terms,
       and 10^12 in price terms. */
    const got = sqrtPriceX96FromPrice({ price: "1", decimals0: 6, decimals1: 18 });
    expect(got).toBe(1_000_000n * Q96);
    expect(got).not.toBe(Q96);
  });

  it("the shift runs the other way too", () => {
    const got = sqrtPriceX96FromPrice({ price: "1", decimals0: 18, decimals1: 6 });
    expect(got).toBe(Q96 / 1_000_000n);
  });

  it("USDG(6)/WETH(18) at 1 WETH = 1500 USDG round-trips to the same price", () => {
    // WETH sorts second here, so the pool price is USDG-per-WETH inverted:
    // currency0 = USDG (6dp), currency1 = WETH (18dp), price = 1/1500 WETH per USDG.
    const sqrtPriceX96 = sqrtPriceX96FromPrice({
      price: "0.000666666666666666",
      decimals0: 6,
      decimals1: 18,
    });
    const back = priceFromSqrtPriceX96(sqrtPriceX96, 6, 18, 18);
    expect(Number(back)).toBeCloseTo(0.000666666666666666, 15);
  });

  it("refuses a price no pool can hold rather than clamping it", () => {
    expect(() => sqrtPriceX96FromPrice({ price: "1e60", decimals0: 18, decimals1: 18 })).toThrow(
      PriceOutOfRangeError,
    );
    expect(() => sqrtPriceX96FromPrice({ price: "1e-60", decimals0: 18, decimals1: 18 })).toThrow(
      PriceOutOfRangeError,
    );
  });

  it("refuses decimals that were never read off a contract", () => {
    expect(() => sqrtPriceX96FromPrice({ price: "1", decimals0: -1, decimals1: 18 })).toThrow(
      InvalidPriceError,
    );
    expect(() => sqrtPriceX96FromPrice({ price: "1", decimals0: 18, decimals1: 1.5 })).toThrow(
      InvalidPriceError,
    );
  });
});

describe("sqrtPriceForLaunch — sorting", () => {
  it("when the launch token sorts FIRST the price is used as given", () => {
    const r = sqrtPriceForLaunch({
      launchToken: LOWER,
      quoteToken: HIGHER,
      launchDecimals: 18,
      quoteDecimals: 18,
      quotePerLaunchToken: "4",
    });
    expect(r.launchTokenIsCurrency0).toBe(true);
    expect(r.currency0).toBe(LOWER);
    expect(r.currency1).toBe(HIGHER);
    expect(r.sqrtPriceX96).toBe(2n * Q96); // sqrt(4)
    expect(r.poolPrice).toBe("4");
  });

  it("when the launch token sorts SECOND the pool price is the RECIPROCAL", () => {
    /* The silent inversion. Same economic intent — one launch token costs four
       quote — but the pool stores currency1-per-currency0, and currency0 is now
       the quote token. A caller who ignores sorting opens at 4 instead of 0.25. */
    const r = sqrtPriceForLaunch({
      launchToken: HIGHER,
      quoteToken: LOWER,
      launchDecimals: 18,
      quoteDecimals: 18,
      quotePerLaunchToken: "4",
    });
    expect(r.launchTokenIsCurrency0).toBe(false);
    expect(r.currency0).toBe(LOWER);
    expect(r.currency1).toBe(HIGHER);
    expect(r.sqrtPriceX96).toBe(Q96 / 2n); // sqrt(1/4)
    expect(r.poolPrice).toBe("0.25");
  });

  it("the reciprocal is taken on the exact rational, not by dividing", () => {
    // 1/3 is not representable in decimal; flipping the rational keeps it exact.
    const r = sqrtPriceForLaunch({
      launchToken: HIGHER,
      quoteToken: LOWER,
      launchDecimals: 18,
      quoteDecimals: 18,
      quotePerLaunchToken: "3",
    });
    // sqrt(1/3) * 2^96, computed exactly and floored.
    expect(r.sqrtPriceX96).toBe(bigintSqrt(((1n << 192n) * 1n) / 3n));
  });

  it("carries decimals through the inversion", () => {
    const r = sqrtPriceForLaunch({
      launchToken: HIGHER, // 18dp launch token, sorts second
      quoteToken: LOWER, // 6dp quote, sorts first
      launchDecimals: 18,
      quoteDecimals: 6,
      quotePerLaunchToken: "1",
    });
    // currency0 = quote (6dp), currency1 = launch (18dp), price 1 -> 1e12 raw.
    expect(r.sqrtPriceX96).toBe(1_000_000n * Q96);
  });

  it("case in an address cannot change the sort order", () => {
    const mixed = "0x1111111111111111111111111111111111111111".toUpperCase().replace("0X", "0x");
    const r = sqrtPriceForLaunch({
      launchToken: mixed as `0x${string}`,
      quoteToken: HIGHER,
      launchDecimals: 18,
      quoteDecimals: 18,
      quotePerLaunchToken: "1",
    });
    expect(r.launchTokenIsCurrency0).toBe(true);
  });

  it("refuses a pair of the same token", () => {
    expect(() =>
      sqrtPriceForLaunch({
        launchToken: LOWER,
        quoteToken: LOWER,
        launchDecimals: 18,
        quoteDecimals: 18,
        quotePerLaunchToken: "1",
      }),
    ).toThrow(InvalidPriceError);
  });
});

describe("priceFromSqrtPriceX96", () => {
  it("truncates rather than rounding up, so a shown price is never too high", () => {
    expect(priceFromSqrtPriceX96(Q96, 18, 18)).toBe("1");
    expect(priceFromSqrtPriceX96(2n * Q96, 18, 18)).toBe("4");
    expect(priceFromSqrtPriceX96(Q96 / 2n, 18, 18)).toBe("0.25");
  });

  it("honours the requested precision", () => {
    expect(priceFromSqrtPriceX96(2n * Q96, 18, 18, 0)).toBe("4");
  });
});

describe.skipIf(!existsSync(TICK_MATH))("TickMath bounds match the Solidity", () => {
  it("MIN_SQRT_RATIO and MAX_SQRT_RATIO are transcribed correctly", () => {
    const src = readFileSync(TICK_MATH, "utf8");
    const min = /uint160 internal constant MIN_SQRT_RATIO = (\d+);/.exec(src);
    const max = /uint160 internal constant MAX_SQRT_RATIO = (\d+);/.exec(src);
    expect(min?.[1]).toBeDefined();
    expect(max?.[1]).toBeDefined();
    expect(BigInt(min?.[1] as string)).toBe(MIN_SQRT_RATIO);
    expect(BigInt(max?.[1] as string)).toBe(MAX_SQRT_RATIO);
  });
});
