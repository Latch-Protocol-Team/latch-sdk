/**
 * IPFS URIs for launch listings: parse, resolve through an ALLOW-LISTED
 * gateway, and verify that what a gateway returned is what the CID names.
 *
 * WHY THIS EXISTS. `LatchLaunchRegistry` caps every listing URI at
 * `MAX_URI_BYTES = 512`, so a token icon cannot be inlined as a `data:` URI;
 * it is pinned to IPFS and the registry record carries `ipfs://<cid>`. A CID
 * is a hash of the content, so a renderer that re-hashes the bytes it fetched
 * knows they are the creator's, whatever gateway served them. That check only
 * works when the CID names the bytes DIRECTLY: a CIDv1 with the `raw` codec
 * (0x55) and a sha2-256 multihash, which is what a single-block pin of a file
 * of at most 256 KiB produces under `{ rawLeaves: true, cidVersion: 1 }`
 * (`bafkrei…`). A dag-pb CID (`Qm…`, `bafybei…`) names a UnixFS node whose
 * bytes are NOT the file, so it parses and resolves here but never verifies;
 * a renderer shows such an icon without a verified mark.
 *
 * GATEWAYS ARE AN ALLOW-LIST. A URI never names a gateway; the caller's list
 * (or `IPFS_GATEWAYS`) does, and every entry must be https (http only on
 * loopback, for a local node). Nothing here fetches: the web layer fetches
 * through the list in order and falls back, then verifies.
 *
 * No dependency beyond viem's sha256: base32/base58/hex multibase decoding
 * and the multihash walk are a few dozen lines, and the SDK is meant to be
 * embeddable. The tests cross-check the parser against `multiformats` and the
 * verifier against `ipfs-unixfs-importer`.
 */

import { sha256 } from "viem";

/** The multicodec `raw` (0x55): the CID's multihash is over the file bytes themselves. */
export const IPFS_CODEC_RAW = 0x55;
/** The multicodec `dag-pb` (0x70): a UnixFS node, not the file bytes. */
export const IPFS_CODEC_DAG_PB = 0x70;
/** The multihash code for sha2-256. */
export const MULTIHASH_SHA2_256 = 0x12;

/**
 * Public path gateways, tried in order. A deployment with its own gateway
 * prepends it (`ipfsGateways({ own })`); nothing outside this list is ever
 * fetched, and no URI can add to it.
 */
export const IPFS_GATEWAYS: readonly string[] = ["https://dweb.link/ipfs/", "https://ipfs.io/ipfs/"];

/** Environment key an app may set to put its own gateway first (`VITE_`/`LATCH_` prefixed by the host app). */
export const IPFS_GATEWAY_ENV = "LATCH_IPFS_GATEWAY";

export interface ParsedCid {
  readonly version: 0 | 1;
  readonly codec: number;
  readonly multihash: { readonly code: number; readonly digest: Uint8Array };
  /** The CID exactly as written in the URI. */
  readonly text: string;
}

export interface ParsedIpfsUri {
  readonly cid: ParsedCid;
  /** Path below the CID, without a leading slash; "" for none. */
  readonly path: string;
}

/* ---------------------------------------------------------------------------
   Multibase decoders. Only the bases a CID is written in: base32 lower and
   upper (`b`/`B`, CIDv1's default), base58btc (`z`, and every CIDv0), hex
   (`f`/`F`).
   --------------------------------------------------------------------------- */

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function decodeBase32(text: string): Uint8Array | null {
  if (text.length === 0) return null;
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of text) {
    const v = BASE32_ALPHABET.indexOf(ch);
    if (v < 0) return null;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  /* Trailing bits must be padding zeros, and fewer than one byte of them. */
  if (bits >= 5 || (value & ((1 << bits) - 1)) !== 0) return null;
  return Uint8Array.from(out);
}

function encodeBase32(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function decodeBase58(text: string): Uint8Array | null {
  if (text.length === 0) return null;
  let n = 0n;
  for (const ch of text) {
    const v = BASE58_ALPHABET.indexOf(ch);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.push(Number(n & 0xffn));
    n >>= 8n;
  }
  bytes.reverse();
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros++;
  return Uint8Array.from([...new Array<number>(zeros).fill(0), ...bytes]);
}

function decodeHex(text: string): Uint8Array | null {
  if (text.length === 0 || text.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(text)) return null;
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Unsigned LEB128 varint; returns [value, bytesRead] or null when truncated or oversized. */
function readVarint(bytes: Uint8Array, offset: number): [number, number] | null {
  let value = 0;
  let shift = 0;
  let i = offset;
  for (;;) {
    if (i >= bytes.length || shift > 28) return null;
    const b = bytes[i]!;
    value |= (b & 0x7f) << shift;
    i++;
    if ((b & 0x80) === 0) return [value >>> 0, i - offset];
    shift += 7;
  }
}

/**
 * Parse a CID as written: `Qm…` (v0, base58btc, dag-pb + sha2-256) or a
 * multibase-prefixed v1. Returns null for anything else, including a v1 whose
 * bytes do not decode to exactly one multihash.
 */
export function parseCid(text: string): ParsedCid | null {
  if (typeof text !== "string" || text.length < 2) return null;
  if (text.length === 46 && text.startsWith("Qm")) {
    const raw = decodeBase58(text);
    if (raw === null || raw.length !== 34 || raw[0] !== MULTIHASH_SHA2_256 || raw[1] !== 32) return null;
    return { version: 0, codec: IPFS_CODEC_DAG_PB, multihash: { code: MULTIHASH_SHA2_256, digest: raw.subarray(2) }, text };
  }
  const prefix = text[0]!;
  const body = text.slice(1);
  let bytes: Uint8Array | null;
  switch (prefix) {
    case "b":
      bytes = decodeBase32(body);
      break;
    case "B":
      bytes = decodeBase32(body.toLowerCase());
      break;
    case "z":
      bytes = decodeBase58(body);
      break;
    case "f":
    case "F":
      bytes = decodeHex(body);
      break;
    default:
      return null;
  }
  if (bytes === null) return null;
  const version = readVarint(bytes, 0);
  if (version === null || version[0] !== 1) return null;
  const codec = readVarint(bytes, version[1]);
  if (codec === null) return null;
  let at = version[1] + codec[1];
  const code = readVarint(bytes, at);
  if (code === null) return null;
  at += code[1];
  const length = readVarint(bytes, at);
  if (length === null) return null;
  at += length[1];
  if (bytes.length !== at + length[0]) return null;
  return { version: 1, codec: codec[0], multihash: { code: code[0], digest: bytes.subarray(at) }, text };
}

/**
 * `ipfs://<cid>`, `ipfs://<cid>/<path>`, or a bare CID. Anything else —
 * https URLs, gateway URLs, `data:`, an empty string — is null: a listing
 * may say what it likes, and only an IPFS reference is resolved here.
 */
export function parseIpfsUri(uri: string): ParsedIpfsUri | null {
  if (typeof uri !== "string") return null;
  const s = uri.trim();
  let rest: string;
  if (/^ipfs:\/\//i.test(s)) rest = s.slice(7);
  else if (s.startsWith("/ipfs/")) rest = s.slice(6);
  else if (!s.includes("/") && !s.includes(":")) rest = s;
  else return null;
  /* Tolerate the `ipfs://ipfs/<cid>` spelling some tools emit. */
  if (rest.startsWith("ipfs/")) rest = rest.slice(5);
  const slash = rest.indexOf("/");
  const cidText = slash < 0 ? rest : rest.slice(0, slash);
  const path = slash < 0 ? "" : rest.slice(slash + 1).replace(/^\/+/, "");
  if (path.split("/").some((seg) => seg === "." || seg === "..") || /[?#]/.test(path)) return null;
  const cid = parseCid(cidText);
  if (cid === null) return null;
  return { cid, path };
}

function isAllowedGateway(g: string): boolean {
  let u: URL;
  try {
    u = new URL(g);
  } catch {
    return false;
  }
  if (u.username !== "" || u.password !== "" || u.search !== "" || u.hash !== "") return false;
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]");
}

/**
 * The gateway list for a deployment: an optional own gateway first (from
 * `own`, or `env[IPFS_GATEWAY_ENV]`), then the public defaults. An own
 * gateway that is not https (or http on loopback) is dropped, not trusted.
 */
export function ipfsGateways(opts: { own?: string | null; env?: Record<string, string | undefined> } = {}): readonly string[] {
  const own = opts.own ?? opts.env?.[IPFS_GATEWAY_ENV] ?? null;
  const list: string[] = [];
  if (typeof own === "string" && own.trim() !== "") {
    const g = own.trim().replace(/\/*$/, "/");
    if (isAllowedGateway(g)) list.push(g);
  }
  for (const g of IPFS_GATEWAYS) if (!list.includes(g)) list.push(g);
  return list;
}

/**
 * Every https URL an IPFS reference resolves to, one per allowed gateway, in
 * the order to try them. Null when the input is not an IPFS reference. The
 * gateway is never taken from the URI, and a gateway outside the allow-list
 * (not https, credentials, a query) is skipped.
 */
export function ipfsToHttp(uri: string, opts: { gateways?: readonly string[] } = {}): readonly string[] | null {
  const parsed = parseIpfsUri(uri);
  if (parsed === null) return null;
  const gateways = opts.gateways ?? IPFS_GATEWAYS;
  const suffix = parsed.path === "" ? "" : "/" + parsed.path.split("/").map(encodeURIComponent).join("/");
  const out: string[] = [];
  for (const g of gateways) {
    const base = g.replace(/\/*$/, "/");
    if (!isAllowedGateway(base)) continue;
    out.push(`${base}${parsed.cid.text}${suffix}`);
  }
  return out;
}

/**
 * The CIDv1 `raw` + sha2-256 CID of `bytes`, base32 (`bafkrei…`): what a
 * single-block pin of these bytes is named. `verifyRawCid(rawCid(b), b)` is
 * true by construction; a pin service answering with a different CID for the
 * same bytes did not pin them as one raw block.
 */
export function rawCid(bytes: Uint8Array): string {
  const digest = sha256(bytes, "bytes");
  const cid = new Uint8Array(4 + digest.length);
  cid[0] = 1;
  cid[1] = IPFS_CODEC_RAW;
  cid[2] = MULTIHASH_SHA2_256;
  cid[3] = digest.length;
  cid.set(digest, 4);
  return "b" + encodeBase32(cid);
}

/**
 * True exactly when `cid` is a CIDv1 `raw` + sha2-256 CID of `bytes` — the
 * shape a single-block pin produces — so the bytes can be shown as verified.
 * False for a dag-pb CID (v0 or v1), another hash, a path-bearing URI, or a
 * mismatch: never a throw, so a renderer can fall back to "unverified".
 */
export function verifyRawCid(cid: string | ParsedCid, bytes: Uint8Array): boolean {
  const parsed = typeof cid === "string" ? (parseIpfsUri(cid)?.path === "" ? parseIpfsUri(cid)!.cid : null) : cid;
  if (parsed === null || parsed.version !== 1 || parsed.codec !== IPFS_CODEC_RAW) return false;
  if (parsed.multihash.code !== MULTIHASH_SHA2_256 || parsed.multihash.digest.length !== 32) return false;
  const digest = sha256(bytes, "bytes");
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= digest[i]! ^ parsed.multihash.digest[i]!;
  return diff === 0;
}
