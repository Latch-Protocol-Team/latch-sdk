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

// --- team splits ---------------------------------------------------------
export * as split from "./split/index.js";

// --- lockers, multisend and Merkle airdrops ---------------------------------
// Latch utilities. Each action pays one flat native fee enforced by the
// contract (`LatchFeeGate`); the SDK reads it and sizes msg.value, nothing more.
export * as lock from "./lock/index.js";
export * as trust from "./trust/index.js";
export * as drop from "./drop/index.js";

// --- launchpad -------------------------------------------------------------
export * as launchpad from "./launchpad/index.js";
export {
  BIN_LAUNCH_GUARD_HOOK_ABI,
  LAUNCHPAD_KIT_ABI,
  LAUNCH_GUARD_HOOK_ABI,
  /* The block-numbered kit and hook still deployed on Robinhood. Choose by
     `LatchDeployment.durationClocks`, never by trial decode. */
  LAUNCHPAD_KIT_BLOCK_ABI,
  LAUNCH_GUARD_HOOK_BLOCK_ABI,
} from "./launchpad/index.js";
/* Price, presets and parameter validation. `sqrtPriceForLaunch` is the
   function `LaunchParams.sqrtPriceX96`'s own docstring tells integrators to
   use — it was named by the contract before it existed here, which left the
   one parameter that is PERMANENT at `initialize` to hand-rolled Q64.96
   arithmetic. Shipping it in the first release rather than after somebody
   opens a pool at 10^12 times the intended price. */
export {
  LAUNCH_GUARD_LIMITS,
  MAX_SQRT_RATIO,
  MIN_SQRT_RATIO,
  PRESET,
  PRESET_NAMES,
  PRESET_PARAMS,
  Q96,
  Q192,
  assertLaunchParams,
  bigintSqrt,
  blocksToSeconds,
  buildLaunchParams,
  describeLaunch,
  formatPips,
  humanDuration,
  launchParamsToBlockTuple,
  launchParamsToTuple,
  parseDecimal,
  parsePreset,
  presetName,
  priceFromSqrtPriceX96,
  secondsToBlocks,
  sqrtPriceForLaunch,
  sqrtPriceX96FromPrice,
  sqrtPriceX96FromRatio,
  validateLaunchParams,
  InvalidPriceError,
  PriceOutOfRangeError,
} from "./launchpad/index.js";
export type {
  HookListingParams,
  LatchMetadataInput,
  BlockLaunchLimits,
  LaunchIssue,
  LaunchLimits,
  LaunchParams,
  TimestampLaunchLimits,
  LaunchPrice,
  LaunchPriceInput,
  LaunchSummary,
  PresetName,
  PresetParams,
  PresetValue,
  PriceInput,
  Rational,
  SeedParams,
} from "./launchpad/index.js";
/* LaunchpadKitV2 - NOT DEPLOYED anywhere yet (`LatchDeployment.launchpadV2` is
   all null). Locked CL + Bin launches: predict the token, build the leg keys,
   pick a single-sided CL range the kit accepts, build or pre-validate a Bin
   shape (rules R1-R6), quote the msg.value, and validate the whole call. */
export {
  BIN_ID_ONE,
  BIN_LEG_MAX_INITIAL_FEE_PIPS,
  BIN_SHAPE,
  BIN_SHAPE_NAMES,
  BIN_WEIGHT_PRECISION,
  EMPTY_BIN_LEG,
  EMPTY_CL_LEG,
  KIT_V2_BIN_HOOK_BITMAP,
  KIT_V2_BPS,
  KIT_V2_CL_HOOK_BITMAP,
  KIT_V2_DEPLOY_SCRIPT_CAPS,
  KIT_V2_LEG_FEE,
  KIT_V2_MAX_START_DELAY_SECONDS,
  LAUNCH_TAX_LIMITS,
  NO_TAX,
  DEFAULT_TAX_BOUNDS,
  isNoTax,
  LATCH_BIN_LP_LOCKER_ABI,
  LATCH_LP_LOCKER_ABI,
  LATCH_PAD_ABI,
  LATCH_PAD_FACTORY_ABI,
  LAUNCHPAD_KIT_V2_ABI,
  LAUNCHPAD_KIT_V2_REVERT_ABI,
  LAUNCH_LEGS_ABI,
  LAUNCH_TOKEN_FACTORY_ABI,
  LEG_KIND,
  MAX_BIN_ID,
  MAX_TICK,
  MIN_TICK,
  binActiveIdForLaunch,
  binBase,
  binIdFromRawPrice,
  binLaunchPriceAtId,
  binLegIds,
  binRawPriceFromId,
  buildBinShape,
  checkKitV2CLLeg,
  computeKitV2LegKey,
  computeLaunchValue,
  decodePendingLaunchFee,
  decodeTenantConfig,
  kitV2CLLaunchRange,
  kitV2LaunchSalt,
  kitV2LegSupplies,
  launchTokenIsCurrency0,
  predictLaunchTokenAddress,
  predictLaunchTokenChecked,
  readKitV2Caps,
  readLaunchTokenFactoryInputs,
  readLaunchValue,
  readPredictedLaunchToken,
  readTenantConfig,
  singleSidedLiquidity,
  sqrtRatioAtTick,
  tickAtSqrtRatio,
  validateBinDistribution,
  validateLaunchParamsV2,
  /* A launch token's `metadataURI` (icon + description; the registry listing has
     no icon member). 512-byte ceiling on the token: pin the document, store
     `ipfs://<cid>`; inline only for the minimal case. */
  LAUNCH_MAX_METADATA_URI_BYTES,
  TOKEN_METADATA_MAX_DESCRIPTION,
  TOKEN_METADATA_MAX_NAME,
  TOKEN_METADATA_MAX_SYMBOL,
  buildTokenMetadata,
  decodeTokenMetadataURI,
  encodeInlineTokenMetadataURI,
  pinnedTokenMetadataURI,
  tokenImageUrls,
  tokenMetadataDocument,
  validateTokenMetadata,
  /* Pads: a transferable LaunchpadKitV2 tenant per launchpad operator, with an
     on-chain brand. LatchPadFactory / LatchPad - NOT DEPLOYED anywhere yet. */
  ALL_BIN_SHAPES,
  ALL_PRESETS,
  HOSTNAME_RE,
  padDexScopeOf,
  padHostnameOf,
  padKindOf,
  PAD_BRAND_VERSION,
  PAD_DEX_SCOPES,
  PAD_KINDS,
  PAD_WIDGET_CSS_VARS,
  PAD_WIDGET_VAR_NAMES,
  PAD_WIDGET_VARS,
  PAD_CREATED_EVENT,
  PAD_MAX_DEX_FEE_BPS,
  PAD_MAX_METADATA_URI_BYTES,
  PAD_MAX_TOKEN_LISTS,
  PAD_THEMES,
  PAD_THEME_NAMES,
  binShapeMask,
  decodePadMetadataURI,
  encodeConfigurePad,
  encodeCreatePad,
  encodePadMetadataURI,
  encodeSetPadMetadata,
  presetMask,
  readPad,
  readPadAddresses,
  readPads,
  tenantConfigFromTerms,
  validatePadBrand,
  /* Brand fields for display: https-only logo and website, an X profile or nothing, a monogram fallback. */
  PAD_X_HANDLE_RE,
  normalizePadXInput,
  padLogoSrcOf,
  padMonogramOf,
  padWebsiteOf,
  padXOf,
  /* The site (pad) creation fee: read off the factory, sent as `padSafeValue`
     so a scheduled increase cannot revert a queued create; Safe payloads. */
  buildCreatePad,
  decodePendingPadFee,
  encodeCancelPendingPadFee,
  encodeFlushPadFees,
  encodeSetPadFee,
  padSafeValue,
  readPadFactoryFee,
  /* Multi-chain Launchpads: one pad address on every chain, bound to its creator
     (CREATE2 at keccak256(creator, userSalt) on a CREATE3 factory). */
  padCloneInitCode,
  padCreate2Salt,
  padFactoryOn,
  padUserSaltFromLabel,
  predictPadAddress,
  prepareCreatePad,
  padId,
  readPadIdentity,
  readPadAcrossChains,
  readPadOrigin,
  readPredictPad,
  padDrift,
  padTermsOf,
  buildPadSync,
  buildExtendPad,
  readIntegratorPresence,
  /* Pad slugs: `/p/<slug>` from `name()`; first pad by factory index owns
     the bare slug, later same-name pads carry `-<hex4>` (pads.ts, "THE SLUG RULE"). */
  MULTICALL3_ADDRESS,
  PAD_SLUG_MAX_LENGTH,
  PAD_SLUG_RE,
  assignPadSlugs,
  isPadSlug,
  padBySlug,
  padSlugFor,
  previewPadSlug,
  readPadNames,
  readPadSlugs,
  slugOf,
  /* Kit v2 reads: env, limits, launches, earnings - one implementation for
     the template, the hosted pad sites and the widgets. */
  KitV2ClockError,
  NATIVE_ADDRESS,
  launchPhase,
  readKitV2Earnings,
  readKitV2Env,
  readKitV2Launches,
  readKitV2Limits,
  readTokenMeta,
  /* Kit v2 build: a form draft to `createLaunch` calldata - token predicted
     and cross-checked, prices snapped, tenant terms restated, validated. */
  LAUNCH_TOKEN_DECIMALS,
  buildLaunchParamsV2,
  buildLaunchV2,
  encodeCreateLaunchV2,
  /* The registry listing (`LaunchMetadata`, four strings): the handle rules the
     registry enforces, mirrored so a form fails locally, and the one URL each
     handle renders to. */
  MAX_TELEGRAM_HANDLE_BYTES,
  MAX_X_HANDLE_BYTES,
  assertHandle,
  prepareLaunchListing,
  telegramUrlOf,
  xUrlOf,
  /* A launch's allocation (the unseeded supply): who received it, read from
     the creating transaction's receipt - the kit stores no record of it. */
  launchAllocationFromLogs,
  readLaunchAllocation,
} from "./launchpad/index.js";
export type {
  LaunchListingInput,
  LaunchAllocation,
  BinDistribution,
  BinLaunchPriceInput,
  BinShapeName,
  BinShapeViolation,
  BinLegParamsV2,
  CLLegParamsV2,
  CLLegProblem,
  DecodedTenantConfig,
  KitV2Caps,
  KitV2LegEnv,
  KitV2LegKey,
  LaunchParamsV2,
  LaunchResultV2,
  LaunchV2Issue,
  LaunchV2ValidationContext,
  LaunchValueQuote,
  LegKindName,
  LegParamsV2,
  PendingLaunchFee,
  PredictLaunchTokenArgs,
  ScheduleParamsV2,
  TaxParamsV2,
  TaxBounds,
  TenantConfigV2,
  PadBrand,
  PadDexScope,
  PadKind,
  PadWidgetVar,
  PadBrandIssue,
  PadXProfile,
  PadMetadata,
  PadRecord,
  PadSlugEntry,
  PadTerms,
  PadTheme,
  PadFactoryFee,
  PadOnChain,
  PadOrigin,
  PadDriftField,
  PadSyncTx,
  IntegratorPresence,
  PreparedCreatePad,
  PendingPadFee,
  EarningsV2,
  KitV2Env,
  KitV2Limits,
  LaunchLegV2,
  LaunchPhase,
  LaunchListing,
  LaunchRecordV2,
  LaunchScanV2,
  LegKindWord,
  ReadKitV2LaunchesOptions,
  ReadKitV2LimitsOptions,
  TokenMeta,
  BuildLaunchV2Context,
  BuiltLaunchV2,
  LaunchBuildV2,
  LaunchDraftV2,
  LegDraftV2,
  ResolvedLegV2,
  DecodedTokenMetadata,
  TokenMetadata,
  TokenMetadataIssue,
} from "./launchpad/index.js";

// --- trading: router, quoter, position manager ------------------------------
/* The three contracts a DEX front end calls. The address book named them long
   before the SDK could encode a call to any of them, which left integrators
   pasting interfaces out of a block explorer — a snapshot with no provenance,
   no failure when a signature changes, and a decode that returns a plausible
   number rather than an error. */
export * as trading from "./trading/index.js";

/* Market reads: a pool's swaps, price series, volume and a token's holders,
   from logs and getSlot0 alone. Prices are quote per base token, never USD. */
export {
  buildCandles,
  marketStats,
  priceFromBinId,
  priceFromSqrt,
  readHolders,
  readPoolDirectory,
  readPoolTrades,
  readSpotPrice,
  withTimestamps,
} from "./market/index.js";
export type { Candle, Holder, HolderScan, MarketPool, MarketStats, PoolListing, Trade } from "./market/index.js";
export {
  BIN_POSITION_MANAGER_ABI,
  CL_POSITION_MANAGER_ABI,
  BIN_QUOTER_ABI,
  CL_QUOTER_ABI,
  UNIVERSAL_ROUTER_ABI,
  TradingAbis,
  applySlippage,
  applySlippageToInput,
  quoteBinExactInputSingle,
  quoteExactInputSingle,
  quoterAbiFor,
  quoteExactOutputSingle,
  zeroForOne,
} from "./trading/index.js";
export type { QuoteExactSingleParams } from "./trading/index.js";

// --- indexer model ---------------------------------------------------------
export * as indexer from "./indexer/index.js";

// Chain RPC endpoints and the auto-failover transport.
export * from "./chains/endpoints.js"
export * from "./chains/transport.js"
// The block number CONTRACTS see, which on an Arbitrum Nitro chain is not the
// one `eth_blockNumber` reports. Compare every contract-stored block number
// against `readContractBlockNumber`; keep `getBlockNumber` for log ranges.
export * from "./chains/clock.js"

// --- IPFS icons: parse, resolve through allow-listed gateways, verify ---
// These served the launch listing's `iconURI` until 2026-09-24, when that member
// was removed from `LaunchMetadata` (a fifth string put the kit over EIP-170).
// They stay for any `ipfs://<cid>` icon a token list `logoURI` or a token's own
// `metadataURI` names. `verifyRawCid` is true only for a single-block raw
// sha2-256 CIDv1 of the bytes, which is what `POST /v1/uploads/icon` pins.
export {
  IPFS_CODEC_DAG_PB,
  IPFS_CODEC_RAW,
  IPFS_GATEWAYS,
  IPFS_GATEWAY_ENV,
  MULTIHASH_SHA2_256,
  ipfsGateways,
  ipfsToHttp,
  parseCid,
  parseIpfsUri,
  rawCid,
  verifyRawCid,
} from "./ipfs.js";
export type { ParsedCid, ParsedIpfsUri } from "./ipfs.js";

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
  requireDurationClock,
  requireLaunchpadV2,
  revShareHookRecord,
  tokenByAddress,
  tokenBySymbol,
  /**
   * Safe v1.4.1 contract addresses per chain and the `SafeTx` EIP-712 type —
   * what a signing room needs to hash, sign and execute a governance Safe
   * transaction without app.safe.global. See `deployments/safe.ts`.
   */
  SAFE_CONTRACTS,
  SAFE_CONTRACT_CHAIN_IDS,
  SAFE_TX_TYPES,
  requireSafeContracts,
  safeContractsFor,
} from "./deployments/index.js";
export type {
  ContractKey,
  SafeContracts,
  DurationClock,
  RevShareHookRecord,
  RevSharePendingShape,
  LatchChainId,
  LatchChainKey,
  LatchDeployment,
  LaunchpadV2Deployment,
  NativeCurrency,
  RedeployableContract,
  ReferencePool,
  TokenInfo,
} from "./deployments/index.js";

// --- Safe transactions without the Transaction Service ---------------------
// Hash, encode and verify governance Safe transactions (v1.4.1) from calls:
// Transaction Builder import, MultiSendCallOnly batching, the EIP-712
// safeTxHash, owner-signature recovery and execTransaction packing. Pure:
// nothing here signs or sends. Used by the operator console's signing room on
// both sides of the wire (see docs/safe-signing-room.md).
export {
  DO_NOT_QUEUE,
  MULTISEND_ABI,
  SAFE_ABI,
  ZERO_ADDRESS as SAFE_ZERO_ADDRESS,
  buildSafeTx,
  callsOfSafeTx,
  decodeMultiSendCalls,
  doNotQueueHits,
  encodeExecTransaction,
  encodeGetTransactionHash,
  encodeMultiSendCalls,
  packSignatures,
  parseTransactionBuilderBatch,
  recoverSafeSigner,
  safeTxHash,
  splitSignature,
} from "./safe/index.js";
export type { DoNotQueueHit, DoNotQueueRule, SafeCall, SafeOwnerSignature, SafeTxFields, TransactionBuilderBatch } from "./safe/index.js";

// --- tokenised stocks, per chain: a verified registry, not a claim ---------
// Every record was read from the chain on its `verifiedAt` (name, decimals,
// proxy, implementation, issuer controls, a simulated transfer into an
// arbitrary contract from a real holder). `controls.rebasing` is the flag
// that decides whether a token can be a pool currency at all; see the
// module header and `docs/stocks-by-chain.md`.
export {
  STOCK_TOKENS,
  STOCK_TOKEN_CHAIN_IDS,
  stockTokenByAddress,
  stockTokensFor,
} from "./deployments/stocks.js";
export type { StockProxyKind, StockTokenControls, StockTokenRecord } from "./deployments/stocks.js";

// --- Chainlink price feeds for tokenised equities, per chain ---------------
// GENERATED by `scripts/generate-stock-feeds.mjs` from Chainlink's reference-data
// directory and then READ FROM THE CHAIN, feed by feed, before being written down.
// Never fetched at runtime: a third-party document that decides what our UI calls a
// stock must not be editable between two page loads. A feed address is NOT a token
// address — Chainlink publishes the price and never the ERC-20 — so the join with
// `STOCK_TOKENS` lives in `rwa` below and is honest about where it comes up empty.
export {
  STOCK_FEEDS,
  STOCK_FEED_CHAIN_IDS,
  STOCK_FEED_DIRECTORY_BASE,
  STOCK_FEED_REJECTIONS,
  STOCK_FEED_SURVEY,
  STOCK_FEEDS_VERIFIED_AT,
  STOCK_FEEDS_VERIFIED_INSTANT,
  STOCK_FEEDS_VERIFIED_WEEKDAY,
  stockFeedByAddress,
  stockFeedRejectionsFor,
  stockFeedsFor,
  stockFeedsForTicker,
} from "./deployments/stockFeeds.js";
export type {
  StockFeedAssetClass,
  StockFeedMarketHours,
  StockFeedRecord,
  StockFeedRejection,
  StockFeedSurveyRow,
  StockFeedTickerRule,
} from "./deployments/stockFeeds.js";

// --- real-world-asset wiring: the MIT configuration half of hooks-rwa -------
// Chainlink's market-hours profile -> `MarketHoursModule`'s UTC weekly schedule; a
// verified feed -> `ChainlinkPriceBandAdapter.configureFeed` and
// `MarketHoursModule.configureMarket` arguments, with the refusals those contracts
// make applied here and the two they cannot make (`baseIsCurrency0` from the pool's
// own currency ordering, and a band floor under the feed's deviation threshold).
export * as rwa from "./rwa/index.js";
export {
  bandFloorPpm,
  baseIsCurrency0For,
  chainlinkFeedConfig,
  daylightPhaseFor,
  holidayRecipe,
  isKnownMarketHoursProfile,
  KNOWN_MARKET_HOURS_PROFILES,
  marketSessionFor,
  marketSettingsFor,
  nextSessionChange,
  stockPairCoverage,
  stockPairReadiness,
  ukIsDaylight,
  usEasternIsDaylight,
} from "./rwa/index.js";
export type {
  ChainlinkFeedConfig,
  ChainlinkFeedConfigOptions,
  ChainlinkFeedConfigResult,
  DaylightPhase,
  MarketSession,
  MarketSettingsConfig,
  MarketSettingsOptions,
  MarketSettingsResult,
  StockPairBlocker,
  StockPairCoverage,
  StockPairReadiness,
} from "./rwa/index.js";

// --- token lists (Uniswap Token Lists standard) ----------------------------
// Types, a dependency-free schema validator, a bounded fetch, a runtime list of
// LaunchpadKitV2 launches, a merge with per-token provenance, and the URL the
// Latch lists are published at (a separate public repository, never latch.guru).
export * as tokenlists from "./tokenlists/index.js";
export {
  LATCH_TOKENLIST_DEFAULT_BASE,
  LATCH_TOKENLIST_REPO,
  LATCH_TOKENLIST_URL,
  LAUNCH_TAG,
  LAUNCH_TAG_DEFINITION,
  TOKEN_LIST_LIMITS,
  TOKEN_LIST_MAX_BYTES,
  TokenListFetchError,
  compareTokenListVersions,
  fetchTokenList,
  formatTokenListVersion,
  isTokenList,
  latchExtensionOf,
  latchTokenListFileName,
  latchTokenListUrl,
  launchedTokenList,
  launchedTokenListFromScan,
  mergeTokenLists,
  stockExtensionOf,
  tokenListUpdateKind,
  validateTokenList,
  TOKEN_LIST_STOCK_CONTROL_KEYS,
  ASSUME_ALL_CONTROLS,
  builtinStockChainIds,
  builtinStockTokens,
  describeStockSource,
  mergeStockTokens,
  quotableStockTokens,
  resolveStockTokens,
  resolvedStockByAddress,
} from "./tokenlists/index.js";
export type {
  FetchTokenListOptions,
  FetchedTokenList,
  LaunchedTokenList,
  LaunchedTokenListOptions,
  MergeTokenListsOptions,
  MergedTokenList,
  MergedTokenListToken,
  OmittedLaunch,
  TokenList,
  TokenListExtensionPrimitive,
  TokenListExtensionValue,
  TokenListExtensions,
  TokenListFetchReason,
  TokenListIssue,
  TokenListLatchExtension,
  TokenListSource,
  TokenListStockControls,
  TokenListStockExtension,
  TokenListTagDefinition,
  ResolvedStockToken,
  ResolvedStockTokens,
  ResolveStockTokensOptions,
  StockTokenSource,
  TokenListToken,
  TokenListUpdate,
  TokenListVersion,
} from "./tokenlists/index.js";

// --- RevShareHook pending configuration: three shapes, chosen by address -----
// `getPendingConfig` has a 7-word block shape, an 8-word block shape and an
// 8-word TIMESTAMP shape. The last two are indistinguishable by length, so the
// shape comes from `revShareHookRecord` (or the hook's own `CLOCK_MODE()`).
export {
  CLOCK_MODE_CALLDATA,
  REVSHARE_PENDING_CONFIG_WORDS,
  REVSHARE_SHAPE_CLOCK,
  RevSharePendingConfigShapeError,
  TIMESTAMP_CLOCK_MODE,
  decodeRevSharePendingConfig,
  encodeGetPendingConfig,
  inferRevSharePendingShape,
  revShareProposalStatus,
} from "./revshare/pendingConfig.js";
export type {
  DecodedRevSharePendingConfig,
  RevSharePendingParams,
  RevShareProposalStatus,
} from "./revshare/pendingConfig.js";

// --- native currency / USD, and the market-cap conversion --------------------
// Four tiers with explicit provenance on every answer (Chainlink on chain, Pyth
// on chain, an unimplemented Latch-pool TWAP, then nothing) plus the pure
// integer maths that turns an opening market cap into a price per token and
// back. A chain with no source returns `{ ok: false }` and the caller prices in
// native units — that is a correct answer, and never a zero.
export * as price from "./price/index.js";
export {
  CHAINLINK_AGGREGATOR_ABI,
  DEFAULT_OPENING_MARKET_CAP_USD,
  NATIVE_FEEDS,
  NATIVE_FEEDS_VERIFIED_AT,
  NATIVE_FEED_CHAIN_IDS,
  NATIVE_USD_NO_SOURCE_CHAIN_IDS,
  NATIVE_USD_PYTH_ONLY_CHAIN_IDS,
  NATIVE_USD_TIER1_CHAIN_IDS,
  POOL_TWAP_PREREQUISITES,
  PYTH_ABI,
  STALE_GRACE_SECONDS,
  formatUsdAmount,
  isNativeUsdQuote,
  marketCapFromOpeningPrice,
  nativeFeedFor,
  nativeMarketCapFromOpeningPrice,
  openingPriceFromMarketCap,
  openingPriceFromNativeMarketCap,
  readChainlinkNativeUsd,
  readPythNativeUsd,
  resolveNativeUsd,
  staleAfterSeconds,
  usdWholeDollars,
} from "./price/index.js";
export type {
  ChainlinkNativeFeed,
  NativeFeedRecord,
  NativeUsdAttempt,
  NativeUsdProvenance,
  NativeUsdQuote,
  NativeUsdRate,
  NativeUsdResult,
  NativeUsdTier,
  NativeUsdUnavailable,
  NativeUsdUnavailableReason,
  PythNativeFeed,
  ResolveNativeUsdOptions,
  RoundingMode,
  UsdAmount,
} from "./price/index.js";
