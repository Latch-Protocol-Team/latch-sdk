// SPDX-License-Identifier: MIT
/* ============================================================================
   Where the Latch token lists are published.

   The lists are generated in the monorepo (`packages/tokenlists`) from the
   SDK address book and the verified stock registry, and PUBLISHED from a
   separate public repository so a third party can pin, fork or PR them
   without touching the protocol code:

       https://github.com/Latch-Protocol-Team/dex-tokenl-list

   (The repository name carries that spelling; it is the real name, use it
   verbatim.) One file per chain, served raw from the default branch, and the
   logos beside them under `logos/<chainId>/<address>.png`.

   Nothing here points at latch.guru: that domain is still a placeholder
   (CLAUDE.md, "X handle and latch.guru are both placeholders"), and a list
   URL that does not resolve is a list nobody can load. An app that serves its
   own copy passes its base; the dapp reads `VITE_LATCH_TOKENLIST_BASE` for
   local development.
   ============================================================================ */

/** The public repository the lists are published from. */
export const LATCH_TOKENLIST_REPO = "https://github.com/Latch-Protocol-Team/dex-tokenl-list";

/** Base URL (no trailing slash) under which `<chainId>.tokenlist.json` and `logos/` are served. */
export const LATCH_TOKENLIST_DEFAULT_BASE = "https://raw.githubusercontent.com/Latch-Protocol-Team/dex-tokenl-list/main";

/** The file name of a chain's list, the same everywhere it is served. */
export function latchTokenListFileName(chainId: number): string {
  if (!Number.isInteger(chainId) || chainId < 1) throw new RangeError(`not a chain id: ${String(chainId)}`);
  return `${chainId}.tokenlist.json`;
}

/**
 * The URL of the Latch token list for `chainId`. `base` defaults to the
 * published repository; pass another base (an app's own origin, a mirror)
 * and the same file name is used under it.
 */
export function latchTokenListUrl(chainId: number, base: string = LATCH_TOKENLIST_DEFAULT_BASE): string {
  return `${base.replace(/\/+$/, "")}/${latchTokenListFileName(chainId)}`;
}

/** Upper-case alias for callers that read it as a constant-per-chain. */
export const LATCH_TOKENLIST_URL = latchTokenListUrl;
