// SPDX-License-Identifier: MIT
/* ============================================================================
   Kit v2 reads: the kit's wiring and limits, its launches, and what an account
   can claim. Everything a launchpad front end renders, from one client and the
   kit's address.

   Proven on a Robinhood (4663) anvil fork against a real kit (2026-09-17) as
   the create-latch-dex template's own modules; moved here so the template,
   the Latch dapp's hosted pad sites and the widgets read through one
   implementation.

   ONE CLOCK. Everything time-shaped on the v2 stack is `block.timestamp`
   seconds; the kit answers `CLOCK_MODE()` with `"mode=timestamp"` and this
   module refuses a kit that does not. `now` is the chain's own timestamp read
   by `eth_call`, never the reading machine's wall clock.

   NOTHING HERE IS A SALE. There is no cap, no allocation and no claim. What is
   read is a schedule per pool, the fee the guard charges right now, and the
   frozen split of what each locked position earns.
   ============================================================================ */

import { BaseError, ContractFunctionRevertedError, ExecutionRevertedError, erc20Abi, getAbiItem, type Address, type Hex, type PublicClient } from "viem";

import { readContractClock } from "../../chains/clock.js";
import {
  BIN_LAUNCH_GUARD_HOOK_ABI,
  LATCH_BIN_LP_LOCKER_ABI,
  LATCH_LP_LOCKER_ABI,
  LAUNCHPAD_KIT_V2_ABI,
  LAUNCH_GUARD_HOOK_ABI,
  LAUNCH_TOKEN_FACTORY_ABI,
} from "../generated/abi.js";
import { CL_POSITION_MANAGER_ABI } from "../../trading/generated/abi.js";
import { LATCH_LAUNCH_REGISTRY_ABI } from "../../registry/generated/abi.js";
import type { PoolKey } from "../../types/poolKey.js";
import { readLaunchValue, type DecodedTenantConfig, type LaunchValueQuote } from "./fees.js";
import { readKitV2Caps } from "./fees.js";
import { TIMESTAMP_CLOCK_MODE } from "../../revshare/pendingConfig.js";
import type { KitV2LegEnv } from "./legs.js";
import { LEG_KIND, type KitV2Caps } from "./types.js";
import type { TaxBounds } from "./validate.js";

export const NATIVE_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

/** Symbol, name and decimals as a token contract answers them, or `null` when it does not. Never invented. */
export interface TokenMeta {
  readonly address: Address;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
}

export async function readTokenMeta(client: PublicClient, address: Address): Promise<TokenMeta | null> {
  try {
    const [symbol, name, decimals] = await Promise.all([
      client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
      client.readContract({ address, abi: erc20Abi, functionName: "name" }),
      client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
    ]);
    return { address, symbol, name, decimals: Number(decimals) };
  } catch {
    return null;
  }
}

/** Thrown when the kit does not count in `block.timestamp`. */
export class KitV2ClockError extends Error {
  constructor(kit: Address, mode: string) {
    super(`LaunchpadKitV2 ${kit} reports CLOCK_MODE "${mode}", not "${TIMESTAMP_CLOCK_MODE}"; refusing to read it.`);
    this.name = "KitV2ClockError";
  }
}

/** The contracts a v2 launch touches, read off the kit — never assumed from an address book. */
export interface KitV2Env extends KitV2LegEnv {
  readonly kit: Address;
  readonly clPositionManager: Address;
  readonly binPositionManager: Address;
  readonly clLocker: Address;
  readonly binLocker: Address;
  readonly tokenFactory: Address;
  readonly launchRegistry: Address;
  readonly protocolFeeRecipient: Address;
}

/** The kit's wiring. Every field is an immutable; cache the result per kit. */
export async function readKitV2Env(client: PublicClient, kit: Address): Promise<KitV2Env> {
  const read = <
    F extends
      | "clHook"
      | "binHook"
      | "clPoolManager"
      | "binPoolManager"
      | "clPositionManager"
      | "binPositionManager"
      | "clLocker"
      | "binLocker"
      | "tokenFactory"
      | "launchRegistry"
      | "protocolFeeRecipient"
      | "CLOCK_MODE",
  >(
    functionName: F,
  ) => client.readContract({ address: kit, abi: LAUNCHPAD_KIT_V2_ABI, functionName });
  const [mode, clHook, binHook, clPoolManager, binPoolManager, clPositionManager, binPositionManager, clLocker, binLocker, tokenFactory, launchRegistry, protocolFeeRecipient] =
    await Promise.all([
      read("CLOCK_MODE"),
      read("clHook"),
      read("binHook"),
      read("clPoolManager"),
      read("binPoolManager"),
      read("clPositionManager"),
      read("binPositionManager"),
      read("clLocker"),
      read("binLocker"),
      read("tokenFactory"),
      read("launchRegistry"),
      read("protocolFeeRecipient"),
    ]);
  if (mode !== TIMESTAMP_CLOCK_MODE) throw new KitV2ClockError(kit, mode);
  return { kit, clHook, binHook, clPoolManager, binPoolManager, clPositionManager, binPositionManager, clLocker, binLocker, tokenFactory, launchRegistry, protocolFeeRecipient };
}

/** Every number a launch is validated against, read off the deployed contracts. */
export interface KitV2Limits {
  readonly env: KitV2Env;
  readonly caps: KitV2Caps;
  /** The launch guards' limits (both guards are built from one source; the CL one is read). */
  readonly guard: {
    readonly minDecaySeconds: number;
    readonly maxDecaySeconds: number;
    readonly maxInitialFeeBips: number;
    readonly maxFinalFeeBips: number;
    readonly maxStartDelaySeconds: number;
  };
  /** The lockers' immutable split bounds (the kit asserts both lockers agree). */
  readonly locker: { readonly minProtocolBps: number; readonly maxProtocolBps: number; readonly maxIntegratorBps: number };
  /** The guards' creator-tax bounds (`LaunchTaxModule` constants; the kit asserts both guards agree). */
  readonly tax: TaxBounds;
  readonly maxIntegratorLaunchFeeWei: bigint;
  readonly maxLaunchFeeWei: bigint;
  /** The factory's byte limits on the token's strings. */
  readonly token: { readonly maxNameBytes: number; readonly maxSymbolBytes: number; readonly maxMetadataUriBytes: number };
  /** What a launch costs right now under `terms`, and the tenant it runs under. */
  readonly value: LaunchValueQuote;
  /** The tenant, once its config was read and found active; `null` for direct launches. */
  readonly tenantAddress: Address | null;
  readonly tenant: DecodedTenantConfig | null;
  /** Quotes the tenant allows, over `candidateQuotes`. Only meaningful when `tenant.restrictQuotes`. */
  readonly tenantAllowedQuotes: readonly Address[];
  /** The integrator terms a launch will carry: the STORED ones for a tenant, the supplied ones otherwise. `taxBps` is the integrator's share of a creator tax. */
  readonly integrator: {
    readonly address: Address;
    readonly bps: number;
    readonly launchFeeWei: bigint;
    readonly taxBps: number;
    readonly source: "tenant" | "direct";
  };
}

export interface ReadKitV2LimitsOptions {
  /** A tenant (a pad, or a wallet that ran `setTenantConfig`). Its stored terms win. */
  readonly tenant?: Address | null;
  /** For a DIRECT launch (no tenant): the integrator terms to carry. Ignored with a tenant. `taxIntegratorBps` defaults to 0. */
  readonly direct?: {
    readonly integrator: Address;
    readonly integratorBps: number;
    readonly integratorLaunchFeeWei: bigint;
    readonly taxIntegratorBps?: number;
  };
  /** Quotes to test against the tenant's allowlist when it restricts quotes. */
  readonly candidateQuotes?: readonly Address[];
  /** A cached `readKitV2Env` result, to skip re-reading immutables. */
  readonly env?: KitV2Env;
}

/** The kit's, guards', lockers' and factory's limits. Nothing here is hardcoded. */
export async function readKitV2Limits(client: PublicClient, kit: Address, opts: ReadKitV2LimitsOptions = {}): Promise<KitV2Limits> {
  const env = opts.env ?? (await readKitV2Env(client, kit));
  const tenant = opts.tenant ?? null;
  const direct = opts.direct;
  const [caps, minDecay, maxDecay, maxInitial, maxFinal, maxStartDelay, minProtocol, maxProtocol, maxIntegrator, maxIntegratorFee, maxLaunchFee, maxName, maxSymbol, maxUri, value, taxMax, taxMinProtocol, taxMaxProtocol, taxMaxIntegrator, taxMaxDuration] =
    await Promise.all([
      readKitV2Caps(client, kit),
      client.readContract({ address: env.clHook, abi: LAUNCH_GUARD_HOOK_ABI, functionName: "MIN_DECAY_SECONDS" }),
      client.readContract({ address: env.clHook, abi: LAUNCH_GUARD_HOOK_ABI, functionName: "MAX_DECAY_SECONDS" }),
      client.readContract({ address: env.clHook, abi: LAUNCH_GUARD_HOOK_ABI, functionName: "MAX_INITIAL_FEE" }),
      client.readContract({ address: env.clHook, abi: LAUNCH_GUARD_HOOK_ABI, functionName: "MAX_FINAL_FEE" }),
      client.readContract({ address: env.clHook, abi: LAUNCH_GUARD_HOOK_ABI, functionName: "MAX_START_DELAY_SECONDS" }),
      client.readContract({ address: env.clLocker, abi: LATCH_LP_LOCKER_ABI, functionName: "minProtocolBps" }),
      client.readContract({ address: env.clLocker, abi: LATCH_LP_LOCKER_ABI, functionName: "maxProtocolBps" }),
      client.readContract({ address: env.clLocker, abi: LATCH_LP_LOCKER_ABI, functionName: "maxIntegratorBps" }),
      client.readContract({ address: kit, abi: LAUNCHPAD_KIT_V2_ABI, functionName: "maxIntegratorLaunchFeeWei" }),
      client.readContract({ address: kit, abi: LAUNCHPAD_KIT_V2_ABI, functionName: "maxLaunchFeeWei" }),
      client.readContract({ address: env.tokenFactory, abi: LAUNCH_TOKEN_FACTORY_ABI, functionName: "MAX_NAME_BYTES" }),
      client.readContract({ address: env.tokenFactory, abi: LAUNCH_TOKEN_FACTORY_ABI, functionName: "MAX_SYMBOL_BYTES" }),
      client.readContract({ address: env.tokenFactory, abi: LAUNCH_TOKEN_FACTORY_ABI, functionName: "MAX_METADATA_URI_BYTES" }),
      readLaunchValue(client, kit, tenant === null ? { integratorLaunchFeeWei: direct?.integratorLaunchFeeWei ?? 0n } : { tenant }),
      client.readContract({ address: env.clHook, abi: LAUNCH_GUARD_HOOK_ABI, functionName: "MAX_TAX_BPS" }),
      client.readContract({ address: env.clHook, abi: LAUNCH_GUARD_HOOK_ABI, functionName: "MIN_PROTOCOL_BPS" }),
      client.readContract({ address: env.clHook, abi: LAUNCH_GUARD_HOOK_ABI, functionName: "MAX_PROTOCOL_BPS" }),
      client.readContract({ address: env.clHook, abi: LAUNCH_GUARD_HOOK_ABI, functionName: "MAX_INTEGRATOR_BPS" }),
      client.readContract({ address: env.clHook, abi: LAUNCH_GUARD_HOOK_ABI, functionName: "MAX_TAX_DURATION_SECONDS" }),
    ]);

  let tenantAllowedQuotes: Address[] = [];
  if (value.tenant !== null && value.tenant.restrictQuotes && tenant !== null) {
    const candidates = opts.candidateQuotes ?? [NATIVE_ADDRESS];
    const allowed = await Promise.all(
      candidates.map((quote) =>
        client.readContract({ address: kit, abi: LAUNCHPAD_KIT_V2_ABI, functionName: "tenantQuoteAllowed", args: [tenant, quote] }),
      ),
    );
    tenantAllowedQuotes = candidates.filter((_, i) => allowed[i] === true);
  }

  const integrator: KitV2Limits["integrator"] =
    value.tenant !== null
      ? {
          address: value.tenant.integrator,
          bps: value.tenant.integratorBps,
          launchFeeWei: value.tenant.integratorLaunchFeeWei,
          taxBps: value.tenant.taxIntegratorBps,
          source: "tenant",
        }
      : direct === undefined
        ? { address: NATIVE_ADDRESS, bps: 0, launchFeeWei: 0n, taxBps: 0, source: "direct" }
        : {
            address: direct.integrator,
            bps: direct.integratorBps,
            launchFeeWei: direct.integratorLaunchFeeWei,
            taxBps: direct.taxIntegratorBps ?? 0,
            source: "direct",
          };

  return {
    env,
    caps,
    guard: {
      minDecaySeconds: Number(minDecay),
      maxDecaySeconds: Number(maxDecay),
      maxInitialFeeBips: Number(maxInitial),
      maxFinalFeeBips: Number(maxFinal),
      maxStartDelaySeconds: Number(maxStartDelay),
    },
    locker: { minProtocolBps: Number(minProtocol), maxProtocolBps: Number(maxProtocol), maxIntegratorBps: Number(maxIntegrator) },
    tax: {
      maxTaxBps: Number(taxMax),
      minProtocolBps: Number(taxMinProtocol),
      maxProtocolBps: Number(taxMaxProtocol),
      maxIntegratorBps: Number(taxMaxIntegrator),
      maxTaxDurationSeconds: Number(taxMaxDuration),
    },
    maxIntegratorLaunchFeeWei: maxIntegratorFee,
    maxLaunchFeeWei: maxLaunchFee,
    token: { maxNameBytes: Number(maxName), maxSymbolBytes: Number(maxSymbol), maxMetadataUriBytes: Number(maxUri) },
    value,
    tenantAddress: value.tenant === null ? null : tenant,
    tenant: value.tenant,
    tenantAllowedQuotes,
    integrator,
  };
}

/* ------------------------------------------------------------ launches --- */

/**
 * `unknown` is a leg whose guard REVERTED `getLaunch` (no record for a pool the
 * kit lists - the kit and the guard disagree). A transport failure is not a
 * phase: it throws, so a flaky RPC can never render a live launch as settled.
 */
export type LaunchPhase = "scheduled" | "decaying" | "settled" | "unknown";

/** `null` for a contract revert; rethrows anything else (transport, decoding). */
async function nullOnRevert<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (
      error instanceof BaseError &&
      error.walk((x: unknown) => x instanceof ExecutionRevertedError || x instanceof ContractFunctionRevertedError) !== null
    ) {
      return null;
    }
    throw error;
  }
}
/** The leg kind as a word. (`LegKindName` in `./types.js` is the enum KEY type, "CL" | "Bin", the same strings.) */
export type LegKindWord = "CL" | "Bin";

/** `launchPhase` on the timestamp clock. */
export function launchPhase(start: bigint, window: number, now: bigint): LaunchPhase {
  const end = start + BigInt(window);
  return now < start ? "scheduled" : now < end ? "decaying" : "settled";
}

export interface LaunchLegV2 {
  readonly poolId: Hex;
  readonly kind: LegKindWord;
  /**
   * The pool's full key, read from the position that holds the seed (the CL
   * position manager's `getPoolAndPositionInfo`, the Bin locker's `getPoolKey`).
   * `null` when that read reverted. What a quoter and a router need.
   */
  readonly key: PoolKey | null;
  readonly quote: Address;
  /** `null` for the native asset (the caller knows its symbol) or an unreadable token. */
  readonly quoteMeta: TokenMeta | null;
  /** CL: the position token id in `LatchLPLocker`. Bin: the lock id in `LatchBinLPLocker`. */
  readonly lockId: bigint;
  readonly weightBps: number;
  readonly launchTokenSeeded: bigint;
  readonly launchTokenIsCurrency0: boolean;
  readonly currentFeePips: number | null;
  readonly guard: {
    readonly startTime: bigint;
    readonly decaySeconds: number;
    readonly initialFeeBips: number;
    readonly finalFeeBips: number;
    readonly maxBuyPerTx: bigint;
    readonly enabled: boolean;
    readonly launched: boolean;
  } | null;
  /**
   * The creator tax as the guard stores it, or `null` when the pool has none (`expiresAt == 0`).
   * `live` is `expiresAt > now`: once false the guard takes nothing, with no transaction needed.
   */
  readonly tax: {
    readonly buyBps: number;
    readonly sellBps: number;
    readonly expiresAt: bigint;
    readonly creator: Address;
    readonly integrator: Address;
    readonly creatorBps: number;
    readonly protocolBps: number;
    readonly integratorBps: number;
    readonly live: boolean;
  } | null;
  readonly lock: {
    readonly creator: Address;
    readonly integrator: Address;
    readonly creatorBps: number;
    readonly integratorBps: number;
    readonly protocolBps: number;
    readonly lockedAt: bigint;
  } | null;
  readonly phase: LaunchPhase;
  readonly remaining: bigint | null;
}

/**
 * The creator's listing as the launch registry stores it: exactly
 * `LaunchMetadata`'s four `string` members (`ILatchLaunchRegistry.sol`).
 * Human-supplied, never trusted for anything checkable: render the links and
 * never let them sit beside a badge they did not earn. There is NO icon here —
 * `iconURI` was removed from the struct on 2026-09-24 (a fifth member put the
 * kit over EIP-170); an icon comes from a token list or the token's own
 * `metadataURI`. The two handles are validated by the contract (charset and
 * length) and render to exactly one URL each (`xUrlOf`, `telegramUrlOf`);
 * well-formed is not authentic, so never infer ownership from a handle.
 */
export interface LaunchListing {
  readonly description: string;
  readonly websiteURI: string;
  /** X handle without the "@"; `""` for none. */
  readonly xHandle: string;
  /** Telegram handle, group or channel without the "@"; `""` for none. */
  readonly telegramHandle: string;
}

export interface LaunchRecordV2 {
  readonly token: Address;
  readonly tokenMeta: TokenMeta | null;
  /** From `LatchLaunchRegistry.getLaunch(firstLeg.poolId)`; `null` when the record could not be read. */
  readonly listing: LaunchListing | null;
  readonly creator: Address;
  /** Zero for a direct launch. */
  readonly tenant: Address;
  readonly launcher: Address;
  readonly operator: Address;
  readonly totalSupply: bigint;
  readonly seedSupply: bigint;
  /**
   * When trading opens, LIVE: the guards' current `startTime` (the operator
   * may move it with `reconfigureLaunch` until it passes). Falls back to the
   * creation log's value only when no guard could be read.
   */
  readonly startTime: bigint;
  /** The start time the `LaunchCreated` log recorded. Stale after a reconfigure; kept for provenance. */
  readonly startTimeAtCreation: bigint;
  readonly protocolFeeWei: bigint;
  readonly integrator: Address;
  readonly integratorFeeWei: bigint;
  readonly createdAtBlock: bigint;
  readonly txHash: Hex;
  readonly legs: readonly LaunchLegV2[];
  readonly phase: LaunchPhase;
}

export interface LaunchScanV2 {
  readonly launches: readonly LaunchRecordV2[];
  readonly env: KitV2Env;
  readonly fromBlock: bigint;
  readonly atBlock: bigint;
  /** `block.timestamp` as the contracts see it. Every phase is judged against this. */
  readonly now: bigint;
}

const LAUNCH_CREATED = getAbiItem({ abi: LAUNCHPAD_KIT_V2_ABI, name: "LaunchCreated" });
const LEG_CREATED = getAbiItem({ abi: LAUNCHPAD_KIT_V2_ABI, name: "LaunchLegCreated" });

function legKindName(kind: number): LegKindWord {
  if (kind === LEG_KIND.CL) return "CL";
  if (kind === LEG_KIND.Bin) return "Bin";
  throw new Error(`${kind} is not a LegKind the kit emits (0 CL, 1 Bin)`);
}

interface LegLog {
  readonly poolId: Hex;
  readonly kind: LegKindWord;
  readonly quote: Address;
  readonly lockId: bigint;
  readonly launchTokenSeeded: bigint;
  readonly weightBps: number;
}

async function readLeg(client: PublicClient, env: KitV2Env, leg: LegLog, now: bigint): Promise<LaunchLegV2> {
  const hook = leg.kind === "CL" ? env.clHook : env.binHook;
  const hookAbi = leg.kind === "CL" ? LAUNCH_GUARD_HOOK_ABI : BIN_LAUNCH_GUARD_HOOK_ABI;
  const [quoteMeta, kitLeg, guard, fee, lock, keyRead, taxRead] = await Promise.all([
    leg.quote === NATIVE_ADDRESS ? Promise.resolve(null) : readTokenMeta(client, leg.quote),
    client.readContract({ address: env.kit, abi: LAUNCHPAD_KIT_V2_ABI, functionName: "getLeg", args: [leg.poolId] }),
    nullOnRevert(client.readContract({ address: hook, abi: hookAbi, functionName: "getLaunch", args: [leg.poolId] })),
    nullOnRevert(client.readContract({ address: hook, abi: hookAbi, functionName: "currentFee", args: [leg.poolId] })),
    leg.kind === "CL"
      ? nullOnRevert(client.readContract({ address: env.clLocker, abi: LATCH_LP_LOCKER_ABI, functionName: "getLock", args: [leg.lockId] }))
      : nullOnRevert(client.readContract({ address: env.binLocker, abi: LATCH_BIN_LP_LOCKER_ABI, functionName: "getLock", args: [leg.lockId] })),
    leg.kind === "CL"
      ? nullOnRevert(
          client.readContract({ address: env.clPositionManager, abi: CL_POSITION_MANAGER_ABI, functionName: "getPoolAndPositionInfo", args: [leg.lockId] }),
        ).then((r) => (r === null ? null : r[0]))
      : nullOnRevert(client.readContract({ address: env.binLocker, abi: LATCH_BIN_LP_LOCKER_ABI, functionName: "getPoolKey", args: [leg.lockId] })),
    nullOnRevert(client.readContract({ address: hook, abi: hookAbi, functionName: "getTax", args: [leg.poolId] })),
  ]);
  const tax: LaunchLegV2["tax"] =
    taxRead === null || taxRead.expiresAt === 0
      ? null
      : {
          buyBps: taxRead.buyBps,
          sellBps: taxRead.sellBps,
          expiresAt: BigInt(taxRead.expiresAt),
          creator: taxRead.creator,
          integrator: taxRead.integrator,
          creatorBps: taxRead.creatorBps,
          protocolBps: taxRead.protocolBps,
          integratorBps: taxRead.integratorBps,
          live: BigInt(taxRead.expiresAt) > now,
        };
  const key: PoolKey | null =
    keyRead === null
      ? null
      : {
          currency0: keyRead.currency0,
          currency1: keyRead.currency1,
          hooks: keyRead.hooks,
          poolManager: keyRead.poolManager,
          fee: Number(keyRead.fee),
          parameters: keyRead.parameters,
        };
  const guardRead =
    guard === null
      ? null
      : {
          startTime: BigInt(guard.startTime),
          decaySeconds: Number(guard.decaySeconds),
          initialFeeBips: Number(guard.initialFeeBips),
          finalFeeBips: Number(guard.finalFeeBips),
          maxBuyPerTx: guard.maxBuyPerTx,
          enabled: guard.enabled,
          launched: guard.launched,
        };
  const phase: LaunchPhase = guardRead === null ? "unknown" : launchPhase(guardRead.startTime, guardRead.decaySeconds, now);
  return {
    poolId: leg.poolId,
    kind: leg.kind,
    key,
    quote: leg.quote,
    quoteMeta,
    lockId: leg.lockId,
    weightBps: leg.weightBps,
    launchTokenSeeded: leg.launchTokenSeeded,
    launchTokenIsCurrency0: kitLeg.launchTokenIsCurrency0,
    currentFeePips: fee === null ? null : Number(fee),
    guard: guardRead,
    tax,
    lock:
      lock === null
        ? null
        : {
            creator: lock.creator,
            integrator: lock.integrator,
            creatorBps: Number(lock.creatorBps),
            integratorBps: Number(lock.integratorBps),
            protocolBps: Number(lock.protocolBps),
            lockedAt: BigInt(lock.lockedAt),
          },
    phase,
    remaining: guardRead === null || phase === "settled" ? null : guardRead.startTime + BigInt(guardRead.decaySeconds) - now,
  };
}

export interface ReadKitV2LaunchesOptions {
  /** First block to scan. The kit's deployment block, or the chain's Latch deployment block. */
  readonly fromBlock: bigint;
  /** Only launches naming this tenant (a pad). Omit for every launch. */
  readonly tenant?: Address;
  /** Only this creator's launches. */
  readonly creator?: Address;
  /** The chain id, for `readContractClock`. */
  readonly chainId: number;
  readonly env?: KitV2Env;
}

/** Every launch the kit created (filtered), newest first, with every leg read live. */
export async function readKitV2Launches(client: PublicClient, kit: Address, opts: ReadKitV2LaunchesOptions): Promise<LaunchScanV2> {
  const env = opts.env ?? (await readKitV2Env(client, kit));
  const args: { tenant?: Address; creator?: Address } = {};
  if (opts.tenant !== undefined) args.tenant = opts.tenant;
  if (opts.creator !== undefined) args.creator = opts.creator;
  const [created, legLogs, clock] = await Promise.all([
    client.getLogs({ address: kit, event: LAUNCH_CREATED, args, fromBlock: opts.fromBlock, toBlock: "latest" }),
    client.getLogs({ address: kit, event: LEG_CREATED, fromBlock: opts.fromBlock, toBlock: "latest" }),
    readContractClock(client, opts.chainId),
  ]);
  const now = clock.timestamp;

  const legsByToken = new Map<string, LegLog[]>();
  for (const log of legLogs) {
    const token = (log.args.token as Address).toLowerCase();
    const list = legsByToken.get(token) ?? [];
    list.push({
      poolId: log.args.poolId as Hex,
      kind: legKindName(Number(log.args.kind)),
      quote: log.args.quote as Address,
      lockId: BigInt(log.args.lockId ?? 0n),
      launchTokenSeeded: BigInt(log.args.launchTokenSeeded ?? 0n),
      weightBps: Number(log.args.weightBps ?? 0),
    });
    legsByToken.set(token, list);
  }

  const launches = await Promise.all(
    created.map(async (log): Promise<LaunchRecordV2> => {
      const token = log.args.token as Address;
      const rawLegs = legsByToken.get(token.toLowerCase()) ?? [];
      const firstPool = rawLegs[0]?.poolId;
      const [tokenMeta, legs, listing] = await Promise.all([
        readTokenMeta(client, token),
        Promise.all(rawLegs.map((leg) => readLeg(client, env, leg, now))),
        firstPool === undefined
          ? Promise.resolve(null)
          : nullOnRevert(
              client.readContract({ address: env.launchRegistry, abi: LATCH_LAUNCH_REGISTRY_ABI, functionName: "getLaunch", args: [firstPool] }),
            ).then((r) =>
              r === null
                ? null
                : {
                    description: r.metadata.description,
                    websiteURI: r.metadata.websiteURI,
                    xHandle: r.metadata.xHandle,
                    telegramHandle: r.metadata.telegramHandle,
                  },
            ),
      ]);
      const startTimeAtCreation = BigInt(log.args.startTime ?? 0);
      /* The guards are the truth about when trading opens; a reconfigure moves them, not the log. */
      const liveStart = legs.map((l) => l.guard?.startTime).find((t): t is bigint => t !== undefined);
      const startTime = liveStart ?? startTimeAtCreation;
      const phase: LaunchPhase = legs.some((l) => l.phase === "unknown")
        ? "unknown"
        : now < startTime
          ? "scheduled"
          : legs.some((l) => l.phase === "decaying")
            ? "decaying"
            : "settled";
      return {
        token,
        tokenMeta,
        listing,
        creator: log.args.creator as Address,
        tenant: log.args.tenant as Address,
        launcher: log.args.launcher as Address,
        operator: log.args.operator as Address,
        totalSupply: BigInt(log.args.totalSupply ?? 0n),
        seedSupply: BigInt(log.args.seedSupply ?? 0n),
        startTime,
        startTimeAtCreation,
        protocolFeeWei: BigInt(log.args.protocolFeeWei ?? 0n),
        integrator: log.args.integrator as Address,
        integratorFeeWei: BigInt(log.args.integratorFeeWei ?? 0n),
        createdAtBlock: log.blockNumber,
        txHash: log.transactionHash,
        legs,
        phase,
      };
    }),
  );
  launches.sort((a, b) => Number(b.createdAtBlock - a.createdAtBlock));
  return { launches, env, fromBlock: opts.fromBlock, atBlock: clock.rpcBlockNumber, now };
}

/* ------------------------------------------------------------ earnings --- */

export interface EarningsV2 {
  readonly account: Address;
  /** Native wei the kit owes `account` (integrator launch fees). */
  readonly kitFeesOwed: bigint;
  readonly claimable: readonly {
    readonly locker: "CL" | "Bin";
    readonly currency: Address;
    readonly meta: TokenMeta | null;
    readonly amount: bigint;
  }[];
  /** Locks where `account` is creator or integrator: `collectFees(lockId)` moves their earned fees into `claimable`. */
  readonly locks: readonly {
    readonly locker: "CL" | "Bin";
    readonly lockId: bigint;
    readonly token: Address;
    readonly tokenMeta: TokenMeta | null;
    readonly role: "creator" | "integrator" | "both";
    readonly currency0: Address;
    readonly currency1: Address;
  }[];
  /**
   * The creator tax, read off the guards. `claimable` is what `claim(currency, to)` on that guard pays
   * `account` now; `pools` are the legs where `account` is a tax bucket, with each pool's UNSETTLED
   * pot per currency (`settleTax(poolId, currency)` splits it; `claimFrom(pools, currency, to)` does
   * both). `account`'s share of a pot is `pot * bps / 10000`, floored, before the protocol takes the
   * remainder.
   */
  readonly tax: {
    readonly claimable: readonly {
      readonly guard: "CL" | "Bin";
      readonly hook: Address;
      readonly currency: Address;
      readonly meta: TokenMeta | null;
      readonly amount: bigint;
    }[];
    readonly pools: readonly {
      readonly guard: "CL" | "Bin";
      readonly hook: Address;
      readonly poolId: Hex;
      readonly token: Address;
      readonly tokenMeta: TokenMeta | null;
      readonly role: "creator" | "integrator";
      readonly bps: number;
      readonly live: boolean;
      readonly expiresAt: bigint;
      readonly pending: readonly { readonly currency: Address; readonly meta: TokenMeta | null; readonly amount: bigint }[];
    }[];
  };
}

/** Everything `account` can claim from the launches in `scan`, read live. */
export async function readKitV2Earnings(client: PublicClient, scan: LaunchScanV2, account: Address): Promise<EarningsV2> {
  const env = scan.env;
  const same = (a: Address, b: Address): boolean => a.toLowerCase() === b.toLowerCase();
  const locks: EarningsV2["locks"][number][] = [];
  const currencies = new Map<string, { locker: "CL" | "Bin"; currency: Address; meta: TokenMeta | null }>();

  for (const launch of scan.launches) {
    for (const leg of launch.legs) {
      if (leg.lock === null) continue;
      const isCreator = same(leg.lock.creator, account);
      const isIntegrator = same(leg.lock.integrator, account);
      if (!isCreator && !isIntegrator) continue;
      const [currency0, currency1] = leg.launchTokenIsCurrency0 ? [launch.token, leg.quote] : [leg.quote, launch.token];
      locks.push({
        locker: leg.kind,
        lockId: leg.lockId,
        token: launch.token,
        tokenMeta: launch.tokenMeta,
        role: isCreator && isIntegrator ? "both" : isCreator ? "creator" : "integrator",
        currency0,
        currency1,
      });
      for (const c of [currency0, currency1]) {
        const key = `${leg.kind}:${c.toLowerCase()}`;
        if (!currencies.has(key)) currencies.set(key, { locker: leg.kind, currency: c, meta: same(c, launch.token) ? launch.tokenMeta : leg.quoteMeta });
      }
    }
  }

  const taxPools: { guard: "CL" | "Bin"; hook: Address; poolId: Hex; token: Address; tokenMeta: TokenMeta | null; role: "creator" | "integrator"; bps: number; live: boolean; expiresAt: bigint; currencies: { currency: Address; meta: TokenMeta | null }[] }[] = [];
  const taxCurrencies = new Map<string, { guard: "CL" | "Bin"; hook: Address; currency: Address; meta: TokenMeta | null }>();
  for (const launch of scan.launches) {
    for (const leg of launch.legs) {
      if (leg.tax === null) continue;
      const isCreator = leg.tax.creatorBps > 0 && same(leg.tax.creator, account);
      const isIntegrator = leg.tax.integratorBps > 0 && same(leg.tax.integrator, account);
      if (!isCreator && !isIntegrator) continue;
      const hook = leg.kind === "CL" ? env.clHook : env.binHook;
      const [currency0, currency1] = leg.launchTokenIsCurrency0 ? [launch.token, leg.quote] : [leg.quote, launch.token];
      const cs = [currency0, currency1].map((c) => ({ currency: c, meta: same(c, launch.token) ? launch.tokenMeta : leg.quoteMeta }));
      taxPools.push({
        guard: leg.kind,
        hook,
        poolId: leg.poolId,
        token: launch.token,
        tokenMeta: launch.tokenMeta,
        role: isCreator ? "creator" : "integrator",
        bps: isCreator ? leg.tax.creatorBps : leg.tax.integratorBps,
        live: leg.tax.live,
        expiresAt: leg.tax.expiresAt,
        currencies: cs,
      });
      for (const c of cs) {
        const key = `${leg.kind}:${c.currency.toLowerCase()}`;
        if (!taxCurrencies.has(key)) taxCurrencies.set(key, { guard: leg.kind, hook, currency: c.currency, meta: c.meta });
      }
    }
  }

  const [kitFeesOwed, amounts, taxAmounts, taxPending] = await Promise.all([
    client.readContract({ address: env.kit, abi: LAUNCHPAD_KIT_V2_ABI, functionName: "feesOwed", args: [account] }),
    Promise.all(
      [...currencies.values()].map((c) =>
        c.locker === "CL"
          ? client.readContract({ address: env.clLocker, abi: LATCH_LP_LOCKER_ABI, functionName: "claimable", args: [account, c.currency] })
          : client.readContract({ address: env.binLocker, abi: LATCH_BIN_LP_LOCKER_ABI, functionName: "claimable", args: [account, c.currency] }),
      ),
    ),
    Promise.all(
      [...taxCurrencies.values()].map((c) =>
        client.readContract({ address: c.hook, abi: LAUNCH_GUARD_HOOK_ABI, functionName: "claimable", args: [account, c.currency] }),
      ),
    ),
    Promise.all(
      taxPools.map((pool) =>
        Promise.all(
          pool.currencies.map((c) =>
            client.readContract({ address: pool.hook, abi: LAUNCH_GUARD_HOOK_ABI, functionName: "pendingTax", args: [pool.poolId, c.currency] }),
          ),
        ),
      ),
    ),
  ]);
  return {
    account,
    kitFeesOwed,
    claimable: [...currencies.values()].map((c, i) => ({ ...c, amount: amounts[i] ?? 0n })),
    locks,
    tax: {
      claimable: [...taxCurrencies.values()].map((c, i) => ({ ...c, amount: taxAmounts[i] ?? 0n })),
      pools: taxPools.map((pool, i) => ({
        guard: pool.guard,
        hook: pool.hook,
        poolId: pool.poolId,
        token: pool.token,
        tokenMeta: pool.tokenMeta,
        role: pool.role,
        bps: pool.bps,
        live: pool.live,
        expiresAt: pool.expiresAt,
        pending: pool.currencies.map((c, j) => ({ currency: c.currency, meta: c.meta, amount: taxPending[i]?.[j] ?? 0n })),
      })),
    },
  };
}
