// SPDX-License-Identifier: MIT
/**
 * The Merkle tree a `LatchMerkleDrop` verifies, built exactly as the contract
 * checks it.
 *
 * LEAF   keccak256(bytes.concat(keccak256(abi.encode(uint256 index, address account, uint256 amount))))
 *        (double-hashed, so a leaf can never be read as an inner node)
 * PAIR   keccak256(a < b ? a ‖ b : b ‖ a), OpenZeppelin `MerkleProof`'s sorted-pair hash
 * TREE   leaves in index order (index i is leaf i), paired left to right, level
 *        by level; an odd node at the end of a level is carried up unchanged.
 *
 * Because every pair is hashed sorted, `MerkleProof.verify(proof, root, leaf)`
 * accepts the sibling path from this tree whatever the layout; the layout only
 * decides WHICH root a list produces. This one reproduces the drop contract's
 * own test tree (`root = pair(pair(l0, l1), pair(l2, l3))`), checked by the
 * golden test.
 *
 * THE CLAIMS FILE. A drop stores only its root. Claimers need their index,
 * amount and proof, so the creator publishes a `DropClaimsFile` (JSON) and puts
 * its URI in the drop's `metadataURI`. The file cannot lie about who gets what:
 * `verifyDropClaimsFile` rebuilds the root from its claims and compares it with
 * the root read from the drop, so any host (IPFS, a web server, a download) is
 * as good as any other.
 */

import { encodeAbiParameters, getAddress, isAddress, isHex, keccak256, concat, type Address, type Hex } from "viem";

import type { Recipient } from "./amounts.js";

export const DROP_CLAIMS_FORMAT = "latch.merkle-drop";
export const DROP_CLAIMS_VERSION = 1;
export const DROP_LEAF_ENCODING = "keccak256(bytes.concat(keccak256(abi.encode(uint256 index, address account, uint256 amount))))";

const LEAF_PARAMS = [{ type: "uint256" }, { type: "address" }, { type: "uint256" }] as const;

/** The contract's leaf for `(index, account, amount)`. */
export function dropLeaf(index: bigint | number, account: Address, amount: bigint): Hex {
  return keccak256(keccak256(encodeAbiParameters(LEAF_PARAMS, [BigInt(index), getAddress(account), amount])));
}

/** OpenZeppelin's commutative pair hash. */
export function hashPairSorted(a: Hex, b: Hex): Hex {
  return BigInt(a) < BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

/** `MerkleProof.verify`, in TypeScript. */
export function verifyMerkleProof(proof: readonly Hex[], root: Hex, leaf: Hex): boolean {
  let h = leaf;
  for (const p of proof) h = hashPairSorted(h, p);
  return h.toLowerCase() === root.toLowerCase();
}

export interface DropTree {
  readonly root: Hex;
  /** `layers[0]` are the leaves in index order; the last layer is `[root]`. */
  readonly layers: readonly (readonly Hex[])[];
  /** The sibling path for leaf `index`. */
  proof(index: number): Hex[];
}

/** Build the tree over `(i, recipients[i].account, recipients[i].amount)`. */
export function buildDropTree(recipients: readonly Recipient[]): DropTree {
  if (recipients.length === 0) throw new RangeError("A drop needs at least one recipient.");
  const leaves = recipients.map((r, i) => dropLeaf(i, getAddress(r.account), r.amount));
  const layers: Hex[][] = [leaves];
  let level = leaves;
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i] as Hex;
      const b = level[i + 1];
      next.push(b === undefined ? a : hashPairSorted(a, b));
    }
    layers.push(next);
    level = next;
  }
  const root = level[0] as Hex;
  return {
    root,
    layers,
    proof(index: number): Hex[] {
      if (!Number.isInteger(index) || index < 0 || index >= leaves.length) throw new RangeError(`No leaf ${index}.`);
      const path: Hex[] = [];
      let i = index;
      for (let d = 0; d < layers.length - 1; d++) {
        const layer = layers[d] as Hex[];
        const sibling = layer[i ^ 1];
        if (sibling !== undefined) path.push(sibling);
        i = i >> 1;
      }
      return path;
    },
  };
}

/* ----------------------------------------------------------- claims file --- */

export interface DropClaim {
  readonly index: number;
  readonly account: Address;
  /** Base units, as a decimal string (JSON has no bigint). */
  readonly amount: string;
  readonly proof: readonly Hex[];
}

export interface DropClaimsFile {
  readonly format: typeof DROP_CLAIMS_FORMAT;
  readonly version: typeof DROP_CLAIMS_VERSION;
  readonly chainId: number;
  /** Zero address = native. */
  readonly currency: Address;
  /** Display hints; the chain is the authority. */
  readonly symbol: string | null;
  readonly decimals: number | null;
  readonly merkleRoot: Hex;
  /** Sum of every claim, base units. */
  readonly total: string;
  readonly leafEncoding: typeof DROP_LEAF_ENCODING;
  /** Filled in once the drop exists (optional). */
  readonly drop: Address | null;
  /** In index order: `claims[i].index === i`. */
  readonly claims: readonly DropClaim[];
}

/** Build the file a creator publishes: root, total and every account's proof. */
export function buildDropClaimsFile(args: {
  readonly chainId: number;
  readonly currency: Address;
  readonly recipients: readonly Recipient[];
  readonly symbol?: string | null;
  readonly decimals?: number | null;
  readonly drop?: Address | null;
}): DropClaimsFile {
  const tree = buildDropTree(args.recipients);
  return {
    format: DROP_CLAIMS_FORMAT,
    version: DROP_CLAIMS_VERSION,
    chainId: args.chainId,
    currency: getAddress(args.currency),
    symbol: args.symbol ?? null,
    decimals: args.decimals ?? null,
    merkleRoot: tree.root,
    total: args.recipients.reduce((s, r) => s + r.amount, 0n).toString(),
    leafEncoding: DROP_LEAF_ENCODING,
    drop: args.drop ?? null,
    claims: args.recipients.map((r, i) => ({ index: i, account: getAddress(r.account), amount: r.amount.toString(), proof: tree.proof(i) })),
  };
}

export interface DropClaimsCheck {
  readonly ok: boolean;
  readonly issues: readonly string[];
  /** The root rebuilt from the file's claims (null when the claims are malformed). */
  readonly rebuiltRoot: Hex | null;
}

/**
 * Parse untrusted JSON into a claims file, or throw with the first problem.
 * Structural only: pair it with `verifyDropClaimsFile`.
 */
export function parseDropClaimsFile(input: unknown): DropClaimsFile {
  const o = (typeof input === "string" ? JSON.parse(input) : input) as Record<string, unknown> | null;
  if (o === null || typeof o !== "object") throw new Error("Not a JSON object.");
  if (o["format"] !== DROP_CLAIMS_FORMAT) throw new Error(`Not a ${DROP_CLAIMS_FORMAT} file.`);
  if (o["version"] !== DROP_CLAIMS_VERSION) throw new Error(`Unsupported version ${String(o["version"])}.`);
  const root = o["merkleRoot"];
  if (typeof root !== "string" || !isHex(root) || root.length !== 66) throw new Error("merkleRoot is not a 32-byte hex string.");
  const currency = o["currency"];
  if (typeof currency !== "string" || !isAddress(currency, { strict: false })) throw new Error("currency is not an address.");
  const chainId = o["chainId"];
  if (typeof chainId !== "number" || !Number.isInteger(chainId)) throw new Error("chainId is not an integer.");
  const claimsRaw = o["claims"];
  if (!Array.isArray(claimsRaw) || claimsRaw.length === 0) throw new Error("claims is empty.");
  const claims: DropClaim[] = claimsRaw.map((c: unknown, i: number) => {
    const x = c as Record<string, unknown> | null;
    if (x === null || typeof x !== "object") throw new Error(`claims[${i}] is not an object.`);
    const account = x["account"];
    const amount = x["amount"];
    const proof = x["proof"];
    if (x["index"] !== i) throw new Error(`claims[${i}].index is ${String(x["index"])}; claims must be in index order.`);
    if (typeof account !== "string" || !isAddress(account, { strict: false })) throw new Error(`claims[${i}].account is not an address.`);
    if (typeof amount !== "string" || !/^\d+$/.test(amount)) throw new Error(`claims[${i}].amount is not a base-unit integer string.`);
    if (!Array.isArray(proof) || !proof.every((p) => typeof p === "string" && isHex(p) && p.length === 66)) throw new Error(`claims[${i}].proof is not a list of 32-byte hex strings.`);
    return { index: i, account: getAddress(account), amount, proof: proof as Hex[] };
  });
  const decimals = o["decimals"];
  const symbol = o["symbol"];
  const drop = o["drop"];
  return {
    format: DROP_CLAIMS_FORMAT,
    version: DROP_CLAIMS_VERSION,
    chainId,
    currency: getAddress(currency),
    symbol: typeof symbol === "string" ? symbol : null,
    decimals: typeof decimals === "number" && Number.isInteger(decimals) ? decimals : null,
    merkleRoot: root as Hex,
    total: typeof o["total"] === "string" ? (o["total"] as string) : "0",
    leafEncoding: DROP_LEAF_ENCODING,
    drop: typeof drop === "string" && isAddress(drop, { strict: false }) ? getAddress(drop) : null,
    claims,
  };
}

/**
 * Rebuild the root from the file's claims and check everything a claimer
 * relies on: the rebuilt root equals the file's (and `expectedRoot`, read from
 * the drop, when given), every proof verifies, the total adds up, and the
 * chain and currency match when given.
 */
export function verifyDropClaimsFile(
  file: DropClaimsFile,
  expect: { readonly root?: Hex; readonly chainId?: number; readonly currency?: Address } = {},
): DropClaimsCheck {
  const issues: string[] = [];
  let rebuiltRoot: Hex | null = null;
  try {
    const tree = buildDropTree(file.claims.map((c) => ({ account: c.account, amount: BigInt(c.amount) })));
    rebuiltRoot = tree.root;
    if (tree.root.toLowerCase() !== file.merkleRoot.toLowerCase()) issues.push("The claims do not produce the file's merkleRoot.");
    const bad = file.claims.filter((c) => !verifyMerkleProof(c.proof, tree.root, dropLeaf(c.index, c.account, BigInt(c.amount))));
    if (bad.length > 0) issues.push(`${bad.length} proof(s) do not verify (first: index ${bad[0]?.index}).`);
  } catch (e) {
    issues.push(e instanceof Error ? e.message : String(e));
  }
  const total = file.claims.reduce((s, c) => s + BigInt(c.amount), 0n);
  if (total.toString() !== file.total) issues.push(`The claims add up to ${total}, the file says ${file.total}.`);
  if (expect.root !== undefined && expect.root.toLowerCase() !== file.merkleRoot.toLowerCase()) issues.push("The file is for a different root than this drop's.");
  if (expect.chainId !== undefined && expect.chainId !== file.chainId) issues.push(`The file is for chain ${file.chainId}, not ${expect.chainId}.`);
  if (expect.currency !== undefined && expect.currency.toLowerCase() !== file.currency.toLowerCase()) issues.push("The file is for a different currency than this drop's.");
  return { ok: issues.length === 0, issues, rebuiltRoot };
}

/** Every leaf of `account` in the file (an address listed twice has two). */
export function claimsOf(file: DropClaimsFile, account: string): DropClaim[] {
  const a = account.toLowerCase();
  return file.claims.filter((c) => c.account.toLowerCase() === a);
}
