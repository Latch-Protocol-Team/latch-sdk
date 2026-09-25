// SPDX-License-Identifier: MIT
// -----------------------------------------------------------------------------
// GENERATED FILE - DO NOT EDIT BY HAND.
// Produced by scripts/generate-trading-abi.mjs from the compiled contract ABIs.
// Re-run `npm run generate` after the contracts are rebuilt.
// -----------------------------------------------------------------------------

import type { Abi } from "viem";

/**
 * `UniversalRouter` — the swap entrypoint. Two `execute` overloads and the full error surface, which is what turns a failed swap into a diagnosable one.
 *
 * 44 errors, 2 events, 6 functions - curated from the compiled artifact, not the full ABI.
 */
export const UNIVERSAL_ROUTER_ABI = [
  {
    "type": "error",
    "name": "BalanceTooLow",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ContractLocked",
    "inputs": []
  },
  {
    "type": "error",
    "name": "DeltaNotNegative",
    "inputs": [
      {
        "name": "currency",
        "type": "address",
        "internalType": "Currency"
      }
    ]
  },
  {
    "type": "error",
    "name": "DeltaNotPositive",
    "inputs": [
      {
        "name": "currency",
        "type": "address",
        "internalType": "Currency"
      }
    ]
  },
  {
    "type": "error",
    "name": "ETHNotAccepted",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EnforcedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ExactOutputUnfilled",
    "inputs": [
      {
        "name": "amountOutRequested",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amountOutReceived",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ExecutionFailed",
    "inputs": [
      {
        "name": "commandIndex",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "message",
        "type": "bytes",
        "internalType": "bytes"
      }
    ]
  },
  {
    "type": "error",
    "name": "ExpectedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "FromAddressIsNotOwner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InputLengthMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InsufficientBalance",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InsufficientETH",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InsufficientToken",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidBips",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidCommandType",
    "inputs": [
      {
        "name": "commandType",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidEthSender",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidPath",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidPoolAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidPoolLength",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidReserves",
    "inputs": []
  },
  {
    "type": "error",
    "name": "LengthMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotVault",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OwnableInvalidOwner",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "OwnableUnauthorizedAccount",
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
    "name": "SafeCastOverflow",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SliceOutOfBounds",
    "inputs": []
  },
  {
    "type": "error",
    "name": "StableInvalidAmountIn",
    "inputs": []
  },
  {
    "type": "error",
    "name": "StableInvalidPath",
    "inputs": []
  },
  {
    "type": "error",
    "name": "StableTooLittleReceived",
    "inputs": []
  },
  {
    "type": "error",
    "name": "StableTooMuchRequested",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TooLittleReceived",
    "inputs": [
      {
        "name": "minAmountOutReceived",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amountReceived",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "TooMuchRequested",
    "inputs": [
      {
        "name": "maxAmountInRequested",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amountRequested",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "TransactionDeadlinePassed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnsafeCast",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnsupportedAction",
    "inputs": [
      {
        "name": "action",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "V2InvalidPath",
    "inputs": []
  },
  {
    "type": "error",
    "name": "V2TooLittleReceived",
    "inputs": []
  },
  {
    "type": "error",
    "name": "V2TooMuchRequested",
    "inputs": []
  },
  {
    "type": "error",
    "name": "V3InvalidAmountOut",
    "inputs": []
  },
  {
    "type": "error",
    "name": "V3InvalidCaller",
    "inputs": []
  },
  {
    "type": "error",
    "name": "V3InvalidSwap",
    "inputs": []
  },
  {
    "type": "error",
    "name": "V3TooLittleReceived",
    "inputs": []
  },
  {
    "type": "error",
    "name": "V3TooMuchRequested",
    "inputs": []
  },
  {
    "type": "event",
    "name": "Paused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Unpaused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "function",
    "name": "binPoolManager",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IBinPoolManager"
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
    "name": "execute",
    "inputs": [
      {
        "name": "commands",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "inputs",
        "type": "bytes[]",
        "internalType": "bytes[]"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "execute",
    "inputs": [
      {
        "name": "commands",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "inputs",
        "type": "bytes[]",
        "internalType": "bytes[]"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "paused",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "vault",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IVault"
      }
    ],
    "stateMutability": "view"
  }
] as const satisfies Abi;

/**
 * `CLQuoter` — simulated swap output. Every function here REVERTS with the answer encoded in the revert data, so these are `eth_call`-only and cost gas if sent.
 *
 * 6 errors, 7 functions - curated from the compiled artifact, not the full ABI.
 */
export const CL_QUOTER_ABI = [
  {
    "type": "error",
    "name": "NotEnoughLiquidity",
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
    "name": "NotSelf",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotVault",
    "inputs": []
  },
  {
    "type": "error",
    "name": "QuoteSwap",
    "inputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnexpectedCallSuccess",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnexpectedRevertBytes",
    "inputs": [
      {
        "name": "revertData",
        "type": "bytes",
        "internalType": "bytes"
      }
    ]
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
  },
  {
    "type": "function",
    "name": "quoteExactInput",
    "inputs": [
      {
        "name": "params",
        "type": "tuple",
        "internalType": "struct IQuoter.QuoteExactParams",
        "components": [
          {
            "name": "exactCurrency",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "path",
            "type": "tuple[]",
            "internalType": "struct PathKey[]",
            "components": [
              {
                "name": "intermediateCurrency",
                "type": "address",
                "internalType": "Currency"
              },
              {
                "name": "fee",
                "type": "uint24",
                "internalType": "uint24"
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
                "name": "hookData",
                "type": "bytes",
                "internalType": "bytes"
              },
              {
                "name": "parameters",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "exactAmount",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "amountOut",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "gasEstimate",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "quoteExactInputSingle",
    "inputs": [
      {
        "name": "params",
        "type": "tuple",
        "internalType": "struct IQuoter.QuoteExactSingleParams",
        "components": [
          {
            "name": "poolKey",
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
            "name": "zeroForOne",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "exactAmount",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "hookData",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "amountOut",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "gasEstimate",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "quoteExactInputSingleList",
    "inputs": [
      {
        "name": "params",
        "type": "tuple[]",
        "internalType": "struct IQuoter.QuoteExactSingleParams[]",
        "components": [
          {
            "name": "poolKey",
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
            "name": "zeroForOne",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "exactAmount",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "hookData",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "amountIn",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "gasEstimate",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "quoteExactOutput",
    "inputs": [
      {
        "name": "params",
        "type": "tuple",
        "internalType": "struct IQuoter.QuoteExactParams",
        "components": [
          {
            "name": "exactCurrency",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "path",
            "type": "tuple[]",
            "internalType": "struct PathKey[]",
            "components": [
              {
                "name": "intermediateCurrency",
                "type": "address",
                "internalType": "Currency"
              },
              {
                "name": "fee",
                "type": "uint24",
                "internalType": "uint24"
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
                "name": "hookData",
                "type": "bytes",
                "internalType": "bytes"
              },
              {
                "name": "parameters",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "exactAmount",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "amountIn",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "gasEstimate",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "quoteExactOutputSingle",
    "inputs": [
      {
        "name": "params",
        "type": "tuple",
        "internalType": "struct IQuoter.QuoteExactSingleParams",
        "components": [
          {
            "name": "poolKey",
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
            "name": "zeroForOne",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "exactAmount",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "hookData",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "amountIn",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "gasEstimate",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "vault",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IVault"
      }
    ],
    "stateMutability": "view"
  }
] as const satisfies Abi;

/**
 * `BinQuoter` — simulated swap output for liquidity-book pools. Same `QuoteExactSingleParams` shape as the CL quoter (`zeroForOne` is `swapForY`), same revert-with-the-answer mechanics: `eth_call`-only.
 *
 * 6 errors, 7 functions - curated from the compiled artifact, not the full ABI.
 */
export const BIN_QUOTER_ABI = [
  {
    "type": "error",
    "name": "NotEnoughLiquidity",
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
    "name": "NotSelf",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotVault",
    "inputs": []
  },
  {
    "type": "error",
    "name": "QuoteSwap",
    "inputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnexpectedCallSuccess",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnexpectedRevertBytes",
    "inputs": [
      {
        "name": "revertData",
        "type": "bytes",
        "internalType": "bytes"
      }
    ]
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
  },
  {
    "type": "function",
    "name": "quoteExactInput",
    "inputs": [
      {
        "name": "params",
        "type": "tuple",
        "internalType": "struct IQuoter.QuoteExactParams",
        "components": [
          {
            "name": "exactCurrency",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "path",
            "type": "tuple[]",
            "internalType": "struct PathKey[]",
            "components": [
              {
                "name": "intermediateCurrency",
                "type": "address",
                "internalType": "Currency"
              },
              {
                "name": "fee",
                "type": "uint24",
                "internalType": "uint24"
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
                "name": "hookData",
                "type": "bytes",
                "internalType": "bytes"
              },
              {
                "name": "parameters",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "exactAmount",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "amountOut",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "gasEstimate",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "quoteExactInputSingle",
    "inputs": [
      {
        "name": "params",
        "type": "tuple",
        "internalType": "struct IQuoter.QuoteExactSingleParams",
        "components": [
          {
            "name": "poolKey",
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
            "name": "zeroForOne",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "exactAmount",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "hookData",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "amountOut",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "gasEstimate",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "quoteExactInputSingleList",
    "inputs": [
      {
        "name": "params",
        "type": "tuple[]",
        "internalType": "struct IQuoter.QuoteExactSingleParams[]",
        "components": [
          {
            "name": "poolKey",
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
            "name": "zeroForOne",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "exactAmount",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "hookData",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "amountIn",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "gasEstimate",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "quoteExactOutput",
    "inputs": [
      {
        "name": "params",
        "type": "tuple",
        "internalType": "struct IQuoter.QuoteExactParams",
        "components": [
          {
            "name": "exactCurrency",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "path",
            "type": "tuple[]",
            "internalType": "struct PathKey[]",
            "components": [
              {
                "name": "intermediateCurrency",
                "type": "address",
                "internalType": "Currency"
              },
              {
                "name": "fee",
                "type": "uint24",
                "internalType": "uint24"
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
                "name": "hookData",
                "type": "bytes",
                "internalType": "bytes"
              },
              {
                "name": "parameters",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "exactAmount",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "amountIn",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "gasEstimate",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "quoteExactOutputSingle",
    "inputs": [
      {
        "name": "params",
        "type": "tuple",
        "internalType": "struct IQuoter.QuoteExactSingleParams",
        "components": [
          {
            "name": "poolKey",
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
            "name": "zeroForOne",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "exactAmount",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "hookData",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "amountIn",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "gasEstimate",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "vault",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IVault"
      }
    ],
    "stateMutability": "view"
  }
] as const satisfies Abi;

/**
 * `CLPositionManager` — liquidity positions as ERC-721. `modifyLiquidities` takes an encoded action plan, not named arguments; the reads below are what a portfolio screen needs.
 *
 * 31 errors, 5 events, 21 functions - curated from the compiled artifact, not the full ABI.
 */
export const CL_POSITION_MANAGER_ABI = [
  {
    "type": "error",
    "name": "AlreadySubscribed",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "subscriber",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "BurnNotificationReverted",
    "inputs": [
      {
        "name": "subscriber",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "reason",
        "type": "bytes",
        "internalType": "bytes"
      }
    ]
  },
  {
    "type": "error",
    "name": "ContractLocked",
    "inputs": []
  },
  {
    "type": "error",
    "name": "DeadlinePassed",
    "inputs": [
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "DeltaNotNegative",
    "inputs": [
      {
        "name": "currency",
        "type": "address",
        "internalType": "Currency"
      }
    ]
  },
  {
    "type": "error",
    "name": "DeltaNotPositive",
    "inputs": [
      {
        "name": "currency",
        "type": "address",
        "internalType": "Currency"
      }
    ]
  },
  {
    "type": "error",
    "name": "GasLimitTooLow",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InputLengthMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InsufficientBalance",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidContractSignature",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidEthSender",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidSignature",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidSignatureLength",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidSigner",
    "inputs": []
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
    "name": "InvalidTokenID",
    "inputs": []
  },
  {
    "type": "error",
    "name": "MaximumAmountExceeded",
    "inputs": [
      {
        "name": "maximumAmount",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "amountRequested",
        "type": "uint128",
        "internalType": "uint128"
      }
    ]
  },
  {
    "type": "error",
    "name": "MinimumAmountInsufficient",
    "inputs": [
      {
        "name": "minimumAmount",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "amountReceived",
        "type": "uint128",
        "internalType": "uint128"
      }
    ]
  },
  {
    "type": "error",
    "name": "ModifyLiquidityNotificationReverted",
    "inputs": [
      {
        "name": "subscriber",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "reason",
        "type": "bytes",
        "internalType": "bytes"
      }
    ]
  },
  {
    "type": "error",
    "name": "NoCodeSubscriber",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoSelfPermit",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NonceAlreadyUsed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotApproved",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotSubscribed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotVault",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeCastOverflow",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SignatureDeadlineExpired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SubscriptionReverted",
    "inputs": [
      {
        "name": "subscriber",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "reason",
        "type": "bytes",
        "internalType": "bytes"
      }
    ]
  },
  {
    "type": "error",
    "name": "Unauthorized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnsupportedAction",
    "inputs": [
      {
        "name": "action",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "VaultMustBeUnlocked",
    "inputs": []
  },
  {
    "type": "event",
    "name": "Approval",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "spender",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "id",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ApprovalForAll",
    "inputs": [
      {
        "name": "owner",
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
        "name": "approved",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "MintPosition",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ModifyLiquidity",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "liquidityChange",
        "type": "int256",
        "indexed": false,
        "internalType": "int256"
      },
      {
        "name": "feesAccrued",
        "type": "int256",
        "indexed": false,
        "internalType": "BalanceDelta"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Transfer",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "id",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "function",
    "name": "WETH9",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IWETH9"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "approve",
    "inputs": [
      {
        "name": "spender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "balanceOf",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
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
    "name": "getApproved",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
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
    "name": "getPoolAndPositionInfo",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "poolKey",
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
        "name": "info",
        "type": "uint256",
        "internalType": "CLPositionInfo"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPositionLiquidity",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "liquidity",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "initializePool",
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
        "name": "sqrtPriceX96",
        "type": "uint160",
        "internalType": "uint160"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "int24",
        "internalType": "int24"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "isApprovedForAll",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "modifyLiquidities",
    "inputs": [
      {
        "name": "payload",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "modifyLiquiditiesWithoutLock",
    "inputs": [
      {
        "name": "actions",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "params",
        "type": "bytes[]",
        "internalType": "bytes[]"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "nextTokenId",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ownerOf",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
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
    "name": "poolKeys",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes25",
        "internalType": "bytes25"
      }
    ],
    "outputs": [
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
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "positionInfo",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "info",
        "type": "uint256",
        "internalType": "CLPositionInfo"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "positions",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "poolKey",
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
        "name": "liquidity",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "feeGrowthInside0LastX128",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "feeGrowthInside1LastX128",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_subscriber",
        "type": "address",
        "internalType": "contract ICLSubscriber"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "setApprovalForAll",
    "inputs": [
      {
        "name": "operator",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "approved",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "tokenURI",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "transferFrom",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "vault",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IVault"
      }
    ],
    "stateMutability": "view"
  }
] as const satisfies Abi;

/**
 * `BinPositionManager` — liquidity-book positions as per-bin fungible shares (ERC-1155-like, no `uri` and no receiver callback). `modifyLiquidities` takes the same encoded action plan; `initializePool` opens a pool at a bin id; the reads are what a positions screen needs.
 *
 * 24 errors, 2 events, 14 functions - curated from the compiled artifact, not the full ABI.
 */
export const BIN_POSITION_MANAGER_ABI = [
  {
    "type": "error",
    "name": "AddLiquidityInputActiveIdMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BinFungibleToken_AddressThisOrZero",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BinFungibleToken_BurnExceedsBalance",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "BinFungibleToken_InvalidLength",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BinFungibleToken_SelfApproval",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "BinFungibleToken_SpenderNotApproved",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "spender",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "BinFungibleToken_TransferExceedsBalance",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ContractLocked",
    "inputs": []
  },
  {
    "type": "error",
    "name": "DeadlinePassed",
    "inputs": [
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "DeltaNotNegative",
    "inputs": [
      {
        "name": "currency",
        "type": "address",
        "internalType": "Currency"
      }
    ]
  },
  {
    "type": "error",
    "name": "DeltaNotPositive",
    "inputs": [
      {
        "name": "currency",
        "type": "address",
        "internalType": "Currency"
      }
    ]
  },
  {
    "type": "error",
    "name": "IdOverflows",
    "inputs": [
      {
        "name": "",
        "type": "int256",
        "internalType": "int256"
      }
    ]
  },
  {
    "type": "error",
    "name": "IdSlippageCaught",
    "inputs": [
      {
        "name": "activeIdDesired",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "idSlippage",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "activeId",
        "type": "uint24",
        "internalType": "uint24"
      }
    ]
  },
  {
    "type": "error",
    "name": "InputLengthMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InsufficientBalance",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidEthSender",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidTokenID",
    "inputs": []
  },
  {
    "type": "error",
    "name": "LiquiditySlippageCaught",
    "inputs": [
      {
        "name": "binId",
        "type": "uint24",
        "internalType": "uint24"
      },
      {
        "name": "minLiquidity",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "liquidityMinted",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaximumAmountExceeded",
    "inputs": [
      {
        "name": "maximumAmount",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "amountRequested",
        "type": "uint128",
        "internalType": "uint128"
      }
    ]
  },
  {
    "type": "error",
    "name": "MinimumAmountInsufficient",
    "inputs": [
      {
        "name": "minimumAmount",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "amountReceived",
        "type": "uint128",
        "internalType": "uint128"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotVault",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeCastOverflow",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnsupportedAction",
    "inputs": [
      {
        "name": "action",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "VaultMustBeUnlocked",
    "inputs": []
  },
  {
    "type": "event",
    "name": "ApprovalForAll",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "sender",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "approved",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TransferBatch",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "from",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "ids",
        "type": "uint256[]",
        "indexed": false,
        "internalType": "uint256[]"
      },
      {
        "name": "amounts",
        "type": "uint256[]",
        "indexed": false,
        "internalType": "uint256[]"
      }
    ],
    "anonymous": false
  },
  {
    "type": "function",
    "name": "WETH9",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IWETH9"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "approveForAll",
    "inputs": [
      {
        "name": "operator",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "approved",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "balanceOf",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "balanceOfBatch",
    "inputs": [
      {
        "name": "owners",
        "type": "address[]",
        "internalType": "address[]"
      },
      {
        "name": "ids",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "outputs": [
      {
        "name": "balances",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "batchTransferFrom",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "ids",
        "type": "uint256[]",
        "internalType": "uint256[]"
      },
      {
        "name": "amounts",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "binPoolManager",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IBinPoolManager"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "initializePool",
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
        "name": "activeId",
        "type": "uint24",
        "internalType": "uint24"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "isApprovedForAll",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "modifyLiquidities",
    "inputs": [
      {
        "name": "payload",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "modifyLiquiditiesWithoutLock",
    "inputs": [
      {
        "name": "actions",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "params",
        "type": "bytes[]",
        "internalType": "bytes[]"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
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
    "name": "positions",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
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
        "name": "",
        "type": "uint24",
        "internalType": "uint24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalSupply",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "vault",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IVault"
      }
    ],
    "stateMutability": "view"
  }
] as const satisfies Abi;
