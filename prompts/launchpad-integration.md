# Claude prompt — run a launchpad on Latch

Paste the block below into [Claude Code](https://claude.com/claude-code) inside the repo
you want the launchpad in. **Fill in `## My setup` first.**

A launch on Latch is one transaction. `LaunchpadKit.createLaunch(LaunchParams)` creates the
pool, configures the anti-sniper fee decay on `LaunchGuardHook`, seeds liquidity, and lists
the hook in the registry. You deploy none of that — it is live on chain and you call it.

---

## Before you paste

Two things about this contract shape the whole integration, and an agent that does not know
them will write plausible code that loses money.

**`LaunchpadKit` has no admin key. At all.** Not `Ownable`, not `AccessControl`, no pause,
no withdrawal, no upgrade. Every constructor argument is immutable. That is deliberate —
and it means **there is no recovery**. Native sent to it directly is gone. Get the
arguments right before you broadcast, because nobody can fix them after.

**Durations are in two different units and one of them is blocks.** Robinhood Chain
produces a block every **0.102 seconds**, not 12. `decayBlocks` is blocks;
`startDelaySeconds` is seconds that the kit converts using its configured block time. Code
written against a 12-second assumption is 118× off here, which turns a three-day fair
launch into thirty-five minutes.

---

## The prompt

````text
I am building a token launchpad on Latch Protocol. `LaunchpadKit` is already deployed on my
chain and does the whole launch in one call. I am NOT deploying the kit or the hook.

## My setup

- Chain: Robinhood Chain (4663)          <-- change if different
- Quote token: USDG                       <-- what the launch trades against
- My fee wallet: 0x0000000000000000000000000000000000000000   <-- REPLACE
- Default preset: FairLaunch              <-- FairLaunch | AntiSniperAggressive | Stealth | NoTax | Custom

## Ground rules — follow these exactly

1. ADDRESSES AND LAUNCH MATHS COME FROM THE SDK. DO NOT HAND-ROLL EITHER.

   npm install @latchprotocol/sdk viem

   import {
     getDeployment, requireContract,
     sqrtPriceForLaunch, buildLaunchParams, validateLaunchParams, describeLaunch, PRESET,
   } from "@latchprotocol/sdk"

   const d = getDeployment(4663)
   const kit = requireContract(d, "launchpadKit")   // throws a sentence, not a stack trace

   `launchpadKit`, `launchGuardHook` and `launchRegistry` are `Address | null`. `null` means
   NOT DEPLOYED on that chain. It is never the zero address and must never be treated as
   one.

   The SDK ships `sqrtPriceForLaunch`, `PRESET`, `buildLaunchParams`,
   `validateLaunchParams` and `describeLaunch`. Use them. If you find yourself writing
   Q64.96 arithmetic, a `Math.sqrt`, or the literal `0` for a preset, stop — that is the
   thing these exist to prevent, and every one of those mistakes is silent.

2. `Preset.Custom` IS ZERO — pass the preset BY NAME.

   The enum is `Custom, FairLaunch, AntiSniperAggressive, Stealth, NoTax`. An uninitialised
   field, a missing form value, or `preset: 0` means Custom — and Custom then reads
   `initialFeeBips`, `finalFeeBips`, `decayBlocks` and `enabled`, which a preset-driven UI
   probably left at zero. That is a launch with no anti-sniper protection at all, and it
   will not error.

   Use `PRESET.FairLaunch` or the string `"FairLaunch"`, never a bare number.
   `buildLaunchParams` throws if you pass Custom without a schedule, and
   `validateLaunchParams` reports an all-zero Custom as an error. Do not defeat either by
   filling the fields with zeros to make the check pass.

3. THE PRICE COMES FROM `sqrtPriceForLaunch`.

   const price = sqrtPriceForLaunch({
     launchToken, quoteToken,
     launchDecimals, quoteDecimals,        // read decimals() off BOTH contracts
     quotePerLaunchToken: "0.05",          // a STRING. A float loses the digits that matter.
   })

   It handles both traps that stack here — address sorting (which decides whether the pool
   holds your price or its reciprocal) and decimals (a 6-decimal quote against an
   18-decimal launch token is a 10^12 factor). It returns `poolPrice` and
   `launchTokenIsCurrency0`: PRINT BOTH and make me confirm them before broadcasting.
   `initialize` cannot be undone.

4. VALIDATE LOCALLY, SIMULATE ON CHAIN, SHOW ME, THEN SEND. In that order.

   const issues = validateLaunchParams(params, {
     blockTimeCentis,        // kit.blockTimeCentis()
     maxDecayBlocks,         // hook.MAX_DECAY_BLOCKS()   <- SCREAMING_SNAKE on chain
     maxStartDelayBlocks,    // hook.MAX_START_DELAY()    <- and no camelCase alias
   })

   Those two are Solidity `public immutable`, so their getters keep the
   constant's own casing. `maxDecayBlocks()` does not exist and a probe for it
   reverts. The SDK's option names are camelCase because they are TypeScript;
   the CALLS are not.

   Render every issue — errors block, warnings are "did you mean this". Then call
   `previewSchedule(params)` and `computePoolKey(...)` on chain and show: the pool id, the
   opening price in human units, the fee at block 0 and at the end of the window, the
   WALL-CLOCK length of that window (use `describeLaunch(...).decayWindow`, which gives
   "5m" rather than "3000 blocks"), and when trading opens.

   The local preview and the on-chain one agreeing is itself a check: it means the block
   time you are using matches the kit's. A dry run is the default; sending requires an
   explicit flag.

5. `maxBuyPerTx` IS PER TRANSACTION, NOT PER WALLET.

   It cannot be per wallet — nothing on chain knows what a wallet is. Do not label it
   "max buy per person" in the UI. One address can send many transactions.

6. `launchOperator` FREEZES AT `startBlock` AND IS NOT TRANSFERABLE.

   Until trading opens it is the only address that can `reconfigureLaunch`. After
   `startBlock`, nobody can. `address(0)` means msg.sender. Choose it deliberately — if it
   is a hot key you lose, you lose the ability to fix a launch before it opens; if it is a
   multisig too slow to act inside the delay window, same result.

7. NEVER SEND NATIVE TO THE KIT DIRECTLY.

   It has no withdrawal function. Value goes in through the documented parameters of the
   call or not at all.

## Build this

1. A launch form that maps to `LaunchParams` field for field — build the struct with
   `buildLaunchParams`, never as an object literal — with the preset as a real choice from
   `PRESET_NAMES` and Custom hidden behind an "advanced" toggle. Show each preset's
   `doesNotProtectAgainst` string next to its name; a preset is a price, not a promise.
2. A preview panel driven by `previewSchedule` plus `describeLaunch` — see rule 4. Nothing
   on it may be computed off chain if the contract will answer for it, and the two must be
   shown side by side rather than one silently preferred.
3. The `createLaunch` transaction, with the ERC-20 approvals the seed requires, and clear
   handling of the refund path (the kit refunds unused seed amounts).
4. A launch dashboard reading `getLaunchRecord(poolId)` and the guard's live fee, so a
   creator can watch the decay actually happen.
5. Registry listing: the kit can list the hook for me. If it does not, list it in the SAME
   session the launch happens — otherwise a stranger can list it first with hostile
   metadata.
6. A verify script that asserts every configured address has code and answers a function
   only that contract answers. Exit non-zero on mismatch.

## Where my fee wallet earns

Explain the options and wire the one I chose:
(a) a fee on my own front end / router wrapper — the direct one, fully mine;
(b) my wallet on the pool's `RevShareHook` beneficiary roster, if the launched pool uses
    that hook and I own it;
(c) a share of the seeded LP position, which is just an LP position and behaves like one.

Do not imply I earn from Latch's protocol fee. I do not — that is set by Latch governance
on the shared pool manager and capped at 0.4% by core.

## When you are done

Show me a full dry-run preview for a realistic launch, the verify script's output, and the
exact numbers you would broadcast. Do not send anything.
````

---

## What to check before you trust the output

- The preview prints a window length in **hours or days**, computed from a 0.102s block. If
  it says "1,000,000 blocks ≈ 139 days", the agent used 12s and everything downstream is
  wrong by two orders of magnitude.
- Set the preset field to `0` on purpose. The UI must refuse, not launch a Custom with zero
  protection.
- Point the verify script at a wrong address. It must exit non-zero.

## The irreversible list

Read this before your first real launch. None of it can be undone:

- The opening price, fixed at `initialize`.
- Native sent directly to `LaunchpadKit`.
- `launchOperator`, after `startBlock`.
- On a pool using `RevShareHook`: `freezeConfig`. It permanently ends `proposeConfig`,
  `reduceFee`, `disable`, `setBeneficiaries` and `transferPoolOwnership` for that pool. Set
  the beneficiary roster before the first swap, and never freeze a pool with non-zero
  `beneficiaryBps` unless `getBeneficiaries` is non-empty, `totalWeight > 0`, and
  `pendingBeneficiary` is settled to dust on both currencies. A UI offering that button must
  confirm it the way it confirms a burn.
