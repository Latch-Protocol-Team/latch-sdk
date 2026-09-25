// SPDX-License-Identifier: MIT
/* ============================================================================
   TOKENISED STOCKS, PER CHAIN — a verified registry, not a claim.

   Every record here was READ FROM THE CHAIN on `verifiedAt` (eth_call and
   eth_getLogs only; nothing was sent): name, symbol, decimals, proxy slots,
   the implementation behind the beacon, the issuer's control surface, and a
   simulated `transfer(<arbitrary contract>, 1)` from a real holder. The
   commands, RPCs and the per-issuer risk profile are in
   `docs/stocks-by-chain.md`; this file is the machine-readable half.

   What a record does NOT say: that the token is safe, priced, liquid, or that
   the issuer will keep behaving as it did on `verifiedAt`. Every issuer here
   can change the token's behaviour (upgrade, policy, pause) without a
   redeploy. A UI must render the `controls` beside any stock pair.

   Two issuer designs matter for a pool, and `controls.rebasing` separates
   them:

     * UI-MULTIPLIER tokens (Robinhood `Stock`, Binance `SecuritiesToken`,
       Coinbase B20). Raw `balanceOf` is fixed; a share count is
       `raw × multiplier`. A pool holds raw units, which never move under it.
       Only the PRICE of a raw unit changes at a split. Usable as a pool
       currency with the multiplier surfaced.
     * REBASING tokens (Dinari `DShare`, Backed `BackedAutoFeeToken`). Raw
       `balanceOf` itself is `shares × multiplier`; the operator changes the
       multiplier and every balance moves, the Vault's included. The Vault's
       reserve accounting is by amount, not by share, so a rebase either
       strands value (positive) or makes the Vault insolvent for that currency
       (negative). NOT usable as a pool currency in the Infinity Vault.

   Adding a token: read it yourself, on the day, and write only what you read.
   `false` in `controls` means the absence was PROVEN from verified source or
   an on-chain read, never assumed; where it could not be determined, say so
   in `notes` and leave the flag `true` (the safe direction for a reader).
   ============================================================================ */

import type { Address } from "viem";

/** How the token's code can change under a holder. */
export type StockProxyKind = "beacon" | "transparent" | "uups" | "none";

/**
 * The issuer's control surface, each answered from verified source or a read.
 * `true` = the power exists (or could not be ruled out); `false` = proven absent.
 */
export interface StockTokenControls {
  /** Transfers can be halted by the issuer (a pause switch on transfer). */
  readonly pause: boolean;
  /** A blocklist / sanctions list gates transfers (either side, or the caller). */
  readonly blocklist: boolean;
  /**
   * Transfers require the counterparty to be on an allowlist. `false` here is
   * proven by a simulated transfer from a real holder INTO an arbitrary,
   * never-registered contract (Multicall3) that returned `true`.
   */
  readonly allowlist: boolean;
  /** The issuer can burn (or seize) from ANY holder's balance, not only its own. */
  readonly issuerBurn: boolean;
  /** The token's code can be replaced (proxy, or a protocol-level implementation). */
  readonly upgradeable: boolean;
  /** Raw units and shares differ by an issuer-set multiplier (display only). */
  readonly uiMultiplier: boolean;
  /** `balanceOf` itself is rescaled by the issuer (shares × multiplier). See the module header. */
  readonly rebasing: boolean;
}

/**
 * For an ERC-4626 WRAPPER over a rebasing security token: the token's own
 * `balanceOf` is a fixed share count, so the wrapper is NOT rebasing while the
 * asset it wraps is. `asset` is what `asset()` returned on `verifiedAt`. The
 * token-list checker uses this to tell a wrapper (`asset()` answers, balance
 * fixed) from a rebasing token (`balancePerShare` / `sharesOf` answer).
 */
export interface StockTokenWrap {
  readonly asset: Address;
  readonly standard: "ERC-4626";
}

export interface StockTokenRecord {
  readonly address: Address;
  /** `symbol()` as read. */
  readonly symbol: string;
  /** `name()` as read. */
  readonly name: string;
  /** `decimals()` as read. */
  readonly decimals: number;
  /** Exchange ticker of the underlying, derived from the issuer's naming. */
  readonly ticker: string;
  /** The issuer as it names itself, plus the product line. */
  readonly issuer: string;
  readonly proxy: StockProxyKind;
  /** The implementation behind the proxy on `verifiedAt`; `null` when `proxy` is `"none"`. */
  readonly implementation: Address | null;
  readonly controls: StockTokenControls;
  /** Present only for an ERC-4626 wrapper over a rebasing token; see `StockTokenWrap`. */
  readonly wraps?: StockTokenWrap;
  /** ISO day (UTC) of the reads that produced this record. */
  readonly verifiedAt: string;
  /** One line, facts only: what was read and what could not be. */
  readonly notes: string;
}

/* ----------------------------------------------------------------------------
   Robinhood Chain (4663) — `Stock` (Sourcify exact match, `src/Stock.sol:Stock`).
   283-byte beacon proxies; beacon AND `ACCESS_CONTROLLED_REGISTRY` are one
   contract, 0xe10b…1b00. `transfer`/`transferFrom` carry `onlyNotPaused` and
   `onlyNotBlocked(from|to|msg.sender)` against the registry's `isBlocked`.
   `adminBurn(from, amount)` is `onlyRole(ADMIN_BURNER_ROLE)` and burns from
   any holder. `updateMultiplier` sets a UI multiplier; raw balances are fixed.
   ---------------------------------------------------------------------------- */
const ROBINHOOD_STOCK_IMPLEMENTATION: Address = "0xb35490d6f9163DE4F80d88dc75c3516eb64C5aE2";
const ROBINHOOD_CONTROLS: StockTokenControls = {
  pause: true,
  blocklist: true,
  allowlist: false,
  issuerBurn: true,
  upgradeable: true,
  uiMultiplier: true,
  rebasing: false,
};

/* ----------------------------------------------------------------------------
   BNB Smart Chain (56) — Binance bStocks, `SecuritiesToken` (Sourcify exact
   match, `src/SecuritiesToken.sol:SecuritiesToken`, 0xCFEd…4e46). 283-byte
   beacon proxies of ONE beacon 0x156d…93a3 (owner 0x4333…8d0C), so every
   bStock is upgraded by one key at once. `_update` checks
   `pauseManager.isTokenPaused(token)` and `compliance.checkIsCompliant(token,
   x)` for `from`, `to` AND `msg.sender` when it is neither. `Compliance`
   (0x53dB…14F4, exact match) is a per-token blocklist plus a global sanctions
   list — a blocklist, not an allowlist. `burn(amount)` burns the CALLER's own
   balance only: there is no burn-from-holder in the verified source, so
   `issuerBurn` is proven false for this implementation (an upgrade could add
   one). ERC-8056 UI multiplier (`uiMultiplier`, `hasPendingMultiplier`).
   ---------------------------------------------------------------------------- */
const BSTOCKS_IMPLEMENTATION: Address = "0xCFEd6c4679297ea4889F8183bC057B4A86C64e46";
const BSTOCKS_CONTROLS: StockTokenControls = {
  pause: true,
  blocklist: true,
  allowlist: false,
  issuerBurn: false,
  upgradeable: true,
  uiMultiplier: true,
  rebasing: false,
};

/* ----------------------------------------------------------------------------
   Base (8453) — three issuers, three designs.

   Dinari dShares — `DShare` (Blockscout-verified, NOT on Sourcify; the
   transfer-restrictor diamond facet 0x3F92…A867 is UNVERIFIED). 321-byte
   beacon proxies of beacon 0x6Aa1…c72a (owner 0x06B0…60a3). `pause()` /
   `unpause()`, `burnFrom(account, value)` — both `TOKEN_OPERATOR_ROLE`.
   `_beforeTokenTransfer` asks the diamond's
   `TransferRestrictor_assertTransferPhase2(from, to)` — a jurisdiction
   matrix over per-address flags (registered / restricted / blocked /
   whitelisted). An unregistered contract passed it on `verifiedAt`, so it is
   not an allowlist TODAY; the matrix is issuer-set and its source is not
   verifiable. REBASING: `balanceOf = sharesOf × balancePerShare`, changed by
   `applySplit` while paused (NVDA reads 10× on `verifiedAt`).

   Coinbase B20 — NOT a contract. `eth_getCode` is the single byte `0xef` on
   three RPCs: a Base protocol-level precompile (Beryl upgrade). `proxy` is
   `"none"` and `upgradeable` is `true` because the implementation lives in
   the node software and changes with it. Transfers are gated by the Policy
   Registry precompile (0x8453…0002, allowlist/blocklist policies per scope);
   `seizeWithMemo(from, to, …)` under `SEIZE_ROLE` moves any holder's balance
   and `burnBlocked` burns a blocked one; `pause([TRANSFER])` halts transfers.
   UI multiplier (`multiplier()`, ERC-8056 scheduling); raw balances fixed.

   Backed bTokens (NOT LISTED) — `BackedAutoFeeTokenImplementation`
   0xa538…D7De (Blockscout-verified, fully), transparent proxies. Read on
   `verifiedAt`: `setPause`, `sanctionsList.isSanctioned(from|to|spender)`,
   `burn(account, …)` only for the burner's OWN or the contract's balance,
   and REBASING with a fee (`balanceOf = shares × multiplier`, decayed by
   `feePerPeriod`). Two of six had `totalSupply() == 0` on Base and none had a
   Transfer in the last ~600k blocks, so no holder existed to simulate a
   transfer from; a record without that read would be a claim, so there is
   none. See `docs/stocks-by-chain.md`.
   ---------------------------------------------------------------------------- */
const DINARI_DSHARE_IMPLEMENTATION: Address = "0x6658e71aB4653D398Bfd12e9bF70e9A2E40DE28c";
const DINARI_CONTROLS: StockTokenControls = {
  pause: true,
  blocklist: true,
  allowlist: false,
  issuerBurn: true,
  upgradeable: true,
  uiMultiplier: false,
  rebasing: true,
};
const COINBASE_B20_CONTROLS: StockTokenControls = {
  pause: true,
  blocklist: true,
  allowlist: false,
  issuerBurn: true,
  upgradeable: true,
  uiMultiplier: true,
  rebasing: false,
};


  /* ----------------------------------------------------------------------------
     HyperEVM (999) — three issuers, read 2026-09-19 03:15–03:45 UTC (head ~46,291,300;
     every figure below was read from the chain rather than from a listing). No
     Latch Vault exists on 999 yet, so the second arbitrary contract in every
     transfer simulation is Permit2 0x0000…BA3 beside Multicall3.

     Backed xStocks, WRAPPED — `WrappedBackedTokenImplementation` v1.0.0
     0x9f5B…ed77 (MIT, hyperevmscan-verified; NOT on Sourcify), transparent
     proxies whose ProxyAdmin 0x3120…8bfa and `owner()` are one Safe 1.3.0
     2-of-3, 0x4975…3a65, with no timelock. An ERC-4626 vault whose SHARE is the
     token: `balanceOf` is a fixed share count and the vault keeps exactly one
     underlying share per wrapper token (`totalAssets() = totalSupply() ×
     multiplier`), so the rebasing xStock underneath (`BackedAutoFeeTokenImplementation`,
     `balanceOf = shares × multiplier`) moves `convertToAssets`, i.e. the PRICE of
     a wrapper token, never a holder's balance. At a split the wrapper keeps
     representing the same economic exposure (no price discontinuity, unlike a
     UI-multiplier raw unit). Controls from the verified source: `setPause`
     (`pauser`) halts transfers; `_beforeTokenTransfer` and `_spendAllowance`
     require `!asset().sanctionsList().isSanctioned(from|to|spender)` — a
     sanctions BLOCKLIST on the underlying's list 0x262f…f07f; no mint/burn on the
     wrapper and the underlying's `burn(account, …)` is restricted to the burner's
     own or the token contract's balance (verified source), so nobody can burn the
     vault's shares TODAY — `issuerBurn: false` is proven for this implementation
     and an upgrade (Safe, no delay) could change it; no multiplier on the wrapper.
     HyperCore-linked (spotMeta tokens 845–849, `evm_extra_wei_decimals` 10): the
     Core system address 0x2000…0<index> is the largest EVM holder and the holder
     the transfers were simulated from.

     Dinari dShares, WRAPPED — `WrappedDShare` 0xAa60…D660 (GPL-3.0-or-later,
     hyperevmscan-verified, NOT on Sourcify), 237-byte beacon proxy of beacon
     0x21e5…9EF2 owned by 0x06B0…60a3 — the same Dinari key that owns the Base
     dShare beacon; no timelock. "Wraps rebasing dShare tokens into a non-rebasing
     ERC4626 vault": the share is the token, fixed per holder; the underlying
     SPCX `DShare` (`balancePerShare` 1e18 on verifiedAt) rebases underneath.
     Controls from the verified source: `_beforeTokenTransfer` requires
     `!transferRestrictor.isBlacklisted(from|to)` on the UNDERLYING's restrictor
     (0xf60f…8766, the access-control diamond — a BLOCKLIST; the diamond's facets
     are the unverified ones known from Base); no pause on wrapper transfers (the
     underlying's `paused()` halts deposit/withdraw only); `recover(account,
     amount)` under `TOKEN_OPERATOR_ROLE` moves the underlying OUT of the vault —
     every holder's backing at once — and the underlying's `burnFrom` can burn the
     vault's balance, hence `issuerBurn: true`. Dinari's docs: dShares that leave a
     KYC environment "automatically become restricted" (ownership rights withheld;
     transfers are not blocked by that status).

     Ondo Stocks — `GMToken` 0x0D25…Fad4 (Sourcify runtime match, 0.8.33), 305-byte
     beacon proxies of beacon 0x2582…ffb6 whose owner AND the tokens' sole
     `DEFAULT_ADMIN_ROLE` holder is a `TimelockController` 0x6253…0E83 with
     `getMinDelay()` 7200 s — the only issuer here whose upgrade is behind a
     delay. `_beforeTokenTransfer`: `_checkTokenIsPaused()` against
     `tokenPauseManager` 0x32f9…b4be, then `compliance.checkIsCompliant(user)` for
     `from`, `to` and a third-party `msg.sender`; `compliance()` is an
     `OndoComplianceGMView` 0xAe79…4F6 (BUSL-1.1, hyperevmscan-verified) that
     forwards to `OndoCompliance` 0x5Ea1…b93a — a per-token BLOCKLIST
     (0x63eB…8255 for the GM identifier) and sanctions list, `UserBlocked` /
     `UserSanctioned`. `burn(from, amount)` under `BURNER_ROLE` burns from any
     holder (role empty on verifiedAt; the admin can grant it), `mint` under
     `MINTER_ROLE` (one address per token); no multiplier, no share accounting
     (the token is total-return: dividends accrue to its price). 35 `…on` tokens
     exist on 999; only the seven with a findable holder (a real-holder transfer
     simulation is part of the method) are listed — INTCon, AMZNon, QQQon, SLVon
     have supply but no Transfer in the last ~6 M blocks, and 24 have zero supply.

     REFUSED (see docs/stocks-by-chain.md): the "(dStock)" `…d` family
     (TransparentUpgradeableProxy → UNVERIFIED implementation 0xFF98…1997, ProxyAdmin
     owned by an EOA 0x6dc7…cE36, `rebase`/`multiplier` selectors in the
     decompile) and the raw rebasing xStocks (`NVDAx` 0xc845…849d and siblings) and
     raw dShares (`SPCX` 0x9b4D…14a3): `balanceOf` rescaled by the issuer.
     ---------------------------------------------------------------------------- */

const BACKED_WRAPPER_IMPLEMENTATION: Address = "0x9f5B00929dB749a65481b7BfD14Bd26d7596ed77";
const BACKED_WRAPPER_CONTROLS: StockTokenControls = {
  pause: true,
  blocklist: true,
  allowlist: false,
  issuerBurn: false,
  upgradeable: true,
  uiMultiplier: false,
  rebasing: false,
};
/* ----------------------------------------------------------------------------
   Ethereum (1) — Ondo Global Markets "Ondo Stocks", `GMToken` (Ondo's own BUSL-1.1
   source, `contracts/globalMarkets/GMToken.sol`). Read 2026-09-20 01:5x UTC: ten
   824-byte BeaconProxies, ALL with the identical runtime
   (keccak 0x9806c820…83bee9), ALL pointing at ONE beacon
   0x985462C9aA4D6c3Ad59Ae6e1e9c0C11347ED1598 whose `implementation()` is
   0xebBcb2cEE51c2FeE4062c9C1270dcb98B0b22250 — so one beacon upgrade changes every
   Ondo Stocks token at once. `compliance()`, `MINTER_ROLE()`, `BURNER_ROLE()`,
   `CONFIGURER_ROLE()` and `DEFAULT_ADMIN_ROLE()` all answer.

   NOT REBASING, and this is the one that matters for a Vault: none of
   `sharesOf(address)`, `balancePerShare()`, `multiplier()` or
   `getCurrentMultiplier()` exists on these tokens. Raw balances are fixed.

   But raw units are NOT shares, and the gap GROWS. Ondo's own documentation
   (docs.ondo.finance/ondo-stocks/token-and-quote-pricing): "a single ACMEon token now
   actually represents the economics of 1.05 shares of ACME stock… the price of the
   tokenized stock will not match the price of the underlying asset". The
   shares-per-token multiplier is published by a SEPARATE contract, `SyntheticSharesOracle`
   0x9BC39DB6fbB44B91a48b8D5A6C208B82B1741bE6, and it accrues with every dividend. So
   `uiMultiplier` is TRUE here even though the multiplier is not on the token, and a
   Chainlink feed that prices the SHARE (`prices: "underlying-share"` in
   `stockFeeds.ts`) is the WRONG reference for a pool of these tokens by exactly that
   drift. Use the `…on` feeds, or apply the oracle.

   `issuerBurn` is TRUE on Ondo's published source and is stricter than Backed's:
   `function burn(address from, uint256 amount) external onlyRole(BURNER_ROLE)` with no
   `from == msg.sender` guard, documented by Ondo as "an admin-burn".

   `allowlist` STAYS TRUE because it was NOT DISPROVED. The proof this file requires is
   a simulated `transfer(<arbitrary contract>, 1)` from a real holder, and no holder
   could be found: every Ethereum endpoint in `chains/endpoints.ts` refuses
   `eth_getLogs` ("the method does not exist / is not available"), so the Transfer scan
   returned nothing on all five, at every span tried. Per this module's header, a power
   that could not be ruled out is recorded as present. `compliance()` gating `from`,
   `to` AND `msg.sender` is in the verified source either way.
   ---------------------------------------------------------------------------- */
const ONDO_GM_IMPLEMENTATION: Address = "0xebBcb2cEE51c2FeE4062c9C1270dcb98B0b22250";
const ONDO_GM_CONTROLS: StockTokenControls = {
  pause: true,
  blocklist: true,
  allowlist: true,
  issuerBurn: true,
  upgradeable: true,
  uiMultiplier: true,
  rebasing: false,
};
/** What every Ondo record repeats; kept here so the ten notes stay about their token. */
const ONDO_GM_NOTE =
  "BeaconProxy (824 B, runtime keccak 0x9806c820…83bee9) of beacon 0x9854…D1598 -> implementation 0xebBc…2250, shared by every Ondo Stocks token; compliance()/MINTER_ROLE()/BURNER_ROLE()/CONFIGURER_ROLE()/DEFAULT_ADMIN_ROLE() answer; no sharesOf/balancePerShare/multiplier/getCurrentMultiplier, so balances are FIXED; shares-per-token accrues in SyntheticSharesOracle 0x9BC3…1bE6, so a share-priced feed drifts from this token; NO holder could be found (every shipped Ethereum endpoint refuses eth_getLogs), so the transfer simulation was NOT run and allowlist stays recorded as present";

const DINARI_WRAPPER_IMPLEMENTATION: Address = "0xAa604aB09422fF13fDd0C122DEA91F06e144D660";
const DINARI_WRAPPER_CONTROLS: StockTokenControls = {
  pause: false,
  blocklist: true,
  allowlist: false,
  issuerBurn: true,
  upgradeable: true,
  uiMultiplier: false,
  rebasing: false,
};
const ONDO_GMTOKEN_IMPLEMENTATION: Address = "0x0D25c65d0CC97Af724fFd7a54Eb287660e8dFad4";
const ONDO_CONTROLS: StockTokenControls = {
  pause: true,
  blocklist: true,
  allowlist: false,
  issuerBurn: true,
  upgradeable: true,
  uiMultiplier: false,
  rebasing: false,
};

/**
 * Tokenised stocks by chain id. Only chains with at least one verified record
 * appear. Every Robinhood entry the address book marks as a stock has a record
 * here (guarded by `test/stocks.test.ts`); the address book need not name every
 * stock, and since 2026-09-18 the PUBLISHED TOKEN LIST is the runtime source of
 * truth for "this token is a stock" — this table is the generator's input and
 * the offline fallback (`resolveStockTokens` in `tokenlists/stocks.ts`).
 */
export const STOCK_TOKENS: Readonly<Record<number, readonly StockTokenRecord[]>> = {
  /* Ethereum (1) — Ondo Global Markets. Addresses from the address list Ondo
     publishes and links from `docs.ondo.finance/addresses.md` (the "EXTERNAL Ondo GM
     Tokens" CSV, 451 rows, fetched 2026-09-19); every one re-read on chain 2026-09-20.
     ONLY the tickers with a verified Chainlink equity feed on THIS chain are listed:
     Ondo publishes 451 of these and a token Latch cannot band against a price is a
     token Latch should not be offering as a pair. See `deployments/stockFeeds.ts`. */
  1: [
    {
      address: "0xf6b1117ec07684D3958caD8BEb1b302bfD21103f",
      symbol: "TSLAon",
      name: "Tesla (Ondo Tokenized)",
      decimals: 18,
      ticker: "TSLA",
      issuer: "Ondo (Global Markets)",
      proxy: "beacon",
      implementation: ONDO_GM_IMPLEMENTATION,
      controls: ONDO_GM_CONTROLS,
      verifiedAt: "2026-09-20",
      notes: `totalSupply 18,370.376; ${ONDO_GM_NOTE}`,
    },
    {
      address: "0xFeDC5f4a6c38211c1338aa411018DFAf26612c08",
      symbol: "SPYon",
      name: "SPDR S&P 500 ETF (Ondo Tokenized)",
      decimals: 18,
      ticker: "SPY",
      issuer: "Ondo (Global Markets)",
      proxy: "beacon",
      implementation: ONDO_GM_IMPLEMENTATION,
      controls: ONDO_GM_CONTROLS,
      verifiedAt: "2026-09-20",
      notes: `totalSupply 52,536.283; ${ONDO_GM_NOTE}`,
    },
    {
      address: "0x0e397938C1Aa0680954093495B70A9F5e2249aBa",
      symbol: "QQQon",
      name: "Invesco QQQ (Ondo Tokenized)",
      decimals: 18,
      ticker: "QQQ",
      issuer: "Ondo (Global Markets)",
      proxy: "beacon",
      implementation: ONDO_GM_IMPLEMENTATION,
      controls: ONDO_GM_CONTROLS,
      verifiedAt: "2026-09-20",
      notes: `totalSupply 35,797.165; ${ONDO_GM_NOTE}`,
    },
    {
      address: "0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE",
      symbol: "NVDAon",
      name: "NVIDIA (Ondo Tokenized)",
      decimals: 18,
      ticker: "NVDA",
      issuer: "Ondo (Global Markets)",
      proxy: "beacon",
      implementation: ONDO_GM_IMPLEMENTATION,
      controls: ONDO_GM_CONTROLS,
      verifiedAt: "2026-09-20",
      notes: `totalSupply 78,376.667; ${ONDO_GM_NOTE}`,
    },
    {
      address: "0xbA47214eDd2bb43099611b208f75E4b42FDcfEDc",
      symbol: "GOOGLon",
      name: "Alphabet Class A (Ondo Tokenized)",
      decimals: 18,
      ticker: "GOOGL",
      issuer: "Ondo (Global Markets)",
      proxy: "beacon",
      implementation: ONDO_GM_IMPLEMENTATION,
      controls: ONDO_GM_CONTROLS,
      verifiedAt: "2026-09-20",
      notes: `totalSupply 29,429.691; ${ONDO_GM_NOTE}`,
    },
    {
      address: "0x8De5D49725550f7b318b2FA0f1B1F118E98E8D0F",
      symbol: "SGOVon",
      name: "iShares 0-3 Month Treasury Bond ETF (Ondo Tokenized)",
      decimals: 18,
      ticker: "SGOV",
      issuer: "Ondo (Global Markets)",
      proxy: "beacon",
      implementation: ONDO_GM_IMPLEMENTATION,
      controls: ONDO_GM_CONTROLS,
      verifiedAt: "2026-09-20",
      notes: `totalSupply 78,078.329; ${ONDO_GM_NOTE}`,
    },
    {
      address: "0xECABE1Ff8a9e1dC55899cf58dac8497ecE5Ae84c",
      symbol: "STRCon",
      name: "Strategy Stretch Preferred (Ondo Tokenized)",
      decimals: 18,
      ticker: "STRC",
      issuer: "Ondo (Global Markets)",
      proxy: "beacon",
      implementation: ONDO_GM_IMPLEMENTATION,
      controls: ONDO_GM_CONTROLS,
      verifiedAt: "2026-09-20",
      notes: `totalSupply 139,644.482; ${ONDO_GM_NOTE}`,
    },
    {
      address: "0x54C1Ff361b402f66c13107421E6A431C3375EF24",
      symbol: "FLHYon",
      name: "Franklin High Yield Corporate ETF (Ondo Tokenized)",
      decimals: 18,
      ticker: "FLHY",
      issuer: "Ondo (Global Markets)",
      proxy: "beacon",
      implementation: ONDO_GM_IMPLEMENTATION,
      controls: ONDO_GM_CONTROLS,
      verifiedAt: "2026-09-20",
      notes: `totalSupply 20,554.461; ${ONDO_GM_NOTE}`,
    },
    {
      address: "0x4f0CA3df1c2e6b943cf82E649d576ffe7B2fABCF",
      symbol: "IAUon",
      name: "iShares Gold Trust (Ondo Tokenized)",
      decimals: 18,
      ticker: "IAU",
      issuer: "Ondo (Global Markets)",
      proxy: "beacon",
      implementation: ONDO_GM_IMPLEMENTATION,
      controls: ONDO_GM_CONTROLS,
      verifiedAt: "2026-09-20",
      notes: `totalSupply 105,130.352; ${ONDO_GM_NOTE}`,
    },
    {
      address: "0xc9eef266834730340A55B6CC24621B31BAF55581",
      symbol: "SPCXon",
      name: "SpaceX (Ondo Tokenized)",
      decimals: 18,
      ticker: "SPCX",
      issuer: "Ondo (Global Markets)",
      proxy: "beacon",
      implementation: ONDO_GM_IMPLEMENTATION,
      controls: ONDO_GM_CONTROLS,
      verifiedAt: "2026-09-20",
      notes: `totalSupply 43,998.483; ${ONDO_GM_NOTE}`,
    },
  ],
  4663: [
    {
      address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
      symbol: "NVDA",
      name: "NVIDIA • Robinhood Token",
      decimals: 18,
      ticker: "NVDA",
      issuer: "Robinhood",
      proxy: "beacon",
      implementation: ROBINHOOD_STOCK_IMPLEMENTATION,
      controls: ROBINHOOD_CONTROLS,
      verifiedAt: "2026-09-17",
      notes:
        "uiMultiplier 1.000775159164630595; tokenPaused false; transfer(Vault 0x78e8…fB6c, 1) from holder 0xa1d6…786a simulated true; totalSupply 91,999.738…",
    },
    {
      address: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa",
      symbol: "SPCX",
      name: "Space Exploration Technologies Corp. Class A Common Stock • Robinhood Token",
      decimals: 18,
      ticker: "SPCX",
      issuer: "Robinhood",
      proxy: "beacon",
      implementation: ROBINHOOD_STOCK_IMPLEMENTATION,
      controls: ROBINHOOD_CONTROLS,
      verifiedAt: "2026-09-17",
      notes:
        "uiMultiplier 1.0; tokenPaused false; transfer(Vault 0x78e8…fB6c, 1) from holder 0x8366…0951 (a contract) simulated true; totalSupply 58,326.978",
    },
    /* The six below were read from the chain on 2026-09-18 (L2 head 66,459,903;
       193 reads): 283-byte beacon proxies, beacon slot = 0xe10b…1b00 (= ACCESS_CONTROLLED_REGISTRY),
       implementation slot and admin slot empty, `implementation()` = 0xb354…5aE2 (the Sourcify
       exact match above), `registry.isBlocked(Multicall3)` and `isBlocked(Vault)` false, none of
       balancePerShare / sharesOf / convertToAssets / convertToShares / asset / getCurrentMultiplier /
       multiplier answers (no share accounting: not rebasing), tokenPaused / paused / oraclePaused
       false, and transfer(Multicall3, 1) AND transfer(Vault, 1) simulated true from the holder named. */
    {
      address: "0x05a3d1Cd21d0C88145E82600E62e7E496e0F222B",
      symbol: "AMC",
      name: "AMC Entertainment • Robinhood Token",
      decimals: 18,
      ticker: "AMC",
      issuer: "Robinhood",
      proxy: "beacon",
      implementation: ROBINHOOD_STOCK_IMPLEMENTATION,
      controls: ROBINHOOD_CONTROLS,
      verifiedAt: "2026-09-18",
      notes:
        "uiMultiplier 1.0 (effectiveAt 0); tokenPaused false; transfer(Multicall3, 1) from holder 0xfbd2…62d8 (a contract, balance 1,522.659…) simulated true; totalSupply 1,216,468.306",
    },
    {
      address: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35",
      symbol: "META",
      name: "Meta Platforms • Robinhood Token",
      decimals: 18,
      ticker: "META",
      issuer: "Robinhood",
      proxy: "beacon",
      implementation: ROBINHOOD_STOCK_IMPLEMENTATION,
      controls: ROBINHOOD_CONTROLS,
      verifiedAt: "2026-09-18",
      notes:
        "uiMultiplier 1.0 (effectiveAt 0); tokenPaused false; transfer(Multicall3, 1) from holder 0x8366…0951 (a contract; a busy token, holder found in a 2,000-block window after a 50,000-block getLogs exceeded the RPC limit) simulated true; totalSupply 8,278.123",
    },
    {
      address: "0x1b0E319c6A659F002271B69dB8A7df2F911c153E",
      symbol: "GME",
      name: "GameStop • Robinhood Token",
      decimals: 18,
      ticker: "GME",
      issuer: "Robinhood",
      proxy: "beacon",
      implementation: ROBINHOOD_STOCK_IMPLEMENTATION,
      controls: ROBINHOOD_CONTROLS,
      verifiedAt: "2026-09-18",
      notes:
        "uiMultiplier 1.0 (effectiveAt 0); tokenPaused false; transfer(Multicall3, 1) from holder 0xd3AF…Ac9e (a contract, balance 3,320.478…) simulated true; totalSupply 132,222.22",
    },
    {
      address: "0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344",
      symbol: "USO",
      name: "United States Oil Fund • Robinhood Token",
      decimals: 18,
      ticker: "USO",
      issuer: "Robinhood",
      proxy: "beacon",
      implementation: ROBINHOOD_STOCK_IMPLEMENTATION,
      controls: ROBINHOOD_CONTROLS,
      verifiedAt: "2026-09-18",
      notes:
        "an ETF, not a share: uiMultiplier 1.0 (effectiveAt 0); tokenPaused false; transfer(Multicall3, 1) from holder 0x6ED1…D0D2 (a contract, balance 314.587…) simulated true; totalSupply 15,276.509",
    },
    {
      address: "0x05b37Fb53A299a1b874A619e1c4C404D52C36F4C",
      symbol: "RDDT",
      name: "Reddit • Robinhood Token",
      decimals: 18,
      ticker: "RDDT",
      issuer: "Robinhood",
      proxy: "beacon",
      implementation: ROBINHOOD_STOCK_IMPLEMENTATION,
      controls: ROBINHOOD_CONTROLS,
      verifiedAt: "2026-09-18",
      notes:
        "uiMultiplier 1.0 (effectiveAt 0); tokenPaused false; transfer(Multicall3, 1) from holder 0xFd64…5fe4 (an EOA, balance 0.0000533…) simulated true; totalSupply 15,956.774",
    },
    {
      address: "0x4EA005168D7F09a7A0Ba9D1DEf21a479950E44C2",
      symbol: "COST",
      name: "Costco • Robinhood Token",
      decimals: 18,
      ticker: "COST",
      issuer: "Robinhood",
      proxy: "beacon",
      implementation: ROBINHOOD_STOCK_IMPLEMENTATION,
      controls: ROBINHOOD_CONTROLS,
      verifiedAt: "2026-09-18",
      notes:
        "uiMultiplier 1.000612040296259656 (effectiveAt 1786374624, already in force; totalSupplyUI 1,469.602… vs totalSupply 1,468.703… — the raw balance is what a pool holds); tokenPaused false; transfer(Multicall3, 1) from holder 0x8366…0951 (a contract, balance 309.111…) simulated true",
    },
  ],
  56: [
    {
      address: "0x10343EF7da3301493D7Ecb647d68A288C6c1Db2F",
      symbol: "AAOIB",
      name: "Applied Optoelectronics",
      decimals: 18,
      ticker: "AAOI",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVMN0; transfer(Multicall3, 1) from holder 0x8894E0a0c962CB723c1976a4421c95949bE2D4E3 simulated true; not paused",
    },
    {
      address: "0x431a3BEE82E2ca41e49895CbECE5bB0F76A89b7A",
      symbol: "AAPLB",
      name: "Apple",
      decimals: 18,
      ticker: "AAPL",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.000603906075632366; identifier AE000A4AVF76; transfer(Multicall3, 1) from holder 0x0605E29b092F82B3De5dAc13cE984Ac80c0c0780 simulated true; not paused",
    },
    {
      address: "0x1282493EdE6a22753D45Cb2C0fdBd8D35E97555a",
      symbol: "ALABB",
      name: "Astera Labs",
      decimals: 18,
      ticker: "ALAB",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVRW0; transfer(Multicall3, 1) from holder 0x97a23b878Ab6CA96Ad4E0b6D6c9D9Df8624bbD44 simulated true; not paused",
    },
    {
      address: "0xa304BD78e739C0F777202B3eB73Ac3736d1df801",
      symbol: "AMATB",
      name: "Applied Materials",
      decimals: 18,
      ticker: "AMAT",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.000748400440519121; identifier AE000A4AVRR0; transfer(Multicall3, 1) from holder 0x8894E0a0c962CB723c1976a4421c95949bE2D4E3 simulated true; not paused",
    },
    {
      address: "0x75Fd4cF6f8392E41E70391D60c90C0D5211603a1",
      symbol: "AMDB",
      name: "Advanced Micro Devices Inc",
      decimals: 18,
      ticker: "AMD",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVCE0; transfer(Multicall3, 1) from holder 0x3d20A80e5E1F5Feb747D66d9Cc76bb1A41d7AA15 simulated true; not paused",
    },
    {
      address: "0x1a4b499833A79A09ad7Cf1D42D7DacF71e92eb00",
      symbol: "AMZNB",
      name: "Amazon",
      decimals: 18,
      ticker: "AMZN",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVF50; transfer(Multicall3, 1) from holder 0x3d20A80e5E1F5Feb747D66d9Cc76bb1A41d7AA15 simulated true; not paused",
    },
    {
      address: "0xD42A79ebb7F527F40fAecD196FFB47aD5e8D6f8C",
      symbol: "ARMB",
      name: "Arm",
      decimals: 18,
      ticker: "ARM",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVMM2; transfer(Multicall3, 1) from holder 0x8894E0a0c962CB723c1976a4421c95949bE2D4E3 simulated true; not paused",
    },
    {
      address: "0xFbfB4f79cFB4C34DCd7C82Bdee5A0Fa199B2e7f9",
      symbol: "ASMLB",
      name: "ASML",
      decimals: 18,
      ticker: "ASML",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVRS8; transfer(Multicall3, 1) from holder 0xb4C3277ccaD9a74Ae7Fbcb1688367C2eF73b2786 simulated true; not paused",
    },
    {
      address: "0x58b6F5fEeb8436489F5bf4a56619092B1FA8E777",
      symbol: "ASTSB",
      name: "AST SpaceMobile",
      decimals: 18,
      ticker: "ASTS",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVRL3; transfer(Multicall3, 1) from holder 0x8894E0a0c962CB723c1976a4421c95949bE2D4E3 simulated true; not paused",
    },
    {
      address: "0x76682c454467b3A1150Ad8b6a92FC5eE2C21d7eD",
      symbol: "AVGOB",
      name: "Broadcom",
      decimals: 18,
      ticker: "AVGO",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVF84; transfer(Multicall3, 1) from holder 0x8894E0a0c962CB723c1976a4421c95949bE2D4E3 simulated true; not paused",
    },
    {
      address: "0x9BDC8B470dbf89DbCb123587C6f5E49cCA3463BE",
      symbol: "AXTIB",
      name: "AXT",
      decimals: 18,
      ticker: "AXTI",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVRH1; transfer(Multicall3, 1) from holder 0x8894E0a0c962CB723c1976a4421c95949bE2D4E3 simulated true; not paused",
    },
    {
      address: "0x4eF9d3062c7F6ebA4AAE4990c5036598C6eff4ec",
      symbol: "BABAB",
      name: "Alibaba",
      decimals: 18,
      ticker: "BABA",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVF68; transfer(Multicall3, 1) from holder 0x4aC6F0593461884f16FEe13794DA04d784AfA3C1 simulated true; not paused",
    },
    {
      address: "0x5519de00F5388c17d886b97Cb5D2D43a812a82bC",
      symbol: "BEB",
      name: "Bloom Energy",
      decimals: 18,
      ticker: "BE",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVXD8; transfer(Multicall3, 1) from holder 0x310eC37281d297d6e61D962411584be5D3307d1b simulated true; not paused",
    },
    {
      address: "0x3548Da95a9eFFE481e8604664d75e95821e557F5",
      symbol: "BMNRB",
      name: "BitMine Immersion Technologies",
      decimals: 18,
      ticker: "BMNR",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AV533; transfer(Multicall3, 1) from holder 0x8894E0a0c962CB723c1976a4421c95949bE2D4E3 simulated true; not paused",
    },
    {
      address: "0x4902C5ebc598265Ed2212b559B042De8a5Eeec3f",
      symbol: "BNCB",
      name: "CEA Industries",
      decimals: 18,
      ticker: "BNC",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AWN91; transfer(Multicall3, 1) from holder 0xFf8A2ae655E5851CB414Ac5aB41B311dA4287281 simulated true; not paused",
    },
    {
      address: "0xe81C6bB0266cd68B4F17278531Dd03eA1F12dA4E",
      symbol: "CBRSB",
      name: "Cerebras",
      decimals: 18,
      ticker: "CBRS",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVMF6; transfer(Multicall3, 1) from holder 0x3F9c446079d7c67E3FA91bE2C5e16B571b35831c simulated true; not paused",
    },
    {
      address: "0x5131859a059B2446AbeeFe0f5d313b3c54Ff3D36",
      symbol: "COHRB",
      name: "Coherent",
      decimals: 18,
      ticker: "COHR",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVSX6; transfer(Multicall3, 1) from holder 0x8894E0a0c962CB723c1976a4421c95949bE2D4E3 simulated true; not paused",
    },
    {
      address: "0x585BDE7C54ABB5cCD7791F923D6c2187635f3952",
      symbol: "COINB",
      name: "Coinbase",
      decimals: 18,
      ticker: "COIN",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVF19; transfer(Multicall3, 1) from holder 0x0Ba95F8b0D96AE5C7f69b5D02ea97C122d575C98 simulated true; not paused",
    },
    {
      address: "0x80f3D493EBCe97e343c53D29a137942416B4ffC0",
      symbol: "CRCLB",
      name: "Circle Internet Group Inc.",
      decimals: 18,
      ticker: "CRCL",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AU3B0; transfer(Multicall3, 1) from holder 0x8294839e6Dca220b540E52C7fD431C8104aA4192 simulated true; not paused",
    },
    {
      address: "0x6E7D451F9D30327D32020f116Fa79C23B24E9c8D",
      symbol: "CRDOB",
      name: "Credo Technology",
      decimals: 18,
      ticker: "CRDO",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVRK5; transfer(Multicall3, 1) from holder 0x8894E0a0c962CB723c1976a4421c95949bE2D4E3 simulated true; not paused",
    },
    {
      address: "0x8C433eCa1be0e2a357015602F63751C768F6f643",
      symbol: "CRMB",
      name: "Salesforce",
      decimals: 18,
      ticker: "CRM",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.001229509379034956; identifier AE000A4AV590; transfer(Multicall3, 1) from holder 0x8894E0a0c962CB723c1976a4421c95949bE2D4E3 simulated true; not paused",
    },
    {
      address: "0x33E7317e17838fEE56b10Fe8D0B9cA6CA3090c95",
      symbol: "CRWVB",
      name: "CoreWeave",
      decimals: 18,
      ticker: "CRWV",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVGA9; transfer(Multicall3, 1) from holder 0x8894E0a0c962CB723c1976a4421c95949bE2D4E3 simulated true; not paused",
    },
    {
      address: "0x0e7A51966c66648999d506e1372EFDeA1B78cb0B",
      symbol: "DELLB",
      name: "Dell",
      decimals: 18,
      ticker: "DELL",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVRQ2; transfer(Multicall3, 1) from holder 0x2d6054c920E94e74F6CEeBc62283Ff77fD4cddB5 simulated true; not paused",
    },
    {
      address: "0xF2ec508422174Ee564de98187db9359D318AFB6b",
      symbol: "DJTB",
      name: "Trump Media & Technology Group Corp",
      decimals: 18,
      ticker: "DJT",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AWFH4; transfer(Multicall3, 1) from holder 0x9aaDBd51515432DBB77c0A7F69C2B2c211f0C837 simulated true; not paused",
    },
    {
      address: "0x93862d63fd9Fd488B1328E9b47717d75e994a84B",
      symbol: "DRAMB",
      name: "Roundhill Memory ETF",
      decimals: 18,
      ticker: "DRAM",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVME9; transfer(Multicall3, 1) from holder 0x1E6E5786fF834deaAC3777155f6dbe5458E3a5b2 simulated true; not paused",
    },
    {
      address: "0xBE82F76637DBA2C114C41Df856c2C51e522E2Cb8",
      symbol: "EWYB",
      name: "iShares MSCI South Korea ETF",
      decimals: 18,
      ticker: "EWY",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVCD2; transfer(Multicall3, 1) from holder 0x8894E0a0c962CB723c1976a4421c95949bE2D4E3 simulated true; not paused",
    },
    {
      address: "0x4af1D41cd9dD950dcA43984b43aaA2A8702714Ac",
      symbol: "FLNCB",
      name: "Fluence Energy",
      decimals: 18,
      ticker: "FLNC",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVSY4; transfer(Multicall3, 1) from holder 0x8a08D98CBB218fceB318Ecf3aBc1BA43D8A7aB0E simulated true; not paused",
    },
    {
      address: "0x740e075cBbEa22a082B9d6679e65e82767875b6A",
      symbol: "GLWB",
      name: "Corning",
      decimals: 18,
      ticker: "GLW",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.00129026931256489; identifier AE000A4AVMD1; transfer(Multicall3, 1) from holder 0x8894E0a0c962CB723c1976a4421c95949bE2D4E3 simulated true; not paused",
    },
    {
      address: "0x46cEeFDa28Dd7207059ed19B0acdc026955bb15C",
      symbol: "GMEB",
      name: "GameStop",
      decimals: 18,
      ticker: "GME",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVSM9; transfer(Multicall3, 1) from holder 0x3F76Ea6a726160bEAc9291aa76a59764206527Dc simulated true; not paused",
    },
    {
      address: "0x3F53De71c126BdaBAe20f9cD64848d317f6C3238",
      symbol: "GOOGLB",
      name: "Alphabet",
      decimals: 18,
      ticker: "GOOGL",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.000478058978107511; identifier AE000A4AVFX3; transfer(Multicall3, 1) from holder 0xe0DA14Cefc1C190e3E011D4269Aa0073e5f2cb20 simulated true; not paused",
    },
    {
      address: "0x1ECfda023C46cA216b5c620eF357A6D0C03951E6",
      symbol: "GPROB",
      name: "GoPro",
      decimals: 18,
      ticker: "GPRO",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AWLQ3; transfer(Multicall3, 1) from holder 0x8F6D49A237445beCf81DDd4861f9E4ADD6a032E9 simulated true; not paused",
    },
    {
      address: "0x20CCe6656E5F7F79f280E2D0F5dB55b401BDbfCe",
      symbol: "GSB",
      name: "Goldman Sachs",
      decimals: 18,
      ticker: "GS",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.003406278840750514; identifier AE000A4AV566; transfer(Multicall3, 1) from holder 0xD44E17d5DAEAB4EC126e2c8395758b55f959298b simulated true; not paused",
    },
    {
      address: "0xee6F4bcc88C2C8583d5a65c7D0C877b464100711",
      symbol: "HIMSB",
      name: "Hims & Hers",
      decimals: 18,
      ticker: "HIMS",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVRX8; transfer(Multicall3, 1) from holder 0x03da7D3c0c0f4741f91b89aeaeCA36465cC6bE6D simulated true; not paused",
    },
    {
      address: "0xA394dCEa3fd3847fD793afBFd163E2e3858B7c65",
      symbol: "HOODB",
      name: "Robinhood",
      decimals: 18,
      ticker: "HOOD",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AU3C8; transfer(Multicall3, 1) from holder 0xc9DDE9641e207B64185E69F66864D760F4210B73 simulated true; not paused",
    },
    {
      address: "0xfA273B076Feb8c0FB34e554ae341082323D016A3",
      symbol: "IBMB",
      name: "IBM",
      decimals: 18,
      ticker: "IBM",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.005005801623174456; identifier AE000A4AVMP5; transfer(Multicall3, 1) from holder 0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF simulated true; not paused",
    },
    {
      address: "0xe614E2fc6C787035FF51f452e8E826Bfd32D5283",
      symbol: "INTCB",
      name: "Intel Corporation",
      decimals: 18,
      ticker: "INTC",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AU3D6; transfer(Multicall3, 1) from holder 0x278d858f05b94576C1E6f73285886876ff6eF8D2 simulated true; not paused",
    },
    {
      address: "0x0735D9904b7e34e6fe39B0f66E00c111b3f2b681",
      symbol: "INTWB",
      name: "GraniteShares 2X Long INTC ETF",
      decimals: 18,
      ticker: "INTW",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AV1P3; transfer(Multicall3, 1) from holder 0x8894E0a0c962CB723c1976a4421c95949bE2D4E3 simulated true; not paused",
    },
    {
      address: "0xfdc2F2caB77b28f7Ef6c819A404706cfA9bCA33b",
      symbol: "IRENB",
      name: "IREN Limited",
      decimals: 18,
      ticker: "IREN",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVR23; transfer(Multicall3, 1) from holder 0x8894E0a0c962CB723c1976a4421c95949bE2D4E3 simulated true; not paused",
    },
    {
      address: "0x1FFAD32d69c5FEAd99f88C25ca0191Edc3757636",
      symbol: "KORUB",
      name: "South Korea Bull 3X ETF",
      decimals: 18,
      ticker: "KORU",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AV1J6; transfer(Multicall3, 1) from holder 0xE2588c219697F520757b82f5B0119D72bDDC0e13 simulated true; not paused",
    },
    {
      address: "0x64748BeA17b6D19e242ADf20425DE2440c656142",
      symbol: "LITEB",
      name: "Lumentum Holdings",
      decimals: 18,
      ticker: "LITE",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVFV7; transfer(Multicall3, 1) from holder 0x8894E0a0c962CB723c1976a4421c95949bE2D4E3 simulated true; not paused",
    },
    {
      address: "0x7425889FE94F9d693E8daefE88BCCed6AcFEf4c0",
      symbol: "METAB",
      name: "Meta Platforms",
      decimals: 18,
      ticker: "META",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVFU9; transfer(Multicall3, 1) from holder 0xC2151a561E928D16576d75Ea88544543ac63D80B simulated true; not paused",
    },
    {
      address: "0x16cd4fe7e8880ECc3ba222795229E20489fc2C76",
      symbol: "MRVLB",
      name: "Marvell Technology",
      decimals: 18,
      ticker: "MRVL",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVFY1; transfer(Multicall3, 1) from holder 0xE2588c219697F520757b82f5B0119D72bDDC0e13 simulated true; not paused",
    },
    {
      address: "0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0",
      symbol: "MSFTB",
      name: "Microsoft",
      decimals: 18,
      ticker: "MSFT",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.001313964833366845; identifier AE000A4AVCW2; transfer(Multicall3, 1) from holder 0x5018b018cEB7645c927c5Cf246786F89ebCbe7Ea simulated true; not paused",
    },
    {
      address: "0xE87afb3076AeB0f9B14E368DE8145ae6a2826A14",
      symbol: "MSTRB",
      name: "Strategy Inc.",
      decimals: 18,
      ticker: "MSTR",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AU3A2; transfer(Multicall3, 1) from holder 0x8894E0a0c962CB723c1976a4421c95949bE2D4E3 simulated true; not paused",
    },
    {
      address: "0xcdf2f3e0fa43C47A6662a91C9E4a7C5f69762699",
      symbol: "MUB",
      name: "Micron Technology Inc",
      decimals: 18,
      ticker: "MU",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.000107512568805603; identifier AE000A4AVAY2; transfer(Multicall3, 1) from holder 0x8894E0a0c962CB723c1976a4421c95949bE2D4E3 simulated true; not paused",
    },
    {
      address: "0x0bB3fA77E0809f42948E435F04883C25415e8263",
      symbol: "MUUB",
      name: "Direxion MU Bull 2X ETF",
      decimals: 18,
      ticker: "MUU",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AV1L2; transfer(Multicall3, 1) from holder 0xE2588c219697F520757b82f5B0119D72bDDC0e13 simulated true; not paused",
    },
    {
      address: "0x7C26a12f20507E2ceE22CeEBed9e88FDA47f866c",
      symbol: "MVLLB",
      name: "GraniteShares 2X Long MRVL ETF",
      decimals: 18,
      ticker: "MVLL",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AV1M0; transfer(Multicall3, 1) from holder 0xcB81b8a9C07bc300f86F7c4876767ed7dadc678F simulated true; not paused",
    },
    {
      address: "0xE256BC2A4F5297F8ba6f043F180a46300eCbCbB1",
      symbol: "NBISB",
      name: "Nebius",
      decimals: 18,
      ticker: "NBIS",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVMG4; transfer(Multicall3, 1) from holder 0x8894E0a0c962CB723c1976a4421c95949bE2D4E3 simulated true; not paused",
    },
    {
      address: "0xD6829Ea836b6FA224d099D40E54B31262f874631",
      symbol: "NFLXB",
      name: "Netflix",
      decimals: 18,
      ticker: "NFLX",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVSA4; transfer(Multicall3, 1) from holder 0x3d20A80e5E1F5Feb747D66d9Cc76bb1A41d7AA15 simulated true; not paused",
    },
    {
      address: "0x7c4d7a180D737Dd5A70d8065a90E6746a69C37EA",
      symbol: "NOKB",
      name: "Nokia",
      decimals: 18,
      ticker: "NOK",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.002349416320445721; identifier AE000A4AVMR1; transfer(Multicall3, 1) from holder 0xD76cB6E9F642CDC7C33C9D4Fc6bDd858116DcC84 simulated true; not paused",
    },
    {
      address: "0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436",
      symbol: "NVDAB",
      name: "NVIDIA Corp",
      decimals: 18,
      ticker: "NVDA",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.000778223752807865; identifier AE000A4AVAZ9; transfer(Multicall3, 1) from holder 0xBA8dB0CAf781cAc69b6acf6C848aC148264Cc05d simulated true; not paused",
    },
    {
      address: "0x4684D9887fC1c71cBa7baB8E88835CEC217eB598",
      symbol: "ORCLB",
      name: "Oracle",
      decimals: 18,
      ticker: "ORCL",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVF35; transfer(Multicall3, 1) from holder 0xE2588c219697F520757b82f5B0119D72bDDC0e13 simulated true; not paused",
    },
    {
      address: "0x0Ca5D51D0277Bd006fd9607d3E560785EBad8222",
      symbol: "PLTRB",
      name: "Palantir Technologies",
      decimals: 18,
      ticker: "PLTR",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVFW5; transfer(Multicall3, 1) from holder 0xBA8dB0CAf781cAc69b6acf6C848aC148264Cc05d simulated true; not paused",
    },
    {
      address: "0x2806a561fC1F9259B2d54A281796Bde0D92762aE",
      symbol: "PYPLB",
      name: "Paypal",
      decimals: 18,
      ticker: "PYPL",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.001771778812964209; identifier AE000A4AV558; transfer(Multicall3, 1) from holder 0xE2588c219697F520757b82f5B0119D72bDDC0e13 simulated true; not paused",
    },
    {
      address: "0x5F7A56e877B9130608Bf8BE962621011182fEfE1",
      symbol: "QCOMB",
      name: "Qualcomm",
      decimals: 18,
      ticker: "QCOM",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.003804323223530061; identifier AE000A4AVFZ8; transfer(Multicall3, 1) from holder 0x8894E0a0c962CB723c1976a4421c95949bE2D4E3 simulated true; not paused",
    },
    {
      address: "0xd721c192d612Db77621DF57A9fAb38418033c02E",
      symbol: "QNTB",
      name: "Quantinuum",
      decimals: 18,
      ticker: "QNT",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVRP4; transfer(Multicall3, 1) from holder 0x8894E0a0c962CB723c1976a4421c95949bE2D4E3 simulated true; not paused",
    },
    {
      address: "0x205812CdBed920aFf76C6580abD681a46D11efc7",
      symbol: "QQQB",
      name: "Invesqo QQQ",
      decimals: 18,
      ticker: "QQQ",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVFT1; transfer(Multicall3, 1) from holder 0x675Af9378b6176af7F7f4cEB289F869499E2354c simulated true; not paused",
    },
    {
      address: "0x41622a9125A22767Df8C1dC79FC17299BAc4Bd0b",
      symbol: "RDDTB",
      name: "Reddit",
      decimals: 18,
      ticker: "RDDT",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AWPE0; transfer(Multicall3, 1) from holder 0xE2588c219697F520757b82f5B0119D72bDDC0e13 simulated true; not paused",
    },
    {
      address: "0xC8Da12cbCCE7c45180692a6420b0076e03a5179a",
      symbol: "RKLBB",
      name: "Rocket Lab",
      decimals: 18,
      ticker: "RKLB",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVMQ3; transfer(Multicall3, 1) from holder 0xE2588c219697F520757b82f5B0119D72bDDC0e13 simulated true; not paused",
    },
    {
      address: "0xCA750eF65f295BBECd685Abf54e82CAf297BDB61",
      symbol: "SKHYB",
      name: "SK Hynix",
      decimals: 18,
      ticker: "SKHY",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVMT7; transfer(Multicall3, 1) from holder 0xbB0bd5b6a7Fd53393Bb92826bd4DdE397E0F2fA3 simulated true; not paused",
    },
    {
      address: "0x387dEa1D2772D716d081A29116f3EfFA0fFE1F36",
      symbol: "SMCIB",
      name: "Super Micro Computer",
      decimals: 18,
      ticker: "SMCI",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVRU4; transfer(Multicall3, 1) from holder 0xE2588c219697F520757b82f5B0119D72bDDC0e13 simulated true; not paused",
    },
    {
      address: "0xBE1fceD7047fdCE935F45700727845df2c76877a",
      symbol: "SMHB",
      name: "VanEck Semiconductor ETF",
      decimals: 18,
      ticker: "SMH",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AV574; transfer(Multicall3, 1) from holder 0x8894E0a0c962CB723c1976a4421c95949bE2D4E3 simulated true; not paused",
    },
    {
      address: "0x3eE4dF61bd4F867E349BEaE8bFE07bc31b4850fb",
      symbol: "SNDKB",
      name: "Sandisk Corporation",
      decimals: 18,
      ticker: "SNDK",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVAX4; transfer(Multicall3, 1) from holder 0x65ec88a7EeeE54A6b4Cf6604d43EDAE415043Fd2 simulated true; not paused",
    },
    {
      address: "0x9e82e3da8f1115B73d24bB24113ab836FfDAb6b6",
      symbol: "SNXXB",
      name: "Tradr 2X Long SNDK ETF",
      decimals: 18,
      ticker: "SNXX",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AV1N8; transfer(Multicall3, 1) from holder 0x3fbD89D8C57FceD7BfCCb20931De1e17e3750071 simulated true; not paused",
    },
    {
      address: "0xd97d097a89113fa59b76c572E5b2Eb647E8eefaf",
      symbol: "SOXLB",
      name: "Semicon Bull 3X ETF",
      decimals: 18,
      ticker: "SOXL",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVMJ8; transfer(Multicall3, 1) from holder 0x8894E0a0c962CB723c1976a4421c95949bE2D4E3 simulated true; not paused",
    },
    {
      address: "0xE28Cd11C99AF2df76bb8aDA4Cd0ef3904378280F",
      symbol: "SOXSB",
      name: "Direxion Semiconductor Bear 3X ETF",
      decimals: 18,
      ticker: "SOXS",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AV541; transfer(Multicall3, 1) from holder 0x8a08D98CBB218fceB318Ecf3aBc1BA43D8A7aB0E simulated true; not paused",
    },
    {
      address: "0xbe9D156892E55e7154BcD3cB0FEA677F9D3103E1",
      symbol: "SPCXB",
      name: "SpaceX",
      decimals: 18,
      ticker: "SPCX",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVAW6; transfer(Multicall3, 1) from holder 0x977DaFFC095b33872E2741c19568925015C35b4d simulated true; not paused",
    },
    {
      address: "0x7138b48df7D98D7e3cc221BfE7192D0a178182D8",
      symbol: "SPYB",
      name: "SPY",
      decimals: 18,
      ticker: "SPY",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.001729792036835231; identifier AE000A4AU3E4; transfer(Multicall3, 1) from holder 0x7aA6d92Fc369A8C1EDc631A3aAc44eFB0808ddbF simulated true; not paused",
    },
    {
      address: "0x462B5F13B7C7748279358962925c5De83BB9E598",
      symbol: "TQQQB",
      name: "ProShares UltraPro QQQ",
      decimals: 18,
      ticker: "TQQQ",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AV1Q1; transfer(Multicall3, 1) from holder 0x278d858f05b94576C1E6f73285886876ff6eF8D2 simulated true; not paused",
    },
    {
      address: "0x5b1910eAaD6450E50f816082Aa078C41F10C292f",
      symbol: "TSLAB",
      name: "Tesla, Inc.",
      decimals: 18,
      ticker: "TSLA",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AU295; transfer(Multicall3, 1) from holder 0x93da00e3Ea7B6D18DcB890f03204F060134c2b42 simulated true; not paused",
    },
    {
      address: "0xAB78b89B5bb00236Be0B4B20704cBfa04EfC711c",
      symbol: "TSMB",
      name: "TSMC",
      decimals: 18,
      ticker: "TSM",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.002110464141050983; identifier AE000A4AVF43; transfer(Multicall3, 1) from holder 0xE2588c219697F520757b82f5B0119D72bDDC0e13 simulated true; not paused",
    },
    {
      address: "0xcd345D4450e04cDeF422A60b97D9265d24e0bcEE",
      symbol: "USARB",
      name: "USA Rare Earth",
      decimals: 18,
      ticker: "USAR",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.0; identifier AE000A4AVF92; transfer(Multicall3, 1) from holder 0x59FA9A42F9289B975ac6d9BC16C8E40746D86ef7 simulated true; not paused",
    },
    {
      address: "0xebe29695F8047C13d36e7a790ca8c1b239FfAD1C",
      symbol: "WDCB",
      name: "Western Digital",
      decimals: 18,
      ticker: "WDC",
      issuer: "Binance (bStocks)",
      proxy: "beacon",
      implementation: BSTOCKS_IMPLEMENTATION,
      controls: BSTOCKS_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "uiMultiplier 1.000224983929808861; identifier AE000A4AVMH2; transfer(Multicall3, 1) from holder 0x8894E0a0c962CB723c1976a4421c95949bE2D4E3 simulated true; not paused",
    },
  ],
  8453: [
    {
      address: "0x1a4DfA04a5c8F85eCad6FFd3C211051F8A43E280",
      symbol: "GOOGL",
      name: "Alphabet Inc. Class A - Dinari",
      decimals: 18,
      ticker: "GOOGL",
      issuer: "Dinari (dShares)",
      proxy: "beacon",
      implementation: DINARI_DSHARE_IMPLEMENTATION,
      controls: DINARI_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "REBASING: balanceOf = sharesOf x balancePerShare (1); transfer(Multicall3, 1) from holder 0x92470eF2deA84D761E02d701C686dFf7d78cCa6d simulated true; isTransferAllowed true; not paused; burnFrom by a stranger reverts (role-gated)",
    },
    {
      address: "0xf393d07e6ca9818A601055b4bb3c48A5bb98E701",
      symbol: "AMZN",
      name: "Amazon.com, Inc. - Dinari",
      decimals: 18,
      ticker: "AMZN",
      issuer: "Dinari (dShares)",
      proxy: "beacon",
      implementation: DINARI_DSHARE_IMPLEMENTATION,
      controls: DINARI_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "REBASING: balanceOf = sharesOf x balancePerShare (1); transfer(Multicall3, 1) from holder 0xdee43A03db4b6423D3902314f98001228bf43984 simulated true; isTransferAllowed true; not paused; burnFrom by a stranger reverts (role-gated)",
    },
    {
      address: "0x41F7A63713e76c0aB800Be03Bae9F17B8A356348",
      symbol: "AAPL",
      name: "Apple Inc. - Dinari",
      decimals: 18,
      ticker: "AAPL",
      issuer: "Dinari (dShares)",
      proxy: "beacon",
      implementation: DINARI_DSHARE_IMPLEMENTATION,
      controls: DINARI_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "REBASING: balanceOf = sharesOf x balancePerShare (1); transfer(Multicall3, 1) from holder 0xbFb0f8af6B56E67F9331672db1166553e96C2410 simulated true; isTransferAllowed true; not paused; burnFrom by a stranger reverts (role-gated)",
    },
    {
      address: "0xfee9BEe35Fa54BF037EA3B49a6c791b989172dd0",
      symbol: "CRCL",
      name: "Circle Internet Group, Inc. - Dinari",
      decimals: 18,
      ticker: "CRCL",
      issuer: "Dinari (dShares)",
      proxy: "beacon",
      implementation: DINARI_DSHARE_IMPLEMENTATION,
      controls: DINARI_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "REBASING: balanceOf = sharesOf x balancePerShare (1); transfer(Multicall3, 1) from holder 0xa0CC561a5280cB7817ABf0408e8A23CfDa9ac91F simulated true; isTransferAllowed true; not paused; burnFrom by a stranger reverts (role-gated)",
    },
    {
      address: "0xA559c1A28874Bea40056E61cfee29b051B7D8C9d",
      symbol: "COIN",
      name: "Coinbase Global, Inc. Class A Common Stock - Dinari",
      decimals: 18,
      ticker: "COIN",
      issuer: "Dinari (dShares)",
      proxy: "beacon",
      implementation: DINARI_DSHARE_IMPLEMENTATION,
      controls: DINARI_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "REBASING: balanceOf = sharesOf x balancePerShare (1); transfer(Multicall3, 1) from holder 0x498581fF718922c3f8e6A244956aF099B2652b2b simulated true; isTransferAllowed true; not paused; burnFrom by a stranger reverts (role-gated)",
    },
    {
      address: "0xf6e697F80a2c0C77e9C896a23542EFAb2F0d16DF",
      symbol: "META",
      name: "Meta Platforms, Inc. - Dinari",
      decimals: 18,
      ticker: "META",
      issuer: "Dinari (dShares)",
      proxy: "beacon",
      implementation: DINARI_DSHARE_IMPLEMENTATION,
      controls: DINARI_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "REBASING: balanceOf = sharesOf x balancePerShare (1); transfer(Multicall3, 1) from holder 0x1cc3193Efaea7504378d3612272CD38B3506bB83 simulated true; isTransferAllowed true; not paused; burnFrom by a stranger reverts (role-gated)",
    },
    {
      address: "0xF9011e88d8f1B5BB9B1f0b3BD604D250cf114afB",
      symbol: "MSFT",
      name: "Microsoft Corporation - Dinari",
      decimals: 18,
      ticker: "MSFT",
      issuer: "Dinari (dShares)",
      proxy: "beacon",
      implementation: DINARI_DSHARE_IMPLEMENTATION,
      controls: DINARI_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "REBASING: balanceOf = sharesOf x balancePerShare (1); transfer(Multicall3, 1) from holder 0xFe3a0fe67473E19244fd2f52CA5De3CE6740652A simulated true; isTransferAllowed true; not paused; burnFrom by a stranger reverts (role-gated)",
    },
    {
      address: "0x92ECF64fDb76E60b76d78A29Ad4BF9D38B7b1b97",
      symbol: "NVDA",
      name: "NVIDIA Corporation - Dinari",
      decimals: 18,
      ticker: "NVDA",
      issuer: "Dinari (dShares)",
      proxy: "beacon",
      implementation: DINARI_DSHARE_IMPLEMENTATION,
      controls: DINARI_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "REBASING: balanceOf = sharesOf x balancePerShare (10); transfer(Multicall3, 1) from holder 0xD9f8DEd05CD41c72b303e00dE127f7909AF7ff0C simulated true; isTransferAllowed true; not paused; burnFrom by a stranger reverts (role-gated)",
    },
    {
      address: "0x4439039dF7b1215a5FEcc54BeDa747b5C0048fDB",
      symbol: "PLTR",
      name: "Palantir Technologies Inc. Class A Common Stock - Dinari",
      decimals: 18,
      ticker: "PLTR",
      issuer: "Dinari (dShares)",
      proxy: "beacon",
      implementation: DINARI_DSHARE_IMPLEMENTATION,
      controls: DINARI_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "REBASING: balanceOf = sharesOf x balancePerShare (1); transfer(Multicall3, 1) from holder 0xbb5DE76630ACEC0ba195b553AE09445c481Bd622 simulated true; isTransferAllowed true; not paused; burnFrom by a stranger reverts (role-gated)",
    },
    {
      address: "0x0c9b4FBfF1971B5B1D7b50B1F3483cC5007C4621",
      symbol: "HOOD",
      name: "Robinhood Markets, Inc. Class A Common Stock - Dinari",
      decimals: 18,
      ticker: "HOOD",
      issuer: "Dinari (dShares)",
      proxy: "beacon",
      implementation: DINARI_DSHARE_IMPLEMENTATION,
      controls: DINARI_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "REBASING: balanceOf = sharesOf x balancePerShare (1); transfer(Multicall3, 1) from holder 0x4b84490fC32880EFD8Fb08A5F328540A50E58794 simulated true; isTransferAllowed true; not paused; burnFrom by a stranger reverts (role-gated)",
    },
    {
      address: "0x8A768Ef1d44939E2C6e36b83A948295962D6f795",
      symbol: "SPY",
      name: "SPDR S&P 500 ETF Trust - Dinari",
      decimals: 18,
      ticker: "SPY",
      issuer: "Dinari (dShares)",
      proxy: "beacon",
      implementation: DINARI_DSHARE_IMPLEMENTATION,
      controls: DINARI_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "REBASING: balanceOf = sharesOf x balancePerShare (1); transfer(Multicall3, 1) from holder 0xbFb0f8af6B56E67F9331672db1166553e96C2410 simulated true; isTransferAllowed true; not paused; burnFrom by a stranger reverts (role-gated)",
    },
    {
      address: "0x5de98C65A9a3c414550E6663666bc725C23c2E7B",
      symbol: "MSTR",
      name: "MicroStrategy Inc - Dinari",
      decimals: 18,
      ticker: "MSTR",
      issuer: "Dinari (dShares)",
      proxy: "beacon",
      implementation: DINARI_DSHARE_IMPLEMENTATION,
      controls: DINARI_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "REBASING: balanceOf = sharesOf x balancePerShare (1); transfer(Multicall3, 1) from holder 0xa0CC561a5280cB7817ABf0408e8A23CfDa9ac91F simulated true; isTransferAllowed true; not paused; burnFrom by a stranger reverts (role-gated)",
    },
    {
      address: "0x74Ed07d83999bC5DB0ffd850da0a6Bd782AbD39c",
      symbol: "TSLA",
      name: "Tesla, Inc. - Dinari",
      decimals: 18,
      ticker: "TSLA",
      issuer: "Dinari (dShares)",
      proxy: "beacon",
      implementation: DINARI_DSHARE_IMPLEMENTATION,
      controls: DINARI_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "REBASING: balanceOf = sharesOf x balancePerShare (1); transfer(Multicall3, 1) from holder 0x784CC49aC0C30f56a8b65c33E69a7C9b2Be1224E simulated true; isTransferAllowed true; not paused; burnFrom by a stranger reverts (role-gated)",
    },
    {
      address: "0xb2000000000000000000002D0BA3164cc74f58B7",
      symbol: "GOOGLc",
      name: "Alphabet Inc.",
      decimals: 8,
      ticker: "GOOGL",
      issuer: "Coinbase (B20 tokenized stocks)",
      proxy: "none",
      implementation: null,
      controls: COINBASE_B20_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "B20 native precompile (code 0xef); multiplier 1.000377118676784179; policies sender=5(contract authorized), receiver=5(contract authorized), executor=5(contract authorized); transfer(Multicall3, 1) from holder 0xB1987CAD1682841b4b641d50E520777eC5Ab5542 simulated true; TRANSFER not paused; seizeWithMemo by a stranger reverts",
    },
    {
      address: "0xb200000000000000000000d9192b6B456483C2E8",
      symbol: "AMZNc",
      name: "Amazon.com Inc.",
      decimals: 8,
      ticker: "AMZN",
      issuer: "Coinbase (B20 tokenized stocks)",
      proxy: "none",
      implementation: null,
      controls: COINBASE_B20_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "B20 native precompile (code 0xef); multiplier 1.0; policies sender=5(contract authorized), receiver=5(contract authorized), executor=5(contract authorized); transfer(Multicall3, 1) from holder 0xa9169E2dDc4cb80802ad952Ecf6fB52d92CFF813 simulated true; TRANSFER not paused; seizeWithMemo by a stranger reverts",
    },
    {
      address: "0xb200000000000000000000C2e324d24d7eEcd1fb",
      symbol: "AAPLc",
      name: "Apple Inc.",
      decimals: 8,
      ticker: "AAPL",
      issuer: "Coinbase (B20 tokenized stocks)",
      proxy: "none",
      implementation: null,
      controls: COINBASE_B20_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "B20 native precompile (code 0xef); multiplier 1.0; policies sender=5(contract authorized), receiver=5(contract authorized), executor=5(contract authorized); transfer(Multicall3, 1) from holder 0xCb4bC943314405c01907Ae910E57AFC2D0549706 simulated true; TRANSFER not paused; seizeWithMemo by a stranger reverts",
    },
    {
      address: "0xb2000000000000000000008bC8786B856E61707C",
      symbol: "METAc",
      name: "Meta Platforms Inc.",
      decimals: 8,
      ticker: "META",
      issuer: "Coinbase (B20 tokenized stocks)",
      proxy: "none",
      implementation: null,
      controls: COINBASE_B20_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "B20 native precompile (code 0xef); multiplier 1.0; policies sender=5(contract authorized), receiver=5(contract authorized), executor=5(contract authorized); transfer(Multicall3, 1) from holder 0x51C72848c68a965f66FA7a88855F9f7784502a7F simulated true; TRANSFER not paused; seizeWithMemo by a stranger reverts",
    },
    {
      address: "0xB200000000000000000000Ab99cFa739E253872B",
      symbol: "MSFTc",
      name: "Microsoft Corporation",
      decimals: 8,
      ticker: "MSFT",
      issuer: "Coinbase (B20 tokenized stocks)",
      proxy: "none",
      implementation: null,
      controls: COINBASE_B20_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "B20 native precompile (code 0xef); multiplier 1.0; policies sender=5(contract authorized), receiver=5(contract authorized), executor=5(contract authorized); transfer(Multicall3, 1) from holder 0x7103eB3c9590d1281f7dc03b2A9EE27C39dF5D54 simulated true; TRANSFER not paused; seizeWithMemo by a stranger reverts",
    },
    {
      address: "0xb2000000000000000000004884b426556b92883d",
      symbol: "MSTRc",
      name: "Strategy Inc.",
      decimals: 8,
      ticker: "MSTR",
      issuer: "Coinbase (B20 tokenized stocks)",
      proxy: "none",
      implementation: null,
      controls: COINBASE_B20_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "B20 native precompile (code 0xef); multiplier 1.0; policies sender=5(contract authorized), receiver=5(contract authorized), executor=5(contract authorized); transfer(Multicall3, 1) from holder 0x8b27f626ab668197000BC722A1012022CAeD10E2 simulated true; TRANSFER not paused; seizeWithMemo by a stranger reverts",
    },
    {
      address: "0xb20000000000000000000078ee7ce2fE4908108C",
      symbol: "NVDAc",
      name: "NVIDIA Corporation",
      decimals: 8,
      ticker: "NVDA",
      issuer: "Coinbase (B20 tokenized stocks)",
      proxy: "none",
      implementation: null,
      controls: COINBASE_B20_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "B20 native precompile (code 0xef); multiplier 1.0; policies sender=5(contract authorized), receiver=5(contract authorized), executor=5(contract authorized); transfer(Multicall3, 1) from holder 0x853F5f1B92b16714Fe6CDA67CAad0856B83C7ab9 simulated true; TRANSFER not paused; seizeWithMemo by a stranger reverts",
    },
    {
      address: "0xb200000000000000000000397293Cb8cda9a10c5",
      symbol: "SNDKc",
      name: "Sandisk Corporation",
      decimals: 8,
      ticker: "SNDK",
      issuer: "Coinbase (B20 tokenized stocks)",
      proxy: "none",
      implementation: null,
      controls: COINBASE_B20_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "B20 native precompile (code 0xef); multiplier 1.0; policies sender=5(contract authorized), receiver=5(contract authorized), executor=5(contract authorized); transfer(Multicall3, 1) from holder 0x278d858f05b94576C1E6f73285886876ff6eF8D2 simulated true; TRANSFER not paused; seizeWithMemo by a stranger reverts",
    },
    {
      address: "0xb2000000000000000000007b9fcbd005511aCBd5",
      symbol: "SPCXc",
      name: "Space Exploration Technologies Corp.",
      decimals: 8,
      ticker: "SPCX",
      issuer: "Coinbase (B20 tokenized stocks)",
      proxy: "none",
      implementation: null,
      controls: COINBASE_B20_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "B20 native precompile (code 0xef); multiplier 1.0; policies sender=5(contract authorized), receiver=5(contract authorized), executor=5(contract authorized); transfer(Multicall3, 1) from holder 0x0bf58fe0FAc935Ac69595c19B12Ba0d75E3F8c0E simulated true; TRANSFER not paused; seizeWithMemo by a stranger reverts",
    },
    {
      address: "0xb2000000000000000000001e800a7f5189430cD0",
      symbol: "TSLAc",
      name: "Tesla Inc.",
      decimals: 8,
      ticker: "TSLA",
      issuer: "Coinbase (B20 tokenized stocks)",
      proxy: "none",
      implementation: null,
      controls: COINBASE_B20_CONTROLS,
      verifiedAt: "2026-09-17",
      notes: "B20 native precompile (code 0xef); multiplier 1.0; policies sender=5(contract authorized), receiver=5(contract authorized), executor=5(contract authorized); transfer(Multicall3, 1) from holder 0x9a972D8C3a8DD27E5811CbCB75EbdaC924FB53a1 simulated true; TRANSFER not paused; seizeWithMemo by a stranger reverts",
    },
  ],
  /* Ink (57073) — Backed xStocks, WRAPPED ONLY, and the reason is the whole point of
     `controls.rebasing`. The native xStocks ARE on Ink (NVDAx 0xc845…849d, SPYx
     0x90A2…dD48, QQQx 0xa753…50af) and every one of them answers `sharesOf(address)`,
     `getCurrentMultiplier()`, `multiplier()` and `multiplierUpdater()` — read 2026-09-20.
     Backed says the same in its own words: "when the multiplier updates, it adjusts all
     user balances directly, so balanceOf() always returns the current equity-adjusted
     value" (docs.xstocks.fi/developers/multipliers). A balance that the issuer rescales
     under the Vault breaks amount-based reserve accounting, so the natives are NOT
     listed and must never be a pool currency. The ERC-4626 wrappers below hold a fixed
     share count and move the PRICE instead; that is what Backed built them for.

     TWO WRAPPER GENERATIONS EXIST AND THEY SHARE A NAME AND A SYMBOL. Backed's public
     API returns both (`wrapperAddress`, the legacy one, and `wrapperAddressV2`); the
     addresses below are the second. Backed's own documentation says of the first: "do
     not integrate v1 wrappers. Never use a v1 wrapper as collateral, as a pricing
     source, or in any integration that reads its exchange rate", because anyone can
     donate the underlying into it and move `convertToAssets()` within a block. On chain
     the two are told apart by runtime (0x22c711b9… current, 0x20b41426… legacy) and by
     supply (both legacy wrappers hold ZERO). `symbol()` does NOT tell them apart.

     UNRESOLVED, and it is the blocker on a pool here: Chainlink's three Ink feeds are
     named wNVDAx / wSPYx / wQQQx and Backed publishes nothing saying WHICH generation
     they price ("if you need to verify that an address is the current wrapper, contact
     us for assistance"). wNVDAx is unambiguous — only one wrapper exists for it. For
     wSPYx and wQQQx it is an open question, and an empty legacy vault priced as if it
     were the live one is exactly the manipulation Backed warns about. Do not open a
     banded SPY or QQQ pool on Ink until an issuer answer is in hand. */
  57073: [
    {
      address: "0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5",
      symbol: "wNVDAx",
      name: "Wrapped NVIDIA xStock",
      decimals: 18,
      ticker: "NVDA",
      issuer: "Backed (xStocks, ERC-4626 wrapper)",
      proxy: "transparent",
      implementation: BACKED_WRAPPER_IMPLEMENTATION,
      controls: BACKED_WRAPPER_CONTROLS,
      wraps: { asset: "0xc845b2894dBddd03858fd2D643B4eF725fE0849d", standard: "ERC-4626" },
      verifiedAt: "2026-09-20",
      notes:
        "ERC-4626 share over the REBASING NVDAx 0xc845b2894dBddd03858fd2D643B4eF725fE0849d (totalSupply 104,811.936; sharesOf/getCurrentMultiplier/multiplier/multiplierUpdater all answer there, none answers here); wrapper runtime 2,138 B keccak 0x22c711b9…2500e8, EIP-1967 implementation 0x9f5B…ed77 — the same WrappedBackedTokenImplementation already recorded on 999 — behind ProxyAdmin 0x312063009E74142339Edc92BcfF6CfCfAA958BFA; asset()/convertToAssets/totalAssets/isPaused/owner answer, no sanctionsList on the wrapper; transfer(Multicall3, 1) and transfer(Permit2, 1) from holder 0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32 (balance 188.892) simulated true, so the allowlist is disproved; totalSupply 2,072.141; no legacy wrapper exists on Ink for this ticker",
    },
    {
      address: "0xE7E553Cd128F0011777323A0b44a7b96EA1CB540",
      symbol: "wSPYx",
      name: "Wrapped SP500 xStock",
      decimals: 18,
      ticker: "SPY",
      issuer: "Backed (xStocks, ERC-4626 wrapper)",
      proxy: "transparent",
      implementation: BACKED_WRAPPER_IMPLEMENTATION,
      controls: BACKED_WRAPPER_CONTROLS,
      wraps: { asset: "0x90A2a4c76b5D8c0bc892A69EA28Aa775a8f2dD48", standard: "ERC-4626" },
      verifiedAt: "2026-09-20",
      notes:
        "ERC-4626 share over the REBASING SPYx 0x90A2a4c76b5D8c0bc892A69EA28Aa775a8f2dD48 (totalSupply 14,496.951; sharesOf/getCurrentMultiplier/multiplier/multiplierUpdater all answer there, none answers here); wrapper runtime 2,138 B keccak 0x22c711b9…2500e8, EIP-1967 implementation 0x9f5B…ed77 — the same WrappedBackedTokenImplementation already recorded on 999 — behind ProxyAdmin 0x312063009E74142339Edc92BcfF6CfCfAA958BFA; asset()/convertToAssets/totalAssets/isPaused/owner answer, no sanctionsList on the wrapper; transfer(Multicall3, 1) and transfer(Permit2, 1) from holder 0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32 (balance 75.496) simulated true, so the allowlist is disproved; totalSupply 1,470.151; a LEGACY wrapper with the SAME name and symbol exists at 0xc88FcD8B874fDb3256E8B55b3decB8c24EAb4c02 (different runtime, keccak 0x20b41426…72e29, totalSupply 0) and Backed says it is unwrap-only and unsafe to price",
    },
    {
      address: "0x4C1AE29c159838fC1b224636E28E086EB69101f7",
      symbol: "wQQQx",
      name: "Wrapped Nasdaq xStock",
      decimals: 18,
      ticker: "QQQ",
      issuer: "Backed (xStocks, ERC-4626 wrapper)",
      proxy: "transparent",
      implementation: BACKED_WRAPPER_IMPLEMENTATION,
      controls: BACKED_WRAPPER_CONTROLS,
      wraps: { asset: "0xa753A7395cAe905Cd615Da0B82A53E0560f250af", standard: "ERC-4626" },
      verifiedAt: "2026-09-20",
      notes:
        "ERC-4626 share over the REBASING QQQx 0xa753A7395cAe905Cd615Da0B82A53E0560f250af (totalSupply 16,118.302; sharesOf/getCurrentMultiplier/multiplier/multiplierUpdater all answer there, none answers here); wrapper runtime 2,138 B keccak 0x22c711b9…2500e8, EIP-1967 implementation 0x9f5B…ed77 — the same WrappedBackedTokenImplementation already recorded on 999 — behind ProxyAdmin 0x312063009E74142339Edc92BcfF6CfCfAA958BFA; asset()/convertToAssets/totalAssets/isPaused/owner answer, no sanctionsList on the wrapper; transfer(Multicall3, 1) and transfer(Permit2, 1) from holder 0x6D33D2142a5b0b52856a6902eb6F6203B2232a5b (balance 1.212) simulated true, so the allowlist is disproved; totalSupply 961.860; a LEGACY wrapper with the SAME name and symbol exists at 0xdbD9232fee15351068Fe02F0683146e16D9f2cEa (different runtime, keccak 0x20b41426…72e29, totalSupply 0) and Backed says it is unwrap-only and unsafe to price",
    },
  ],
  999: [
    {
      address: "0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5",
      symbol: "wNVDAx",
      name: "Wrapped NVIDIA xStock",
      decimals: 18,
      ticker: "NVDA",
      issuer: "Backed (xStocks, ERC-4626 wrapper)",
      proxy: "transparent",
      implementation: BACKED_WRAPPER_IMPLEMENTATION,
      controls: BACKED_WRAPPER_CONTROLS,
      wraps: { asset: "0xc845b2894dBddd03858fd2D643B4eF725fE0849d", standard: "ERC-4626" },
      verifiedAt: "2026-09-19",
      notes:
        "ERC-4626 share over the rebasing NVDAx 0xc845b2894dBddd03858fd2D643B4eF725fE0849d (multiplier 1.001701196801074 on verifiedAt = convertToAssets(1e18)); wrapper isPaused false (pauser 0x8768…FC50), underlying isPaused false; sanctionsList 0x262f…f07f isSanctioned(Multicall3|Permit2) false; transfer(Multicall3, 1) and transfer(Permit2, 1) from the Core system address 0x200000000000000000000000000000000000034d (balance 3,963.34) simulated true; burn/burnFrom by a stranger revert; totalSupply 5,143.54; owner = ProxyAdmin owner = Safe 2-of-3 0x4975…3a65",
    },
    {
      address: "0xE7E553Cd128F0011777323A0b44a7b96EA1CB540",
      symbol: "wSPYx",
      name: "Wrapped SP500 xStock",
      decimals: 18,
      ticker: "SPY",
      issuer: "Backed (xStocks, ERC-4626 wrapper)",
      proxy: "transparent",
      implementation: BACKED_WRAPPER_IMPLEMENTATION,
      controls: BACKED_WRAPPER_CONTROLS,
      wraps: { asset: "0x90A2a4c76b5D8c0bc892A69EA28Aa775a8f2dD48", standard: "ERC-4626" },
      verifiedAt: "2026-09-19",
      notes:
        "ERC-4626 share over the rebasing SPYx 0x90A2a4c76b5D8c0bc892A69EA28Aa775a8f2dD48 (multiplier 1.005714560286254 on verifiedAt = convertToAssets(1e18)); wrapper isPaused false (pauser 0x8768…FC50), underlying isPaused false; sanctionsList 0x262f…f07f isSanctioned(Multicall3|Permit2) false; transfer(Multicall3, 1) and transfer(Permit2, 1) from the Core system address 0x200000000000000000000000000000000000034E (balance 1,038.01) simulated true; burn/burnFrom by a stranger revert; totalSupply 1,109.50; owner = ProxyAdmin owner = Safe 2-of-3 0x4975…3a65",
    },
    {
      address: "0x4C1AE29c159838fC1b224636E28E086EB69101f7",
      symbol: "wQQQx",
      name: "Wrapped Nasdaq xStock",
      decimals: 18,
      ticker: "QQQ",
      issuer: "Backed (xStocks, ERC-4626 wrapper)",
      proxy: "transparent",
      implementation: BACKED_WRAPPER_IMPLEMENTATION,
      controls: BACKED_WRAPPER_CONTROLS,
      wraps: { asset: "0xa753A7395cAe905Cd615Da0B82A53E0560f250af", standard: "ERC-4626" },
      verifiedAt: "2026-09-19",
      notes:
        "ERC-4626 share over the rebasing QQQx 0xa753A7395cAe905Cd615Da0B82A53E0560f250af (multiplier 1.0027250296551051 on verifiedAt = convertToAssets(1e18)); wrapper isPaused false (pauser 0x8768…FC50), underlying isPaused false; sanctionsList 0x262f…f07f isSanctioned(Multicall3|Permit2) false; transfer(Multicall3, 1) and transfer(Permit2, 1) from the Core system address 0x200000000000000000000000000000000000034f (balance 1,055.29) simulated true; burn/burnFrom by a stranger revert; totalSupply 1,074.84; owner = ProxyAdmin owner = Safe 2-of-3 0x4975…3a65",
    },
    {
      address: "0x6215a58ed045d71F2561AaAbe54f4C885C522998",
      symbol: "wSKHYx",
      name: "Wrapped SK hynix xStock",
      decimals: 18,
      ticker: "SKHY",
      issuer: "Backed (xStocks, ERC-4626 wrapper)",
      proxy: "transparent",
      implementation: BACKED_WRAPPER_IMPLEMENTATION,
      controls: BACKED_WRAPPER_CONTROLS,
      wraps: { asset: "0x58100046a4Afcd4eE4faDbD4244f3f895a341c56", standard: "ERC-4626" },
      verifiedAt: "2026-09-19",
      notes:
        "ERC-4626 share over the rebasing SKHYx 0x58100046a4Afcd4eE4faDbD4244f3f895a341c56 (multiplier 1.0 on verifiedAt = convertToAssets(1e18)); wrapper isPaused false (pauser 0x8768…FC50), underlying isPaused false; sanctionsList 0x262f…f07f isSanctioned(Multicall3|Permit2) false; transfer(Multicall3, 1) and transfer(Permit2, 1) from the Core system address 0x2000000000000000000000000000000000000350 (balance 4,150.63) simulated true; burn/burnFrom by a stranger revert; totalSupply 4,209.33; owner = ProxyAdmin owner = Safe 2-of-3 0x4975…3a65",
    },
    {
      address: "0xe2047ee3bdDb5C99ae428AB83df63f8730698e30",
      symbol: "wMUx",
      name: "Wrapped Micron Technology xStock",
      decimals: 18,
      ticker: "MU",
      issuer: "Backed (xStocks, ERC-4626 wrapper)",
      proxy: "transparent",
      implementation: BACKED_WRAPPER_IMPLEMENTATION,
      controls: BACKED_WRAPPER_CONTROLS,
      wraps: { asset: "0xf6a873BAe4Ba1B304e45dF52A4b7D176E1C6a8c4", standard: "ERC-4626" },
      verifiedAt: "2026-09-19",
      notes:
        "ERC-4626 share over the rebasing MUx 0xf6a873BAe4Ba1B304e45dF52A4b7D176E1C6a8c4 (multiplier 1.0004015986353854 on verifiedAt = convertToAssets(1e18)); wrapper isPaused false (pauser 0x8768…FC50), underlying isPaused false; sanctionsList 0x262f…f07f isSanctioned(Multicall3|Permit2) false; transfer(Multicall3, 1) and transfer(Permit2, 1) from the Core system address 0x2000000000000000000000000000000000000351 (balance 997.10) simulated true; burn/burnFrom by a stranger revert; totalSupply 1,013.06; owner = ProxyAdmin owner = Safe 2-of-3 0x4975…3a65",
    },
    {
      address: "0x95687557C66BC799a850bA7037673528238ae763",
      symbol: "SPCX.dw",
      name: "Wrapped Space Exploration Technologies Corp.",
      decimals: 18,
      ticker: "SPCX",
      issuer: "Dinari (dShares, ERC-4626 wrapper)",
      proxy: "beacon",
      implementation: DINARI_WRAPPER_IMPLEMENTATION,
      controls: DINARI_WRAPPER_CONTROLS,
      wraps: { asset: "0x9b4Db2271EB1fa0aEe1abA7ed55E51C38cE514a3", standard: "ERC-4626" },
      verifiedAt: "2026-09-19",
      notes:
        "ERC-4626 share over Dinari SPCX 0x9b4D…14a3 (DShare, balancePerShare 1e18, paused false on verifiedAt; convertToAssets(1e18) = 1e18); wrapper isBlacklisted(Multicall3|Permit2) false through transferRestrictor 0xf60f…8766; no pause view on the wrapper; transfer(Multicall3, 1) and transfer(Permit2, 1) from the Core system address 0x2000…0262 (balance 9,823.20) simulated true; burn/burnFrom by a stranger revert; totalSupply 10,259.46; beacon owner 0x06B0…60a3 (getMinDelay reverts: not a timelock); getInitializedVersion 4",
    },
    {
      address: "0xB989ad9b91886b1Aaed8DaADb26F028b29b40945",
      symbol: "NVDAon",
      name: "NVIDIA (Ondo Tokenized)",
      decimals: 18,
      ticker: "NVDA",
      issuer: "Ondo (Ondo Stocks)",
      proxy: "beacon",
      implementation: ONDO_GMTOKEN_IMPLEMENTATION,
      controls: ONDO_CONTROLS,
      verifiedAt: "2026-09-19",
      notes:
        "tokenPauseManager.isTokenPaused false; compliance view checkIsCompliant(Multicall3) and (Permit2) pass; transfer(Multicall3, 1) and transfer(Permit2, 1) from holder 0x8b05Aa528e940ce49865DCCFD0c2F543a3B0DD46 (Transfer log, block 45,281,610; balance 0.408) simulated true; burn(holder, 1) by a stranger reverts \"AccessControl: … missing role\"; BURNER_ROLE has 0 members, DEFAULT_ADMIN_ROLE = timelock 0x6253…0E83 (7200 s); totalSupply 3.910; no balancePerShare / sharesOf / multiplier",
    },
    {
      address: "0x417883b1709545f1211A25b00ad13455fC7F1bc5",
      symbol: "TSLAon",
      name: "Tesla (Ondo Tokenized)",
      decimals: 18,
      ticker: "TSLA",
      issuer: "Ondo (Ondo Stocks)",
      proxy: "beacon",
      implementation: ONDO_GMTOKEN_IMPLEMENTATION,
      controls: ONDO_CONTROLS,
      verifiedAt: "2026-09-19",
      notes:
        "tokenPauseManager.isTokenPaused false; compliance view checkIsCompliant(Multicall3) and (Permit2) pass; transfer(Multicall3, 1) and transfer(Permit2, 1) from holder 0xd72815a5E35b6bBD8b18Ed4f8a92d685FA65DeDA (Transfer log, block 43,058,051; balance 0.000000102) simulated true; burn(holder, 1) by a stranger reverts \"AccessControl: … missing role\"; BURNER_ROLE has 0 members, DEFAULT_ADMIN_ROLE = timelock 0x6253…0E83 (7200 s); totalSupply 0.000496; no balancePerShare / sharesOf / multiplier",
    },
    {
      address: "0x4D34798f18Eb747F7225663F0553eA2D880cf75D",
      symbol: "GOOGLon",
      name: "Alphabet Class A (Ondo Tokenized)",
      decimals: 18,
      ticker: "GOOGL",
      issuer: "Ondo (Ondo Stocks)",
      proxy: "beacon",
      implementation: ONDO_GMTOKEN_IMPLEMENTATION,
      controls: ONDO_CONTROLS,
      verifiedAt: "2026-09-19",
      notes:
        "tokenPauseManager.isTokenPaused false; compliance view checkIsCompliant(Multicall3) and (Permit2) pass; transfer(Multicall3, 1) and transfer(Permit2, 1) from holder 0xd72815a5E35b6bBD8b18Ed4f8a92d685FA65DeDA (Transfer log, block 43,057,899; balance 0.000001) simulated true; burn(holder, 1) by a stranger reverts \"AccessControl: … missing role\"; BURNER_ROLE has 0 members, DEFAULT_ADMIN_ROLE = timelock 0x6253…0E83 (7200 s); totalSupply 0.020001; no balancePerShare / sharesOf / multiplier",
    },
    {
      address: "0x639Bcd00422facAcA534063e3d860e8fcf78B46F",
      symbol: "COINon",
      name: "Coinbase (Ondo Tokenized)",
      decimals: 18,
      ticker: "COIN",
      issuer: "Ondo (Ondo Stocks)",
      proxy: "beacon",
      implementation: ONDO_GMTOKEN_IMPLEMENTATION,
      controls: ONDO_CONTROLS,
      verifiedAt: "2026-09-19",
      notes:
        "tokenPauseManager.isTokenPaused false; compliance view checkIsCompliant(Multicall3) and (Permit2) pass; transfer(Multicall3, 1) and transfer(Permit2, 1) from holder 0x4b5ffbCE0f9796C4025932cb321956D0D45A844b (Transfer log, block 43,265,399; balance 7.99908) simulated true; burn(holder, 1) by a stranger reverts \"AccessControl: … missing role\"; BURNER_ROLE has 0 members, DEFAULT_ADMIN_ROLE = timelock 0x6253…0E83 (7200 s); totalSupply 7.99908; no balancePerShare / sharesOf / multiplier",
    },
    {
      address: "0x0f8E33F5CdefAE9C2E59de8fB61feD347046D046",
      symbol: "MUon",
      name: "Micron Technology (Ondo Tokenized)",
      decimals: 18,
      ticker: "MU",
      issuer: "Ondo (Ondo Stocks)",
      proxy: "beacon",
      implementation: ONDO_GMTOKEN_IMPLEMENTATION,
      controls: ONDO_CONTROLS,
      verifiedAt: "2026-09-19",
      notes:
        "tokenPauseManager.isTokenPaused false; compliance view checkIsCompliant(Multicall3) and (Permit2) pass; transfer(Multicall3, 1) and transfer(Permit2, 1) from holder 0x8b05Aa528e940ce49865DCCFD0c2F543a3B0DD46 (Transfer log, block 45,281,610; balance 0.266) simulated true; burn(holder, 1) by a stranger reverts \"AccessControl: … missing role\"; BURNER_ROLE has 0 members, DEFAULT_ADMIN_ROLE = timelock 0x6253…0E83 (7200 s); totalSupply 4.555; no balancePerShare / sharesOf / multiplier",
    },
    {
      address: "0x13a81c5e8b4AB05Fc721DfF7bA95e250b29458F8",
      symbol: "CRCLon",
      name: "Circle Internet Group (Ondo Tokenized)",
      decimals: 18,
      ticker: "CRCL",
      issuer: "Ondo (Ondo Stocks)",
      proxy: "beacon",
      implementation: ONDO_GMTOKEN_IMPLEMENTATION,
      controls: ONDO_CONTROLS,
      verifiedAt: "2026-09-19",
      notes:
        "tokenPauseManager.isTokenPaused false; compliance view checkIsCompliant(Multicall3) and (Permit2) pass; transfer(Multicall3, 1) and transfer(Permit2, 1) from holder 0x8b05Aa528e940ce49865DCCFD0c2F543a3B0DD46 (Transfer log, block 45,281,610; balance 1.085) simulated true; burn(holder, 1) by a stranger reverts \"AccessControl: … missing role\"; BURNER_ROLE has 0 members, DEFAULT_ADMIN_ROLE = timelock 0x6253…0E83 (7200 s); totalSupply 1.089; no balancePerShare / sharesOf / multiplier",
    },
    {
      address: "0x32eC2792aeC02122eDD9f28866B720db1e1c1B54",
      symbol: "SPYon",
      name: "SPDR S&P 500 ETF (Ondo Tokenized)",
      decimals: 18,
      ticker: "SPY",
      issuer: "Ondo (Ondo Stocks)",
      proxy: "beacon",
      implementation: ONDO_GMTOKEN_IMPLEMENTATION,
      controls: ONDO_CONTROLS,
      verifiedAt: "2026-09-19",
      notes:
        "tokenPauseManager.isTokenPaused false; compliance view checkIsCompliant(Multicall3) and (Permit2) pass; transfer(Multicall3, 1) and transfer(Permit2, 1) from holder 0xd72815a5E35b6bBD8b18Ed4f8a92d685FA65DeDA (Transfer log, block 43,058,023; balance 0.000000453) simulated true; burn(holder, 1) by a stranger reverts \"AccessControl: … missing role\"; BURNER_ROLE has 0 members, DEFAULT_ADMIN_ROLE = timelock 0x6253…0E83 (7200 s); totalSupply 0.000042; no balancePerShare / sharesOf / multiplier",
    },
  ],
};

/** Chain ids with at least one verified record, ascending. */
export const STOCK_TOKEN_CHAIN_IDS: readonly number[] = Object.keys(STOCK_TOKENS)
  .map(Number)
  .sort((a, b) => a - b);

/** The verified stock tokens on `chainId`; `[]` for a chain with none. */
export function stockTokensFor(chainId: number): readonly StockTokenRecord[] {
  return STOCK_TOKENS[chainId] ?? [];
}

/** A verified stock token on `chainId` by address (case-insensitive); `undefined` if unknown. */
export function stockTokenByAddress(chainId: number, address: string): StockTokenRecord | undefined {
  const wanted = address.toLowerCase();
  return stockTokensFor(chainId).find((r) => r.address.toLowerCase() === wanted);
}
