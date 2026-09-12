// SPDX-License-Identifier: MIT
// -----------------------------------------------------------------------------
// GENERATED FILE - DO NOT EDIT BY HAND.
// Produced by scripts/generate-launchpad-abi.mjs from the compiled contract ABIs.
// Re-run `npm run generate` after the contracts are rebuilt.
// -----------------------------------------------------------------------------

import type { Abi } from "viem";

/**
 * `LaunchpadKit` - the one-call launch factory.
 *
 * 26 errors, 4 events, 14 functions - curated from the compiled artifact, not the full ABI.
 */
export const LAUNCHPAD_KIT_ABI = [
  {
    "type": "error",
    "name": "AddressEmptyCode",
    "inputs": [
      {
        "name": "target",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "AddressInsufficientBalance",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "DecayWindowTooLong",
    "inputs": [
      {
        "name": "blocks",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "FailedInnerCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "HookPoolManagerMismatch",
    "inputs": [
      {
        "name": "expected",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "actual",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "IdenticalCurrencies",
    "inputs": [
      {
        "name": "currency",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidBlockTime",
    "inputs": [
      {
        "name": "blockTimeCentis",
        "type": "uint32",
        "internalType": "uint32"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidTick",
    "inputs": [
      {
        "name": "tick",
        "type": "int24",
        "internalType": "int24"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidTickRange",
    "inputs": [
      {
        "name": "tickLower",
        "type": "int24",
        "internalType": "int24"
      },
      {
        "name": "tickUpper",
        "type": "int24",
        "internalType": "int24"
      }
    ]
  },
  {
    "type": "error",
    "name": "LaunchAlreadyExists",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ]
  },
  {
    "type": "error",
    "name": "LaunchTokenCannotBeNative",
    "inputs": []
  },
  {
    "type": "error",
    "name": "LaunchTokenHasNoCode",
    "inputs": [
      {
        "name": "launchToken",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxBuyRequiredByPreset",
    "inputs": [
      {
        "name": "preset",
        "type": "uint8",
        "internalType": "enum Preset"
      }
    ]
  },
  {
    "type": "error",
    "name": "NativeValueMismatch",
    "inputs": [
      {
        "name": "expected",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "actual",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "NoParametersForCustomPreset",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotLaunchOperator",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      },
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RegistryNotConfigured",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeCastOverflow",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "SeedProducesNoLiquidity",
    "inputs": []
  },
  {
    "type": "error",
    "name": "StartDelayTooLong",
    "inputs": [
      {
        "name": "blocks",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnexpectedHookBitmap",
    "inputs": [
      {
        "name": "expected",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "actual",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnexpectedNativeValue",
    "inputs": [
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnknownLaunch",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ]
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "event",
    "name": "HookListed",
    "inputs": [
      {
        "name": "hook",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "steward",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LaunchCreated",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "PoolId"
      },
      {
        "name": "launchToken",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "operator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "quoteToken",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "startBlock",
        "type": "uint48",
        "indexed": false,
        "internalType": "uint48"
      },
      {
        "name": "decayBlocks",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "initialFeeBips",
        "type": "uint24",
        "indexed": false,
        "internalType": "uint24"
      },
      {
        "name": "finalFeeBips",
        "type": "uint24",
        "indexed": false,
        "internalType": "uint24"
      },
      {
        "name": "maxBuyPerTx",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "launchTokenIsCurrency0",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "preset",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum Preset"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LaunchReconfigured",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "PoolId"
      },
      {
        "name": "operator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "startBlock",
        "type": "uint48",
        "indexed": false,
        "internalType": "uint48"
      },
      {
        "name": "decayBlocks",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "initialFeeBips",
        "type": "uint24",
        "indexed": false,
        "internalType": "uint24"
      },
      {
        "name": "finalFeeBips",
        "type": "uint24",
        "indexed": false,
        "internalType": "uint24"
      },
      {
        "name": "maxBuyPerTx",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "enabled",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LaunchSeeded",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "PoolId"
      },
      {
        "name": "positionTokenId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "positionRecipient",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "liquidity",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "amount0Spent",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "amount1Spent",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "function",
    "name": "EXPECTED_HOOK_BITMAP",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "blockTimeCentis",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "clPoolManager",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ICLPoolManager"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "computePoolKey",
    "inputs": [
      {
        "name": "launchToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "quoteToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "tickSpacing",
        "type": "int24",
        "internalType": "int24"
      }
    ],
    "outputs": [
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          },
          {
            "name": "poolManager",
            "type": "address",
            "internalType": "contract IPoolManager"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "parameters",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      },
      {
        "name": "launchTokenIsCurrency0",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "createLaunch",
    "inputs": [
      {
        "name": "p",
        "type": "tuple",
        "internalType": "struct LaunchParams",
        "components": [
          {
            "name": "launchToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "quoteToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "sqrtPriceX96",
            "type": "uint160",
            "internalType": "uint160"
          },
          {
            "name": "preset",
            "type": "uint8",
            "internalType": "enum Preset"
          },
          {
            "name": "initialFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "finalFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "decayBlocks",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "enabled",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "startDelaySeconds",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "maxBuyPerTx",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "launchOperator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "seed",
            "type": "tuple",
            "internalType": "struct SeedParams",
            "components": [
              {
                "name": "tickLower",
                "type": "int24",
                "internalType": "int24"
              },
              {
                "name": "tickUpper",
                "type": "int24",
                "internalType": "int24"
              },
              {
                "name": "launchTokenAmount",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "quoteTokenAmount",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "positionRecipient",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "deadline",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          },
          {
            "name": "listing",
            "type": "tuple",
            "internalType": "struct HookListingParams",
            "components": [
              {
                "name": "register",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "steward",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "metadata",
                "type": "tuple",
                "internalType": "struct LatchMetadata",
                "components": [
                  {
                    "name": "name",
                    "type": "string",
                    "internalType": "string"
                  },
                  {
                    "name": "description",
                    "type": "string",
                    "internalType": "string"
                  },
                  {
                    "name": "sourceURI",
                    "type": "string",
                    "internalType": "string"
                  },
                  {
                    "name": "auditURI",
                    "type": "string",
                    "internalType": "string"
                  },
                  {
                    "name": "chainIds",
                    "type": "uint256[]",
                    "internalType": "uint256[]"
                  }
                ]
              }
            ]
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "result",
        "type": "tuple",
        "internalType": "struct LaunchResult",
        "components": [
          {
            "name": "key",
            "type": "tuple",
            "internalType": "struct PoolKey",
            "components": [
              {
                "name": "currency0",
                "type": "address",
                "internalType": "Currency"
              },
              {
                "name": "currency1",
                "type": "address",
                "internalType": "Currency"
              },
              {
                "name": "hooks",
                "type": "address",
                "internalType": "contract IHooks"
              },
              {
                "name": "poolManager",
                "type": "address",
                "internalType": "contract IPoolManager"
              },
              {
                "name": "fee",
                "type": "uint24",
                "internalType": "uint24"
              },
              {
                "name": "parameters",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "poolId",
            "type": "bytes32",
            "internalType": "PoolId"
          },
          {
            "name": "startBlock",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "decayBlocks",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "positionTokenId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "liquiditySeeded",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "launchTokenIsCurrency0",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "getLaunchRecord",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct LaunchRecord",
        "components": [
          {
            "name": "operator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "launchTokenIsCurrency0",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "launchToken",
            "type": "address",
            "internalType": "address"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "hook",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract LaunchGuardHook"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "hookBitmap",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "listHook",
    "inputs": [
      {
        "name": "metadata",
        "type": "tuple",
        "internalType": "struct LatchMetadata",
        "components": [
          {
            "name": "name",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "description",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "sourceURI",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "auditURI",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "chainIds",
            "type": "uint256[]",
            "internalType": "uint256[]"
          }
        ]
      },
      {
        "name": "steward",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "listed",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "permit2",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IAllowanceTransfer"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "positionManager",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ICLPositionManager"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "previewSchedule",
    "inputs": [
      {
        "name": "p",
        "type": "tuple",
        "internalType": "struct LaunchParams",
        "components": [
          {
            "name": "launchToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "quoteToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "sqrtPriceX96",
            "type": "uint160",
            "internalType": "uint160"
          },
          {
            "name": "preset",
            "type": "uint8",
            "internalType": "enum Preset"
          },
          {
            "name": "initialFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "finalFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "decayBlocks",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "enabled",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "startDelaySeconds",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "maxBuyPerTx",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "launchOperator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "seed",
            "type": "tuple",
            "internalType": "struct SeedParams",
            "components": [
              {
                "name": "tickLower",
                "type": "int24",
                "internalType": "int24"
              },
              {
                "name": "tickUpper",
                "type": "int24",
                "internalType": "int24"
              },
              {
                "name": "launchTokenAmount",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "quoteTokenAmount",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "positionRecipient",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "deadline",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          },
          {
            "name": "listing",
            "type": "tuple",
            "internalType": "struct HookListingParams",
            "components": [
              {
                "name": "register",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "steward",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "metadata",
                "type": "tuple",
                "internalType": "struct LatchMetadata",
                "components": [
                  {
                    "name": "name",
                    "type": "string",
                    "internalType": "string"
                  },
                  {
                    "name": "description",
                    "type": "string",
                    "internalType": "string"
                  },
                  {
                    "name": "sourceURI",
                    "type": "string",
                    "internalType": "string"
                  },
                  {
                    "name": "auditURI",
                    "type": "string",
                    "internalType": "string"
                  },
                  {
                    "name": "chainIds",
                    "type": "uint256[]",
                    "internalType": "uint256[]"
                  }
                ]
              }
            ]
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "cfg",
        "type": "tuple",
        "internalType": "struct LaunchGuardHook.LaunchConfig",
        "components": [
          {
            "name": "startBlock",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "decayBlocks",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "initialFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "finalFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "maxBuyPerTx",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "launchTokenIsCurrency0",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "enabled",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "reconfigureLaunch",
    "inputs": [
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          },
          {
            "name": "poolManager",
            "type": "address",
            "internalType": "contract IPoolManager"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "parameters",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "cfg",
        "type": "tuple",
        "internalType": "struct LaunchGuardHook.LaunchConfig",
        "components": [
          {
            "name": "startBlock",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "decayBlocks",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "initialFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "finalFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "maxBuyPerTx",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "launchTokenIsCurrency0",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "enabled",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "registry",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IHookRegistryListing"
      }
    ],
    "stateMutability": "view"
  }
] as const satisfies Abi;

/**
 * `LaunchGuardHook` - the CL launch hook the kit drives.
 *
 * 18 errors, 3 events, 11 functions - curated from the compiled artifact, not the full ABI.
 */
export const LAUNCH_GUARD_HOOK_ABI = [
  {
    "type": "error",
    "name": "BuyExceedsMaxPerTx",
    "inputs": [
      {
        "name": "amountIn",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxBuyPerTx",
        "type": "uint128",
        "internalType": "uint128"
      }
    ]
  },
  {
    "type": "error",
    "name": "ExactOutputBuyBlockedDuringLaunch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "HookMismatch",
    "inputs": [
      {
        "name": "declared",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "HookNotImplemented",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidBlockTime",
    "inputs": [
      {
        "name": "blockTimeCentis",
        "type": "uint32",
        "internalType": "uint32"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidDecayBlocks",
    "inputs": [
      {
        "name": "decayBlocks",
        "type": "uint32",
        "internalType": "uint32"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidFeeSchedule",
    "inputs": [
      {
        "name": "initialFeeBips",
        "type": "uint24",
        "internalType": "uint24"
      },
      {
        "name": "finalFeeBips",
        "type": "uint24",
        "internalType": "uint24"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidStartBlock",
    "inputs": [
      {
        "name": "startBlock",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "currentBlock",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "LaunchAlreadyStarted",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      },
      {
        "name": "startBlock",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "LaunchNotConfigured",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ]
  },
  {
    "type": "error",
    "name": "LaunchWindowOutOfRange",
    "inputs": [
      {
        "name": "realSeconds",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minSeconds",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxSeconds",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotLaunchOwner",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      },
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotPoolManager",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PermissionDependencyMissing",
    "inputs": [
      {
        "name": "declared",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "PoolManagerMismatch",
    "inputs": [
      {
        "name": "declared",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "PoolMustUseDynamicFee",
    "inputs": [
      {
        "name": "fee",
        "type": "uint24",
        "internalType": "uint24"
      }
    ]
  },
  {
    "type": "error",
    "name": "ReservedBitsSet",
    "inputs": [
      {
        "name": "declared",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "TradingNotOpen",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      },
      {
        "name": "startBlock",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "currentBlock",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "event",
    "name": "LaunchClaimed",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "PoolId"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LaunchConfigured",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "PoolId"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "startBlock",
        "type": "uint48",
        "indexed": false,
        "internalType": "uint48"
      },
      {
        "name": "decayBlocks",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "initialFeeBips",
        "type": "uint24",
        "indexed": false,
        "internalType": "uint24"
      },
      {
        "name": "finalFeeBips",
        "type": "uint24",
        "indexed": false,
        "internalType": "uint24"
      },
      {
        "name": "maxBuyPerTx",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "launchTokenIsCurrency0",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "enabled",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LaunchStarted",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "PoolId"
      },
      {
        "name": "blockNumber",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "function",
    "name": "MAX_DECAY_BLOCKS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_FINAL_FEE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint24",
        "internalType": "uint24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_INITIAL_FEE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint24",
        "internalType": "uint24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_START_DELAY",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint48",
        "internalType": "uint48"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "configureLaunch",
    "inputs": [
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          },
          {
            "name": "poolManager",
            "type": "address",
            "internalType": "contract IPoolManager"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "parameters",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "cfg",
        "type": "tuple",
        "internalType": "struct LaunchGuardHook.LaunchConfig",
        "components": [
          {
            "name": "startBlock",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "decayBlocks",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "initialFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "finalFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "maxBuyPerTx",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "launchTokenIsCurrency0",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "enabled",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "currentFee",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint24",
        "internalType": "uint24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "feeAt",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      },
      {
        "name": "blockNumber",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint24",
        "internalType": "uint24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getHooksRegistrationBitmap",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "getLaunch",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct LaunchGuardHook.Launch",
        "components": [
          {
            "name": "owner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "startBlock",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "decayBlocks",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "enabled",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "initialFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "finalFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "maxBuyPerTx",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "launchTokenIsCurrency0",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "launched",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "launchOwner",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "poolManager",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ICLPoolManager"
      }
    ],
    "stateMutability": "view"
  }
] as const satisfies Abi;

/**
 * `BinLaunchGuardHook` - the liquidity-book variant, including `beforeMint`.
 *
 * 18 errors, 3 events, 11 functions - curated from the compiled artifact, not the full ABI.
 */
export const BIN_LAUNCH_GUARD_HOOK_ABI = [
  {
    "type": "error",
    "name": "BuyExceedsMaxPerTx",
    "inputs": [
      {
        "name": "amountIn",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxBuyPerTx",
        "type": "uint128",
        "internalType": "uint128"
      }
    ]
  },
  {
    "type": "error",
    "name": "ExactOutputBuyBlockedDuringLaunch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "HookMismatch",
    "inputs": [
      {
        "name": "declared",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "HookNotImplemented",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidBlockTime",
    "inputs": [
      {
        "name": "blockTimeCentis",
        "type": "uint32",
        "internalType": "uint32"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidDecayBlocks",
    "inputs": [
      {
        "name": "decayBlocks",
        "type": "uint32",
        "internalType": "uint32"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidFeeSchedule",
    "inputs": [
      {
        "name": "initialFeeBips",
        "type": "uint24",
        "internalType": "uint24"
      },
      {
        "name": "finalFeeBips",
        "type": "uint24",
        "internalType": "uint24"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidStartBlock",
    "inputs": [
      {
        "name": "startBlock",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "currentBlock",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "LaunchAlreadyStarted",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      },
      {
        "name": "startBlock",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "LaunchNotConfigured",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ]
  },
  {
    "type": "error",
    "name": "LaunchWindowOutOfRange",
    "inputs": [
      {
        "name": "realSeconds",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minSeconds",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxSeconds",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotLaunchOwner",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      },
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotPoolManager",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PermissionDependencyMissing",
    "inputs": [
      {
        "name": "declared",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "PoolManagerMismatch",
    "inputs": [
      {
        "name": "declared",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "PoolMustUseDynamicFee",
    "inputs": [
      {
        "name": "fee",
        "type": "uint24",
        "internalType": "uint24"
      }
    ]
  },
  {
    "type": "error",
    "name": "ReservedBitsSet",
    "inputs": [
      {
        "name": "declared",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "TradingNotOpen",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      },
      {
        "name": "startBlock",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "currentBlock",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "event",
    "name": "LaunchClaimed",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "PoolId"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LaunchConfigured",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "PoolId"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "startBlock",
        "type": "uint48",
        "indexed": false,
        "internalType": "uint48"
      },
      {
        "name": "decayBlocks",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "initialFeeBips",
        "type": "uint24",
        "indexed": false,
        "internalType": "uint24"
      },
      {
        "name": "finalFeeBips",
        "type": "uint24",
        "indexed": false,
        "internalType": "uint24"
      },
      {
        "name": "maxBuyPerTx",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "launchTokenIsCurrency0",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "enabled",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LaunchStarted",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "PoolId"
      },
      {
        "name": "blockNumber",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "function",
    "name": "MAX_DECAY_BLOCKS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_FINAL_FEE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint24",
        "internalType": "uint24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_INITIAL_FEE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint24",
        "internalType": "uint24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_START_DELAY",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint48",
        "internalType": "uint48"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "configureLaunch",
    "inputs": [
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          },
          {
            "name": "poolManager",
            "type": "address",
            "internalType": "contract IPoolManager"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "parameters",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "cfg",
        "type": "tuple",
        "internalType": "struct BinLaunchGuardHook.LaunchConfig",
        "components": [
          {
            "name": "startBlock",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "decayBlocks",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "initialFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "finalFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "maxBuyPerTx",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "launchTokenIsCurrency0",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "enabled",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "currentFee",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint24",
        "internalType": "uint24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "feeAt",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      },
      {
        "name": "blockNumber",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint24",
        "internalType": "uint24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getHooksRegistrationBitmap",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "getLaunch",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct BinLaunchGuardHook.Launch",
        "components": [
          {
            "name": "owner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "startBlock",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "decayBlocks",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "enabled",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "initialFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "finalFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "maxBuyPerTx",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "launchTokenIsCurrency0",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "launched",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "launchOwner",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "poolManager",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IBinPoolManager"
      }
    ],
    "stateMutability": "view"
  }
] as const satisfies Abi;
