// SPDX-License-Identifier: MIT
/**
 * More than one kit generation on one chain.
 *
 * A hook address is part of pool identity, so a `LaunchpadKitV2` that has been superseded keeps its
 * launches, pools, locks, fee credits and Launchpads for good. The address book records the current
 * generation (`launchpadV2`, what a NEW launch uses) and the earlier ones that are still served
 * (`launchpadV2Retired`); `launchpadV2Generations` lists both. Everything here reads EVERY served kit
 * and merges the answers, so a reader never loses the launches of an earlier generation.
 *
 * Each kit is scanned on its own (`readKitV2Launches`), with its own wiring: a launch's guards are
 * its own kit's, never the current kit's. Contracts two generations share (the lockers, the token
 * factory) are read once where a balance lives on them. What differs between generations in
 * behaviour is told by the guard's bitmap (`guardGenerationOf`), as everywhere else.
 */

import type { Address, PublicClient } from "viem";

import { planKitV2Earnings, type EarningsCreditV2, type EarningsPlanV2 } from "./earningsPlan.js";
import {
  readKitV2Earnings,
  readKitV2Launches,
  type EarningsV2,
  type KitV2Env,
  type KitV2LaunchLogs,
  type LaunchRecordV2,
  type LaunchScanV2,
  type ReadKitV2LaunchesOptions,
} from "./reads.js";

/** Several kits' scans, merged. `launches` is every kit's, newest first; `scans` keeps each kit's own. */
export interface LaunchScansV2 extends LaunchScanV2 {
  /** One scan per kit, in the order the kits were given (the current kit first). */
  readonly scans: readonly LaunchScanV2[];
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * Merge per-kit scans into one list. The merged `env`, `fromBlock` and `atBlock` are the FIRST scan's
 * (by convention the current kit's), and `now` the latest any scan saw; a consumer that needs a
 * launch's own wiring asks `envOfLaunch`, never the merged `env`. A launch appears once even if two
 * scans somehow both carry it (the first scan wins).
 */
export function mergeLaunchScans(scans: readonly LaunchScanV2[]): LaunchScansV2 {
  const first = scans[0];
  if (first === undefined) throw new Error("mergeLaunchScans needs at least one scan");
  const seen = new Set<string>();
  const launches: LaunchRecordV2[] = [];
  for (const scan of scans) {
    for (const l of scan.launches) {
      const k = `${l.kit.toLowerCase()}:${l.token.toLowerCase()}`;
      if (seen.has(k)) continue;
      seen.add(k);
      launches.push(l);
    }
  }
  launches.sort((a, b) => (b.createdAtBlock > a.createdAtBlock ? 1 : b.createdAtBlock < a.createdAtBlock ? -1 : 0));
  const now = scans.reduce((m, s) => (s.now > m ? s.now : m), first.now);
  return { launches, env: first.env, fromBlock: first.fromBlock, atBlock: first.atBlock, now, scans };
}

/** The wiring of the kit that created `launch`, from a merged scan (or a single one). `null` if no scan has that kit. */
export function envOfLaunch(scan: LaunchScanV2 | LaunchScansV2, launch: Pick<LaunchRecordV2, "kit">): KitV2Env | null {
  const all = "scans" in scan ? scan.scans : [scan];
  return all.find((s) => same(s.env.kit, launch.kit))?.env ?? null;
}

/** The scan of the kit that created `launch`. */
export function scanOfLaunch(scan: LaunchScanV2 | LaunchScansV2, launch: Pick<LaunchRecordV2, "kit">): LaunchScanV2 | null {
  const all = "scans" in scan ? scan.scans : [scan];
  return all.find((s) => same(s.env.kit, launch.kit)) ?? null;
}

export interface ReadKitV2LaunchesAcrossOptions extends Omit<ReadKitV2LaunchesOptions, "env" | "logs"> {
  /** Each kit's wiring, when the caller already has it. */
  readonly envOf?: (kit: Address) => KitV2Env | undefined;
  /** Each kit's pre-read creation logs (see `ReadKitV2LaunchesOptions.logs`). */
  readonly logsOf?: (kit: Address) => KitV2LaunchLogs | undefined;
}

/**
 * `readKitV2Launches` on every kit in `kits` (pass `launchpadV2Addresses(d, "launchpadKitV2")`: the
 * current kit first), merged. One kit failing fails the whole read: a list that silently drops a
 * generation is exactly the failure this module exists to prevent.
 */
export async function readKitV2LaunchesAcross(client: PublicClient, kits: readonly Address[], opts: ReadKitV2LaunchesAcrossOptions): Promise<LaunchScansV2> {
  const { envOf, logsOf, ...rest } = opts;
  const scans = await Promise.all(
    kits.map((kit) => {
      const env = envOf?.(kit);
      const logs = logsOf?.(kit);
      return readKitV2Launches(client, kit, { ...rest, ...(env !== undefined ? { env } : {}), ...(logs !== undefined ? { logs } : {}) });
    }),
  );
  return mergeLaunchScans(scans);
}

/** One kit's earnings for an account, with the scan they were read against. */
export interface KitEarningsV2 {
  readonly scan: LaunchScanV2;
  readonly earnings: EarningsV2;
}

/** `readKitV2Earnings` against every kit's scan of a merged read. */
export async function readKitV2EarningsAcross(client: PublicClient, scan: LaunchScanV2 | LaunchScansV2, account: Address): Promise<readonly KitEarningsV2[]> {
  const all = "scans" in scan ? scan.scans : [scan];
  return Promise.all(all.map(async (s) => ({ scan: s, earnings: await readKitV2Earnings(client, s, account) })));
}

/**
 * The earnings plans of several kits as ONE plan. Each kit's balance is its own row (a kit's launch
 * fees are claimed from that kit). A balance held on a contract two generations share (a locker) is
 * ONE balance, read once per kit: it is kept once, the first kit's row, so nothing is counted twice.
 * Pots and locks never collide (each pool has one guard; each lock id is one launch's).
 */
export function mergeEarningsPlans(plans: readonly EarningsPlanV2[]): EarningsPlanV2 {
  const first = plans[0];
  if (first === undefined) throw new Error("mergeEarningsPlans needs at least one plan");
  const credits: EarningsCreditV2[] = [];
  const byBalance = new Map<string, number>();
  const keys = new Set<string>();
  for (const plan of plans) {
    for (const c of plan.credits) {
      const balance = `${c.from}:${c.contract.toLowerCase()}:${c.currency.toLowerCase()}`;
      const at = byBalance.get(balance);
      if (at !== undefined) {
        const kept = credits[at]!;
        /* The same balance under two kits' labels: it may hold a launch token if either says so. */
        if (c.mayBeLaunchToken && !kept.mayBeLaunchToken) credits[at] = { ...kept, mayBeLaunchToken: true };
        continue;
      }
      /* Keys are stable per source and currency; a second kit's own row gets the contract appended. */
      const key = keys.has(c.key) ? `${c.key}:${c.contract.toLowerCase()}` : c.key;
      keys.add(key);
      byBalance.set(balance, credits.length);
      credits.push(key === c.key ? c : { ...c, key });
    }
  }
  const potKeys = new Set<string>();
  const lockKeys = new Set<string>();
  return {
    account: first.account,
    credits,
    pots: plans.flatMap((p) => p.pots).filter((p) => (potKeys.has(`${p.hook.toLowerCase()}:${p.key}`) ? false : (potKeys.add(`${p.hook.toLowerCase()}:${p.key}`), true))),
    locks: plans.flatMap((p) => p.locks).filter((l) => (lockKeys.has(`${l.locker.toLowerCase()}:${l.key}`) ? false : (lockKeys.add(`${l.locker.toLowerCase()}:${l.key}`), true))),
  };
}

/** `planKitV2Earnings` per kit, then `mergeEarningsPlans`. */
export function planKitV2EarningsAcross(parts: readonly KitEarningsV2[]): EarningsPlanV2 {
  return mergeEarningsPlans(parts.map((p) => planKitV2Earnings(p.earnings, p.scan.env)));
}
