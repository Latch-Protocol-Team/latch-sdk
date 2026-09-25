// SPDX-License-Identifier: MIT
/**
 * `resolveNativeUsd` — the layered native/USD resolver.
 *
 *   TIER 1  Chainlink aggregator, read on chain. `chainlink.ts`.
 *   TIER 2  Pyth contract, read on chain, with a caller-supplied address. `pyth.ts`.
 *   TIER 3  A Latch pool TWAP. Unimplemented on purpose. `pool.ts`.
 *   TIER 4  Nothing. Return unavailable; the caller prices in NATIVE units and shows no
 *           dollars. This is a correct answer on several chains, not a failure.
 *
 * THE ONE RULE THE WHOLE FILE EXISTS TO ENFORCE: there is no fifth branch. If no tier
 * answers, the result is `{ ok: false }` with a reason — never a zero, never a cached
 * number, never a figure from another chain. CLAUDE.md's no-invented-data rule is the
 * reason, and the specific failure it is written against is "a number that looks real and
 * is not poisons that judgement, and the reader has no way to tell which numbers to
 * discount". A dollar figure on a launch screen is exactly that number.
 *
 * TESTNETS ARE REFUSED BY DEFAULT, and this is a judgement worth arguing with rather than
 * a bug. Sepolia carries a verified Chainlink ETH/USD feed. It prices REAL ether. Sepolia's
 * own ether has no market price at all, so rendering "$3,500 opening market cap" for a
 * Sepolia launch shows a number that is accurate about a different asset — the most
 * misleading kind of true. `allowTestnetUsd: true` opts in for anyone knowingly using it as
 * a stand-in, and the provenance then carries the caveat.
 *
 * EVERY ATTEMPT IS RECORDED, including the ones that were skipped, so a caller debugging a
 * missing price sees which tiers were tried and what each said. That list is diagnostics;
 * the sentence a user reads is `detail`.
 */

import type { Address, PublicClient } from "viem";

import { nativeFeedFor, type NativeFeedRecord } from "../deployments/nativeFeeds.js";
import { readChainlinkNativeUsd } from "./chainlink.js";
import { poolTwapAttempt } from "./pool.js";
import { readPythNativeUsd } from "./pyth.js";
import type { NativeUsdAttempt, NativeUsdResult, NativeUsdUnavailableReason } from "./types.js";

export interface ResolveNativeUsdOptions {
  readonly client: PublicClient;
  readonly chainId: number;
  /**
   * Tier 2. Both are required together or tier 2 is skipped: no Pyth address is committed
   * in this SDK because none was verified, and a pull oracle's tolerable age is a property
   * of the chain's traffic that only the caller knows. See `pyth.ts`.
   */
  readonly pyth?: { readonly contract: Address; readonly staleAfter: number } | undefined;
  /** Override tier 1's aggregator. Then the address is the caller's claim, and it says so. */
  readonly chainlinkAggregator?: Address | undefined;
  /** Override tier 1's staleness threshold. Default: the feed's own heartbeat plus grace. */
  readonly chainlinkStaleAfter?: number | undefined;
  /**
   * Allow a USD answer on a testnet. Off by default — a testnet's native token has no
   * market price, and the feed deployed there prices the mainnet asset. See the header.
   */
  readonly allowTestnetUsd?: boolean | undefined;
  /** `Date.now()/1000` by default. Injected so the tests are not a clock. */
  readonly now?: number | undefined;
}

function unavailable(
  chainId: number,
  record: NativeFeedRecord | undefined,
  reason: NativeUsdUnavailableReason,
  detail: string,
  attempts: readonly NativeUsdAttempt[],
): NativeUsdResult {
  return {
    ok: false,
    reason,
    detail,
    chainId,
    nativeSymbol: record?.native?.symbol ?? null,
    nativeDecimals: record?.native?.decimals ?? null,
    attempts,
  };
}

/**
 * Resolve the dollars-per-native rate for `chainId`, trying each tier in order.
 *
 * Never throws for a price reason: a transport failure, a reverting aggregator and a chain
 * with no feed all come back as `{ ok: false }` with a distinct reason, because a UI that
 * must keep rendering is the caller and a thrown error there becomes a `catch` that invents
 * a fallback.
 */
export async function resolveNativeUsd(opts: ResolveNativeUsdOptions): Promise<NativeUsdResult> {
  const { chainId } = opts;
  const record = nativeFeedFor(chainId);
  const attempts: NativeUsdAttempt[] = [];

  if (!record) {
    return unavailable(
      chainId,
      undefined,
      "chain-not-surveyed",
      `Chain ${chainId} is not in the native-feed survey, so nothing is known about a price source on it. ` +
        `Add it to scripts/generate-native-feeds.mjs and re-run the generator.`,
      attempts,
    );
  }

  if (record.testnet && !opts.allowTestnetUsd) {
    return unavailable(
      chainId,
      record,
      "testnet-native-has-no-market-price",
      `${record.chainName} is a test network: its ${record.native.symbol} has no market price, and any feed ` +
        `deployed there prices the mainnet asset instead. Amounts are shown in ${record.native.symbol}, not dollars.`,
      [
        {
          tier: "none",
          address: null,
          outcome: "skipped",
          detail: "testnet; pass allowTestnetUsd to use the mainnet-priced feed as a stand-in",
        },
      ],
    );
  }

  /* ------------------------------------------------------------------ tier 1 */
  const cl = await readChainlinkNativeUsd({
    client: opts.client,
    chainId,
    aggregator: opts.chainlinkAggregator,
    staleAfter: opts.chainlinkStaleAfter,
    now: opts.now,
  });
  attempts.push(cl.attempt);
  if (cl.ok) return cl.quote;

  /* ------------------------------------------------------------------ tier 2 */
  if (opts.pyth) {
    const py = await readPythNativeUsd({
      client: opts.client,
      chainId,
      pythContract: opts.pyth.contract,
      staleAfter: opts.pyth.staleAfter,
      now: opts.now,
    });
    attempts.push(py.attempt);
    if (py.ok) return py.quote;
  } else {
    attempts.push({
      tier: "pyth-hermes",
      address: null,
      outcome: "skipped",
      detail: record.pyth
        ? `a Pyth price-feed id is known (${record.pyth.priceFeedId}) but no Pyth contract address was supplied; ` +
          `this SDK commits none because none was verified on chain`
        : `no verified Pyth price-feed id for ${record.native.symbol}/USD (${record.pythRejection ?? "not surveyed"})`,
    });
  }

  /* ------------------------------------------------------------------ tier 3 */
  attempts.push(poolTwapAttempt());

  /* ------------------------------------------------------------------ tier 4 */
  // Choose the reason from what actually happened, so the caller's message is about this
  // chain rather than a generic "no price".
  const clAttempt = attempts.find((a) => a.tier === "chainlink-onchain");
  let reason: NativeUsdUnavailableReason;
  let detail: string;
  if (clAttempt?.outcome === "stale" || clAttempt?.outcome === "refused") {
    reason = "answer-refused";
    detail =
      `${record.chainName}'s ${record.native.symbol}/USD feed answered, and the answer was refused: ${clAttempt.detail} ` +
      `Amounts are shown in ${record.native.symbol}, not dollars.`;
  } else if (clAttempt?.outcome === "error") {
    reason = "read-failed";
    detail =
      `${record.chainName}'s ${record.native.symbol}/USD feed could not be read: ${clAttempt.detail} ` +
      `Amounts are shown in ${record.native.symbol}, not dollars.`;
  } else if (record.chainlink === null && record.pyth !== null && !opts.pyth) {
    reason = "pyth-contract-not-supplied";
    detail =
      `${record.chainName} has no Chainlink ${record.native.symbol}/USD feed. A Pyth price-feed id is known for it, ` +
      `but reading Pyth needs a contract address this SDK has not verified. Amounts are shown in ` +
      `${record.native.symbol}, not dollars.`;
  } else {
    reason = "no-source-on-chain";
    detail =
      `No native/USD price source exists for ${record.chainName}. ` +
      `Amounts are shown in ${record.native.symbol}, not dollars.` +
      (record.note ? ` ${record.note}` : "");
  }
  return unavailable(chainId, record, reason, detail, attempts);
}
