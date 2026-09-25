// SPDX-License-Identifier: MIT
/* ============================================================================
   Fetching a token list: bounded, validated, and honest about what it got.

   No caching, no localStorage, no retries. A list is a document an app
   decides how long to keep; this function only turns a URL into a validated
   `TokenList` or a typed failure. The size cap exists because a token list
   URL is user-supplied (a pad's brand may name up to five) and an unbounded
   `res.json()` on a hostile URL is a memory exhaustion, not a token list.
   ============================================================================ */

import { compareTokenListVersions, type TokenList, type TokenListVersion } from "./types.js";
import { validateTokenList, type TokenListIssue } from "./validate.js";

/** 2 MiB: the schema allows 10,000 tokens, which at ~150 bytes each is well inside this. */
export const TOKEN_LIST_MAX_BYTES = 2 * 1024 * 1024;

export type TokenListFetchReason = "network" | "http" | "too-large" | "not-json" | "invalid";

export class TokenListFetchError extends Error {
  override readonly name = "TokenListFetchError";
  readonly url: string;
  readonly reason: TokenListFetchReason;
  /** HTTP status for `http`; `null` otherwise. */
  readonly status: number | null;
  /** The validator's objections for `invalid`; `[]` otherwise. */
  readonly issues: readonly TokenListIssue[];

  constructor(url: string, reason: TokenListFetchReason, message: string, extra: { status?: number; issues?: readonly TokenListIssue[]; cause?: unknown } = {}) {
    super(message, extra.cause === undefined ? undefined : { cause: extra.cause });
    this.url = url;
    this.reason = reason;
    this.status = extra.status ?? null;
    this.issues = extra.issues ?? [];
  }
}

export interface FetchTokenListOptions {
  /** The fetch to use; defaults to the global one. Injected so tests and non-browser hosts can supply their own. */
  readonly fetch?: typeof fetch;
  /** Run `validateTokenList` on the body (default `true`). `false` still checks it is a JSON object with `tokens`. */
  readonly validate?: boolean;
  /** Refuse a body larger than this many bytes (default `TOKEN_LIST_MAX_BYTES`). */
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
  /**
   * The version the caller already holds. The result's `update` then says how
   * the fetched list relates to it, per the standard's semver rules.
   */
  readonly current?: TokenListVersion;
}

/** How the fetched list relates to `options.current`. `first` when no current version was given. */
export type TokenListUpdate = "first" | "none" | "patch" | "minor" | "major" | "older";

export interface FetchedTokenList {
  readonly list: TokenList;
  readonly url: string;
  readonly bytes: number;
  readonly update: TokenListUpdate;
}

/** The kind of update `next` is over `current`, per the standard: major on removal, minor on add, patch on metadata. */
export function tokenListUpdateKind(current: TokenListVersion | undefined, next: TokenListVersion): TokenListUpdate {
  if (current === undefined) return "first";
  const cmp = compareTokenListVersions(next, current);
  if (cmp < 0) return "older";
  if (cmp === 0) return "none";
  if (next.major !== current.major) return "major";
  if (next.minor !== current.minor) return "minor";
  return "patch";
}

async function readBounded(res: Response, url: string, maxBytes: number): Promise<{ text: string; bytes: number }> {
  const declared = res.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) {
    throw new TokenListFetchError(url, "too-large", `the list declares ${declared} bytes; the cap is ${maxBytes}`);
  }
  const body = res.body;
  if (body === null || typeof body.getReader !== "function") {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new TokenListFetchError(url, "too-large", `the list is ${buf.byteLength} bytes; the cap is ${maxBytes}`);
    return { text: new TextDecoder().decode(buf), bytes: buf.byteLength };
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new TokenListFetchError(url, "too-large", `the list exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(bytes);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return { text: new TextDecoder().decode(all), bytes };
}

/**
 * Fetches and validates a token list. Throws `TokenListFetchError` with a
 * `reason` a UI can render; never resolves with a list that failed the schema
 * (unless `validate: false`, and then only the object shape is checked).
 *
 * Only `http(s)` URLs are fetched as given. An `ipfs://` list must be resolved
 * to a gateway URL by the caller.
 */
export async function fetchTokenList(url: string, options: FetchTokenListOptions = {}): Promise<FetchedTokenList> {
  const doFetch = options.fetch ?? globalThis.fetch;
  if (typeof doFetch !== "function") throw new TokenListFetchError(url, "network", "no fetch implementation is available");
  const maxBytes = options.maxBytes ?? TOKEN_LIST_MAX_BYTES;

  let res: Response;
  try {
    res = await doFetch(url, {
      headers: { accept: "application/json" },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (e) {
    throw new TokenListFetchError(url, "network", e instanceof Error ? e.message : String(e), { cause: e });
  }
  if (!res.ok) throw new TokenListFetchError(url, "http", `HTTP ${res.status} from ${url}`, { status: res.status });

  const { text, bytes } = await readBounded(res, url, maxBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new TokenListFetchError(url, "not-json", "the response is not JSON", { cause: e });
  }

  if (options.validate === false) {
    if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { tokens?: unknown }).tokens)) {
      throw new TokenListFetchError(url, "invalid", "the response is not a token list object with a tokens array");
    }
  } else {
    const issues = validateTokenList(parsed);
    if (issues.length > 0) {
      const head = issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join("; ");
      throw new TokenListFetchError(url, "invalid", `the list fails the schema (${issues.length} issue${issues.length === 1 ? "" : "s"}): ${head}`, { issues });
    }
  }
  const list = parsed as TokenList;
  return { list, url, bytes, update: tokenListUpdateKind(options.current, list.version) };
}
