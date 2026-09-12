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

/** Chains where Latch's shared core is deployed and verified. */
export type LatchChainId = 4663 | 11155111;

/** Stable key per chain. Matches the keys in `chains/endpoints.ts`. */
export type LatchChainKey = "robinhood" | "sepolia";

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
}

export interface NativeCurrency {
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
}

/**
 * A real pool created by this repo's own exercise scripts and driven end to end.
 *
 * Present so an integrator has something concrete to read against on day one.
 * It is a REFERENCE, never a default: a chain without one carries `null`, and a
 * caller must handle that rather than fall through to another chain's pool.
 * Showing a Sepolia pool under a mainnet header is the same class of error as
 * inventing the number outright.
 */
export interface ReferencePool {
  readonly id: `0x${string}`;
  readonly token0: Address;
  readonly token1: Address;
  readonly symbol0: string;
  readonly symbol1: string;
  /** LP fee in pips of 1_000_000. 3000 = 0.30%. */
  readonly lpFee: number;
  readonly tickSpacing: number;
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
   * `LatchProtocolFeeController` — the contract governance points a pool
   * manager at. Deployed does NOT mean wired: read
   * `poolManager.protocolFeeController()` to find out whether it is in force,
   * and expect `address(0)`.
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
  /** 6h tier. Fee policy, descriptor, router — reversible ones. */
  readonly timelockPolicy: Address;

  /* -- directory ---------------------------------------------------------- */

  /**
   * `LatchRegistry` — the Latch Marketplace's backing contract.
   *
   * REDEPLOYABLE, and its stale failure mode is silent: a retired registry
   * answers `latchCount()` with a number and renders as a healthy, empty
   * marketplace. Read it from here and nowhere else.
   */
  readonly registry: Address;

  /* -- periphery and router ----------------------------------------------- */

  readonly universalRouter: Address;
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
   * `LatchLaunchRegistry`, `LaunchpadKit` and the `LaunchGuardHook` a launch
   * pool attaches. All three are `null` on every chain today — they are coming,
   * and until they land the honest answer is "not configured", not an address.
   */
  readonly launchRegistry: Address | null;
  readonly launchpadKit: Address | null;
  readonly launchGuardHook: Address | null;

  /* -- tokens and reference pool ------------------------------------------ */

  /**
   * Tokens whose decimals have been read off their own contracts.
   *
   * NOT a token list for a UI to offer — there is no on-chain token registry
   * and this is not a substitute for one. It is the set this repo has actually
   * transacted with, carried so nobody has to guess a decimals value.
   */
  readonly tokens: readonly TokenInfo[];
  /** See `ReferencePool`. `null` on a chain where nothing has been initialised. */
  readonly demoPool: ReferencePool | null;
}

/* ============================================================================
   THE TABLE.

   Edit HERE for a redeploy, and only here. Everything downstream — the dapp,
   the scaffolded tenant app, the keeper, any integrator — reads through this.
   ============================================================================ */

export const LATCH_DEPLOYMENTS: Readonly<Record<LatchChainId, LatchDeployment>> = {
  /* --------------------------------------------------------------------------
     Robinhood Chain — the FIRST MAINNET. Deployed 2026-09-11; all eighteen
     contracts verified on Sourcify (Blockscout's own endpoint 403s behind
     Cloudflare, so do not retry that route). Full record in
     `ops/safe/robinhood-deployment.md`.

     GOVERNANCE IS REAL HERE. Every contract answers to the 2-of-3 Safe and the
     handover to the two timelocks is queued. A screen that says "owned by a
     timelock" must read `owner()`; it cannot infer it from this file.
     -------------------------------------------------------------------------- */
  4663: {
    chainId: 4663,
    key: "robinhood",
    name: "Robinhood Chain",
    explorer: "https://robinhoodchain.blockscout.com",
    isMainnet: true,
    /* Block the first Latch contract landed — the two timelocks. */
    deployedAtBlock: 60111836n,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },

    vault: "0x78e8359c6D34Df797b8A793dE8c7c6bffA97fB6c",
    clPoolManager: "0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66",
    binPoolManager: "0x1bB57b3A59b69f128700Ff59cC6EE22835aE6979",
    clPoolManagerOwner: "0x5D7111d6c624e9a08aE63d342E4baE5878989a67",
    binPoolManagerOwner: "0x98920e33313257Ffd942f94379A7ced216462665",

    feeController: "0x2a03E6E6900b9cF93CcC27e3A75a5a95FB4a154c",
    clProtocolFeeController: "0xb1cC5BDBADD19a2430131EaE332afD72fF6be64B",
    binProtocolFeeController: "0x320feB54e940741AeB037E3944F2C95afAEE84af",

    governanceSafe: "0x715a6176946aDbD22c1B2021d321Fb3767ca3432",
        /* REDEPLOYED 2026-09-12, all six Sourcify-verified. The addresses above
       these are the originals and are retired, NOT dead: a retired
       LatchRegistry still answers latchCount() and renders as a healthy empty
       marketplace, which is exactly how the 2026-09-10 rename went unnoticed.
       Retired: registry 0xE4395085…, revShareHook 0x23CE34E8…, timelockCustody
       0x63F08A69…. The LTT1/LTT2 pool stays bound to the OLD RevShareHook
       forever, because poolKey.hooks is part of the pool id. */
timelockCustody: "0x3aE354e2cdFB9Cb855ABA41c825F6Ee53f28e119",
    timelockPolicy: "0x1Da3AD33AB8151Af9EE91b90fA23fFdDFf9C0C3A",

    registry: "0xb2c8BB7473A09b0906f192D69e30D7362fA988CC",

    universalRouter: "0x2220dF8ec6CABC7f2074bC1e56DA092B765f736c",
    clPositionManager: "0x957cc13b24a563cc92253213d9d5e6954c8db6a7",
    binPositionManager: "0x990f395003c35a0ab390e10b003972407f882399",
    clQuoter: "0xdfd14247f87d1e4fc82f0f441fb43bc8aa466114",
    binQuoter: "0xbee22c7edf206b3f24fa0e86ccdd2f35738eb28c",
    clPositionDescriptor: "0x0af03bee134ce66ee12425ee05a50f32c72644eb",

    create3Factory: "0x6ffdf9a3df7e9dd55bad2e60c7405cd181005633",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    /* Canonical per docs.robinhood.com/chain/contracts. The predeploys you
       would reach for out of habit — 0x4200…06 and 0xC02aaA… — have NO CODE on
       this chain. */
    weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",

    revShareHook: "0xfC00485AFB2f9C73Bd7F9f5e72d14709233E2aD2",

    launchRegistry: "0x6D10B4CeDb53aD50c5A1D83f27fcE9c5C3b15c94",
    launchpadKit: "0x2a4CA9809C873f9a7eb132cb073710F26D0bBcA7",
    launchGuardHook: "0x8b4F6699F1D2E1b368aDFb802D14adf4e474575c",

    tokens: [
      {
        address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
        symbol: "WETH",
        name: "Wrapped Ether",
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

    /* The FIRST POOL ON MAINNET, created by
       `packages/hooks-revshare/script/ExerciseRobinhood.s.sol` with RevShareHook
       attached and exercised end to end — configure, initialize, add liquidity,
       swap both directions, fees accrued and readable.

       LTT1/LTT2 are deliberately throwaway. Initializing a pool fixes its
       starting price permanently, and the deployer holds no WETH or USDG to
       defend a price it set on a real pair — an empty mispriced pool is a trap
       for whoever LPs into it first. */
    demoPool: {
      id: "0xcb1fbdafcaa52a0cc8f5ece1752737c2a5eec2b7242953270c15bdd9818a50e8",
      token0: "0x2A21c0826848f2D597B7C87A4B931dE1407958A6",
      token1: "0xa29927045BDFfd61B8F539D491085F1b6f7A8bE4",
      symbol0: "LTT1",
      symbol1: "LTT2",
      lpFee: 3000,
      tickSpacing: 60,
    },
  },

  /* --------------------------------------------------------------------------
     Ethereum Sepolia — testnet. Nothing here is worth anything, and nothing
     here is governed: the deployer EOA still owns everything and the two
     timelocks are deployed but inert (their sole proposer is that same EOA,
     which is a delay on one key, not governance). They are redeployed properly
     before mainnet; see CLAUDE.md "Deployment order".

     Source: `packages/core/script/config/latch-sepolia.json`, plus the periphery
     and router addresses read back after the later periphery deployment.
     -------------------------------------------------------------------------- */
  11155111: {
    chainId: 11155111,
    key: "sepolia",
    name: "Ethereum Sepolia",
    explorer: "https://sepolia.etherscan.io",
    isMainnet: false,
    deployedAtBlock: 11672600n,
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },

    vault: "0xCe3d133eb486b448A53437A5073619FbE424d01B",
    clPoolManager: "0xb7C8a11E0B359616eD06256783aF57114841F738",
    binPoolManager: "0xdBA93F91BA5B8535AE2b38be6a3A6CdcfDE6f6f3",
    /* Never deployed here — the managers are owned directly, which is fine on a
       chain holding nothing and is exactly what mainnet must not look like. */
    clPoolManagerOwner: null,
    binPoolManagerOwner: null,

    feeController: "0xc1b7A4e61A4B6ceBA3e308425dc2390c2CE57ea9",
    clProtocolFeeController: null,
    binProtocolFeeController: null,

    /* Same Safe address as Robinhood, same owners, same threshold — but here it
       owns nothing. Read `owner()`; do not infer authority from this line. */
    governanceSafe: "0x715a6176946aDbD22c1B2021d321Fb3767ca3432",
    timelockCustody: "0x35D72DbEeD5F2CE95a4DFb3917D2CD3c43e544CA",
    timelockPolicy: "0x30897C9e7c1c336cDF68C7494f930C75A355d42F",

    /* Redeployed 2026-09-10 as `LatchRegistry` (was `LatchHookRegistry`). The
       old contract at 0x665e7e5C419d004420C6Cb8c924E1E5Ca31F43DE still answers
       `hookCount()` and still holds the original listing. Nothing reads it; it
       was retired, NOT migrated. That is the silent-stale failure mode this
       module exists to prevent. */
    registry: "0xB504da43C6ED342a511f3e5849f53035F2C807d1",

    universalRouter: "0xB647CEbd5b8d6bE38C198634828187F482f4874B",
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

    launchRegistry: null,
    launchpadKit: null,
    launchGuardHook: null,

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

    /* Created by `packages/fees/script/ExerciseSepolia.s.sol`. Real liquidity,
       real swaps, worthless tokens. ltUSD is 18 decimals despite the name —
       nothing prices these, and no dollar figure may be derived from them. */
    demoPool: {
      id: "0x1373a1db3e21b471647422e89bd87e4e97c0a5d0d2af24194226a40a5a402b38",
      token0: "0x5c00ea81EedcED610c5174b9D20F83Ca245e269C",
      token1: "0xbEf6E0f94Fe1a96390Eb25D32759aad85fD1f067",
      symbol0: "ltUSD",
      symbol1: "ltETH",
      lpFee: 3000,
      tickSpacing: 60,
    },
  },
};

/** Every chain in the table, ascending. */
export const LATCH_CHAIN_IDS: readonly LatchChainId[] = [4663, 11155111];

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

/** Native currency per chain, split out for callers that want only this. */
export const NATIVE_CURRENCY: Readonly<Record<LatchChainId, NativeCurrency>> = {
  4663: LATCH_DEPLOYMENTS[4663].nativeCurrency,
  11155111: LATCH_DEPLOYMENTS[11155111].nativeCurrency,
};

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

export function isLatchChainId(chainId: number): chainId is LatchChainId {
  return chainId === 4663 || chainId === 11155111;
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

export function explorerTxUrl(chainId: LatchChainId, hash: string): string {
  return `${LATCH_DEPLOYMENTS[chainId].explorer}/tx/${hash}`;
}

export function explorerAddressUrl(chainId: LatchChainId, address: string): string {
  return `${LATCH_DEPLOYMENTS[chainId].explorer}/address/${address}`;
}
