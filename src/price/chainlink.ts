// SPDX-License-Identifier: MIT
/**
 * TIER 1 — the chain's native/USD Chainlink aggregator, read on chain.
 *
 * The authoritative source, and the one this repository already trusts everywhere else:
 * `ChainlinkPriceBandAdapter` bands live pools against feeds read exactly this way, and
 * `src/rwa/bandOracle.ts` builds its configuration. A tier-1 answer has a block number, a
 * round id and an on-chain audit trail, which is what separates it from tier 2.
 *
 * THE ADDRESS IS NOT A PARAMETER BY DEFAULT. It comes from
 * `deployments/nativeFeeds.ts`, which is generated and every entry of which was read from
 * the chain before it was written down. A caller MAY pass its own address — a deployment
 * on a chain the table does not cover, say — and then it is the caller's claim, recorded as
 * such in the provenance.
 *
 * THE CHECKS ARE THE ONES THE SOLIDITY ADAPTER MAKES
 * ---------------------------------------------------
 * `ChainlinkPriceBandAdapter` reverts `NonPositiveAnswer`, `IncompleteRound`,
 * `AnswerTooOld` and `DecimalsChanged`. Each has a counterpart here and each returns an
 * unavailable rather than a number, because "the contract would have refused this" is not a
 * situation where a UI should quietly show a dollar figure anyway.
 *
 *   decimals     re-read every time and compared with the committed table. A silent
 *                decimals change is a 10^n error in a price; the adapter treats it as an
 *                incident and so does this.
 *   answer > 0   a non-positive price is not a price.
 *   round        `startedAt` and `updatedAt` both non-zero, `roundId` non-zero.
 *   age          against the feed's OWN heartbeat plus a small grace — see
 *                `staleAfterSeconds` in the generated table. Every feed here is
 *                `marketHours: "Crypto"`, i.e. 24/7, so age past the heartbeat is a fault
 *                and not a closed market. This is the one place the rule differs from
 *                `stockFeeds.ts`, where a stale weekend reading is the schedule working.
 *
 * WHAT IT DOES NOT CHECK, and cannot. That the aggregator's operators are honest, that the
 * proxy has not been re-pointed since the table was generated (the description and decimals
 * would have to change too, which is why both are re-read), or that a price inside the
 * heartbeat is a price anyone can trade at.
 */

import type { Address, PublicClient } from "viem";

import {
  nativeFeedFor,
  staleAfterSeconds,
  type ChainlinkNativeFeed,
  type NativeFeedRecord,
} from "../deployments/nativeFeeds.js";
import type { NativeUsdAttempt, NativeUsdProvenance, NativeUsdQuote } from "./types.js";

export const CHAINLINK_AGGREGATOR_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "description", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

/** Clock skew tolerated before `updatedAt` is called a future timestamp. */
export const FUTURE_SKEW_SECONDS = 120;

export interface ReadChainlinkNativeUsdOptions {
  readonly client: PublicClient;
  readonly chainId: number;
  /**
   * Override the committed aggregator. The caller then owns the claim that this address is
   * a native/USD feed, and the provenance says so.
   */
  readonly aggregator?: Address | undefined;
  /** Override the staleness threshold, in seconds. Default: the feed's heartbeat + grace. */
  readonly staleAfter?: number | undefined;
  /** `Date.now()/1000` by default. Injected so the tests are not a clock. */
  readonly now?: number | undefined;
}

export type ChainlinkReadResult =
  | { readonly ok: true; readonly quote: NativeUsdQuote; readonly attempt: NativeUsdAttempt }
  | { readonly ok: false; readonly attempt: NativeUsdAttempt };

function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/**
 * Read the tier-1 feed for `chainId`.
 *
 * Returns the failure as a value, never as a throw: every caller of this is a UI that must
 * keep rendering, and a `try`/`catch` around a price is how a fallback to a made-up number
 * gets written.
 */
export async function readChainlinkNativeUsd(
  opts: ReadChainlinkNativeUsdOptions,
): Promise<ChainlinkReadResult> {
  const { client, chainId } = opts;
  const record: NativeFeedRecord | undefined = nativeFeedFor(chainId);
  const feed: ChainlinkNativeFeed | null = record?.chainlink ?? null;
  const address = (opts.aggregator ?? feed?.proxyAddress) as Address | undefined;

  if (!address) {
    return {
      ok: false,
      attempt: {
        tier: "chainlink-onchain",
        address: null,
        outcome: "skipped",
        detail: record
          ? `no verified Chainlink native/USD aggregator on ${record.chainName} (${chainId})`
          : `chain ${chainId} is not in deployments/nativeFeeds.ts`,
      },
    };
  }
  if (!record?.native) {
    return {
      ok: false,
      attempt: {
        tier: "chainlink-onchain",
        address,
        outcome: "skipped",
        detail: `chain ${chainId} has no recorded native currency, so an answer could not be scaled`,
      },
    };
  }

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const threshold = opts.staleAfter ?? (feed ? staleAfterSeconds(feed) : 3600);

  let decimals: number;
  let description: string;
  let roundId: bigint;
  let answer: bigint;
  let startedAt: bigint;
  let updatedAt: bigint;
  let blockNumber: bigint | null = null;
  try {
    const [d, desc, round] = await Promise.all([
      client.readContract({ address, abi: CHAINLINK_AGGREGATOR_ABI, functionName: "decimals" }),
      client.readContract({ address, abi: CHAINLINK_AGGREGATOR_ABI, functionName: "description" }),
      client.readContract({ address, abi: CHAINLINK_AGGREGATOR_ABI, functionName: "latestRoundData" }),
    ]);
    decimals = Number(d);
    description = String(desc);
    [roundId, answer, startedAt, updatedAt] = round as readonly [bigint, bigint, bigint, bigint, bigint];
  } catch (e) {
    return {
      ok: false,
      attempt: {
        tier: "chainlink-onchain",
        address,
        outcome: "error",
        detail: `aggregator ${address} could not be read: ${String((e as Error)?.message ?? e).split("\n")[0]}`,
      },
    };
  }
  try {
    blockNumber = await client.getBlockNumber();
  } catch {
    // A missing block number costs the provenance a field; it does not invalidate the read.
    blockNumber = null;
  }

  const refuse = (detail: string, outcome: NativeUsdAttempt["outcome"] = "refused"): ChainlinkReadResult => ({
    ok: false,
    attempt: { tier: "chainlink-onchain", address, outcome, detail },
  });

  // `DecimalsChanged` in the adapter. A feed whose scale moved under a committed table is
  // an incident, not a rounding difference.
  if (feed && decimals !== feed.decimals) {
    return refuse(
      `aggregator ${address} now reports ${decimals} decimals; deployments/nativeFeeds.ts recorded ${feed.decimals}. ` +
        `Re-run scripts/generate-native-feeds.mjs before trusting this feed again.`,
    );
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    return refuse(`aggregator ${address} reports an unusable decimals value ${decimals}`);
  }
  if (answer <= 0n) return refuse(`aggregator ${address} answered ${answer}, which is not a price`);
  if (roundId === 0n || startedAt === 0n || updatedAt === 0n) {
    return refuse(`aggregator ${address} returned an incomplete round (roundId ${roundId}, startedAt ${startedAt}, updatedAt ${updatedAt})`);
  }
  const updated = Number(updatedAt);
  if (updated > now + FUTURE_SKEW_SECONDS) {
    return refuse(`aggregator ${address} reports updatedAt ${updated}, which is in the future (now ${now})`);
  }
  const ageSeconds = now - updated;
  if (ageSeconds > threshold) {
    return refuse(
      `aggregator ${address} last published ${ageSeconds} s ago; its heartbeat allows ${threshold} s. ` +
        `This is a 24/7 crypto feed, so that is a stalled feed rather than a closed market.`,
      "stale",
    );
  }

  const caveats: string[] = [];
  if (feed?.variant === "svr") {
    caveats.push(
      `This is Chainlink's SVR feed (${feed.path}), not the canonical ${record.native.symbol.toLowerCase()}-usd one — ` +
        `the same price data delivered through an OEV auction, so an update can land later on chain. ` +
        `It is selected because it is the only ${record.native.symbol}/USD aggregator on this chain.`,
    );
  }
  if (feed?.feedCategory === "deprecating") {
    caveats.push(`Chainlink has marked this feed "deprecating"; it will stop answering.`);
  }
  if (feed?.feedCategory === "new") {
    caveats.push(`Chainlink marks this feed "new": less operating history than a "low" category feed.`);
  }
  if (record.native.inferred) {
    caveats.push(`The native currency's decimals are inferred, not read: ${record.native.source}`);
  }
  if (record.testnet) {
    caveats.push(
      `${record.chainName} is a testnet. This feed prices the MAINNET asset; the testnet's own native token has no market price.`,
    );
  }
  if (opts.aggregator && opts.aggregator !== feed?.proxyAddress) {
    caveats.push(`Caller-supplied aggregator address; it is not the one verified in deployments/nativeFeeds.ts.`);
  }

  const provenance: NativeUsdProvenance = {
    tier: "chainlink-onchain",
    source: "Chainlink",
    address,
    chainId,
    blockNumber,
    updatedAt: updated,
    ageSeconds,
    staleAfterSeconds: threshold,
    roundId: roundId.toString(),
    description,
    label:
      `Chainlink ${description} at ${shortAddress(address)} on ${record.chainName}` +
      (blockNumber === null ? "" : `, block ${blockNumber}`) +
      `, round ${roundId}, ${ageSeconds} s old`,
    caveats,
  };

  return {
    ok: true,
    quote: {
      ok: true,
      answer,
      answerDecimals: decimals,
      nativeSymbol: record.native.symbol,
      nativeDecimals: record.native.decimals,
      provenance,
    },
    attempt: {
      tier: "chainlink-onchain",
      address,
      outcome: "ok",
      detail: `${description}: ${answer} at ${decimals} dp, ${ageSeconds} s old`,
    },
  };
}
