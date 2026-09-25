// SPDX-License-Identifier: MIT
/**
 * The words for a `TokenTrust`, pure and tested, so every surface (the MIT
 * widget, the public lock pages, a hosted Launchpad, a CLI) says the same
 * thing about the same read.
 *
 * Rules the copy never breaks:
 *   - Only what was read. A section that was not read says why ("coming soon",
 *     "could not be read"), never a default. Those two are deliberately
 *     different: a feature that has not arrived is not an outage, and a failed
 *     read must never be dressed up as one.
 *   - Never "safe", never "rug-proof". A LatchRegistry listing is what the
 *     registry says, stated as such, and a listing is not an audit.
 *   - "No creator tax" only when the guard's `getTax` read as zero; "not a
 *     Latch launch" only when the kit's `legsOf` read empty.
 *   - Token units and percentages, never a dollar figure.
 */

import type { Address } from "viem";

import type {
  CreatorTaxFacts,
  LaunchFacts,
  PoolLiquidityFacts,
  PoolRegistryTrust,
  PoolTaxTrust,
  PoolTrust,
  ProtocolFeeFacts,
  TokenLockFacts,
  TokenTrust,
  TrustReadAt,
  TrustSection,
  TrustSource,
} from "./types.js";

/** Tone for a rendered line: `good` is a lock or a listing that exists, never an endorsement. */
export type TrustTone = "locked" | "neutral" | "caution" | "flagged" | "missing" | "error";

export interface TrustLine {
  readonly headline: string;
  readonly detail: string | null;
  readonly tone: TrustTone;
}

/** Basis points as a percentage: 8234 → "82.34%", 10000 → "100%", 5 → "0.05%". */
export function formatTrustBps(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return frac === 0 ? `${whole}%` : `${whole}.${String(frac).padStart(2, "0")}%`.replace(/0+%$/, "%");
}

/** Fee pips (1e6 = 100%) as a percentage, exact: 3000 → "0.3%", 999 → "0.0999%", 0 → "0%". */
export function formatFeePips(pips: number): string {
  const whole = Math.floor(pips / 10_000);
  const frac = String(pips % 10_000).padStart(4, "0").replace(/0+$/, "");
  return frac === "" ? `${whole}%` : `${whole}.${frac}%`;
}

/** Unix seconds → "2026-10-01 14:05 UTC". */
export function formatTrustUtc(unixSeconds: bigint): string {
  return `${new Date(Number(unixSeconds) * 1000).toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

/** Exact decimal, trimmed, never "0" for a non-zero amount. `decimals: null` = base units. */
export function formatTrustAmount(value: bigint, symbol: string, decimals: number | null, maxFrac = 4): string {
  if (decimals === null) return `${value.toLocaleString("en-US")} base units ${symbol}`;
  if (value === 0n) return `0 ${symbol}`;
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = (value % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  if (whole === 0n && frac === "") return `<0.${"0".repeat(Math.max(0, maxFrac - 1))}1 ${symbol}`;
  return `${whole.toLocaleString("en-US")}${frac === "" ? "" : `.${frac}`} ${symbol}`;
}

const short = (a: Address | string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** "LatchTokenLock 0x12ab…cdef · blocks 1,234–1,240". */
export function formatTrustSource(source: TrustSource, readAt: Pick<TrustReadAt, "fromBlock" | "toBlock">): string {
  const blocks =
    readAt.fromBlock === readAt.toBlock
      ? `block ${readAt.fromBlock.toLocaleString("en-US")}`
      : `blocks ${readAt.fromBlock.toLocaleString("en-US")}–${readAt.toBlock.toLocaleString("en-US")}`;
  return `${source.contract} ${short(source.address)} · ${source.call} · ${blocks}`;
}

/**
 * DEPLOYMENT STATUS IS INTERNAL (owner rule, 2026-09-19). These lines render on the dapp, on the
 * public token pages and on every hosted launchpad site, so they say what a reader can act on —
 * the feature is not available here yet — and never which of our contracts is or is not on a chain,
 * nor how the app worked that out. "Could not be read" stays: a read that FAILED is a different
 * fact from a feature that has not arrived, and collapsing the two would hide an outage.
 */
function notRead(s: { status: "not-configured"; reason: string } | { status: "error"; message: string }): TrustLine {
  return s.status === "not-configured"
    ? { headline: "Coming soon", detail: `${s.reason}, so there is nothing to read yet.`, tone: "missing" }
    : { headline: "Could not be read", detail: `The read failed: ${s.message}.`, tone: "error" };
}

/* ------------------------------------------------------------------ launch --- */

export function describeLaunch(s: TrustSection<LaunchFacts>, readAt: Pick<TrustReadAt, "chainNow">): TrustLine {
  if (s.status !== "read") {
    if (s.status === "not-configured") {
      return { headline: "Launch status unknown", detail: "Launches are coming soon on this chain, so whether this token is a Latch launch cannot be read yet.", tone: "missing" };
    }
    return notRead(s);
  }
  if (s.launch === null) return { headline: "Not a Latch launch", detail: "LaunchpadKitV2 has no launch for this token (legsOf is empty).", tone: "neutral" };
  const l = s.launch;
  const open = readAt.chainNow >= l.startTime;
  return {
    headline: "Latch launch (Kit v2)",
    detail: `${l.legCount === 1 ? "1 pool" : `${l.legCount} pools`}, seeded into the protocol's LP lockers. Created by ${short(l.creator)}${isZeroAddr(l.tenant) ? " directly" : ` through Launchpad ${short(l.tenant)}`}; trading ${open ? "opened" : "opens"} ${formatTrustUtc(l.startTime)}.`,
    tone: "neutral",
  };
}

const isZeroAddr = (a: string): boolean => /^0x0{40}$/i.test(a);

/* ------------------------------------------------------------- token locks --- */

export function describeTokenLocks(s: TrustSection<TokenLockFacts>, symbol: string, decimals: number | null): TrustLine {
  if (s.status !== "read") return notRead(s);
  if (s.lockCount === 0) return { headline: `No ${symbol} locked`, detail: `No lock or vesting of ${symbol} has been made with LatchTokenLock.`, tone: "neutral" };
  if (s.totalHeld === 0n) {
    return { headline: `No ${symbol} locked now`, detail: `${s.lockCount === 1 ? "The one lock has" : `All ${s.lockCount} locks have`} been fully released and claimed.`, tone: "neutral" };
  }
  const locked = s.unvestedBps === null ? `${formatTrustAmount(s.unvested, symbol, decimals)} locked` : `${formatTrustBps(s.unvestedBps)} of supply locked`;
  const parts: string[] = [];
  parts.push(
    s.heldBps === null
      ? `${formatTrustAmount(s.totalHeld, symbol, decimals)} held in ${s.lockCount === 1 ? "1 lock" : `${s.lockCount} locks`}`
      : `${formatTrustBps(s.heldBps)} of supply (${formatTrustAmount(s.totalHeld, symbol, decimals)}) held in ${s.lockCount === 1 ? "1 lock" : `${s.lockCount} locks`}`,
  );
  parts.push(`${formatTrustAmount(s.unvested, symbol, decimals)} not yet vested`);
  if (s.nextRelease !== null) parts.push(`next release ${formatTrustUtc(s.nextRelease)}`);
  if (s.lastEnd !== null) parts.push(`fully vested ${formatTrustUtc(s.lastEnd)}`);
  return { headline: s.unvested > 0n ? locked : `${symbol} vested, waiting to be claimed`, detail: `${parts.join("; ")}.`, tone: s.unvested > 0n ? "locked" : "neutral" };
}

/* --------------------------------------------------------------- liquidity --- */

export function describeLiquidity(s: TrustSection<PoolLiquidityFacts>, kind: PoolTrust["kind"]): TrustLine {
  if (s.status !== "read") return notRead(s);
  const has = s.timeLockedCount > 0 || s.permanentCount > 0;
  if (!has) {
    return {
      headline: s.unlockableCount > 0 ? "No locked liquidity now" : "No locked liquidity",
      detail:
        s.unlockableCount > 0
          ? `${s.unlockableCount === 1 ? "1 time lock is" : `${s.unlockableCount} time locks are`} past the unlock date and can be withdrawn by the lock owner.`
          : kind === "Bin"
            ? "The Bin LP locker holds nothing in this pool; time locks cover CL positions only."
            : "No position in this pool is time-locked or held by the protocol's LP locker.",
      tone: "caution",
    };
  }
  if (kind === "Bin") {
    return {
      headline: s.lockedActiveBps === null ? "Locked permanently (LP locker)" : `${formatTrustBps(s.lockedActiveBps)} of the active bin locked permanently (LP locker)`,
      detail: `${s.permanentCount === 1 ? "1 lock" : `${s.permanentCount} locks`} held forever by the Bin LP locker, which has no withdraw path. ${
        s.lockedActiveBps === null ? "No lock holds the bin that trades at the current price." : "The share is of the bin that trades at the current price."
      }`,
      tone: "locked",
    };
  }
  const headline =
    s.lockedActiveBps === null
      ? s.permanentCount > 0 && s.timeLockedCount === 0
        ? "Locked permanently (LP locker)"
        : "Locked positions · share not measurable"
      : `${formatTrustBps(s.lockedActiveBps)} of active liquidity locked`;
  const parts: string[] = [];
  if (s.permanentCount > 0) parts.push(`${s.permanentActiveBps === null ? `${s.permanentCount === 1 ? "1 position" : `${s.permanentCount} positions`}` : formatTrustBps(s.permanentActiveBps)} locked permanently (LP locker, no withdraw path)`);
  if (s.timeLockedCount > 0) parts.push(`${s.timeLockedActiveBps === null ? `${s.timeLockedCount === 1 ? "1 position" : `${s.timeLockedCount} positions`}` : formatTrustBps(s.timeLockedActiveBps)} time-locked${s.nextUnlockAt === null ? "" : `, first unlock ${formatTrustUtc(s.nextUnlockAt)}`}`);
  let detail = `${parts.join("; ")}.`;
  if (!s.measurable) detail += " The pool has no liquidity at the current price, so no share is measured.";
  else detail += " The share is of liquidity at the current price and moves with it.";
  if (s.outOfRange > 0) detail += ` ${s.outOfRange === 1 ? "1 locked position is" : `${s.outOfRange} locked positions are`} out of range and not counted.`;
  return { headline, detail, tone: "locked" };
}

/* -------------------------------------------------------------------- fees --- */

export function describeLpFee(f: PoolTrust["lpFee"]): TrustLine {
  switch (f.kind) {
    case "launch-guard":
      return { headline: `${formatFeePips(f.pips)} LP fee now`, detail: "Read from the launch guard's currentFee: the fee decays from its opening value to the final one over the launch window.", tone: "neutral" };
    case "static":
      return { headline: `${formatFeePips(f.pips)} LP fee`, detail: "Static, fixed in the pool key.", tone: "neutral" };
    case "dynamic":
      return { headline: "Dynamic (hook-set)", detail: `The fee a swap pays is set by the hook and was not read as one number: ${f.reason}.`, tone: "caution" };
    case "error":
      return { headline: "LP fee could not be read", detail: `The read failed: ${f.message}.`, tone: "error" };
  }
}

export function describeProtocolFee(s: TrustSection<ProtocolFeeFacts>): TrustLine {
  if (s.status !== "read") return notRead(s);
  if (s.zeroForOne === 0 && s.oneForZero === 0) return { headline: "No protocol fee", detail: "The pool manager's protocol fee reads 0 in both directions.", tone: "neutral" };
  if (s.zeroForOne === s.oneForZero) {
    return { headline: `${formatFeePips(s.zeroForOne)} protocol fee`, detail: "Of each swap, in both directions, on top of the LP fee (core caps it at 0.4%).", tone: "neutral" };
  }
  return {
    headline: `${formatFeePips(s.zeroForOne)} / ${formatFeePips(s.oneForZero)} protocol fee`,
    detail: "Selling currency0 / selling currency1, of each swap, on top of the LP fee (core caps each at 0.4%).",
    tone: "neutral",
  };
}

/* ------------------------------------------------------------- creator tax --- */

/** The creator tax on one pool. `launchStatus` decides the words when the pool is not a launch-guard pool. */
export function describeCreatorTax(t: PoolTaxTrust, chainNow: bigint): TrustLine {
  if (t.status === "not-a-launch-pool") return { headline: "Not a Latch launch pool", detail: "The pool's hook is not the Kit v2 launch guard, so there is no creator tax to read.", tone: "neutral" };
  if (t.status !== "read") return notRead(t);
  return creatorTaxLine(t, chainNow);
}

function creatorTaxLine(t: CreatorTaxFacts, chainNow: bigint): TrustLine {
  if (t.tax === null) return { headline: "No creator tax", detail: "The launch guard's getTax reads zero for this pool.", tone: "neutral" };
  const x = t.tax;
  const split = `split ${formatTrustBps(x.creatorBps)} creator, ${formatTrustBps(x.protocolBps)} protocol${x.integratorBps > 0 ? `, ${formatTrustBps(x.integratorBps)} integrator` : ""}`;
  if (x.expiresAt <= chainNow || (t.buyBpsNow === 0 && t.sellBpsNow === 0)) {
    return { headline: "Creator tax ended", detail: `Was buy ${formatTrustBps(x.buyBps)} / sell ${formatTrustBps(x.sellBps)} until ${formatTrustUtc(x.expiresAt)}; swaps now pay none (${split}).`, tone: "neutral" };
  }
  return {
    headline: `Creator tax: buy ${formatTrustBps(t.buyBpsNow)} · sell ${formatTrustBps(t.sellBpsNow)} now`,
    detail: `Taken by the launch guard on each swap until ${formatTrustUtc(x.expiresAt)}, then zero with no transaction; ${split}. The rates and the split are frozen.`,
    tone: "caution",
  };
}

/* ---------------------------------------------------------------- registry --- */

export function describeRegistry(r: PoolRegistryTrust): TrustLine {
  if (r.status === "no-hook") return { headline: "No hook", detail: "The pool key names no hook contract.", tone: "neutral" };
  if (r.status !== "read") return notRead(r);
  if (!r.listed) return { headline: "Not listed in LatchRegistry", detail: "The registry has no record of this pool's hook. That says nothing either way about what the hook does.", tone: "caution" };
  if (r.flagged) {
    return { headline: "Flagged malicious in LatchRegistry", detail: `The registry's listing status for this hook is Malicious${r.name ? ` (${r.name})` : ""}.`, tone: "flagged" };
  }
  const source = r.permissionSource === "SelfReported" ? "self-reported permissions" : r.permissionSource === "PoolAttestedDivergent" ? "a live pool proved permissions the hook did not report" : "permissions attested by a live pool";
  return {
    headline: `Listed in LatchRegistry: ${r.listing ?? "?"} · ${r.verification ?? "?"}`,
    detail: `${r.name ? `${r.name}. ` : ""}Risk class ${r.riskClass ?? "?"} from ${source}. This is what the registry records; a listing is not an audit.`,
    tone: r.listing === "Deprecated" || r.permissionSource === "PoolAttestedDivergent" ? "caution" : "neutral",
  };
}

/* ----------------------------------------------------------------- summary --- */

export interface TokenTrustSummary {
  readonly launch: "launch" | "not-a-launch" | "unknown";
  readonly poolsRead: number;
  /** Pools where some liquidity is time-locked or held by an LP locker. */
  readonly poolsWithLocks: number;
  /** The highest locked share of active liquidity among the pools read, bps; `null` when none measured. */
  readonly maxLockedActiveBps: number | null;
  /** A creator tax is being taken now on at least one pool. `null` when no launch-guard pool's tax was read. */
  readonly creatorTaxLive: boolean | null;
  readonly flaggedHooks: number;
  /** Sections or pools that failed to read. */
  readonly errors: number;
}

/** Pure: the headline facts across every section. */
export function summarizeTokenTrust(t: Pick<TokenTrust, "launch" | "pools" | "failedPools" | "tokenLocks">): TokenTrustSummary {
  let poolsWithLocks = 0;
  let maxLocked: number | null = null;
  let taxRead = false;
  let taxLive = false;
  let flagged = 0;
  let errors = t.failedPools.length + (t.launch.status === "error" ? 1 : 0) + (t.tokenLocks.status === "error" ? 1 : 0);
  for (const p of t.pools) {
    if (p.liquidity.status === "read") {
      if (p.liquidity.timeLockedCount > 0 || p.liquidity.permanentCount > 0) poolsWithLocks += 1;
      if (p.liquidity.lockedActiveBps !== null && (maxLocked === null || p.liquidity.lockedActiveBps > maxLocked)) maxLocked = p.liquidity.lockedActiveBps;
    } else if (p.liquidity.status === "error") errors += 1;
    if (p.tax.status === "read") {
      taxRead = true;
      if (p.tax.buyBpsNow > 0 || p.tax.sellBpsNow > 0) taxLive = true;
    } else if (p.tax.status === "error") errors += 1;
    if (p.registry.status === "read" && p.registry.flagged) flagged += 1;
    if (p.registry.status === "error" || p.protocolFee.status === "error" || p.lpFee.kind === "error") errors += 1;
  }
  return {
    launch: t.launch.status !== "read" ? "unknown" : t.launch.launch === null ? "not-a-launch" : "launch",
    poolsRead: t.pools.length,
    poolsWithLocks,
    maxLockedActiveBps: maxLocked,
    creatorTaxLive: taxRead ? taxLive : null,
    flaggedHooks: flagged,
    errors,
  };
}
