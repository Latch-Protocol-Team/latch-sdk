// SPDX-License-Identifier: MIT
/* ============================================================================
   Which tokens on a chain are stocks — resolved at RUNTIME from the published
   Latch token list, with the SDK's built-in registry as the offline fallback.

   OWNER DECISION, 2026-09-18: a stock must be addable without any deploy or
   release. The published list (`latchTokenListUrl(chainId)`) is therefore the
   source of truth for "this token is a stock"; `STOCK_TOKENS` in
   `deployments/stocks.ts` is the generator's input and what a consumer shows
   while the list loads or when it cannot be reached.

   THE MERGE, by lowercase address:
     * a token in BOTH sources: the list's fields win (symbol, name, decimals,
       issuer, ticker, controls) and both sources are recorded;
     * a token only in the list: taken as the list states it; controls absent
       from the entry are every power ON (the safe direction for a reader);
     * a token only in the built-in table: kept, so a list that is BEHIND the
       SDK (not yet re-synced) never hides a verified stock.

   THE ONE THING THE LIST IS NOT TRUSTED FOR: turning `rebasing` OFF. A
   rebasing token in the Infinity Vault strands or over-claims value, so if
   either source says `rebasing: true`, the result says true. A list can add a
   rebasing flag; it can never remove one the SDK recorded.

   Nothing here caches. The list is a document an app decides how long to keep.
   ============================================================================ */

import { getAddress, type Address } from "viem";

import { STOCK_TOKENS, type StockTokenControls, type StockTokenRecord } from "../deployments/stocks.js";
import type { TokenInfo } from "../deployments/index.js";
import { fetchTokenList, type FetchTokenListOptions } from "./fetch.js";
import { formatTokenListVersion, stockExtensionOf, type TokenList } from "./types.js";
import { latchTokenListUrl } from "./url.js";

/** Where a resolved stock came from. */
export type StockTokenSource = "list" | "builtin";

/**
 * A stock as the UI consumes it: the address book's `TokenInfo` shape with
 * `stock` always present, plus the control surface and where it came from.
 */
export interface ResolvedStockToken extends TokenInfo {
  readonly stock: { readonly issuer: string; readonly ticker: string };
  /** `balanceOf` itself is rescaled by the issuer. NEVER offer such a token as a pool currency. */
  readonly rebasing: boolean;
  readonly controls: StockTokenControls;
  /** Every source that names this address, `list` first when both do. */
  readonly sources: readonly StockTokenSource[];
  /** The day of the reads behind this entry: the list's `verifiedAt`, else the built-in record's; `null` when neither says. */
  readonly verifiedAt: string | null;
  /** The built-in record when the SDK has one, for the fields the list does not carry (proxy, implementation, notes). */
  readonly record: StockTokenRecord | null;
}

export interface ResolvedStockTokens {
  readonly chainId: number;
  readonly tokens: readonly ResolvedStockToken[];
  /**
   * `list` — every token came from the list (the built-in table had nothing, or nothing the list lacked);
   * `builtin` — the list was not consulted or could not be read, the built-in table alone;
   * `merged` — both contributed at least one token.
   */
  readonly source: "list" | "builtin" | "merged";
  /** The list's semver, when a list was read; `null` under `builtin`. */
  readonly listVersion: string | null;
  /** The URL the list was read from; `null` when a `list` object was supplied or none was read. */
  readonly listUrl: string | null;
  /** Why the list was not used, when it was not: the fetch or validation failure, or "no fetch available". */
  readonly listError: string | null;
}

export interface ResolveStockTokensOptions {
  /** A list already in hand (from `fetchTokenList` or elsewhere); skips the fetch. */
  readonly list?: TokenList;
  /** The fetch to use; defaults to the global one. `undefined` with no global fetch ⇒ built-in only. */
  readonly fetch?: typeof fetch;
  /** The URL to read; defaults to `latchTokenListUrl(chainId, base)`. */
  readonly url?: string;
  /** The base the Latch lists are served under (an app's mirror); ignored when `url` is given. */
  readonly base?: string;
  readonly signal?: AbortSignal;
  /** Passed through to `fetchTokenList`. */
  readonly maxBytes?: number;
}

/** Every power on: what a reader must assume of a stock whose controls nobody recorded. */
export const ASSUME_ALL_CONTROLS: StockTokenControls = {
  pause: true,
  blocklist: true,
  allowlist: true,
  issuerBurn: true,
  upgradeable: true,
  uiMultiplier: true,
  rebasing: true,
};

function fromRecord(r: StockTokenRecord): ResolvedStockToken {
  return {
    address: r.address,
    symbol: r.symbol,
    name: r.name,
    decimals: r.decimals,
    isTestToken: false,
    stock: { issuer: r.issuer, ticker: r.ticker },
    rebasing: r.controls.rebasing,
    controls: r.controls,
    sources: ["builtin"],
    verifiedAt: r.verifiedAt,
    record: r,
  };
}

/**
 * Merges the stock entries of `list` (only those on `chainId`, only those with
 * a well-formed `extensions.stock`) over the built-in table. Pure; no I/O.
 */
export function mergeStockTokens(chainId: number, list: TokenList | null): readonly ResolvedStockToken[] {
  const out = new Map<string, ResolvedStockToken>();
  for (const r of STOCK_TOKENS[chainId] ?? []) out.set(r.address.toLowerCase(), fromRecord(r));
  if (list === null) return [...out.values()];

  for (const t of list.tokens) {
    if (t.chainId !== chainId) continue;
    /* The native asset is addressed as zero; no list entry can make it a stock. */
    if (/^0x0{40}$/i.test(t.address)) continue;
    const ext = stockExtensionOf(t);
    if (ext === null) continue;
    const key = t.address.toLowerCase();
    const builtin = out.get(key) ?? null;
    /* Controls: the list's when it carries them, else the built-in record's, else every power on.
       Rebasing is the OR of everything anybody said — see the module header. */
    const base: StockTokenControls = ext.controls ?? builtin?.controls ?? ASSUME_ALL_CONTROLS;
    const rebasing = ext.rebasing || base.rebasing || (builtin?.rebasing ?? false);
    const controls: StockTokenControls = base.rebasing === rebasing ? base : { ...base, rebasing };
    let address: Address;
    try {
      address = builtin?.address ?? getAddress(t.address);
    } catch {
      continue; /* the validator already refused a malformed address; belt and braces */
    }
    out.set(key, {
      address,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      isTestToken: false,
      stock: { issuer: ext.issuer, ticker: ext.ticker },
      rebasing,
      controls,
      sources: builtin === null ? ["list"] : ["list", "builtin"],
      verifiedAt: ext.verifiedAt ?? builtin?.verifiedAt ?? null,
      record: builtin?.record ?? null,
    });
  }
  return [...out.values()];
}

function sourceOf(tokens: readonly ResolvedStockToken[], listRead: boolean): ResolvedStockTokens["source"] {
  if (!listRead) return "builtin";
  const fromList = tokens.some((t) => t.sources.includes("list"));
  const fromBuiltinOnly = tokens.some((t) => !t.sources.includes("list"));
  if (fromList && fromBuiltinOnly) return "merged";
  if (fromList) return "list";
  return tokens.length === 0 ? "list" : "builtin";
}

/**
 * The chain's stocks, resolved from the published Latch list over the built-in
 * registry. Never throws for a list failure: the result then carries the
 * built-in table and `listError` says why. Throws only for a bad `chainId`.
 */
export async function resolveStockTokens(chainId: number, options: ResolveStockTokensOptions = {}): Promise<ResolvedStockTokens> {
  if (!Number.isInteger(chainId) || chainId < 1) throw new RangeError(`not a chain id: ${String(chainId)}`);
  let list: TokenList | null = null;
  let listUrl: string | null = null;
  let listError: string | null = null;

  if (options.list !== undefined) {
    list = options.list;
  } else {
    const doFetch = options.fetch ?? (typeof globalThis.fetch === "function" ? globalThis.fetch : undefined);
    if (doFetch === undefined) {
      listError = "no fetch available";
    } else {
      listUrl = options.url ?? latchTokenListUrl(chainId, options.base);
      const fo: FetchTokenListOptions = {
        fetch: doFetch,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
      };
      try {
        list = (await fetchTokenList(listUrl, fo)).list;
      } catch (e) {
        listError = e instanceof Error ? e.message : String(e);
      }
    }
  }

  const tokens = mergeStockTokens(chainId, list);
  return {
    chainId,
    tokens,
    source: sourceOf(tokens, list !== null),
    listVersion: list === null ? null : formatTokenListVersion(list.version),
    listUrl: list === null ? null : listUrl,
    listError,
  };
}

/**
 * The built-in table alone, in the resolved shape — what a consumer renders
 * before `resolveStockTokens` settles. Synchronous and pure.
 */
export function builtinStockTokens(chainId: number): ResolvedStockTokens {
  const tokens = mergeStockTokens(chainId, null);
  return { chainId, tokens, source: "builtin", listVersion: null, listUrl: null, listError: null };
}

/** The resolved stocks a pool or a launch may be QUOTED in: never a rebasing one, from either source. */
export function quotableStockTokens(resolved: Pick<ResolvedStockTokens, "tokens">): readonly ResolvedStockToken[] {
  return resolved.tokens.filter((t) => !t.rebasing && !t.controls.rebasing);
}

/** The resolved stock at `address` (case-insensitive), else `null`. */
export function resolvedStockByAddress(resolved: Pick<ResolvedStockTokens, "tokens">, address: string): ResolvedStockToken | null {
  const wanted = address.toLowerCase();
  return resolved.tokens.find((t) => t.address.toLowerCase() === wanted) ?? null;
}

/**
 * One line a screen can print beside anything it lists as a stock, saying
 * where the answer came from: "stock list: token list v1.1.0" or
 * "stock list: built-in registry (list unreachable)".
 */
export function describeStockSource(resolved: Pick<ResolvedStockTokens, "source" | "listVersion" | "listError">): string {
  if (resolved.source === "builtin") {
    if (resolved.listError !== null) return `stock list: built-in registry (list unreachable: ${resolved.listError})`;
    if (resolved.listVersion !== null) return `stock list: built-in registry (token list v${resolved.listVersion} lists no stock here)`;
    return "stock list: built-in registry";
  }
  const v = resolved.listVersion === null ? "token list" : `token list v${resolved.listVersion}`;
  return resolved.source === "merged" ? `stock list: ${v} + built-in registry` : `stock list: ${v}`;
}

/** The chains the built-in table knows, for a consumer that wants to pre-warm; the list may know more. */
export function builtinStockChainIds(): readonly number[] {
  return Object.keys(STOCK_TOKENS)
    .map(Number)
    .sort((a, b) => a - b);
}
