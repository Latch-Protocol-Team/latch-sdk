// SPDX-License-Identifier: MIT
/* ============================================================================
   What an account can do about its earnings, as calls: the pure half of an
   earnings screen. `readKitV2Earnings` reads; this turns the read into the
   balances to claim, the pots to settle and the locks to collect, each with
   the transaction that does it. No reads, no sends.

   WHY IT IS ONE MODULE. Two generations of launch guard exist
   (`./guardGeneration.js`) and a screen has to serve both, because a wallet can
   hold launches on either. Where the money is differs:

                     trade fee                          creator tax
     "lp-fee"        in the LOCK (`collectFees`), then   in the GUARD's pot, in
                     the LOCKER's balance (`claim`).     whichever currency the
                     Paid in the swap's input, so it     swap left unspecified
                     arrives in the quote AND in the
                     launch token
     "quote-fee"     in the GUARD's pot                  in the GUARD's pot
                     both in the pool's QUOTE currency, and both in the guard's
                     ONE balance per account and currency once settled.
                     On a BUY the guard leaves a share of the trade fee to the
                     pool (`LP_SHARE_BPS`, read from the guard, possibly zero):
                     that part is in the LOCK, then the LOCKER's balance, and
                     it too is in the quote

   Three screens (the dapp, a hosted Launchpad site, the template) would
   otherwise each decide this, and each would have to be right.

   A GUARD KEEPS ONE BALANCE. On a "quote-fee" guard the settled trade fee and
   the settled creator tax are the same number, and one `claim` withdraws it. A
   credit says what it `holds`; nothing here adds a balance to itself.

   `claimFrom(pools, currency, to)` SETTLES AND WITHDRAWS: it splits the fee pot
   and the tax pot of each pool named, then pays the caller its whole balance in
   that currency at that guard, settled before or just now. It pays
   `msg.sender`'s own credit only, so a plan is built for the account that signs.
   ============================================================================ */

import { encodeFunctionData, type Address, type Hex } from "viem";

import { BIN_LAUNCH_GUARD_HOOK_ABI, LATCH_BIN_LP_LOCKER_ABI, LATCH_LP_LOCKER_ABI, LAUNCHPAD_KIT_V2_ABI, LAUNCH_GUARD_HOOK_ABI } from "../generated/abi.js";
import { guardGenerationOf, type GuardGenerationRead } from "./guardGeneration.js";
import { NATIVE_ADDRESS, type EarningsV2, type KitV2Env, type TokenMeta } from "./reads.js";
import { KIT_V2_BPS } from "./types.js";

/** A transaction to send: no value, from the account the plan was built for. */
export interface EarningsCall {
  readonly to: Address;
  readonly data: Hex;
}

/**
 * What a balance holds.
 *
 * - `launch-fees`: the kit's native launch fees.
 * - `lp-fees`: a locker's balance, collected from locks. The trade fee of "lp-fee" launches, and
 *   the pool's part of what buys pay on "quote-fee" launches.
 * - `creator-tax`: an "lp-fee" guard's balance: the creator tax alone.
 * - `trading-fees-and-tax`: a "quote-fee" guard's balance: the guard's part of the trade fee and the
 *   creator tax, together.
 * - `unknown`: a guard that could not be classified. Shown as a balance, with no claim about its contents.
 */
export type EarningsCreditHolds = "launch-fees" | "lp-fees" | "creator-tax" | "trading-fees-and-tax" | "unknown";

/** One balance `account` can withdraw now. */
export interface EarningsCreditV2 {
  /** Stable across reads: the source and the currency. */
  readonly key: string;
  readonly from: "kit" | "locker" | "guard";
  /** The pool type the source serves; `null` for the kit. */
  readonly pools: "CL" | "Bin" | null;
  readonly contract: Address;
  readonly holds: EarningsCreditHolds;
  /** The generation of the guard of that pool type; `null` for the kit, which has none. */
  readonly generation: GuardGenerationRead | null;
  readonly currency: Address;
  readonly meta: TokenMeta | null;
  readonly amount: bigint;
  /**
   * Whether this balance can arrive in a LAUNCH TOKEN. True on "lp-fee" sources
   * only: there the trade fee is paid in the swap's input and the tax on the
   * unspecified side, so a sell pays the one and a buy the other in the token.
   * On "quote-fee" sources every unit is in the pool's quote. A surface that
   * offers to sell what was claimed offers it where this is true and nowhere else.
   */
  readonly mayBeLaunchToken: boolean;
  /** Pays `account` the whole balance. */
  readonly claim: EarningsCall;
}

/** One side of a guard pot: the whole unsettled amount, and what settling it now credits `account`. */
export interface EarningsPotPart {
  readonly pot: bigint;
  readonly share: bigint;
  /** `account`'s share in basis points. */
  readonly bps: number;
}

/** A guard's unsettled pots for one pool and one currency, where `account` is a party. */
export interface EarningsPotV2 {
  readonly key: string;
  readonly pools: "CL" | "Bin";
  readonly hook: Address;
  readonly generation: GuardGenerationRead;
  readonly poolId: Hex;
  readonly token: Address;
  readonly tokenMeta: TokenMeta | null;
  readonly currency: Address;
  readonly meta: TokenMeta | null;
  /** The trade fee's pot. `null` where the guard takes no trade fee, and where `account` has no share of it. */
  readonly fee: EarningsPotPart | null;
  /** The creator tax's pot. `null` where `account` is no party to the tax. */
  readonly tax: (EarningsPotPart & { readonly live: boolean }) | null;
  /** What settling both pots now credits `account`: `fee.share + tax.share`. */
  readonly share: bigint;
  /** `claimFrom([poolId], currency, account)`: settles this pool's pots and withdraws. See the header. */
  readonly settleAndClaim: EarningsCall;
}

/** A lock naming `account`, and the call that moves what it earned into the locker's balance. */
export interface EarningsLockV2 {
  readonly key: string;
  readonly pools: "CL" | "Bin";
  readonly locker: Address;
  readonly lockId: bigint;
  readonly token: Address;
  readonly tokenMeta: TokenMeta | null;
  readonly role: "creator" | "integrator" | "both";
  readonly generation: GuardGenerationRead;
  /**
   * Whether any of the launch's trade fee accrues to this lock.
   *
   * - "lp-fee": `true`, all of it.
   * - "quote-fee": `true` when the guard leaves the pool a share (`lpShareBps`
   *   above zero): the lock earns that share of what BUYS pay, in the quote, and
   *   nothing from sells. `false` when the share reads zero: the whole fee is in
   *   the guard's pot (a Bin lock can still earn the fee core charges on
   *   liquidity added to the active bin).
   * - `null` when the guard could not be classified, or did not say what its
   *   share is. Unknown is not "no".
   */
  readonly earnsTradeFee: boolean | null;
  /**
   * On a "quote-fee" leg, the share of the trade fee the pool charges on buys,
   * in basis points, which is what this lock earns. `null` on an "lp-fee" leg
   * and where the guard did not answer.
   */
  readonly lpShareBps: number | null;
  /** `collectFees(lockId)`: permissionless. */
  readonly collect: EarningsCall;
}

export interface EarningsPlanV2 {
  readonly account: Address;
  /** Every balance read, zero ones included, in a fixed order: the kit, the lockers, the guards. */
  readonly credits: readonly EarningsCreditV2[];
  /**
   * Every pot where `account` has a share, empty ones included, with one
   * exception: a "quote-fee" guard takes nothing in the launch token, so that
   * side of its pools is left out instead of listed at zero for good.
   */
  readonly pots: readonly EarningsPotV2[];
  readonly locks: readonly EarningsLockV2[];
}

const floorShare = (pot: bigint, bps: number): bigint => (pot * BigInt(bps)) / BigInt(KIT_V2_BPS);

/**
 * Whether a lock on a guard of `generation` earns any of the trade fee. See
 * `EarningsLockV2.earnsTradeFee`. `lpShareBps` is the guard's own answer, or
 * `null` when it gave none.
 */
export function lockEarnsTradeFee(generation: GuardGenerationRead, lpShareBps: number | null): boolean | null {
  if (generation === "lp-fee") return true;
  if (generation !== "quote-fee" || lpShareBps === null) return null;
  return lpShareBps > 0;
}

/**
 * The plan for `earnings.account`. `env` is the kit's, as `readKitV2Env` returns
 * it (the scan carries it as `scan.env`): it names the contracts and carries
 * each guard's bitmap, which is what decides the generation.
 */
export function planKitV2Earnings(earnings: EarningsV2, env: KitV2Env): EarningsPlanV2 {
  const account = earnings.account;
  const generationOf = (pools: "CL" | "Bin"): GuardGenerationRead => guardGenerationOf(pools === "CL" ? env.clHookBitmap : env.binHookBitmap, pools);
  const lockerOf = (pools: "CL" | "Bin"): Address => (pools === "CL" ? env.clLocker : env.binLocker);

  const credits: EarningsCreditV2[] = [
    {
      key: "kit",
      from: "kit",
      pools: null,
      contract: env.kit,
      holds: "launch-fees",
      generation: null,
      currency: NATIVE_ADDRESS,
      meta: null,
      amount: earnings.kitFeesOwed,
      mayBeLaunchToken: false,
      claim: { to: env.kit, data: encodeFunctionData({ abi: LAUNCHPAD_KIT_V2_ABI, functionName: "claimFees", args: [account] }) },
    },
  ];
  for (const c of earnings.claimable) {
    const generation = generationOf(c.locker);
    const locker = lockerOf(c.locker);
    credits.push({
      key: `locker:${c.locker}:${c.currency.toLowerCase()}`,
      from: "locker",
      pools: c.locker,
      contract: locker,
      holds: "lp-fees",
      generation,
      currency: c.currency,
      meta: c.meta,
      amount: c.amount,
      mayBeLaunchToken: generation === "lp-fee",
      claim: {
        to: locker,
        data:
          c.locker === "CL"
            ? encodeFunctionData({ abi: LATCH_LP_LOCKER_ABI, functionName: "claim", args: [c.currency, account] })
            : encodeFunctionData({ abi: LATCH_BIN_LP_LOCKER_ABI, functionName: "claim", args: [c.currency, account] }),
      },
    });
  }
  for (const c of earnings.guardClaimable) {
    const generation = generationOf(c.guard);
    credits.push({
      key: `guard:${c.guard}:${c.currency.toLowerCase()}`,
      from: "guard",
      pools: c.guard,
      contract: c.hook,
      holds: generation === "quote-fee" ? "trading-fees-and-tax" : generation === "lp-fee" ? "creator-tax" : "unknown",
      generation,
      currency: c.currency,
      meta: c.meta,
      amount: c.amount,
      mayBeLaunchToken: generation === "lp-fee",
      claim: {
        to: c.hook,
        data:
          c.guard === "CL"
            ? encodeFunctionData({ abi: LAUNCH_GUARD_HOOK_ABI, functionName: "claim", args: [c.currency, account] })
            : encodeFunctionData({ abi: BIN_LAUNCH_GUARD_HOOK_ABI, functionName: "claim", args: [c.currency, account] }),
      },
    });
  }

  /* One pot row per guard, pool and currency: the fee's and the tax's halves side by side. */
  const pots = new Map<string, { -readonly [K in keyof EarningsPotV2]: EarningsPotV2[K] }>();
  const potOf = (p: { guard: "CL" | "Bin"; hook: Address; poolId: Hex; token: Address; tokenMeta: TokenMeta | null }, currency: Address, meta: TokenMeta | null) => {
    const key = `${p.guard}:${p.poolId.toLowerCase()}:${currency.toLowerCase()}`;
    let row = pots.get(key);
    if (row === undefined) {
      row = {
        key,
        pools: p.guard,
        hook: p.hook,
        generation: generationOf(p.guard),
        poolId: p.poolId,
        token: p.token,
        tokenMeta: p.tokenMeta,
        currency,
        meta,
        fee: null,
        tax: null,
        share: 0n,
        settleAndClaim: {
          to: p.hook,
          data:
            p.guard === "CL"
              ? encodeFunctionData({ abi: LAUNCH_GUARD_HOOK_ABI, functionName: "claimFrom", args: [[p.poolId], currency, account] })
              : encodeFunctionData({ abi: BIN_LAUNCH_GUARD_HOOK_ABI, functionName: "claimFrom", args: [[p.poolId], currency, account] }),
        },
      };
      pots.set(key, row);
    }
    return row;
  };
  for (const pool of earnings.fee.pools) {
    for (const x of pool.pending) {
      const row = potOf(pool, x.currency, x.meta);
      row.fee = { pot: x.amount, share: x.share, bps: pool.bps };
    }
  }
  for (const pool of earnings.tax.pools) {
    const quoteOnly = generationOf(pool.guard) === "quote-fee";
    for (const x of pool.pending) {
      /* A "quote-fee" guard taxes in the quote only. The tax read does not say which of the pool's two
         currencies that is; the launch token is the launch's own. */
      if (quoteOnly && x.currency.toLowerCase() === pool.token.toLowerCase()) continue;
      const row = potOf(pool, x.currency, x.meta);
      row.tax = { pot: x.amount, share: floorShare(x.amount, pool.bps), bps: pool.bps, live: pool.live };
    }
  }
  for (const row of pots.values()) row.share = (row.fee?.share ?? 0n) + (row.tax?.share ?? 0n);

  const locks: EarningsLockV2[] = earnings.locks.map((l) => {
    const locker = lockerOf(l.locker);
    return {
      key: `${l.locker}:${l.lockId.toString()}`,
      pools: l.locker,
      locker,
      lockId: l.lockId,
      token: l.token,
      tokenMeta: l.tokenMeta,
      role: l.role,
      generation: l.guardGeneration,
      earnsTradeFee: lockEarnsTradeFee(l.guardGeneration, l.lpShareBps),
      lpShareBps: l.guardGeneration === "quote-fee" ? l.lpShareBps : null,
      collect: {
        to: locker,
        data:
          l.locker === "CL"
            ? encodeFunctionData({ abi: LATCH_LP_LOCKER_ABI, functionName: "collectFees", args: [l.lockId] })
            : encodeFunctionData({ abi: LATCH_BIN_LP_LOCKER_ABI, functionName: "collectFees", args: [l.lockId] }),
      },
    };
  });

  return { account, credits, pots: [...pots.values()], locks };
}

/** One currency's total. */
export interface EarningsTotalV2 {
  readonly currency: Address;
  readonly meta: TokenMeta | null;
  readonly amount: bigint;
}

function totals(rows: readonly { currency: Address; meta: TokenMeta | null; amount: bigint }[]): EarningsTotalV2[] {
  const sums = new Map<string, { currency: Address; meta: TokenMeta | null; amount: bigint }>();
  for (const r of rows) {
    if (r.amount === 0n) continue;
    const k = r.currency.toLowerCase();
    const prev = sums.get(k);
    sums.set(k, { currency: r.currency, meta: prev?.meta ?? r.meta, amount: (prev?.amount ?? 0n) + r.amount });
  }
  return [...sums.values()];
}

/**
 * What `account` can withdraw now, per currency: the balances, each counted once.
 * The native currency first where it is owed anything.
 */
export function claimableTotals(plan: EarningsPlanV2): readonly EarningsTotalV2[] {
  const out = totals(plan.credits);
  return out.sort((a, b) => (a.currency === NATIVE_ADDRESS ? -1 : b.currency === NATIVE_ADDRESS ? 1 : 0));
}

/**
 * What settling every guard pot now would credit `account`, per currency. Not
 * withdrawable until settled, and not part of `claimableTotals`.
 */
export function unsettledTotals(plan: EarningsPlanV2): readonly EarningsTotalV2[] {
  const out = totals(plan.pots.map((p) => ({ currency: p.currency, meta: p.meta, amount: p.share })));
  return out.sort((a, b) => (a.currency === NATIVE_ADDRESS ? -1 : b.currency === NATIVE_ADDRESS ? 1 : 0));
}

/**
 * The locks a screen offers to collect: those any of the trade fee accrues to
 * (a "quote-fee" lock whose guard leaves the pool a share included), those
 * whose guard or share is unknown, and every Bin lock.
 */
export function collectableLocks(plan: EarningsPlanV2): readonly EarningsLockV2[] {
  return plan.locks.filter((l) => l.earnsTradeFee !== false || l.pools === "Bin");
}
