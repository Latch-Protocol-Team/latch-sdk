// SPDX-License-Identifier: MIT
/* ============================================================================
   RevShareHook.getPendingConfig — THREE shapes on chain, chosen by address.

     block-no-expiry        7 words  (uint48 effectiveBlock, ConfigParams{6})
                            Robinhood 0x23CE…E446 (hosts LTT1/LTT2), Sepolia 0x1C86…BE28
     block-with-expiry      8 words  (uint48 effectiveBlock, uint48 expiryBlock, ConfigParams{6})
                            Robinhood 0xfC00…2aD2
     timestamp-with-expiry  8 words  (uint40 effectiveAt, uint40 expiresAt, ConfigParams{6})
                            the current source (Option B, 2026-09-13)

   WHY LENGTH IS NO LONGER ENOUGH. Consumers used to decode by the number of
   words that came back: 7 or 8. The timestamp hook returns 8 words too, laid out
   exactly like `0xfC00`. Read one through the other and nothing throws — a block
   number around 26 million becomes a date in 1970, or a unix time around 1.79
   billion becomes a block decades away. A proposal that is armed right now would
   render as long expired, or the reverse.

   So the SHAPE comes from the address book (`revShareHookRecord`) or from the
   hook's own `CLOCK_MODE()` (which only the timestamp build implements), and the
   word count is then a CHECK against that shape, never the thing that decides.
   ============================================================================ */

import { decodeAbiParameters, encodeFunctionData, type Address, type Hex } from "viem";

import type { DurationClock, RevSharePendingShape } from "../deployments/index.js";
import { windowPhase, type DurationNow } from "../chains/clock.js";

/** `ConfigParams`, decoded. */
export interface RevSharePendingParams {
  readonly feePips: number;
  readonly lpDonateBps: number;
  readonly beneficiaryBps: number;
  readonly distributorBps: number;
  readonly distributor: Address;
  readonly enabled: boolean;
}

export interface DecodedRevSharePendingConfig {
  readonly shape: RevSharePendingShape;
  /** The unit `effective` and `expiry` are in. Compare them on THIS clock only. */
  readonly durationClock: DurationClock;
  /** `effectiveBlock` or `effectiveAt`. `0n` means no proposal outstanding. */
  readonly effective: bigint;
  /**
   * `expiryBlock` or `expiresAt` — the LAST applicable point, inclusive. `null`
   * on `block-no-expiry`, which has no expiry at all: never substitute a number,
   * because a made-up expiry that has passed renders an armed proposal as dead.
   */
  readonly expiry: bigint | null;
  readonly params: RevSharePendingParams;
}

const WORD_BYTES = 32;

/** Words `getPendingConfig` returns for each shape. */
export const REVSHARE_PENDING_CONFIG_WORDS: Readonly<Record<RevSharePendingShape, number>> = {
  "block-no-expiry": 7,
  "block-with-expiry": 8,
  "timestamp-with-expiry": 8,
};

/** The clock each shape stores. */
export const REVSHARE_SHAPE_CLOCK: Readonly<Record<RevSharePendingShape, DurationClock>> = {
  "block-no-expiry": "contract-block",
  "block-with-expiry": "contract-block",
  "timestamp-with-expiry": "timestamp",
};

const PARAMS_COMPONENTS = [
  { name: "feePips", type: "uint24" },
  { name: "lpDonateBps", type: "uint16" },
  { name: "beneficiaryBps", type: "uint16" },
  { name: "distributorBps", type: "uint16" },
  { name: "distributor", type: "address" },
  { name: "enabled", type: "bool" },
] as const;

const NO_EXPIRY_TYPES = [
  {
    type: "tuple",
    components: [
      { name: "effective", type: "uint48" },
      { name: "params", type: "tuple", components: PARAMS_COMPONENTS },
    ],
  },
] as const;

const BLOCK_EXPIRY_TYPES = [
  {
    type: "tuple",
    components: [
      { name: "effective", type: "uint48" },
      { name: "expiry", type: "uint48" },
      { name: "params", type: "tuple", components: PARAMS_COMPONENTS },
    ],
  },
] as const;

const TIMESTAMP_EXPIRY_TYPES = [
  {
    type: "tuple",
    components: [
      { name: "effective", type: "uint40" },
      { name: "expiry", type: "uint40" },
      { name: "params", type: "tuple", components: PARAMS_COMPONENTS },
    ],
  },
] as const;

/** Thrown for any return that does not match the shape it was decoded as. */
export class RevSharePendingConfigShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RevSharePendingConfigShapeError";
  }
}

function toParams(p: {
  feePips: number;
  lpDonateBps: number;
  beneficiaryBps: number;
  distributorBps: number;
  distributor: Address;
  enabled: boolean;
}): RevSharePendingParams {
  return {
    feePips: Number(p.feePips),
    lpDonateBps: Number(p.lpDonateBps),
    beneficiaryBps: Number(p.beneficiaryBps),
    distributorBps: Number(p.distributorBps),
    distributor: p.distributor,
    enabled: p.enabled,
  };
}

/**
 * Decodes a raw `getPendingConfig` return AS `shape`.
 *
 * Throws `RevSharePendingConfigShapeError` when the byte length is not what that
 * shape returns. It does not try another shape: a mismatch means the address
 * book and the chain disagree about this hook, and that is worth an error.
 */
export function decodeRevSharePendingConfig(data: Hex, shape: RevSharePendingShape): DecodedRevSharePendingConfig {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(data)) {
    throw new RevSharePendingConfigShapeError("getPendingConfig returned data that is not whole bytes of hex");
  }
  const bytes = (data.length - 2) / 2;
  const expected = REVSHARE_PENDING_CONFIG_WORDS[shape];
  if (expected === undefined) {
    throw new RevSharePendingConfigShapeError(`unknown RevShareHook pending-config shape "${String(shape)}"`);
  }
  if (bytes !== expected * WORD_BYTES) {
    throw new RevSharePendingConfigShapeError(
      `getPendingConfig returned ${bytes} bytes; shape ${shape} returns ${expected * WORD_BYTES}. ` +
        "The address book and the chain disagree about this hook - refusing to guess a layout.",
    );
  }
  const durationClock = REVSHARE_SHAPE_CLOCK[shape];
  if (shape === "block-no-expiry") {
    const [t] = decodeAbiParameters(NO_EXPIRY_TYPES, data);
    return { shape, durationClock, effective: BigInt(t.effective), expiry: null, params: toParams(t.params) };
  }
  const [t] = decodeAbiParameters(shape === "block-with-expiry" ? BLOCK_EXPIRY_TYPES : TIMESTAMP_EXPIRY_TYPES, data);
  return {
    shape,
    durationClock,
    effective: BigInt(t.effective),
    expiry: BigInt(t.expiry),
    params: toParams(t.params),
  };
}

const GET_PENDING_CONFIG_ABI = [
  {
    type: "function",
    name: "getPendingConfig",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    // Deliberately `bytes`: the call is made raw and decoded by shape above.
    outputs: [{ name: "", type: "bytes" }],
  },
] as const;

/** Calldata for `getPendingConfig(poolId)`. Make the call raw; decode with `decodeRevSharePendingConfig`. */
export function encodeGetPendingConfig(poolId: Hex): Hex {
  return encodeFunctionData({ abi: GET_PENDING_CONFIG_ABI, functionName: "getPendingConfig", args: [poolId] });
}

/** Calldata for ERC-6372 `CLOCK_MODE()`. Only the timestamp builds implement it. */
export const CLOCK_MODE_CALLDATA: Hex = "0x4bf5d7e9";

/** What a timestamp-clocked Latch contract returns from `CLOCK_MODE()`. */
export const TIMESTAMP_CLOCK_MODE = "mode=timestamp";

/**
 * The pending-config shape a hook's `CLOCK_MODE()` probe and return length imply,
 * for a hook the address book does NOT know.
 *
 * @param clockMode The decoded `CLOCK_MODE()` string, or `null` when the call
 * REVERTED (the block-numbered builds have no such function). A transport
 * failure is neither: the caller must surface it, not pass `null`.
 * @param returnedWords Word count of the raw `getPendingConfig` return.
 * @returns `undefined` when the combination matches no known build.
 */
export function inferRevSharePendingShape(
  clockMode: string | null,
  returnedWords: number,
): RevSharePendingShape | undefined {
  if (clockMode === TIMESTAMP_CLOCK_MODE) return returnedWords === 8 ? "timestamp-with-expiry" : undefined;
  if (clockMode !== null) return undefined;
  if (returnedWords === 7) return "block-no-expiry";
  if (returnedWords === 8) return "block-with-expiry";
  return undefined;
}

/**
 * Where a proposal stands.
 *
 *   none      `effective == 0`
 *   queued    not yet applicable
 *   armed     applicable by ANYONE right now. On `block-no-expiry` this is
 *             permanent until the owner cancels or freezes.
 *   expired   past `expiry`: `applyPendingConfig` reverts `PendingConfigExpired`.
 *
 * `now` must carry the clock the proposal is on: `timestamp` for a timestamp
 * hook, `contractBlockNumber` (from `readContractBlockNumber`, never
 * `eth_blockNumber`) for a block-numbered one. A missing clock throws.
 */
export type RevShareProposalStatus = "none" | "queued" | "armed" | "expired";

export function revShareProposalStatus(
  p: Pick<DecodedRevSharePendingConfig, "durationClock" | "effective" | "expiry">,
  now: DurationNow,
): RevShareProposalStatus {
  const phase = windowPhase(p.durationClock, p.effective, p.expiry, now);
  switch (phase) {
    case "none":
      return "none";
    case "before":
      return "queued";
    case "open":
      return "armed";
    case "closed":
      return "expired";
  }
}
