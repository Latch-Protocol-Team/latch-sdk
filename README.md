<p align="center">
  <a href="https://latches.fun">
    <img src="https://raw.githubusercontent.com/Latch-Protocol-Team/latch-sdk/main/assets/og.png"
         alt="Latch Protocol — hooks for a bigger ecosystem" width="640">
  </a>
</p>

<p align="center">
  <a href="https://latches.fun">Website</a> ·
  <a href="https://www.npmjs.com/package/@latchprotocol/sdk">npm</a> ·
  <a href="https://github.com/Latch-Protocol-Team">GitHub</a> ·
  <a href="https://x.com/Ox_Forged">Developer on X</a>
</p>

<p align="center">
  <b>Building on Latch with a coding agent?</b> Start with a prompt, not the docs:<br>
  <a href="./prompts/dex-integration.md">🔁 Ship a DEX</a> &nbsp;·&nbsp;
  <a href="./prompts/launchpad-integration.md">🚀 Run a launchpad</a>
</p>

# @latchprotocol/sdk

TypeScript SDK for **LatchProtocol** — a hooks platform on its own Infinity-architecture core (Vault, CL and Bin pool managers), deployed and verified per chain so launchpads and DEXes can ship on it without deploying an AMM.

The SDK gives you the protocol's domain types (pool keys, pool ids, currencies, balance deltas, fees), first-class helpers for the **hook permission bitmap**, typed definitions for every event the contracts emit, the **market** reads a token page needs (trades, candles, holders, the pool directory — from logs and `getSlot0`, never USD), the **pads** helpers (a transferable launchpad tenant with an on-chain brand), and an indexer data model for analytics.

It also carries the modules the rest of the product is built from, and they are all MIT:

| Module | What it does |
|---|---|
| `launchpad/` | Build and validate a launch: presets, CL ranges and Bin shapes, the creator tax, tenant terms, the pads |
| `price/` | Resolve a native/USD price in tiers — Chainlink on chain, then Pyth, then a Latch pool — and turn it into a market cap. Every answer carries its provenance, and "no source" is a first-class answer rather than a zero |
| `lock/`, `drop/`, `split/`, `utilities/` | Liquidity locks, token locks and vesting, Merkle airdrops, multisend, team splits, and the shared fee gate in front of them |
| `rwa/` | Tokenised equities: the verified feed table, and the exact `configureFeed` / `configureMarket` arguments a banded stock pool needs |
| `trading/` | Routing and fills, including the router that can fill on a third-party venue |
| `registry/`, `trust/` | What the on-chain registry says about a Latch, and how to render it without ever implying it is an audit |
| `tokenlists/` | The Latch token list in the standard schema, merged and verified |
| `chains/` | Probed public endpoints per chain, a failover transport, and the contract-clock reader — because on some chains `block.number` inside the EVM is not the block number the RPC reports |

---

## Licensing, and why it matters

The Solidity core is **GPL-2.0-or-later**. That licence is viral: code that links against it can inherit the obligation. If building a hook required importing GPL sources, every third-party hook would arguably become a derivative work.

**This package is the firewall.** It is MIT-licensed and independently authored:

- No Solidity source, comment or NatSpec from `packages/core` is copied into it.
- Types are derived from the **compiled ABI JSON** — a machine-generated description of selectors, argument names and argument types — by the generator in `scripts/generate-events.mjs`.
- All prose, naming and structure here are original.

You can build a hook, an indexer or a front end on this SDK under MIT terms. Deploying against the on-chain contracts is not the same as linking their source; nothing in this package requires you to open your hook.

---

## Launching a token

`LaunchpadKit.createLaunch` does the whole launch in one transaction — pool, anti-sniper fee
schedule, seeded liquidity, registry listing. The SDK ships the three things that call needs
and that are dangerous to hand-roll.

```ts
import {
  sqrtPriceForLaunch, buildLaunchParams, validateLaunchParams, describeLaunch,
  getDeployment, requireContract, PRESET,
} from "@latchprotocol/sdk"

const d = getDeployment(4663)
const kit = requireContract(d, "launchpadKit")

// 1. The price. Handles address sorting AND decimals — both are silent traps.
const price = sqrtPriceForLaunch({
  launchToken: myToken,
  quoteToken: usdg.address,
  launchDecimals: 18,
  quoteDecimals: 6,              // NOT 18. Read it off the contract.
  quotePerLaunchToken: "0.05",   // a STRING; floats lose the digits that matter
})
console.log(price.poolPrice, price.launchTokenIsCurrency0)  // check before you sign

// 2. The params. `preset` has no default, on purpose.
const params = buildLaunchParams({
  launchToken: myToken, quoteToken: usdg.address,
  tickSpacing: 60, sqrtPriceX96: price.sqrtPriceX96,
  preset: "FairLaunch", seed, startDelaySeconds: 3600,
})

// 3. Every objection, before a wallet is opened. blockTimeCentis comes off the kit;
//    contractBlockTimeCentis is the chain's REAL block.number cadence, from the address book.
const { contractBlockTimeCentis } = LATCH_DEPLOYMENTS[4663]
const limits = { blockTimeCentis, contractBlockTimeCentis, maxDecayBlocks, maxStartDelayBlocks }
const issues = validateLaunchParams(params, limits)
console.log(describeLaunch(params, limits).decayWindow)
// On the live Robinhood kit: "10h", with declaredDecayWindow "5m" and clockStretch 120.
```

### Two block clocks

On an Arbitrum Nitro chain — Robinhood Chain is one — `block.number` inside the EVM is
Ethereum's block number (~12 s), while `eth_blockNumber` is the L2 block (~0.1 s). Every block
number a Latch contract stores (`effectiveBlock`, `expiryBlock`, `startBlock`) is on the EVM
clock. Compare them against `readContractBlockNumber(client, chainId)`, never against
`getBlockNumber()`, and convert block counts to time with `contractBlocksToSeconds`. Keep
`getBlockNumber()` for `eth_getLogs` ranges, which are L2.

```ts
const clock = await readContractClock(publicClient, 4663)
clock.contractBlockNumber   // ~26M, what the hook compares against
clock.rpcBlockNumber        // ~62M, the log clock
```

### Three traps these close

**`sqrtPriceX96` is a ratio of RAW units.** USDG is 6 decimals and WETH is 18, so a price
computed as though both were 18 is wrong by 10¹² — a pool opened at a million times the
intended price, fixed permanently at `initialize`. `sqrtPriceForLaunch` takes the decimals as
required arguments and computes in bigint throughout; nothing converts through a float.

**Address sorting silently inverts a price.** `currency0` is the lower address, which has
nothing to do with which token you think of as the price. If your launch token sorts second
the pool holds the reciprocal. The returned `launchTokenIsCurrency0` and `poolPrice` are there
to be shown to a human before broadcasting.

**`Preset.Custom` is the zero value.** An unset field, a `?? 0`, a struct built from `{}` — all
of them mean Custom, and Custom then reads a fee schedule the caller never filled in. The chain
accepts it. You get a launch with no anti-sniper protection and no error anywhere.
`buildLaunchParams` refuses Custom without a schedule, and `validateLaunchParams` reports an
all-zero Custom as an error rather than a default.

### What is deliberately not here

`MAX_DECAY_BLOCKS` and `MAX_START_DELAY` are immutables set per deployment from the chain's
real block time — read them off the hook and pass them in. Hardcoding them is the twelve-second
assumption that made them immutable in the first place. Likewise `blockTimeCentis`: read it
from the kit — it is what the kit USES, not what the chain does. Robinhood's live kit declares
`10` (0.10 s), but its hook's `block.number` advances every ~12 s, so every window it resolves
runs 120x longer than the seconds it was given. `contractBlockTimeCentis` is the real figure.

`PRESET_PARAMS` mirrors the Solidity so a UI can render a schedule without an RPC call, and a
test reads `LaunchPresets.sol` and asserts every field. The chain is still the authority:
call `previewSchedule` on the deployed kit before you broadcast.

---

## Market data

`packages/sdk/src/market` reads everything a token or pool page shows from the chain alone, and
labels where each number came from so a page can print it. **Nothing is priced in dollars.** Every
price is quote per whole base token, every volume is in the quote currency.

| Figure | Source |
|---|---|
| trades | the pool manager's `Swap` logs for the pool id (CL or Bin) — `readPoolTrades` |
| price after each trade | the pool's own price in the log (`sqrtPriceX96` on CL, `activeId` on Bin), oriented by `priceFromSqrt` / `priceFromBinId` |
| spot | `getSlot0` — `readSpotPrice` |
| volume | the quote-side amount of every swap, absolute, summed — `marketStats` |
| candles | `buildCandles(trades, bucketSeconds)`; **a bucket with no trade is not emitted** |
| holders | the token's `Transfer` logs since its launch block, reduced to balances — `readHolders` |
| pool directory | both managers' `Initialize` logs with the full key — `readPoolDirectory` |

```ts
import {
  readPoolTrades, withTimestamps, buildCandles, marketStats, readSpotPrice, readHolders, readPoolDirectory,
  type MarketPool,
} from "@latchprotocol/sdk"

// Orientation is explicit. `baseIsCurrency0` says which currency is the launch token; both
// decimals are required. A wrong decimals value is a 10^12 mispricing, not a display bug.
const pool: MarketPool = { poolId, kind: "CL", key, baseIsCurrency0: true, baseDecimals: 18, quoteDecimals: 6 }

const raw = await readPoolTrades(client, pool, { fromBlock: launchBlock })  // one eth_getLogs
const trades = await withTimestamps(client, raw)                             // one header per distinct block
const spot = await readSpotPrice(client, pool)                               // quote per base, now

const candles = buildCandles(trades, 300)             // 5-minute OHLC, gaps left as gaps
const day = marketStats(trades, now - 86_400)         // trades, buys, sells, volumeQuote, first, last, change
const holders = await readHolders(client, token, { fromBlock: launchBlock, totalSupply })
holders.fromBlock                                     // what "since block N" on a page means

// Every pool the chain's Latch managers opened since a block: the directory a DEX front routes through.
const listings = await readPoolDirectory(client, { clPoolManager, binPoolManager }, { fromBlock: deployedAtBlock })
```

Swap deltas follow the Vault's convention: a negative amount was paid by the trader, a positive one
received; `side` is judged from the base token's delta. `Trade.sender` is the pool manager's caller
(a router), never the end user. `readHolders` lists the Vault and the lockers because they hold —
label them, do not hide them.

---

## Pads: a launchpad or DEX somebody else runs

A **pad** is one `LatchPad` contract, cloned by `LatchPadFactory.createPad` and made a
`LaunchpadKitV2` tenant in the same transaction. The pad *is* the tenant (every launch names it),
its owner configures it, and ownership moves two-step. The pad holds nothing: the kit and the
lockers credit the integrator wallet the owner names, and `configure` refuses the pad itself.

Two things live on a pad and they are not alike:

- **Terms** (`TenantConfig`) are stored on the kit and **enforced on every launch that names the
  pad**: integrator, `integratorBps` (≤ the lockers' `maxIntegratorBps`), `integratorLaunchFeeWei`
  (≤ the kit's `maxIntegratorLaunchFeeWei`), allowed presets, allowed Bin shapes, `restrictQuotes`,
  `active`. `PadTerms` spells them in names; `tenantConfigFromTerms` turns them into the struct.
- **The brand** (`PadBrand`) is the pad's `metadataURI`, stored inline as a `data:application/json`
  URI of at most `PAD_MAX_METADATA_URI_BYTES` (4,096) bytes: tagline, logo URL, accent, one of
  `PAD_THEMES`, links, `kind` (`launchpad` | `dex` | `both`), `dex: { enabled, feeBps, scope }` and
  `customDomain`. **Nothing in the brand is enforced by any contract.** `dex.feeBps`
  (≤ `PAD_MAX_DEX_FEE_BPS`, 100) is a request to whichever front end hosts the pad.

```ts
import {
  encodeCreatePad, encodeSetPadMetadata, encodeConfigurePad,
  readPad, readPads, padKindOf, padDexScopeOf, padHostnameOf, validatePadBrand,
  type PadBrand, type PadTerms,
} from "@latchprotocol/sdk"

const brand: PadBrand = {
  v: 1,
  tagline: "Launches for the Mochi community",
  theme: "frost",
  accent: "#1f9e89",
  kind: "both",
  dex: { enabled: true, feeBps: 25, scope: "all" },   // a request to the hosting front end
  customDomain: "launch.mochi.xyz",                    // the owner's half of the domain proof
}
validatePadBrand(brand)   // [] — every objection, cheapest first; encode throws on any

const terms: PadTerms = {
  integrator: feeWallet,        // never the pad
  integratorBps: 500,
  integratorLaunchFeeWei: 0n,
  allowedPresets: [],           // [] means every preset
  allowedBinShapes: [],         // [] FORBIDS Bin legs
  restrictQuotes: false,
  active: true,
}

// One transaction to LatchPadFactory, paying its flat site fee; the owner is msg.sender.
// `readPadFactoryFee` reads padFeeWei / pendingPadFee / maxPadFeeWei / padFeeNoticeSeconds /
// protocolFeeRecipient; `buildCreatePad` sends `padSafeValue(fee)` (the higher of the fee in force
// and an announced increase) and the factory refunds the difference in the same call.
const fee = await readPadFactoryFee(client, factoryAddress)
const create = buildCreatePad({ factory: factoryAddress, name: "Mochi Pad", brand, terms, fee }) // { to, data, value }

// Later, from the owner: rename / re-brand, or change the terms.
const rebrand = encodeSetPadMetadata("Mochi Pad", { ...brand, tagline: "Now with Bin launches" })
const retune = encodeConfigurePad({ ...terms, integratorBps: 300 })

// Reads. `metadata.kind` is brand | remote | empty | invalid — never a default brand.
const pad = await readPad(client, padAddress)
const b = pad.metadata.kind === "brand" ? pad.metadata.brand : null
padKindOf(b)        // "launchpad" when absent
padDexScopeOf(b)    // "launches" when absent
padHostnameOf(b)    // a valid hostname or null
pad.tenant.configured   // false when the kit never stored terms for it

const all = await readPads(client, factoryAddress)   // padCount / pads(start, end); no log scan
```

`readPad` returns the kit's stored terms decoded (`tenant`), the pending owner, and the brand as
one of four states. A `remote` brand (`ipfs://`, `https://`) is returned as a URL for the caller to
fetch and run through `validatePadBrand`; the SDK does not fetch.

Read `LatchDeployment.launchpadV2.padFactory` for the chain you are on: an address means the
factory is there, `null` means it is coming soon on that chain. The helpers also encode and read
against a factory you name, so they work either way — and reading the address book is the right
check in code, because a sentence in a README goes stale the day something ships.

---

## Integrating with an agent

Two prompts written to be pasted whole into Claude Code (or any coding agent), in the repo
you want the integration in. They carry the constraints that have actually cost this
project time — the missing factory, the 0.102s block, the 10^12 decimals trap, the
irreversible calls — so an agent does not have to rediscover them at your expense.

- **[Ship a DEX on Latch](./prompts/dex-integration.md)** — swap and LP UI against the
  shared Vault and pool managers, with the three places a fee wallet can actually earn.
- **[Run a launchpad on Latch](./prompts/launchpad-integration.md)** — one-call token
  launches through `LaunchpadKit`, with the anti-sniper decay schedule and the list of
  things that cannot be undone.

Fill in the four-line `## My setup` block at the top of the prompt before you send it.

---

## Install

```bash
# Not published to npm yet — this 404s today:
#   npm install @latchprotocol/sdk
# Install from git until it is:
npm install github:Latch-Protocol-Team/latch-sdk
```

The git install builds itself via `prepare`, so you get a compiled `dist/`.
(It did not, until 2026-09-13: this package had `prepublishOnly` and no
`prepare`, and npm only runs the former on `npm publish` — so a git install
produced a package with neither a build nor sources. Reported by an integrator,
fixed, and verified by installing from a clean directory.)

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

`src/` is the whole public surface; everything here is MIT and independently authored.

```
packages/sdk/
├── LICENSE                       MIT
├── README.md
├── schema.graphql                indexer schema (GraphQL / subgraph dialect)
├── scripts/                      ABI -> TypeScript generators, the RPC probe,
│                                 and the mirror that writes the public repo
├── src/
│   ├── index.ts                  public entry point
│   ├── ipfs.ts                   metadata URIs, and what a gateway may not be trusted for
│   ├── types/                    Currency, PoolKey, PoolId, the bytes32 parameters
│   │                             codec, packed balance deltas, LP and protocol fees
│   ├── deployments/              THE address book — every chain, every contract,
│   │                             `null` means not deployed; plus the Safe contracts,
│   │                             the verified stock feeds and the native/USD feeds
│   ├── chains/                   probed endpoints, a failover transport, and the
│   │                             contract clock (see "Two block clocks" above)
│   ├── hooks/                    permission bitmap: flag tables, encode/decode/validate
│   ├── events/                   topic index and log decoding
│   ├── generated/                DO NOT EDIT — produced by the generators
│   ├── launchpad/                launches, presets, CL ranges and Bin shapes, the
│   │                             creator tax, tenant terms, kit v2 and the pads
│   ├── price/                    native/USD in tiers (Chainlink, Pyth, a Latch pool),
│   │                             market cap, and the provenance of each answer
│   ├── market/                   trades, candles, holders, the pool directory, spot
│   ├── lock/                     liquidity locks and token locks / vesting
│   ├── drop/                     Merkle airdrops and multisend
│   ├── split/                    team splits
│   ├── utilities/                the shared fee gate in front of those four
│   ├── rwa/                      market hours, price bands, stock pair coverage
│   ├── trading/                  routing and fills
│   ├── registry/                 what the registry records about a Latch
│   ├── trust/                    reading a listing honestly — never "this is safe"
│   ├── revshare/                 revenue-share config, including a pending proposal
│   ├── tokenlists/               the token list, merged and verified
│   ├── safe/                     Safe addresses and derivation
│   └── indexer/                  TS mirror of schema.graphql, id builders
└── test/                         41 suites, run with vitest
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
| Website | <https://latches.fun> |
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
