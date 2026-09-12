// SPDX-License-Identifier: MIT
/* ============================================================================
   `sqrtPriceX96`, computed rather than guessed.

   WHY THIS FILE EXISTS. `LaunchParams.sqrtPriceX96` in `LaunchpadKit` carries
   this docstring:

       "Opening price, as sqrt(price) in Q64.96, where 'price' is currency1 per
        currency0 AFTER sorting. Use the SDK's `sqrtPriceForLaunch` rather than
        computing this by hand: get it wrong and the pool opens at a price
        nobody wants, which cannot be undone."

   That function did not exist. The contract pointed integrators at a safety
   rail the SDK never shipped, for the one parameter whose mistakes are
   PERMANENT — `initialize` fixes the opening price and no owner, timelock or
   governance action can revise it afterwards.

   THREE TRAPS, and every one of them is silent:

   1. DECIMALS. `sqrtPriceX96` encodes a ratio of RAW units, not human ones. On
      Robinhood, USDG is 6 decimals and WETH is 18. A price computed as though
      both were 18 is wrong by 10^12 — a pool opened at a million times the
      intended price, which looks like a working pool until somebody trades it.
      This repo has already caught that trap twice.

   2. SORTING. `currency0` is the LOWER address, decided by a byte comparison
      that has nothing to do with which token you think of as "the price". If
      your launch token sorts second, the pool's price is QUOTE per LAUNCH
      inverted, and a caller who ignores that opens at 1/p.

   3. FLOATS. `Math.sqrt` on an IEEE-754 double has ~15 significant digits.
      `sqrtPriceX96` needs up to 49. Every function here takes exact input
      (a decimal STRING or a bigint ratio) and computes in bigint throughout;
      nothing in this module converts through `number`.

   The output is floor-rounded, which is deliberate and documented per
   function: a price one ulp low is a price, whereas a rounding scheme that
   drifts is a bug you find in production.
   ============================================================================ */

import type { Address } from "viem";

/** 2^96. The Q64.96 scaling factor `sqrtPriceX96` is expressed in. */
export const Q96 = 1n << 96n;

/** 2^192, i.e. `Q96 ** 2`. Squaring a Q64.96 value lands here. */
export const Q192 = 1n << 192n;

/**
 * Bounds from `TickMath` in the core contracts. A `sqrtPriceX96` outside this
 * range reverts at `initialize`, so it is checked HERE rather than discovered
 * as an opaque revert after a gas estimate.
 *
 * Verified against `packages/core/src/pool-cl/libraries/TickMath.sol` by
 * `test/launchpadPrice.test.ts`.
 */
export const MIN_SQRT_RATIO = 4295128739n;
/** @see MIN_SQRT_RATIO */
export const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;

/** Thrown when a price cannot be represented, rather than silently clamped. */
export class PriceOutOfRangeError extends Error {
  constructor(
    readonly sqrtPriceX96: bigint,
    readonly humanPrice: string,
  ) {
    super(
      `sqrtPriceX96 ${sqrtPriceX96} is outside TickMath's range ` +
        `[${MIN_SQRT_RATIO}, ${MAX_SQRT_RATIO}] — the price ${humanPrice} cannot be represented ` +
        `by a pool. This usually means the decimals are wrong by several orders of magnitude.`,
    );
    this.name = "PriceOutOfRangeError";
  }
}

/** Thrown for input that is not an exact decimal. */
export class InvalidPriceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPriceError";
  }
}

/**
 * An exact non-negative rational, always in LOWEST TERMS.
 *
 * Canonical form is part of the contract: `2.5e6` and `2500000` produce the
 * identical object, so two prices that are equal compare equal, and the
 * intermediate values in `sqrtPriceX96FromRatio` stay as small as the maths
 * allows. Both fields are positive and `denominator` is never zero.
 */
export interface Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

/** Greatest common divisor, Euclid. Both arguments must be non-negative. */
function gcd(a: bigint, b: bigint): bigint {
  let x = a;
  let y = b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/** Reduces to lowest terms. See {@link Rational}. */
function reduce(numerator: bigint, denominator: bigint): Rational {
  const g = gcd(numerator, denominator);
  return { numerator: numerator / g, denominator: denominator / g };
}

/**
 * Parses a decimal string into an exact rational. No floating point anywhere.
 *
 * Accepts `"1"`, `"0.30"`, `"1234.5678"`, `"1e-9"`, `"2.5e6"`. Rejects
 * anything else — including a JavaScript `number`, which callers must stringify
 * themselves so the lossy step is visible in their code rather than hidden in
 * ours. `0.1 + 0.2` is the reason.
 *
 * @throws {InvalidPriceError} on a malformed, negative or zero price.
 */
export function parseDecimal(value: string): Rational {
  const trimmed = value.trim();
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(trimmed);
  if (!match) {
    throw new InvalidPriceError(
      `"${value}" is not a plain decimal. Use "0.0042" or "4.2e-3"; pass a string, not a number.`,
    );
  }
  const whole = match[1] ?? "0";
  const frac = match[2] ?? "";
  const exp = match[3] === undefined ? 0 : Number.parseInt(match[3], 10);

  let numerator = BigInt(whole + frac);
  let denominator = 10n ** BigInt(frac.length);

  if (exp > 0) numerator *= 10n ** BigInt(exp);
  else if (exp < 0) denominator *= 10n ** BigInt(-exp);

  if (numerator === 0n) {
    throw new InvalidPriceError(`Price must be greater than zero, got "${value}".`);
  }
  return reduce(numerator, denominator);
}

/**
 * Integer square root, floor. Newton's method on bigints.
 *
 * Used instead of `Math.sqrt` because the radicand here is up to 2^256 and a
 * double carries about 53 bits of mantissa. The loop converges in O(log n) and
 * the final adjustment guarantees `result^2 <= n < (result+1)^2` exactly.
 */
export function bigintSqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError("bigintSqrt of a negative number");
  if (n < 2n) return n;

  // Seed with a power of two at half the bit length: cheap and always above the root.
  let x = 1n << (BigInt(n.toString(2).length) / 2n + 1n);
  for (;;) {
    const next = (x + n / x) >> 1n;
    if (next >= x) break;
    x = next;
  }
  // Newton from above lands on the floor or one high; correct unconditionally.
  while (x * x > n) x -= 1n;
  while ((x + 1n) * (x + 1n) <= n) x += 1n;
  return x;
}

/**
 * `sqrtPriceX96` for an exact RAW-unit ratio of currency1 to currency0.
 *
 * This is the primitive; every other function here is a wrapper that works out
 * what the ratio should be. Callers holding raw amounts (from a quote, a
 * reserve reading, an existing pool) want this one.
 *
 * Rounds DOWN. The error is at most one ulp of Q64.96, which is ~2^-96 in
 * price terms — many orders of magnitude below anything a pool can express.
 */
export function sqrtPriceX96FromRatio(ratio: Rational): bigint {
  if (ratio.denominator <= 0n || ratio.numerator <= 0n) {
    throw new InvalidPriceError("ratio must have a positive numerator and denominator");
  }
  // sqrt(num/den) * 2^96 == sqrt(num * 2^192 / den), and doing the shift BEFORE
  // the division keeps every bit of precision the result can hold.
  return bigintSqrt((ratio.numerator * Q192) / ratio.denominator);
}

/** Input for a price stated in human units. */
export interface PriceInput {
  /**
   * How many whole currency1 one whole currency0 buys, as an exact decimal
   * STRING. "1500" means one currency0 is worth 1500 currency1.
   */
  readonly price: string;
  /** Decimals of currency0 — the LOWER-addressed token. Read it off the contract. */
  readonly decimals0: number;
  /** Decimals of currency1 — the HIGHER-addressed token. Read it off the contract. */
  readonly decimals1: number;
}

/**
 * `sqrtPriceX96` from a human-readable price, correcting for decimals.
 *
 * ```ts
 * // One WETH (18) is worth 1500 USDG (6), and USDG sorts first:
 * sqrtPriceX96FromPrice({ price: "1500", decimals0: 6, decimals1: 18 })
 * ```
 *
 * The decimals correction is the whole point: the raw ratio is
 * `price * 10^decimals1 / 10^decimals0`, and omitting it is the 10^12 error.
 *
 * @throws {PriceOutOfRangeError} if the result cannot be represented by a pool.
 */
export function sqrtPriceX96FromPrice(input: PriceInput): bigint {
  assertDecimals(input.decimals0, "decimals0");
  assertDecimals(input.decimals1, "decimals1");

  const p = parseDecimal(input.price);
  const ratio: Rational = {
    numerator: p.numerator * 10n ** BigInt(input.decimals1),
    denominator: p.denominator * 10n ** BigInt(input.decimals0),
  };
  const sqrtPriceX96 = sqrtPriceX96FromRatio(ratio);
  if (sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 > MAX_SQRT_RATIO) {
    throw new PriceOutOfRangeError(sqrtPriceX96, input.price);
  }
  return sqrtPriceX96;
}

/**
 * The inverse: a human price back out of a `sqrtPriceX96`.
 *
 * For DISPLAY and for the confirm-before-you-broadcast step. Returns a decimal
 * string with `precision` fractional digits, truncated (never rounded up, so a
 * displayed price is never larger than the real one).
 *
 * Round-tripping is lossy in the last digit by construction — `sqrtPriceX96` is
 * a floor of a square root. Use it to CHECK a price a human typed, not to
 * recompute one.
 */
export function priceFromSqrtPriceX96(
  sqrtPriceX96: bigint,
  decimals0: number,
  decimals1: number,
  precision = 18,
): string {
  assertDecimals(decimals0, "decimals0");
  assertDecimals(decimals1, "decimals1");
  if (sqrtPriceX96 <= 0n) throw new InvalidPriceError("sqrtPriceX96 must be positive");

  const scale = 10n ** BigInt(precision);
  // price = (sqrt^2 / 2^192) * 10^d0 / 10^d1, scaled up so we can slice digits.
  const scaled =
    (sqrtPriceX96 * sqrtPriceX96 * 10n ** BigInt(decimals0) * scale) /
    (Q192 * 10n ** BigInt(decimals1));

  const whole = scaled / scale;
  const frac = scaled % scale;
  if (precision === 0) return whole.toString();
  const fracStr = frac.toString().padStart(precision, "0").replace(/0+$/, "");
  return fracStr.length > 0 ? `${whole}.${fracStr}` : whole.toString();
}

/** What a launch needs to know about its own pair, once sorting is resolved. */
export interface LaunchPrice {
  /** Pass straight into `LaunchParams.sqrtPriceX96`. */
  readonly sqrtPriceX96: bigint;
  /** The lower-addressed token — `poolKey.currency0`. */
  readonly currency0: Address;
  /** The higher-addressed token — `poolKey.currency1`. */
  readonly currency1: Address;
  /**
   * True when the launch token sorted first. `LaunchGuardHook` needs this to
   * know which direction of a swap is a BUY, and the kit derives it the same
   * way — this field is here so a UI can display the same fact.
   */
  readonly launchTokenIsCurrency0: boolean;
  /**
   * The pool-facing price (currency1 per currency0) implied by the above, as a
   * decimal string. SHOW THIS TO A HUMAN BEFORE BROADCASTING. If the launch
   * token sorted second, this is the reciprocal of the price you passed in,
   * and that is exactly the moment to notice.
   */
  readonly poolPrice: string;
}

/** Input for the launch-shaped wrapper. */
export interface LaunchPriceInput {
  readonly launchToken: Address;
  /** `0x0000…0000` for the chain's native asset, which always sorts first. */
  readonly quoteToken: Address;
  readonly launchDecimals: number;
  readonly quoteDecimals: number;
  /**
   * The opening price in the direction a human thinks in: how many whole QUOTE
   * tokens one whole LAUNCH token costs. Exact decimal string.
   */
  readonly quotePerLaunchToken: string;
}

/**
 * The function `LaunchpadKit` tells you to use. Handles sorting and decimals,
 * and hands back everything needed to check the result before it is permanent.
 *
 * ```ts
 * const p = sqrtPriceForLaunch({
 *   launchToken: "0xMyToken…",
 *   quoteToken: usdg.address,
 *   launchDecimals: 18,
 *   quoteDecimals: 6,          // NOT 18. Read it off the contract.
 *   quotePerLaunchToken: "0.05",
 * })
 * // p.poolPrice is what the pool will actually hold — print it and confirm.
 * ```
 */
export function sqrtPriceForLaunch(input: LaunchPriceInput): LaunchPrice {
  const launch = input.launchToken.toLowerCase() as Address;
  const quote = input.quoteToken.toLowerCase() as Address;
  if (launch === quote) {
    throw new InvalidPriceError(
      "launchToken and quoteToken are the same address; the kit reverts with IdenticalCurrencies",
    );
  }

  // Same byte comparison the PoolKey uses. Lowercased above so casing cannot change the order.
  const launchTokenIsCurrency0 = launch < quote;

  const p = parseDecimal(input.quotePerLaunchToken);

  /* The pool's price is ALWAYS currency1 per currency0. When the launch token
     sorts first that is quote-per-launch, exactly what the caller gave us; when
     it sorts second the pool wants launch-per-quote, so the rational flips.
     Flipping the exact rational — rather than dividing — keeps this lossless. */
  const priceRational: Rational = launchTokenIsCurrency0
    ? p
    : { numerator: p.denominator, denominator: p.numerator }; // already coprime, so still reduced

  const decimals0 = launchTokenIsCurrency0 ? input.launchDecimals : input.quoteDecimals;
  const decimals1 = launchTokenIsCurrency0 ? input.quoteDecimals : input.launchDecimals;
  assertDecimals(decimals0, "decimals0");
  assertDecimals(decimals1, "decimals1");

  const ratio: Rational = {
    numerator: priceRational.numerator * 10n ** BigInt(decimals1),
    denominator: priceRational.denominator * 10n ** BigInt(decimals0),
  };
  const sqrtPriceX96 = sqrtPriceX96FromRatio(ratio);
  if (sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 > MAX_SQRT_RATIO) {
    throw new PriceOutOfRangeError(sqrtPriceX96, input.quotePerLaunchToken);
  }

  return {
    sqrtPriceX96,
    currency0: (launchTokenIsCurrency0 ? input.launchToken : input.quoteToken) as Address,
    currency1: (launchTokenIsCurrency0 ? input.quoteToken : input.launchToken) as Address,
    launchTokenIsCurrency0,
    poolPrice: priceFromSqrtPriceX96(sqrtPriceX96, decimals0, decimals1),
  };
}

function assertDecimals(d: number, name: string): void {
  if (!Number.isInteger(d) || d < 0 || d > 36) {
    throw new InvalidPriceError(
      `${name} must be an integer in [0, 36], got ${d}. Read it from the token's decimals().`,
    );
  }
}
