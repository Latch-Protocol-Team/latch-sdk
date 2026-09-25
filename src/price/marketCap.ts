// SPDX-License-Identifier: MIT
/**
 * Market cap <-> opening price, both directions, in exact integer arithmetic.
 *
 * WHY THIS EXISTS, AND WHY IT IS ITS OWN FILE WITH NO I/O
 * -------------------------------------------------------
 * The launch wizard is market-cap-first (CLAUDE.md, owner decision 2026-09-20): a creator
 * says "$3,500" and the kit needs a price per token. The creator trap the decision names is
 * arithmetic, not UX — "a 5 ETH cap on a 1e9 supply means typing `0.000000005`. One zero out
 * is 10x, permanent, and the LP is locked forever." A function that gets that conversion
 * wrong is worse than no function, so this file has no network, no clock and no config: it
 * is testable to the last unit and it is tested that way.
 *
 * EVERYTHING IS A BIGINT. Not one intermediate is a `number`. `3500 / 1e9 * 1e18` in double
 * precision is off in the fifteenth digit, and fifteen digits is exactly the range a
 * 1e9-supply launch on an 18-decimal quote lands in. `Number` appears in this file only as
 * a DECIMALS COUNT, never as a value.
 *
 * WHAT "PRICE" MEANS HERE, stated once because every off-by-10^18 starts with this
 * -------------------------------------------------------------------------------
 * `price` is RAW QUOTE UNITS PER ONE WHOLE TOKEN — the quote-currency amount, in the
 * quote's own smallest unit, that buys 10 ** tokenDecimals raw units of the launch token.
 *
 *   ETH quote, 18-decimal token, price 5_000_000_000n
 *     = 5e9 wei per whole token
 *     = 0.000000005 ETH per token, the exact figure CLAUDE.md warns creators mistype.
 *
 * It is deliberately NOT "whole quote per whole token" (that is a decimal and this file
 * has none) and NOT "raw quote per raw token" (that loses all precision the moment the two
 * decimals differ, which they do on every USDG and USDC pair).
 *
 * ROUNDING, AND WHY THE DEFAULT IS DOWN
 * --------------------------------------
 * `openingPriceFromMarketCap` rounds DOWN by default, so the resulting market cap is at or
 * below the target the creator was shown. A creator told "$3,500" who gets $3,499.99 has
 * been told the truth; one who gets $3,500.01 has not. The error is at most one raw quote
 * unit of price, which on any real supply is many orders of magnitude below the tick or bin
 * the kit will snap the price to anyway — the snap is what actually moves the opening cap,
 * and it is why this function's job is to be exactly defined rather than exactly optimal.
 *
 * `marketCapFromOpeningPrice` also rounds DOWN by default, for the same display reason.
 *
 * ROUND-TRIPPING IS NOT EXACT AND MUST NOT BE ASSUMED. With both defaults,
 * `marketCapFromOpeningPrice(openingPriceFromMarketCap(t)) <= t`, with equality only when
 * the division happened to be exact. A UI that shows the target and then shows the
 * round-tripped cap will occasionally show two numbers that differ in the last digit; show
 * the round-tripped one, because that is what the pool will actually open at.
 *
 * NONE OF THIS SNAPS TO A TICK OR A BIN. `kitV2/binPrice.ts` and the CL range maths do
 * that, and they move the price by far more than the rounding here. The order is: choose a
 * cap, convert to a price with this file, snap with the kit's maths, then show the SNAPPED
 * price and the cap it implies — never the unsnapped one.
 */

/** A USD amount as an exact integer: `amount / 10 ** decimals` dollars. */
export interface UsdAmount {
  readonly amount: bigint;
  readonly decimals: number;
}

/**
 * A native/USD rate as the feed itself reports it: `answer / 10 ** answerDecimals` dollars
 * per ONE WHOLE unit of the native currency.
 *
 * Deliberately the feed's own shape rather than a float, so nothing between the aggregator
 * and the price a creator signs has been through binary floating point.
 */
export interface NativeUsdRate {
  readonly answer: bigint;
  readonly answerDecimals: number;
}

export type RoundingMode = "down" | "up";

export interface OpeningPriceFromMarketCapInput {
  /** The opening market cap the creator chose, e.g. $3,500. */
  readonly usdTarget: UsdAmount;
  /** The launch token's total supply, in RAW token units. */
  readonly totalSupply: bigint;
  readonly tokenDecimals: number;
  /** Dollars per whole unit of the QUOTE currency. For a native-quoted pool, native/USD. */
  readonly quoteUsd: NativeUsdRate;
  /** Decimals of the quote currency: 18 for native and WETH, 6 for USDG and USDC. */
  readonly quoteDecimals: number;
  /** Default `"down"`. See the header. */
  readonly rounding?: RoundingMode | undefined;
}

export interface MarketCapFromOpeningPriceInput {
  /** Raw quote units per ONE WHOLE token. See the header. */
  readonly price: bigint;
  readonly totalSupply: bigint;
  readonly tokenDecimals: number;
  readonly quoteUsd: NativeUsdRate;
  readonly quoteDecimals: number;
  /** Decimals the answer is wanted in. Default 2, i.e. cents. */
  readonly usdDecimals?: number | undefined;
  /** Default `"down"`. */
  readonly rounding?: RoundingMode | undefined;
}

export interface OpeningPriceFromNativeCapInput {
  /** The opening market cap in RAW quote units (e.g. wei), for chains with no USD source. */
  readonly quoteTarget: bigint;
  readonly totalSupply: bigint;
  readonly tokenDecimals: number;
  readonly rounding?: RoundingMode | undefined;
}

/* ------------------------------------------------------------------ guards */

function assertDecimals(name: string, d: number): void {
  if (!Number.isInteger(d) || d < 0 || d > 36) {
    throw new RangeError(`${name} must be an integer in [0, 36]; got ${d}`);
  }
}

function assertPositive(name: string, v: bigint): void {
  if (v <= 0n) throw new RangeError(`${name} must be positive; got ${v}`);
}

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

/** Exact when it divides; otherwise toward zero or away from it, as asked. */
function divide(numerator: bigint, denominator: bigint, rounding: RoundingMode): bigint {
  const q = numerator / denominator;
  if (rounding === "down") return q;
  return q * denominator === numerator ? q : q + 1n;
}

/* ------------------------------------------------------------- conversions */

/**
 * The opening price that makes `totalSupply` worth `usdTarget`.
 *
 *   price = usdTarget * 10^(tokenDecimals + quoteDecimals + answerDecimals)
 *           / (totalSupply * answer * 10^usdDecimals)
 *
 * which is just `usd / (supply * usdPerQuote)` with every scale written out. Numerator and
 * denominator are each assembled in full before the single division, so there is exactly
 * one rounding step in the whole calculation and it is the one the caller asked for.
 *
 * @returns raw quote units per ONE WHOLE token. Can be `0n`, and a `0n` is a real answer,
 * not a failure: a $3,500 cap on a 1e30 supply quoted in 6-decimal USDG genuinely is below
 * one raw unit per token. A caller must treat `0n` as "this cap is unrepresentable at this
 * supply" and say so, because a pool cannot open at a price of zero.
 * @throws RangeError on a non-positive supply or rate, or an out-of-range decimals count.
 */
export function openingPriceFromMarketCap(input: OpeningPriceFromMarketCapInput): bigint {
  const { usdTarget, totalSupply, tokenDecimals, quoteUsd, quoteDecimals } = input;
  assertDecimals("tokenDecimals", tokenDecimals);
  assertDecimals("quoteDecimals", quoteDecimals);
  assertDecimals("usdTarget.decimals", usdTarget.decimals);
  assertDecimals("quoteUsd.answerDecimals", quoteUsd.answerDecimals);
  assertPositive("totalSupply", totalSupply);
  assertPositive("quoteUsd.answer", quoteUsd.answer);
  if (usdTarget.amount < 0n) throw new RangeError(`usdTarget.amount must not be negative; got ${usdTarget.amount}`);

  const numerator = usdTarget.amount * pow10(tokenDecimals + quoteDecimals + quoteUsd.answerDecimals);
  const denominator = totalSupply * quoteUsd.answer * pow10(usdTarget.decimals);
  return divide(numerator, denominator, input.rounding ?? "down");
}

/**
 * The market cap a given opening price implies — the inverse, for the creator who types a
 * price and wants to see what it is worth.
 *
 *   usd = price * totalSupply * answer * 10^usdDecimals
 *         / 10^(tokenDecimals + quoteDecimals + answerDecimals)
 *
 * @returns a {@link UsdAmount} in `usdDecimals` (default 2, i.e. cents).
 */
export function marketCapFromOpeningPrice(input: MarketCapFromOpeningPriceInput): UsdAmount {
  const { price, totalSupply, tokenDecimals, quoteUsd, quoteDecimals } = input;
  const usdDecimals = input.usdDecimals ?? 2;
  assertDecimals("tokenDecimals", tokenDecimals);
  assertDecimals("quoteDecimals", quoteDecimals);
  assertDecimals("usdDecimals", usdDecimals);
  assertDecimals("quoteUsd.answerDecimals", quoteUsd.answerDecimals);
  assertPositive("totalSupply", totalSupply);
  assertPositive("quoteUsd.answer", quoteUsd.answer);
  if (price < 0n) throw new RangeError(`price must not be negative; got ${price}`);

  const numerator = price * totalSupply * quoteUsd.answer * pow10(usdDecimals);
  const denominator = pow10(tokenDecimals + quoteDecimals + quoteUsd.answerDecimals);
  return { amount: divide(numerator, denominator, input.rounding ?? "down"), decimals: usdDecimals };
}

/**
 * The same conversion with no dollars in it, for a chain with no native/USD source.
 *
 *   price = quoteTarget * 10^tokenDecimals / totalSupply
 *
 * This is tier 4's arithmetic and it is exact in the same way: a creator on a chain Latch
 * cannot price says "5 ETH" instead of "$3,500" and gets a price with no oracle anywhere in
 * the path. The UI shows the native figure and NO dollar figure — never a converted one.
 */
export function openingPriceFromNativeMarketCap(input: OpeningPriceFromNativeCapInput): bigint {
  const { quoteTarget, totalSupply, tokenDecimals } = input;
  assertDecimals("tokenDecimals", tokenDecimals);
  assertPositive("totalSupply", totalSupply);
  if (quoteTarget < 0n) throw new RangeError(`quoteTarget must not be negative; got ${quoteTarget}`);
  return divide(quoteTarget * pow10(tokenDecimals), totalSupply, input.rounding ?? "down");
}

/** The inverse of {@link openingPriceFromNativeMarketCap}: raw quote units of market cap. */
export function nativeMarketCapFromOpeningPrice(input: {
  readonly price: bigint;
  readonly totalSupply: bigint;
  readonly tokenDecimals: number;
  readonly rounding?: RoundingMode | undefined;
}): bigint {
  assertDecimals("tokenDecimals", input.tokenDecimals);
  assertPositive("totalSupply", input.totalSupply);
  if (input.price < 0n) throw new RangeError(`price must not be negative; got ${input.price}`);
  return divide(input.price * input.totalSupply, pow10(input.tokenDecimals), input.rounding ?? "down");
}

/* ------------------------------------------------------------- formatting */

/**
 * A {@link UsdAmount} as a plain decimal string, e.g. `"3500.00"`.
 *
 * String formatting, not arithmetic: no `Number` is constructed, so a cap larger than
 * 2^53 cents still prints every digit. Negative amounts are not produced by anything in
 * this file and are formatted correctly anyway rather than silently mangled.
 */
export function formatUsdAmount(usd: UsdAmount): string {
  assertDecimals("usd.decimals", usd.decimals);
  const negative = usd.amount < 0n;
  const digits = (negative ? -usd.amount : usd.amount).toString().padStart(usd.decimals + 1, "0");
  const whole = digits.slice(0, digits.length - usd.decimals);
  const frac = usd.decimals === 0 ? "" : `.${digits.slice(digits.length - usd.decimals)}`;
  return `${negative ? "-" : ""}${whole}${frac}`;
}

/**
 * A dollars-and-cents {@link UsdAmount} from a whole number of dollars.
 *
 * `usdWholeDollars(3500)` is the $3.5K default. It takes a `number` because a default from
 * a config file is a `number`, and it refuses a non-integer rather than rounding one: a
 * caller with cents should build the {@link UsdAmount} itself and say what scale it is in.
 */
export function usdWholeDollars(dollars: number): UsdAmount {
  if (!Number.isInteger(dollars)) {
    throw new RangeError(`usdWholeDollars takes whole dollars; got ${dollars}. Build a UsdAmount directly for cents.`);
  }
  return { amount: BigInt(dollars) * 100n, decimals: 2 };
}

/**
 * The launch wizard's default opening market cap: $3,500.
 *
 * Owner decision, 2026-09-20 — "market-cap-first, defaulting to $3.5K-equivalent, on every
 * chain Latch deploys to and in every launchpad built on the kit". It is a DEFAULT a human
 * reviews, never a value any contract enforces, and on a chain with no native/USD source it
 * is not used at all: that chain defaults in native units and shows no dollars.
 */
export const DEFAULT_OPENING_MARKET_CAP_USD: UsdAmount = Object.freeze({ amount: 350_000n, decimals: 2 });
