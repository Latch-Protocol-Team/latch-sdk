// SPDX-License-Identifier: MIT
/* ============================================================================
   Token lists, in the Uniswap Token Lists standard (`@uniswap/token-lists`,
   schema `https://uniswap.org/tokenlist.schema.json`).

   The types below are the schema's shape, written out so a consumer of this
   MIT package needs no other dependency to read or build one. Everything the
   schema constrains (patterns, lengths, depth of `extensions`) is enforced by
   `validateTokenList`, never assumed by the types.

   Latch adds two documented extension shapes on a token:

     extensions.stock  { issuer, ticker, rebasing, controls?, verifiedAt? }
                       a tokenised stock. THE LIST IS THE RUNTIME SOURCE OF
                       TRUTH for "this token is a stock" (owner decision,
                       2026-09-18): a stock is added by a list release, never
                       by an SDK deploy. The SDK's registry
                       (`deployments/stocks.ts`) is the generator's input and
                       the offline fallback; `resolveStockTokens` merges the two.
     extensions.latch  { launchpad, token }           a token minted by a
                       LaunchpadKitV2 launch (`launchedTokenList`)

   Both are optional and a list without them is still a Latch list.
   ============================================================================ */

/** `version` — semver as three non-negative integers. */
export interface TokenListVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** A leaf value inside `extensions`. */
export type TokenListExtensionPrimitive = string | number | boolean | null;

/** `extensions` values nest at most three objects deep (the schema's `ExtensionValueInner*`). */
export type TokenListExtensionValue =
  | TokenListExtensionPrimitive
  | { readonly [key: string]: TokenListExtensionPrimitive | { readonly [key: string]: TokenListExtensionPrimitive | { readonly [key: string]: TokenListExtensionPrimitive } } };

export interface TokenListExtensions {
  readonly [key: string]: TokenListExtensionValue;
}

/** One token as the standard describes it. */
export interface TokenListToken {
  readonly chainId: number;
  readonly address: string;
  readonly decimals: number;
  readonly name: string;
  readonly symbol: string;
  readonly logoURI?: string;
  readonly tags?: readonly string[];
  readonly extensions?: TokenListExtensions;
}

export interface TokenListTagDefinition {
  readonly name: string;
  readonly description: string;
}

/** A token list document. */
export interface TokenList {
  readonly name: string;
  /** ISO 8601 date-time. */
  readonly timestamp: string;
  readonly version: TokenListVersion;
  readonly tokens: readonly TokenListToken[];
  readonly tokenMap?: { readonly [chainIdAndAddress: string]: TokenListToken };
  readonly keywords?: readonly string[];
  readonly tags?: { readonly [tagId: string]: TokenListTagDefinition };
  readonly logoURI?: string;
  /**
   * Not in the schema's property list, but the schema does not forbid extra
   * root properties. The Latch lists write `extensions.latch` here:
   * `{ chainId, verifiedOnChain }`, the second `false` when the generator ran
   * `--offline` and could not re-read decimals, symbol and name on chain.
   */
  readonly extensions?: TokenListExtensions;
}

/**
 * `extensions.stock.controls`: the issuer's control surface, mirrored from
 * `StockTokenControls` in `deployments/stocks.ts`. `true` = the power exists
 * or could not be ruled out; `false` = proven absent (by verified source or
 * an on-chain read). A list entry without it is still a stock, with every
 * power assumed present (the safe direction for a reader).
 */
export interface TokenListStockControls {
  readonly pause: boolean;
  readonly blocklist: boolean;
  readonly allowlist: boolean;
  readonly issuerBurn: boolean;
  readonly upgradeable: boolean;
  readonly uiMultiplier: boolean;
  readonly rebasing: boolean;
}

export const TOKEN_LIST_STOCK_CONTROL_KEYS: readonly (keyof TokenListStockControls)[] = [
  "pause",
  "blocklist",
  "allowlist",
  "issuerBurn",
  "upgradeable",
  "uiMultiplier",
  "rebasing",
];

/** `extensions.stock`, as the Latch lists write it. */
export interface TokenListStockExtension {
  readonly issuer: string;
  readonly ticker: string;
  /** `true` when `balanceOf` itself is rescaled by the issuer — not usable as a pool currency in the Infinity Vault. */
  readonly rebasing: boolean;
  /** The control surface; `null` when the list entry carries none (an older list, or a hand-added entry). */
  readonly controls: TokenListStockControls | null;
  /** ISO day (UTC) the entry's reads were made, when the list records it. */
  readonly verifiedAt: string | null;
}

/** `extensions.latch`, as `launchedTokenList` writes it. */
export interface TokenListLatchExtension {
  /** The pad (tenant) the launch ran under, or `null` for a direct launch. */
  readonly launchpad: string | null;
  /** The launch token. Equal to `address`; carried so a merged list keeps the provenance. */
  readonly token: string;
}

/** `extensions.stock` of a token when it is well-formed, else `null`. */
export function stockExtensionOf(token: TokenListToken): TokenListStockExtension | null {
  const raw = token.extensions?.["stock"];
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as { readonly [key: string]: unknown };
  const issuer = r["issuer"];
  const ticker = r["ticker"];
  const rebasing = r["rebasing"];
  if (typeof issuer !== "string" || typeof ticker !== "string" || typeof rebasing !== "boolean") return null;
  const rawControls = r["controls"];
  let controls: TokenListStockControls | null = null;
  if (typeof rawControls === "object" && rawControls !== null) {
    const c = rawControls as { readonly [key: string]: unknown };
    if (TOKEN_LIST_STOCK_CONTROL_KEYS.every((k) => typeof c[k] === "boolean")) {
      controls = {
        pause: c["pause"] as boolean,
        blocklist: c["blocklist"] as boolean,
        allowlist: c["allowlist"] as boolean,
        issuerBurn: c["issuerBurn"] as boolean,
        upgradeable: c["upgradeable"] as boolean,
        uiMultiplier: c["uiMultiplier"] as boolean,
        /* The entry's own `rebasing` is the flag a consumer reads; a `controls.rebasing`
           that says more is kept (fail safe), one that says less is not believed. */
        rebasing: (c["rebasing"] as boolean) || rebasing,
      };
    }
  }
  const verifiedAt = r["verifiedAt"];
  return {
    issuer,
    ticker,
    rebasing: rebasing || (controls?.rebasing ?? false),
    controls,
    verifiedAt: typeof verifiedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(verifiedAt) ? verifiedAt : null,
  };
}

/** `extensions.latch` of a token when it is well-formed, else `null`. */
export function latchExtensionOf(token: TokenListToken): TokenListLatchExtension | null {
  const raw = token.extensions?.["latch"];
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as { readonly [key: string]: unknown };
  const launchpad = r["launchpad"];
  const tokenAddr = r["token"];
  if ((launchpad !== null && typeof launchpad !== "string") || typeof tokenAddr !== "string") return null;
  return { launchpad: launchpad as string | null, token: tokenAddr };
}

/** `major.minor.patch`. */
export function formatTokenListVersion(v: TokenListVersion): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

/** Semver ordering of two list versions: negative when `a` is older. */
export function compareTokenListVersions(a: TokenListVersion, b: TokenListVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}
