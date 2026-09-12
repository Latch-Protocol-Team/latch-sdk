<p align="center">
  <a href="https://latch.guru">
    <img src="https://raw.githubusercontent.com/Latch-Protocol-Team/latch-sdk/main/assets/og.png"
         alt="Latch Protocol — hooks for a bigger ecosystem" width="640">
  </a>
</p>

<p align="center">
  <a href="https://latch.guru">Website</a> ·
  <a href="https://www.npmjs.com/package/@latchprotocol/sdk">npm</a> ·
  <a href="https://github.com/Latch-Protocol-Team">GitHub</a> ·
  <a href="https://x.com/Ox_Forged">Developer on X</a>
</p>

# @latchprotocol/sdk

TypeScript SDK for **LatchProtocol** — a singleton AMM with hooks, deployed on chains where Uniswap v4 is not.

The SDK gives you the protocol's domain types (pool keys, pool ids, currencies, balance deltas, fees), first-class helpers for the **hook permission bitmap**, typed definitions for every event the contracts emit, and an indexer data model for analytics.

---

## Licensing, and why it matters

The Solidity core is **GPL-2.0-or-later**. That licence is viral: code that links against it can inherit the obligation. If building a hook required importing GPL sources, every third-party hook would arguably become a derivative work.

**This package is the firewall.** It is MIT-licensed and independently authored:

- No Solidity source, comment or NatSpec from `packages/core` is copied into it.
- Types are derived from the **compiled ABI JSON** — a machine-generated description of selectors, argument names and argument types — by the generator in `scripts/generate-events.mjs`.
- All prose, naming and structure here are original.

You can build a hook, an indexer or a front end on this SDK under MIT terms. Deploying against the on-chain contracts is not the same as linking their source; nothing in this package requires you to open your hook.

---

## Install

```bash
npm install @latchprotocol/sdk
# or
pnpm add @latchprotocol/sdk
```

`viem` is the only runtime dependency (used for `Address`/`Hex` types, ABI encoding and `keccak256`).

Requires Node 20+ and TypeScript 5.x. The package is ESM-only with `"strict": true` type definitions.

---

## Deployed addresses

Every deployed Latch contract ships with the package. You should never have to hand-type one.

```ts
import { LATCH_DEPLOYMENTS, getDeployment, tokenBySymbol } from "@latchprotocol/sdk";
// or, tree-shaking only this:
// import { ... } from "@latchprotocol/sdk/deployments";

const latch = LATCH_DEPLOYMENTS[4663];      // Robinhood Chain
latch.vault;                                 // 0x78e8359c6D34Df797b8A793dE8c7c6bffA97fB6c
latch.clPoolManager;
latch.universalRouter;
latch.deployedAtBlock;                       // start log scans here, not at genesis

getDeployment(999);                          // undefined — Latch is not on HyperEVM
```

| Chain | id | Status |
| --- | --- | --- |
| Robinhood Chain | `4663` | mainnet, 18 contracts verified on Sourcify |
| Ethereum Sepolia | `11155111` | testnet |

**`null` means not deployed. It is never the zero address.** A contract Latch has not shipped on a
chain — the launchpad contracts on Sepolia, the pool-manager owner wrappers there — reads `null`,
so the compiler makes you handle it. (The launchpad IS deployed on Robinhood as of 2026-09-12;
this example is about the shape, not that chain.) A zero
address would not: it is a value `readContract` accepts and answers with silence.

```ts
if (latch.launchpadKit === null) {
  // render "not configured on this chain", do not substitute an address
}
requireContract(latch, "launchpadKit"); // or throw a sentence that names the chain
```

**Tokens carry their decimals**, because `sqrtPriceX96` encodes a price as a ratio of *raw* units.
USDG is 6 decimals on Robinhood and WETH is 18; assuming 18 for both misprices a pool by 10¹², and
that price is fixed permanently at `initialize`.

```ts
tokenBySymbol(4663, "USDG");  // { decimals: 6, ... }
```

**Some of these addresses move.** `REDEPLOYABLE_CONTRACTS` names the ones that do — the registry,
the RevShareHook, the timelocks, the fee controller and the launchpad contracts. Their stale
failure mode is silent: a retired `LatchRegistry` still answers `latchCount()` and renders as a
healthy, empty marketplace. Read them from this module at call time rather than snapshotting them
into a build. The `Vault` is immutable and will not move.

An address book is a claim, not a proof. Verify with `eth_getCode` before you rely on one.

---

## The differentiator: permissions live in the pool key, not the address

In Uniswap v4, a hook's permissions are read from the **address** of the hook contract. Each callback is a bit of the address, so shipping a hook means grinding a CREATE2 salt until the deployed address happens to carry the right low bits. Change your mind about one callback and you redeploy at a new address.

LatchProtocol takes permissions out of the address entirely. They live in the **low 16 bits of `poolKey.parameters`**, and the pool manager cross-checks that word against the hook's own `getHooksRegistrationBitmap()` view when the pool is initialized.

Consequences you can rely on:

- **No vanity-salt mining.** Deploy your hook at whatever address CREATE gives you.
- **One hook, many permission sets.** The same deployed contract can back several pools with different bitmaps, provided it reports the bitmap each pool key declares.
- **The bitmap is part of the pool identity.** It is hashed into the pool id, so flipping one bit yields a different pool.

### Bitmap layout

| Bit | Concentrated liquidity (CL)        | Liquidity book (bin)     |
| --- | ---------------------------------- | ------------------------ |
| 0   | `beforeInitialize`                 | `beforeInitialize`       |
| 1   | `afterInitialize`                  | `afterInitialize`        |
| 2   | `beforeAddLiquidity`               | `beforeMint`             |
| 3   | `afterAddLiquidity`                | `afterMint`              |
| 4   | `beforeRemoveLiquidity`            | `beforeBurn`             |
| 5   | `afterRemoveLiquidity`             | `afterBurn`              |
| 6   | `beforeSwap`                       | `beforeSwap`             |
| 7   | `afterSwap`                        | `afterSwap`              |
| 8   | `beforeDonate`                     | `beforeDonate`           |
| 9   | `afterDonate`                      | `afterDonate`            |
| 10  | `beforeSwapReturnsDelta`           | `beforeSwapReturnsDelta` |
| 11  | `afterSwapReturnsDelta`            | `afterSwapReturnsDelta`  |
| 12  | `afterAddLiquidityReturnsDelta`    | `afterMintReturnsDelta`  |
| 13  | `afterRemoveLiquidityReturnsDelta` | `afterBurnReturnsDelta`  |

Bits 14 and 15 are unassigned and must be zero. Both pool types share every offset; only the names of bits 2–5, 12 and 13 differ.

The rest of the `parameters` word carries pool-type configuration:

```text
bits [ 0 .. 15]  hook registration bitmap (uint16)   - both pool types
bits [16 .. 39]  tickSpacing (int24)                 - concentrated liquidity
bits [16 .. 31]  binStep (uint16)                    - liquidity book
bits above       unused, must be zero
```

### Two rules the pool manager enforces

1. **Dependencies.** A `*ReturnsDelta` flag is only valid alongside its base callback — `beforeSwapReturnsDelta` (10) needs `beforeSwap` (6), `afterSwapReturnsDelta` (11) needs `afterSwap` (7), bit 12 needs bit 3, bit 13 needs bit 5. Otherwise the manager would never call the hook and the delta could never be produced.
2. **Hookless pools.** A pool key with no hook (`hooks == address(0)`) must carry an all-zero bitmap **and** a static fee. A dynamic fee needs a hook to supply it.

Both are checked locally by `validateHookConfig`, so a misconfiguration surfaces before you spend gas.

---

## Usage

### Build a permission bitmap

```ts
import {
  encodeCLHookPermissions,
  decodeCLHookPermissions,
  validateHookRegistrationBitmap,
  formatHookPermissions,
} from "@latchprotocol/sdk";

const bitmap = encodeCLHookPermissions({
  beforeSwap: true,
  afterSwap: true,
  beforeSwapReturnsDelta: true,
});

bitmap;                                   // 0x04c0
formatHookPermissions("CL", bitmap);      // "0x04c0 (beforeSwap, afterSwap, beforeSwapReturnsDelta)"
decodeCLHookPermissions(bitmap).afterSwap; // true

validateHookRegistrationBitmap("CL", bitmap).valid; // true

// A returns-delta flag without its base callback is rejected:
validateHookRegistrationBitmap(
  "CL",
  encodeCLHookPermissions({ afterSwapReturnsDelta: true }),
);
// { valid: false, issues: [{ code: "MISSING_DEPENDENCY", message: "afterSwapReturnsDelta (bit 11) requires afterSwap (bit 7)" }] }
```

Return this value from your hook's `getHooksRegistrationBitmap()`:

```solidity
function getHooksRegistrationBitmap() external pure returns (uint16) {
    return 0x04c0;
}
```

### Build a pool key and derive its id

```ts
import { createCLPoolKey, poolKeyToId, DYNAMIC_FEE_FLAG } from "@latchprotocol/sdk";

const key = createCLPoolKey({
  currency0: "0x0000000000000000000000000000000000000000", // native
  currency1: "0xA0b8...",
  hooks: "0x1234...",
  poolManager: CL_POOL_MANAGER_ADDRESS,
  fee: DYNAMIC_FEE_FLAG,      // the hook supplies the LP fee
  tickSpacing: 60,
  hooksRegistrationBitmap: bitmap,
});

key.parameters;    // 0x...3c04c0  — tickSpacing 60 above the bitmap
poolKeyToId(key);  // 0x1667...e350
```

`createCLPoolKey` validates that currencies are sorted and the fee is in range. Use `createBinPoolKey` with `binStep` for liquidity-book pools, and `sortCurrencies` if your inputs may be out of order.

### Check a hook configuration against the chain

```ts
import { validateHookConfig } from "@latchprotocol/sdk";
import { createPublicClient, http } from "viem";

const client = createPublicClient({ transport: http(RPC_URL) });

const onChainBitmap = await client.readContract({
  address: key.hooks,
  abi: [
    {
      type: "function",
      name: "getHooksRegistrationBitmap",
      stateMutability: "view",
      inputs: [],
      outputs: [{ type: "uint16" }],
    },
  ],
  functionName: "getHooksRegistrationBitmap",
});

const result = validateHookConfig({
  poolType: "CL",
  hooks: key.hooks,
  fee: key.fee,
  parameters: key.parameters,
  onChainBitmap,
});

if (!result.valid) throw new Error(result.issues.map((i) => i.message).join("; "));
```

### Work with typed events

```ts
import {
  EVENT_DESCRIPTORS,
  EVENT_TOPICS,
  descriptorsForTopic,
  decodeProtocolLog,
  type CLPoolManagerSwapArgs,
} from "@latchprotocol/sdk/events";

EVENT_TOPICS.CL_POOL_MANAGER_SWAP;        // topic0 for CLPoolManager.Swap
descriptorsForTopic(log.topics[0]);        // which contracts declare this event

const decoded = decodeProtocolLog("CLPoolManager", log);
if (decoded?.eventName === "Swap") {
  const args = decoded.args as unknown as CLPoolManagerSwapArgs;
  args.amount0; // bigint
  args.tick;    // number (int24 fits in a JS number)
}
```

Every event carries a generated argument interface (`VaultTransferArgs`, `BinPoolManagerMintArgs`, …) and a member of the `LatchProtocolEvent` union, discriminated by `contract` + `eventName`.

Integers wider than 48 bits map to `bigint`; narrower ones (`int24`, `uint24`, `uint16`, …) map to `number`.

### Balance deltas and fees

```ts
import { unpackBalanceDelta, decodeProtocolFee, feeToPercent } from "@latchprotocol/sdk";

unpackBalanceDelta(-1n);                 // { amount0: -1n, amount1: -1n }
decodeProtocolFee(0x7d03e8);             // { zeroForOne: 1000, oneForZero: 2000 }
feeToPercent(3000);                      // 0.3
```

### Indexer model

`schema.graphql` is a subgraph-flavoured GraphQL schema covering pools, swaps, liquidity changes, positions, hooks, fee governance and vault claim tokens. `@latchprotocol/sdk/indexer` exports the equivalent TypeScript entity types plus deterministic id builders.

```ts
import {
  buildHookPermissionsEntity,
  eventId,
  poolEntityId,
  type Pool,
  type Swap,
} from "@latchprotocol/sdk/indexer";

const permissions = buildHookPermissionsEntity("CL", 0x04c0);
permissions.id;         // "CL-0x04c0"
permissions.beforeSwap; // true

eventId(log.transactionHash, log.logIndex); // "0xabc...-7"
```

Relationships are explicit throughout: a `Swap` points at a `Pool`, a `Pool` points at a `Hook` and two `Token`s, positions point at their pool. Because a hook may back pools with different bitmaps, the permission set is recorded on the `Pool` (via `hookPermissions`) as well as on the `Hook` (`observedBitmaps`).

---

## Package layout

```
packages/sdk/
├── LICENSE                       MIT
├── README.md
├── schema.graphql                indexer schema (GraphQL / subgraph dialect)
├── package.json
├── tsconfig.json                 strict; used for typecheck + tests
├── tsconfig.build.json           emits dist/ from src/ only
├── vitest.config.ts
├── scripts/
│   └── generate-events.mjs       ABI -> TypeScript generator
├── src/
│   ├── index.ts                  public entry point
│   ├── generated/                DO NOT EDIT - produced by the generator
│   │   ├── abi.ts                event fragments per contract
│   │   └── events.ts             arg interfaces, topics, descriptors, union
│   ├── types/
│   │   ├── currency.ts           Currency, native sentinel, sorting
│   │   ├── parameters.ts         the bytes32 parameters codec
│   │   ├── poolKey.ts            PoolKey, PoolId, key builders
│   │   ├── balanceDelta.ts       packed int128 pair
│   │   └── fee.ts                LP fee, dynamic-fee marker, protocol fee
│   ├── deployments/
│   │   └── index.ts              THE address book — every chain, every contract,
│   │                             token decimals; `null` = not deployed
│   ├── chains/
│   │   ├── endpoints.ts          probed public RPC endpoints per chain
│   │   └── transport.ts          viem failover transport built from them
│   ├── hooks/
│   │   └── bitmap.ts             flag tables, encode/decode/validate
│   ├── events/
│   │   └── index.ts              topic index and log decoding
│   └── indexer/
│       ├── entities.ts           TS mirror of schema.graphql
│       └── index.ts              id builders and mapping helpers
└── test/
    ├── bitmap.test.ts
    ├── deployments.test.ts
    └── events.test.ts
```

---

## Code generation

Event types are never hand-transcribed. `scripts/generate-events.mjs` reads the Foundry artifacts and emits `src/generated/`:

```bash
npm run generate                            # default: ../core/foundry-out
node scripts/generate-events.mjs --artifacts <dir>
node scripts/generate-events.mjs --check    # non-zero exit if generated files are stale (CI)
```

It reads only the `abi` array of each artifact, and emits, per event:

- an argument interface with the ABI's own parameter names,
- the canonical signature and its `keccak256` (topic0),
- an entry in `EVENT_DESCRIPTORS` and a member of the `LatchProtocolEvent` union,
- an `as const satisfies Abi` fragment for `viem`.

Current output: **29 event declarations** across `Vault` (6), `CLPoolManager` (10) and `BinPoolManager` (13), plus the 5 events of the shared `ProtocolFees` base (which the two managers re-emit) — 34 declarations over 22 unique signatures, since several events are declared identically in more than one contract.

Re-run it whenever the contracts are rebuilt. `npm run build` runs it first.

---

## Development

```bash
npm install
npm run build       # generate + tsc
npm run typecheck   # tsc --noEmit over src, test and scripts
npm test            # vitest
```

TypeScript is configured with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax`.

### Verifying the encoding

The bitmap offsets, the `parameters` layout and the dependency rules were read from the protocol's own definitions, not assumed from Uniswap v4. The pool id derivation is additionally pinned by a fixture in `test/events.test.ts`: the same six key words hashed by the EVM (`keccak256(poolKey, 0xc0)`) and by `poolKeyToId` produce the identical digest.

---

## Links

| | |
|---|---|
| Website | <https://latch.guru> |
| Package | <https://www.npmjs.com/package/@latchprotocol/sdk> |
| Source | <https://github.com/Latch-Protocol-Team/latch-sdk> |
| Org | <https://github.com/Latch-Protocol-Team> |
| Developer | <https://x.com/Ox_Forged> |

Issues and pull requests belong on the mirror repo above. Note that `src/`,
`test/`, `scripts/` and `assets/` there are **generated output** — they are
overwritten wholesale on every sync from the monorepo, so a patch applied
directly to those directories is lost on the next release. Open an issue and
the change is made upstream.

---

## License

MIT — see [LICENSE](./LICENSE).
