// SPDX-License-Identifier: MIT
/* ============================================================================
   Bin prices and bin ids, for turning a typed opening price into an `activeId`.

   A Bin pool has no sqrtPriceX96. Its price is a bin id: core's `PriceHelper`
   defines the price of bin `id` at bin step `s` (basis points) as

       price(id) = (1 + s / 10_000) ^ (id - 2^23)        currency1 per currency0, RAW units

   so id 8,388,608 is a price of exactly 1, each id up multiplies by the step,
   and `getIdFromPrice` is `2^23 + trunc(log2(price) / log2(base))`.

   THESE ARE FLOATS, AND THAT IS FINE HERE. The chain never sees a price: the
   kit takes `activeId`, an integer, and initializes the pool at the price that
   id DEFINES. So the only thing a float can get wrong is which id a typed price
   snaps to, by one, at a bin boundary - and a bin is a `binStep`-wide band that
   the user is choosing in the first place. Always render the price of the
   chosen id (`binLaunchPriceAtId`) rather than the typed one, exactly as a CL
   launch renders its snapped tick.

   Core's own arithmetic (`Uint128x128Math.pow`, 128.128 fixed point) rounds
   differently in the last bits than IEEE doubles do; nothing in this module
   claims to reproduce those bits.
   ============================================================================ */

/** Core's `REAL_ID_SHIFT`: the bin id whose price is exactly 1. */
export const BIN_ID_ONE = 1 << 23;
/** `uint24` ceiling on a bin id. */
export const MAX_BIN_ID = 0xffffff;
const BASIS_POINT_MAX = 10_000;

function assertBinStep(binStep: number): void {
  if (!Number.isInteger(binStep) || binStep < 1 || binStep > 0xffff) {
    throw new RangeError(`binStep must be an integer in [1, 65535], got ${binStep}`);
  }
}

/** `1 + binStep / 10_000`: the price ratio between adjacent bins. */
export function binBase(binStep: number): number {
  assertBinStep(binStep);
  return 1 + binStep / BASIS_POINT_MAX;
}

/** `PriceHelper.getPriceFromId`, as a double: currency1 per currency0 in raw units. */
export function binRawPriceFromId(id: number, binStep: number): number {
  if (!Number.isInteger(id) || id < 0 || id > MAX_BIN_ID) {
    throw new RangeError(`bin id must be an integer in [0, ${MAX_BIN_ID}], got ${id}`);
  }
  return binBase(binStep) ** (id - BIN_ID_ONE);
}

/**
 * `PriceHelper.getIdFromPrice`: the id of the bin whose price band contains
 * `rawPrice` (currency1 per currency0, raw units).
 *
 * Core truncates the log ratio toward zero, so a price inside a band snaps to
 * the band edge nearer to a price of 1: DOWN above 1, UP below it (and a launch
 * token quoted in a stable is almost always below 1 in raw units). A double's
 * log ratio for an exact bin price lands a few ulps either side of the integer,
 * so anything within 1e-9 of an integer snaps to it; the truncation only
 * decides inside a band.
 *
 * @throws RangeError for a non-positive or non-finite price, or one whose bin
 * leaves `uint24`.
 */
export function binIdFromRawPrice(rawPrice: number, binStep: number): number {
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
    throw new RangeError(`rawPrice must be a positive finite number, got ${rawPrice}`);
  }
  const ratio = Math.log(rawPrice) / Math.log(binBase(binStep));
  const nearest = Math.round(ratio);
  const realId = Math.abs(ratio - nearest) < 1e-9 ? nearest : Math.trunc(ratio);
  const id = BIN_ID_ONE + realId;
  if (id < 0 || id > MAX_BIN_ID) {
    throw new RangeError(`a price of ${rawPrice} at bin step ${binStep} is bin ${id}, outside [0, ${MAX_BIN_ID}]`);
  }
  return id;
}

export interface BinLaunchPriceInput {
  /** Whether the launch token sorts first (`launchTokenIsCurrency0` from `computeKitV2LegKey`). */
  readonly launchTokenIsCurrency0: boolean;
  readonly launchDecimals: number;
  readonly quoteDecimals: number;
  /** Whole quote tokens per whole launch token, the direction a human types. */
  readonly quotePerLaunchToken: number;
  readonly binStep: number;
}

function assertDecimals(d: number, name: string): void {
  if (!Number.isInteger(d) || d < 0 || d > 77) throw new RangeError(`${name} must be an integer in [0, 77], got ${d}`);
}

/**
 * The `activeId` for a Bin leg opening at `quotePerLaunchToken`.
 *
 * Folds decimals and token order in: the pool prices currency1 per currency0 in
 * raw units, so a launch token that sorts SECOND needs the reciprocal, exactly
 * as `sqrtPriceForLaunch` does for a CL leg. Render `binLaunchPriceAtId` of the
 * result, not the typed price.
 */
export function binActiveIdForLaunch(input: BinLaunchPriceInput): number {
  assertDecimals(input.launchDecimals, "launchDecimals");
  assertDecimals(input.quoteDecimals, "quoteDecimals");
  if (!Number.isFinite(input.quotePerLaunchToken) || input.quotePerLaunchToken <= 0) {
    throw new RangeError(`quotePerLaunchToken must be a positive finite number, got ${input.quotePerLaunchToken}`);
  }
  // quote per launch, human -> raw: x * 10^quoteDecimals / 10^launchDecimals
  const rawQuotePerLaunch = input.quotePerLaunchToken * 10 ** (input.quoteDecimals - input.launchDecimals);
  const rawPrice = input.launchTokenIsCurrency0 ? rawQuotePerLaunch : 1 / rawQuotePerLaunch;
  return binIdFromRawPrice(rawPrice, input.binStep);
}

/**
 * The opening price bin `activeId` DEFINES, back in the human direction: whole
 * quote tokens per whole launch token. This is the number to show.
 */
export function binLaunchPriceAtId(
  activeId: number,
  input: Omit<BinLaunchPriceInput, "quotePerLaunchToken">,
): number {
  assertDecimals(input.launchDecimals, "launchDecimals");
  assertDecimals(input.quoteDecimals, "quoteDecimals");
  const raw = binRawPriceFromId(activeId, input.binStep);
  const rawQuotePerLaunch = input.launchTokenIsCurrency0 ? raw : 1 / raw;
  return rawQuotePerLaunch * 10 ** (input.launchDecimals - input.quoteDecimals);
}
