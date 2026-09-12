// SPDX-License-Identifier: MIT
/**
 * LatchProtocol SDK.
 *
 * Independently authored, MIT-licensed. It is derived from the protocol's
 * compiled ABIs, never from its Solidity sources, so building a hook against
 * this package carries no obligation from the core contracts' GPL licence.
 *
 * @packageDocumentation
 */

// --- core domain types -----------------------------------------------------
export * from "./types/currency.js";
export * from "./types/balanceDelta.js";
export * from "./types/fee.js";
export * from "./types/parameters.js";
export * from "./types/poolKey.js";

// --- hook permissions ------------------------------------------------------
export * from "./hooks/bitmap.js";

// --- events ----------------------------------------------------------------
export * as events from "./events/index.js";
export {
  ALL_EVENT_TOPICS,
  EVENT_DESCRIPTORS,
  EVENT_TOPICS,
  EVENT_COUNT,
  UNIQUE_EVENT_SIGNATURE_COUNT,
  LATCH_PROTOCOL_EVENTS_ABI,
  LATCH_PROTOCOL_EVENT_ABIS,
  decodeProtocolLog,
  descriptorFor,
  descriptorsForTopic,
  isProtocolEventTopic,
} from "./events/index.js";
export type {
  ContractName,
  EventDescriptor,
  LatchProtocolEvent,
  DecodedEventBase,
} from "./events/index.js";

// --- hook registry ---------------------------------------------------------
// The on-chain hook marketplace. Three independent axes - what a curator
// attested (Verification), whether the registry still recommends it (Listing),
// and what the code can do (RiskClass, derived from the bitmap alone).
export * as registry from "./registry/index.js";
export {
  LATCH_HOOK_REGISTRY_ABI,
  LATCH_HOOK_REGISTRY_EVENTS_ABI,
  LISTING_STATUSES,
  PERMISSION_SOURCES,
  RISK_CLASSES,
  VERIFICATION_LEVELS,
  classifyRiskClass,
  decodeLatchRecord,
  describeCapabilities,
  effectivePermissions,
  formatLatchTrust,
  hookPermissionState,
  isValidHookBitmap,
  listingFromUint8,
  listingToUint8,
  permissionSourceFromUint8,
  permissionsAreAttestable,
  riskClassFromUint8,
  riskClassOf,
  riskClassToUint8,
  summarizeLatch,
  verificationFromUint8,
  verificationRank,
  verificationToUint8,
} from "./registry/index.js";
export type {
  EffectivePermissions,
  HookCapabilities,
  LatchMetadata,
  HookPermissionState,
  LatchRecord,
  HookTrustSummary,
  HookWarning,
  Listing,
  PermissionSource,
  RawLatchRecord,
  RiskClass,
  Verification,
} from "./registry/index.js";

// --- launchpad -------------------------------------------------------------
export * as launchpad from "./launchpad/index.js";
export {
  BIN_LAUNCH_GUARD_HOOK_ABI,
  LAUNCHPAD_KIT_ABI,
  LAUNCH_GUARD_HOOK_ABI,
} from "./launchpad/index.js";

// --- indexer model ---------------------------------------------------------
export * as indexer from "./indexer/index.js";

// Chain RPC endpoints and the auto-failover transport.
export * from "./chains/endpoints.js"
export * from "./chains/transport.js"

// --- deployed addresses ----------------------------------------------------
// The address book: every deployed Latch contract, per chain, with token
// decimals. THE single source of truth — `apps/web/src/lib/chain.ts` and the
// `create-latch-dex` template both re-export this rather than restating it.
// `null` means not-yet-deployed and is never the zero address; see the module
// header for why that distinction is load-bearing.
export * as deployments from "./deployments/index.js";
export {
  LATCH_CHAIN_IDS,
  LATCH_DEPLOYMENTS,
  /**
   * Re-exported under a distinct name ON PURPOSE. `types/currency.ts` already
   * exports `NATIVE_CURRENCY` — the zero-address sentinel meaning "this pool leg
   * is the chain's native asset" — and this barrel star-exports that module.
   *
   * An explicit re-export silently WINS over a star export in both TypeScript
   * and ESM: no error, no warning, the star-exported binding just stops existing
   * at the root. Exporting the per-chain table under its own name here meant
   * `NATIVE_CURRENCY` resolved to an object, and `isNativeCurrency(NATIVE_CURRENCY)`
   * threw `toLowerCase is not a function` at the consumer rather than here.
   *
   * The table is unchanged and still `NATIVE_CURRENCY` on the `deployments`
   * namespace and the `./deployments` subpath. Guarded by `test/public-api.test.ts`.
   */
  NATIVE_CURRENCY as CHAIN_NATIVE_CURRENCIES,
  REDEPLOYABLE_CONTRACTS,
  explorerAddressUrl,
  explorerTxUrl,
  getDeployment,
  isLatchChainId,
  requireContract,
  requireDeployment,
  tokenByAddress,
  tokenBySymbol,
} from "./deployments/index.js";
export type {
  ContractKey,
  LatchChainId,
  LatchChainKey,
  LatchDeployment,
  NativeCurrency,
  RedeployableContract,
  ReferencePool,
  TokenInfo,
} from "./deployments/index.js";
