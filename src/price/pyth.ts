// SPDX-License-Identifier: MIT
/**
 * TIER 2 — Pyth, for chains Chainlink does not cover.
 *
 * WHAT CHANGED WHILE THIS WAS BEING BUILT, AND WHY THE SHAPE IS NOT THE OBVIOUS ONE
 * ---------------------------------------------------------------------------------
 * The plan was to read Pyth's Hermes HTTP endpoint off chain: free, keyless, no contract
 * address to verify. On 2026-09-20 that stopped being true, and it was checked rather than
 * assumed. Hermes' METADATA endpoint is still open — `GET /v2/price_feeds?query=ETH` answers
 * 200 with no credential, and that is how every price-feed id in
 * `deployments/nativeFeeds.ts` was established. Its PRICE endpoints are not:
 * `GET /v2/updates/price/latest` and the older `GET /api/latest_price_feeds` both answer
 * `401 unauthorized`, on the documented public host and on `hermes-beta`, with and without
 * the `0x` prefix on the id.
 *
 * So tier 2 reads the Pyth CONTRACT on chain instead. That is strictly better evidence — a
 * value in state at a block, like tier 1 — and it costs one thing: a Pyth contract address
 * per chain.
 *
 * NO PYTH CONTRACT ADDRESS IS COMMITTED IN THIS SDK, ON PURPOSE. The rule for this whole
 * layer is that an address nobody read from the chain does not get written down, and this
 * run verified no Pyth deployment. So `readPythNativeUsd` REQUIRES the caller to supply the
 * contract, and `resolveNativeUsd` skips tier 2 unless one is supplied. On every chain Latch
 * targets today that costs nothing: all twelve with a native/USD source have a verified
 * Chainlink aggregator, and the four without would still need a Pyth contract nobody has
 * checked. Promoting a chain to tier 2 is a verification job — read `getPriceUnsafe` for the
 * committed id at a candidate address and confirm it answers a sane price — not a typing job.
 *
 * PULL ORACLES ARE STALE BY DESIGN, WHICH CHANGES WHAT THE STALENESS RULE MEANS
 * -----------------------------------------------------------------------------
 * Chainlink pushes: a missed heartbeat means something is wrong. Pyth pulls: the on-chain
 * price is whatever the last person to post an update paid to post, so it can be hours old
 * on a quiet chain while Pyth itself is perfectly healthy. `getPriceNoOlderThan` exists
 * precisely so a consumer must state its own tolerance, and this reader makes that tolerance
 * a REQUIRED argument with no default. A default here would be a number nobody chose being
 * applied to a chain nobody looked at.
 */

import type { Address, PublicClient } from "viem";

import { nativeFeedFor, type NativeFeedRecord } from "../deployments/nativeFeeds.js";
import type { NativeUsdAttempt, NativeUsdProvenance, NativeUsdQuote } from "./types.js";
import { FUTURE_SKEW_SECONDS } from "./chainlink.js";

/**
 * `IPyth.getPriceUnsafe(bytes32) -> (int64 price, uint64 conf, int32 expo, uint256 publishTime)`.
 *
 * `getPriceUnsafe` rather than `getPriceNoOlderThan`, deliberately: the "unsafe" one returns
 * the publish time so the caller can see HOW stale and say so, where the safe one reverts
 * with `StalePrice` and tells a user nothing. The staleness check is then done here, with
 * the caller's own threshold, and a refusal carries the age.
 */
export const PYTH_ABI = [
  {
    type: "function",
    name: "getPriceUnsafe",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      {
        name: "price",
        type: "tuple",
        components: [
          { name: "price", type: "int64" },
          { name: "conf", type: "uint64" },
          { name: "expo", type: "int32" },
          { name: "publishTime", type: "uint256" },
        ],
      },
    ],
  },
] as const;

export interface ReadPythNativeUsdOptions {
  readonly client: PublicClient;
  readonly chainId: number;
  /**
   * The Pyth contract on this chain. REQUIRED, and it is the caller's claim: this SDK
   * commits no Pyth address because it verified none. See the header.
   */
  readonly pythContract: Address;
  /**
   * How old a Pyth answer may be, in seconds. REQUIRED and with no default — a pull oracle's
   * on-chain age is a property of the chain's traffic, not of Pyth, so only the caller can
   * know what is tolerable for its use.
   */
  readonly staleAfter: number;
  /** Override the committed price-feed id. Then the identity is the caller's claim. */
  readonly priceFeedId?: `0x${string}` | undefined;
  /** `Date.now()/1000` by default. Injected so the tests are not a clock. */
  readonly now?: number | undefined;
}

export type PythReadResult =
  | { readonly ok: true; readonly quote: NativeUsdQuote; readonly attempt: NativeUsdAttempt }
  | { readonly ok: false; readonly attempt: NativeUsdAttempt };

function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/**
 * Read the tier-2 source for `chainId` from the Pyth contract the caller supplies.
 *
 * Returns failures as values, never throws — same reasoning as the tier-1 reader.
 */
export async function readPythNativeUsd(opts: ReadPythNativeUsdOptions): Promise<PythReadResult> {
  const { client, chainId, pythContract, staleAfter } = opts;
  const record: NativeFeedRecord | undefined = nativeFeedFor(chainId);
  const id = opts.priceFeedId ?? record?.pyth?.priceFeedId;

  if (!record?.native) {
    return {
      ok: false,
      attempt: {
        tier: "pyth-hermes",
        address: pythContract,
        outcome: "skipped",
        detail: `chain ${chainId} has no recorded native currency, so an answer could not be scaled`,
      },
    };
  }
  if (!id) {
    return {
      ok: false,
      attempt: {
        tier: "pyth-hermes",
        address: pythContract,
        outcome: "skipped",
        detail: `no verified Pyth price-feed id for ${record.native.symbol}/USD (${record.pythRejection ?? "not surveyed"})`,
      },
    };
  }
  if (!Number.isFinite(staleAfter) || staleAfter <= 0) {
    return {
      ok: false,
      attempt: {
        tier: "pyth-hermes",
        address: pythContract,
        outcome: "skipped",
        detail: `staleAfter must be a positive number of seconds; got ${staleAfter}`,
      },
    };
  }

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  let price: bigint;
  let expo: number;
  let publishTime: number;
  let blockNumber: bigint | null = null;
  try {
    const result = (await client.readContract({
      address: pythContract,
      abi: PYTH_ABI,
      functionName: "getPriceUnsafe",
      args: [id],
    })) as { price: bigint; conf: bigint; expo: number; publishTime: bigint };
    price = BigInt(result.price);
    expo = Number(result.expo);
    publishTime = Number(result.publishTime);
  } catch (e) {
    return {
      ok: false,
      attempt: {
        tier: "pyth-hermes",
        address: pythContract,
        outcome: "error",
        detail: `Pyth ${pythContract} could not be read for ${id}: ${String((e as Error)?.message ?? e).split("\n")[0]}`,
      },
    };
  }
  try {
    blockNumber = await client.getBlockNumber();
  } catch {
    blockNumber = null;
  }

  const refuse = (detail: string, outcome: NativeUsdAttempt["outcome"] = "refused"): PythReadResult => ({
    ok: false,
    attempt: { tier: "pyth-hermes", address: pythContract, outcome, detail },
  });

  if (price <= 0n) return refuse(`Pyth answered ${price} for ${id}, which is not a price`);
  // Pyth's exponent is negative for a fractional scale. A non-negative exponent would mean
  // "multiply by a power of ten", which no USD price feed uses and which this reader has no
  // tested path for — so it is refused rather than handled speculatively.
  if (!Number.isInteger(expo) || expo >= 0 || expo < -36) {
    return refuse(`Pyth reports exponent ${expo} for ${id}; this reader only handles negative exponents down to -36`);
  }
  if (publishTime === 0) return refuse(`Pyth has never had an update posted for ${id} on this chain`);
  if (publishTime > now + FUTURE_SKEW_SECONDS) {
    return refuse(`Pyth reports publishTime ${publishTime}, which is in the future (now ${now})`);
  }
  const ageSeconds = now - publishTime;
  if (ageSeconds > staleAfter) {
    return refuse(
      `the last Pyth update posted on this chain for ${id} is ${ageSeconds} s old; the caller allows ${staleAfter} s. ` +
        `Pyth is a pull oracle: an old on-chain price means nobody has paid to post one, not that Pyth is down.`,
      "stale",
    );
  }

  const caveats = [
    "Pyth is a pull oracle: this is the last update somebody paid to post on this chain, not a continuously maintained value.",
    "The Pyth contract address was supplied by the caller; no Pyth deployment is verified in this SDK.",
  ];
  if (opts.priceFeedId && opts.priceFeedId !== record.pyth?.priceFeedId) {
    caveats.push("Caller-supplied price-feed id; it is not the one verified against Hermes in deployments/nativeFeeds.ts.");
  }
  if (record.native.inferred) {
    caveats.push(`The native currency's decimals are inferred, not read: ${record.native.source}`);
  }
  if (record.testnet) {
    caveats.push(`${record.chainName} is a testnet; this id prices the MAINNET asset.`);
  }

  const description = record.pyth?.hermesSymbol ?? `${record.native.symbol}/USD`;
  const provenance: NativeUsdProvenance = {
    tier: "pyth-hermes",
    source: "Pyth",
    address: pythContract,
    chainId,
    blockNumber,
    updatedAt: publishTime,
    ageSeconds,
    staleAfterSeconds: staleAfter,
    roundId: null,
    description,
    label:
      `Pyth ${description} (${id.slice(0, 10)}…) via ${shortAddress(pythContract)} on ${record.chainName}` +
      (blockNumber === null ? "" : `, block ${blockNumber}`) +
      `, ${ageSeconds} s old`,
    caveats,
  };

  return {
    ok: true,
    quote: {
      ok: true,
      answer: price,
      answerDecimals: -expo,
      nativeSymbol: record.native.symbol,
      nativeDecimals: record.native.decimals,
      provenance,
    },
    attempt: {
      tier: "pyth-hermes",
      address: pythContract,
      outcome: "ok",
      detail: `${description}: ${price} at expo ${expo}, ${ageSeconds} s old`,
    },
  };
}
