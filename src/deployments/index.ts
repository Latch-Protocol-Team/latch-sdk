// SPDX-License-Identifier: MIT
/* ============================================================================
   THE LATCH ADDRESS BOOK — one file, every deployed contract, per chain.

   WHY THIS LIVES IN THE SDK AND NOWHERE ELSE
   ------------------------------------------
   An address table is the first thing an integrator needs and the last thing
   they should have to type. Before this module the SDK shipped ABIs, event
   decoders and a probed RPC list but not a single address, so "simple
   integration" still began with hand-copying twenty hex strings out of a
   markdown file — and every consumer that did so became another place the
   truth could rot.

   It had already started. `apps/web/src/lib/chain.ts` carried one copy and
   `packages/create-latch-dex/template/src/config/deployments.ts` a second, and
   the two had ALREADY diverged: the web copy knows the timelocks, the fee
   controller, the quoters and the position descriptor; the template copy does
   not. Neither was wrong, which is exactly the problem — two partial tables
   with no way to tell which one is behind. The DefiLlama adapters in this repo
   went the other way, two hand-maintained mirrors with a parity test bolted on
   to catch drift, and a parity test is a smoke alarm, not a fix. This module is
   the fix: both of those files now RE-EXPORT this one.

   Addresses and ABIs are facts about a public chain, not derivative works of
   the GPL contracts that produced them. Nothing here imports from
   `packages/core`, `periphery`, `router` or any hook package, so a third-party
   hook author can build against this MIT package without ever touching GPL
   code. Every value below was transcribed from `ops/safe/robinhood-deployment
   .md` and `packages/core/script/config/*.json`, both of which record addresses
   READ BACK off chain after deployment rather than copied from a script's log.

   NULL MEANS NOT DEPLOYED. IT NEVER MEANS ZERO.
   ---------------------------------------------
   Every address field that can be absent is typed `Address | null`, and absent
   is written `null`. The zero address is not used as a placeholder anywhere in
   this file and must never be introduced: `0x000...000` is a value a caller
   will happily pass to `readContract`, `getCode` or a swap path, where it
   silently returns empty rather than failing. `null` cannot be called. It
   forces the consumer to branch, which is the whole point — the honest render
   for a contract that does not exist yet is "not configured on this chain",
   not a read against nothing.

   So: `deployment.launchpadKit === null` is a complete, checkable answer.
   `requireContract(deployment, "launchpadKit")` is the other half, for call
   sites that genuinely cannot proceed without it and would rather throw a
   sentence than a stack trace from viem.

   FOUR OF THESE ADDRESSES ARE ABOUT TO CHANGE
   -------------------------------------------
   `LatchRegistry`, `RevShareHook` and the 48h custody timelock are queued for
   redeployment with fixes, and `LatchLaunchRegistry` plus the launchpad pair
   have not landed at all. That is the normal state of an address book, not an
   exception to plan around, so the shape is chosen for it:

     * ONE edit, in ONE file, per redeploy. Nothing downstream restates an
       address; `apps/web` and the `create-latch-dex` template both import.
     * `REDEPLOYABLE_CONTRACTS` names the keys whose address is a moving target,
       because the failure mode of a stale one is silent. A retired
       `LatchRegistry` still answers `latchCount()` with a number and renders as
       a healthy, empty marketplace — see the 2026-09-10 rename, where the old
       registry at 0x665e7e5C… still responds and nothing reads it. A stale
       Vault, by contrast, cannot happen: it is immutable and permanent.

   DECIMALS ARE PART OF THE ADDRESS BOOK, NOT AN AFTERTHOUGHT
   ----------------------------------------------------------
   USDG is 6 decimals on Robinhood and WETH9 is 18. `sqrtPriceX96` encodes a
   price as a ratio of RAW units, so a hardcoded 18 against a 6-decimal quote is
   wrong by 10^12 — that is a pool opened at a million times the intended price,
   fixed permanently at `initialize`. This repo has already caught that trap
   twice (see the Arc note in `chains/endpoints.ts`, and `lib/swap.ts`). A token
   listed here therefore ALWAYS carries its decimals, and a token whose decimals
   nobody has read off its own contract does not get listed.

   The table is still a claim, not a proof. `decimals()` on the live contract is
   the proof, and anything pricing a pool should read it — `npm run latch:verify`
   in the scaffolded app does exactly that for every address and token here.

   ADDING A CHAIN IS A DATA CHANGE, NOT A CODE CHANGE
   --------------------------------------------------
   One object literal in `DEPLOYMENTS_TABLE` below is the whole edit. Nothing
   restates the chain list: `LatchChainId`, `LatchChainKey`, `LATCH_CHAIN_IDS`,
   `LATCH_MAINNET_CHAIN_IDS`, `NATIVE_CURRENCY` and `isLatchChainId` are all
   DERIVED from that table's keys. It was not always so — until 2026-09-20 the
   two chains were restated five times, and a third chain meant editing a union
   type, an array, a map and a function body, any one of which could be missed
   while the other four compiled fine.

   What the compiler still enforces, and should: every field typed `Address`
   (not `Address | null`) must be present. A chain is not addable half-way.
   `vault`, `clPoolManager`, `binPoolManager`, `feeController`, `registry`,
   `universalRouter`, both position managers, both quoters, the descriptor,
   `create3Factory`, `permit2`, `weth`, `revShareHook`, the custody timelock and
   `deployedAtBlock` are all required (the policy timelock is not: Base has none), because a consumer branching on `null`
   for those was never written. So a new chain enters this table when its core
   is deployed and read back, and not one commit earlier. There is no
   placeholder to pre-stage and no zero address to fill in.

   ARC MAINNET (5042) IS DELIBERATELY ABSENT
   -----------------------------------------
   It has never answered a probe from this project: TLS handshake failures on
   every candidate endpoint, so chain id 5042 has never been read off a live
   node, and its published USDC decimals contradict themselves (6 in the owner's
   config, 18 on Circle's own Connect page — the 10^12 gap above). See the long
   note in `chains/endpoints.ts`. Do not add it from memory or from a docs page.
   Nothing is deployed there in any case.
   ============================================================================ */

import type { Address } from "viem";
import { SAFE_CONTRACTS, type SafeContracts } from "./safe.js";

import type { ContractBlockClock } from "../chains/clock.js";

/**
 * Chains where Latch's shared core is deployed and verified.
 *
 * DERIVED from `DEPLOYMENTS_TABLE`'s keys — do not write a union here. Adding a
 * chain is one object literal in that table and nothing else.
 */
export type LatchChainId = keyof typeof DEPLOYMENTS_TABLE;

/**
 * Stable key per chain. Matches the keys in `chains/endpoints.ts`.
 *
 * Also derived: it is the union of the table's own `key` fields.
 */
export type LatchChainKey = (typeof DEPLOYMENTS_TABLE)[LatchChainId]["key"];

/**
 * A token this address book knows about, with the decimals that make its
 * amounts mean something.
 *
 * `decimals` is not optional and has no default. See the header: a default of
 * 18 is how a 6-decimal quote token misprices a pool by 10^12.
 */
export interface TokenInfo {
  readonly address: Address;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  /**
   * `true` for a throwaway test token with no economic meaning. Rendering one
   * without saying so is how a testnet balance reads as money.
   */
  readonly isTestToken: boolean;
  /**
   * A tokenised stock: an issuer-controlled security token. Present only when
   * true. What it means for a pool or a launch quoted in it (read on chain,
   * 2026-09-13, Robinhood tokens): the issuer can pause transfers, burn from
   * any holder and upgrade every stock token at once, and raw units differ
   * from shares by a UI multiplier. A UI must say so beside any stock pair.
   */
  readonly stock?: {
    /** The issuer as it names itself on the token, e.g. "Robinhood". */
    readonly issuer: string;
    /** Exchange ticker of the underlying, e.g. "NVDA". */
    readonly ticker: string;
  };
}

/* ============================================================================
   DURATION CLOCKS — how a deployed Latch contract measures time.

   DECIDED 2026-09-13 (Option B): every duration in Latch contracts moves to
   `block.timestamp`. The contracts already on chain were built earlier and
   measure in `block.number`, which on Arbitrum Nitro (Robinhood, 4663) is the
   PARENT chain's block, not the L2 block the RPC reports. Both kinds are live at
   once, and the old ones do not go away when the address book moves on: a pool
   is bound to its hook's address forever.

   So the clock is recorded HERE, per contract, and no consumer infers it:

     "timestamp"       stored times are unix seconds; compare with
                       `block.timestamp` (the latest block's `timestamp`).
     "contract-block"  stored times are the EVM's `block.number`; compare with
                       `readContractBlockNumber` from `chains/clock`, NEVER with
                       `eth_blockNumber`.

   There is no decode-time test that tells the two apart. `RevShareHook`'s
   8-word `getPendingConfig` has the same layout in both the block-numbered
   `0xfC00…` and the timestamp source, and `LaunchGuardHook`'s `Launch` struct
   lines up word for word. The wrong reading returns a 1970 date or a far-future
   block, not an error. Look the address up; never guess.
   ============================================================================ */

/** How a contract measures and stores durations. See the block above. */
export type DurationClock = "timestamp" | "contract-block";

/**
 * The on-chain layout of `RevShareHook.getPendingConfig(poolId)`.
 *
 * - `block-no-expiry` — 7 words, `(uint48 effectiveBlock, ConfigParams)`. No
 *   expiry at all: a matured proposal stays armed until cancelled or frozen.
 * - `block-with-expiry` — 8 words, `(uint48 effectiveBlock, uint48 expiryBlock, ConfigParams)`.
 * - `timestamp-with-expiry` — 8 words, `(uint40 effectiveAt, uint40 expiresAt, ConfigParams)`.
 */
export type RevSharePendingShape = "block-no-expiry" | "block-with-expiry" | "timestamp-with-expiry";

/** One `RevShareHook` this address book knows, current or retired, with its shape. */
export interface RevShareHookRecord {
  readonly address: Address;
  readonly durationClock: DurationClock;
  readonly pendingShape: RevSharePendingShape;
  /**
   * `current` is the one `LatchDeployment.revShareHook` names. Exactly one per chain.
   * `live` is a deployed, serviceable hook that is not (yet) the one `revShareHook` names —
   * e.g. a redeploy whose consumers have not migrated. `retired` is superseded but still hosts
   * whatever pools were bound to it.
   */
  readonly status: "current" | "live" | "retired";
  /** Why it is here. Pools bound to a retired hook still exist and still trade. */
  readonly note: string;
}

export interface NativeCurrency {
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
}

/**
 * The contracts `LaunchpadKitV2` is built from, in the deployment order of
 * `packages/launchpad/docs/kit-v2-integration.md` section 11.12.
 *
 * A separate group rather than new top-level fields: none of these replaces the
 * block-numbered `launchpadKit` / `launchGuardHook` above, which keep hosting
 * their pools, and a kit is only usable when the whole group is present and
 * bound together (its constructor asserts the hooks' factory, the lockers'
 * position managers and recipient). Each slot is `null` until that contract is
 * deployed AND verified; a partially filled group is an in-progress deployment,
 * not a usable kit - `requireLaunchpadV2` refuses it.
 *
 * All durations in this stack are `block.timestamp` (Option B), so the group
 * carries no clock field.
 */
export interface LaunchpadV2Deployment {
  /** `LaunchpadKitV2`. Owner = the governance Safe; its only power is the launch fee. */
  readonly launchpadKitV2: Address | null;
  /** `LaunchLegs`, the linked library the kit DELEGATECALLs. Verified alongside the kit. */
  readonly launchLegs: Address | null;
  /** `LaunchTokenFactory`. Its `launchTokenInitCodeHash()` feeds off-chain address prediction. */
  readonly launchTokenFactory: Address | null;
  /** `LatchLPLocker` (CL). No owner. */
  readonly clLPLocker: Address | null;
  /** `LatchBinLPLocker`. No owner. */
  readonly binLPLocker: Address | null;
  /** The timestamp `LaunchGuardHook` bound to `launchTokenFactory`. Not the block-numbered `launchGuardHook`. */
  readonly clLaunchGuardHook: Address | null;
  /** `BinLaunchGuardHook(binPoolManager, launchTokenFactory)`. */
  readonly binLaunchGuardHook: Address | null;
  /** `LatchPadFactory`, bound to `launchpadKitV2`. No owner. */
  readonly padFactory: Address | null;
}


/**
 * Every Latch contract on one chain.
 *
 * Field-by-field nullability is deliberate and load-bearing. A field typed
 * `Address` is deployed on EVERY chain in this table — a consumer can use it
 * without a branch. A field typed `Address | null` is one that genuinely does
 * not exist somewhere, and the compiler makes you say what you will do about
 * that.
 */
export interface LatchDeployment {
  readonly chainId: LatchChainId;
  readonly key: LatchChainKey;
  readonly name: string;
  /** Block explorer origin, no trailing slash. */
  readonly explorer: string;
  /**
   * `true` when this chain holds real value. Governs warning copy and nothing
   * about how anything is read — a testnet address under mainnet chrome is a
   * lie whether or not the reads succeeded.
   */
  readonly isMainnet: boolean;
  /**
   * Block the first Latch contract landed. Log scans start here, not at
   * genesis: an unbounded `getLogs` is how a public RPC starts refusing you.
   */
  readonly deployedAtBlock: bigint;
  readonly nativeCurrency: NativeCurrency;

  /* -- clocks ------------------------------------------------------------- */

  /**
   * Which clock `block.number` follows INSIDE THE EVM on this chain.
   *
   * `"parent-l1"` on Arbitrum Nitro chains, where a contract sees Ethereum's
   * block number while `eth_blockNumber` (and `deployedAtBlock` above) is the L2
   * one. Every block number a Latch contract STORES is on this clock. Compare
   * those against `readContractBlockNumber` from `chains/clock`, never against
   * `getBlockNumber()`. See the header of `chains/clock.ts`.
   */
  readonly contractBlockClock: ContractBlockClock;
  /**
   * Real cadence of the contract-visible `block.number`, in hundredths of a
   * second. NOT the RPC's block time, and NOT whatever a contract declared in
   * its own `blockTimeCentis()` — those can be wrong, and on Robinhood they are.
   */
  readonly contractBlockTimeCentis: number;

  /* -- settlement core ---------------------------------------------------- */

  /**
   * The singleton that custodies every token for the whole protocol.
   *
   * Immutable, permanent, and the highest-value address in the system —
   * `registerApp` is `onlyOwner` and irreversible. It will never be redeployed,
   * which is why it is safe to bake into a source file.
   */
  readonly vault: Address;
  readonly clPoolManager: Address;
  readonly binPoolManager: Address;
  /**
   * The `*PoolManagerOwner` wrappers that actually hold fee and pause authority
   * over every pool. `null` on Sepolia, where the managers are owned directly.
   *
   * Recorded here because the alternative is what the dapp does today: read
   * `owner()` and keep hopping until you land somewhere recognisable. That hop
   * chain is still the right way to answer "who owns this NOW" — ownership is
   * mid-migration on Robinhood — but the wrapper's ADDRESS is a fixed fact and
   * does not need discovering.
   */
  readonly clPoolManagerOwner: Address | null;
  readonly binPoolManagerOwner: Address | null;

  /* -- fees --------------------------------------------------------------- */

  /**
   * The contract governance points a pool manager at. Deployed does NOT mean
   * wired: read `poolManager.protocolFeeController()` to find out whether it is
   * in force, and expect `address(0)`.
   *
   * On Robinhood this is `LatchProtocolFeeControllerV2`, in force on both
   * managers since 2026-09-13. V1 (`0x2a03E6E6…154c`) is RETIRED and must not
   * be pointed at again: it priced pools correctly and had no function that
   * could call `collectProtocolFees`, so everything it charged accrued where
   * nobody could withdraw it. Nothing was lost — the caller check runs at
   * collection time, so V2 can sweep what built up under V1.
   */
  readonly feeController: Address;
  /**
   * The two upstream `ProtocolFeeController` instances (one contract, deployed
   * twice — there is no separate CL/Bin source file, whatever the ops table
   * calls them). `null` on Sepolia, where neither was deployed.
   */
  readonly clProtocolFeeController: Address | null;
  readonly binProtocolFeeController: Address | null;

  /* -- governance --------------------------------------------------------- */

  /**
   * The 2-of-3 governance Safe. Deployed at the SAME address on both chains,
   * with identical owners and threshold, verified with `cast` on both.
   *
   * This is an identifier, not a claim about who owns what: on Robinhood it
   * owns every contract in this table, on Sepolia it exists and owns nothing.
   * Which is true for a given chain must be READ, never assumed from here.
   */
  readonly governanceSafe: Address;
  /** 48h tier. Vault and the pool manager owners — irreversible powers. */
  readonly timelockCustody: Address;
  /**
   * 6h tier. Fee policy, descriptor, router — reversible ones.
   *
   * `null` where no policy timelock exists. The Policy tier was retired on
   * 2026-09-12 (reversible actions sit with the Safe directly), so chains
   * deployed after that — Base — have none. Robinhood and Sepolia keep theirs
   * because they are on chain and still hold whatever was given to them.
   */
  readonly timelockPolicy: Address | null;
  /**
   * The canonical Safe v1.4.1 contracts on this chain (`deployments/safe.ts`):
   * what the governance Safe is a proxy of, and the `MultiSendCallOnly` a
   * batch DELEGATECALLs. Verified by `eth_getCode` per chain before listing.
   */
  readonly safe: SafeContracts;

  /* -- directory ---------------------------------------------------------- */

  /**
   * `LatchRegistry` — the HOOK registry, and the Latch Marketplace's backing
   * contract. This is the one `LaunchpadKit.registry()` returns and the one
   * `listHook` writes to.
   *
   * NOT `launchRegistry`. There are two registries, the names are one word
   * apart, and both are real and deployed — an integrator wired to the wrong
   * one on 2026-09-13 and only caught it by probing. Tell them apart by a CALL,
   * never by the name or the position in this file:
   *
   *   LatchRegistry        latchCount() answers, MAX_NAME_BYTES() answers 64
   *   LatchLaunchRegistry  latchCount() REVERTS, launchCount() answers
   *
   * This one also owns the governance surface: `LatchLaunchRegistry` reads
   * `CURATOR_ROLE` and `GUARDIAN_ROLE` from here rather than defining its own,
   * so a curator granted here can flag launches too.
   *
   * REDEPLOYABLE, and its stale failure mode is silent: a retired registry
   * answers `latchCount()` with a number and renders as a healthy, empty
   * marketplace. Read it from here and nowhere else.
   */
  readonly registry: Address;

  /* -- periphery and router ----------------------------------------------- */

  readonly universalRouter: Address;
  /**
   * `LatchFillRouter` — the routed-fill router that may fill a trade on a THIRD-PARTY AMM and
   * charges 10 bps for it, while a Latch pool is charged exactly 0 (owner decision 2026-09-20).
   *
   * `null` where it is not deployed, which is the house convention and NOT `?:` — `requireContract`
   * tests for `null`, so an optional member would be invisible to it and would produce viem's
   * "invalid address" instead of this file's "not deployed on <chain>" message. The absence is
   * meaningful: a caller that reads `null` as "route through Latch pools only" is behaving
   * correctly.
   *
   * ⚠ Never fall back to `universalRouter`. They are different contracts with different fee
   * behaviour, and conflating them charges a Latch pool the routed fee — the exact opposite of
   * the decision this router implements.
   *
   * Its `LatchFillExecutor` is deliberately not listed: it is the router's own first CREATE
   * (nonce 1), so it is derived rather than configured, and `EXECUTOR()` on the router is the
   * authority.
   */
  readonly fillRouter: Address | null;
  readonly clPositionManager: Address;
  readonly binPositionManager: Address;
  readonly clQuoter: Address;
  readonly binQuoter: Address;
  readonly clPositionDescriptor: Address;

  /* -- external and utility ----------------------------------------------- */

  /** Our OWN CREATE3 factory. PancakeSwap's is `onlyWhitelisted` and not ours. */
  readonly create3Factory: Address;
  /** Canonical Permit2. Confirmed by reading code at the address on both chains. */
  readonly permit2: Address;
  /** Canonical wrapped native token. Also present in `tokens` with its decimals. */
  readonly weth: Address;

  /* -- Latch's own hooks --------------------------------------------------- */

  /**
   * `RevShareHook`. Takes nothing at all until a pool owner configures a
   * roster, so its presence in a pool key is not by itself a fee.
   *
   * REDEPLOYABLE. The Sepolia instance predates `keyOf`/`hasKey`/`totalTaken`
   * and reverts on all three — a reminder that "the hook is deployed" and "the
   * hook has the function you are about to call" are different questions.
   */
  readonly revShareHook: Address;

  /* -- launchpad: not deployed anywhere yet -------------------------------- */

  /**
   * `LatchLaunchRegistry` — the LAUNCH registry. A different contract from
   * `registry` above, deployed and live on Robinhood since 2026-09-11.
   *
   * (This doc used to say all three launchpad contracts were `null` on every
   * chain and "coming". They landed; the comment did not follow. If you are
   * reading a claim about what is deployed, check the table below instead.)
   *
   * Holds `registerLaunch` / `getLaunch(poolId)` / `launchCount()` and the
   * launchpad directory `registerLaunchpad` / `getLaunchpad`. It reads its
   * roles from `registry`, so it has no ownership row of its own.
   *
   * WHICH ONE DO I WANT?
   *   listing a HOOK ......... `registry`  (this is what the kit uses)
   *   a launch's own record ... `LaunchpadKit.getLaunchRecord(poolId)`
   *   the curated launch/launchpad directory ... this contract
   *
   * `latchCount()` reverts here. That is the cheapest way to prove which of the
   * two you are holding.
   */
  readonly launchRegistry: Address | null;
  readonly launchpadKit: Address | null;
  readonly launchGuardHook: Address | null;

  /**
   * The `LaunchpadKitV2` stack. NOT DEPLOYED on any chain as of 2026-09-14, so
   * every slot is `null` on every chain. See `LaunchpadV2Deployment`.
   */
  readonly launchpadV2: LaunchpadV2Deployment;

  /**
   * `LatchSplitFactory` (Team splits): clones a `LatchSplit` per team. Owner =
   * the governance Safe, whose only powers are the creation fee and the
   * protocol share for NEW splits, each inside an immutable cap. Independent of
   * the kit, so it is not part of `launchpadV2`. `null` where not deployed.
   */
  readonly splitFactory: Address | null;

  /**
   * Latch utilities: lockers, multisend and Merkle airdrops. Each charges one
   * flat native fee per action, enforced by the contract (`LatchFeeGate`: owner
   * = the governance Safe, fee inside an immutable cap, increases behind a
   * notice, decreases immediate, flushed permissionlessly to the Safe). A caller
   * through the SDK pays exactly what any other caller pays. `null` where not
   * deployed.
   *
   * - `positionLock`: `LatchPositionLock`, time-locks a CLPositionManager NFT
   *   (bound to one position manager, read `positionManager()` from it).
   * - `tokenLock`: `LatchTokenLock`, ERC-20 / native time-locks and vesting.
   * - `multisend`: `LatchMultisend`, one call to up to 1,000 recipients.
   * - `dropFactory`: `LatchDropFactory`, clones and funds a `LatchMerkleDrop`.
   */
  readonly positionLock: Address | null;
  readonly tokenLock: Address | null;
  readonly multisend: Address | null;
  readonly dropFactory: Address | null;

  /* -- duration clocks ----------------------------------------------------- */

  /**
   * How each redeployable time-bounded contract in THIS record measures time.
   * `null` exactly where the contract itself is `null`. Consumers branch on this
   * — the landing preset curve, the dapp proposal banner, the keeper — and it
   * moves in the same edit as the address it describes.
   */
  readonly durationClocks: {
    readonly revShareHook: DurationClock;
    readonly launchpadKit: DurationClock | null;
    readonly launchGuardHook: DurationClock | null;
  };
  /**
   * Every `RevShareHook` a surface may meet on this chain: the current one and
   * each retired one that still hosts pools. Look a hook up with
   * `revShareHookRecord`; an address not listed here has an UNKNOWN shape.
   */
  readonly revShareHooks: readonly RevShareHookRecord[];

  /* -- tokens -------------------------------------------------------------- */

  /**
   * Tokens whose decimals have been read off their own contracts.
   *
   * NOT a token list for a UI to offer — there is no on-chain token registry
   * and this is not a substitute for one. It is the set this repo has actually
   * transacted with, carried so nobody has to guess a decimals value.
   */
  readonly tokens: readonly TokenInfo[];
}

/* ============================================================================
   THE TABLE.

   Edit HERE for a redeploy, and only here. Everything downstream — the dapp,
   the scaffolded tenant app, the keeper, any integrator — reads through this.
   ============================================================================ */

/*
 * The table itself, unannotated and `as const` so its KEYS and its `key` fields
 * are literal types the chain-id and chain-key unions above are read off. The
 * shape check happens once, on the annotated `LATCH_DEPLOYMENTS` below: a field
 * of the wrong type, or a missing required address, is an error there and
 * points at the offending line here.
 */
const DEPLOYMENTS_TABLE = {
  /* --------------------------------------------------------------------------
     Robinhood Chain — mainnet. REDEPLOYED 2026-09-27 (owner 2026-09-26: "we
     are redeploying on robinhood"): a fresh stack from the same deployer and
     salts as Base, so every Latch address below equals Base's. Nothing was
     migrated from the first stack (2026-09-11, bound to the retired Vault
     0x78e8…fB6c); those contracts stay on chain and are no longer read.

     OWNERSHIP MUST BE READ, NOT ASSUMED. The Safe and the custody timelock are
     identifiers here, not claims about who owns what at any given block: read
     `owner()` / `pendingOwner()` on the contract you care about.
     -------------------------------------------------------------------------- */
  4663: {
    chainId: 4663,
    key: "robinhood",
    name: "Robinhood Chain",
    /* Official explorer (owner 2026-09-27); Etherscan chainlist: 4663 -> robin.etherscan.io, v2 API live. */
    explorer: "https://robin.etherscan.io",
    isMainnet: true,
    /* The REDEPLOYED stack (2026-09-27, owner 2026-09-26: "we are redeploying on robinhood"): first
       transaction, the core Create3Factory, landed in L2 block 74,028,398. The first stack (from block
       60,111,836) is retired and bound to the retired Vault 0x78e8…fB6c. */
    deployedAtBlock: 74028398n,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },

    /* Arbitrum Nitro. Measured 2026-09-13: eth_call NUMBER 25,972,228 while
       eth_blockNumber read 62,397,593; the latest header's l1BlockNumber matched
       NUMBER, and over 3,428 s of headers NUMBER advanced 283 (12.1 s each).
       Mined-state proof: ERC20Votes 0x1eae…8888 checkpointed L2 block
       62,356,430 at key 25,971,883, that block's l1BlockNumber. The RPC's own
       0.102 s blocks are the LOG clock only. */
    contractBlockClock: "parent-l1",
    contractBlockTimeCentis: 1200,

    vault: "0xaC44C903CE3d89054fD5b70e0E396f26b214CBE3",
    clPoolManager: "0x3d4afd3190b1e5036e410abb576f99c02D6fBb20",
    binPoolManager: "0xbD6274D94102C3fCafE043f8EF7C7F33f33B255A",
    clPoolManagerOwner: "0xa66f5f4aE2682a965956Fd6B0E448Ec7D8Ce1a3E",
    binPoolManagerOwner: "0xeA8480331310Cf1EEA2D1d8E41429AE163EcfA51",

    /* LatchProtocolFeeControllerV3, composing over V2 0x03Eda5609a11f9259fB0EBdB8f7671e09A932aBe
       (the same addresses as Base). Whether it is in force is
       `poolManager.protocolFeeController()`, read it. */
    feeController: "0x197855617B40D79b4eaD1b4e0f8Bf6ab41022b19",
    clProtocolFeeController: null,
    binProtocolFeeController: null,

    /* The 3-of-4 Safe of record, created on 4663 on 2026-09-26. The 2-of-3 `0x715a…3432` it
       superseded still exists here and still owns the RETIRED first stack; nothing reads it. */
    governanceSafe: "0xeA7903Ed7d5FAE93CE1500ED2c4df138bDF0a038",
    safe: SAFE_CONTRACTS[4663]!,
    /* No policy timelock: the tier was retired 2026-09-12. Retired contracts are NOT dead: a
       retired LatchRegistry still answers latchCount() and renders as a healthy empty
       marketplace, which is exactly how the 2026-09-10 rename went unnoticed. */
    timelockCustody: "0x71E6B57d1dC373929899e6189771ee9115B4EF14",
    timelockPolicy: null,

    registry: "0x197855eBa41da04f2A380ba612AdD1C48f7a27aA",

    universalRouter: "0xd3dF9e77ed0Cf41B22BB0c7E527caE966CF79695",

    /* LatchFillRouter. `EXECUTOR()` on the router is the authority for its executor. */
    fillRouter: "0x197827dceB223ADDeE5cbdf123C08df6b73016E3",
    clPositionManager: "0x637A989326Fe99e9618A97f68D05621858B68973",
    binPositionManager: "0x585F7D8DAFEA7178ea91a54789f5059C2B1D3998",
    clQuoter: "0x0f971d005eC4E6E2f0dEe532ce4E9469c4D2651A",
    binQuoter: "0x684eD241c7B15eC83b1F4f93c049C6F74f504fEF",
    clPositionDescriptor: "0x69d18C3F0CFf468B9b2afb729b326D93eD2C7A22",

    create3Factory: "0x501D3a1F7674BE9f4BCe56bE81Dc3CafA1E51BD1",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    /* Canonical per docs.robinhood.com/chain/contracts. The predeploys you
       would reach for out of habit — 0x4200…06 and 0xC02aaA… — have NO CODE on
       this chain. */
    weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",

    revShareHook: "0x1978A2C6905aC690f21b23d581dc5b1E0Aa18266",

    launchRegistry: "0x1978f09B8F8886251e2693566822b7aCC30faD59",
    /* v1 kit 0x2a4C…bcA7 and its block-clock guard 0x8b4F…575c are RETIRED with the first stack:
       both are bound to the retired Vault and managers. */
    launchpadKit: null,
    launchGuardHook: null,
    launchpadV2: {
      launchpadKitV2: "0x19789C58f0d648146a698D6d3fAAA40Abb3e68a8",
      launchLegs: "0x1978bCCCe1CfaCD456a1908fe1c8c3198203917A",
      launchTokenFactory: "0x197865Bf8bEb9d597feAfd39136d5aDA2e8DBcD7",
      clLPLocker: "0x1978ECb2789423aE7fB4020dD432bc614741206c",
      binLPLocker: "0x1978029ec07FF1E85FA1fF53d430322D08F8F01f",
      clLaunchGuardHook: "0x1978493942bDE85721d047655Cee31Ef57C0303f",
      binLaunchGuardHook: "0x19785eB03DFeFea2371cc5C5Cd7130B5D829C195",
      padFactory: "0x1978b82718FfbE0f0D2Ab0FfDc575b87fAfeca1C",
    },
    splitFactory: "0x1978F55996c371A30CdE8CA8015B0D362b72Cd53",
    positionLock: "0x1978c7b933371bc4B238939De9dfE047653CFb85",
    tokenLock: "0x19784D694a07bB88380B1e9e3F5d6506190d2A7a",
    multisend: "0x1978DB38B8495b70FBa397b1F41f3dEd4A5FF2c2",
    dropFactory: "0x1978989f87B6F05000e2A0C04451114f1f50C04E",

    /* The redeployed stack is timestamp-clocked throughout. The retired block-numbered
       RevShareHooks below keep their own clock records for readers of their old pools. */
    durationClocks: {
      revShareHook: "timestamp",
      launchpadKit: null,
      launchGuardHook: null,
    },
    revShareHooks: [
      {
        address: "0x1978A2C6905aC690f21b23d581dc5b1E0Aa18266",
        durationClock: "timestamp",
        pendingShape: "timestamp-with-expiry",
        status: "current",
        note: "The redeployed stack (2026-09-27), timestamp source; same address as on Base.",
      },
      {
        address: "0xfC00485AFB2f9C73Bd7F9f5e72d14709233E2aD2",
        durationClock: "contract-block",
        pendingShape: "block-with-expiry",
        status: "retired",
        note:
          "432,000-block delay declared at 0.1 s; on the real ~12 s contract clock that is ~60 days, " +
          "and its proposal TTL ~360 days. No pools.",
      },
      {
        address: "0x23CE34E8199927DD270dddd8579c947542bDE446",
        durationClock: "contract-block",
        pendingShape: "block-no-expiry",
        status: "retired",
        note:
          "Hosts the LTT1/LTT2 pool for as long as it exists. 3,600-block (~12 h) delay and NO expiry: " +
          "a matured proposal stays armed until cancelled or frozen.",
      },
    ],

    tokens: [
      {
        /* `name()` on this contract answers "WETH", not "Wrapped Ether" (read
           2026-09-18 by the token-list generator's chain check, confirmed by a
           direct eth_call). The Sepolia WETH below does say "Wrapped Ether". */
        address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
        symbol: "WETH",
        name: "WETH",
        decimals: 18,
        isTestToken: false,
      },
      {
        /* SIX decimals, not eighteen. Paired against 18-decimal WETH this is a
           10^12 gap in `sqrtPriceX96`, which is a permanent mispricing at
           `initialize`, not a display bug. */
        address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
        symbol: "USDG",
        name: "Global Dollar",
        decimals: 6,
        isTestToken: false,
      },
      /* Robinhood stock tokens, read on chain 2026-09-13: 283-byte beacon
         proxies of `Stock` (implementation 0xb354…5aE2 on Sourcify), beacon +
         registry 0xe10b6f6B275de231345c20D14Ab812db62151b00. Transfer freely
         into the Vault today; the issuer keeps pause / adminBurn / upgrade. */
      {
        address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
        symbol: "NVDA",
        name: "NVIDIA • Robinhood Token",
        decimals: 18,
        isTestToken: false,
        stock: { issuer: "Robinhood", ticker: "NVDA" },
      },
      {
        address: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa",
        symbol: "SPCX",
        name: "Space Exploration Technologies Corp. Class A Common Stock • Robinhood Token",
        decimals: 18,
        isTestToken: false,
        stock: { issuer: "Robinhood", ticker: "SPCX" },
      },
      {
        address: "0x2A21c0826848f2D597B7C87A4B931dE1407958A6",
        symbol: "LTT1",
        name: "Latch Test Token One",
        decimals: 18,
        isTestToken: true,
      },
      {
        address: "0xa29927045BDFfd61B8F539D491085F1b6f7A8bE4",
        symbol: "LTT2",
        name: "Latch Test Token Two",
        decimals: 18,
        isTestToken: true,
      },
    ],
  },

  /* --------------------------------------------------------------------------
     Base — mainnet. Deployed 2026-09-27 (core, periphery, router and the Latch
     release), every contract verified on Sourcify and every address below read
     back on chain after deployment.

     OWNERSHIP MUST BE READ, NOT ASSUMED. The Safe and the custody timelock are
     identifiers here, not claims about who owns what at any given block: read
     `owner()` / `pendingOwner()` on the contract you care about.

     No policy timelock (the tier was retired 2026-09-12), no upstream
     ProtocolFeeControllers and no Kit v1: the release is timestamp-clocked
     throughout.
     -------------------------------------------------------------------------- */
  8453: {
    chainId: 8453,
    key: "base",
    name: "Base",
    explorer: "https://basescan.org",
    isMainnet: true,
    /* The Create3Factory's deployment receipt — the first Latch transaction on Base. */
    deployedAtBlock: 51856606n,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },

    /* OP-stack: `block.number` inside the EVM is Base's own L2 block (~2 s),
       the same clock `eth_blockNumber` reports. See `chains/clock.ts`. */
    contractBlockClock: "native",
    contractBlockTimeCentis: 200,

    vault: "0xaC44C903CE3d89054fD5b70e0E396f26b214CBE3",
    clPoolManager: "0x3d4afd3190b1e5036e410abb576f99c02D6fBb20",
    binPoolManager: "0xbD6274D94102C3fCafE043f8EF7C7F33f33B255A",
    clPoolManagerOwner: "0xa66f5f4aE2682a965956Fd6B0E448Ec7D8Ce1a3E",
    binPoolManagerOwner: "0xeA8480331310Cf1EEA2D1d8E41429AE163EcfA51",

    /* LatchProtocolFeeControllerV3, composing over V2 0x03Eda5609a11f9259fB0EBdB8f7671e09A932aBe.
       Whether it is in force is `poolManager.protocolFeeController()`, read it. */
    feeController: "0x197855617B40D79b4eaD1b4e0f8Bf6ab41022b19",
    clProtocolFeeController: null,
    binProtocolFeeController: null,

    governanceSafe: "0xeA7903Ed7d5FAE93CE1500ED2c4df138bDF0a038",
    safe: SAFE_CONTRACTS[8453]!,
    timelockCustody: "0x71E6B57d1dC373929899e6189771ee9115B4EF14",
    timelockPolicy: null,

    registry: "0x197855eBa41da04f2A380ba612AdD1C48f7a27aA",

    universalRouter: "0xd3dF9e77ed0Cf41B22BB0c7E527caE966CF79695",
    /* LatchFillRouter. Its executor (0xBD024353910230d2C62a70f7464E339801C772b6) is derived;
       `EXECUTOR()` on the router is the authority. */
    fillRouter: "0x197827dceB223ADDeE5cbdf123C08df6b73016E3",
    clPositionManager: "0x637A989326Fe99e9618A97f68D05621858B68973",
    binPositionManager: "0x585F7D8DAFEA7178ea91a54789f5059C2B1D3998",
    clQuoter: "0x0f971d005eC4E6E2f0dEe532ce4E9469c4D2651A",
    binQuoter: "0x684eD241c7B15eC83b1F4f93c049C6F74f504fEF",
    clPositionDescriptor: "0x69d18C3F0CFf468B9b2afb729b326D93eD2C7A22",

    create3Factory: "0x501D3a1F7674BE9f4BCe56bE81Dc3CafA1E51BD1",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    /* The OP-stack predeploy. symbol()/decimals() read on chain 2026-09-27. */
    weth: "0x4200000000000000000000000000000000000006",

    revShareHook: "0x1978A2C6905aC690f21b23d581dc5b1E0Aa18266",

    launchRegistry: "0x1978f09B8F8886251e2693566822b7aCC30faD59",
    launchpadKit: null,
    launchGuardHook: null,
    launchpadV2: {
      launchpadKitV2: "0x19789C58f0d648146a698D6d3fAAA40Abb3e68a8",
      launchLegs: "0x1978bCCCe1CfaCD456a1908fe1c8c3198203917A",
      launchTokenFactory: "0x197865Bf8bEb9d597feAfd39136d5aDA2e8DBcD7",
      clLPLocker: "0x1978ECb2789423aE7fB4020dD432bc614741206c",
      binLPLocker: "0x1978029ec07FF1E85FA1fF53d430322D08F8F01f",
      clLaunchGuardHook: "0x1978493942bDE85721d047655Cee31Ef57C0303f",
      binLaunchGuardHook: "0x19785eB03DFeFea2371cc5C5Cd7130B5D829C195",
      padFactory: "0x1978b82718FfbE0f0D2Ab0FfDc575b87fAfeca1C",
    },
    splitFactory: "0x1978F55996c371A30CdE8CA8015B0D362b72Cd53",
    positionLock: "0x1978c7b933371bc4B238939De9dfE047653CFb85",
    tokenLock: "0x19784D694a07bB88380B1e9e3F5d6506190d2A7a",
    multisend: "0x1978DB38B8495b70FBa397b1F41f3dEd4A5FF2c2",
    dropFactory: "0x1978989f87B6F05000e2A0C04451114f1f50C04E",

    durationClocks: {
      revShareHook: "timestamp",
      launchpadKit: null,
      launchGuardHook: null,
    },
    revShareHooks: [
      {
        /* CLOCK_MODE() read "mode=timestamp" on chain 2026-09-27. */
        address: "0x1978A2C6905aC690f21b23d581dc5b1E0Aa18266",
        durationClock: "timestamp",
        pendingShape: "timestamp-with-expiry",
        status: "current",
        note: "Release-commit timestamp build: seconds-based delay and a 3-day proposal TTL.",
      },
    ],

    tokens: [
      {
        /* symbol() "WETH", name() "Wrapped Ether", decimals() 18, read on chain 2026-09-27. */
        address: "0x4200000000000000000000000000000000000006",
        symbol: "WETH",
        name: "Wrapped Ether",
        decimals: 18,
        isTestToken: false,
      },
    ],
  },

  /* --------------------------------------------------------------------------
     Ethereum Sepolia — testnet. Nothing here is worth anything, and nothing
     here is governed: the deployer EOA still owns everything and the two
     timelocks are deployed but inert (their sole proposer is that same EOA,
     which is a delay on one key, not governance). They are redeployed properly
     before mainnet; per the deployment order.

     Source: `packages/core/script/config/latch-sepolia.json`, plus the periphery
     and router addresses read back after the later periphery deployment.
     -------------------------------------------------------------------------- */
  11155111: {
    chainId: 11155111,
    key: "sepolia",
    name: "Ethereum Sepolia",
    explorer: "https://sepolia.etherscan.io",
    isMainnet: false,
    /* MEASURED, not estimated. Was 11672600n — the 2026-09-13 deployment — while the release
       contracts landed on 2026-09-25, so the indexer's first pass asked for a 105,474-block span
       that ALL FIVE public Sepolia endpoints refused at once and only completed by halving down.
       The earliest event any watched contract has is block 11,778,074 (read from the indexer's
       own table after that backfill, so the whole old range is proven empty rather than assumed
       empty — nothing is lost by starting later). 74 blocks of margin, which costs nothing.
       Raise this after any redeploy that retires the contracts below it. */
    deployedAtBlock: 11778000n,
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },

    /* An L1: NUMBER and eth_blockNumber are the same clock (both 11,699,528
       when probed 2026-09-13), 12 s slots. */
    contractBlockClock: "native",
    contractBlockTimeCentis: 1200,

    vault: "0xCe3d133eb486b448A53437A5073619FbE424d01B",
    clPoolManager: "0xb7C8a11E0B359616eD06256783aF57114841F738",
    binPoolManager: "0xdBA93F91BA5B8535AE2b38be6a3A6CdcfDE6f6f3",
    /* Never deployed here — the managers are owned directly, which is fine on a
       chain holding nothing and is exactly what mainnet must not look like. */
    clPoolManagerOwner: null,
    binPoolManagerOwner: null,

    feeController: "0xc1b7A4e61A4B6ceBA3e308425dc2390c2CE57ea9",
    /* V2 (0x5c43d541…) and V3 (0x19789d7f…) were DEPLOYED on 2026-09-25 but NOT
       INSTALLED: `setProtocolFeeController` on each manager needs the core owner EOA
       0x615C…7854, which the release session does not hold. So the managers still
       answer V1, and these stay null because null means "what the managers actually
       use", not "what exists". Installing them is two transactions by that key. */
    clProtocolFeeController: null,
    binProtocolFeeController: null,

    /* The Safe OF RECORD, created on Sepolia at its canonical address on 2026-09-25
       by replaying the exact initializer from its Base creation transaction (v1.4.1,
       3-of-4, same owners, nonce 0). It owns every contract deployed that day. The
       superseded 2-of-3 Safe 0x715a…3432 is still on chain here and still owns what
       predates the redeploy; read `owner()` rather than inferring from either line. */
    governanceSafe: "0xeA7903Ed7d5FAE93CE1500ED2c4df138bDF0a038",
    safe: SAFE_CONTRACTS[11155111]!,
    timelockCustody: "0x35D72DbEeD5F2CE95a4DFb3917D2CD3c43e544CA",
    timelockPolicy: "0x30897C9e7c1c336cDF68C7494f930C75A355d42F",

    /* Redeployed 2026-09-10 as `LatchRegistry` (was `LatchHookRegistry`). The
       old contract at 0x665e7e5C419d004420C6Cb8c924E1E5Ca31F43DE still answers
       `hookCount()` and still holds the original listing. Nothing reads it; it
       was retired, NOT migrated. That is the silent-stale failure mode this
       module exists to prevent. */
    /* REPLACED 2026-09-25. The 0xB504… build has no `vault()`, so
       `DeployLaunchRegistry.s.sol` reverts against it — replacing it is required on
       Sepolia, not optional. 0xB504… still answers and still holds its listings;
       nothing reads it. */
    registry: "0x1978048a2E1a896384E0540e6dBe7Edc89392695",

    universalRouter: "0xB647CEbd5b8d6bE38C198634828187F482f4874B",

    /* Deployed 2026-09-25 with the rest of the release.
       feeBps 10 inside an immutable maxFeeBps 50; owner is the Safe of record. */
    fillRouter: "0x19783226D9b43E2B3fC7401ae5507D75e4a2A9bc",
    clPositionManager: "0xb3505d48A84651c104a02D41B2b9D8CB84dFEC33",
    binPositionManager: "0x965b1D98BB0cd4E0125D78AD17ea4d2D1d62AE6f",
    clQuoter: "0x4471e61fE697204908CA97CdF4810EeAf406e9C1",
    binQuoter: "0x3544C594f12F7c89aa1D8C596d793b661206Ab17",
    clPositionDescriptor: "0xFe386132bE4A3D85267488A1C64061ba691cfc7a",

    create3Factory: "0x76473D174Aa17C23FBE49CAb50aAc4ED4d8c678F",
    /* NOT the canonical 0x0000…78BA3: Sepolia's canonical Permit2 was not
       usable here, so one was deployed. Do not "correct" this to the mainnet
       constant. */
    permit2: "0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768",
    weth: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",

    /* PREDATES `keyOf`/`hasKey`/`totalTaken` and reverts on all three. The dapp
       reads none of them and sums `RevShareTaken` logs instead. */
    revShareHook: "0x1C86dc775FF3FDADCCF87F132de7a4eb60B6bE28",

    launchRegistry: "0x19786475eFB20fB9972c8A07dBfD2Ed785E18D3C",
    /* Kit v1 was never deployed here and never will be: v2 is the release. */
    launchpadKit: null,
    launchGuardHook: "0x19787323459816B6E76dF78507363269a9458197",
    /* The whole v2 stack, deployed 2026-09-25 from the release commit and exercised
       live: two launches, two swaps, the creator
       tax taken, settled and claimed. Every owner is the Safe of record. */
    launchpadV2: {
      launchpadKitV2: "0x1978DC12388ee2feda6cFDfD7245F543fB019cb8",
      launchLegs: "0x1978367629505f09d16AEd93616A643E25a71550",
      launchTokenFactory: "0x1978c70a0e59A6b52477ce34dce050CfC3E4b4A5",
      clLPLocker: "0x1978D33E07d2ED2E155c3F168E3510D027C49A48",
      binLPLocker: "0x19787F213d0988005934A2F87dBD8E5c5E7A0d5E",
      clLaunchGuardHook: "0x19787323459816B6E76dF78507363269a9458197",
      binLaunchGuardHook: "0x1978A3f6d11C9a6cAEa0Df547CbE54A3fa7280f7",
      padFactory: "0x19781ED911c36E5303c972545A31736C94D18604",
    },
    splitFactory: "0x19789714b1fEa5dfECF0761cbAf4Fd1B6FC0728D",
    /* Latch utilities, REDEPLOYED 2026-09-25 by the RELEASE script
       (script/DeployLatchUtilities.s.sol), not by the 2026-09-19 showcase — the rule
       is that every release contract is deployed by its own script, and the showcase
       is a Sepolia convenience that hard-codes the superseded Safe. Owner and fee
       recipient: the Safe of record. TESTNET fee 0.0001 ETH per action, cap 10x,
       1-day notice; the mainnet price is set by the mainnet deploy, not here.
       The 2026-09-19 set (0x9D73…, 0x502d…, 0xDe2e…, 0xbB34…) is still on chain and
       still works; nothing reads it. */
    positionLock: "0x1979B9a756D00149F695C88c2f37f88228746Df9",
    tokenLock: "0x1979481aad83348b537b12a320bd3771e0836Db4",
    multisend: "0x1979f6410B204A31E4f94587768a910Abd0aFAB4",
    dropFactory: "0x197961B758267BE455c9dEb94f9525978d30b392",

    durationClocks: {
      /* 0x1C86… is the OLD block-based hook and stays the address book's
         `revShareHook` until a consumer migrates; the 2026-09-25 redeploy
         0x197837e5… is timestamp-based and is listed in `revShareHooks` below. */
      revShareHook: "contract-block",
      launchpadKit: null,
      launchGuardHook: "timestamp",
    },
    revShareHooks: [
      {
        address: "0x1C86dc775FF3FDADCCF87F132de7a4eb60B6bE28",
        durationClock: "contract-block",
        pendingShape: "block-no-expiry",
        status: "current",
        note: "Predates proposal expiry. An L1, so the contract block clock is the RPC one (12 s).",
      },
      {
        /* Deployed 2026-09-25 by the release script. Read back 2026-09-26 by eth_call:
           19,733 bytes of code, getHooksRegistrationBitmap() 0x0881, CLOCK_MODE "mode=timestamp",
           CONFIG_PROPOSAL_TTL_SECONDS 259,200, owner() the Safe of record 0xeA79…a038, vault() and
           poolManager() this chain's Vault and CL pool manager. */
        address: "0x197837E55B7EA86120743d8F6eD9d4bbe50FC9CA",
        durationClock: "timestamp",
        pendingShape: "timestamp-with-expiry",
        status: "live",
        note: "Release-commit timestamp build: seconds-based delay and a 3-day proposal TTL. Not yet the address book's revShareHook.",
      },
    ],

    tokens: [
      {
        address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
        symbol: "WETH",
        name: "Wrapped Ether",
        decimals: 18,
        isTestToken: false,
      },
      {
        address: "0x5c00ea81EedcED610c5174b9D20F83Ca245e269C",
        symbol: "ltUSD",
        name: "Latch Test USD",
        decimals: 18,
        isTestToken: true,
      },
      {
        address: "0xbEf6E0f94Fe1a96390Eb25D32759aad85fD1f067",
        symbol: "ltETH",
        name: "Latch Test ETH",
        decimals: 18,
        isTestToken: true,
      },
    ],
  },
} as const;

/**
 * Every Latch contract on every chain.
 *
 * This annotation is the shape check for `DEPLOYMENTS_TABLE` above: a typo, a
 * wrong type or a missing required address fails HERE and names the field.
 */
export const LATCH_DEPLOYMENTS: Readonly<Record<LatchChainId, LatchDeployment>> = DEPLOYMENTS_TABLE;

/** Every chain in the table, ascending. Derived — never written out by hand. */
export const LATCH_CHAIN_IDS: readonly LatchChainId[] = (
  Object.keys(DEPLOYMENTS_TABLE).map(Number) as LatchChainId[]
).sort((a, b) => a - b);

/**
 * The mainnets only. Iterate this, not `LATCH_CHAIN_IDS`, anywhere a testnet
 * being present would be a bug.
 *
 * BOTH LISTS EXIST ON PURPOSE, and the reasoning is worth keeping because the
 * obvious move is to ship one. Dropping Sepolia was considered and rejected: a
 * developer building a hook needs a deployed Latch to test against before
 * putting one in a real swap path, and a mainnet-only address book means they
 * hand-type testnet addresses — which is precisely the drift this module was
 * created to end.
 *
 * The real risk was never that a testnet is listed. It is that one gets
 * SELECTED by a default nobody revisited. So the answer is a narrower list for
 * the code paths where that would matter, rather than a smaller table that
 * makes honest testing harder.
 *
 * `LATCH_DEPLOYMENTS[id].isMainnet` is the per-record form of the same fact.
 */
export const LATCH_MAINNET_CHAIN_IDS: readonly LatchChainId[] = LATCH_CHAIN_IDS.filter(
  (id) => LATCH_DEPLOYMENTS[id].isMainnet,
);

/**
 * Native currency per chain, split out for callers that want only this.
 *
 * Derived. Do not restate a chain here: a hand-written map is how a third chain
 * gets a fourth-hand ETH entry with the wrong symbol on a chain whose gas token
 * is not ether at all.
 */
export const NATIVE_CURRENCY: Readonly<Record<LatchChainId, NativeCurrency>> = Object.freeze(
  Object.fromEntries(
    LATCH_CHAIN_IDS.map((id) => [id, LATCH_DEPLOYMENTS[id].nativeCurrency] as const),
  ) as Record<LatchChainId, NativeCurrency>,
);

/**
 * Contracts whose address is a MOVING TARGET.
 *
 * Not a style note — a warning about failure modes. Each of these can be
 * replaced without anything downstream noticing, because the retired instance
 * keeps answering: a dead `LatchRegistry` returns a count, a superseded
 * `RevShareHook` returns balances for pools nobody uses any more, a replaced
 * timelock still reports its delay. None of that throws.
 *
 * The correct handling is to read them from this module at call time rather
 * than snapshot them into a config, a database or a deployed front end's build.
 * Everything NOT on this list — the Vault above all — is immutable or has never
 * been replaced.
 */
export const REDEPLOYABLE_CONTRACTS = [
  "registry",
  "revShareHook",
  "timelockCustody",
  "timelockPolicy",
  "feeController",
  "launchRegistry",
  "launchpadKit",
  "launchGuardHook",
] as const satisfies readonly (keyof LatchDeployment)[];

export type RedeployableContract = (typeof REDEPLOYABLE_CONTRACTS)[number];

/** Keys of `LatchDeployment` that hold a single contract address. */
export type ContractKey = {
  [K in keyof LatchDeployment]: LatchDeployment[K] extends Address | null ? K : never;
}[keyof LatchDeployment];

/**
 * Whether the address book knows this chain. Derived from the table's keys, so
 * a chain added there is recognised everywhere without a second edit.
 */
export function isLatchChainId(chainId: number): chainId is LatchChainId {
  return Object.prototype.hasOwnProperty.call(DEPLOYMENTS_TABLE, chainId);
}

/**
 * The deployment for a chain, or `undefined`.
 *
 * `undefined` rather than a throw, because "Latch is not on this chain" is a
 * perfectly ordinary answer that a UI should render, not an exception.
 */
export function getDeployment(chainId: number): LatchDeployment | undefined {
  return isLatchChainId(chainId) ? LATCH_DEPLOYMENTS[chainId] : undefined;
}

/**
 * The deployment for a chain, or a thrown error naming the supported chains.
 *
 * For call sites that cannot proceed — a swap builder, a deploy script. Failing
 * loudly beats defaulting to another chain, which is how a testnet call ends up
 * signed against mainnet.
 */
export function requireDeployment(chainId: number): LatchDeployment {
  const d = getDeployment(chainId);
  if (d === undefined) {
    throw new Error(
      `Latch is not deployed on chain ${chainId}. Deployed: ` +
        LATCH_CHAIN_IDS.map((id) => `${id} (${LATCH_DEPLOYMENTS[id].name})`).join(", ") +
        ".",
    );
  }
  return d;
}

/**
 * One contract address, or a thrown error that says which chain lacks it.
 *
 * The point is the message. `readContract` against `null` throws something
 * about an invalid address; this throws "LaunchpadKit is not deployed on
 * Robinhood Chain (4663)", which is the sentence the caller needed.
 */
export function requireContract(deployment: LatchDeployment, key: ContractKey): Address {
  const value = deployment[key] as Address | null;
  if (value === null) {
    throw new Error(
      `${key} is not deployed on ${deployment.name} (${deployment.chainId}). ` +
        "It is recorded as null in @latchprotocol/sdk deployments, which means " +
        "not-yet-deployed — handle its absence rather than substituting an address.",
    );
  }
  return value;
}

/** A known token on a chain, by symbol (case-insensitive). `undefined` if unknown. */
export function tokenBySymbol(
  chainId: LatchChainId,
  symbol: string,
): TokenInfo | undefined {
  const wanted = symbol.toLowerCase();
  return LATCH_DEPLOYMENTS[chainId].tokens.find((t) => t.symbol.toLowerCase() === wanted);
}

/** A known token on a chain, by address (case-insensitive). `undefined` if unknown. */
export function tokenByAddress(
  chainId: LatchChainId,
  address: string,
): TokenInfo | undefined {
  const wanted = address.toLowerCase();
  return LATCH_DEPLOYMENTS[chainId].tokens.find((t) => t.address.toLowerCase() === wanted);
}

/**
 * The record for a `RevShareHook` at `address` on `chainId`, current or retired,
 * or `undefined` when the address book does not know it.
 *
 * `undefined` is a real answer. A tenant's own hook, or a hook deployed after
 * this build of the SDK, has an unknown shape: render "unrecognised hook"
 * rather than decoding it through a layout that might be wrong.
 */
export function revShareHookRecord(chainId: number, address: string): RevShareHookRecord | undefined {
  const d = getDeployment(chainId);
  if (d === undefined) return undefined;
  const wanted = address.toLowerCase();
  return d.revShareHooks.find((h) => h.address.toLowerCase() === wanted);
}

/**
 * The duration clock of one of a deployment's time-bounded contracts, or a
 * thrown error when that contract is not deployed on this chain.
 */
export function requireDurationClock(
  deployment: LatchDeployment,
  key: keyof LatchDeployment["durationClocks"],
): DurationClock {
  const clock = deployment.durationClocks[key];
  if (clock === null) {
    throw new Error(`${key} is not deployed on ${deployment.name} (${deployment.chainId}), so it has no clock.`);
  }
  return clock;
}

/**
 * The kit v2 stack on a chain, every address present, or a thrown error naming
 * what is missing. A partially filled group is a deployment in progress: a kit
 * whose lockers or guards are not recorded cannot be checked, so it is refused.
 */
export function requireLaunchpadV2(deployment: LatchDeployment): { readonly [K in keyof LaunchpadV2Deployment]: Address } {
  const g = deployment.launchpadV2;
  const missing = (Object.keys(g) as (keyof LaunchpadV2Deployment)[]).filter((k) => g[k] === null);
  if (missing.length > 0) {
    throw new Error(
      `LaunchpadKitV2 is not deployed on ${deployment.name} (${deployment.chainId}): ${missing.join(", ")} ` +
        "recorded as null in @latchprotocol/sdk deployments.",
    );
  }
  return g as { readonly [K in keyof LaunchpadV2Deployment]: Address };
}

export function explorerTxUrl(chainId: LatchChainId, hash: string): string {
  return `${LATCH_DEPLOYMENTS[chainId].explorer}/tx/${hash}`;
}

export function explorerAddressUrl(chainId: LatchChainId, address: string): string {
  return `${LATCH_DEPLOYMENTS[chainId].explorer}/address/${address}`;
}

// Safe v1.4.1 contract addresses per chain (see ./safe.ts). Re-exported here so
// the `deployments` namespace and the `./deployments` subpath carry them.
export { SAFE_CONTRACTS, SAFE_CONTRACT_CHAIN_IDS, SAFE_TX_TYPES, requireSafeContracts, safeContractsFor } from "./safe.js";
export type { SafeContracts } from "./safe.js";
