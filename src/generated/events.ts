// SPDX-License-Identifier: MIT
// -----------------------------------------------------------------------------
// GENERATED FILE - DO NOT EDIT BY HAND.
// Produced by scripts/generate-events.mjs from the compiled contract ABIs.
// Re-run `npm run generate` after the contracts are rebuilt.
// -----------------------------------------------------------------------------

import type { Address, Hex } from "viem";

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------

/**
 * Decoded arguments of `Vault.AppRegistered`.
 *
 * Signature: `AppRegistered(address)`
 * topic0: `0x0d540ad8f39e07d19909687352b9fa017405d93c91a6760981fbae9cf28bfef7`
 */
export interface VaultAppRegisteredArgs {
  /** `address` (indexed) */
  readonly app: Address;
}

/**
 * Decoded arguments of `Vault.Approval`.
 *
 * Signature: `Approval(address,address,address,uint256)`
 * topic0: `0xa0175360a15bca328baf7ea85c7b784d58b222a50d0ce760b10dba336d226a61`
 */
export interface VaultApprovalArgs {
  /** `address` (indexed) */
  readonly owner: Address;
  /** `address` (indexed) */
  readonly spender: Address;
  /** `address` (indexed) */
  readonly currency: Address;
  /** `uint256` */
  readonly amount: bigint;
}

/**
 * Decoded arguments of `Vault.OperatorSet`.
 *
 * Signature: `OperatorSet(address,address,bool)`
 * topic0: `0xceb576d9f15e4e200fdb5096d64d5dfd667e16def20c1eefd14256d8e3faa267`
 */
export interface VaultOperatorSetArgs {
  /** `address` (indexed) */
  readonly owner: Address;
  /** `address` (indexed) */
  readonly operator: Address;
  /** `bool` */
  readonly approved: boolean;
}

/**
 * Decoded arguments of `Vault.OwnershipTransferred`.
 *
 * Signature: `OwnershipTransferred(address,address)`
 * topic0: `0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0`
 */
export interface VaultOwnershipTransferredArgs {
  /** `address` (indexed) */
  readonly previousOwner: Address;
  /** `address` (indexed) */
  readonly newOwner: Address;
}

/**
 * Decoded arguments of `Vault.OwnershipTransferStarted`.
 *
 * Signature: `OwnershipTransferStarted(address,address)`
 * topic0: `0x38d16b8cac22d99fc7c124b9cd0de2d3fa1faef420bfe791d8c362d765e22700`
 */
export interface VaultOwnershipTransferStartedArgs {
  /** `address` (indexed) */
  readonly previousOwner: Address;
  /** `address` (indexed) */
  readonly newOwner: Address;
}

/**
 * Decoded arguments of `Vault.Transfer`.
 *
 * Signature: `Transfer(address,address,address,address,uint256)`
 * topic0: `0x5b21a3c624a398df3917a0a930f91e3837519b8eab3302b834746433065f2959`
 */
export interface VaultTransferArgs {
  /** `address` */
  readonly caller: Address;
  /** `address` (indexed) */
  readonly from: Address;
  /** `address` (indexed) */
  readonly to: Address;
  /** `address` (indexed) */
  readonly currency: Address;
  /** `uint256` */
  readonly amount: bigint;
}

// ---------------------------------------------------------------------------
// CLPoolManager
// ---------------------------------------------------------------------------

/**
 * Decoded arguments of `CLPoolManager.Donate`.
 *
 * Signature: `Donate(bytes32,address,uint256,uint256,int24)`
 * topic0: `0xbe708911656ae186ac3fc26a794e5f1319609ce340a14c63524f985fee4bc841`
 */
export interface CLPoolManagerDonateArgs {
  /** `bytes32` (indexed) */
  readonly id: Hex;
  /** `address` (indexed) */
  readonly sender: Address;
  /** `uint256` */
  readonly amount0: bigint;
  /** `uint256` */
  readonly amount1: bigint;
  /** `int24` */
  readonly tick: number;
}

/**
 * Decoded arguments of `CLPoolManager.DynamicLPFeeUpdated`.
 *
 * Signature: `DynamicLPFeeUpdated(bytes32,uint24)`
 * topic0: `0x14b2b80e0d62303dc85494859f35a84579160aafbd650180ddf526b1ab547bd6`
 */
export interface CLPoolManagerDynamicLPFeeUpdatedArgs {
  /** `bytes32` (indexed) */
  readonly id: Hex;
  /** `uint24` */
  readonly dynamicLPFee: number;
}

/**
 * Decoded arguments of `CLPoolManager.Initialize`.
 *
 * Signature: `Initialize(bytes32,address,address,address,uint24,bytes32,uint160,int24)`
 * topic0: `0x426cc62fe6a33a40ba2788c2c87a9c34ee4582b95bc9fa5a7bb7ae70b750b99c`
 */
export interface CLPoolManagerInitializeArgs {
  /** `bytes32` (indexed) */
  readonly id: Hex;
  /** `address` (indexed) */
  readonly currency0: Address;
  /** `address` (indexed) */
  readonly currency1: Address;
  /** `address` */
  readonly hooks: Address;
  /** `uint24` */
  readonly fee: number;
  /** `bytes32` */
  readonly parameters: Hex;
  /** `uint160` */
  readonly sqrtPriceX96: bigint;
  /** `int24` */
  readonly tick: number;
}

/**
 * Decoded arguments of `CLPoolManager.ModifyLiquidity`.
 *
 * Signature: `ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)`
 * topic0: `0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec`
 */
export interface CLPoolManagerModifyLiquidityArgs {
  /** `bytes32` (indexed) */
  readonly id: Hex;
  /** `address` (indexed) */
  readonly sender: Address;
  /** `int24` */
  readonly tickLower: number;
  /** `int24` */
  readonly tickUpper: number;
  /** `int256` */
  readonly liquidityDelta: bigint;
  /** `bytes32` */
  readonly salt: Hex;
}

/**
 * Decoded arguments of `CLPoolManager.OwnershipTransferred`.
 *
 * Signature: `OwnershipTransferred(address,address)`
 * topic0: `0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0`
 */
export interface CLPoolManagerOwnershipTransferredArgs {
  /** `address` (indexed) */
  readonly previousOwner: Address;
  /** `address` (indexed) */
  readonly newOwner: Address;
}

/**
 * Decoded arguments of `CLPoolManager.Paused`.
 *
 * Signature: `Paused(address)`
 * topic0: `0x62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258`
 */
export interface CLPoolManagerPausedArgs {
  /** `address` */
  readonly account: Address;
}

/**
 * Decoded arguments of `CLPoolManager.ProtocolFeeControllerUpdated`.
 *
 * Signature: `ProtocolFeeControllerUpdated(address)`
 * topic0: `0xb4bd8ef53df690b9943d3318996006dbb82a25f54719d8c8035b516a2a5b8acc`
 */
export interface CLPoolManagerProtocolFeeControllerUpdatedArgs {
  /** `address` (indexed) */
  readonly protocolFeeController: Address;
}

/**
 * Decoded arguments of `CLPoolManager.ProtocolFeeUpdated`.
 *
 * Signature: `ProtocolFeeUpdated(bytes32,uint24)`
 * topic0: `0xe9c42593e71f84403b84352cd168d693e2c9fcd1fdbcc3feb21d92b43e6696f9`
 */
export interface CLPoolManagerProtocolFeeUpdatedArgs {
  /** `bytes32` (indexed) */
  readonly id: Hex;
  /** `uint24` */
  readonly protocolFee: number;
}

/**
 * Decoded arguments of `CLPoolManager.Swap`.
 *
 * Signature: `Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24,uint16)`
 * topic0: `0x04206ad2b7c0f463bff3dd4f33c5735b0f2957a351e4f79763a4fa9e775dd237`
 */
export interface CLPoolManagerSwapArgs {
  /** `bytes32` (indexed) */
  readonly id: Hex;
  /** `address` (indexed) */
  readonly sender: Address;
  /** `int128` */
  readonly amount0: bigint;
  /** `int128` */
  readonly amount1: bigint;
  /** `uint160` */
  readonly sqrtPriceX96: bigint;
  /** `uint128` */
  readonly liquidity: bigint;
  /** `int24` */
  readonly tick: number;
  /** `uint24` */
  readonly fee: number;
  /** `uint16` */
  readonly protocolFee: number;
}

/**
 * Decoded arguments of `CLPoolManager.Unpaused`.
 *
 * Signature: `Unpaused(address)`
 * topic0: `0x5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa`
 */
export interface CLPoolManagerUnpausedArgs {
  /** `address` */
  readonly account: Address;
}

// ---------------------------------------------------------------------------
// BinPoolManager
// ---------------------------------------------------------------------------

/**
 * Decoded arguments of `BinPoolManager.Burn`.
 *
 * Signature: `Burn(bytes32,address,uint256[],bytes32,bytes32[])`
 * topic0: `0x16d40aa4e497175b58e47cbf101544758de8c01d92a760c738943044c758df8a`
 */
export interface BinPoolManagerBurnArgs {
  /** `bytes32` (indexed) */
  readonly id: Hex;
  /** `address` (indexed) */
  readonly sender: Address;
  /** `uint256[]` */
  readonly ids: readonly (bigint)[];
  /** `bytes32` */
  readonly salt: Hex;
  /** `bytes32[]` */
  readonly amounts: readonly (Hex)[];
}

/**
 * Decoded arguments of `BinPoolManager.Donate`.
 *
 * Signature: `Donate(bytes32,address,int128,int128,uint24)`
 * topic0: `0xfc18146d5586318640b3febea90b094b834f09982812258534a1c07bdda12954`
 */
export interface BinPoolManagerDonateArgs {
  /** `bytes32` (indexed) */
  readonly id: Hex;
  /** `address` (indexed) */
  readonly sender: Address;
  /** `int128` */
  readonly amount0: bigint;
  /** `int128` */
  readonly amount1: bigint;
  /** `uint24` */
  readonly binId: number;
}

/**
 * Decoded arguments of `BinPoolManager.DynamicLPFeeUpdated`.
 *
 * Signature: `DynamicLPFeeUpdated(bytes32,uint24)`
 * topic0: `0x14b2b80e0d62303dc85494859f35a84579160aafbd650180ddf526b1ab547bd6`
 */
export interface BinPoolManagerDynamicLPFeeUpdatedArgs {
  /** `bytes32` (indexed) */
  readonly id: Hex;
  /** `uint24` */
  readonly dynamicLPFee: number;
}

/**
 * Decoded arguments of `BinPoolManager.Initialize`.
 *
 * Signature: `Initialize(bytes32,address,address,address,uint24,bytes32,uint24)`
 * topic0: `0xddfde5903015c0eb1671976c6c8f760f1328bec57f15286b6bdab2f955cab9c9`
 */
export interface BinPoolManagerInitializeArgs {
  /** `bytes32` (indexed) */
  readonly id: Hex;
  /** `address` (indexed) */
  readonly currency0: Address;
  /** `address` (indexed) */
  readonly currency1: Address;
  /** `address` */
  readonly hooks: Address;
  /** `uint24` */
  readonly fee: number;
  /** `bytes32` */
  readonly parameters: Hex;
  /** `uint24` */
  readonly activeId: number;
}

/**
 * Decoded arguments of `BinPoolManager.Mint`.
 *
 * Signature: `Mint(bytes32,address,uint256[],bytes32,bytes32[],bytes32,bytes32)`
 * topic0: `0x7b6bc49b385af8644341f07a67cd976bf9daf2bdd5d71668e651a3a792e318e1`
 */
export interface BinPoolManagerMintArgs {
  /** `bytes32` (indexed) */
  readonly id: Hex;
  /** `address` (indexed) */
  readonly sender: Address;
  /** `uint256[]` */
  readonly ids: readonly (bigint)[];
  /** `bytes32` */
  readonly salt: Hex;
  /** `bytes32[]` */
  readonly amounts: readonly (Hex)[];
  /** `bytes32` */
  readonly compositionFeeAmount: Hex;
  /** `bytes32` */
  readonly feeAmountToProtocol: Hex;
}

/**
 * Decoded arguments of `BinPoolManager.OwnershipTransferred`.
 *
 * Signature: `OwnershipTransferred(address,address)`
 * topic0: `0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0`
 */
export interface BinPoolManagerOwnershipTransferredArgs {
  /** `address` (indexed) */
  readonly previousOwner: Address;
  /** `address` (indexed) */
  readonly newOwner: Address;
}

/**
 * Decoded arguments of `BinPoolManager.Paused`.
 *
 * Signature: `Paused(address)`
 * topic0: `0x62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258`
 */
export interface BinPoolManagerPausedArgs {
  /** `address` */
  readonly account: Address;
}

/**
 * Decoded arguments of `BinPoolManager.ProtocolFeeControllerUpdated`.
 *
 * Signature: `ProtocolFeeControllerUpdated(address)`
 * topic0: `0xb4bd8ef53df690b9943d3318996006dbb82a25f54719d8c8035b516a2a5b8acc`
 */
export interface BinPoolManagerProtocolFeeControllerUpdatedArgs {
  /** `address` (indexed) */
  readonly protocolFeeController: Address;
}

/**
 * Decoded arguments of `BinPoolManager.ProtocolFeeUpdated`.
 *
 * Signature: `ProtocolFeeUpdated(bytes32,uint24)`
 * topic0: `0xe9c42593e71f84403b84352cd168d693e2c9fcd1fdbcc3feb21d92b43e6696f9`
 */
export interface BinPoolManagerProtocolFeeUpdatedArgs {
  /** `bytes32` (indexed) */
  readonly id: Hex;
  /** `uint24` */
  readonly protocolFee: number;
}

/**
 * Decoded arguments of `BinPoolManager.SetMaxBinStep`.
 *
 * Signature: `SetMaxBinStep(uint16)`
 * topic0: `0x02172f85720dcdece86093a50de7b9578583a2b7a567992be89d92868feba494`
 */
export interface BinPoolManagerSetMaxBinStepArgs {
  /** `uint16` */
  readonly maxBinStep: number;
}

/**
 * Decoded arguments of `BinPoolManager.SetMinBinSharesForDonate`.
 *
 * Signature: `SetMinBinSharesForDonate(uint256)`
 * topic0: `0xd752b38d4cbf2c0d2ceecee3d2f43840ec77bd9cde6b733b94cc065bdab931a3`
 */
export interface BinPoolManagerSetMinBinSharesForDonateArgs {
  /** `uint256` */
  readonly minLiquidity: bigint;
}

/**
 * Decoded arguments of `BinPoolManager.Swap`.
 *
 * Signature: `Swap(bytes32,address,int128,int128,uint24,uint24,uint16)`
 * topic0: `0x3e8aae37f890eb1f9d63dd4d2062f3f0be757848a0f0760e4f3e53dad556e861`
 */
export interface BinPoolManagerSwapArgs {
  /** `bytes32` (indexed) */
  readonly id: Hex;
  /** `address` (indexed) */
  readonly sender: Address;
  /** `int128` */
  readonly amount0: bigint;
  /** `int128` */
  readonly amount1: bigint;
  /** `uint24` */
  readonly activeId: number;
  /** `uint24` */
  readonly fee: number;
  /** `uint16` */
  readonly protocolFee: number;
}

/**
 * Decoded arguments of `BinPoolManager.Unpaused`.
 *
 * Signature: `Unpaused(address)`
 * topic0: `0x5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa`
 */
export interface BinPoolManagerUnpausedArgs {
  /** `address` */
  readonly account: Address;
}

// ---------------------------------------------------------------------------
// ProtocolFees
// ---------------------------------------------------------------------------

/**
 * Decoded arguments of `ProtocolFees.OwnershipTransferred`.
 *
 * Signature: `OwnershipTransferred(address,address)`
 * topic0: `0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0`
 */
export interface ProtocolFeesOwnershipTransferredArgs {
  /** `address` (indexed) */
  readonly previousOwner: Address;
  /** `address` (indexed) */
  readonly newOwner: Address;
}

/**
 * Decoded arguments of `ProtocolFees.Paused`.
 *
 * Signature: `Paused(address)`
 * topic0: `0x62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258`
 */
export interface ProtocolFeesPausedArgs {
  /** `address` */
  readonly account: Address;
}

/**
 * Decoded arguments of `ProtocolFees.ProtocolFeeControllerUpdated`.
 *
 * Signature: `ProtocolFeeControllerUpdated(address)`
 * topic0: `0xb4bd8ef53df690b9943d3318996006dbb82a25f54719d8c8035b516a2a5b8acc`
 */
export interface ProtocolFeesProtocolFeeControllerUpdatedArgs {
  /** `address` (indexed) */
  readonly protocolFeeController: Address;
}

/**
 * Decoded arguments of `ProtocolFees.ProtocolFeeUpdated`.
 *
 * Signature: `ProtocolFeeUpdated(bytes32,uint24)`
 * topic0: `0xe9c42593e71f84403b84352cd168d693e2c9fcd1fdbcc3feb21d92b43e6696f9`
 */
export interface ProtocolFeesProtocolFeeUpdatedArgs {
  /** `bytes32` (indexed) */
  readonly id: Hex;
  /** `uint24` */
  readonly protocolFee: number;
}

/**
 * Decoded arguments of `ProtocolFees.Unpaused`.
 *
 * Signature: `Unpaused(address)`
 * topic0: `0x5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa`
 */
export interface ProtocolFeesUnpausedArgs {
  /** `address` */
  readonly account: Address;
}

// ---------------------------------------------------------------------------
// topic0 (event selector) constants
// ---------------------------------------------------------------------------

export const EVENT_TOPICS = {
  /** `AppRegistered(address)` */
  VAULT_APP_REGISTERED: "0x0d540ad8f39e07d19909687352b9fa017405d93c91a6760981fbae9cf28bfef7",
  /** `Approval(address,address,address,uint256)` */
  VAULT_APPROVAL: "0xa0175360a15bca328baf7ea85c7b784d58b222a50d0ce760b10dba336d226a61",
  /** `OperatorSet(address,address,bool)` */
  VAULT_OPERATOR_SET: "0xceb576d9f15e4e200fdb5096d64d5dfd667e16def20c1eefd14256d8e3faa267",
  /** `OwnershipTransferred(address,address)` */
  VAULT_OWNERSHIP_TRANSFERRED: "0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0",
  /** `OwnershipTransferStarted(address,address)` */
  VAULT_OWNERSHIP_TRANSFER_STARTED: "0x38d16b8cac22d99fc7c124b9cd0de2d3fa1faef420bfe791d8c362d765e22700",
  /** `Transfer(address,address,address,address,uint256)` */
  VAULT_TRANSFER: "0x5b21a3c624a398df3917a0a930f91e3837519b8eab3302b834746433065f2959",
  /** `Donate(bytes32,address,uint256,uint256,int24)` */
  CL_POOL_MANAGER_DONATE: "0xbe708911656ae186ac3fc26a794e5f1319609ce340a14c63524f985fee4bc841",
  /** `DynamicLPFeeUpdated(bytes32,uint24)` */
  CL_POOL_MANAGER_DYNAMIC_LP_FEE_UPDATED: "0x14b2b80e0d62303dc85494859f35a84579160aafbd650180ddf526b1ab547bd6",
  /** `Initialize(bytes32,address,address,address,uint24,bytes32,uint160,int24)` */
  CL_POOL_MANAGER_INITIALIZE: "0x426cc62fe6a33a40ba2788c2c87a9c34ee4582b95bc9fa5a7bb7ae70b750b99c",
  /** `ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)` */
  CL_POOL_MANAGER_MODIFY_LIQUIDITY: "0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec",
  /** `OwnershipTransferred(address,address)` */
  CL_POOL_MANAGER_OWNERSHIP_TRANSFERRED: "0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0",
  /** `Paused(address)` */
  CL_POOL_MANAGER_PAUSED: "0x62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258",
  /** `ProtocolFeeControllerUpdated(address)` */
  CL_POOL_MANAGER_PROTOCOL_FEE_CONTROLLER_UPDATED: "0xb4bd8ef53df690b9943d3318996006dbb82a25f54719d8c8035b516a2a5b8acc",
  /** `ProtocolFeeUpdated(bytes32,uint24)` */
  CL_POOL_MANAGER_PROTOCOL_FEE_UPDATED: "0xe9c42593e71f84403b84352cd168d693e2c9fcd1fdbcc3feb21d92b43e6696f9",
  /** `Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24,uint16)` */
  CL_POOL_MANAGER_SWAP: "0x04206ad2b7c0f463bff3dd4f33c5735b0f2957a351e4f79763a4fa9e775dd237",
  /** `Unpaused(address)` */
  CL_POOL_MANAGER_UNPAUSED: "0x5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa",
  /** `Burn(bytes32,address,uint256[],bytes32,bytes32[])` */
  BIN_POOL_MANAGER_BURN: "0x16d40aa4e497175b58e47cbf101544758de8c01d92a760c738943044c758df8a",
  /** `Donate(bytes32,address,int128,int128,uint24)` */
  BIN_POOL_MANAGER_DONATE: "0xfc18146d5586318640b3febea90b094b834f09982812258534a1c07bdda12954",
  /** `DynamicLPFeeUpdated(bytes32,uint24)` */
  BIN_POOL_MANAGER_DYNAMIC_LP_FEE_UPDATED: "0x14b2b80e0d62303dc85494859f35a84579160aafbd650180ddf526b1ab547bd6",
  /** `Initialize(bytes32,address,address,address,uint24,bytes32,uint24)` */
  BIN_POOL_MANAGER_INITIALIZE: "0xddfde5903015c0eb1671976c6c8f760f1328bec57f15286b6bdab2f955cab9c9",
  /** `Mint(bytes32,address,uint256[],bytes32,bytes32[],bytes32,bytes32)` */
  BIN_POOL_MANAGER_MINT: "0x7b6bc49b385af8644341f07a67cd976bf9daf2bdd5d71668e651a3a792e318e1",
  /** `OwnershipTransferred(address,address)` */
  BIN_POOL_MANAGER_OWNERSHIP_TRANSFERRED: "0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0",
  /** `Paused(address)` */
  BIN_POOL_MANAGER_PAUSED: "0x62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258",
  /** `ProtocolFeeControllerUpdated(address)` */
  BIN_POOL_MANAGER_PROTOCOL_FEE_CONTROLLER_UPDATED: "0xb4bd8ef53df690b9943d3318996006dbb82a25f54719d8c8035b516a2a5b8acc",
  /** `ProtocolFeeUpdated(bytes32,uint24)` */
  BIN_POOL_MANAGER_PROTOCOL_FEE_UPDATED: "0xe9c42593e71f84403b84352cd168d693e2c9fcd1fdbcc3feb21d92b43e6696f9",
  /** `SetMaxBinStep(uint16)` */
  BIN_POOL_MANAGER_SET_MAX_BIN_STEP: "0x02172f85720dcdece86093a50de7b9578583a2b7a567992be89d92868feba494",
  /** `SetMinBinSharesForDonate(uint256)` */
  BIN_POOL_MANAGER_SET_MIN_BIN_SHARES_FOR_DONATE: "0xd752b38d4cbf2c0d2ceecee3d2f43840ec77bd9cde6b733b94cc065bdab931a3",
  /** `Swap(bytes32,address,int128,int128,uint24,uint24,uint16)` */
  BIN_POOL_MANAGER_SWAP: "0x3e8aae37f890eb1f9d63dd4d2062f3f0be757848a0f0760e4f3e53dad556e861",
  /** `Unpaused(address)` */
  BIN_POOL_MANAGER_UNPAUSED: "0x5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa",
  /** `OwnershipTransferred(address,address)` */
  PROTOCOL_FEES_OWNERSHIP_TRANSFERRED: "0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0",
  /** `Paused(address)` */
  PROTOCOL_FEES_PAUSED: "0x62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258",
  /** `ProtocolFeeControllerUpdated(address)` */
  PROTOCOL_FEES_PROTOCOL_FEE_CONTROLLER_UPDATED: "0xb4bd8ef53df690b9943d3318996006dbb82a25f54719d8c8035b516a2a5b8acc",
  /** `ProtocolFeeUpdated(bytes32,uint24)` */
  PROTOCOL_FEES_PROTOCOL_FEE_UPDATED: "0xe9c42593e71f84403b84352cd168d693e2c9fcd1fdbcc3feb21d92b43e6696f9",
  /** `Unpaused(address)` */
  PROTOCOL_FEES_UNPAUSED: "0x5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa",
} as const satisfies Record<string, Hex>;

// ---------------------------------------------------------------------------
// Runtime descriptor table
// ---------------------------------------------------------------------------

export interface EventDescriptor {
  /** Contract that declares the event. */
  readonly contract: ContractName;
  /** Solidity event name (not unique across contracts). */
  readonly eventName: string;
  /** Canonical signature used to derive topic0. */
  readonly signature: string;
  /** keccak256 of the canonical signature. */
  readonly topic0: Hex;
  /** Number of indexed parameters (topics 1..3). */
  readonly indexedCount: number;
}

export const EVENT_DESCRIPTORS = [
  { contract: "Vault", eventName: "AppRegistered", signature: "AppRegistered(address)", topic0: "0x0d540ad8f39e07d19909687352b9fa017405d93c91a6760981fbae9cf28bfef7", indexedCount: 1 },
  { contract: "Vault", eventName: "Approval", signature: "Approval(address,address,address,uint256)", topic0: "0xa0175360a15bca328baf7ea85c7b784d58b222a50d0ce760b10dba336d226a61", indexedCount: 3 },
  { contract: "Vault", eventName: "OperatorSet", signature: "OperatorSet(address,address,bool)", topic0: "0xceb576d9f15e4e200fdb5096d64d5dfd667e16def20c1eefd14256d8e3faa267", indexedCount: 2 },
  { contract: "Vault", eventName: "OwnershipTransferred", signature: "OwnershipTransferred(address,address)", topic0: "0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0", indexedCount: 2 },
  { contract: "Vault", eventName: "OwnershipTransferStarted", signature: "OwnershipTransferStarted(address,address)", topic0: "0x38d16b8cac22d99fc7c124b9cd0de2d3fa1faef420bfe791d8c362d765e22700", indexedCount: 2 },
  { contract: "Vault", eventName: "Transfer", signature: "Transfer(address,address,address,address,uint256)", topic0: "0x5b21a3c624a398df3917a0a930f91e3837519b8eab3302b834746433065f2959", indexedCount: 3 },
  { contract: "CLPoolManager", eventName: "Donate", signature: "Donate(bytes32,address,uint256,uint256,int24)", topic0: "0xbe708911656ae186ac3fc26a794e5f1319609ce340a14c63524f985fee4bc841", indexedCount: 2 },
  { contract: "CLPoolManager", eventName: "DynamicLPFeeUpdated", signature: "DynamicLPFeeUpdated(bytes32,uint24)", topic0: "0x14b2b80e0d62303dc85494859f35a84579160aafbd650180ddf526b1ab547bd6", indexedCount: 1 },
  { contract: "CLPoolManager", eventName: "Initialize", signature: "Initialize(bytes32,address,address,address,uint24,bytes32,uint160,int24)", topic0: "0x426cc62fe6a33a40ba2788c2c87a9c34ee4582b95bc9fa5a7bb7ae70b750b99c", indexedCount: 3 },
  { contract: "CLPoolManager", eventName: "ModifyLiquidity", signature: "ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)", topic0: "0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec", indexedCount: 2 },
  { contract: "CLPoolManager", eventName: "OwnershipTransferred", signature: "OwnershipTransferred(address,address)", topic0: "0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0", indexedCount: 2 },
  { contract: "CLPoolManager", eventName: "Paused", signature: "Paused(address)", topic0: "0x62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258", indexedCount: 0 },
  { contract: "CLPoolManager", eventName: "ProtocolFeeControllerUpdated", signature: "ProtocolFeeControllerUpdated(address)", topic0: "0xb4bd8ef53df690b9943d3318996006dbb82a25f54719d8c8035b516a2a5b8acc", indexedCount: 1 },
  { contract: "CLPoolManager", eventName: "ProtocolFeeUpdated", signature: "ProtocolFeeUpdated(bytes32,uint24)", topic0: "0xe9c42593e71f84403b84352cd168d693e2c9fcd1fdbcc3feb21d92b43e6696f9", indexedCount: 1 },
  { contract: "CLPoolManager", eventName: "Swap", signature: "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24,uint16)", topic0: "0x04206ad2b7c0f463bff3dd4f33c5735b0f2957a351e4f79763a4fa9e775dd237", indexedCount: 2 },
  { contract: "CLPoolManager", eventName: "Unpaused", signature: "Unpaused(address)", topic0: "0x5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa", indexedCount: 0 },
  { contract: "BinPoolManager", eventName: "Burn", signature: "Burn(bytes32,address,uint256[],bytes32,bytes32[])", topic0: "0x16d40aa4e497175b58e47cbf101544758de8c01d92a760c738943044c758df8a", indexedCount: 2 },
  { contract: "BinPoolManager", eventName: "Donate", signature: "Donate(bytes32,address,int128,int128,uint24)", topic0: "0xfc18146d5586318640b3febea90b094b834f09982812258534a1c07bdda12954", indexedCount: 2 },
  { contract: "BinPoolManager", eventName: "DynamicLPFeeUpdated", signature: "DynamicLPFeeUpdated(bytes32,uint24)", topic0: "0x14b2b80e0d62303dc85494859f35a84579160aafbd650180ddf526b1ab547bd6", indexedCount: 1 },
  { contract: "BinPoolManager", eventName: "Initialize", signature: "Initialize(bytes32,address,address,address,uint24,bytes32,uint24)", topic0: "0xddfde5903015c0eb1671976c6c8f760f1328bec57f15286b6bdab2f955cab9c9", indexedCount: 3 },
  { contract: "BinPoolManager", eventName: "Mint", signature: "Mint(bytes32,address,uint256[],bytes32,bytes32[],bytes32,bytes32)", topic0: "0x7b6bc49b385af8644341f07a67cd976bf9daf2bdd5d71668e651a3a792e318e1", indexedCount: 2 },
  { contract: "BinPoolManager", eventName: "OwnershipTransferred", signature: "OwnershipTransferred(address,address)", topic0: "0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0", indexedCount: 2 },
  { contract: "BinPoolManager", eventName: "Paused", signature: "Paused(address)", topic0: "0x62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258", indexedCount: 0 },
  { contract: "BinPoolManager", eventName: "ProtocolFeeControllerUpdated", signature: "ProtocolFeeControllerUpdated(address)", topic0: "0xb4bd8ef53df690b9943d3318996006dbb82a25f54719d8c8035b516a2a5b8acc", indexedCount: 1 },
  { contract: "BinPoolManager", eventName: "ProtocolFeeUpdated", signature: "ProtocolFeeUpdated(bytes32,uint24)", topic0: "0xe9c42593e71f84403b84352cd168d693e2c9fcd1fdbcc3feb21d92b43e6696f9", indexedCount: 1 },
  { contract: "BinPoolManager", eventName: "SetMaxBinStep", signature: "SetMaxBinStep(uint16)", topic0: "0x02172f85720dcdece86093a50de7b9578583a2b7a567992be89d92868feba494", indexedCount: 0 },
  { contract: "BinPoolManager", eventName: "SetMinBinSharesForDonate", signature: "SetMinBinSharesForDonate(uint256)", topic0: "0xd752b38d4cbf2c0d2ceecee3d2f43840ec77bd9cde6b733b94cc065bdab931a3", indexedCount: 0 },
  { contract: "BinPoolManager", eventName: "Swap", signature: "Swap(bytes32,address,int128,int128,uint24,uint24,uint16)", topic0: "0x3e8aae37f890eb1f9d63dd4d2062f3f0be757848a0f0760e4f3e53dad556e861", indexedCount: 2 },
  { contract: "BinPoolManager", eventName: "Unpaused", signature: "Unpaused(address)", topic0: "0x5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa", indexedCount: 0 },
  { contract: "ProtocolFees", eventName: "OwnershipTransferred", signature: "OwnershipTransferred(address,address)", topic0: "0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0", indexedCount: 2 },
  { contract: "ProtocolFees", eventName: "Paused", signature: "Paused(address)", topic0: "0x62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258", indexedCount: 0 },
  { contract: "ProtocolFees", eventName: "ProtocolFeeControllerUpdated", signature: "ProtocolFeeControllerUpdated(address)", topic0: "0xb4bd8ef53df690b9943d3318996006dbb82a25f54719d8c8035b516a2a5b8acc", indexedCount: 1 },
  { contract: "ProtocolFees", eventName: "ProtocolFeeUpdated", signature: "ProtocolFeeUpdated(bytes32,uint24)", topic0: "0xe9c42593e71f84403b84352cd168d693e2c9fcd1fdbcc3feb21d92b43e6696f9", indexedCount: 1 },
  { contract: "ProtocolFees", eventName: "Unpaused", signature: "Unpaused(address)", topic0: "0x5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa", indexedCount: 0 },
] as const satisfies readonly EventDescriptor[];

export const CONTRACT_NAMES = [
  "Vault",
  "CLPoolManager",
  "BinPoolManager",
  "ProtocolFees",
] as const;

export type ContractName = (typeof CONTRACT_NAMES)[number];

export type VaultEventName =
  | "AppRegistered"
  | "Approval"
  | "OperatorSet"
  | "OwnershipTransferred"
  | "OwnershipTransferStarted"
  | "Transfer";

export type CLPoolManagerEventName =
  | "Donate"
  | "DynamicLPFeeUpdated"
  | "Initialize"
  | "ModifyLiquidity"
  | "OwnershipTransferred"
  | "Paused"
  | "ProtocolFeeControllerUpdated"
  | "ProtocolFeeUpdated"
  | "Swap"
  | "Unpaused";

export type BinPoolManagerEventName =
  | "Burn"
  | "Donate"
  | "DynamicLPFeeUpdated"
  | "Initialize"
  | "Mint"
  | "OwnershipTransferred"
  | "Paused"
  | "ProtocolFeeControllerUpdated"
  | "ProtocolFeeUpdated"
  | "SetMaxBinStep"
  | "SetMinBinSharesForDonate"
  | "Swap"
  | "Unpaused";

export type ProtocolFeesEventName =
  | "OwnershipTransferred"
  | "Paused"
  | "ProtocolFeeControllerUpdated"
  | "ProtocolFeeUpdated"
  | "Unpaused";

/** Maps each `Vault` event name to its decoded argument type. */
export interface VaultEventArgsMap {
  "AppRegistered": VaultAppRegisteredArgs;
  "Approval": VaultApprovalArgs;
  "OperatorSet": VaultOperatorSetArgs;
  "OwnershipTransferred": VaultOwnershipTransferredArgs;
  "OwnershipTransferStarted": VaultOwnershipTransferStartedArgs;
  "Transfer": VaultTransferArgs;
}

/** Maps each `CLPoolManager` event name to its decoded argument type. */
export interface CLPoolManagerEventArgsMap {
  "Donate": CLPoolManagerDonateArgs;
  "DynamicLPFeeUpdated": CLPoolManagerDynamicLPFeeUpdatedArgs;
  "Initialize": CLPoolManagerInitializeArgs;
  "ModifyLiquidity": CLPoolManagerModifyLiquidityArgs;
  "OwnershipTransferred": CLPoolManagerOwnershipTransferredArgs;
  "Paused": CLPoolManagerPausedArgs;
  "ProtocolFeeControllerUpdated": CLPoolManagerProtocolFeeControllerUpdatedArgs;
  "ProtocolFeeUpdated": CLPoolManagerProtocolFeeUpdatedArgs;
  "Swap": CLPoolManagerSwapArgs;
  "Unpaused": CLPoolManagerUnpausedArgs;
}

/** Maps each `BinPoolManager` event name to its decoded argument type. */
export interface BinPoolManagerEventArgsMap {
  "Burn": BinPoolManagerBurnArgs;
  "Donate": BinPoolManagerDonateArgs;
  "DynamicLPFeeUpdated": BinPoolManagerDynamicLPFeeUpdatedArgs;
  "Initialize": BinPoolManagerInitializeArgs;
  "Mint": BinPoolManagerMintArgs;
  "OwnershipTransferred": BinPoolManagerOwnershipTransferredArgs;
  "Paused": BinPoolManagerPausedArgs;
  "ProtocolFeeControllerUpdated": BinPoolManagerProtocolFeeControllerUpdatedArgs;
  "ProtocolFeeUpdated": BinPoolManagerProtocolFeeUpdatedArgs;
  "SetMaxBinStep": BinPoolManagerSetMaxBinStepArgs;
  "SetMinBinSharesForDonate": BinPoolManagerSetMinBinSharesForDonateArgs;
  "Swap": BinPoolManagerSwapArgs;
  "Unpaused": BinPoolManagerUnpausedArgs;
}

/** Maps each `ProtocolFees` event name to its decoded argument type. */
export interface ProtocolFeesEventArgsMap {
  "OwnershipTransferred": ProtocolFeesOwnershipTransferredArgs;
  "Paused": ProtocolFeesPausedArgs;
  "ProtocolFeeControllerUpdated": ProtocolFeesProtocolFeeControllerUpdatedArgs;
  "ProtocolFeeUpdated": ProtocolFeesProtocolFeeUpdatedArgs;
  "Unpaused": ProtocolFeesUnpausedArgs;
}

/** Envelope carried by every decoded log. */
export interface DecodedEventBase {
  readonly address: Address;
  readonly blockNumber: bigint;
  readonly blockTimestamp: bigint;
  readonly transactionHash: Hex;
  readonly logIndex: number;
}

export interface VaultAppRegisteredEvent extends DecodedEventBase {
  readonly contract: "Vault";
  readonly eventName: "AppRegistered";
  readonly args: VaultAppRegisteredArgs;
}

export interface VaultApprovalEvent extends DecodedEventBase {
  readonly contract: "Vault";
  readonly eventName: "Approval";
  readonly args: VaultApprovalArgs;
}

export interface VaultOperatorSetEvent extends DecodedEventBase {
  readonly contract: "Vault";
  readonly eventName: "OperatorSet";
  readonly args: VaultOperatorSetArgs;
}

export interface VaultOwnershipTransferredEvent extends DecodedEventBase {
  readonly contract: "Vault";
  readonly eventName: "OwnershipTransferred";
  readonly args: VaultOwnershipTransferredArgs;
}

export interface VaultOwnershipTransferStartedEvent extends DecodedEventBase {
  readonly contract: "Vault";
  readonly eventName: "OwnershipTransferStarted";
  readonly args: VaultOwnershipTransferStartedArgs;
}

export interface VaultTransferEvent extends DecodedEventBase {
  readonly contract: "Vault";
  readonly eventName: "Transfer";
  readonly args: VaultTransferArgs;
}

export interface CLPoolManagerDonateEvent extends DecodedEventBase {
  readonly contract: "CLPoolManager";
  readonly eventName: "Donate";
  readonly args: CLPoolManagerDonateArgs;
}

export interface CLPoolManagerDynamicLPFeeUpdatedEvent extends DecodedEventBase {
  readonly contract: "CLPoolManager";
  readonly eventName: "DynamicLPFeeUpdated";
  readonly args: CLPoolManagerDynamicLPFeeUpdatedArgs;
}

export interface CLPoolManagerInitializeEvent extends DecodedEventBase {
  readonly contract: "CLPoolManager";
  readonly eventName: "Initialize";
  readonly args: CLPoolManagerInitializeArgs;
}

export interface CLPoolManagerModifyLiquidityEvent extends DecodedEventBase {
  readonly contract: "CLPoolManager";
  readonly eventName: "ModifyLiquidity";
  readonly args: CLPoolManagerModifyLiquidityArgs;
}

export interface CLPoolManagerOwnershipTransferredEvent extends DecodedEventBase {
  readonly contract: "CLPoolManager";
  readonly eventName: "OwnershipTransferred";
  readonly args: CLPoolManagerOwnershipTransferredArgs;
}

export interface CLPoolManagerPausedEvent extends DecodedEventBase {
  readonly contract: "CLPoolManager";
  readonly eventName: "Paused";
  readonly args: CLPoolManagerPausedArgs;
}

export interface CLPoolManagerProtocolFeeControllerUpdatedEvent extends DecodedEventBase {
  readonly contract: "CLPoolManager";
  readonly eventName: "ProtocolFeeControllerUpdated";
  readonly args: CLPoolManagerProtocolFeeControllerUpdatedArgs;
}

export interface CLPoolManagerProtocolFeeUpdatedEvent extends DecodedEventBase {
  readonly contract: "CLPoolManager";
  readonly eventName: "ProtocolFeeUpdated";
  readonly args: CLPoolManagerProtocolFeeUpdatedArgs;
}

export interface CLPoolManagerSwapEvent extends DecodedEventBase {
  readonly contract: "CLPoolManager";
  readonly eventName: "Swap";
  readonly args: CLPoolManagerSwapArgs;
}

export interface CLPoolManagerUnpausedEvent extends DecodedEventBase {
  readonly contract: "CLPoolManager";
  readonly eventName: "Unpaused";
  readonly args: CLPoolManagerUnpausedArgs;
}

export interface BinPoolManagerBurnEvent extends DecodedEventBase {
  readonly contract: "BinPoolManager";
  readonly eventName: "Burn";
  readonly args: BinPoolManagerBurnArgs;
}

export interface BinPoolManagerDonateEvent extends DecodedEventBase {
  readonly contract: "BinPoolManager";
  readonly eventName: "Donate";
  readonly args: BinPoolManagerDonateArgs;
}

export interface BinPoolManagerDynamicLPFeeUpdatedEvent extends DecodedEventBase {
  readonly contract: "BinPoolManager";
  readonly eventName: "DynamicLPFeeUpdated";
  readonly args: BinPoolManagerDynamicLPFeeUpdatedArgs;
}

export interface BinPoolManagerInitializeEvent extends DecodedEventBase {
  readonly contract: "BinPoolManager";
  readonly eventName: "Initialize";
  readonly args: BinPoolManagerInitializeArgs;
}

export interface BinPoolManagerMintEvent extends DecodedEventBase {
  readonly contract: "BinPoolManager";
  readonly eventName: "Mint";
  readonly args: BinPoolManagerMintArgs;
}

export interface BinPoolManagerOwnershipTransferredEvent extends DecodedEventBase {
  readonly contract: "BinPoolManager";
  readonly eventName: "OwnershipTransferred";
  readonly args: BinPoolManagerOwnershipTransferredArgs;
}

export interface BinPoolManagerPausedEvent extends DecodedEventBase {
  readonly contract: "BinPoolManager";
  readonly eventName: "Paused";
  readonly args: BinPoolManagerPausedArgs;
}

export interface BinPoolManagerProtocolFeeControllerUpdatedEvent extends DecodedEventBase {
  readonly contract: "BinPoolManager";
  readonly eventName: "ProtocolFeeControllerUpdated";
  readonly args: BinPoolManagerProtocolFeeControllerUpdatedArgs;
}

export interface BinPoolManagerProtocolFeeUpdatedEvent extends DecodedEventBase {
  readonly contract: "BinPoolManager";
  readonly eventName: "ProtocolFeeUpdated";
  readonly args: BinPoolManagerProtocolFeeUpdatedArgs;
}

export interface BinPoolManagerSetMaxBinStepEvent extends DecodedEventBase {
  readonly contract: "BinPoolManager";
  readonly eventName: "SetMaxBinStep";
  readonly args: BinPoolManagerSetMaxBinStepArgs;
}

export interface BinPoolManagerSetMinBinSharesForDonateEvent extends DecodedEventBase {
  readonly contract: "BinPoolManager";
  readonly eventName: "SetMinBinSharesForDonate";
  readonly args: BinPoolManagerSetMinBinSharesForDonateArgs;
}

export interface BinPoolManagerSwapEvent extends DecodedEventBase {
  readonly contract: "BinPoolManager";
  readonly eventName: "Swap";
  readonly args: BinPoolManagerSwapArgs;
}

export interface BinPoolManagerUnpausedEvent extends DecodedEventBase {
  readonly contract: "BinPoolManager";
  readonly eventName: "Unpaused";
  readonly args: BinPoolManagerUnpausedArgs;
}

export interface ProtocolFeesOwnershipTransferredEvent extends DecodedEventBase {
  readonly contract: "ProtocolFees";
  readonly eventName: "OwnershipTransferred";
  readonly args: ProtocolFeesOwnershipTransferredArgs;
}

export interface ProtocolFeesPausedEvent extends DecodedEventBase {
  readonly contract: "ProtocolFees";
  readonly eventName: "Paused";
  readonly args: ProtocolFeesPausedArgs;
}

export interface ProtocolFeesProtocolFeeControllerUpdatedEvent extends DecodedEventBase {
  readonly contract: "ProtocolFees";
  readonly eventName: "ProtocolFeeControllerUpdated";
  readonly args: ProtocolFeesProtocolFeeControllerUpdatedArgs;
}

export interface ProtocolFeesProtocolFeeUpdatedEvent extends DecodedEventBase {
  readonly contract: "ProtocolFees";
  readonly eventName: "ProtocolFeeUpdated";
  readonly args: ProtocolFeesProtocolFeeUpdatedArgs;
}

export interface ProtocolFeesUnpausedEvent extends DecodedEventBase {
  readonly contract: "ProtocolFees";
  readonly eventName: "Unpaused";
  readonly args: ProtocolFeesUnpausedArgs;
}

/** Every decoded protocol event, discriminated by `contract` + `eventName`. */
export type LatchProtocolEvent =
  | VaultAppRegisteredEvent
  | VaultApprovalEvent
  | VaultOperatorSetEvent
  | VaultOwnershipTransferredEvent
  | VaultOwnershipTransferStartedEvent
  | VaultTransferEvent
  | CLPoolManagerDonateEvent
  | CLPoolManagerDynamicLPFeeUpdatedEvent
  | CLPoolManagerInitializeEvent
  | CLPoolManagerModifyLiquidityEvent
  | CLPoolManagerOwnershipTransferredEvent
  | CLPoolManagerPausedEvent
  | CLPoolManagerProtocolFeeControllerUpdatedEvent
  | CLPoolManagerProtocolFeeUpdatedEvent
  | CLPoolManagerSwapEvent
  | CLPoolManagerUnpausedEvent
  | BinPoolManagerBurnEvent
  | BinPoolManagerDonateEvent
  | BinPoolManagerDynamicLPFeeUpdatedEvent
  | BinPoolManagerInitializeEvent
  | BinPoolManagerMintEvent
  | BinPoolManagerOwnershipTransferredEvent
  | BinPoolManagerPausedEvent
  | BinPoolManagerProtocolFeeControllerUpdatedEvent
  | BinPoolManagerProtocolFeeUpdatedEvent
  | BinPoolManagerSetMaxBinStepEvent
  | BinPoolManagerSetMinBinSharesForDonateEvent
  | BinPoolManagerSwapEvent
  | BinPoolManagerUnpausedEvent
  | ProtocolFeesOwnershipTransferredEvent
  | ProtocolFeesPausedEvent
  | ProtocolFeesProtocolFeeControllerUpdatedEvent
  | ProtocolFeesProtocolFeeUpdatedEvent
  | ProtocolFeesUnpausedEvent;

/** Total number of distinct event declarations across all core contracts. */
export const EVENT_COUNT = 34 as const;

/** Number of unique event signatures (deduplicated across contracts). */
export const UNIQUE_EVENT_SIGNATURE_COUNT = 22 as const;
