// SPDX-License-Identifier: MIT
// -----------------------------------------------------------------------------
// GENERATED FILE - DO NOT EDIT BY HAND.
// Produced by scripts/generate-events.mjs from the compiled contract ABIs.
// Re-run `npm run generate` after the contracts are rebuilt.
// -----------------------------------------------------------------------------

import type { Abi } from "viem";

/** Event fragments of the `Vault` contract (6 events). */
export const VAULT_EVENTS_ABI = [
  {
    type: "event",
    name: "AppRegistered",
    anonymous: false,
    inputs: [
      {
        name: "app",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
  },
  {
    type: "event",
    name: "Approval",
    anonymous: false,
    inputs: [
      {
        name: "owner",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "spender",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "currency",
        type: "address",
        indexed: true,
        internalType: "Currency"
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      }
    ],
  },
  {
    type: "event",
    name: "OperatorSet",
    anonymous: false,
    inputs: [
      {
        name: "owner",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "operator",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "approved",
        type: "bool",
        indexed: false,
        internalType: "bool"
      }
    ],
  },
  {
    type: "event",
    name: "OwnershipTransferred",
    anonymous: false,
    inputs: [
      {
        name: "previousOwner",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "newOwner",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
  },
  {
    type: "event",
    name: "OwnershipTransferStarted",
    anonymous: false,
    inputs: [
      {
        name: "previousOwner",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "newOwner",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
  },
  {
    type: "event",
    name: "Transfer",
    anonymous: false,
    inputs: [
      {
        name: "caller",
        type: "address",
        indexed: false,
        internalType: "address"
      },
      {
        name: "from",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "to",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "currency",
        type: "address",
        indexed: true,
        internalType: "Currency"
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      }
    ],
  }
] as const satisfies Abi;

/** Event fragments of the `CLPoolManager` contract (10 events). */
export const CL_POOL_MANAGER_EVENTS_ABI = [
  {
    type: "event",
    name: "Donate",
    anonymous: false,
    inputs: [
      {
        name: "id",
        type: "bytes32",
        indexed: true,
        internalType: "PoolId"
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "amount0",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      },
      {
        name: "amount1",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      },
      {
        name: "tick",
        type: "int24",
        indexed: false,
        internalType: "int24"
      }
    ],
  },
  {
    type: "event",
    name: "DynamicLPFeeUpdated",
    anonymous: false,
    inputs: [
      {
        name: "id",
        type: "bytes32",
        indexed: true,
        internalType: "PoolId"
      },
      {
        name: "dynamicLPFee",
        type: "uint24",
        indexed: false,
        internalType: "uint24"
      }
    ],
  },
  {
    type: "event",
    name: "Initialize",
    anonymous: false,
    inputs: [
      {
        name: "id",
        type: "bytes32",
        indexed: true,
        internalType: "PoolId"
      },
      {
        name: "currency0",
        type: "address",
        indexed: true,
        internalType: "Currency"
      },
      {
        name: "currency1",
        type: "address",
        indexed: true,
        internalType: "Currency"
      },
      {
        name: "hooks",
        type: "address",
        indexed: false,
        internalType: "contract IHooks"
      },
      {
        name: "fee",
        type: "uint24",
        indexed: false,
        internalType: "uint24"
      },
      {
        name: "parameters",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32"
      },
      {
        name: "sqrtPriceX96",
        type: "uint160",
        indexed: false,
        internalType: "uint160"
      },
      {
        name: "tick",
        type: "int24",
        indexed: false,
        internalType: "int24"
      }
    ],
  },
  {
    type: "event",
    name: "ModifyLiquidity",
    anonymous: false,
    inputs: [
      {
        name: "id",
        type: "bytes32",
        indexed: true,
        internalType: "PoolId"
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "tickLower",
        type: "int24",
        indexed: false,
        internalType: "int24"
      },
      {
        name: "tickUpper",
        type: "int24",
        indexed: false,
        internalType: "int24"
      },
      {
        name: "liquidityDelta",
        type: "int256",
        indexed: false,
        internalType: "int256"
      },
      {
        name: "salt",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32"
      }
    ],
  },
  {
    type: "event",
    name: "OwnershipTransferred",
    anonymous: false,
    inputs: [
      {
        name: "previousOwner",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "newOwner",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
  },
  {
    type: "event",
    name: "Paused",
    anonymous: false,
    inputs: [
      {
        name: "account",
        type: "address",
        indexed: false,
        internalType: "address"
      }
    ],
  },
  {
    type: "event",
    name: "ProtocolFeeControllerUpdated",
    anonymous: false,
    inputs: [
      {
        name: "protocolFeeController",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
  },
  {
    type: "event",
    name: "ProtocolFeeUpdated",
    anonymous: false,
    inputs: [
      {
        name: "id",
        type: "bytes32",
        indexed: true,
        internalType: "PoolId"
      },
      {
        name: "protocolFee",
        type: "uint24",
        indexed: false,
        internalType: "uint24"
      }
    ],
  },
  {
    type: "event",
    name: "Swap",
    anonymous: false,
    inputs: [
      {
        name: "id",
        type: "bytes32",
        indexed: true,
        internalType: "PoolId"
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "amount0",
        type: "int128",
        indexed: false,
        internalType: "int128"
      },
      {
        name: "amount1",
        type: "int128",
        indexed: false,
        internalType: "int128"
      },
      {
        name: "sqrtPriceX96",
        type: "uint160",
        indexed: false,
        internalType: "uint160"
      },
      {
        name: "liquidity",
        type: "uint128",
        indexed: false,
        internalType: "uint128"
      },
      {
        name: "tick",
        type: "int24",
        indexed: false,
        internalType: "int24"
      },
      {
        name: "fee",
        type: "uint24",
        indexed: false,
        internalType: "uint24"
      },
      {
        name: "protocolFee",
        type: "uint16",
        indexed: false,
        internalType: "uint16"
      }
    ],
  },
  {
    type: "event",
    name: "Unpaused",
    anonymous: false,
    inputs: [
      {
        name: "account",
        type: "address",
        indexed: false,
        internalType: "address"
      }
    ],
  }
] as const satisfies Abi;

/** Event fragments of the `BinPoolManager` contract (13 events). */
export const BIN_POOL_MANAGER_EVENTS_ABI = [
  {
    type: "event",
    name: "Burn",
    anonymous: false,
    inputs: [
      {
        name: "id",
        type: "bytes32",
        indexed: true,
        internalType: "PoolId"
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "ids",
        type: "uint256[]",
        indexed: false,
        internalType: "uint256[]"
      },
      {
        name: "salt",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32"
      },
      {
        name: "amounts",
        type: "bytes32[]",
        indexed: false,
        internalType: "bytes32[]"
      }
    ],
  },
  {
    type: "event",
    name: "Donate",
    anonymous: false,
    inputs: [
      {
        name: "id",
        type: "bytes32",
        indexed: true,
        internalType: "PoolId"
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "amount0",
        type: "int128",
        indexed: false,
        internalType: "int128"
      },
      {
        name: "amount1",
        type: "int128",
        indexed: false,
        internalType: "int128"
      },
      {
        name: "binId",
        type: "uint24",
        indexed: false,
        internalType: "uint24"
      }
    ],
  },
  {
    type: "event",
    name: "DynamicLPFeeUpdated",
    anonymous: false,
    inputs: [
      {
        name: "id",
        type: "bytes32",
        indexed: true,
        internalType: "PoolId"
      },
      {
        name: "dynamicLPFee",
        type: "uint24",
        indexed: false,
        internalType: "uint24"
      }
    ],
  },
  {
    type: "event",
    name: "Initialize",
    anonymous: false,
    inputs: [
      {
        name: "id",
        type: "bytes32",
        indexed: true,
        internalType: "PoolId"
      },
      {
        name: "currency0",
        type: "address",
        indexed: true,
        internalType: "Currency"
      },
      {
        name: "currency1",
        type: "address",
        indexed: true,
        internalType: "Currency"
      },
      {
        name: "hooks",
        type: "address",
        indexed: false,
        internalType: "contract IHooks"
      },
      {
        name: "fee",
        type: "uint24",
        indexed: false,
        internalType: "uint24"
      },
      {
        name: "parameters",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32"
      },
      {
        name: "activeId",
        type: "uint24",
        indexed: false,
        internalType: "uint24"
      }
    ],
  },
  {
    type: "event",
    name: "Mint",
    anonymous: false,
    inputs: [
      {
        name: "id",
        type: "bytes32",
        indexed: true,
        internalType: "PoolId"
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "ids",
        type: "uint256[]",
        indexed: false,
        internalType: "uint256[]"
      },
      {
        name: "salt",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32"
      },
      {
        name: "amounts",
        type: "bytes32[]",
        indexed: false,
        internalType: "bytes32[]"
      },
      {
        name: "compositionFeeAmount",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32"
      },
      {
        name: "feeAmountToProtocol",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32"
      }
    ],
  },
  {
    type: "event",
    name: "OwnershipTransferred",
    anonymous: false,
    inputs: [
      {
        name: "previousOwner",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "newOwner",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
  },
  {
    type: "event",
    name: "Paused",
    anonymous: false,
    inputs: [
      {
        name: "account",
        type: "address",
        indexed: false,
        internalType: "address"
      }
    ],
  },
  {
    type: "event",
    name: "ProtocolFeeControllerUpdated",
    anonymous: false,
    inputs: [
      {
        name: "protocolFeeController",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
  },
  {
    type: "event",
    name: "ProtocolFeeUpdated",
    anonymous: false,
    inputs: [
      {
        name: "id",
        type: "bytes32",
        indexed: true,
        internalType: "PoolId"
      },
      {
        name: "protocolFee",
        type: "uint24",
        indexed: false,
        internalType: "uint24"
      }
    ],
  },
  {
    type: "event",
    name: "SetMaxBinStep",
    anonymous: false,
    inputs: [
      {
        name: "maxBinStep",
        type: "uint16",
        indexed: false,
        internalType: "uint16"
      }
    ],
  },
  {
    type: "event",
    name: "SetMinBinSharesForDonate",
    anonymous: false,
    inputs: [
      {
        name: "minLiquidity",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      }
    ],
  },
  {
    type: "event",
    name: "Swap",
    anonymous: false,
    inputs: [
      {
        name: "id",
        type: "bytes32",
        indexed: true,
        internalType: "PoolId"
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "amount0",
        type: "int128",
        indexed: false,
        internalType: "int128"
      },
      {
        name: "amount1",
        type: "int128",
        indexed: false,
        internalType: "int128"
      },
      {
        name: "activeId",
        type: "uint24",
        indexed: false,
        internalType: "uint24"
      },
      {
        name: "fee",
        type: "uint24",
        indexed: false,
        internalType: "uint24"
      },
      {
        name: "protocolFee",
        type: "uint16",
        indexed: false,
        internalType: "uint16"
      }
    ],
  },
  {
    type: "event",
    name: "Unpaused",
    anonymous: false,
    inputs: [
      {
        name: "account",
        type: "address",
        indexed: false,
        internalType: "address"
      }
    ],
  }
] as const satisfies Abi;

/** Event fragments of the `ProtocolFees` contract (5 events). */
export const PROTOCOL_FEES_EVENTS_ABI = [
  {
    type: "event",
    name: "OwnershipTransferred",
    anonymous: false,
    inputs: [
      {
        name: "previousOwner",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "newOwner",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
  },
  {
    type: "event",
    name: "Paused",
    anonymous: false,
    inputs: [
      {
        name: "account",
        type: "address",
        indexed: false,
        internalType: "address"
      }
    ],
  },
  {
    type: "event",
    name: "ProtocolFeeControllerUpdated",
    anonymous: false,
    inputs: [
      {
        name: "protocolFeeController",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
  },
  {
    type: "event",
    name: "ProtocolFeeUpdated",
    anonymous: false,
    inputs: [
      {
        name: "id",
        type: "bytes32",
        indexed: true,
        internalType: "PoolId"
      },
      {
        name: "protocolFee",
        type: "uint24",
        indexed: false,
        internalType: "uint24"
      }
    ],
  },
  {
    type: "event",
    name: "Unpaused",
    anonymous: false,
    inputs: [
      {
        name: "account",
        type: "address",
        indexed: false,
        internalType: "address"
      }
    ],
  }
] as const satisfies Abi;

/** Every event fragment the protocol can emit, keyed by contract. */
export const LATCH_PROTOCOL_EVENT_ABIS = {
  Vault: VAULT_EVENTS_ABI,
  CLPoolManager: CL_POOL_MANAGER_EVENTS_ABI,
  BinPoolManager: BIN_POOL_MANAGER_EVENTS_ABI,
  ProtocolFees: PROTOCOL_FEES_EVENTS_ABI,
} as const;

/** Flat ABI containing the event fragments of every core contract. */
export const LATCH_PROTOCOL_EVENTS_ABI = [
  ...VAULT_EVENTS_ABI,
  ...CL_POOL_MANAGER_EVENTS_ABI,
  ...BIN_POOL_MANAGER_EVENTS_ABI,
  ...PROTOCOL_FEES_EVENTS_ABI,
] as const satisfies Abi;
