// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";

import {
  BIN_HOOK_FLAGS,
  CL_HOOK_FLAGS,
  HOOK_BITMAP_MASK,
  assertValidHookConfig,
  assertValidHookRegistrationBitmap,
  bitmapFromOffsets,
  decodeBinHookPermissions,
  decodeCLHookPermissions,
  decodeHookPermissions,
  enabledHookNames,
  encodeBinHookPermissions,
  encodeCLHookPermissions,
  encodeHookPermissions,
  formatHookPermissions,
  hasHookPermission,
  parametersWithHookPermissions,
  setHookPermission,
  validateHookConfig,
  validateHookRegistrationBitmap,
} from "../src/hooks/bitmap.js";
import {
  DYNAMIC_FEE_FLAG,
} from "../src/types/fee.js";
import {
  EMPTY_PARAMETERS,
  encodeBinPoolParameters,
  encodeCLPoolParameters,
  getBinStep,
  getHooksRegistrationBitmap,
  getTickSpacing,
} from "../src/types/parameters.js";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const HOOK = "0x00000000000000000000000000000000000000aa" as const;

describe("hook flag offsets", () => {
  it("matches the offsets declared by the concentrated-liquidity hook interface", () => {
    expect(CL_HOOK_FLAGS).toEqual({
      beforeInitialize: 0,
      afterInitialize: 1,
      beforeAddLiquidity: 2,
      afterAddLiquidity: 3,
      beforeRemoveLiquidity: 4,
      afterRemoveLiquidity: 5,
      beforeSwap: 6,
      afterSwap: 7,
      beforeDonate: 8,
      afterDonate: 9,
      beforeSwapReturnsDelta: 10,
      afterSwapReturnsDelta: 11,
      afterAddLiquidityReturnsDelta: 12,
      afterRemoveLiquidityReturnsDelta: 13,
    });
  });

  it("matches the offsets declared by the liquidity-book hook interface", () => {
    expect(BIN_HOOK_FLAGS).toEqual({
      beforeInitialize: 0,
      afterInitialize: 1,
      beforeMint: 2,
      afterMint: 3,
      beforeBurn: 4,
      afterBurn: 5,
      beforeSwap: 6,
      afterSwap: 7,
      beforeDonate: 8,
      afterDonate: 9,
      beforeSwapReturnsDelta: 10,
      afterSwapReturnsDelta: 11,
      afterMintReturnsDelta: 12,
      afterBurnReturnsDelta: 13,
    });
  });

  it("uses identical offsets for both pool types", () => {
    expect(Object.values(CL_HOOK_FLAGS).sort((a, b) => a - b)).toEqual(
      Object.values(BIN_HOOK_FLAGS).sort((a, b) => a - b),
    );
  });
});

describe("encodeHookPermissions", () => {
  it("returns zero for a hook that registers nothing", () => {
    expect(encodeCLHookPermissions({})).toBe(0);
    expect(encodeBinHookPermissions({})).toBe(0);
  });

  it("sets one bit per enabled callback", () => {
    expect(encodeCLHookPermissions({ beforeInitialize: true })).toBe(0b1);
    expect(encodeCLHookPermissions({ afterInitialize: true })).toBe(0b10);
    expect(encodeCLHookPermissions({ beforeSwap: true })).toBe(1 << 6);
    expect(encodeCLHookPermissions({ afterRemoveLiquidityReturnsDelta: true })).toBe(1 << 13);
  });

  it("ors the bits of a combined permission set", () => {
    // beforeSwap (6) + afterSwap (7) + beforeSwapReturnsDelta (10)
    const bitmap = encodeCLHookPermissions({
      beforeSwap: true,
      afterSwap: true,
      beforeSwapReturnsDelta: true,
    });
    expect(bitmap).toBe(0b0000_0100_1100_0000);
    expect(bitmap).toBe(0x04c0);
  });

  it("treats false and omitted identically", () => {
    expect(encodeCLHookPermissions({ beforeSwap: true, afterSwap: false })).toBe(
      encodeCLHookPermissions({ beforeSwap: true }),
    );
  });

  it("distinguishes the two pool types at the shared offsets", () => {
    expect(encodeCLHookPermissions({ beforeAddLiquidity: true })).toBe(
      encodeBinHookPermissions({ beforeMint: true }),
    );
  });

  it("rejects an unknown callback name", () => {
    expect(() =>
      // @ts-expect-error - deliberately invalid flag name
      encodeCLHookPermissions({ beforeFlashLoan: true }),
    ).toThrow(/unknown hook permission/);
  });

  it("never sets a bit outside the assigned range", () => {
    const all = encodeCLHookPermissions(
      Object.fromEntries(Object.keys(CL_HOOK_FLAGS).map((k) => [k, true])),
    );
    expect(all).toBe(HOOK_BITMAP_MASK);
    expect(all & ~HOOK_BITMAP_MASK).toBe(0);
  });
});

describe("decodeHookPermissions", () => {
  it("round-trips every single-flag bitmap for both pool types", () => {
    for (const [name, offset] of Object.entries(CL_HOOK_FLAGS)) {
      const bitmap = 1 << offset;
      const decoded = decodeCLHookPermissions(bitmap);
      expect(decoded[name as keyof typeof CL_HOOK_FLAGS]).toBe(true);
      expect(Object.values(decoded).filter(Boolean)).toHaveLength(1);
    }
    for (const [name, offset] of Object.entries(BIN_HOOK_FLAGS)) {
      const decoded = decodeBinHookPermissions(1 << offset);
      expect(decoded[name as keyof typeof BIN_HOOK_FLAGS]).toBe(true);
    }
  });

  it("round-trips every bitmap in the assigned range", () => {
    for (let bitmap = 0; bitmap <= HOOK_BITMAP_MASK; bitmap++) {
      expect(encodeCLHookPermissions(decodeCLHookPermissions(bitmap))).toBe(bitmap);
    }
  });

  it("reports every flag, including the disabled ones", () => {
    const decoded = decodeCLHookPermissions(0);
    expect(Object.keys(decoded).sort()).toEqual(Object.keys(CL_HOOK_FLAGS).sort());
    expect(Object.values(decoded).every((v) => v === false)).toBe(true);
  });

  it("rejects a bitmap wider than uint16", () => {
    expect(() => decodeCLHookPermissions(0x10000)).toThrow(/must be an integer in/);
    expect(() => decodeCLHookPermissions(-1)).toThrow(/must be an integer in/);
  });

  it("dispatches on pool type", () => {
    const bitmap = encodeHookPermissions("BIN", { afterBurn: true });
    expect(decodeHookPermissions("BIN", bitmap).afterBurn).toBe(true);
    expect(bitmap).toBe(1 << 5);
  });
});

describe("bit helpers", () => {
  it("reads and writes individual bits", () => {
    let bitmap = 0;
    bitmap = setHookPermission(bitmap, CL_HOOK_FLAGS.beforeSwap, true);
    expect(hasHookPermission(bitmap, CL_HOOK_FLAGS.beforeSwap)).toBe(true);
    expect(hasHookPermission(bitmap, CL_HOOK_FLAGS.afterSwap)).toBe(false);
    bitmap = setHookPermission(bitmap, CL_HOOK_FLAGS.beforeSwap, false);
    expect(bitmap).toBe(0);
  });

  it("builds a bitmap from raw offsets", () => {
    expect(bitmapFromOffsets([0, 1])).toBe(0b11);
    expect(() => bitmapFromOffsets([16])).toThrow(/must be an integer in/);
  });

  it("lists enabled callbacks in bit order", () => {
    const bitmap = encodeCLHookPermissions({ afterSwap: true, beforeInitialize: true });
    expect(enabledHookNames("CL", bitmap)).toEqual(["beforeInitialize", "afterSwap"]);
  });

  it("formats a readable summary", () => {
    expect(formatHookPermissions("CL", 0)).toBe("0x0000 (no callbacks)");
    expect(formatHookPermissions("CL", encodeCLHookPermissions({ beforeSwap: true }))).toBe(
      "0x0040 (beforeSwap)",
    );
  });
});

describe("validateHookRegistrationBitmap", () => {
  it("accepts a plain before/after swap hook", () => {
    const bitmap = encodeCLHookPermissions({ beforeSwap: true, afterSwap: true });
    expect(validateHookRegistrationBitmap("CL", bitmap).valid).toBe(true);
  });

  it("rejects beforeSwapReturnsDelta without beforeSwap", () => {
    const bitmap = encodeCLHookPermissions({ beforeSwapReturnsDelta: true });
    const result = validateHookRegistrationBitmap("CL", bitmap);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("MISSING_DEPENDENCY");
    expect(result.issues[0]?.message).toContain("beforeSwap");
  });

  it("rejects afterSwapReturnsDelta without afterSwap", () => {
    const bitmap = encodeCLHookPermissions({ afterSwapReturnsDelta: true });
    expect(validateHookRegistrationBitmap("CL", bitmap).valid).toBe(false);
  });

  it("rejects afterAddLiquidityReturnsDelta without afterAddLiquidity", () => {
    const bitmap = encodeCLHookPermissions({ afterAddLiquidityReturnsDelta: true });
    expect(validateHookRegistrationBitmap("CL", bitmap).valid).toBe(false);
    expect(
      validateHookRegistrationBitmap(
        "CL",
        encodeCLHookPermissions({
          afterAddLiquidity: true,
          afterAddLiquidityReturnsDelta: true,
        }),
      ).valid,
    ).toBe(true);
  });

  it("rejects afterRemoveLiquidityReturnsDelta without afterRemoveLiquidity", () => {
    expect(
      validateHookRegistrationBitmap(
        "CL",
        encodeCLHookPermissions({ afterRemoveLiquidityReturnsDelta: true }),
      ).valid,
    ).toBe(false);
  });

  it("applies the bin equivalents at the same offsets", () => {
    expect(
      validateHookRegistrationBitmap("BIN", encodeBinHookPermissions({ afterMintReturnsDelta: true }))
        .valid,
    ).toBe(false);
    expect(
      validateHookRegistrationBitmap(
        "BIN",
        encodeBinHookPermissions({ afterMint: true, afterMintReturnsDelta: true }),
      ).valid,
    ).toBe(true);
    expect(
      validateHookRegistrationBitmap("BIN", encodeBinHookPermissions({ afterBurnReturnsDelta: true }))
        .valid,
    ).toBe(false);
  });

  it("reports every violated dependency at once", () => {
    const bitmap = bitmapFromOffsets([10, 11, 12, 13]);
    const result = validateHookRegistrationBitmap("CL", bitmap);
    expect(result.issues.filter((i) => i.code === "MISSING_DEPENDENCY")).toHaveLength(4);
  });

  it("rejects bits above the assigned range", () => {
    const result = validateHookRegistrationBitmap("CL", 1 << 14);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("UNASSIGNED_BIT_SET");
  });

  it("rejects a value outside uint16", () => {
    expect(validateHookRegistrationBitmap("CL", 0x1_0000).issues[0]?.code).toBe(
      "BITMAP_OUT_OF_RANGE",
    );
  });

  it("throws from the assert variant", () => {
    expect(() =>
      assertValidHookRegistrationBitmap("CL", encodeCLHookPermissions({ afterSwapReturnsDelta: true })),
    ).toThrow(/invalid hook registration bitmap/);
    expect(() => assertValidHookRegistrationBitmap("CL", 0)).not.toThrow();
  });
});

describe("validateHookConfig", () => {
  it("accepts a hookless pool with an empty bitmap and a static fee", () => {
    const result = validateHookConfig({
      poolType: "CL",
      hooks: ZERO,
      fee: 3000,
      parameters: encodeCLPoolParameters(0, 60),
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a hookless pool that registers callbacks", () => {
    const result = validateHookConfig({
      poolType: "CL",
      hooks: ZERO,
      fee: 3000,
      parameters: encodeCLPoolParameters(encodeCLHookPermissions({ beforeSwap: true }), 60),
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain("HOOKLESS_POOL_WITH_BITMAP");
  });

  it("rejects a hookless pool that asks for a dynamic fee", () => {
    const result = validateHookConfig({
      poolType: "CL",
      hooks: ZERO,
      fee: DYNAMIC_FEE_FLAG,
      parameters: encodeCLPoolParameters(0, 60),
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain("HOOKLESS_POOL_WITH_DYNAMIC_FEE");
  });

  it("accepts a hooked pool whose on-chain bitmap agrees with the pool key", () => {
    const bitmap = encodeCLHookPermissions({ beforeSwap: true, beforeSwapReturnsDelta: true });
    const result = validateHookConfig({
      poolType: "CL",
      hooks: HOOK,
      fee: DYNAMIC_FEE_FLAG,
      parameters: encodeCLPoolParameters(bitmap, 60),
      onChainBitmap: bitmap,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a hooked pool whose on-chain bitmap disagrees", () => {
    const result = validateHookConfig({
      poolType: "CL",
      hooks: HOOK,
      fee: 3000,
      parameters: encodeCLPoolParameters(encodeCLHookPermissions({ beforeSwap: true }), 60),
      onChainBitmap: encodeCLHookPermissions({ afterSwap: true }),
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain("BITMAP_MISMATCH");
  });

  it("skips the on-chain comparison when the hook's bitmap is unknown", () => {
    const result = validateHookConfig({
      poolType: "CL",
      hooks: HOOK,
      fee: 3000,
      parameters: encodeCLPoolParameters(encodeCLHookPermissions({ beforeSwap: true }), 60),
    });
    expect(result.valid).toBe(true);
  });

  it("throws from the assert variant", () => {
    expect(() =>
      assertValidHookConfig({
        poolType: "BIN",
        hooks: ZERO,
        fee: DYNAMIC_FEE_FLAG,
        parameters: EMPTY_PARAMETERS,
      }),
    ).toThrow(/invalid hook configuration/);
  });
});

describe("bitmap placement inside pool parameters", () => {
  it("occupies only the low 16 bits", () => {
    const bitmap = encodeCLHookPermissions({ beforeSwap: true, afterSwap: true });
    const parameters = encodeCLPoolParameters(bitmap, 60);
    expect(getHooksRegistrationBitmap(parameters)).toBe(bitmap);
    expect(getTickSpacing(parameters)).toBe(60);
    expect(BigInt(parameters) & 0xffffn).toBe(BigInt(bitmap));
  });

  it("leaves the tick spacing untouched when only the bitmap changes", () => {
    const base = encodeCLPoolParameters(0, 10);
    const updated = parametersWithHookPermissions("CL", { afterInitialize: true }, base);
    expect(getTickSpacing(updated)).toBe(10);
    expect(getHooksRegistrationBitmap(updated)).toBe(1 << 1);
  });

  it("survives a negative tick spacing", () => {
    const parameters = encodeCLPoolParameters(0x3fff, -60);
    expect(getTickSpacing(parameters)).toBe(-60);
    expect(getHooksRegistrationBitmap(parameters)).toBe(0x3fff);
  });

  it("packs the bin step above the bitmap", () => {
    const bitmap = encodeBinHookPermissions({ beforeMint: true });
    const parameters = encodeBinPoolParameters(bitmap, 25);
    expect(getBinStep(parameters)).toBe(25);
    expect(getHooksRegistrationBitmap(parameters)).toBe(bitmap);
  });

  it("refuses to build parameters from an invalid permission set", () => {
    expect(() =>
      parametersWithHookPermissions("CL", { afterSwapReturnsDelta: true }),
    ).toThrow(/invalid hook registration bitmap/);
  });
});
