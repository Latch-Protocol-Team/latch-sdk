// SPDX-License-Identifier: MIT
/**
 * Currencies.
 *
 * A currency is just an address. The zero address is reserved for the chain's
 * native asset, so a single type covers both ERC-20 tokens and native value
 * without a wrapper contract.
 */

import { getAddress, isAddress, type Address } from "viem";

/** An asset tradable by the protocol: an ERC-20 address, or {@link NATIVE_CURRENCY}. */
export type Currency = Address;

/** Sentinel address representing the chain's native asset. */
export const NATIVE_CURRENCY: Currency = "0x0000000000000000000000000000000000000000";

/** True when `currency` refers to the chain's native asset. */
export function isNativeCurrency(currency: Currency): boolean {
  return currency.toLowerCase() === NATIVE_CURRENCY;
}

/** Case-insensitive equality for two currency addresses. */
export function currenciesEqual(a: Currency, b: Currency): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Numeric value of an address, for ordering comparisons. */
function addressValue(currency: Currency): bigint {
  return BigInt(currency);
}

/**
 * Compares two currencies the way the protocol does: as unsigned integers.
 *
 * @returns a negative number if `a` sorts first, positive if `b` does, `0` if equal.
 */
export function compareCurrencies(a: Currency, b: Currency): number {
  const av = addressValue(a);
  const bv = addressValue(b);
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

/**
 * Orders a pair so it can be used as `currency0` / `currency1` in a pool key.
 *
 * A pool key is only canonical when its currencies are sorted ascending, so
 * always run user input through this before hashing a key or looking a pool up.
 *
 * @throws if the two currencies are identical.
 */
export function sortCurrencies(a: Currency, b: Currency): [Currency, Currency] {
  const cmp = compareCurrencies(a, b);
  if (cmp === 0) {
    throw new Error(`sortCurrencies: currencies must differ (both are ${a})`);
  }
  return cmp < 0 ? [a, b] : [b, a];
}

/** True when the pair is already in canonical (ascending) order. */
export function currenciesAreSorted(currency0: Currency, currency1: Currency): boolean {
  return compareCurrencies(currency0, currency1) < 0;
}

/**
 * Normalises an address to its EIP-55 checksummed form.
 *
 * @throws if the input is not a well-formed address.
 */
export function toCurrency(value: string): Currency {
  if (!isAddress(value)) {
    throw new Error(`toCurrency: not a valid address: ${value}`);
  }
  return getAddress(value);
}
