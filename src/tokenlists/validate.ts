// SPDX-License-Identifier: MIT
/* ============================================================================
   Structural validation of a token list against the Uniswap Token Lists
   schema (`@uniswap/token-lists` 1.0.0-beta.35, `tokenlist.schema.json`),
   written out by hand so this package stays dependency-free: an MIT SDK that
   pulls in a JSON-schema engine to read a list is heavier than the list.

   Every constraint below names the schema rule it mirrors. The tokenlists
   package (`packages/tokenlists/scripts/check.mjs`) runs the OFFICIAL schema
   through ajv over the same documents, so a divergence between the two shows
   up there, on the list, rather than here, on a consumer.
   ============================================================================ */

import type { TokenList } from "./types.js";

export interface TokenListIssue {
  /** JSON path of the offending value, e.g. `tokens[3].symbol`. */
  readonly path: string;
  readonly message: string;
}

const NAME_RE = /^[\w ]+$/;
const KEYWORD_RE = /^[\w ]+$/;
const TAG_ID_RE = /^\w+$/;
const TAG_NAME_RE = /^[ \w]+$/;
const TAG_DESCRIPTION_RE = /^[ \w.,:]+$/;
const EXTENSION_ID_RE = /^\w+$/;
/** EVM (`0x` + 40 hex) or the schema's Solana form (base58, 32..44). */
const ADDRESS_RE = /^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;
const TOKEN_NAME_RE = /^[ \S+]+$/;
const SYMBOL_RE = /^\S+$/;
/** RFC 3339 date-time, what ajv-formats' `date-time` accepts (`2026-09-18T12:00:00Z`, or an offset). */
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/;
/** A URI with a scheme, which is what `format: uri` requires; relative paths fail. */
const URI_RE = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]*$/;

/** The schema's maxima, exported for anyone building a list by hand. */
export const TOKEN_LIST_LIMITS = {
  nameMax: 30,
  tokensMin: 1,
  tokensMax: 10_000,
  keywordsMax: 20,
  keywordMax: 20,
  tagsMax: 20,
  tagIdMax: 10,
  tagNameMax: 20,
  tagDescriptionMax: 200,
  tokenNameMax: 60,
  symbolMax: 20,
  decimalsMax: 255,
  tokenTagsMax: 10,
  extensionsMax: 10,
  extensionIdMax: 40,
  extensionStringMax: 42,
} as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

function checkPrimitive(v: unknown, path: string, issues: TokenListIssue[]): boolean {
  if (v === null || typeof v === "boolean" || typeof v === "number") return true;
  if (typeof v === "string") {
    if (v.length < 1 || v.length > TOKEN_LIST_LIMITS.extensionStringMax) {
      issues.push({ path, message: `extension strings are 1 to ${TOKEN_LIST_LIMITS.extensionStringMax} characters` });
    }
    return true;
  }
  return false;
}

/** `ExtensionValue` / `ExtensionValueInner0` / `ExtensionValueInner1`: three levels, primitives at the bottom. */
function checkExtensionValue(v: unknown, path: string, depth: number, issues: TokenListIssue[]): void {
  if (checkPrimitive(v, path, issues)) return;
  if (!isRecord(v)) {
    issues.push({ path, message: "must be a string, number, boolean, null or an object" });
    return;
  }
  if (depth >= 2) {
    issues.push({ path, message: "extensions nest at most three objects deep" });
    return;
  }
  const keys = Object.keys(v);
  if (keys.length > TOKEN_LIST_LIMITS.extensionsMax) issues.push({ path, message: `at most ${TOKEN_LIST_LIMITS.extensionsMax} properties` });
  for (const k of keys) {
    if (!EXTENSION_ID_RE.test(k) || k.length > TOKEN_LIST_LIMITS.extensionIdMax) {
      issues.push({ path: `${path}.${k}`, message: `extension keys are 1 to ${TOKEN_LIST_LIMITS.extensionIdMax} word characters` });
    }
    checkExtensionValue(v[k], `${path}.${k}`, depth + 1, issues);
  }
}

function checkExtensionMap(v: unknown, path: string, issues: TokenListIssue[]): void {
  if (!isRecord(v)) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  const keys = Object.keys(v);
  if (keys.length > TOKEN_LIST_LIMITS.extensionsMax) issues.push({ path, message: `at most ${TOKEN_LIST_LIMITS.extensionsMax} extensions` });
  for (const k of keys) {
    if (!EXTENSION_ID_RE.test(k) || k.length > TOKEN_LIST_LIMITS.extensionIdMax) {
      issues.push({ path: `${path}.${k}`, message: `extension keys are 1 to ${TOKEN_LIST_LIMITS.extensionIdMax} word characters` });
    }
    checkExtensionValue(v[k], `${path}.${k}`, 0, issues);
  }
}

const TOKEN_KEYS = new Set(["chainId", "address", "decimals", "name", "symbol", "logoURI", "tags", "extensions"]);

function checkToken(v: unknown, path: string, issues: TokenListIssue[]): void {
  if (!isRecord(v)) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  for (const k of Object.keys(v)) {
    if (!TOKEN_KEYS.has(k)) issues.push({ path: `${path}.${k}`, message: "not a token list field (additionalProperties: false)" });
  }
  if (!isInteger(v["chainId"]) || v["chainId"] < 1) issues.push({ path: `${path}.chainId`, message: "must be an integer of at least 1" });
  if (typeof v["address"] !== "string" || !ADDRESS_RE.test(v["address"])) {
    issues.push({ path: `${path}.address`, message: "must be 0x followed by 40 hex characters" });
  }
  if (!isInteger(v["decimals"]) || v["decimals"] < 0 || v["decimals"] > TOKEN_LIST_LIMITS.decimalsMax) {
    issues.push({ path: `${path}.decimals`, message: `must be an integer in 0..${TOKEN_LIST_LIMITS.decimalsMax}` });
  }
  const name = v["name"];
  if (typeof name !== "string" || name.length > TOKEN_LIST_LIMITS.tokenNameMax || (name !== "" && !TOKEN_NAME_RE.test(name))) {
    issues.push({ path: `${path}.name`, message: `must be a string of at most ${TOKEN_LIST_LIMITS.tokenNameMax} characters` });
  }
  const symbol = v["symbol"];
  if (typeof symbol !== "string" || symbol.length > TOKEN_LIST_LIMITS.symbolMax || (symbol !== "" && !SYMBOL_RE.test(symbol))) {
    issues.push({ path: `${path}.symbol`, message: `must be a string of at most ${TOKEN_LIST_LIMITS.symbolMax} characters with no whitespace` });
  }
  if (v["logoURI"] !== undefined && (typeof v["logoURI"] !== "string" || !URI_RE.test(v["logoURI"]))) {
    issues.push({ path: `${path}.logoURI`, message: "must be an absolute URI" });
  }
  if (v["tags"] !== undefined) {
    const tags = v["tags"];
    if (!Array.isArray(tags) || tags.length > TOKEN_LIST_LIMITS.tokenTagsMax) {
      issues.push({ path: `${path}.tags`, message: `must be an array of at most ${TOKEN_LIST_LIMITS.tokenTagsMax} tag ids` });
    } else {
      tags.forEach((t, i) => {
        if (typeof t !== "string" || !TAG_ID_RE.test(t) || t.length > TOKEN_LIST_LIMITS.tagIdMax) {
          issues.push({ path: `${path}.tags[${i}]`, message: `tag ids are 1 to ${TOKEN_LIST_LIMITS.tagIdMax} word characters` });
        }
      });
    }
  }
  if (v["extensions"] !== undefined) checkExtensionMap(v["extensions"], `${path}.extensions`, issues);
}

/**
 * Every objection to `value` as a token list, cheapest first. An empty array
 * means the document satisfies the schema's structural rules; it says
 * nothing about whether the tokens exist or their decimals are right.
 */
export function validateTokenList(value: unknown): readonly TokenListIssue[] {
  const issues: TokenListIssue[] = [];
  if (!isRecord(value)) return [{ path: "", message: "a token list is a JSON object" }];

  const name = value["name"];
  if (typeof name !== "string" || name.length < 1 || name.length > TOKEN_LIST_LIMITS.nameMax || !NAME_RE.test(name)) {
    issues.push({ path: "name", message: `must be 1 to ${TOKEN_LIST_LIMITS.nameMax} word characters or spaces` });
  }
  if (typeof value["timestamp"] !== "string" || !DATE_TIME_RE.test(value["timestamp"])) {
    issues.push({ path: "timestamp", message: "must be an RFC 3339 date-time" });
  }
  const version = value["version"];
  if (!isRecord(version)) {
    issues.push({ path: "version", message: "must be { major, minor, patch }" });
  } else {
    for (const k of ["major", "minor", "patch"]) {
      if (!isInteger(version[k]) || version[k] < 0) issues.push({ path: `version.${k}`, message: "must be a non-negative integer" });
    }
    for (const k of Object.keys(version)) {
      if (k !== "major" && k !== "minor" && k !== "patch") issues.push({ path: `version.${k}`, message: "not a version field" });
    }
  }
  const tokens = value["tokens"];
  if (!Array.isArray(tokens)) {
    issues.push({ path: "tokens", message: "must be an array" });
  } else {
    if (tokens.length < TOKEN_LIST_LIMITS.tokensMin || tokens.length > TOKEN_LIST_LIMITS.tokensMax) {
      issues.push({ path: "tokens", message: `must hold ${TOKEN_LIST_LIMITS.tokensMin} to ${TOKEN_LIST_LIMITS.tokensMax} tokens` });
    }
    tokens.forEach((t, i) => checkToken(t, `tokens[${i}]`, issues));
  }
  if (value["tokenMap"] !== undefined) {
    const map = value["tokenMap"];
    if (!isRecord(map) || Object.keys(map).length < 1 || Object.keys(map).length > TOKEN_LIST_LIMITS.tokensMax) {
      issues.push({ path: "tokenMap", message: `must be an object of 1 to ${TOKEN_LIST_LIMITS.tokensMax} tokens` });
    } else {
      for (const k of Object.keys(map)) checkToken(map[k], `tokenMap.${k}`, issues);
    }
  }
  if (value["keywords"] !== undefined) {
    const kw = value["keywords"];
    if (!Array.isArray(kw) || kw.length > TOKEN_LIST_LIMITS.keywordsMax) {
      issues.push({ path: "keywords", message: `must be an array of at most ${TOKEN_LIST_LIMITS.keywordsMax} keywords` });
    } else {
      const seen = new Set<string>();
      kw.forEach((k, i) => {
        if (typeof k !== "string" || k.length < 1 || k.length > TOKEN_LIST_LIMITS.keywordMax || !KEYWORD_RE.test(k)) {
          issues.push({ path: `keywords[${i}]`, message: `keywords are 1 to ${TOKEN_LIST_LIMITS.keywordMax} word characters or spaces` });
        } else if (seen.has(k)) {
          issues.push({ path: `keywords[${i}]`, message: "duplicate keyword" });
        } else {
          seen.add(k);
        }
      });
    }
  }
  if (value["tags"] !== undefined) {
    const tags = value["tags"];
    if (!isRecord(tags) || Object.keys(tags).length > TOKEN_LIST_LIMITS.tagsMax) {
      issues.push({ path: "tags", message: `must be an object of at most ${TOKEN_LIST_LIMITS.tagsMax} tag definitions` });
    } else {
      for (const [id, def] of Object.entries(tags)) {
        if (!TAG_ID_RE.test(id) || id.length > TOKEN_LIST_LIMITS.tagIdMax) {
          issues.push({ path: `tags.${id}`, message: `tag ids are 1 to ${TOKEN_LIST_LIMITS.tagIdMax} word characters` });
        }
        if (!isRecord(def)) {
          issues.push({ path: `tags.${id}`, message: "must be { name, description }" });
          continue;
        }
        for (const k of Object.keys(def)) {
          if (k !== "name" && k !== "description") issues.push({ path: `tags.${id}.${k}`, message: "not a tag definition field" });
        }
        const n = def["name"];
        if (typeof n !== "string" || n.length < 1 || n.length > TOKEN_LIST_LIMITS.tagNameMax || !TAG_NAME_RE.test(n)) {
          issues.push({ path: `tags.${id}.name`, message: `must be 1 to ${TOKEN_LIST_LIMITS.tagNameMax} word characters or spaces` });
        }
        const d = def["description"];
        if (typeof d !== "string" || d.length < 1 || d.length > TOKEN_LIST_LIMITS.tagDescriptionMax || !TAG_DESCRIPTION_RE.test(d)) {
          issues.push({ path: `tags.${id}.description`, message: `must be 1 to ${TOKEN_LIST_LIMITS.tagDescriptionMax} word characters, spaces, periods, commas or colons` });
        }
      }
    }
  }
  if (value["logoURI"] !== undefined && (typeof value["logoURI"] !== "string" || !URI_RE.test(value["logoURI"]))) {
    issues.push({ path: "logoURI", message: "must be an absolute URI" });
  }
  if (value["extensions"] !== undefined) checkExtensionMap(value["extensions"], "extensions", issues);
  /* The tags a token names must be defined at the list level. The schema does
     not cross-check this; a consumer rendering a badge from an undefined tag
     would be rendering a word nobody defined. */
  if (Array.isArray(tokens)) {
    const defined = new Set(isRecord(value["tags"]) ? Object.keys(value["tags"]) : []);
    tokens.forEach((t, i) => {
      if (!isRecord(t) || !Array.isArray(t["tags"])) return;
      t["tags"].forEach((tag, j) => {
        if (typeof tag === "string" && !defined.has(tag)) {
          issues.push({ path: `tokens[${i}].tags[${j}]`, message: `tag "${tag}" is not defined in the list's tags` });
        }
      });
    });
  }
  return issues;
}

/** `true` when `value` is a token list with no structural issue. A type guard for `fetchTokenList`. */
export function isTokenList(value: unknown): value is TokenList {
  return validateTokenList(value).length === 0;
}
