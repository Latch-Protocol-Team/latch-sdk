// SPDX-License-Identifier: MIT
/* ============================================================================
   Safe{Wallet} v1.4.1 contract addresses, per chain.

   The governance Safe (`LatchDeployment.governanceSafe`) is a plain v1.4.1
   proxy created through the canonical `SafeProxyFactory`, and every chain Latch
   governs is one where the canonical singleton deployment landed at the same
   deterministic addresses. That is what lets a Safe transaction be hashed,
   signed and executed WITHOUT app.safe.global: the EIP-712 domain is
   `{ chainId, verifyingContract: safe }`, and a batch is a DELEGATECALL into
   `multiSendCallOnly`, which can only CALL onward.

   Every value below is the canonical v1.4.1 address published by
   `@safe-global/safe-deployments` (MIT), transcribed rather than imported so the
   SDK stays dependency-free. `docs/chain-certification.md` records `eth_getCode`
   and `VERSION()` reads at these addresses on each chain; `test/safeContracts.test.ts`
   re-reads the code when an RPC is reachable and asserts the transcription
   against the published package in the admin build. A chain missing from this
   table has NOT been checked — do not add it on the strength of "the canonical
   deployment is everywhere". Read the code first.

   Which singleton a given Safe proxy points at (L1 `singleton` or `l2Singleton`)
   is read from the proxy's storage slot 0 at run time; both are listed because
   both exist on every chain here and Safe{Wallet} creates L2 proxies on L2s.
   ============================================================================ */

import type { Address } from "viem";

export interface SafeContracts {
  /** Safe version these addresses belong to. Only 1.4.1 is recorded. */
  readonly version: "1.4.1";
  /** `Safe.sol` — the L1 singleton. */
  readonly singleton: Address;
  /** `SafeL2.sol` — emits events for indexers without tracing; what Safe{Wallet} deploys on L2s. */
  readonly l2Singleton: Address;
  readonly proxyFactory: Address;
  /** `MultiSend` — can DELEGATECALL onward. Never the target of a governance batch. */
  readonly multiSend: Address;
  /** `MultiSendCallOnly` — the batch target: DELEGATECALLed by the Safe, it can only CALL. */
  readonly multiSendCallOnly: Address;
  /** `CompatibilityFallbackHandler` — ERC-1271 / ERC-165 on the proxy. */
  readonly fallbackHandler: Address;
  readonly signMessageLib: Address;
  readonly createCall: Address;
  readonly simulateTxAccessor: Address;
}

/** The canonical v1.4.1 deployment, identical on every EVM chain that has it (deterministic CREATE2). */
const CANONICAL_1_4_1: SafeContracts = {
  version: "1.4.1",
  singleton: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
  l2Singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
  proxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
  multiSend: "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526",
  multiSendCallOnly: "0x9641d764fc13c8B624c04430C7356C1C7C8102e2",
  fallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
  signMessageLib: "0xd53cd0aB83D845Ac265BE939c57F53AD838012c9",
  createCall: "0x9b35Af71d77eaf8d7e40252370304687390A1A52",
  simulateTxAccessor: "0x3d4BA2E0884aa488718476ca2FB8Efc291A46199",
};

/**
 * Chains where the canonical v1.4.1 contracts were READ at these addresses
 * (`docs/chain-certification.md`, "Safe infra"): code present, singletons answer
 * `VERSION() == "1.4.1"`. Robinhood also verified `MultiSendCallOnly` by code hash
 * (`apps/api/config/chains/4663.json`). Base (8453) is listed because the
 * governance Safe exists there at the same address with the same owners, not
 * because Latch is deployed there.
 */
export const SAFE_CONTRACTS: Readonly<Record<number, SafeContracts>> = {
  4663: CANONICAL_1_4_1,
  8453: CANONICAL_1_4_1,
  11155111: CANONICAL_1_4_1,
};

export const SAFE_CONTRACT_CHAIN_IDS: readonly number[] = Object.keys(SAFE_CONTRACTS).map(Number);

export function safeContractsFor(chainId: number): SafeContracts | undefined {
  return SAFE_CONTRACTS[chainId];
}

export function requireSafeContracts(chainId: number): SafeContracts {
  const c = SAFE_CONTRACTS[chainId];
  if (!c) throw new Error(`Safe v1.4.1 contracts have not been verified on chain ${chainId}; read eth_getCode at the canonical addresses before adding it to SAFE_CONTRACTS`);
  return c;
}

/**
 * Safe v1.4.1 EIP-712 `SafeTx` type. The domain is `{ chainId, verifyingContract }`
 * (no name, no version) for every Safe >= 1.3.0. `safeTxHash` is
 * `hashTypedData({ domain, types: SAFE_TX_TYPES, primaryType: "SafeTx", message })`,
 * and it is what an owner's `eth_signTypedData_v4` signs and what
 * `execTransaction` recovers each signature against.
 */
export const SAFE_TX_TYPES = {
  SafeTx: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
} as const;
