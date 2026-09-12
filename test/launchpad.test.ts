// SPDX-License-Identifier: MIT
import { toFunctionSelector, type AbiFunction } from "viem";
import { describe, expect, it } from "vitest";

import {
  BIN_LAUNCH_GUARD_HOOK_ABI,
  LAUNCHPAD_KIT_ABI,
  LAUNCH_GUARD_HOOK_ABI,
  LaunchpadAbis,
} from "../src/launchpad/index.js";

type Fragment = { readonly type: string; readonly name?: string };

const names = (abi: readonly Fragment[], type: string): string[] =>
  abi.filter((item) => item.type === type).map((item) => item.name ?? "");

describe("generated launchpad ABI", () => {
  it("keeps the kit calls the SDK encodes", () => {
    const functions = names(LAUNCHPAD_KIT_ABI, "function");
    for (const fn of [
      "createLaunch",
      "reconfigureLaunch",
      "computePoolKey",
      "previewSchedule",
      "getLaunchRecord",
      "listHook",
      "registry",
      "hookBitmap",
      "EXPECTED_HOOK_BITMAP",
    ]) {
      expect(functions).toContain(fn);
    }
  });

  it("keeps every kit error, because they are the diagnostic surface", () => {
    const errors = names(LAUNCHPAD_KIT_ABI, "error");
    expect(errors).toContain("UnexpectedHookBitmap");
    expect(errors).toContain("UnknownLaunch");
    expect(errors).toContain("RegistryNotConfigured");
    expect(errors.length).toBeGreaterThan(10);
  });

  it("curates rather than dumping: no constructor, receive or fallback", () => {
    for (const abi of [LAUNCHPAD_KIT_ABI, LAUNCH_GUARD_HOOK_ABI, BIN_LAUNCH_GUARD_HOOK_ABI]) {
      const types = new Set((abi as readonly Fragment[]).map((item) => item.type));
      expect([...types].sort()).toEqual(["error", "event", "function"]);
    }
  });

  it("keeps the launch-guard hook views a launch UI polls", () => {
    for (const abi of [LAUNCH_GUARD_HOOK_ABI, BIN_LAUNCH_GUARD_HOOK_ABI]) {
      const functions = names(abi, "function");
      expect(functions).toContain("getLaunch");
      expect(functions).toContain("currentFee");
      expect(functions).toContain("feeAt");
      expect(functions).toContain("getHooksRegistrationBitmap");
      // Raw pool-manager callbacks are not part of the curated slice: nobody
      // calls beforeSwap from off chain.
      expect(functions).not.toContain("beforeSwap");
    }
  });

  it("exposes the same schedule surface for both pool flavours", () => {
    expect(names(LAUNCH_GUARD_HOOK_ABI, "function").sort()).toEqual(
      names(BIN_LAUNCH_GUARD_HOOK_ABI, "function").sort(),
    );
    expect(names(LAUNCH_GUARD_HOOK_ABI, "event").sort()).toEqual(
      names(BIN_LAUNCH_GUARD_HOOK_ABI, "event").sort(),
    );
  });

  it("emits fragments viem can turn into selectors", () => {
    const createLaunch = (LAUNCHPAD_KIT_ABI as readonly Fragment[]).find(
      (item) => item.type === "function" && item.name === "createLaunch",
    );
    expect(createLaunch).toBeDefined();
    expect(toFunctionSelector(createLaunch as AbiFunction)).toMatch(/^0x[0-9a-f]{8}$/);
  });

  it("is deterministically ordered", () => {
    for (const abi of [LAUNCHPAD_KIT_ABI, LAUNCH_GUARD_HOOK_ABI, BIN_LAUNCH_GUARD_HOOK_ABI]) {
      const keys = (abi as readonly Fragment[]).map((item) => `${item.type} ${item.name ?? ""}`);
      expect([...keys].sort()).toEqual(keys);
    }
  });

  it("re-exports the three ABIs under short names", () => {
    expect(LaunchpadAbis.LaunchpadKit).toBe(LAUNCHPAD_KIT_ABI);
    expect(LaunchpadAbis.LaunchGuardHook).toBe(LAUNCH_GUARD_HOOK_ABI);
    expect(LaunchpadAbis.BinLaunchGuardHook).toBe(BIN_LAUNCH_GUARD_HOOK_ABI);
  });
});
