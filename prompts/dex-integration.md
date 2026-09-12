# Claude prompt — ship a DEX on Latch

Paste the block below into [Claude Code](https://claude.com/claude-code) (or any coding
agent) inside the repo you want the DEX in. It is written to be pasted whole: the
constraints in it are the ones that have actually cost this project time, not generic
advice.

**Fill in the four lines under `## My setup` before you send it.** Everything else is
already correct.

---

## Before you paste

You are integrating against **shared core** — Latch's `Vault` and pool managers are already
deployed and verified on chain, and your pools live in them. You do not deploy an AMM.

What that means concretely:

| Layer | Who deploys it |
|---|---|
| `Vault`, `CLPoolManager`, `BinPoolManager` | **Latch. Already live.** You call them. |
| Pool creation | Nobody — there is **no factory**. `CLPoolManager.initialize(poolKey, sqrtPriceX96)` is permissionless and a pool is a storage entry. |
| Router / periphery | **Your choice.** Use Latch's UniversalRouter, wrap it, or deploy your own — `Vault.lock` has no access control. |
| Your hook | **You.** This is your product and where a hook-level fee lands. |
| Front end | **You.** MIT, close-source it if you want. |

---

## The prompt

````text
I am building a DEX front end on Latch Protocol. Latch is a singleton AMM (a
PancakeSwap-Infinity/Uniswap-v4-style Vault + pool managers) that is already deployed on
my target chain. I am NOT deploying core contracts.

## My setup

- Chain: Robinhood Chain (4663)          <-- change if different
- Quote token: USDG                       <-- the token users price against
- My fee wallet: 0x0000000000000000000000000000000000000000   <-- REPLACE
- Router: use Latch's UniversalRouter     <-- or "deploy my own", see below

## Ground rules — follow these exactly, they are not stylistic

1. ADDRESSES COME FROM THE SDK, NEVER FROM ME AND NEVER FROM MEMORY.

   npm install @latchprotocol/sdk viem

   import { getDeployment, requireContract, latchTransport } from "@latchprotocol/sdk"
   const d = getDeployment(4663)
   const router = requireContract(d, "universalRouter")

   Do not paste a hex address into source. If a contract you need is `null` on this chain,
   that means NOT DEPLOYED — it never means the zero address. Branch on it and say so in
   the UI. `0x000…000` passed to readContract returns empty instead of failing, which is
   how a missing contract becomes a blank screen with no error.

2. READ DECIMALS OFF THE TOKEN. Do not default to 18.

   `sqrtPriceX96` encodes a ratio of RAW units. On this chain USDG is 6 decimals and WETH
   is 18, so an assumed 18 is wrong by 10^12 — a pool opened at a million times the
   intended price, fixed permanently at `initialize`. This has bitten this codebase twice.
   The SDK's address book carries `decimals` per token; `decimals()` on the live contract
   is the proof.

3. VERIFY EVERY ADDRESS BY A CALL, NOT BY getCode.

   Bytecode existing proves something is there, not that it is what you think. Identify
   each contract by a function only it answers — e.g. the registry answers `latchCount()`
   while a retired one answers `hookCount()` and still returns a plausible number.

4. NEVER RENDER A NUMBER YOU DID NOT READ.

   No mock modules, no sample series, no placeholder price. Four visually distinct states
   for every panel: loading, error, empty, not-configured. On error, say the chain is
   unreachable — never fall back to an example. Two swaps do not make a chart; say "2
   swaps since block N" instead of drawing a line through them.

5. IF A POOL USES RevShareHook, READ `getPendingConfig` BESIDE `getConfig`.

   A pool can show fee 0 / disabled while an armed proposal sits ready for anyone to apply
   in the block before a large swap. A screen showing only the live config is telling a
   trader something that can stop being true for free, at anyone's option.

## Build this

1. A wallet connection and chain guard (wrong network => a blocking, explicit prompt).
2. A token pair selector fed by the SDK address book, with `isTestToken` surfaced — a
   testnet token rendered like money is a lie.
3. A quote: read the on-chain quoter (`clQuoter`) — do not compute the output off chain.
4. A swap that routes through the UniversalRouter, with slippage the user sets and a
   deadline. Show the effective fee, and note that a hook's cut is already netted out of
   what the router reports.
5. Position management via `clPositionManager` if I asked for LP.
6. A verify script (`npm run latch:verify`) that, for every address and token in the
   config, asserts code exists, identifies it by a call, and reads `decimals()`. It must
   exit non-zero on any mismatch. Run it before you tell me anything works.

## Where my fee wallet actually earns

Explain these to me and implement the one I chose, do not silently pick:

(a) ROUTER LAYER — deploy a thin contract that takes my cut and forwards to Latch's
    UniversalRouter. `Vault.lock` is permissionless, so this needs no permission from
    anyone. Most direct, and it is the only one I fully control.
(b) HOOK LAYER — deploy my own hook and take a `hookDelta`. Highest ceiling, most work,
    and it means an audit.
(c) REVENUE SHARE — put my wallet on a pool's `RevShareHook` beneficiary roster. Only
    works on pools I own.

The protocol fee is NOT one of my options: it is set by Latch governance on the shared
pool manager, capped at 0.4% by core, and I cannot change it. Say so plainly in the README
you write rather than leaving me to discover it.

## When you are done

Do not tell me it works. Show me: the verify script's output, a real quote against the
live chain, and a list of every screen state you implemented. If something is not wired,
say which and why.
````

---

## What to check before you trust the output

- `grep -r "0x" src/config` should find nothing but your fee wallet. Every other address
  belongs to the SDK.
- The verify script exits non-zero when you point it at a wrong address on purpose. A
  check that cannot fail is not a check.
- Turn the RPC off and reload. You should see an error state that names the problem, not a
  chart.

## The mistakes that are worth naming up front

- **Assuming a factory.** There is no per-pair contract to find or deploy. If your agent
  starts writing `getPair`, it has pattern-matched Uniswap v2 and the rest will be wrong.
- **Hardcoding an address "just for now".** Four of Latch's addresses are marked
  `REDEPLOYABLE_CONTRACTS` in the SDK for a reason. A stale registry still answers and
  renders as a healthy, empty marketplace.
- **A default of 18 decimals.** See rule 2. It is the single most expensive mistake on this
  list, because `initialize` cannot be undone.
