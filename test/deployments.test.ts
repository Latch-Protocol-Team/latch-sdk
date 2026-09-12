// SPDX-License-Identifier: MIT
/* ============================================================================
   Guards on the address book.

   An address table cannot be unit-tested for correctness — only the chain knows
   whether 0x78e8… is the Vault, and `npm run latch:verify` in the scaffolded app
   is what asks it. What CAN be tested is the class of mistake that a human
   editing this file will actually make, and each of those is cheap to catch:

     * a zero-address placeholder sneaking in, which is the one thing the whole
       null-not-zero design exists to prevent;
     * a mistyped or truncated address, which reads as plausible;
     * the same address pasted into two fields, which is how a quoter ends up
       being called as a pool manager;
     * a token listed without decimals, or with decimals that disagree with the
       `weth` field pointing at it — the 10^12 mispricing trap;
     * a reference pool whose tokens are not in the token table, so a consumer
       has an address and no way to scale its amounts;
     * `REDEPLOYABLE_CONTRACTS` naming a field that no longer exists after a
       rename, which would silently stop warning about anything.

   Nothing here reaches the network. These are assertions about a source file.
   ============================================================================ */

import { describe, expect, it } from "vitest";

import {
  LATCH_CHAIN_IDS,
  LATCH_MAINNET_CHAIN_IDS,
  LATCH_DEPLOYMENTS,
  NATIVE_CURRENCY,
  REDEPLOYABLE_CONTRACTS,
  explorerAddressUrl,
  explorerTxUrl,
  getDeployment,
  isLatchChainId,
  requireContract,
  requireDeployment,
  tokenByAddress,
  tokenBySymbol,
  type LatchChainId,
  type LatchDeployment,
} from "../src/deployments/index.js";

const ZERO = "0x0000000000000000000000000000000000000000";
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Every field of a deployment that holds a single address, live or null. */
const ADDRESS_FIELDS = [
  "vault",
  "clPoolManager",
  "binPoolManager",
  "clPoolManagerOwner",
  "binPoolManagerOwner",
  "feeController",
  "clProtocolFeeController",
  "binProtocolFeeController",
  "governanceSafe",
  "timelockCustody",
  "timelockPolicy",
  "registry",
  "universalRouter",
  "clPositionManager",
  "binPositionManager",
  "clQuoter",
  "binQuoter",
  "clPositionDescriptor",
  "create3Factory",
  "permit2",
  "weth",
  "revShareHook",
  "launchRegistry",
  "launchpadKit",
  "launchGuardHook",
] as const satisfies readonly (keyof LatchDeployment)[];

/**
 * Fields that may legitimately share an address with another field.
 *
 * `governanceSafe` is deployed at the same address on both chains, and one
 * `ProtocolFeeController` contract is deployed twice on Robinhood — but those
 * are collisions ACROSS chains and across two intentionally distinct
 * instances, not within one chain, so the per-chain uniqueness check below
 * needs no exemption today. Kept as an explicit empty set so that adding one
 * later is a deliberate edit with a reason attached.
 */
const UNIQUENESS_EXEMPT: readonly string[] = [];

function addressesOf(d: LatchDeployment): [string, string][] {
  /* The `as const` gives a readonly tuple of the literal key union, which no
     longer widens to [string, string] now that some fields are nullable. Map
     to plain strings first, then filter. */
  return ADDRESS_FIELDS.map((k) => [k as string, d[k] as string | null] as [string, string | null])
    .filter((pair): pair is [string, string] => pair[1] !== null);
}

describe("LATCH_DEPLOYMENTS", () => {
  it("carries exactly the chains LATCH_CHAIN_IDS advertises", () => {
    expect(Object.keys(LATCH_DEPLOYMENTS).map(Number).sort((a, b) => a - b)).toEqual(
      [...LATCH_CHAIN_IDS].sort((a, b) => a - b),
    );
  });

  it("does not ship Arc mainnet (5042), which has never answered a probe", () => {
    expect(isLatchChainId(5042)).toBe(false);
    expect(getDeployment(5042)).toBeUndefined();
  });

  for (const chainId of LATCH_CHAIN_IDS) {
    const d = LATCH_DEPLOYMENTS[chainId];

    describe(`${d.name} (${chainId})`, () => {
      it("agrees with its own key", () => {
        expect(d.chainId).toBe(chainId);
      });

      it("has no zero-address placeholder anywhere — null is the placeholder", () => {
        for (const [field, addr] of addressesOf(d)) {
          expect(addr.toLowerCase(), `${field} is the zero address`).not.toBe(ZERO);
        }
      });

      it("has well-formed 20-byte addresses", () => {
        for (const [field, addr] of addressesOf(d)) {
          expect(addr, `${field} is malformed: ${addr}`).toMatch(ADDRESS_RE);
        }
      });

      it("does not repeat one address across two contract fields", () => {
        const seen = new Map<string, string>();
        for (const [field, addr] of addressesOf(d)) {
          if (UNIQUENESS_EXEMPT.includes(field)) continue;
          const key = addr.toLowerCase();
          const prior = seen.get(key);
          expect(prior, `${field} repeats the address already used by ${String(prior)}`).toBe(
            undefined,
          );
          seen.set(key, field);
        }
      });

      it("scans logs from a real block, not from genesis", () => {
        expect(d.deployedAtBlock).toBeTypeOf("bigint");
        expect(d.deployedAtBlock > 0n).toBe(true);
      });

      it("has an explorer origin with no trailing slash", () => {
        expect(d.explorer).toMatch(/^https:\/\//);
        expect(d.explorer.endsWith("/")).toBe(false);
      });

      it("gives every token its decimals", () => {
        for (const t of d.tokens) {
          expect(t.address, `${t.symbol} is malformed`).toMatch(ADDRESS_RE);
          expect(Number.isInteger(t.decimals), `${t.symbol} decimals`).toBe(true);
          expect(t.decimals).toBeGreaterThanOrEqual(0);
          expect(t.decimals).toBeLessThanOrEqual(36);
          expect(t.symbol.length).toBeGreaterThan(0);
          expect(t.name.length).toBeGreaterThan(0);
        }
      });

      it("lists no token twice", () => {
        const addrs = d.tokens.map((t) => t.address.toLowerCase());
        expect(new Set(addrs).size).toBe(addrs.length);
      });

      it("lists its own WETH in the token table, at 18 decimals", () => {
        const weth = tokenByAddress(chainId, d.weth);
        expect(weth, "the weth field points at a token not in `tokens`").toBeDefined();
        expect(weth?.decimals).toBe(18);
      });

      it("scales the reference pool's tokens", () => {
        if (d.demoPool === null) return;
        for (const token of [d.demoPool.token0, d.demoPool.token1]) {
          const info = tokenByAddress(chainId, token);
          expect(info, `demoPool token ${token} has no decimals in \`tokens\``).toBeDefined();
        }
        /* token0 < token1 is a protocol invariant, not a convention: the pool id
           is derived from the ordered key, so a swapped pair is a different
           pool that does not exist. */
        expect(d.demoPool.token0.toLowerCase() < d.demoPool.token1.toLowerCase()).toBe(true);
        expect(d.demoPool.id).toMatch(/^0x[0-9a-f]{64}$/);
        expect(d.demoPool.lpFee).toBeGreaterThan(0);
        expect(d.demoPool.tickSpacing).toBeGreaterThan(0);
      });

      it("has native currency metadata matching NATIVE_CURRENCY", () => {
        expect(NATIVE_CURRENCY[chainId]).toEqual(d.nativeCurrency);
        expect(d.nativeCurrency.decimals).toBe(18);
      });
    });
  }

  /* Robinhood's USDG is the concrete case the whole decimals rule exists for:
     6 against WETH's 18 is a 10^12 gap in `sqrtPriceX96`, applied permanently
     at `initialize`. If this ever reads 18, a pool gets opened a million times
     off. Asserted by value, not by shape. */
  it("keeps USDG at SIX decimals on Robinhood", () => {
    const usdg = tokenBySymbol(4663, "usdg");
    expect(usdg).toBeDefined();
    expect(usdg?.decimals).toBe(6);
    expect(tokenBySymbol(4663, "WETH")?.decimals).toBe(18);
  });

  it("separates the mainnets from the full list", () => {
    /* Guards the reason both lists exist: a testnet must stay listed so a hook
       author can test against a real deployment, but must never appear where a
       mainnet is meant. If a second mainnet is added this fails until the
       expectation is updated deliberately. */
    expect(LATCH_MAINNET_CHAIN_IDS).toEqual([4663]);
    expect(LATCH_CHAIN_IDS).toContain(11155111);
    for (const id of LATCH_MAINNET_CHAIN_IDS) {
      expect(LATCH_DEPLOYMENTS[id].isMainnet).toBe(true);
    }
  });

  it("marks Robinhood as mainnet and Sepolia as not", () => {
    expect(LATCH_DEPLOYMENTS[4663].isMainnet).toBe(true);
    expect(LATCH_DEPLOYMENTS[11155111].isMainnet).toBe(false);
  });

  it("uses the same governance Safe address on both chains", () => {
    expect(LATCH_DEPLOYMENTS[4663].governanceSafe).toBe(
      LATCH_DEPLOYMENTS[11155111].governanceSafe,
    );
  });

  /* This asserted "no launchpad address anywhere" until 2026-09-12, when the
     three were deployed to Robinhood and Sourcify-verified. The assertion was
     right when written and the deploy is what made it false — so it is
     rewritten to pin the CURRENT split rather than deleted, because "the
     launchpad exists on one chain and not the other" is exactly the state a
     consumer has to branch on. */
  it("has the launchpad on Robinhood and not on Sepolia", () => {
    const rh = LATCH_DEPLOYMENTS[4663];
    expect(rh.launchRegistry).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(rh.launchpadKit).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(rh.launchGuardHook).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const sep = LATCH_DEPLOYMENTS[11155111];
    expect(sep.launchRegistry).toBeNull();
    expect(sep.launchpadKit).toBeNull();
    expect(sep.launchGuardHook).toBeNull();
  });
});

describe("REDEPLOYABLE_CONTRACTS", () => {
  it("names only fields that exist on a deployment", () => {
    const d = LATCH_DEPLOYMENTS[4663];
    for (const key of REDEPLOYABLE_CONTRACTS) {
      expect(Object.hasOwn(d, key), `${key} is not a field of LatchDeployment`).toBe(true);
    }
  });

  it("does not claim the Vault is redeployable", () => {
    expect((REDEPLOYABLE_CONTRACTS as readonly string[]).includes("vault")).toBe(false);
  });
});

describe("lookup helpers", () => {
  it("returns undefined for an unknown chain rather than defaulting to one", () => {
    expect(getDeployment(1)).toBeUndefined();
    expect(getDeployment(8453)).toBeUndefined();
  });

  it("throws a message naming the supported chains", () => {
    expect(() => requireDeployment(1)).toThrow(/not deployed on chain 1/);
    expect(() => requireDeployment(1)).toThrow(/4663 \(Robinhood Chain\)/);
  });

  it("returns a live address for a deployed contract", () => {
    expect(requireContract(LATCH_DEPLOYMENTS[4663], "vault")).toBe(
      LATCH_DEPLOYMENTS[4663].vault,
    );
  });

  it("throws, rather than returning a zero address, for one that is not deployed", () => {
    /* Robinhood's launchpadKit is deployed now, so the not-deployed case moves
       to Sepolia — the point of the test is the THROW, not the chain. */
    expect(() => requireContract(LATCH_DEPLOYMENTS[11155111], "launchpadKit")).toThrow(
      /launchpadKit is not deployed on Ethereum Sepolia \(11155111\)/,
    );
    expect(() => requireContract(LATCH_DEPLOYMENTS[11155111], "clPoolManagerOwner")).toThrow(
      /not deployed on Ethereum Sepolia/,
    );
  });

  it("finds tokens case-insensitively, by symbol and by address", () => {
    expect(tokenBySymbol(11155111, "LTUSD")?.symbol).toBe("ltUSD");
    expect(tokenByAddress(4663, LATCH_DEPLOYMENTS[4663].weth.toUpperCase())?.symbol).toBe(
      "WETH",
    );
    expect(tokenBySymbol(4663, "nope")).toBeUndefined();
  });

  it("builds explorer links against the right origin", () => {
    expect(explorerTxUrl(4663, "0xabc")).toBe(
      "https://robinhoodchain.blockscout.com/tx/0xabc",
    );
    expect(explorerAddressUrl(11155111, "0xabc")).toBe(
      "https://sepolia.etherscan.io/address/0xabc",
    );
  });

  it("narrows a number to a LatchChainId", () => {
    const raw: number = 4663;
    if (isLatchChainId(raw)) {
      const id: LatchChainId = raw;
      expect(LATCH_DEPLOYMENTS[id].key).toBe("robinhood");
    } else {
      throw new Error("4663 must be a Latch chain");
    }
  });
});
