// SPDX-License-Identifier: MIT
/* ============================================================================
   A token list of the tokens a LaunchpadKitV2 launched, built at runtime.

   Every field comes from a read: `name`, `symbol` and `decimals` off the
   token contract (`readKitV2Launches` → `tokenMeta`), the pad from the
   `LaunchCreated` log. No `logoURI`: the launch registry's listing carried an
   `iconURI` until 2026-09-24, when the member was removed from `LaunchMetadata`
   (a fifth string put the kit over EIP-170), so a launched token has no icon
   source on chain and none is invented. A launch whose token does not answer as an ERC-20, or
   whose metadata the schema cannot hold, is OMITTED and reported, never
   patched into shape: a list entry with a guessed symbol is worse than none.

   The version is `1.<launch count>.0`: the kit never forgets a launch, so
   tokens are only ever added (a minor bump under the standard's rules), and
   two reads of the same kit at the same count compare equal.
   ============================================================================ */

import type { Address, PublicClient } from "viem";

import type { KitV2Env } from "../launchpad/kitV2/reads.js";
import { telegramUrlOf, xUrlOf } from "../launchpad/kitV2/listing.js";
import { NATIVE_ADDRESS, readKitV2Launches, type LaunchListing, type LaunchScanV2, type TokenMeta } from "../launchpad/kitV2/reads.js";
import type { TokenList, TokenListToken } from "./types.js";
import { TOKEN_LIST_LIMITS, validateTokenList } from "./validate.js";

/** The tag every launched token carries, and its list-level definition. */
export const LAUNCH_TAG = "launch";
export const LAUNCH_TAG_DEFINITION = {
  name: "Launch",
  description: "Minted by a LaunchpadKitV2 launch on Latch. Every position of its launch pools is locked forever.",
} as const;

/**
 * The tag a list of ANY launch carries when Latch has not looked at the tokens in it: the
 * chain-wide list the API publishes. Anyone can launch through the kit, so the kit's name on a
 * token says how it was launched, never that it was reviewed.
 */
export const UNVERIFIED_TAG = "unverified";
export const UNVERIFIED_TAG_DEFINITION = {
  name: "Unverified",
  description: "Not reviewed by Latch. Anyone can launch a token: read its contract and its pool before you trade.",
} as const;

/**
 * What one token of the list needs, and nothing more: a chain scan's `LaunchRecordV2` is one,
 * and so is a row the API's indexer stored. Keeping the builder on this shape is what lets both
 * publish the same list.
 */
export interface LaunchedTokenEntry {
  readonly token: Address;
  readonly tenant: Address;
  readonly createdAtBlock: bigint;
  readonly tokenMeta: Pick<TokenMeta, "name" | "symbol" | "decimals"> | null;
  readonly listing?: Pick<LaunchListing, "websiteURI" | "xHandle" | "telegramHandle"> | null;
}

export interface LaunchedTokenListOptions {
  /** The chain the kit is on. Written on every token and used by `readContractClock`. */
  readonly chainId: number;
  /** First block to scan, when the scan is read here. The kit's deployment block or the chain's Latch deployment block. */
  readonly fromBlock: bigint;
  /** Only launches naming this tenant (a pad). Omit for every launch on the kit. */
  readonly tenant?: Address;
  readonly env?: KitV2Env;
  /** The list's `name`. 1 to 30 word characters or spaces. Default `Latch launches`. */
  readonly name?: string;
}

export interface OmittedLaunch {
  readonly token: Address;
  readonly reason: string;
}

export interface LaunchedTokenList {
  readonly list: TokenList;
  /** Launches that could not become a schema-valid token, and why. */
  readonly omitted: readonly OmittedLaunch[];
  /** The scan the list was built from, for callers that need the legs too. */
  readonly scan: LaunchScanV2;
}

/**
 * A website URL fit to put in a public list, or `null`.
 *
 * `https://` only. The registry deliberately does not validate this field — a contract cannot make
 * a URL safe and a partial filter reads as a guarantee — so the filtering belongs exactly here, at
 * the point where the value is about to be handed to somebody else's wallet. `http://` is a
 * downgrade, and `javascript:` / `data:` are injection vectors in anything that renders a list
 * without allowlisting the scheme itself.
 */
function httpsOnly(url: string | undefined): string | null {
  const u = (url ?? "").trim();
  if (u === "" || !u.startsWith("https://")) return null;
  return u;
}

function tokenFromLaunch(launch: LaunchedTokenEntry, chainId: number, unverified: boolean): TokenListToken | OmittedLaunch {
  const meta = launch.tokenMeta;
  if (meta === null) return { token: launch.token, reason: "the token did not answer symbol, name and decimals" };
  const name = meta.name.length > TOKEN_LIST_LIMITS.tokenNameMax ? meta.name.slice(0, TOKEN_LIST_LIMITS.tokenNameMax) : meta.name;
  const token: TokenListToken = {
    chainId,
    address: launch.token,
    decimals: meta.decimals,
    name,
    symbol: meta.symbol,
    tags: unverified ? [LAUNCH_TAG, UNVERIFIED_TAG] : [LAUNCH_TAG],
    extensions: {
      latch: {
        launchpad: launch.tenant.toLowerCase() === NATIVE_ADDRESS ? null : launch.tenant,
        token: launch.token,
        /*
         * THE PROJECT'S OWN LINKS, so a wallet or a bot reading this list can reach it.
         *
         * They come from `LatchLaunchRegistry`, which has stored them since kit v2 — the creator
         * already typed them into the launch wizard. Until now they lived only on that registry,
         * which nothing outside Latch queries, so a token that HAD a website and an X account
         * looked anonymous everywhere it mattered.
         *
         * The two handles are converted to URLs by `xUrlOf` / `telegramUrlOf`, which refuse
         * anything outside the charset the registry itself enforces. That is the point: a list
         * consumer renders these next to a token somebody is deciding whether to buy, so a
         * creator must not be able to aim "Telegram" at a domain of their choosing. `website` is
         * the one field that IS a creator-supplied destination, and it travels only when it is
         * `https://` — a consumer should still treat it as untrusted.
         *
         * `null` where the creator gave nothing, and where the listing could not be read at all.
         * Never an empty string, never a guess.
         */
        website: httpsOnly(launch.listing?.websiteURI),
        x: xUrlOf(launch.listing?.xHandle ?? ""),
        telegram: telegramUrlOf(launch.listing?.telegramHandle ?? ""),
      },
    },
  };
  /* Judge the one token through the list validator so the reason is the schema's own. */
  const issues = validateTokenList({ name: "x", timestamp: "2000-01-01T00:00:00Z", version: { major: 1, minor: 0, patch: 0 }, tokens: [token], tags: tagDefinitions(unverified) });
  if (issues.length > 0) return { token: launch.token, reason: issues.map((i) => `${i.path.replace(/^tokens\[0\]\./, "")}: ${i.message}`).join("; ") };
  return token;
}

function tagDefinitions(unverified: boolean): NonNullable<TokenList["tags"]> {
  return unverified ? { [LAUNCH_TAG]: LAUNCH_TAG_DEFINITION, [UNVERIFIED_TAG]: UNVERIFIED_TAG_DEFINITION } : { [LAUNCH_TAG]: LAUNCH_TAG_DEFINITION };
}

export interface LaunchedTokenListFromEntriesOptions {
  readonly chainId: number;
  /** The list's `name`. 1 to 30 word characters or spaces. Default `Latch launches`. */
  readonly name?: string;
  /** Unix seconds the entries were read at: the list's `timestamp`. */
  readonly now: bigint;
  /** Tag every token `unverified` too. For a list of every launch on a chain, which nobody reviewed. */
  readonly unverified?: boolean;
}

/**
 * The list for launches already in hand, from wherever they were read: a chain scan or an
 * indexer's rows. Pure. Oldest first and deduped, so a list built from a growing kit only ever
 * appends; the version is `1.<token count>.0`.
 */
export function launchedTokenListFromEntries(entries: readonly LaunchedTokenEntry[], options: LaunchedTokenListFromEntriesOptions): Omit<LaunchedTokenList, "scan"> {
  const unverified = options.unverified === true;
  const tokens: TokenListToken[] = [];
  const omitted: OmittedLaunch[] = [];
  const seen = new Set<string>();
  const launches = [...entries].sort((a, b) => (a.createdAtBlock < b.createdAtBlock ? -1 : a.createdAtBlock > b.createdAtBlock ? 1 : 0));
  for (const launch of launches) {
    const key = launch.token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const t = tokenFromLaunch(launch, options.chainId, unverified);
    if ("reason" in t) omitted.push(t);
    else tokens.push(t);
  }
  const list: TokenList = {
    name: options.name ?? "Latch launches",
    timestamp: new Date(Number(options.now) * 1000).toISOString(),
    version: { major: 1, minor: tokens.length, patch: 0 },
    tokens,
    tags: tagDefinitions(unverified),
  };
  return { list, omitted };
}

/** The list for a scan already in hand (the pad site reads one anyway). Pure. */
export function launchedTokenListFromScan(scan: LaunchScanV2, options: Pick<LaunchedTokenListOptions, "chainId" | "name">): LaunchedTokenList {
  const r = launchedTokenListFromEntries(scan.launches, { chainId: options.chainId, now: scan.now, ...(options.name === undefined ? {} : { name: options.name }) });
  return { ...r, scan };
}

/**
 * Reads the kit's launches and builds their token list. An empty kit yields
 * a list with no tokens, which the SCHEMA refuses (`tokens` needs at least
 * one entry): render it as "no launches yet", do not publish it.
 */
export async function launchedTokenList(client: PublicClient, kit: Address, options: LaunchedTokenListOptions): Promise<LaunchedTokenList> {
  const scan = await readKitV2Launches(client, kit, {
    fromBlock: options.fromBlock,
    chainId: options.chainId,
    ...(options.tenant === undefined ? {} : { tenant: options.tenant }),
    ...(options.env === undefined ? {} : { env: options.env }),
  });
  return launchedTokenListFromScan(scan, { chainId: options.chainId, ...(options.name === undefined ? {} : { name: options.name }) });
}
