import { ipfsToHttp } from "../../ipfs.js";

/**
 * A launch token's `metadataURI`: where its icon and description actually live.
 *
 * ################ WHY THIS EXISTS ################
 *
 * `LaunchMetadata` (the REGISTRY's listing) used to carry an `iconURI`. It was removed on
 * 2026-09-24 because the struct could not afford a fifth member: `LaunchpadKitV2` ABI-encodes
 * `LaunchParamsV2` into memory to DELEGATECALL `LaunchLegs`, and any departure from four
 * `string` members costs the kit ~900 bytes and pushes it past EIP-170 — undeployable, while
 * every in-EVM test stays green because forge does not enforce that limit.
 *
 * The icon's correct home was always here. `LaunchToken.metadataURI()` is a string on the TOKEN,
 * set once at creation by `LaunchTokenFactory`, and being wrong there costs a broken image rather
 * than a broken registry record.
 *
 * ################ THE 512-BYTE CEILING DECIDES THE SHAPE ################
 *
 * `LaunchTokenFactory.MAX_METADATA_URI_BYTES` is **512**, and it reverts `MetadataURITooLong`
 * above it. That is EIGHT TIMES tighter than a pad's 4,096, so the pad's habit of inlining its
 * whole brand as `data:application/json;base64,...` does not generalise here. MEASURED, with a
 * real CIDv1 image pointer and `data:application/json;base64,` costing 29 bytes before base64
 * adds its third:
 *
 *     name + symbol only                  73 bytes
 *     + ipfs:// image                     177
 *     + image + 150-char description      401
 *     + image + 200-char description      465   <- still fits
 *     + image + 250-char description      533   <- OVER, reverts on chain
 *
 * So inlining survives a token with an icon and roughly 215 characters of prose, and nothing
 * more. `TOKEN_METADATA_MAX_DESCRIPTION` is 1,000 because a PINNED document may be that long —
 * the two limits are different things and conflating them is how a creator gets a revert.
 *
 * **Pinning is therefore the default and inlining is the exception**: pin the JSON, store
 * `ipfs://<cid>` (~66 bytes, leaving ~85% of the budget unused and the document any size).
 * `encodeInlineTokenMetadataURI` is offered for the minimal case and REFUSES rather than
 * truncating — a truncated URI is a token whose metadata silently does not resolve.
 *
 * ################ NOTHING HERE INVENTS DATA ################
 *
 * A missing, empty, unparseable or non-conforming `metadataURI` yields NO image and NO
 * description — never a placeholder and never a guess. The caller renders its monogram. That is
 * the same rule the rest of this SDK follows: if it cannot be read, it is not rendered.
 */

/** `LaunchTokenFactory.MAX_METADATA_URI_BYTES`. Mirrored so a caller fails locally, not on chain. */
export const LAUNCH_MAX_METADATA_URI_BYTES = 512;

/** Bounds on the document itself, so a pinned file cannot be unboundedly large. */
export const TOKEN_METADATA_MAX_NAME = 64;
export const TOKEN_METADATA_MAX_SYMBOL = 16;
export const TOKEN_METADATA_MAX_DESCRIPTION = 1000;

const DATA_JSON_PREFIX = "data:application/json";

/**
 * The document a launch token's `metadataURI` points at.
 *
 * `name` and `symbol` are carried so a consumer that has only the URI can label the token without
 * a second chain read; they are a CONVENIENCE and the chain is authoritative. A consumer that has
 * both MUST prefer `LaunchToken.name()` / `.symbol()` — this file is creator-supplied and the
 * token's own fields are not.
 */
export interface TokenMetadata {
  readonly name: string;
  readonly symbol: string;
  /** `ipfs://<cid>` for the icon. Omitted when the creator supplied none. */
  readonly image?: string;
  readonly description?: string;
}

export interface TokenMetadataIssue {
  readonly field: "name" | "symbol" | "image" | "description" | "uri";
  readonly message: string;
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Check a metadata document. Returns every problem rather than the first, so a form can mark all
 * of its fields at once.
 *
 * `image` must be `ipfs://`: an `https://` icon is a mutable pointer a creator (or whoever holds
 * that host) can repoint after people have bought, and the icon is the thing a buyer recognises
 * the token by. `ipfs://` is content-addressed, so the bytes cannot change under the CID.
 */
export function validateTokenMetadata(value: unknown): readonly TokenMetadataIssue[] {
  const issues: TokenMetadataIssue[] = [];
  if (typeof value !== "object" || value === null) {
    return [{ field: "uri", message: "metadata is not a JSON object" }];
  }
  const m = value as Record<string, unknown>;

  if (typeof m["name"] !== "string" || m["name"].trim() === "") {
    issues.push({ field: "name", message: "name is required" });
  } else if (utf8Bytes(m["name"]) > TOKEN_METADATA_MAX_NAME) {
    issues.push({ field: "name", message: `name is over ${TOKEN_METADATA_MAX_NAME} bytes` });
  }

  if (typeof m["symbol"] !== "string" || m["symbol"].trim() === "") {
    issues.push({ field: "symbol", message: "symbol is required" });
  } else if (utf8Bytes(m["symbol"]) > TOKEN_METADATA_MAX_SYMBOL) {
    issues.push({ field: "symbol", message: `symbol is over ${TOKEN_METADATA_MAX_SYMBOL} bytes` });
  }

  // `""` means "not given", exactly as it does for a social handle. A form that renders an empty
  // optional input must not be told its token is invalid — it has simply not filled that field.
  const image = m["image"];
  if (image !== undefined && image !== "") {
    if (typeof image !== "string" || !image.startsWith("ipfs://")) {
      issues.push({
        field: "image",
        message: "image must be an ipfs:// URI — an https:// icon can be repointed after people have bought",
      });
    }
  }

  const description = m["description"];
  if (description !== undefined && description !== "") {
    if (typeof description !== "string") {
      issues.push({ field: "description", message: "description must be a string" });
    } else if (utf8Bytes(description) > TOKEN_METADATA_MAX_DESCRIPTION) {
      issues.push({ field: "description", message: `description is over ${TOKEN_METADATA_MAX_DESCRIPTION} bytes` });
    }
  }
  return issues;
}

/** The document a caller should pin, with absent optional members dropped rather than sent as "". */
export function buildTokenMetadata(input: TokenMetadata): TokenMetadata {
  const issues = validateTokenMetadata(input);
  if (issues.length > 0) {
    throw new RangeError(`invalid token metadata: ${issues.map((i) => `${i.field}: ${i.message}`).join("; ")}`);
  }
  const out: Record<string, string> = { name: input.name.trim(), symbol: input.symbol.trim() };
  if (input.image !== undefined && input.image !== "") out["image"] = input.image;
  const description = input.description?.trim();
  if (description !== undefined && description !== "") out["description"] = description;
  return out as unknown as TokenMetadata;
}

/** The exact bytes to pin. Stable key order, so the same input pins to the same CID. */
export function tokenMetadataDocument(input: TokenMetadata): string {
  return JSON.stringify(buildTokenMetadata(input));
}

/**
 * `ipfs://<cid>` for a document already pinned. Trivial, but it is the ONE place that checks the
 * result fits `MAX_METADATA_URI_BYTES`, so a caller cannot discover the ceiling on chain.
 */
export function pinnedTokenMetadataURI(cid: string): string {
  const uri = `ipfs://${cid}`;
  const bytes = utf8Bytes(uri);
  if (bytes > LAUNCH_MAX_METADATA_URI_BYTES) {
    throw new RangeError(`the URI is ${bytes} bytes; the token stores at most ${LAUNCH_MAX_METADATA_URI_BYTES}`);
  }
  return uri;
}

/**
 * The metadata INLINE as `data:application/json;base64,...`, for the minimal case where it fits.
 *
 * Use this only when there is no image, or when the whole document is small: the ceiling is 512
 * bytes and base64 costs a third on top. It **throws** when the result would not fit rather than
 * dropping the description or truncating — a truncated data URI is a token whose metadata does not
 * parse at all, which is strictly worse than pinning.
 */
export function encodeInlineTokenMetadataURI(input: TokenMetadata): string {
  const json = tokenMetadataDocument(input);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const uri = `${DATA_JSON_PREFIX};base64,${btoa(binary)}`;
  const size = utf8Bytes(uri);
  if (size > LAUNCH_MAX_METADATA_URI_BYTES) {
    throw new RangeError(
      `the inline metadata is ${size} bytes; the token stores at most ${LAUNCH_MAX_METADATA_URI_BYTES}. ` +
        `Pin the document and use pinnedTokenMetadataURI(cid) instead.`,
    );
  }
  return uri;
}

/** What a token's `metadataURI` turned out to be. */
export type DecodedTokenMetadata =
  | { readonly kind: "inline"; readonly metadata: TokenMetadata }
  | { readonly kind: "remote"; readonly url: string }
  | { readonly kind: "empty" }
  | { readonly kind: "invalid"; readonly reason: string };

/**
 * Decode a token's `metadataURI`. Inline JSON is parsed AND validated here; an `ipfs://` or
 * `https://` pointer is returned for the caller to fetch and then validate with
 * `validateTokenMetadata`. Anything else is `invalid` with a reason — never a default document.
 */
export function decodeTokenMetadataURI(uri: string): DecodedTokenMetadata {
  if (uri === "") return { kind: "empty" };
  if (uri.startsWith("ipfs://") || uri.startsWith("https://")) return { kind: "remote", url: uri };
  if (!uri.startsWith(DATA_JSON_PREFIX)) {
    return { kind: "invalid", reason: "not a data:application/json, ipfs:// or https:// URI" };
  }
  const comma = uri.indexOf(",");
  if (comma === -1) return { kind: "invalid", reason: "data URI has no payload" };
  const params = uri.slice(DATA_JSON_PREFIX.length, comma);
  const payload = uri.slice(comma + 1);
  let text: string;
  try {
    if (params.includes(";base64")) {
      const binary = atob(payload);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
      text = new TextDecoder().decode(out);
    } else {
      text = decodeURIComponent(payload);
    }
  } catch {
    return { kind: "invalid", reason: "data URI payload is not decodable" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "invalid", reason: "data URI payload is not JSON" };
  }
  const issues = validateTokenMetadata(parsed);
  if (issues.length > 0) {
    return { kind: "invalid", reason: issues.map((i) => `${i.field}: ${i.message}`).join("; ") };
  }
  return { kind: "inline", metadata: parsed as TokenMetadata };
}

/**
 * HTTP URLs to try for a metadata document's `image`, in order, or `null` when there is nothing
 * renderable. Resolution goes through the SDK's allow-listed gateways — the same path the airdrop
 * claim screen uses — so a token cannot point a viewer's browser at an arbitrary host.
 *
 * Returns `null` (not a placeholder) for absent or non-`ipfs://` images, so a caller falls back to
 * its monogram instead of rendering something that was never read.
 */
export function tokenImageUrls(
  metadata: TokenMetadata | null | undefined,
  opts: { gateways?: readonly string[] } = {},
): readonly string[] | null {
  const image = metadata?.image;
  if (typeof image !== "string" || !image.startsWith("ipfs://")) return null;
  return ipfsToHttp(image, opts);
}
