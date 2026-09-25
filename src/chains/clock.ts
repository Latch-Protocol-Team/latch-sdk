// SPDX-License-Identifier: MIT
/* ============================================================================
   THE BLOCK NUMBER CONTRACTS SEE — which is not always the one the RPC reports.

   THE TRAP
   --------
   On an Arbitrum Nitro chain (Robinhood Chain, 4663, is one) there are two
   block clocks, and they differ by more than 2x in value and ~120x in speed:

     eth_blockNumber / header.number   the L2 block. ~0.1 s per block.
     block.number INSIDE THE EVM        the PARENT chain's (Ethereum L1) block
                                        number, as last synced by the sequencer.
                                        ~12 s per block. Also in every header as
                                        `l1BlockNumber`.

   Arbitrum documents this ("block.number returns the approximate block number
   of the first non-Arbitrum ancestor chain", docs.arbitrum.io, Block numbers
   and time), and it was measured on 4663 on 2026-09-13 against MINED state, not
   just an eth_call: an OpenZeppelin ERC20Votes token (clock() = block.number)
   wrote a checkpoint in L2 block 62,356,430 whose key is 25,971,883 — that
   block's `l1BlockNumber` — and `getPastVotes` at the L2 number reverts
   `ERC5805FutureLookup`.

   Every BLOCK-NUMBERED Latch contract that stores a block number (the
   deployed `RevShareHook`s' `effectiveBlock` / `expiryBlock`, the deployed
   `LaunchGuardHook`'s `startBlock`, `LatchLaunchRegistry.registeredAtBlock`)
   therefore stores an L1-scale number on 4663. Comparing
   one against `eth_blockNumber` (~62M) makes every future block (~26M) look
   long past: a queued proposal renders "armed", an unopened launch "started",
   and a live proposal "expired" — the last of which made the keeper refuse to
   ever apply one.

   IT IS PER CHAIN, NOT PER FAMILY
   -------------------------------
   "It is an L2" predicts nothing here. Base (8453) is an OP-stack L2 and its
   EVM `block.number` is its OWN block number: probed 2026-09-20, `NUMBER`
   returned 51,543,389 while `eth_blockNumber` returned 51,543,389. Carrying
   Robinhood's Nitro assumption onto Base would be wrong in the other
   direction, and just as invisible. Measure each chain; `MEASURED_CONTRACT_CLOCKS`
   below records the ones Latch has read but not deployed on.

   THE RULE THIS MODULE ENFORCES
   -----------------------------
   A contract-stored block number is compared against `readContractBlockNumber`
   and nothing else. `getBlockNumber()` is still the right number for LOGS —
   `eth_getLogs` ranges, `deployedAtBlock`, "summed from logs since block N" —
   because logs are indexed by the L2 block. Two clocks, two jobs, never mixed.

   And a duration in contract blocks is converted at `contractBlockTimeCentis`
   (the real cadence of the EVM's block.number), never at the RPC's block time
   and never at a contract's own declared `blockTimeCentis()`. On 4663 the live
   `LaunchpadKit`, `LaunchGuardHook` and `RevShareHook` declare 10 (0.1 s) while
   their block.number advances every ~12 s, so each of their windows runs ~120x
   LONGER than the seconds they were derived from.

   THE TIMESTAMP BUILDS (Option B, 2026-09-13) store unix seconds instead, and
   are compared with `block.timestamp`. Which clock a contract uses is recorded
   per address in the deployment record (`durationClocks`, `revShareHooks`);
   `windowPhase` below takes that clock and refuses to compare across clocks.
   ============================================================================ */

import type { Hex } from "viem";

import { LATCH_DEPLOYMENTS, isLatchChainId, type DurationClock } from "../deployments/index.js";

/**
 * Which clock `block.number` follows inside the EVM on a chain.
 *
 * - `parent-l1` — Arbitrum Nitro / Orbit: the first non-Arbitrum ancestor's
 *   block number (Ethereum L1 for an L2). Differs from `eth_blockNumber`.
 * - `native` — the chain's own block number, identical to `eth_blockNumber`.
 */
export type ContractBlockClock = "parent-l1" | "native";

/** What is known about a chain's contract-visible block clock. */
export interface ContractClock {
  readonly chainId: number;
  readonly clock: ContractBlockClock;
  /**
   * Real cadence of `block.number` as a CONTRACT sees it, in hundredths of a
   * second. Robinhood: 1200 (Ethereum's 12 s slot). This, and only this, turns
   * a contract block count into wall-clock time.
   */
  readonly contractBlockTimeCentis: number;
}

/**
 * EVM bytecode run as a contract-creation `eth_call`: returns `NUMBER` (the
 * contract-visible block number) and `TIMESTAMP`, as two 32-byte words.
 *
 *   43 NUMBER · 6000 PUSH1 0 · 52 MSTORE · 42 TIMESTAMP · 6020 PUSH1 32 ·
 *   52 MSTORE · 6040 PUSH1 64 · 6000 PUSH1 0 · f3 RETURN
 *
 * Universal: it is correct on every EVM chain whatever its clock, because it
 * asks the EVM rather than the node's bookkeeping.
 */
export const CONTRACT_CLOCK_PROBE_CALLDATA: Hex = "0x436000524260205260406000f3";

/**
 * Chains whose contract clock has been MEASURED but where Latch is not (yet)
 * deployed, so they carry no address-book record to read it from.
 *
 * Why this exists: the fallback for an unknown chain is the `NUMBER` probe, and
 * when an endpoint refuses creation calls the only remaining source is a Nitro
 * header's `l1BlockNumber` — which an OP-stack chain does not have. On such a
 * chain the reader then throws, correctly but uselessly, for a fact somebody
 * already measured. Recording the measurement removes the round trip AND the
 * failure mode.
 *
 * A chain enters this table only with a reading behind it, never by family: an
 * L2 is not evidence of either clock. Robinhood (Nitro) shows contracts its
 * parent chain's number; Base (OP-stack) shows its own.
 *
 * - **8453 Base** — `native`, 2.0 s. Read 2026-09-20 against
 *   `https://mainnet.base.org`: the `NUMBER` probe returned 51,543,389 at the
 *   same moment `eth_blockNumber` returned 51,543,389, so the EVM's
 *   `block.number` IS the chain's own. Cadence from headers 51,542,404 ->
 *   51,543,404, timestamps 1,789,874,155 -> 1,789,876,155: exactly 2 s a block.
 *
 * The address book wins where both know a chain: when Base enters
 * `LATCH_DEPLOYMENTS` its own record is authoritative and this entry is
 * redundant (and asserted equal by `test/clock.test.ts`).
 */
export const MEASURED_CONTRACT_CLOCKS: Readonly<Record<number, ContractClock>> = {
  8453: { chainId: 8453, clock: "native", contractBlockTimeCentis: 200 },
};

/**
 * The chain's contract clock, or `undefined` for a chain nobody has measured.
 *
 * The address book first (it is the deployed truth), then the measured table
 * above for chains Latch has probed but not deployed on.
 */
export function getContractClock(chainId: number): ContractClock | undefined {
  if (isLatchChainId(chainId)) {
    const d = LATCH_DEPLOYMENTS[chainId];
    return {
      chainId,
      clock: d.contractBlockClock,
      contractBlockTimeCentis: d.contractBlockTimeCentis,
    };
  }
  return MEASURED_CONTRACT_CLOCKS[chainId];
}

/** {@link getContractClock}, throwing for a chain the address book does not know. */
export function requireContractClock(chainId: number): ContractClock {
  const c = getContractClock(chainId);
  if (c === undefined) {
    throw new Error(
      `No contract-clock metadata for chain ${chainId}. Measure it: run ` +
        `CONTRACT_CLOCK_PROBE_CALLDATA as an eth_call at two blocks and compare NUMBER ` +
        `against TIMESTAMP before converting any block count to time.`,
    );
  }
  return c;
}

/**
 * The narrow client surface this module needs. A viem `PublicClient` satisfies
 * it; so does a test double.
 */
export interface ContractClockClient {
  getBlockNumber(): Promise<bigint>;
  call(args: { data: Hex }): Promise<{ data?: Hex | undefined }>;
  getBlock(): Promise<{ number: bigint | null; timestamp: bigint }>;
}

/** How `contractBlockNumber` in a reading was obtained. Render it; it is provenance. */
export type ContractClockMethod = "eth_call NUMBER" | "header l1BlockNumber" | "eth_blockNumber";

export interface ContractClockReading {
  readonly chainId: number;
  readonly clock: ContractBlockClock;
  /** `block.number` as a contract executing now would see it. Compare stored block numbers to THIS. */
  readonly contractBlockNumber: bigint;
  /** `eth_blockNumber`. The log-index clock. Never compare a contract-stored block number to it. */
  readonly rpcBlockNumber: bigint;
  /** `block.timestamp`, seconds. */
  readonly timestamp: bigint;
  readonly method: ContractClockMethod;
}

/** Decodes the two words `CONTRACT_CLOCK_PROBE_CALLDATA` returns. */
export function decodeContractClockProbe(data: Hex): { number: bigint; timestamp: bigint } {
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  if (hex.length !== 128) {
    throw new Error(`clock probe returned ${hex.length / 2} bytes, expected 64`);
  }
  return {
    number: BigInt(`0x${hex.slice(0, 64)}`),
    timestamp: BigInt(`0x${hex.slice(64, 128)}`),
  };
}

/** Reads a Nitro header's `l1BlockNumber`, which viem passes through unformatted. */
function headerL1BlockNumber(block: unknown): bigint | undefined {
  if (typeof block !== "object" || block === null) return undefined;
  const v = (block as { l1BlockNumber?: unknown }).l1BlockNumber;
  if (typeof v === "bigint") return v;
  if (typeof v === "string" && /^0x[0-9a-fA-F]+$/.test(v)) return BigInt(v);
  return undefined;
}

/**
 * The contract-visible block number now, with the RPC's number beside it.
 *
 * - `native` chains: one `getBlock()`; the two numbers are the same.
 * - `parent-l1` chains, and any chain the address book does not know: the
 *   universal `NUMBER` probe. If the endpoint refuses creation calls (some
 *   public RPCs do), a Nitro header's `l1BlockNumber` is used instead.
 *
 * It NEVER falls back to `eth_blockNumber` on a non-native chain. A wrong
 * number that looks right is the exact failure this module exists to remove;
 * a thrown error renders as "unreachable", which is honest.
 */
export async function readContractClock(
  client: ContractClockClient,
  chainId: number,
): Promise<ContractClockReading> {
  const known = getContractClock(chainId);

  if (known?.clock === "native") {
    const block = await client.getBlock();
    if (block.number === null) throw new Error("latest block has no number (pending block returned)");
    return {
      chainId,
      clock: "native",
      contractBlockNumber: block.number,
      rpcBlockNumber: block.number,
      timestamp: block.timestamp,
      method: "eth_blockNumber",
    };
  }

  const clock: ContractBlockClock = known?.clock ?? "parent-l1";
  const [probe, block] = await Promise.all([
    client.call({ data: CONTRACT_CLOCK_PROBE_CALLDATA }).then(
      (r) => (r.data ? decodeContractClockProbe(r.data) : undefined),
      () => undefined,
    ),
    client.getBlock(),
  ]);
  if (block.number === null) throw new Error("latest block has no number (pending block returned)");

  if (probe !== undefined) {
    return {
      chainId,
      // For a chain the address book does not know, the probe itself tells us.
      clock: known ? clock : probe.number === block.number ? "native" : "parent-l1",
      contractBlockNumber: probe.number,
      rpcBlockNumber: block.number,
      timestamp: probe.timestamp,
      method: "eth_call NUMBER",
    };
  }

  const l1 = headerL1BlockNumber(block);
  if (l1 !== undefined) {
    return {
      chainId,
      clock,
      contractBlockNumber: l1,
      rpcBlockNumber: block.number,
      timestamp: block.timestamp,
      method: "header l1BlockNumber",
    };
  }

  throw new Error(
    `Could not read the contract-visible block number on chain ${chainId}: the RPC refused the ` +
      `NUMBER probe and its latest header carries no l1BlockNumber. eth_blockNumber is NOT a ` +
      `substitute on this chain — it is a different clock.`,
  );
}

/** `readContractClock(...).contractBlockNumber`. */
export async function readContractBlockNumber(client: ContractClockClient, chainId: number): Promise<bigint> {
  return (await readContractClock(client, chainId)).contractBlockNumber;
}

/**
 * Contract blocks to seconds at the chain's REAL contract cadence.
 * Floors to whole seconds. Accepts a chain id or a {@link ContractClock}.
 */
export function contractBlocksToSeconds(blocks: number | bigint, clock: ContractClock | number): number {
  const c = typeof clock === "number" ? requireContractClock(clock) : clock;
  const b = BigInt(blocks);
  if (b < 0n) throw new RangeError("blocks must not be negative");
  return Number((b * BigInt(c.contractBlockTimeCentis)) / 100n);
}

/** Seconds to contract blocks at the chain's REAL contract cadence, rounding UP. */
export function secondsToContractBlocks(seconds: number | bigint, clock: ContractClock | number): bigint {
  const c = typeof clock === "number" ? requireContractClock(clock) : clock;
  const s = BigInt(seconds);
  if (s < 0n) throw new RangeError("seconds must not be negative");
  const centis = BigInt(c.contractBlockTimeCentis);
  return (s * 100n + centis - 1n) / centis;
}

/**
 * How much LONGER a window really runs than a contract that declared
 * `declaredBlockTimeCentis` believes. 120 on the live Robinhood launch
 * contracts (declared 10, real 1200). 1 when they agree.
 */
export function clockStretch(declaredBlockTimeCentis: number, clock: ContractClock | number): number {
  const c = typeof clock === "number" ? requireContractClock(clock) : clock;
  if (declaredBlockTimeCentis <= 0) throw new RangeError("declaredBlockTimeCentis must be positive");
  return c.contractBlockTimeCentis / declaredBlockTimeCentis;
}

/** Where a block-bounded window stands, judged against the CONTRACT clock. */
export type BlockWindowPhase = "none" | "before" | "open" | "closed";

/**
 * Classifies `[startBlock, endBlock]` (both inclusive, `endBlock` optional)
 * against a contract-visible block number. `startBlock === 0n` means no window.
 *
 * Pass `readContractBlockNumber(...)`, never `getBlockNumber()`: on a Nitro
 * chain the latter is ~2.4x the value and makes every window look closed.
 */
export function blockWindowPhase(
  startBlock: bigint,
  endBlock: bigint | null,
  contractBlockNumber: bigint,
): BlockWindowPhase {
  if (startBlock === 0n) return "none";
  if (contractBlockNumber < startBlock) return "before";
  if (endBlock !== null && contractBlockNumber > endBlock) return "closed";
  return "open";
}

/**
 * "Now", on both clocks a Latch contract may use.
 *
 * `timestamp` is `block.timestamp` of the latest block (a reading's `timestamp`).
 * `contractBlockNumber` is `block.number` as a contract sees it
 * (`readContractBlockNumber`), or `null` when the caller did not read it — which
 * is fine for timestamp contracts and an error for block-numbered ones.
 */
export interface DurationNow {
  readonly timestamp: bigint;
  readonly contractBlockNumber: bigint | null;
}

/** {@link blockWindowPhase} for a window stored in unix seconds. Same inclusive semantics. */
export function timestampWindowPhase(
  startSeconds: bigint,
  endSeconds: bigint | null,
  nowSeconds: bigint,
): BlockWindowPhase {
  return blockWindowPhase(startSeconds, endSeconds, nowSeconds);
}

/**
 * Classifies `[start, end]` (inclusive, `start === 0n` meaning no window) on the
 * clock the contract actually stores. Throws when a block-numbered window is
 * asked about without a contract block number: substituting the timestamp, or
 * `eth_blockNumber`, is exactly the cross-clock comparison this module exists
 * to prevent.
 */
export function windowPhase(
  clock: DurationClock,
  start: bigint,
  end: bigint | null,
  now: DurationNow,
): BlockWindowPhase {
  if (clock === "timestamp") return timestampWindowPhase(start, end, now.timestamp);
  if (now.contractBlockNumber === null) {
    throw new Error(
      "this window is on the contract block clock; pass readContractBlockNumber(...) as contractBlockNumber " +
        "(never eth_blockNumber, never the timestamp)",
    );
  }
  return blockWindowPhase(start, end, now.contractBlockNumber);
}

/**
 * Seconds from `now` until `point` on `clock`, or `null` when it cannot be said
 * honestly. For a block-numbered contract the answer is an ESTIMATE at the
 * chain's real `contractBlockTimeCentis`; label it as one.
 */
export function secondsUntil(
  clock: DurationClock,
  point: bigint,
  now: DurationNow,
  contractClock: ContractClock | undefined,
): number | null {
  if (clock === "timestamp") return Number(point - now.timestamp);
  if (now.contractBlockNumber === null || contractClock === undefined) return null;
  const blocks = point - now.contractBlockNumber;
  return Number((blocks * BigInt(contractClock.contractBlockTimeCentis)) / 100n);
}
