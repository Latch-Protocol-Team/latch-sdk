// SPDX-License-Identifier: MIT
/* ============================================================================
   Merging several token lists into one picker's worth of tokens.

   Order is precedence: the first list to name an address wins, and every
   later list that also names it is recorded on the token rather than
   silently dropped, so a UI can say "Latch · also in Mochi" instead of
   pretending the second list never mentioned it. Tokens on other chains are
   left out; a multi-chain list is filtered, never rejected.
   ============================================================================ */

import type { TokenList, TokenListTagDefinition, TokenListToken } from "./types.js";

/** A list as the merge identifies it: its name and, when known, its version. */
export interface TokenListSource {
  /** Position in the `lists` argument. Stable across a re-merge of the same input. */
  readonly index: number;
  readonly name: string;
  readonly version: string | null;
}

export interface MergedTokenListToken extends TokenListToken {
  /** The list this token's fields came from (the first to name the address). */
  readonly source: TokenListSource;
  /** Every OTHER list that also names this address, in input order. */
  readonly alsoIn: readonly TokenListSource[];
}

export interface MergedTokenList {
  readonly chainId: number;
  readonly tokens: readonly MergedTokenListToken[];
  readonly sources: readonly TokenListSource[];
  /** Tag definitions from every list, first definition of an id wins. */
  readonly tags: { readonly [tagId: string]: TokenListTagDefinition };
  /** Addresses that appeared in more than one list, lowercase, in first-seen order. */
  readonly duplicates: readonly string[];
}

export interface MergeTokenListsOptions {
  /** Only tokens on this chain are kept. */
  readonly chainId: number;
}

function versionOf(list: TokenList): string | null {
  const v = list.version;
  return typeof v === "object" && v !== null && Number.isInteger(v.major) ? `${v.major}.${v.minor}.${v.patch}` : null;
}

/**
 * Merges `lists` for one chain. Dedupe key is the lowercase address; the
 * first list wins, later lists are recorded in `alsoIn`. Tokens keep the
 * winning list's `name`, `symbol`, `decimals`, `logoURI`, `tags` and
 * `extensions` exactly — nothing is blended across lists, because a merged
 * `decimals` would be a number no list published.
 */
export function mergeTokenLists(lists: readonly TokenList[], options: MergeTokenListsOptions): MergedTokenList {
  const { chainId } = options;
  const sources: TokenListSource[] = lists.map((l, index) => ({ index, name: l.name, version: versionOf(l) }));
  const byAddress = new Map<string, { token: TokenListToken; source: TokenListSource; alsoIn: TokenListSource[] }>();
  const order: string[] = [];
  const duplicates: string[] = [];
  const tags: Record<string, TokenListTagDefinition> = {};

  lists.forEach((list, index) => {
    const source = sources[index];
    if (source === undefined) return;
    for (const [id, def] of Object.entries(list.tags ?? {})) {
      if (!(id in tags)) tags[id] = def;
    }
    for (const token of list.tokens) {
      if (token.chainId !== chainId) continue;
      const key = token.address.toLowerCase();
      const existing = byAddress.get(key);
      if (existing === undefined) {
        byAddress.set(key, { token, source, alsoIn: [] });
        order.push(key);
        continue;
      }
      if (!duplicates.includes(key)) duplicates.push(key);
      if (existing.source.index !== index && !existing.alsoIn.some((s) => s.index === index)) existing.alsoIn.push(source);
    }
  });

  const tokens: MergedTokenListToken[] = order.map((key) => {
    const entry = byAddress.get(key);
    if (entry === undefined) throw new Error("unreachable: address vanished from the merge map");
    return { ...entry.token, source: entry.source, alsoIn: entry.alsoIn };
  });
  return { chainId, tokens, sources, tags, duplicates };
}
