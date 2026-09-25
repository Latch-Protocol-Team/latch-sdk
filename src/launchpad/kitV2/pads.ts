// SPDX-License-Identifier: MIT
/* ============================================================================
   Pads: a launchpad (and DEX) somebody else runs on the shared core, as one
   transferable contract per tenant.

   `LatchPadFactory.createPad` clones a `LatchPad` and makes it a
   `LaunchpadKitV2` tenant in the same transaction. The pad is the tenant: every
   launch through it names the pad, its config lives on the kit under the pad's
   address, and the pad changes hands two-step. The pad holds nothing; its
   `integrator` wallet is where the lockers and the kit credit fees.

   THE BRAND is the pad's `metadataURI`. This module defines the JSON it points
   at (`PadBrand`), encodes it as an inline `data:` URI so a pad needs no server
   to publish - one `setMetadata` transaction and any front end can render it -
   and decodes whatever a pad carries back into a typed object, refusing
   anything malformed rather than filling it in.

   NOTHING HERE IS ENFORCED BY THE PAD except what the kit enforces (the tenant
   terms). `dex.feeBps` in the brand is a request to whichever front end hosts
   the pad: a Latch-hosted pad site takes it as the swap-output fee, capped by
   the widgets' own ceiling; a third-party front end may ignore it.

   THE SITE FEE. `createPad` is payable: `msg.value >= padFeeWei()`, the
   surplus refunded in the same call, the fee credited to the factory and moved
   to its immutable `protocolFeeRecipient` (the governance Safe) by the
   permissionless `flushProtocolFees`. The Safe sets the fee inside an
   immutable cap; an increase takes effect by itself `padFeeNoticeSeconds`
   after it is announced, a decrease at once. Exactly the kit's launch-fee
   mechanism, so `readPadFactoryFee` / `padSafeValue` mirror `fees.ts`: send
   the higher of the fee in force and the announced one and a create signed
   before `effectiveAt` and mined after it cannot revert. The contract stores
   wei; a USD figure is the Safe's off-chain conversion and is never here.
   ============================================================================ */

import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  getAbiItem,
  getAddress,
  getContractAddress,
  isHex,
  keccak256,
  size,
  toBytes,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { LATCH_CHAIN_IDS, getDeployment, type LatchChainId } from "../../deployments/index.js";

import { LATCH_PAD_ABI, LATCH_PAD_FACTORY_ABI } from "../generated/abi.js";
import { PRESET, PRESET_NAMES, type PresetName } from "../presets.js";
import { decodeTenantConfig, type DecodedTenantConfig } from "./fees.js";
import { BIN_SHAPE, BIN_SHAPE_NAMES, type BinShapeName, type TenantConfigV2 } from "./types.js";

/* ------------------------------------------------------------ the brand --- */

/** The version this module writes. A reader refuses an unknown version rather than guessing fields. */
export const PAD_BRAND_VERSION = 1;

/** The eight theme packs a Latch-hosted pad site ships. Names are Latch's own. */
export const PAD_THEMES = {
  mono: "black screen, monospace type, blinking cursor",
  press: "paper, serif headlines, column rules",
  frost: "frosted cards over a colour mesh",
  arcade: "pixel type, neon frames",
  block: "thick borders, hard shadows",
  soft: "rounded shapes, pastel fills",
  chrome: "chrome gradients, sparkles, bubble type",
  hazard: "caution tape, condensed type",
} as const;
export type PadTheme = keyof typeof PAD_THEMES;
export const PAD_THEME_NAMES = Object.keys(PAD_THEMES) as readonly PadTheme[];

/** `MAX_METADATA_URI_BYTES` on the pad. Mirrored for the pre-flight; the pad is the authority. */
export const PAD_MAX_METADATA_URI_BYTES = 4096;
/** The widgets' ceiling on a swap-output fee, mirrored (1%). */
export const PAD_MAX_DEX_FEE_BPS = 100;

export const PAD_KINDS = ["launchpad", "dex", "both"] as const;
export type PadKind = (typeof PAD_KINDS)[number];
export const PAD_DEX_SCOPES = ["launches", "all"] as const;
export type PadDexScope = (typeof PAD_DEX_SCOPES)[number];

/** The kind a brand means, with the default applied. */
export function padKindOf(brand: PadBrand | null | undefined): PadKind {
  return brand?.kind ?? "launchpad";
}
/** The DEX scope a brand means, with the default applied. */
export function padDexScopeOf(brand: PadBrand | null | undefined): PadDexScope {
  return brand?.dex?.scope ?? "launches";
}

/** The widget variables a brand may override, and how each is validated. */
export const PAD_WIDGET_VARS = {
  bg: "color",
  bgElevated: "color",
  text: "color",
  textMuted: "color",
  accent: "color",
  accentText: "color",
  border: "color",
  radius: "px",
  font: "font",
} as const;
export type PadWidgetVar = keyof typeof PAD_WIDGET_VARS;
export const PAD_WIDGET_VAR_NAMES = Object.keys(PAD_WIDGET_VARS) as readonly PadWidgetVar[];
/** The `--latch-*` custom property each key maps to (documented in @latchprotocol/widgets). */
export const PAD_WIDGET_CSS_VARS: Readonly<Record<PadWidgetVar, string>> = {
  bg: "--latch-bg",
  bgElevated: "--latch-bg-elevated",
  text: "--latch-text",
  textMuted: "--latch-text-muted",
  accent: "--latch-accent",
  accentText: "--latch-accent-text",
  border: "--latch-border",
  radius: "--latch-radius",
  font: "--latch-font",
};
const PX_RE = /^(?:[0-9]|[1-3][0-9])px$/;
const FONT_RE = /^[A-Za-z0-9 ,'"-]{1,80}$/;

export interface PadBrand {
  readonly v: typeof PAD_BRAND_VERSION;
  readonly tagline?: string;
  /** An `https://` or `ipfs://` URL. Never bytes: a KB of PNG would not fit the pad's limit and does not belong on chain. */
  readonly logoUrl?: string;
  /** `#rrggbb`. */
  readonly accent?: string;
  readonly theme?: PadTheme;
  readonly links?: {
    readonly website?: string;
    readonly x?: string;
    readonly telegram?: string;
    readonly discord?: string;
    readonly docs?: string;
  };
  /**
   * What the hosted site IS. `launchpad` (the default when absent): launches
   * through this pad, with a swap tab over their pools. `dex`: a trading front
   * over Latch pools with this pad's integrator wallet taking `dex.feeBps`, no
   * launch surface. `both`: a launchpad with a full DEX beside it. The same
   * `LatchPad` contract backs all three; the kind only changes what the site
   * renders and which pools it routes through.
   */
  readonly kind?: PadKind;
  /**
   * The DEX tab. `feeBps` is the swap-OUTPUT fee a hosting front end takes for
   * the pad's integrator wallet. `scope` picks the pools: `launches` (the
   * default) routes only through this pad's own launch pools; `all` routes
   * through every pool initialised on the chain's Latch pool managers.
   */
  readonly dex?: { readonly enabled: boolean; readonly feeBps: number; readonly scope?: PadDexScope };
  readonly launchpad?: { readonly enabled: boolean };
  /**
   * How the embedded widgets (swap, launch, liquidity) look on this site.
   * By default they inherit the theme pack. These override individual
   * `--latch-*` variables; only the keys in `PAD_WIDGET_VARS` are accepted,
   * colours as `#rrggbb`, radius as `<n>px`, font as a plain family list.
   */
  readonly widget?: { readonly vars?: Partial<Record<PadWidgetVar, string>> };
  /**
   * A hostname the pad owner wants the hosted pad site served on, e.g.
   * `launch.mochi.xyz` - lowercase, no scheme, no path. This is the OWNER'S half
   * of a two-sided proof: the other half is a DNS CNAME from that hostname to
   * Latch's pad host, which only the domain's owner can set. An edge serves the
   * pad on the hostname only when both agree; neither side alone does anything.
   */
  readonly customDomain?: string;
  /**
   * Token lists (Uniswap Token Lists standard) the hosted site offers in its
   * swap picker beside Latch's own list for the chain and the list of this
   * pad's launches: at most `PAD_MAX_TOKEN_LISTS` `https://` URLs. A list is
   * fetched, schema-validated and size-capped by the SDK; the first list to
   * name an address wins; a list that fails to load contributes nothing and
   * the picker says so. Nothing here is verified by the pad: a list is the
   * operator's word about which tokens its site should show.
   */
  readonly tokenLists?: readonly string[];
}

/** The most token-list URLs a brand may carry. */
export const PAD_MAX_TOKEN_LISTS = 5;

/** RFC 1123 hostname: labels of [a-z0-9-], no leading/trailing hyphen, at least one dot, <= 253 chars. */
export const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/** `brand.customDomain` when it is a valid hostname, else `null`. Never a default. */
export function padHostnameOf(brand: PadBrand | null | undefined): string | null {
  const host = brand?.customDomain;
  return host !== undefined && HOSTNAME_RE.test(host) ? host : null;
}

/* ------------------------------------------------ brand, for display ---
   What a directory card or a site header may RENDER from a brand. The stored
   schema is unchanged (logoUrl and links.* stay `https://` or `ipfs://`, so a
   brand written by an older SDK still decodes); these readers are stricter,
   because rendering is where a bad value does harm:
     · a logo renders only from `https://` (a browser cannot load `ipfs://`,
       and Latch fetches nothing on the owner's behalf);
     · a website links only to `https://`;
     · the X link is shown only when it names an X profile.
   Each returns `null` rather than a default: no logo means a monogram, no X
   profile means no X link. */

/** An X (Twitter) handle: 1-15 of [A-Za-z0-9_]. */
export const PAD_X_HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const X_PROFILE_URL_RE = /^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?(?:[?#].*)?$/i;

export interface PadXProfile {
  /** Without the `@`. */
  readonly handle: string;
  /** Always `https://x.com/<handle>`. */
  readonly url: string;
}

/** The X profile a stored `links.x` names, or `null` when it is absent or not an x.com / twitter.com profile URL. */
export function padXOf(brand: PadBrand | null | undefined): PadXProfile | null {
  const raw = brand?.links?.x;
  if (raw === undefined) return null;
  const m = X_PROFILE_URL_RE.exec(raw);
  const handle = m?.[1];
  return handle === undefined ? null : { handle, url: `https://x.com/${handle}` };
}

/**
 * What an owner typed in an X field, as the URL a brand stores: `@name`,
 * `name`, `x.com/name`, `twitter.com/name` (scheme optional) all become
 * `https://x.com/name`. `''` means "no X link". Anything else is refused with
 * a message; nothing is guessed.
 */
export function normalizePadXInput(input: string): { readonly ok: true; readonly url: string | null } | { readonly ok: false; readonly message: string } {
  const t = input.trim();
  if (t === "") return { ok: true, url: null };
  const bare = t.startsWith("@") ? t.slice(1) : t;
  if (PAD_X_HANDLE_RE.test(bare)) return { ok: true, url: `https://x.com/${bare}` };
  const withScheme = /^https?:\/\//i.test(t) ? t.replace(/^http:\/\//i, "https://") : `https://${t}`;
  const m = X_PROFILE_URL_RE.exec(withScheme);
  const handle = m?.[1];
  if (handle !== undefined) return { ok: true, url: `https://x.com/${handle}` };
  return { ok: false, message: "must be an X handle (@name, up to 15 letters, digits or _) or an x.com / twitter.com profile URL" };
}

/** `brand.logoUrl` when it is an `https://` URL a browser can load, else `null` (render a monogram). */
export function padLogoSrcOf(brand: PadBrand | null | undefined): string | null {
  const u = brand?.logoUrl;
  return u !== undefined && /^https:\/\/[^\s"'<>]+$/.test(u) && u.length <= 512 ? u : null;
}

/** `brand.links.website` when it is an `https://` URL, else `null`. */
export function padWebsiteOf(brand: PadBrand | null | undefined): string | null {
  const u = brand?.links?.website;
  return u !== undefined && /^https:\/\/[^\s"'<>]+$/.test(u) && u.length <= 512 ? u : null;
}

/** One or two capital letters for a name, for a logo's typographic fallback. `''` when nothing is usable. */
export function padMonogramOf(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w !== "");
  if (words.length === 0) return "";
  const first = words[0] as string;
  const second = words[1];
  return (second === undefined ? first.slice(0, 2) : first[0]! + second[0]!).toUpperCase();
}

export interface PadBrandIssue {
  readonly field: string;
  readonly message: string;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const URL_OK = /^(https:\/\/|ipfs:\/\/)[^\s]+$/;

function checkUrl(value: unknown, field: string, issues: PadBrandIssue[]): void {
  if (value === undefined) return;
  if (typeof value !== "string" || !URL_OK.test(value) || value.length > 512) {
    issues.push({ field, message: "must be an https:// or ipfs:// URL of at most 512 characters" });
  }
}

/** Every objection to a brand, cheapest first. An empty list means it will encode and decode faithfully. */
export function validatePadBrand(brand: unknown): readonly PadBrandIssue[] {
  const issues: PadBrandIssue[] = [];
  if (typeof brand !== "object" || brand === null) return [{ field: "", message: "the brand must be an object" }];
  const b = brand as Record<string, unknown>;
  if (b["v"] !== PAD_BRAND_VERSION) issues.push({ field: "v", message: `must be ${PAD_BRAND_VERSION}` });
  if (b["tagline"] !== undefined && (typeof b["tagline"] !== "string" || b["tagline"].length > 140)) {
    issues.push({ field: "tagline", message: "must be a string of at most 140 characters" });
  }
  checkUrl(b["logoUrl"], "logoUrl", issues);
  if (b["accent"] !== undefined && (typeof b["accent"] !== "string" || !HEX_COLOR.test(b["accent"]))) {
    issues.push({ field: "accent", message: "must be a #rrggbb colour" });
  }
  if (b["theme"] !== undefined && !(PAD_THEME_NAMES as readonly string[]).includes(String(b["theme"]))) {
    issues.push({ field: "theme", message: `must be one of ${PAD_THEME_NAMES.join(", ")}` });
  }
  const links = b["links"];
  if (links !== undefined) {
    if (typeof links !== "object" || links === null) {
      issues.push({ field: "links", message: "must be an object" });
    } else {
      for (const k of ["website", "x", "telegram", "discord", "docs"]) {
        checkUrl((links as Record<string, unknown>)[k], `links.${k}`, issues);
      }
    }
  }
  const dex = b["dex"];
  if (dex !== undefined) {
    const d = dex as Record<string, unknown>;
    if (typeof dex !== "object" || dex === null || typeof d["enabled"] !== "boolean") {
      issues.push({ field: "dex", message: "must be { enabled: boolean, feeBps: number }" });
    } else if (!Number.isInteger(d["feeBps"]) || (d["feeBps"] as number) < 0 || (d["feeBps"] as number) > PAD_MAX_DEX_FEE_BPS) {
      issues.push({ field: "dex.feeBps", message: `must be a whole number of basis points in 0..${PAD_MAX_DEX_FEE_BPS}` });
    }
    if (d["scope"] !== undefined && !(PAD_DEX_SCOPES as readonly string[]).includes(String(d["scope"]))) {
      issues.push({ field: "dex.scope", message: `must be one of ${PAD_DEX_SCOPES.join(", ")}` });
    }
  }
  if (b["kind"] !== undefined && !(PAD_KINDS as readonly string[]).includes(String(b["kind"]))) {
    issues.push({ field: "kind", message: `must be one of ${PAD_KINDS.join(", ")}` });
  }
  const lp = b["launchpad"];
  if (lp !== undefined && (typeof lp !== "object" || lp === null || typeof (lp as Record<string, unknown>)["enabled"] !== "boolean")) {
    issues.push({ field: "launchpad", message: "must be { enabled: boolean }" });
  }
  const widget = b["widget"];
  if (widget !== undefined) {
    const w = widget as Record<string, unknown>;
    if (typeof widget !== "object" || widget === null || (w["vars"] !== undefined && (typeof w["vars"] !== "object" || w["vars"] === null))) {
      issues.push({ field: "widget", message: "must be { vars?: { <key>: string } }" });
    } else if (w["vars"] !== undefined) {
      for (const [k, v] of Object.entries(w["vars"] as Record<string, unknown>)) {
        const kind = (PAD_WIDGET_VARS as Record<string, string>)[k];
        if (kind === undefined) issues.push({ field: `widget.vars.${k}`, message: `unknown key; allowed: ${PAD_WIDGET_VAR_NAMES.join(", ")}` });
        else if (typeof v !== "string") issues.push({ field: `widget.vars.${k}`, message: "must be a string" });
        else if (kind === "color" && !HEX_COLOR.test(v)) issues.push({ field: `widget.vars.${k}`, message: "must be a #rrggbb colour" });
        else if (kind === "px" && !PX_RE.test(v)) issues.push({ field: `widget.vars.${k}`, message: "must be 0px to 39px" });
        else if (kind === "font" && !FONT_RE.test(v)) issues.push({ field: `widget.vars.${k}`, message: "must be a plain font-family list (letters, digits, spaces, commas, quotes, hyphens; at most 80 characters)" });
      }
    }
  }
  const host = b["customDomain"];
  if (host !== undefined && (typeof host !== "string" || !HOSTNAME_RE.test(host))) {
    issues.push({ field: "customDomain", message: "must be a lowercase hostname such as launch.example.com (no scheme, no path)" });
  }
  const lists = b["tokenLists"];
  if (lists !== undefined) {
    if (!Array.isArray(lists)) {
      issues.push({ field: "tokenLists", message: "must be an array of https:// URLs" });
    } else {
      if (lists.length > PAD_MAX_TOKEN_LISTS) issues.push({ field: "tokenLists", message: `at most ${PAD_MAX_TOKEN_LISTS} token lists` });
      const seen = new Set<string>();
      lists.forEach((u, i) => {
        if (typeof u !== "string" || !/^https:\/\/[^\s]+$/.test(u) || u.length > 512) {
          issues.push({ field: `tokenLists[${i}]`, message: "must be an https:// URL of at most 512 characters (ipfs:// lists are not fetched)" });
        } else if (seen.has(u)) {
          issues.push({ field: `tokenLists[${i}]`, message: "listed twice" });
        } else {
          seen.add(u);
        }
      });
    }
  }
  return issues;
}

const DATA_JSON_PREFIX = "data:application/json";

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * The brand as an inline `data:application/json;base64,...` URI, the form a
 * pad stores. Throws on an invalid brand or one that would exceed the pad's
 * byte limit — send nothing the pad would refuse.
 */
export function encodePadMetadataURI(brand: PadBrand): string {
  const issues = validatePadBrand(brand);
  if (issues.length > 0) {
    throw new RangeError(`invalid pad brand: ${issues.map((i) => `${i.field}: ${i.message}`).join("; ")}`);
  }
  const uri = `${DATA_JSON_PREFIX};base64,${toBase64(JSON.stringify(brand))}`;
  const bytes = new TextEncoder().encode(uri).length;
  if (bytes > PAD_MAX_METADATA_URI_BYTES) {
    throw new RangeError(`the encoded brand is ${bytes} bytes; the pad stores at most ${PAD_MAX_METADATA_URI_BYTES}`);
  }
  return uri;
}

/** What a pad's `metadataURI` turned out to be. */
export type PadMetadata =
  | { readonly kind: "brand"; readonly brand: PadBrand }
  | { readonly kind: "remote"; readonly url: string }
  | { readonly kind: "empty" }
  | { readonly kind: "invalid"; readonly reason: string };

/**
 * Decodes a pad's `metadataURI`. Inline JSON is parsed and validated; an
 * `ipfs://` or `https://` pointer is returned for the caller to fetch (and
 * validate with `validatePadBrand`); anything else is `invalid` with a reason —
 * never a default brand.
 */
export function decodePadMetadataURI(uri: string): PadMetadata {
  if (uri === "") return { kind: "empty" };
  if (uri.startsWith("ipfs://") || uri.startsWith("https://")) return { kind: "remote", url: uri };
  if (!uri.startsWith(DATA_JSON_PREFIX)) return { kind: "invalid", reason: "not a data:application/json, ipfs:// or https:// URI" };
  const comma = uri.indexOf(",");
  if (comma === -1) return { kind: "invalid", reason: "data URI has no payload" };
  const params = uri.slice(DATA_JSON_PREFIX.length, comma);
  const payload = uri.slice(comma + 1);
  let text: string;
  try {
    text = params.includes(";base64") ? fromBase64(payload) : decodeURIComponent(payload);
  } catch {
    return { kind: "invalid", reason: "data URI payload is not decodable" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "invalid", reason: "data URI payload is not JSON" };
  }
  const issues = validatePadBrand(parsed);
  if (issues.length > 0) {
    return { kind: "invalid", reason: issues.map((i) => `${i.field}: ${i.message}`).join("; ") };
  }
  return { kind: "brand", brand: parsed as PadBrand };
}

/* -------------------------------------------------------- tenant terms --- */

/** Bit i allows `Preset(i)`. */
export function presetMask(names: readonly PresetName[]): number {
  let mask = 0;
  for (const n of names) mask |= 1 << PRESET[n];
  return mask;
}

/** Bit i allows `BinShape(i)`. An empty list forbids Bin legs. */
export function binShapeMask(names: readonly BinShapeName[]): number {
  let mask = 0;
  for (const n of names) mask |= 1 << BIN_SHAPE[n];
  return mask;
}

/** The terms a pad owner chooses, in names rather than bitmasks. */
export interface PadTerms {
  /** Where the pad's launch fees and locked-LP fee shares are paid. Never the pad. */
  readonly integrator: Address;
  /** Basis points of every locked position's LP fees, within the lockers' cap. */
  readonly integratorBps: number;
  /** Native wei per launch, within the kit's cap. */
  readonly integratorLaunchFeeWei: bigint;
  readonly allowedPresets: readonly PresetName[];
  readonly allowedBinShapes: readonly BinShapeName[];
  readonly restrictQuotes: boolean;
  readonly active: boolean;
  /**
   * The creator tax through this pad. `maxTaxBps` caps a launch's buy and sell rates (0 forbids a
   * tax; at most the guard's `MAX_TAX_BPS`, 10%); `taxIntegratorBps` is the pad's share of every
   * tax, which a launch through it must restate (at most the guard's 20% cap). Both default to 0:
   * an older pad, or one that never chose, allows no creator tax until its owner sets these.
   */
  readonly maxTaxBps?: number;
  readonly taxIntegratorBps?: number;
}

/** `struct TenantConfig`, as `setTenantConfig` / `LatchPad.configure` take it. */
export function tenantConfigFromTerms(terms: PadTerms): TenantConfigV2 {
  return {
    integrator: terms.integrator,
    integratorBps: terms.integratorBps,
    integratorLaunchFeeWei: terms.integratorLaunchFeeWei,
    allowedPresets: presetMask(terms.allowedPresets.length === 0 ? PRESET_NAMES : terms.allowedPresets),
    allowedBinShapes: binShapeMask(terms.allowedBinShapes),
    restrictQuotes: terms.restrictQuotes,
    active: terms.active,
    maxTaxBps: terms.maxTaxBps ?? 0,
    taxIntegratorBps: terms.taxIntegratorBps ?? 0,
  };
}

/** Every preset and every named Bin shape allowed: the default for a new pad. */
export const ALL_PRESETS: readonly PresetName[] = PRESET_NAMES;
export const ALL_BIN_SHAPES: readonly BinShapeName[] = BIN_SHAPE_NAMES;

/* ------------------------------------------------------------- site fee --- */

/** `pendingPadFee()`, with its `(0, 0)` "none" answer turned into `null`. */
export interface PendingPadFee {
  readonly feeWei: bigint;
  /** Unix seconds (`block.timestamp`). */
  readonly effectiveAt: bigint;
}

/** What the factory charges for a pad, read live. */
export interface PadFactoryFee {
  /** `padFeeWei()`: the site fee a `createPad` in the block that was read pays. */
  readonly feeWei: bigint;
  /** An announced increase not yet in force, or `null`. */
  readonly pending: PendingPadFee | null;
  /** `maxPadFeeWei`: the immutable ceiling the Safe can never exceed. */
  readonly capWei: bigint;
  /** `padFeeNoticeSeconds`: how long an announced increase waits. */
  readonly noticeSeconds: number;
  /** `protocolFeeRecipient`: the only address `flushProtocolFees` can pay (the Safe). */
  readonly recipient: Address;
  /** `protocolFeesOwed`: credited by createPad, not yet flushed. */
  readonly owedWei: bigint;
}

/** `pendingPadFee()` decoded. `(0, 0)` means none. */
export function decodePendingPadFee(raw: readonly [bigint, bigint]): PendingPadFee | null {
  const [feeWei, effectiveAt] = raw;
  return effectiveAt === 0n ? null : { feeWei, effectiveAt };
}

/**
 * `max(feeWei, pending.feeWei)`: a `msg.value` that cannot revert
 * `InsufficientPadFee` whichever side of `effectiveAt` the transaction lands.
 * The factory refunds the difference to the sender in the same call.
 */
export function padSafeValue(fee: Pick<PadFactoryFee, "feeWei" | "pending">): bigint {
  if (fee.feeWei < 0n) throw new RangeError("fees are non-negative");
  const atPending = fee.pending === null ? 0n : fee.pending.feeWei;
  return atPending > fee.feeWei ? atPending : fee.feeWei;
}

/** The factory's fee state, six reads (not one block: a pending increase can land between them; `padSafeValue` covers it). */
export async function readPadFactoryFee(client: PublicClient, factory: Address): Promise<PadFactoryFee> {
  const r = <
    F extends "padFeeWei" | "pendingPadFee" | "maxPadFeeWei" | "padFeeNoticeSeconds" | "protocolFeeRecipient" | "protocolFeesOwed",
  >(
    functionName: F,
  ) => client.readContract({ address: factory, abi: LATCH_PAD_FACTORY_ABI, functionName });
  const [feeWei, pending, capWei, noticeSeconds, recipient, owedWei] = await Promise.all([
    r("padFeeWei"),
    r("pendingPadFee"),
    r("maxPadFeeWei"),
    r("padFeeNoticeSeconds"),
    r("protocolFeeRecipient"),
    r("protocolFeesOwed"),
  ]);
  return { feeWei, pending: decodePendingPadFee(pending), capWei, noticeSeconds: Number(noticeSeconds), recipient, owedWei };
}

/* ------------------------------------------------------------- encoding --- */

/**
 * `LatchPadFactory.createPad(userSalt, name, metadataURI, config, allowedQuotes)` calldata. Pair it with
 * `padSafeValue` for `msg.value`.
 *
 * `userSalt` fixes the pad's address together with the SENDER (see "multi-chain identity" below). Omitted,
 * it is `padUserSaltFromLabel(name)`, so one wallet creating "Mochi Pad" on several chains gets one address
 * without storing anything; a second pad of the same name from the same wallet on one chain needs an
 * explicit salt (the factory refuses a reused salt with `PadAlreadyExists`).
 */
export function encodeCreatePad(args: {
  readonly name: string;
  readonly brand: PadBrand | null;
  readonly terms: PadTerms;
  readonly allowedQuotes?: readonly Address[] | undefined;
  readonly userSalt?: Hex | undefined;
}): Hex {
  return encodeFunctionData({
    abi: LATCH_PAD_FACTORY_ABI,
    functionName: "createPad",
    args: [
      args.userSalt ?? padUserSaltFromLabel(args.name),
      args.name,
      args.brand === null ? "" : encodePadMetadataURI(args.brand),
      tenantConfigFromTerms(args.terms),
      [...(args.allowedQuotes ?? [])],
    ],
  });
}

/**
 * The whole `createPad` transaction: target, calldata and the value that pays
 * the site fee whichever side of a scheduled increase it is mined on.
 */
export function buildCreatePad(args: {
  readonly factory: Address;
  readonly name: string;
  readonly brand: PadBrand | null;
  readonly terms: PadTerms;
  readonly allowedQuotes?: readonly Address[] | undefined;
  /** Defaults to `padUserSaltFromLabel(name)`. Use the SAME value on every chain for the same address. */
  readonly userSalt?: Hex | undefined;
  /** From `readPadFactoryFee`. */
  readonly fee: Pick<PadFactoryFee, "feeWei" | "pending">;
}): { readonly to: Address; readonly data: Hex; readonly value: bigint } {
  return { to: args.factory, data: encodeCreatePad(args), value: padSafeValue(args.fee) };
}

/** `LatchPadFactory.setPadFee` calldata, for a Safe transaction. */
export function encodeSetPadFee(feeWei: bigint): Hex {
  return encodeFunctionData({ abi: LATCH_PAD_FACTORY_ABI, functionName: "setPadFee", args: [feeWei] });
}

/** `LatchPadFactory.cancelPendingPadFee` calldata, for a Safe transaction. */
export function encodeCancelPendingPadFee(): Hex {
  return encodeFunctionData({ abi: LATCH_PAD_FACTORY_ABI, functionName: "cancelPendingPadFee", args: [] });
}

/** `LatchPadFactory.flushProtocolFees` calldata (permissionless). */
export function encodeFlushPadFees(): Hex {
  return encodeFunctionData({ abi: LATCH_PAD_FACTORY_ABI, functionName: "flushProtocolFees", args: [] });
}

/** `LatchPad.configure` calldata. */
export function encodeConfigurePad(terms: PadTerms): Hex {
  return encodeFunctionData({ abi: LATCH_PAD_ABI, functionName: "configure", args: [tenantConfigFromTerms(terms)] });
}

/** `LatchPad.setMetadata` calldata. */
export function encodeSetPadMetadata(name: string, brand: PadBrand | null): Hex {
  return encodeFunctionData({
    abi: LATCH_PAD_ABI,
    functionName: "setMetadata",
    args: [name, brand === null ? "" : encodePadMetadataURI(brand)],
  });
}

/* ---------------------------------------------------------------- reads --- */

export interface PadRecord {
  readonly address: Address;
  readonly owner: Address;
  readonly pendingOwner: Address;
  readonly name: string;
  readonly metadataURI: string;
  readonly metadata: PadMetadata;
  /** The kit's stored config for this pad; `configured === false` when none was ever written. */
  readonly tenant: DecodedTenantConfig;
}

/** One pad, read live. */
export async function readPad(client: PublicClient, pad: Address): Promise<PadRecord> {
  const r = <F extends "owner" | "pendingOwner" | "name" | "metadataURI" | "tenantConfig">(functionName: F) =>
    client.readContract({ address: pad, abi: LATCH_PAD_ABI, functionName });
  const [owner, pendingOwner, name, metadataURI, tenant] = await Promise.all([
    r("owner"),
    r("pendingOwner"),
    r("name"),
    r("metadataURI"),
    r("tenantConfig"),
  ]);
  return {
    address: pad,
    owner,
    pendingOwner,
    name,
    metadataURI,
    metadata: decodePadMetadataURI(metadataURI),
    tenant: decodeTenantConfig(tenant),
  };
}

export const PAD_CREATED_EVENT = getAbiItem({ abi: LATCH_PAD_FACTORY_ABI, name: "PadCreated" });

/** Every pad the factory created, creation order, via `padCount` / `pads` (no log scan). */
export async function readPadAddresses(client: PublicClient, factory: Address, pageSize = 200): Promise<readonly Address[]> {
  const count = await client.readContract({ address: factory, abi: LATCH_PAD_FACTORY_ABI, functionName: "padCount" });
  const out: Address[] = [];
  for (let start = 0n; start < count; start += BigInt(pageSize)) {
    const page = await client.readContract({
      address: factory,
      abi: LATCH_PAD_FACTORY_ABI,
      functionName: "pads",
      args: [start, start + BigInt(pageSize)],
    });
    out.push(...page);
  }
  return out;
}

/** Every pad, read live. `readPadAddresses` then `readPad` each. */
export async function readPads(client: PublicClient, factory: Address): Promise<readonly PadRecord[]> {
  const addresses = await readPadAddresses(client, factory);
  return Promise.all(addresses.map((pad) => readPad(client, pad)));
}

/* ---------------------------------------------------------------- slugs --- */

/**
 * THE SLUG RULE. A hosted site's URL ends in its NAME, not its contract
 * address: `/p/mochi-pad`, never `/p/0x77D9…`. The slug is derived from the
 * pad's on-chain `name()` and nothing else, so any front end computes the
 * same one from the same read.
 *
 *   slugOf(name): lowercase; Unicode-fold to ASCII (NFKD, marks dropped);
 *   every run of anything outside [a-z0-9] becomes one `-`; no leading or
 *   trailing `-`; at most PAD_SLUG_MAX_LENGTH characters (cut, then trimmed
 *   again). A name with nothing left after folding yields ''.
 *
 *   COLLISIONS (`assignPadSlugs`): the FIRST pad by factory index owns the
 *   bare slug; every later pad with the same slug gets `<slug>-<hex4>`, the
 *   first four hex characters of its address after `0x`. A pad whose name
 *   folds to '' is `pad-<hex4>`; a slug that would read as an address is
 *   prefixed `pad-`. Uniqueness is guaranteed by widening the suffix (8, then
 *   40 hex characters) in the astronomically unlikely case `-<hex4>` is taken.
 *
 * Renaming a pad changes its slug; the address URL keeps working and the
 * site forwards it to the current slug. Slugs are never stored on chain.
 */
export const PAD_SLUG_MAX_LENGTH = 48;
export const PAD_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const ADDRESS_LIKE_RE = /^0x[0-9a-f]{40}$/;

/** `name` folded to `[a-z0-9-]`, at most {@link PAD_SLUG_MAX_LENGTH} characters; '' when nothing survives. */
export function slugOf(name: string): string {
  const folded = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return folded.length > PAD_SLUG_MAX_LENGTH ? folded.slice(0, PAD_SLUG_MAX_LENGTH).replace(/-+$/g, "") : folded;
}

/** True for a string `slugOf` could have produced (with or without a collision suffix). */
export function isPadSlug(value: string): boolean {
  return PAD_SLUG_RE.test(value) && value.length <= PAD_SLUG_MAX_LENGTH;
}

export interface PadSlugEntry {
  /** Checksummed as given. */
  readonly address: Address;
  readonly name: string;
  /** The factory index (creation order). */
  readonly index: number;
  readonly slug: string;
  /** True when this pad lost the bare slug to an earlier pad (or had no usable name). */
  readonly suffixed: boolean;
}

/**
 * Every pad's slug, given the factory's pads IN FACTORY ORDER (index 0 first).
 * Deterministic: the same list always yields the same slugs, and appending a
 * pad never changes an earlier pad's slug.
 */
export function assignPadSlugs(pads: readonly { readonly address: Address; readonly name: string }[]): readonly PadSlugEntry[] {
  const taken = new Set<string>();
  const out: PadSlugEntry[] = [];
  pads.forEach((pad, index) => {
    const hex = pad.address.slice(2).toLowerCase();
    let base = slugOf(pad.name);
    let suffixed = false;
    if (base === "") {
      base = "pad";
      suffixed = true;
    } else if (ADDRESS_LIKE_RE.test(base)) {
      base = `pad-${base}`;
    }
    let slug = base;
    if (suffixed || taken.has(slug)) {
      suffixed = true;
      for (const width of [4, 8, 40]) {
        slug = `${base}-${hex.slice(0, width)}`;
        if (!taken.has(slug)) break;
      }
    }
    taken.add(slug);
    out.push({ address: pad.address, name: pad.name, index, slug, suffixed });
  });
  return out;
}

/** The slug `address` carries in `entries`, or null when it is not a pad of that factory. */
export function padSlugFor(entries: readonly PadSlugEntry[], address: string): string | null {
  const a = address.toLowerCase();
  return entries.find((e) => e.address.toLowerCase() === a)?.slug ?? null;
}

/** The pad `slug` names in `entries` (exact, lowercase), or null. */
export function padBySlug(entries: readonly PadSlugEntry[], slug: string): PadSlugEntry | null {
  const s = slug.toLowerCase();
  return entries.find((e) => e.slug === s) ?? null;
}

/**
 * What `/p/<slug>` WOULD be for a new pad named `name`, given the pads that
 * exist: the bare slug when free, else the suffixed one — which needs the
 * address the factory will assign, unknown before creation, so the preview
 * says `<slug>-…` and that the name is taken. The builder renders this live.
 */
export function previewPadSlug(entries: readonly PadSlugEntry[], name: string): { readonly slug: string; readonly taken: boolean } {
  const base = slugOf(name);
  if (base === "") return { slug: "", taken: false };
  const bare = ADDRESS_LIKE_RE.test(base) ? `pad-${base}` : base;
  const taken = entries.some((e) => e.slug === bare);
  return { slug: taken ? `${bare}-…` : bare, taken };
}

/** The `Multicall3` deployed at the same address on most chains (Robinhood 4663 included). */
export const MULTICALL3_ADDRESS: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

/**
 * Every pad's address and `name()` from the factory: `padCount`, `pads`
 * (paged), then the names in ONE `Multicall3` aggregate when the chain has
 * one, else one `eth_call` per pad. Enough to compute every slug (the record
 * reads are not needed). Deployment order, so `assignPadSlugs` can be applied
 * to the result as is.
 */
export async function readPadNames(
  client: PublicClient,
  factory: Address,
  opts: { readonly multicallAddress?: Address | null; readonly pageSize?: number } = {},
): Promise<readonly { readonly address: Address; readonly name: string }[]> {
  const addresses = await readPadAddresses(client, factory, opts.pageSize);
  if (addresses.length === 0) return [];
  const contracts = addresses.map((address) => ({ address, abi: LATCH_PAD_ABI, functionName: "name" as const }));
  let names: readonly string[] | null = null;
  if (opts.multicallAddress !== null) {
    try {
      names = (await client.multicall({ contracts, allowFailure: false, multicallAddress: opts.multicallAddress ?? MULTICALL3_ADDRESS })) as readonly string[];
    } catch {
      /* No Multicall3 on this chain (a plain devnet), or it refused: read one by one. */
      names = null;
    }
  }
  if (names === null) names = await Promise.all(contracts.map((c) => client.readContract(c)));
  return addresses.map((address, i) => ({ address, name: names[i] as string }));
}

/** `readPadNames` then `assignPadSlugs`: the whole slug table of a factory. */
export async function readPadSlugs(client: PublicClient, factory: Address, opts?: { readonly multicallAddress?: Address | null }): Promise<readonly PadSlugEntry[]> {
  return assignPadSlugs(await readPadNames(client, factory, opts));
}

/* ------------------------------------------------- multi-chain identity ---
   ONE LAUNCHPAD, ONE ADDRESS, EVERY CHAIN (owner decision 2026-09-19).
   Multi-chain by deployment, never by bridging: a pad on each chain is its
   own contract with its own owner, brand and tenant terms, written on that
   chain, and the site fee is paid on each chain in that chain's native.
   What is shared is the ADDRESS:

     factory         CreateX CREATE3 at a salt permissioned to Latch's
                     deployer: the same on every chain whatever its
                     constructor arguments;
     implementation  the factory's nonce-1 CREATE: follows the factory;
     pad             CREATE2 clone of the implementation at
                     keccak256(abi.encode(creator, userSalt)), so
                     address = f(factory, implementation, creator, userSalt).

   The CREATOR (the wallet that SENDS createPad) is part of the address, so
   nobody can take another developer's address on a chain the developer has
   not reached yet: the same salt from another wallet lands elsewhere. The
   creator, not a later owner, extends a pad to a new chain; `padOrigin` on
   any chain where it exists returns the (creator, userSalt) to do it with.

   A chain whose address book lists a DIFFERENT factory address gives a
   different pad address; `readPadAcrossChains` says so instead of guessing.

   NAME THE CHAIN ON EVERY WRITE. Because a pad has the same address on every
   chain it is opened on, bytes sent from a wallet on the wrong chain do not
   fail - they act on that chain's copy. Pass viem's `chain` (or wagmi's
   `chainId`) when sending to a pad, and simulate on that chain's client.
   ------------------------------------------------------------------------ */

/** EIP-1167 creation code around an implementation, exactly as OpenZeppelin `Clones` deploys it. */
export function padCloneInitCode(implementation: Address): Hex {
  return concat(["0x3d602d80600a3d3981f3363d3d373d3d3d363d73", getAddress(implementation), "0x5af43d82803e903d91602b57fd5bf3"]);
}

function assertBytes32(value: Hex): Hex {
  if (!isHex(value) || size(value) !== 32) throw new RangeError(`userSalt must be 32 bytes of hex, got ${value}`);
  return value;
}

/** `LatchPadFactory.padSalt(creator, userSalt)`: the CREATE2 salt, `keccak256(abi.encode(creator, userSalt))`. */
export function padCreate2Salt(creator: Address, userSalt: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [creator, assertBytes32(userSalt)]));
}

/**
 * A user salt from a label: `keccak256("latch.pad.v1:" + label)`. The SDK's default for `createPad` is the
 * pad's name, so the same wallet creating the same name on several chains gets the same address.
 */
export function padUserSaltFromLabel(label: string): Hex {
  return keccak256(toBytes(`latch.pad.v1:${label}`));
}

/**
 * The pad address `createPad(userSalt, ...)` sent by `creator` gives on `factory`, computed OFF chain
 * (`predictPad` on the factory is the on-chain twin). `implementation` is `factory.IMPLEMENTATION()`.
 */
export function predictPadAddress(args: {
  readonly factory: Address;
  readonly implementation: Address;
  readonly creator: Address;
  readonly userSalt: Hex;
}): Address {
  return getContractAddress({
    opcode: "CREATE2",
    from: args.factory,
    salt: padCreate2Salt(args.creator, args.userSalt),
    bytecode: padCloneInitCode(args.implementation),
  });
}

/** `factory.predictPad(creator, userSalt)`, read on chain. */
export async function readPredictPad(client: PublicClient, factory: Address, creator: Address, userSalt: Hex): Promise<Address> {
  return client.readContract({ address: factory, abi: LATCH_PAD_FACTORY_ABI, functionName: "predictPad", args: [creator, assertBytes32(userSalt)] });
}

/** Where a pad came from: its creator and the salt it chose. */
export interface PadOrigin {
  readonly creator: Address;
  readonly userSalt: Hex;
}

/** `factory.padOrigin(pad)`; the `(0, 0)` "not a pad of this factory" answer is `null`. */
export async function readPadOrigin(client: PublicClient, factory: Address, pad: Address): Promise<PadOrigin | null> {
  const [creator, userSalt] = await client.readContract({ address: factory, abi: LATCH_PAD_FACTORY_ABI, functionName: "padOrigin", args: [pad] });
  return /^0x0{40}$/i.test(creator) ? null : { creator, userSalt };
}

/** The address book's `LatchPadFactory` on `chainId`, or `null` where none is deployed. */
export function padFactoryOn(chainId: number): Address | null {
  return getDeployment(chainId)?.launchpadV2.padFactory ?? null;
}

/** A `createPad` transaction prepared for one chain, from live reads on that chain. */
export interface PreparedCreatePad {
  readonly chainId: number;
  readonly factory: Address;
  /** Where the pad will be, from the factory's own `predictPad`. */
  readonly predicted: Address;
  /** True when this (creator, salt) already made a pad on this chain: sending would revert `PadAlreadyExists`. */
  readonly exists: boolean;
  readonly userSalt: Hex;
  readonly fee: PadFactoryFee;
  readonly tx: { readonly to: Address; readonly data: Hex; readonly value: bigint };
}

/**
 * Everything to create (or extend) a pad on ONE chain: reads that chain's factory fee, predicts the address
 * and whether it is taken, and builds the transaction with the fee-safe value. `factory` defaults to the
 * address book's. The same `creator` and `userSalt` on every chain give the same `predicted`, provided the
 * factories share an address. Send the tx FROM `creator`, or the pad lands somewhere else.
 */
export async function prepareCreatePad(
  client: PublicClient,
  args: {
    readonly chainId: number;
    readonly creator: Address;
    readonly name: string;
    readonly brand: PadBrand | null;
    readonly terms: PadTerms;
    readonly allowedQuotes?: readonly Address[] | undefined;
    readonly userSalt?: Hex | undefined;
    readonly factory?: Address;
  },
): Promise<PreparedCreatePad> {
  const factory = args.factory ?? padFactoryOn(args.chainId);
  if (factory === null) throw new Error(`no LatchPadFactory in the address book for chain ${args.chainId}`);
  const userSalt = args.userSalt ?? padUserSaltFromLabel(args.name);
  const [fee, predicted] = await Promise.all([readPadFactoryFee(client, factory), readPredictPad(client, factory, args.creator, userSalt)]);
  const exists = await client.readContract({ address: factory, abi: LATCH_PAD_FACTORY_ABI, functionName: "isPad", args: [predicted] });
  return {
    chainId: args.chainId,
    factory,
    predicted,
    exists,
    userSalt,
    fee,
    tx: buildCreatePad({ factory, name: args.name, brand: args.brand, terms: args.terms, allowedQuotes: args.allowedQuotes, userSalt, fee }),
  };
}

/**
 * One chain's answer for a Launchpad.
 *
 * `pad` is THAT CHAIN'S address, which is not necessarily the address on any other chain — see
 * `readPadAcrossChains`. Always render and link the address from the row, never the one that was
 * searched for.
 */
export type PadOnChain =
  /** The Launchpad exists on this chain: its live record, at `pad` on this chain. */
  | { readonly chainId: LatchChainId; readonly status: "live"; readonly factory: Address; readonly pad: Address; readonly record: PadRecord }
  /** This chain's factory has no Launchpad at `pad` yet; `fee` is what opening it there would cost. */
  | { readonly chainId: LatchChainId; readonly status: "absent"; readonly factory: Address; readonly pad: Address; readonly fee: PadFactoryFee }
  /** No LatchPadFactory in the address book for this chain. */
  | { readonly chainId: LatchChainId; readonly status: "no-factory" }
  /** No client was given for this chain. */
  | { readonly chainId: LatchChainId; readonly status: "no-client" }
  /** The chain could not be read. Never read as "absent". */
  | { readonly chainId: LatchChainId; readonly status: "error"; readonly error: string };

/**
 * A Launchpad's identity ACROSS chains: the `(creator, userSalt)` its creator chose.
 *
 * ################ IDENTITY IS THIS RECORD, NOT AN ADDRESS ################
 *
 * A Launchpad used to be identified by its address, because the address was the same everywhere:
 * the factory sits at one address on every chain (CreateX CREATE3) and the clone's salt is
 * `keccak256(creator, userSalt)`, so one creator with one salt produced one address everywhere.
 * Under that assumption "is this the same Launchpad?" and "is this the same address?" were the
 * same question.
 *
 * THEY ARE NOT THE SAME QUESTION, and a real chain proves it. CreateX is not deployed on every
 * chain and cannot always be: Anubis Network (6714) refuses the unprotected transaction CreateX's
 * canonical deployment depends on (the note on `anubis` in ../../chains/endpoints.ts). Its factory
 * therefore lands at a different address, and the same creator with the same salt gets a DIFFERENT
 * pad address there. The old reader called that `different-factory` and stopped looking — which
 * reported a Launchpad that exists as one that does not.
 *
 * So identity is the record. It was always on chain: `LatchPadFactory.padOrigin(pad)` returns
 * exactly this pair, so nothing had to be deployed to fix this.
 *
 * `padId` below is a convenience for URLs and indexes. It is an IDENTIFIER, NEVER AN ADDRESS: it
 * resolves to a different address on every chain, so it must not be rendered or linked as one.
 */
export interface PadIdentity {
  readonly creator: Address;
  readonly userSalt: Hex;
}

/**
 * The chain-independent id of a Launchpad: `keccak256(abi.encode(creator, userSalt))`, which is
 * also its CREATE2 salt. Same on every chain by construction. Not an address.
 */
export function padId(identity: PadIdentity): Hex {
  return padCreate2Salt(identity.creator, identity.userSalt);
}

/**
 * Resolve a Launchpad's identity from an address on ONE chain, by asking that chain's factory.
 * `null` when that address is not a Launchpad of that factory.
 */
export async function readPadIdentity(client: PublicClient, factory: Address, pad: Address): Promise<PadIdentity | null> {
  return readPadOrigin(client, factory, pad);
}

/**
 * One Launchpad, read on every chain in the address book, BY IDENTITY.
 *
 * Pass the identity, or an address plus a chain you can read it on, in which case the identity is
 * resolved from that chain's factory first.
 *
 * Each chain is then asked about ITS OWN address for that identity, derived from ITS OWN factory,
 * so a chain whose factory sits elsewhere gets a real answer instead of being written off.
 *
 * ⚠ EVERY ROW CARRIES THE ADDRESS IT IS TALKING ABOUT. Link and render `row.pad`, never the address
 * that was searched for — on a chain without CreateX they are different, and showing the searched
 * address against another chain's record is how a user is sent to a contract that does not exist.
 *
 * A transport failure is `error`, never `absent`: "I could not read this chain" and "it is not
 * there" are different answers, and a UI that merges them tells a creator their Launchpad is gone.
 */
export async function readPadAcrossChains(args: {
  /** The identity. Give this, or `pad` (+ optionally `fromChainId`) to resolve it. */
  readonly identity?: PadIdentity;
  /** An address on a chain you can read; used ONLY to resolve the identity when `identity` is absent. */
  readonly pad?: Address;
  /** Which chain `pad` is an address on. Defaults to the first chain with both a client and a factory. */
  readonly fromChainId?: LatchChainId;
  readonly clients: Partial<Record<LatchChainId, PublicClient>>;
  readonly chainIds?: readonly LatchChainId[];
  /** Overrides the address book's factory per chain (a devnet). */
  readonly factoryOn?: (chainId: LatchChainId) => Address | null;
}): Promise<readonly PadOnChain[]> {
  const lookup = args.factoryOn ?? padFactoryOn;
  const chainIds = args.chainIds ?? LATCH_CHAIN_IDS;

  let identity = args.identity ?? null;
  if (identity === null) {
    if (args.pad === undefined) throw new Error("readPadAcrossChains needs either `identity` or `pad`");
    const from = args.fromChainId ?? chainIds.find((id) => args.clients[id] !== undefined && lookup(id) !== null);
    if (from === undefined) throw new Error("readPadAcrossChains: no chain has both a client and a factory to resolve the identity from");
    const factory = lookup(from);
    const client = args.clients[from];
    if (factory === null || client === undefined) throw new Error(`readPadAcrossChains: chain ${from} has no factory or no client`);
    identity = await readPadOrigin(client, factory, args.pad);
    if (identity === null) throw new Error(`${args.pad} is not a Launchpad of the factory on chain ${from}`);
  }
  const { creator, userSalt } = identity;

  return Promise.all(
    chainIds.map(async (chainId): Promise<PadOnChain> => {
      const factory = lookup(chainId);
      if (factory === null) return { chainId, status: "no-factory" };
      const client = args.clients[chainId];
      if (client === undefined) return { chainId, status: "no-client" };
      try {
        // THIS chain's address for this identity, from THIS chain's factory, read ON CHAIN.
        // `predictPad` rather than a local computation because the implementation address is part
        // of the clone's init code — predicting off-chain would bake in an assumption about a
        // second address that also moves when CreateX is absent.
        const pad = await readPredictPad(client, factory, creator, userSalt);
        const isPad = await client.readContract({ address: factory, abi: LATCH_PAD_FACTORY_ABI, functionName: "isPad", args: [pad] });
        if (isPad) return { chainId, status: "live", factory, pad, record: await readPad(client, pad) };
        return { chainId, status: "absent", factory, pad, fee: await readPadFactoryFee(client, factory) };
      } catch (e) {
        return { chainId, status: "error", error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
}

/* ----------------------------------------------- one site, several chains --- */
/* Each chain's copy of a pad is its own contract: its own owner, name, brand
   and terms, written on that chain. Nothing keeps them equal. These helpers
   compare two copies and build the transactions that make one match another;
   they never guess which copy is "right" - the caller names the source.

   What does NOT carry across chains, by construction:
     - quote allowlists: they are token ADDRESSES, which differ per chain. A copy
       opened or synced from another chain gets none; with `restrictQuotes` on,
       it takes no launch until its owner allows that chain's quotes (fails
       closed, never "the other chain's addresses").
     - the integrator as a contract: a Safe at X on one chain is not a Safe at X
       on another unless it was deployed there. `readIntegratorPresence` says so.
     - fee amounts: `integratorLaunchFeeWei` is wei of EACH chain's native asset. */

/** A field on which two copies of one pad differ. */
export type PadDriftField =
  | "owner"
  | "name"
  | "brand"
  | "integrator"
  | "integratorBps"
  | "integratorLaunchFeeWei"
  | "allowedPresets"
  | "allowedBinShapes"
  | "restrictQuotes"
  | "active"
  | "maxTaxBps"
  | "taxIntegratorBps";

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** Every field on which `other` differs from `source`, in a fixed order. Empty = the copies match. */
export function padDrift(source: PadRecord, other: PadRecord): readonly PadDriftField[] {
  const out: PadDriftField[] = [];
  const s = source.tenant;
  const o = other.tenant;
  if (source.owner.toLowerCase() !== other.owner.toLowerCase()) out.push("owner");
  if (source.name !== other.name) out.push("name");
  if (source.metadataURI !== other.metadataURI) out.push("brand");
  if (s.integrator.toLowerCase() !== o.integrator.toLowerCase()) out.push("integrator");
  if (s.integratorBps !== o.integratorBps) out.push("integratorBps");
  if (s.integratorLaunchFeeWei !== o.integratorLaunchFeeWei) out.push("integratorLaunchFeeWei");
  if (!sameList(s.allowedPresets, o.allowedPresets)) out.push("allowedPresets");
  if (!sameList(s.allowedBinShapes, o.allowedBinShapes)) out.push("allowedBinShapes");
  if (s.restrictQuotes !== o.restrictQuotes) out.push("restrictQuotes");
  if (s.active !== o.active) out.push("active");
  if (s.maxTaxBps !== o.maxTaxBps) out.push("maxTaxBps");
  if (s.taxIntegratorBps !== o.taxIntegratorBps) out.push("taxIntegratorBps");
  return out;
}

/** A copy's stored terms as `PadTerms`, for re-encoding on another chain. */
export function padTermsOf(record: PadRecord): PadTerms {
  const t = record.tenant;
  return {
    integrator: t.integrator,
    integratorBps: t.integratorBps,
    integratorLaunchFeeWei: t.integratorLaunchFeeWei,
    allowedPresets: t.allowedPresets,
    allowedBinShapes: t.allowedBinShapes,
    restrictQuotes: t.restrictQuotes,
    active: t.active,
    maxTaxBps: t.maxTaxBps,
    taxIntegratorBps: t.taxIntegratorBps,
  };
}

/** One transaction on one pad copy. */
export interface PadSyncTx {
  readonly label: "setMetadata" | "configure";
  readonly to: Address;
  readonly data: Hex;
}

/**
 * The transactions that make `target` carry `source`'s name, brand and terms: `setMetadata` when the name
 * or the brand URI differs (the URI is copied byte for byte, never re-encoded), `configure` when any term
 * differs. Owner and quote allowlist are not synced (see above). Send them on `target`'s chain from
 * `target.owner`; empty = nothing to do.
 */
export function buildPadSync(source: PadRecord, target: PadRecord): readonly PadSyncTx[] {
  const drift = padDrift(source, target).filter((f) => f !== "owner");
  const txs: PadSyncTx[] = [];
  if (drift.includes("name") || drift.includes("brand")) {
    txs.push({
      label: "setMetadata",
      to: target.address,
      data: encodeFunctionData({ abi: LATCH_PAD_ABI, functionName: "setMetadata", args: [source.name, source.metadataURI] }),
    });
  }
  if (drift.some((f) => f !== "name" && f !== "brand")) {
    txs.push({ label: "configure", to: target.address, data: encodeConfigurePad(padTermsOf(source)) });
  }
  return txs;
}

/**
 * `createPad` that opens `source` on another chain at the same address: the origin's salt, the source's
 * name, brand URI (byte for byte) and terms, NO quote allowlist. Valid only when sent by `origin.creator`
 * to a factory at the same address as the source's; anyone else lands elsewhere.
 */
export function buildExtendPad(args: {
  readonly factory: Address;
  readonly origin: PadOrigin;
  readonly source: PadRecord;
  readonly fee: Pick<PadFactoryFee, "feeWei" | "pending">;
}): { readonly to: Address; readonly data: Hex; readonly value: bigint } {
  const data = encodeFunctionData({
    abi: LATCH_PAD_FACTORY_ABI,
    functionName: "createPad",
    args: [assertBytes32(args.origin.userSalt), args.source.name, args.source.metadataURI, tenantConfigFromTerms(padTermsOf(args.source)), []],
  });
  return { to: args.factory, data, value: padSafeValue(args.fee) };
}

/** Whether the integrator is a contract on the source chain and on the target chain. */
export interface IntegratorPresence {
  readonly integrator: Address;
  readonly contractOnSource: boolean;
  readonly contractOnTarget: boolean;
  /**
   * True when the integrator is a contract on the source chain and has NO code on the target: a Safe that
   * was never deployed there. Fees credited to it on the target can only be claimed once the same address
   * is deployed there, which is not guaranteed. Surface it; never proceed silently.
   */
  readonly missingOnTarget: boolean;
}

export async function readIntegratorPresence(source: PublicClient, target: PublicClient, integrator: Address): Promise<IntegratorPresence> {
  const [a, b] = await Promise.all([source.getCode({ address: integrator }), target.getCode({ address: integrator })]);
  const contractOnSource = a !== undefined && a !== "0x";
  const contractOnTarget = b !== undefined && b !== "0x";
  return { integrator, contractOnSource, contractOnTarget, missingOnTarget: contractOnSource && !contractOnTarget };
}
