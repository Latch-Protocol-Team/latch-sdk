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
import { NATIVE_ADDRESS, readKitV2Launches, type LaunchRecordV2, type LaunchScanV2 } from "../launchpad/kitV2/reads.js";
import type { TokenList, TokenListToken } from "./types.js";
import { TOKEN_LIST_LIMITS, validateTokenList } from "./validate.js";

/** The tag every launched token carries, and its list-level definition. */
export const LAUNCH_TAG = "launch";
export const LAUNCH_TAG_DEFINITION = {
  name: "Launch",
  description: "Minted by a LaunchpadKitV2 launch on Latch. Every position of its launch pools is locked forever.",
} as const;

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

function tokenFromLaunch(launch: LaunchRecordV2, chainId: number): TokenListToken | OmittedLaunch {
  const meta = launch.tokenMeta;
  if (meta === null) return { token: launch.token, reason: "the token did not answer symbol, name and decimals" };
  const name = meta.name.length > TOKEN_LIST_LIMITS.tokenNameMax ? meta.name.slice(0, TOKEN_LIST_LIMITS.tokenNameMax) : meta.name;
  const token: TokenListToken = {
    chainId,
    address: launch.token,
    decimals: meta.decimals,
    name,
    symbol: meta.symbol,
    tags: [LAUNCH_TAG],
    extensions: {
      latch: {
        launchpad: launch.tenant.toLowerCase() === NATIVE_ADDRESS ? null : launch.tenant,
        token: launch.token,
      },
    },
  };
  /* Judge the one token through the list validator so the reason is the schema's own. */
  const issues = validateTokenList({ name: "x", timestamp: "2000-01-01T00:00:00Z", version: { major: 1, minor: 0, patch: 0 }, tokens: [token], tags: { [LAUNCH_TAG]: LAUNCH_TAG_DEFINITION } });
  if (issues.length > 0) return { token: launch.token, reason: issues.map((i) => `${i.path.replace(/^tokens\[0\]\./, "")}: ${i.message}`).join("; ") };
  return token;
}

/** The list for a scan already in hand (the pad site reads one anyway). Pure. */
export function launchedTokenListFromScan(scan: LaunchScanV2, options: Pick<LaunchedTokenListOptions, "chainId" | "name">): LaunchedTokenList {
  const tokens: TokenListToken[] = [];
  const omitted: OmittedLaunch[] = [];
  const seen = new Set<string>();
  /* Oldest first, so a list built from a growing kit only ever appends. */
  const launches = [...scan.launches].sort((a, b) => Number(a.createdAtBlock - b.createdAtBlock));
  for (const launch of launches) {
    const key = launch.token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const t = tokenFromLaunch(launch, options.chainId);
    if ("reason" in t) omitted.push(t);
    else tokens.push(t);
  }
  const list: TokenList = {
    name: options.name ?? "Latch launches",
    timestamp: new Date(Number(scan.now) * 1000).toISOString(),
    version: { major: 1, minor: tokens.length, patch: 0 },
    tokens,
    tags: { [LAUNCH_TAG]: LAUNCH_TAG_DEFINITION },
  };
  return { list, omitted, scan };
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
