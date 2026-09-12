// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { encodeAbiParameters, keccak256, toEventSelector, toHex } from "viem";

import {
  ALL_EVENT_TOPICS,
  EVENT_DESCRIPTORS,
  EVENT_TOPICS,
  LATCH_PROTOCOL_EVENT_ABIS,
  decodeProtocolLog,
  descriptorFor,
  descriptorsForTopic,
  isProtocolEventTopic,
} from "../src/events/index.js";
import {
  ZERO_BALANCE_DELTA,
  addBalanceDeltas,
  balanceDeltaAmount0,
  balanceDeltaAmount1,
  toBalanceDelta,
  unpackBalanceDelta,
} from "../src/types/balanceDelta.js";
import { decodeProtocolFee, encodeProtocolFee, isDynamicLPFee } from "../src/types/fee.js";
import { createCLPoolKey, poolKeyToId } from "../src/types/poolKey.js";
import { NATIVE_CURRENCY, sortCurrencies } from "../src/types/currency.js";
import { encodeCLHookPermissions } from "../src/hooks/bitmap.js";

describe("generated event catalogue", () => {
  it("covers the events emitted by the vault and both pool managers", () => {
    const byContract = (contract: string) =>
      EVENT_DESCRIPTORS.filter((d) => d.contract === contract).map((d) => d.eventName);

    expect(byContract("Vault").sort()).toEqual([
      "AppRegistered",
      "Approval",
      "OperatorSet",
      "OwnershipTransferStarted",
      "OwnershipTransferred",
      "Transfer",
    ]);

    expect(byContract("CLPoolManager").sort()).toEqual([
      "Donate",
      "DynamicLPFeeUpdated",
      "Initialize",
      "ModifyLiquidity",
      "OwnershipTransferred",
      "Paused",
      "ProtocolFeeControllerUpdated",
      "ProtocolFeeUpdated",
      "Swap",
      "Unpaused",
    ]);

    expect(byContract("BinPoolManager").sort()).toEqual([
      "Burn",
      "Donate",
      "DynamicLPFeeUpdated",
      "Initialize",
      "Mint",
      "OwnershipTransferred",
      "Paused",
      "ProtocolFeeControllerUpdated",
      "ProtocolFeeUpdated",
      "SetMaxBinStep",
      "SetMinBinSharesForDonate",
      "Swap",
      "Unpaused",
    ]);

    expect(byContract("ProtocolFees").sort()).toEqual([
      "OwnershipTransferred",
      "Paused",
      "ProtocolFeeControllerUpdated",
      "ProtocolFeeUpdated",
      "Unpaused",
    ]);
  });

  it("declares 29 events across the vault and the two pool managers", () => {
    const observable = EVENT_DESCRIPTORS.filter((d) => d.contract !== "ProtocolFees");
    expect(observable).toHaveLength(29);
  });

  it("derives every topic0 from the event signature", () => {
    for (const descriptor of EVENT_DESCRIPTORS) {
      expect(descriptor.topic0).toBe(toEventSelector(descriptor.signature));
    }
  });

  it("keeps the topic index and the descriptor list consistent", () => {
    for (const descriptor of EVENT_DESCRIPTORS) {
      expect(descriptorsForTopic(descriptor.topic0)).toContainEqual(descriptor);
      expect(isProtocolEventTopic(descriptor.topic0)).toBe(true);
    }
    expect(ALL_EVENT_TOPICS.length).toBe(new Set(EVENT_DESCRIPTORS.map((d) => d.topic0)).size);
  });

  it("distinguishes same-named events with different argument lists", () => {
    const clSwap = descriptorFor("CLPoolManager", "Swap");
    const binSwap = descriptorFor("BinPoolManager", "Swap");
    expect(clSwap?.topic0).not.toBe(binSwap?.topic0);
    expect(clSwap?.signature).toBe(
      "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24,uint16)",
    );
    expect(binSwap?.signature).toBe("Swap(bytes32,address,int128,int128,uint24,uint24,uint16)");
  });

  it("shares a topic0 for events declared identically in several contracts", () => {
    const matches = descriptorsForTopic(EVENT_TOPICS.PROTOCOL_FEES_PROTOCOL_FEE_UPDATED);
    expect(matches.map((m) => m.contract).sort()).toEqual([
      "BinPoolManager",
      "CLPoolManager",
      "ProtocolFees",
    ]);
  });

  it("never exceeds three indexed parameters", () => {
    for (const descriptor of EVENT_DESCRIPTORS) {
      expect(descriptor.indexedCount).toBeLessThanOrEqual(3);
    }
  });

  it("exposes one ABI entry per descriptor", () => {
    for (const [contract, abi] of Object.entries(LATCH_PROTOCOL_EVENT_ABIS)) {
      const expected = EVENT_DESCRIPTORS.filter((d) => d.contract === contract).length;
      expect(abi).toHaveLength(expected);
    }
  });
});

describe("decodeProtocolLog", () => {
  it("decodes a DynamicLPFeeUpdated log", () => {
    const descriptor = descriptorFor("CLPoolManager", "DynamicLPFeeUpdated");
    expect(descriptor).toBeDefined();
    const poolId = keccak256(toHex("pool"));
    const decoded = decodeProtocolLog("CLPoolManager", {
      data: encodeAbiParameters([{ type: "uint24" }], [1234]),
      topics: [descriptor!.topic0, poolId],
    });
    expect(decoded?.eventName).toBe("DynamicLPFeeUpdated");
    expect(decoded?.args).toMatchObject({ id: poolId, dynamicLPFee: 1234 });
  });

  it("returns undefined for a log that belongs to another contract", () => {
    const vaultOnly = descriptorFor("Vault", "AppRegistered");
    const decoded = decodeProtocolLog("CLPoolManager", {
      data: "0x",
      topics: [vaultOnly!.topic0, keccak256(toHex("x"))],
    });
    expect(decoded).toBeUndefined();
  });
});

describe("pool keys", () => {
  it("hashes the six key words in struct order", () => {
    const key = createCLPoolKey({
      currency0: "0x0000000000000000000000000000000000000001",
      currency1: "0x0000000000000000000000000000000000000002",
      hooks: "0x00000000000000000000000000000000000000aa",
      poolManager: "0x00000000000000000000000000000000000000bb",
      fee: 3000,
      tickSpacing: 60,
      hooksRegistrationBitmap: encodeCLHookPermissions({ beforeSwap: true }),
    });

    const expected = keccak256(
      encodeAbiParameters(
        [
          { type: "address" },
          { type: "address" },
          { type: "address" },
          { type: "address" },
          { type: "uint24" },
          { type: "bytes32" },
        ],
        [key.currency0, key.currency1, key.hooks, key.poolManager, key.fee, key.parameters],
      ),
    );
    expect(poolKeyToId(key)).toBe(expected);
  });

  it("reproduces a pool id computed on-chain", () => {
    // Cross-checked against `keccak256(poolKey, 0xc0)` executed by the EVM for
    // the same six words; see README, "Verifying the encoding".
    const key = createCLPoolKey({
      currency0: "0x0000000000000000000000000000000000000000",
      currency1: "0x00000000000000000000000000000000000000c0",
      hooks: "0x00000000000000000000000000000000000000aa",
      poolManager: "0x00000000000000000000000000000000000000bb",
      fee: 0x800000,
      tickSpacing: 60,
      hooksRegistrationBitmap: encodeCLHookPermissions({
        beforeSwap: true,
        afterSwap: true,
        beforeSwapReturnsDelta: true,
      }),
    });
    expect(key.parameters).toBe(
      "0x00000000000000000000000000000000000000000000000000000000003c04c0",
    );
    expect(poolKeyToId(key)).toBe(
      "0x166763ead471ee84cc669f8c75cccb852b360c93dd1aaf0bd048c7622fa9e350",
    );
  });

  it("changes the id when a single hook bit changes", () => {
    const base = {
      currency0: "0x0000000000000000000000000000000000000001",
      currency1: "0x0000000000000000000000000000000000000002",
      hooks: "0x00000000000000000000000000000000000000aa",
      poolManager: "0x00000000000000000000000000000000000000bb",
      fee: 3000,
      tickSpacing: 60,
    } as const;
    const a = createCLPoolKey({ ...base, hooksRegistrationBitmap: 0 });
    const b = createCLPoolKey({
      ...base,
      hooksRegistrationBitmap: encodeCLHookPermissions({ afterInitialize: true }),
    });
    expect(poolKeyToId(a)).not.toBe(poolKeyToId(b));
  });

  it("rejects unsorted currencies", () => {
    expect(() =>
      createCLPoolKey({
        currency0: "0x0000000000000000000000000000000000000002",
        currency1: "0x0000000000000000000000000000000000000001",
        hooks: "0x0000000000000000000000000000000000000000",
        poolManager: "0x00000000000000000000000000000000000000bb",
        fee: 3000,
        tickSpacing: 60,
      }),
    ).toThrow(/sorted ascending/);
  });

  it("sorts the native asset first", () => {
    const [c0] = sortCurrencies("0x00000000000000000000000000000000000000ff", NATIVE_CURRENCY);
    expect(c0).toBe(NATIVE_CURRENCY);
  });
});

describe("balance deltas", () => {
  it("packs and unpacks signed amounts", () => {
    const delta = toBalanceDelta(-100n, 250n);
    expect(balanceDeltaAmount0(delta)).toBe(-100n);
    expect(balanceDeltaAmount1(delta)).toBe(250n);
    expect(unpackBalanceDelta(delta)).toEqual({ amount0: -100n, amount1: 250n });
  });

  it("handles the int128 extremes", () => {
    const min = -(2n ** 127n);
    const max = 2n ** 127n - 1n;
    const delta = toBalanceDelta(min, max);
    expect(balanceDeltaAmount0(delta)).toBe(min);
    expect(balanceDeltaAmount1(delta)).toBe(max);
    expect(() => toBalanceDelta(max + 1n, 0n)).toThrow(/int128/);
  });

  it("adds component-wise", () => {
    expect(addBalanceDeltas(toBalanceDelta(1n, -2n), toBalanceDelta(3n, 5n))).toBe(
      toBalanceDelta(4n, 3n),
    );
    expect(addBalanceDeltas(ZERO_BALANCE_DELTA, ZERO_BALANCE_DELTA)).toBe(0n);
  });
});

describe("fees", () => {
  it("recognises the dynamic-fee marker", () => {
    expect(isDynamicLPFee(0x800000)).toBe(true);
    expect(isDynamicLPFee(3000)).toBe(false);
  });

  it("packs directional protocol fees into a uint24", () => {
    const packed = encodeProtocolFee({ zeroForOne: 1000, oneForZero: 2000 });
    expect(decodeProtocolFee(packed)).toEqual({ zeroForOne: 1000, oneForZero: 2000 });
    expect(() => encodeProtocolFee({ zeroForOne: 4001, oneForZero: 0 })).toThrow(/protocol fee/);
  });
});
