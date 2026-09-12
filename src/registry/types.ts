// SPDX-License-Identifier: MIT
/**
 * The hook registry's on-chain data model.
 *
 * ## What the registry is for
 *
 * LatchProtocol takes hook permissions out of the hook's address (see
 * `../hooks/bitmap.ts`), which is a real advantage for hook authors and a real
 * problem for users: `0xAbCd...` no longer tells you, from the address alone,
 * that the hook behind it holds `beforeSwapReturnsDelta` and takes a cut of
 * every trade in the pool. `LatchRegistry` puts that back on chain, and the
 * types here mirror it so a listing UI never has to invent its own vocabulary.
 *
 * ## Three independent axes, never one score
 *
 * A record carries three separate judgements and they must not be collapsed:
 *
 * | axis                | who decides            | what it answers                          |
 * |---------------------|------------------------|------------------------------------------|
 * | {@link Verification}| a curator              | how much a human has attested            |
 * | {@link Listing}     | a curator or guardian  | does the registry still recommend it     |
 * | {@link RiskClass}   | nobody - it is derived | what the code is *able* to do            |
 *
 * They move independently. A hook can be `Audited` and `Deprecated` (a genuine
 * audit of a superseded version). A hook can be `Unverified` and `Passive`
 * (nobody looked, but the bitmap proves it cannot take value). A hook can be
 * `Audited` and `ValueExtracting` (a fee hook doing exactly what it says).
 * Rendering any of those as a single green tick misinforms the user, so these
 * are modelled as three distinct string-literal unions: `"Active"` is not
 * assignable to a {@link Verification}, and `"Audited"` is not assignable to a
 * {@link Listing}. The compiler refuses the mix-up rather than trusting review
 * to catch it.
 *
 * {@link RiskClass} is derived from the permission bitmap alone. The derivation
 * lives in {@link classifyRiskClass} and nowhere else, and it is built out of
 * the bit offsets in `../hooks/bitmap.ts` rather than re-declaring masks, so a
 * bitmap has exactly one meaning across this SDK, the contract and the UI.
 */

import type { Address, Hex } from "viem";

import {
  CL_HOOK_FLAGS,
  HOOK_BITMAP_MAX,
  bitmapFromOffsets,
  decodeHookPermissions,
  hasHookPermission,
  validateHookRegistrationBitmap,
  type HookPermissions,
  type PoolType,
} from "../hooks/bitmap.js";

// ---------------------------------------------------------------------------
// Axis 1: verification - what a human attested
// ---------------------------------------------------------------------------

/**
 * The verification ladder, in ascending order of attestation.
 *
 * Index position is the `uint8` the contract stores, so this array doubles as
 * the encode/decode table. Order is load-bearing: {@link verificationRank}
 * compares against it.
 */
export const VERIFICATION_LEVELS = ["Unverified", "SourceVerified", "Audited"] as const;

/**
 * How much a curator has attested about a hook.
 *
 * - `Unverified` - the state every hook enters at, and the state it is knocked
 *   back to whenever its metadata or its on-chain code changes. A submitter can
 *   never move themselves up this ladder.
 * - `SourceVerified` - a curator confirmed the published source matches the
 *   deployed bytecode.
 * - `Audited` - a curator confirmed a real audit report covers this exact
 *   deployment.
 */
export type Verification = (typeof VERIFICATION_LEVELS)[number];

// ---------------------------------------------------------------------------
// Axis 2: listing - whether the registry still recommends it
// ---------------------------------------------------------------------------

/**
 * Listing statuses, in ascending order of caution.
 *
 * Index position is the `uint8` the contract stores. The ordering is what lets
 * a guardian move a listing only in the more-cautious direction.
 */
export const LISTING_STATUSES = ["Active", "Deprecated", "Malicious"] as const;

/**
 * Whether the registry still recommends a listing. Independent of
 * {@link Verification}.
 *
 * - `Active` - listed normally.
 * - `Deprecated` - superseded or abandoned. Not an accusation; verification is
 *   deliberately retained, because a genuinely audited old version is not a lie.
 * - `Malicious` - known to harm users. Verification is force-reset to
 *   `Unverified` on chain when this is set, so the two can never disagree.
 */
export type Listing = (typeof LISTING_STATUSES)[number];

// ---------------------------------------------------------------------------
// Axis 3: risk class - what the code can do, derived, never curated
// ---------------------------------------------------------------------------

/**
 * Capability classes, in ascending order of what the hook can do to a user.
 *
 * Index position is the `uint8` the contract's `classify` returns.
 */
export const RISK_CLASSES = ["Passive", "Restrictive", "ValueExtracting"] as const;

/**
 * What a hook's permission bitmap allows, with no human judgement involved.
 *
 * - `Passive` - only `after*` callbacks that cannot return a delta. The hook
 *   observes. (An `after*` revert still blocks the action, but the action has
 *   already been priced, so it degrades to a denial of service on the whole
 *   pool rather than a selective one - still bad, still not value extraction.)
 * - `Restrictive` - holds at least one `before*` callback, so it can refuse a
 *   swap, a deposit or an initialization. Trading exists at its discretion.
 * - `ValueExtracting` - holds a returns-delta bit (can take a cut of swaps or of
 *   liquidity movements) or `beforeRemoveLiquidity` (can permanently refuse
 *   withdrawals). This class can take or trap user funds and should never be
 *   presented without a prominent warning.
 */
export type RiskClass = (typeof RISK_CLASSES)[number];

// ---------------------------------------------------------------------------
// uint8 <-> label
// ---------------------------------------------------------------------------

function fromIndex<T extends string>(
  table: readonly T[],
  value: number,
  label: string,
): T {
  const member = table[value];
  if (member === undefined) {
    throw new Error(
      `invalid ${label} value ${value}; expected an index in [0, ${table.length - 1}] ` +
        `(${table.join(", ")})`,
    );
  }
  return member;
}

function toIndex<T extends string>(table: readonly T[], member: T, label: string): number {
  const index = table.indexOf(member);
  if (index === -1) {
    throw new Error(`invalid ${label} "${member}"; expected one of: ${table.join(", ")}`);
  }
  return index;
}

/** Decodes the `uint8` the contract stores into a {@link Verification}. */
export function verificationFromUint8(value: number): Verification {
  return fromIndex(VERIFICATION_LEVELS, value, "Verification");
}

/** Encodes a {@link Verification} for `setVerification`. */
export function verificationToUint8(level: Verification): number {
  return toIndex(VERIFICATION_LEVELS, level, "Verification");
}

/** Decodes the `uint8` the contract stores into a {@link Listing}. */
export function listingFromUint8(value: number): Listing {
  return fromIndex(LISTING_STATUSES, value, "Listing");
}

/** Encodes a {@link Listing} for `setListing`. */
export function listingToUint8(status: Listing): number {
  return toIndex(LISTING_STATUSES, status, "Listing");
}

/** Decodes the `uint8` returned by `classify` / `riskClassOf`. */
export function riskClassFromUint8(value: number): RiskClass {
  return fromIndex(RISK_CLASSES, value, "RiskClass");
}

/** Encodes a {@link RiskClass} back to its `uint8`. */
export function riskClassToUint8(riskClass: RiskClass): number {
  return toIndex(RISK_CLASSES, riskClass, "RiskClass");
}

/**
 * Position on the verification ladder: higher means more has been attested.
 *
 * Use this for "at least SourceVerified" filters. Never compare it against
 * {@link listingCaution} - they measure different things.
 */
export function verificationRank(level: Verification): number {
  return verificationToUint8(level);
}

/**
 * How cautious a listing status is: higher means the registry is warning harder.
 *
 * This is *not* a trust score. `Deprecated` outranks `Active` in caution while
 * saying nothing at all about whether the hook was audited.
 */
export function listingCaution(status: Listing): number {
  return listingToUint8(status);
}

/** How much a risk class can do to a user: higher is more dangerous. */
export function riskClassSeverity(riskClass: RiskClass): number {
  return riskClassToUint8(riskClass);
}

// ---------------------------------------------------------------------------
// Permission masks
//
// Built from the bit offsets in ../hooks/bitmap.ts rather than re-declared, so
// there is exactly one definition of where each callback lives. CL and bin
// share every offset (only the names of bits 2-5, 12 and 13 differ), so these
// masks apply to a hook of either pool type.
// ---------------------------------------------------------------------------

/** Bits that let a hook return a balance delta, i.e. move value that would
 * otherwise belong to the swapper or the liquidity provider into the hook. */
export const RETURNS_DELTA_MASK = bitmapFromOffsets([
  CL_HOOK_FLAGS.beforeSwapReturnsDelta,
  CL_HOOK_FLAGS.afterSwapReturnsDelta,
  CL_HOOK_FLAGS.afterAddLiquidityReturnsDelta,
  CL_HOOK_FLAGS.afterRemoveLiquidityReturnsDelta,
]);

/** The two bits that let a hook take a cut of every single swap in its pool. */
export const SWAP_CUT_MASK = bitmapFromOffsets([
  CL_HOOK_FLAGS.beforeSwapReturnsDelta,
  CL_HOOK_FLAGS.afterSwapReturnsDelta,
]);

/** `before*` callbacks: these run before the action is applied and may revert,
 * which blocks it. */
export const BEFORE_CALLBACK_MASK = bitmapFromOffsets([
  CL_HOOK_FLAGS.beforeInitialize,
  CL_HOOK_FLAGS.beforeAddLiquidity,
  CL_HOOK_FLAGS.beforeRemoveLiquidity,
  CL_HOOK_FLAGS.beforeSwap,
  CL_HOOK_FLAGS.beforeDonate,
]);

function assertBitmap(permissions: number): void {
  if (!Number.isInteger(permissions) || permissions < 0 || permissions > HOOK_BITMAP_MAX) {
    throw new Error(
      `hook permissions must be an integer in [0, ${HOOK_BITMAP_MAX}], received: ${permissions}`,
    );
  }
}

/**
 * Capability class of a permission bitmap.
 *
 * The single definition of the bitmap -> {@link RiskClass} relationship in this
 * SDK. It mirrors `LatchRegistry.classify`, which is `pure` and callable on
 * chain if you would rather have the contract's own answer.
 *
 * Classification is pool-type independent because both pool types use the same
 * bit offsets.
 *
 * @throws if `permissions` is not a `uint16`.
 */
export function classifyRiskClass(permissions: number): RiskClass {
  assertBitmap(permissions);
  // Can take value out of a swap or a liquidity movement, or can refuse a
  // withdrawal forever. Both end with a user unable to get their money back out.
  if (
    (permissions & RETURNS_DELTA_MASK) !== 0 ||
    hasHookPermission(permissions, CL_HOOK_FLAGS.beforeRemoveLiquidity)
  ) {
    return "ValueExtracting";
  }
  if ((permissions & BEFORE_CALLBACK_MASK) !== 0) return "Restrictive";
  return "Passive";
}

/** True if the hook can take a cut of every swap in its pool (bits 10 or 11). */
export function takesSwapCut(permissions: number): boolean {
  assertBitmap(permissions);
  return (permissions & SWAP_CUT_MASK) !== 0;
}

/** True if the hook can take a cut of any swap or liquidity movement (bits 10-13). */
export function returnsDelta(permissions: number): boolean {
  assertBitmap(permissions);
  return (permissions & RETURNS_DELTA_MASK) !== 0;
}

/** True if the hook can block trading in its pool outright (bit 6). */
export function canBlockSwaps(permissions: number): boolean {
  assertBitmap(permissions);
  return hasHookPermission(permissions, CL_HOOK_FLAGS.beforeSwap);
}

/** True if the hook can refuse liquidity withdrawals and strand LP funds (bit 4). */
export function canTrapLiquidity(permissions: number): boolean {
  assertBitmap(permissions);
  return hasHookPermission(permissions, CL_HOOK_FLAGS.beforeRemoveLiquidity);
}

/**
 * True when a bitmap is one the pool managers would accept: no reserved bits,
 * every returns-delta bit backed by its base callback.
 *
 * Mirrors `LatchRegistry.isValidBitmap`, and shares its implementation with
 * pool-key validation via `validateHookRegistrationBitmap`.
 */
export function isValidHookBitmap(permissions: number, poolType: PoolType = "CL"): boolean {
  return validateHookRegistrationBitmap(poolType, permissions).valid;
}

/** Everything derivable from a permission bitmap, in one object. */
export interface HookCapabilities<T extends PoolType = "CL"> {
  /** The raw `uint16` the registry recorded. */
  readonly bitmap: number;
  /** Which naming scheme `callbacks` uses. Offsets are identical either way. */
  readonly poolType: T;
  /** Derived class. Never curated, never overridable. */
  readonly riskClass: RiskClass;
  /** The bitmap expanded into named booleans. */
  readonly callbacks: HookPermissions<T>;
  /** Can take a cut of every swap. */
  readonly takesSwapCut: boolean;
  /** Can take a cut of a swap or a liquidity movement. */
  readonly returnsDelta: boolean;
  /** Can refuse a swap. */
  readonly canBlockSwaps: boolean;
  /** Can refuse a withdrawal and strand LP funds. */
  readonly canTrapLiquidity: boolean;
  /** False when the pool managers would reject this bitmap outright. */
  readonly valid: boolean;
}

/** Expands a bitmap into {@link HookCapabilities}. */
export function describeCapabilities<T extends PoolType = "CL">(
  permissions: number,
  poolType: T = "CL" as T,
): HookCapabilities<T> {
  assertBitmap(permissions);
  return {
    bitmap: permissions,
    poolType,
    riskClass: classifyRiskClass(permissions),
    callbacks: decodeHookPermissions(poolType, permissions),
    takesSwapCut: takesSwapCut(permissions),
    returnsDelta: returnsDelta(permissions),
    canBlockSwaps: canBlockSwaps(permissions),
    canTrapLiquidity: canTrapLiquidity(permissions),
    valid: isValidHookBitmap(permissions, poolType),
  };
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/**
 * Human-supplied listing data. Never trusted for capability claims: the
 * registry reads permissions off the hook itself and there is no parameter
 * through which a submitter can influence them.
 */
export interface LatchMetadata {
  readonly name: string;
  readonly description: string;
  /** Source repository / verification URI. Required before `SourceVerified`. */
  readonly sourceURI: string;
  /** Audit report URI. Required before `Audited`. */
  readonly auditURI: string;
  /** Chain ids the submitter claims this hook is deployed on. Informational. */
  readonly chainIds: readonly bigint[];
}

/** The full registry record for one hook address. */
export interface LatchRecord {
  /** The hook this record describes. Not stored on chain (it is the mapping
   * key), so it is filled in by {@link decodeLatchRecord} from the address you
   * queried. */
  readonly hook: Address;
  /** Who called `register`. Immutable, historical. */
  readonly submitter: Address;
  /** Unix seconds. */
  readonly submittedAt: bigint;
  /** Read from `getHooksRegistrationBitmap()` on the hook, never submitted. */
  readonly permissions: number;
  readonly verification: Verification;
  readonly listing: Listing;
  /** Who may currently edit the metadata. Transferable. */
  readonly steward: Address;
  /** Unix seconds. */
  readonly updatedAt: bigint;
  /** False if a refresh saw reserved bits or an unmet returns-delta dependency. */
  readonly permissionsValid: boolean;
  /** False if a refresh could no longer read the bitmap at all. `permissions`
   * then holds the last value successfully read and must be treated as stale. */
  readonly permissionsReadable: boolean;
  /**
   * The union of every bitmap this hook has been observed ENFORCING in a live
   * pool, taken from that pool's immutable `parameters`.
   *
   * This is the field that makes `permissions` safe to read. `permissions` is
   * self-reported — the hook's own account of itself, delivered to a caller it
   * can identify — and `getHooksRegistrationBitmap()` is a `view` function, so
   * a hook can answer the registry one way and core another. An attestation is
   * taken from a pool core already validated, which the hook cannot forge.
   *
   * Monotone: attestations only ever ADD bits and no role can clear them, so
   * no ordering of calls can make a record look milder. Zero and meaningless
   * until `attestationCount > 0`.
   */
  readonly attestedPermissions: number;
  /** `hook.codehash` when permissions were last read. */
  readonly codehash: Hex;
  /** The pool manager that vouched for `attestedPoolId`. Zero if unattested. */
  readonly attestedPoolManager: Address;
  /** Unix seconds of the most recent attestation. Zero if unattested. */
  readonly attestedAt: bigint;
  /** How many live pools have vouched. Zero means the record is self-reported
   * only, which a UI must say out loud rather than imply. */
  readonly attestationCount: number;
  /** The pool that provided the most recent attestation. */
  readonly attestedPoolId: Hex;
  readonly metadata: LatchMetadata;
}

/** The shape viem decodes `getLatch` into: enums still as `uint8`. */
export interface RawLatchRecord {
  readonly submitter: Address;
  readonly submittedAt: bigint;
  readonly permissions: number;
  readonly verification: number;
  readonly listing: number;
  readonly steward: Address;
  readonly updatedAt: bigint;
  readonly permissionsValid: boolean;
  readonly permissionsReadable: boolean;
  readonly attestedPermissions: number;
  readonly codehash: Hex;
  readonly attestedPoolManager: Address;
  readonly attestedAt: bigint;
  readonly attestationCount: number;
  readonly attestedPoolId: Hex;
  readonly metadata: {
    readonly name: string;
    readonly description: string;
    readonly sourceURI: string;
    readonly auditURI: string;
    readonly chainIds: readonly bigint[];
  };
}

/**
 * Turns a decoded `getLatch` tuple into a {@link LatchRecord}.
 *
 * @param hook the address you queried; it is the mapping key, so the contract
 * does not repeat it inside the struct.
 * @throws if an enum field holds a value this SDK does not know, which means the
 * deployed contract is newer than this package - better to fail than to render
 * an unknown status as the safest-looking one.
 */
export function decodeLatchRecord(hook: Address, raw: RawLatchRecord): LatchRecord {
  assertBitmap(raw.permissions);
  return {
    hook,
    submitter: raw.submitter,
    submittedAt: raw.submittedAt,
    permissions: raw.permissions,
    verification: verificationFromUint8(raw.verification),
    listing: listingFromUint8(raw.listing),
    steward: raw.steward,
    updatedAt: raw.updatedAt,
    permissionsValid: raw.permissionsValid,
    permissionsReadable: raw.permissionsReadable,
    /* Not validated with assertBitmap. `permissions` is bounded because the
       registry re-reads it and rejects reserved bits; attestedPermissions is a
       union of bitmaps core itself accepted at pool initialization, so a value
       this SDK considers malformed would mean core accepted it — worth
       surfacing rather than throwing on. */
    attestedPermissions: raw.attestedPermissions,
    codehash: raw.codehash,
    attestedPoolManager: raw.attestedPoolManager,
    attestedAt: raw.attestedAt,
    attestationCount: raw.attestationCount,
    attestedPoolId: raw.attestedPoolId,
    metadata: {
      name: raw.metadata.name,
      description: raw.metadata.description,
      sourceURI: raw.metadata.sourceURI,
      auditURI: raw.metadata.auditURI,
      chainIds: [...raw.metadata.chainIds],
    },
  };
}

// ---------------------------------------------------------------------------
// Freshness of the recorded bitmap
// ---------------------------------------------------------------------------

/** How much the recorded `permissions` value can be relied on. */
export type HookPermissionState =
  /** Last refresh read the bitmap and the pool managers would accept it. */
  | "Fresh"
  /** Last refresh could not read the bitmap. `permissions` is the last value
   * that was successfully read and may no longer be true. */
  | "Stale"
  /** The bitmap was read but declares reserved bits or an unmet dependency, so
   * no pool can ever use this hook and no curator may attest to it. */
  | "Invalid";

/**
 * Classifies the freshness of `record.permissions`.
 *
 * Unreadable is reported before invalid: when a probe fails the contract sets
 * `permissionsValid` false as well, but the actionable fact is that nobody
 * currently knows what the hook's bitmap is.
 */
export function hookPermissionState(
  record: Pick<LatchRecord, "permissionsReadable" | "permissionsValid">,
): HookPermissionState {
  if (!record.permissionsReadable) return "Stale";
  if (!record.permissionsValid) return "Invalid";
  return "Fresh";
}

// ---------------------------------------------------------------------------
// Effective permissions
// ---------------------------------------------------------------------------

/**
 * Where an effective bitmap came from. Mirrors the contract's `PermissionSource`
 * enum, in its declaration order.
 *
 * This is the one enum whose zero value is also the most reassuring-looking, so
 * it is the one most worth naming: `SelfReported` means nothing corroborates the
 * bitmap, which a UI must say out loud rather than imply.
 */
export const PERMISSION_SOURCES = [
  /** No live pool has attested. The bitmap is the hook's own account of itself. */
  "SelfReported",
  /** A live pool corroborates the self-report and adds nothing to it. */
  "PoolAttested",
  /** A live pool proved bits the hook did NOT self-report. Read that as a lie. */
  "PoolAttestedDivergent",
] as const;

/** Provenance of an effective permission bitmap. */
export type PermissionSource = (typeof PERMISSION_SOURCES)[number];

/**
 * Decodes the contract's `uint8` `PermissionSource`.
 *
 * @throws on an unknown value, for the same reason the other three axes do: a
 * newer contract must fail loudly rather than be rendered as its safest member.
 */
export function permissionSourceFromUint8(value: number): PermissionSource {
  const source = PERMISSION_SOURCES[value];
  if (source === undefined) {
    throw new Error(`invalid PermissionSource: ${value}`);
  }
  return source;
}

/** An effective bitmap and where it came from. Neither is safe to show alone. */
export interface EffectivePermissions {
  /** `permissions | attestedPermissions`, or the self-report when unattested. */
  readonly permissions: number;
  readonly source: PermissionSource;
}

/**
 * The bitmap a consumer should act on, and its provenance.
 *
 * Mirrors `LatchRegistry.effectivePermissions` / `_effective`: the UNION of what
 * the hook says about itself and what a live pool proved, never a choice between
 * them, because each can be true of a different pool and only UNDERSTATING can
 * hurt anybody.
 *
 * This is the whole point of the v2 registry. A hook can present the registry one
 * bitmap and core another; classifying the self-report alone reproduces that
 * spoof in TypeScript and renders `Passive` over a hook a live pool proved can
 * take a cut of every swap.
 */
export function effectivePermissions(
  record: Pick<LatchRecord, "permissions" | "attestedPermissions" | "attestationCount">,
): EffectivePermissions {
  /* attestationCount 0 means nothing has attested, so attestedPermissions is
     ignored outright rather than trusted as a leftover from an earlier state —
     the contract makes the same choice, and for the same reason. */
  if (record.attestationCount === 0) {
    return { permissions: record.permissions, source: "SelfReported" };
  }
  const attested = record.attestedPermissions;
  return {
    permissions: record.permissions | attested,
    source: (attested & ~record.permissions) !== 0 ? "PoolAttestedDivergent" : "PoolAttested",
  };
}

/**
 * Derived {@link RiskClass} of a record's EFFECTIVE bitmap.
 *
 * Mirrors `LatchRegistry.riskClassOf`, and like it is never milder than either
 * source alone. Pair it with {@link effectivePermissions}' `source` wherever a
 * badge or class label is rendered: `Passive` on a self-report and `Passive` on
 * an attested record are very different statements.
 */
export function riskClassOf(
  record: Pick<LatchRecord, "permissions" | "attestedPermissions" | "attestationCount">,
): RiskClass {
  return classifyRiskClass(effectivePermissions(record).permissions);
}

/**
 * Whether a curator may raise this record's verification.
 *
 * Mirrors the contract's guard: you cannot attest to what you cannot read, and
 * nothing is promoted while flagged malicious.
 */
export function permissionsAreAttestable(
  record: Pick<LatchRecord, "permissionsReadable" | "permissionsValid" | "listing">,
): boolean {
  return (
    record.listing !== "Malicious" &&
    record.permissionsReadable &&
    record.permissionsValid
  );
}

// ---------------------------------------------------------------------------
// Trust summary
// ---------------------------------------------------------------------------

/** A reason to show the user a warning, most severe first when produced by
 * {@link summarizeLatch}. */
export type HookWarning =
  /** The registry says this hook harms users. */
  | "FlaggedMalicious"
  /** Can take a cut of swaps or liquidity, or refuse withdrawals. */
  | "ValueExtracting"
  /** Can specifically refuse liquidity withdrawals and strand LP funds. */
  | "CanTrapLiquidity"
  /** Can refuse trades. */
  | "CanBlockSwaps"
  /**
   * A live pool proved permissions the hook did NOT report to the registry.
   * The self-report understated what the code can do — treat the difference as
   * deliberate until the steward explains it.
   */
  | "PermissionsDivergent"
  /** Nobody currently knows the hook's real bitmap; the recorded one is old. */
  | "PermissionsStale"
  /** The recorded bitmap is one no pool can use. */
  | "PermissionsInvalid"
  /** Superseded or abandoned. */
  | "Deprecated"
  /** No curator has attested anything. Not an accusation - the default. */
  | "Unverified";

/**
 * The three axes side by side, plus the derived warnings.
 *
 * Deliberately does not produce a single score. There is no honest way to
 * collapse "a human vouched for this" and "the code cannot take your money"
 * into one number, and a UI that tries will eventually show a green tick next
 * to a hook that drains the pool.
 */
export interface HookTrustSummary {
  readonly hook: Address;
  /** What a curator attested. */
  readonly verification: Verification;
  /** Whether the registry still recommends it. */
  readonly listing: Listing;
  /**
   * What the code can do. Derived from the EFFECTIVE bitmap, not curated.
   *
   * Never render this without {@link HookTrustSummary.permissionSource}. The
   * contract is explicit about it: `Passive` on a self-reported record and
   * `Passive` on an attested one are two very different statements.
   */
  readonly riskClass: RiskClass;
  /** Whether any live pool corroborates the bitmap `riskClass` was derived from. */
  readonly permissionSource: PermissionSource;
  /** How many live pools have vouched. Zero means self-reported only. */
  readonly attestationCount: number;
  /** How far the recorded bitmap can be trusted. */
  readonly permissionState: HookPermissionState;
  /**
   * True only when every axis lines up: audited, active, and permissions both
   * readable and valid. Mirrors `LatchRegistry.isAudited`, which is the
   * single question a front end should ask before showing a trust badge.
   *
   * Note what it does *not* say: an audited hook may still be
   * `ValueExtracting`. Show the badge and the risk class together.
   */
  readonly badgeEarned: boolean;
  /** Ordered most severe first. Empty for an unverified but harmless listing
   * only if it is also `Active` - see {@link HookWarning}. */
  readonly warnings: readonly HookWarning[];
  /** Full capability breakdown of the recorded bitmap. */
  readonly capabilities: HookCapabilities;
}

/** Builds a {@link HookTrustSummary} from a record. */
export function summarizeLatch(record: LatchRecord): HookTrustSummary {
  /* The EFFECTIVE bitmap, not the self-report. See `effectivePermissions`: a
     hook that tells the registry it is harmless while a live pool proves it
     takes a cut of every swap is the exact case the v2 registry exists for, and
     summarising the self-report alone would render it `Passive`. */
  const effective = effectivePermissions(record);
  const capabilities = describeCapabilities(effective.permissions);
  const permissionState = hookPermissionState(record);

  const warnings: HookWarning[] = [];
  if (record.listing === "Malicious") warnings.push("FlaggedMalicious");
  if (capabilities.riskClass === "ValueExtracting") warnings.push("ValueExtracting");
  if (capabilities.canTrapLiquidity) warnings.push("CanTrapLiquidity");
  if (capabilities.canBlockSwaps) warnings.push("CanBlockSwaps");
  if (effective.source === "PoolAttestedDivergent") warnings.push("PermissionsDivergent");
  if (permissionState === "Stale") warnings.push("PermissionsStale");
  if (permissionState === "Invalid") warnings.push("PermissionsInvalid");
  if (record.listing === "Deprecated") warnings.push("Deprecated");
  if (record.verification === "Unverified") warnings.push("Unverified");

  return {
    hook: record.hook,
    verification: record.verification,
    listing: record.listing,
    riskClass: capabilities.riskClass,
    permissionSource: effective.source,
    attestationCount: record.attestationCount,
    permissionState,
    badgeEarned:
      record.verification === "Audited" &&
      record.listing === "Active" &&
      record.permissionsReadable &&
      record.permissionsValid,
    warnings,
    capabilities,
  };
}

/**
 * One-line summary for logs and CLI output.
 *
 * Always prints all three axes, in that order, so a grep never sees one axis
 * standing in for another.
 */
export function formatLatchTrust(summary: HookTrustSummary): string {
  const state = summary.permissionState === "Fresh" ? "" : ` permissions=${summary.permissionState}`;
  return (
    `${summary.hook} verification=${summary.verification} ` +
    `listing=${summary.listing} risk=${summary.riskClass}${state}`
  );
}
