// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";

import {
  CL_HOOK_FLAGS,
  HOOK_BITMAP_MASK,
  bitmapFromOffsets,
  encodeCLHookPermissions,
} from "../src/hooks/bitmap.js";
import {
  BEFORE_CALLBACK_MASK,
  CURATOR_ROLE,
  DEFAULT_ADMIN_ROLE,
  GUARDIAN_ROLE,
  LATCH_HOOK_REGISTRY_ABI,
  LATCH_HOOK_REGISTRY_EVENTS_ABI,
  LISTING_STATUSES,
  RETURNS_DELTA_MASK,
  RISK_CLASSES,
  SWAP_CUT_MASK,
  VERIFICATION_LEVELS,
  canBlockSwaps,
  canTrapLiquidity,
  classifyRiskClass,
  decodeLatchRecord,
  describeCapabilities,
  formatLatchTrust,
  hookPermissionState,
  isValidHookBitmap,
  listingCaution,
  listingFromUint8,
  listingToUint8,
  permissionsAreAttestable,
  returnsDelta,
  riskClassFromUint8,
  riskClassOf,
  riskClassSeverity,
  riskClassToUint8,
  summarizeLatch,
  takesSwapCut,
  verificationFromUint8,
  verificationRank,
  verificationToUint8,
  type LatchRecord,
  type Listing,
  type RawLatchRecord,
  type RiskClass,
  type Verification,
} from "../src/registry/index.js";

const HOOK = "0x00000000000000000000000000000000000000aa" as const;
const SUBMITTER = "0x00000000000000000000000000000000000000b1" as const;
const CODEHASH = `0x${"11".repeat(32)}` as const;

/** A registered, unverified, active, harmless hook. Override to taste. */
function makeRecord(overrides: Partial<LatchRecord> = {}): LatchRecord {
  return {
    hook: HOOK,
    submitter: SUBMITTER,
    submittedAt: 1_700_000_000n,
    permissions: encodeCLHookPermissions({ afterSwap: true }),
    verification: "Unverified",
    listing: "Active",
    steward: SUBMITTER,
    updatedAt: 1_700_000_000n,
    permissionsValid: true,
    permissionsReadable: true,
    /* Unattested is the default and the interesting one: attestationCount 0
       means the permissions are the hook's own account of itself and nothing
       has confirmed them against a live pool. */
    attestedPermissions: 0,
    codehash: CODEHASH,
    attestedPoolManager: "0x0000000000000000000000000000000000000000",
    attestedAt: 0n,
    attestationCount: 0,
    attestedPoolId: `0x${"00".repeat(32)}` as `0x${string}`,
    metadata: {
      name: "Example",
      description: "",
      sourceURI: "",
      auditURI: "",
      chainIds: [],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The three axes
// ---------------------------------------------------------------------------

describe("enum tables", () => {
  it("matches the Solidity ordering of Verification", () => {
    // Note the middle rung is SourceVerified, not "Verified": the ladder
    // distinguishes "source matches bytecode" from "an audit covers it".
    expect(VERIFICATION_LEVELS).toEqual(["Unverified", "SourceVerified", "Audited"]);
  });

  it("matches the Solidity ordering of Listing", () => {
    expect(LISTING_STATUSES).toEqual(["Active", "Deprecated", "Malicious"]);
  });

  it("matches the Solidity ordering of RiskClass", () => {
    expect(RISK_CLASSES).toEqual(["Passive", "Restrictive", "ValueExtracting"]);
  });

  it("keeps the three axes disjoint, so no label can stand in for another", () => {
    const all = [...VERIFICATION_LEVELS, ...LISTING_STATUSES, ...RISK_CLASSES];
    expect(new Set(all).size).toBe(all.length);
  });

  it("refuses to assign one axis to another at compile time", () => {
    // @ts-expect-error - a Listing is not a Verification
    const wrongVerification: Verification = "Active";
    // @ts-expect-error - a Verification is not a Listing
    const wrongListing: Listing = "Audited";
    // @ts-expect-error - a Listing is not a RiskClass
    const wrongRisk: RiskClass = "Deprecated";
    // The values are still the strings above at runtime; the point is the types.
    expect([wrongVerification, wrongListing, wrongRisk]).toEqual([
      "Active",
      "Audited",
      "Deprecated",
    ]);
  });
});

describe("uint8 conversion", () => {
  it("round-trips every verification level", () => {
    VERIFICATION_LEVELS.forEach((level, index) => {
      expect(verificationToUint8(level)).toBe(index);
      expect(verificationFromUint8(index)).toBe(level);
    });
  });

  it("round-trips every listing status", () => {
    LISTING_STATUSES.forEach((status, index) => {
      expect(listingToUint8(status)).toBe(index);
      expect(listingFromUint8(index)).toBe(status);
    });
  });

  it("round-trips every risk class", () => {
    RISK_CLASSES.forEach((riskClass, index) => {
      expect(riskClassToUint8(riskClass)).toBe(index);
      expect(riskClassFromUint8(index)).toBe(riskClass);
    });
  });

  it("throws on a value the deployed contract could add later", () => {
    expect(() => verificationFromUint8(3)).toThrow(/invalid Verification value 3/);
    expect(() => listingFromUint8(3)).toThrow(/invalid Listing value 3/);
    expect(() => riskClassFromUint8(255)).toThrow(/invalid RiskClass value 255/);
    expect(() => verificationFromUint8(-1)).toThrow(/invalid Verification/);
  });

  it("orders each axis independently", () => {
    expect(verificationRank("Audited")).toBeGreaterThan(verificationRank("SourceVerified"));
    expect(listingCaution("Malicious")).toBeGreaterThan(listingCaution("Active"));
    expect(riskClassSeverity("ValueExtracting")).toBeGreaterThan(riskClassSeverity("Passive"));
  });
});

// ---------------------------------------------------------------------------
// Masks and derivation
// ---------------------------------------------------------------------------

describe("permission masks", () => {
  it("equals the masks declared alongside the registry interface", () => {
    expect(RETURNS_DELTA_MASK).toBe(0x3c00);
    expect(SWAP_CUT_MASK).toBe(0x0c00);
    expect(BEFORE_CALLBACK_MASK).toBe(0x0155);
  });

  it("is built from the shared bit offsets, not a second copy of them", () => {
    expect(RETURNS_DELTA_MASK).toBe(
      bitmapFromOffsets([
        CL_HOOK_FLAGS.beforeSwapReturnsDelta,
        CL_HOOK_FLAGS.afterSwapReturnsDelta,
        CL_HOOK_FLAGS.afterAddLiquidityReturnsDelta,
        CL_HOOK_FLAGS.afterRemoveLiquidityReturnsDelta,
      ]),
    );
    expect(SWAP_CUT_MASK & RETURNS_DELTA_MASK).toBe(SWAP_CUT_MASK);
    expect(BEFORE_CALLBACK_MASK & RETURNS_DELTA_MASK).toBe(0);
  });
});

describe("classifyRiskClass", () => {
  it("classifies a hook with no callbacks as passive", () => {
    expect(classifyRiskClass(0)).toBe("Passive");
  });

  it("classifies observe-only after callbacks as passive", () => {
    const observer = encodeCLHookPermissions({
      afterInitialize: true,
      afterAddLiquidity: true,
      afterRemoveLiquidity: true,
      afterSwap: true,
      afterDonate: true,
    });
    expect(observer).toBe(0x02aa);
    expect(classifyRiskClass(observer)).toBe("Passive");
  });

  it("classifies any before callback as restrictive", () => {
    for (const flag of ["beforeInitialize", "beforeAddLiquidity", "beforeSwap", "beforeDonate"] as const) {
      expect(classifyRiskClass(encodeCLHookPermissions({ [flag]: true }))).toBe("Restrictive");
    }
  });

  it("classifies beforeRemoveLiquidity as value-extracting, not merely restrictive", () => {
    // The boundary that matters: it is a `before*` bit, but it can refuse a
    // withdrawal forever, which ends with a user unable to get their money out.
    const bitmap = encodeCLHookPermissions({ beforeRemoveLiquidity: true });
    expect(bitmap & BEFORE_CALLBACK_MASK).not.toBe(0);
    expect(classifyRiskClass(bitmap)).toBe("ValueExtracting");
  });

  it("classifies every returns-delta bit as value-extracting", () => {
    const cases = [
      { beforeSwap: true, beforeSwapReturnsDelta: true },
      { afterSwap: true, afterSwapReturnsDelta: true },
      { afterAddLiquidity: true, afterAddLiquidityReturnsDelta: true },
      { afterRemoveLiquidity: true, afterRemoveLiquidityReturnsDelta: true },
    ] as const;
    for (const permissions of cases) {
      const bitmap = encodeCLHookPermissions(permissions);
      expect(isValidHookBitmap(bitmap)).toBe(true);
      expect(classifyRiskClass(bitmap)).toBe("ValueExtracting");
    }
  });

  it("holds over every bitmap in the assigned range", () => {
    for (let bitmap = 0; bitmap <= HOOK_BITMAP_MASK; bitmap++) {
      const riskClass = classifyRiskClass(bitmap);
      const extracting = returnsDelta(bitmap) || canTrapLiquidity(bitmap);
      if (extracting) {
        expect(riskClass).toBe("ValueExtracting");
      } else if ((bitmap & BEFORE_CALLBACK_MASK) !== 0) {
        expect(riskClass).toBe("Restrictive");
      } else {
        expect(riskClass).toBe("Passive");
      }
    }
  });

  it("agrees with itself wherever the class is derived", () => {
    for (let bitmap = 0; bitmap <= HOOK_BITMAP_MASK; bitmap += 37) {
      const expected = classifyRiskClass(bitmap);
      expect(describeCapabilities(bitmap).riskClass).toBe(expected);
      expect(riskClassOf(makeRecord({ permissions: bitmap }))).toBe(expected);
      expect(summarizeLatch(makeRecord({ permissions: bitmap })).riskClass).toBe(expected);
    }
  });

  it("rejects a bitmap wider than uint16", () => {
    expect(() => classifyRiskClass(0x1_0000)).toThrow(/must be an integer in/);
    expect(() => classifyRiskClass(-1)).toThrow(/must be an integer in/);
    expect(() => classifyRiskClass(1.5)).toThrow(/must be an integer in/);
  });
});

describe("capability predicates", () => {
  it("mirrors the contract's named views", () => {
    const feeHook = encodeCLHookPermissions({ beforeSwap: true, beforeSwapReturnsDelta: true });
    expect(takesSwapCut(feeHook)).toBe(true);
    expect(returnsDelta(feeHook)).toBe(true);
    expect(canBlockSwaps(feeHook)).toBe(true);
    expect(canTrapLiquidity(feeHook)).toBe(false);

    const lpFeeHook = encodeCLHookPermissions({
      afterAddLiquidity: true,
      afterAddLiquidityReturnsDelta: true,
    });
    expect(takesSwapCut(lpFeeHook)).toBe(false);
    expect(returnsDelta(lpFeeHook)).toBe(true);
  });

  it("reports an invalid bitmap through describeCapabilities", () => {
    const orphan = encodeCLHookPermissions({ afterSwapReturnsDelta: true });
    expect(isValidHookBitmap(orphan)).toBe(false);
    expect(describeCapabilities(orphan).valid).toBe(false);
    // Reserved bits 14-15 are never acceptable.
    expect(isValidHookBitmap(1 << 14)).toBe(false);
  });

  it("expands callbacks under the naming scheme of the requested pool type", () => {
    const bitmap = encodeCLHookPermissions({ beforeAddLiquidity: true });
    expect(describeCapabilities(bitmap).callbacks.beforeAddLiquidity).toBe(true);
    expect(describeCapabilities(bitmap, "BIN").callbacks.beforeMint).toBe(true);
    // Same offsets, so the class does not depend on the pool type.
    expect(describeCapabilities(bitmap, "BIN").riskClass).toBe(classifyRiskClass(bitmap));
  });
});

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

describe("decodeLatchRecord", () => {
  const raw: RawLatchRecord = {
    submitter: SUBMITTER,
    submittedAt: 1_700_000_000n,
    permissions: encodeCLHookPermissions({ beforeSwap: true, beforeSwapReturnsDelta: true }),
    verification: 2,
    listing: 1,
    steward: HOOK,
    attestedPermissions: 0,
    attestedPoolManager: "0x0000000000000000000000000000000000000000",
    attestedAt: 0n,
    attestationCount: 0,
    attestedPoolId: `0x${"00".repeat(32)}` as `0x${string}`,
    updatedAt: 1_700_000_500n,
    permissionsValid: true,
    permissionsReadable: true,
    codehash: CODEHASH,
    metadata: {
      name: "Fee hook",
      description: "takes 30 bps",
      sourceURI: "https://example.invalid/src",
      auditURI: "https://example.invalid/audit.pdf",
      chainIds: [1n, 56n],
    },
  };

  it("turns the uint8 enums into their labels", () => {
    const record = decodeLatchRecord(HOOK, raw);
    expect(record.hook).toBe(HOOK);
    expect(record.verification).toBe("Audited");
    expect(record.listing).toBe("Deprecated");
    expect(record.metadata.chainIds).toEqual([1n, 56n]);
  });

  it("copies chainIds rather than aliasing the decoded array", () => {
    const mutable = [1n, 56n];
    const record = decodeLatchRecord(HOOK, { ...raw, metadata: { ...raw.metadata, chainIds: mutable } });
    mutable.push(137n);
    expect(record.metadata.chainIds).toEqual([1n, 56n]);
  });

  it("throws rather than guessing at an unknown enum value", () => {
    expect(() => decodeLatchRecord(HOOK, { ...raw, verification: 7 })).toThrow(/invalid Verification/);
    expect(() => decodeLatchRecord(HOOK, { ...raw, listing: 9 })).toThrow(/invalid Listing/);
  });

  it("throws on a bitmap that cannot be a uint16", () => {
    expect(() => decodeLatchRecord(HOOK, { ...raw, permissions: 0x1_0000 })).toThrow(
      /must be an integer in/,
    );
  });

  it("carries exactly the fields the compiled getHook tuple declares", () => {
    const abi = LATCH_HOOK_REGISTRY_ABI as readonly {
      type: string;
      name?: string;
      outputs?: readonly { components?: readonly { name: string; components?: readonly { name: string }[] }[] }[];
    }[];
    const getLatch = abi.find((item) => item.type === "function" && item.name === "getLatch");
    const components = getLatch?.outputs?.[0]?.components;
    expect(components).toBeDefined();

    const onChainFields = components!.map((c) => c.name);
    const record = decodeLatchRecord(HOOK, raw);
    // `hook` is the mapping key, so the struct does not repeat it.
    const { hook: _hook, ...stored } = record;
    expect(Object.keys(stored).sort()).toEqual([...onChainFields].sort());

    const metadataFields = components!.find((c) => c.name === "metadata")?.components;
    expect(metadataFields).toBeDefined();
    expect(Object.keys(record.metadata).sort()).toEqual(
      metadataFields!.map((c) => c.name).sort(),
    );
  });
});

describe("hookPermissionState", () => {
  it("reports Fresh when the last refresh read a usable bitmap", () => {
    expect(hookPermissionState(makeRecord())).toBe("Fresh");
  });

  it("reports Stale when the probe could no longer read the hook", () => {
    // The contract sets valid=false alongside readable=false; the actionable
    // fact is that the recorded bitmap is old, so staleness wins.
    const record = makeRecord({ permissionsReadable: false, permissionsValid: false });
    expect(hookPermissionState(record)).toBe("Stale");
  });

  it("reports Invalid when the bitmap was read but no pool could use it", () => {
    const record = makeRecord({
      permissions: encodeCLHookPermissions({ afterSwapReturnsDelta: true }),
      permissionsReadable: true,
      permissionsValid: false,
    });
    expect(hookPermissionState(record)).toBe("Invalid");
    expect(isValidHookBitmap(record.permissions)).toBe(false);
  });

  it("blocks attestation for anything not fresh, or flagged malicious", () => {
    expect(permissionsAreAttestable(makeRecord())).toBe(true);
    expect(permissionsAreAttestable(makeRecord({ permissionsReadable: false }))).toBe(false);
    expect(permissionsAreAttestable(makeRecord({ permissionsValid: false }))).toBe(false);
    expect(permissionsAreAttestable(makeRecord({ listing: "Malicious" }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Trust summary
// ---------------------------------------------------------------------------

describe("summarizeLatch", () => {
  it("earns the badge only when every axis lines up", () => {
    const audited = makeRecord({ verification: "Audited", listing: "Active" });
    expect(summarizeLatch(audited).badgeEarned).toBe(true);
    expect(summarizeLatch(audited).warnings).toEqual([]);

    expect(summarizeLatch(makeRecord({ verification: "Audited", listing: "Deprecated" })).badgeEarned)
      .toBe(false);
    expect(
      summarizeLatch(makeRecord({ verification: "Audited", permissionsReadable: false })).badgeEarned,
    ).toBe(false);
    expect(
      summarizeLatch(makeRecord({ verification: "Audited", permissionsValid: false })).badgeEarned,
    ).toBe(false);
    expect(summarizeLatch(makeRecord({ verification: "SourceVerified" })).badgeEarned).toBe(false);
  });

  it("keeps the audited badge and the value-extraction warning side by side", () => {
    // The case a single trust score gets wrong: a genuinely audited hook that
    // takes a cut of every swap is still a hook that takes a cut of every swap.
    const summary = summarizeLatch(
      makeRecord({
        verification: "Audited",
        permissions: encodeCLHookPermissions({ beforeSwap: true, beforeSwapReturnsDelta: true }),
      }),
    );
    expect(summary.badgeEarned).toBe(true);
    expect(summary.riskClass).toBe("ValueExtracting");
    expect(summary.warnings).toContain("ValueExtracting");
    expect(summary.warnings).toContain("CanBlockSwaps");
  });

  it("puts the malicious flag first", () => {
    const summary = summarizeLatch(makeRecord({ listing: "Malicious" }));
    expect(summary.warnings[0]).toBe("FlaggedMalicious");
    expect(summary.badgeEarned).toBe(false);
  });

  it("warns about a stale bitmap", () => {
    const summary = summarizeLatch(makeRecord({ permissionsReadable: false, permissionsValid: false }));
    expect(summary.permissionState).toBe("Stale");
    expect(summary.warnings).toContain("PermissionsStale");
    expect(summary.warnings).not.toContain("PermissionsInvalid");
  });

  it("warns about an invalid bitmap", () => {
    const summary = summarizeLatch(
      makeRecord({
        permissions: encodeCLHookPermissions({ afterAddLiquidityReturnsDelta: true }),
        permissionsValid: false,
      }),
    );
    expect(summary.permissionState).toBe("Invalid");
    expect(summary.warnings).toContain("PermissionsInvalid");
    expect(summary.capabilities.valid).toBe(false);
  });

  it("warns that a hook can trap liquidity", () => {
    const summary = summarizeLatch(
      makeRecord({ permissions: encodeCLHookPermissions({ beforeRemoveLiquidity: true }) }),
    );
    expect(summary.warnings).toContain("CanTrapLiquidity");
    expect(summary.warnings).toContain("ValueExtracting");
  });

  it("treats unverified as a note, not an accusation", () => {
    expect(summarizeLatch(makeRecord()).warnings).toEqual(["Unverified"]);
  });

  it("formats all three axes on one line", () => {
    const line = formatLatchTrust(summarizeLatch(makeRecord({ verification: "Audited" })));
    expect(line).toContain("verification=Audited");
    expect(line).toContain("listing=Active");
    expect(line).toContain("risk=Passive");
    expect(line).not.toContain("permissions=");

    const stale = formatLatchTrust(summarizeLatch(makeRecord({ permissionsReadable: false })));
    expect(stale).toContain("permissions=Stale");
  });
});

// ---------------------------------------------------------------------------
// Generated ABI
// ---------------------------------------------------------------------------

describe("generated registry ABI", () => {
  const names = (abi: readonly { type: string; name?: string }[], type: string) =>
    abi.filter((item) => item.type === type).map((item) => item.name);

  it("exposes the calls a listing UI makes", () => {
    const functions = names(LATCH_HOOK_REGISTRY_ABI, "function");
    for (const fn of [
      "register",
      "refreshPermissions",
      "updateMetadata",
      "transferSteward",
      "setVerification",
      "setListing",
      "getLatch",
      "listLatches",
      "latchCount",
      "isAudited",
      "riskClassOf",
      "statusOf",
      "classify",
      "hasRole",
    ]) {
      expect(functions).toContain(fn);
    }
  });

  it("carries the registry's errors so a revert can be decoded", () => {
    const errors = names(LATCH_HOOK_REGISTRY_ABI, "error");
    expect(errors).toContain("LatchNotRegistered");
    expect(errors).toContain("PermissionsUnreadable");
    expect(errors).toContain("GuardianCannotRelist");
  });

  it("isolates the six registry events an indexer replays", () => {
    expect(names(LATCH_HOOK_REGISTRY_EVENTS_ABI, "event").sort()).toEqual([
      "LatchListingChanged",
      "LatchMetadataUpdated",
      "LatchPermissionsRefreshed",
      "LatchRegistered",
      "LatchStewardTransferred",
      "LatchVerificationChanged",
    ]);
    // No inherited AccessControl noise in the log-filter constant.
    expect(names(LATCH_HOOK_REGISTRY_EVENTS_ABI, "event")).not.toContain("RoleGranted");
  });

  it("derives the role identifiers", () => {
    expect(DEFAULT_ADMIN_ROLE).toBe(`0x${"00".repeat(32)}`);
    expect(CURATOR_ROLE).toMatch(/^0x[0-9a-f]{64}$/);
    expect(GUARDIAN_ROLE).toMatch(/^0x[0-9a-f]{64}$/);
    expect(CURATOR_ROLE).not.toBe(GUARDIAN_ROLE);
  });
});

// ---------------------------------------------------------------------------
// Effective permissions: the self-report is NOT the answer
// ---------------------------------------------------------------------------

/* `LatchRegistry` v2 was redeployed on 2026-09-12 for exactly one reason: "a hook
   can no longer show the registry one bitmap and core another". The contract
   defends that by classifying the UNION of what the hook claims and what a live
   pool proved:

     _effective(record) = permissions | attestedPermissions   (when attested)
     riskClassOf(hook)  = classify(_effective(record).permissions)

   A record whose self-report is harmless and whose attested bitmap is not is the
   whole point of the mechanism, so the SDK must not classify the self-report
   alone — that reproduces, in TypeScript, the spoof the redeploy removed from the
   chain. Rendering `Passive` over a hook that a live pool proved can take a cut
   of every swap is the single most damaging thing this module can get wrong. */
describe("effective permissions vs the self-report", () => {
  /* Self-report: afterSwap only -> Restrictive is not even reached, it is Passive.
     Attested:    beforeSwap + beforeSwapReturnsDelta -> ValueExtracting.
     The contract answers ValueExtracting. */
  function spoofedRecord(): LatchRecord {
    return makeRecord({
      permissions: encodeCLHookPermissions({ afterSwap: true }),
      attestedPermissions: encodeCLHookPermissions({
        beforeSwap: true,
        beforeSwapReturnsDelta: true,
      }),
      attestationCount: 3,
      attestedPoolManager: "0x00000000000000000000000000000000000000c2",
      attestedAt: 1_700_000_500n,
    });
  }

  it("classifies the union, matching LatchRegistry.riskClassOf", () => {
    const record = spoofedRecord();
    /* Sanity: the two halves really do disagree, so the assertion below is
       testing the union and not a coincidence. */
    expect(classifyRiskClass(record.permissions)).toBe("Passive");
    expect(classifyRiskClass(record.attestedPermissions)).toBe("ValueExtracting");

    expect(riskClassOf(record)).toBe("ValueExtracting");
  });

  it("warns on a spoofed record in summarizeLatch", () => {
    const summary = summarizeLatch(spoofedRecord());
    expect(summary.riskClass).toBe("ValueExtracting");
    expect(summary.warnings).toContain("ValueExtracting");
    expect(summary.capabilities.takesSwapCut).toBe(true);
    expect(summary.capabilities.canBlockSwaps).toBe(true);
  });

  /* The contract returns the bare self-report when nothing has attested, so an
     unattested record must be unchanged by all of this. */
  it("leaves an unattested record classified by its self-report alone", () => {
    const record = makeRecord({
      permissions: encodeCLHookPermissions({ beforeSwap: true }),
      attestedPermissions: 0,
      attestationCount: 0,
    });
    expect(riskClassOf(record)).toBe("Restrictive");
    expect(summarizeLatch(record).riskClass).toBe("Restrictive");
  });

  /* `_effective` ignores attestedPermissions entirely when attestationCount is
     zero, rather than trusting a stale bitmap left behind by an earlier state. */
  it("ignores attestedPermissions when nothing has attested", () => {
    const record = makeRecord({
      permissions: encodeCLHookPermissions({ afterSwap: true }),
      attestedPermissions: encodeCLHookPermissions({
        beforeSwap: true,
        beforeSwapReturnsDelta: true,
      }),
      attestationCount: 0,
    });
    expect(riskClassOf(record)).toBe("Passive");
  });
});
