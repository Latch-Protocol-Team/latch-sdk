// SPDX-License-Identifier: MIT
/* ============================================================================
   Safe v1.4.1 transactions without the Safe Transaction Service.

   Pure functions, shared by the signing room's server (which RE-COMPUTES every
   hash and recovers every signature) and its browser (which builds what the
   owner is about to sign). Nothing here signs, sends or holds a key: the
   inputs are calls, the outputs are calldata, hashes and encodings.

     Transaction Builder JSON  ->  calls           parseTransactionBuilderBatch
     calls                     ->  SafeTx fields   buildSafeTx
     SafeTx fields             ->  safeTxHash      safeTxHash
     signature                 ->  signer          recoverSafeSigner
     signatures                ->  execTransaction encodeExecTransaction

   Safe rules the encodings depend on (Safe.sol / SignatureDecoder.sol 1.4.1):
     * safeTxHash = EIP-712 hash, domain { chainId, verifyingContract }.
     * An owner signs it with eth_signTypedData_v4: 65 bytes r‖s‖v, v ∈ {27, 28}.
       v ∈ {31, 32} means eth_sign over the hash (prefixed); v = 1 an approved
       hash; v = 0 a contract signature. The room accepts typed-data ONLY.
     * execTransaction takes the signatures concatenated in ASCENDING signer
       address order, and reverts GS026 otherwise.
     * A batch is `multiSend(bytes)` on MultiSendCallOnly, reached by
       DELEGATECALL (operation 1); each inner entry is operation 0 (CALL) and
       MultiSendCallOnly reverts on anything else.
   ============================================================================ */

import {
  concatHex,
  decodeFunctionData,
  encodeFunctionData,
  encodePacked,
  getAddress,
  hashTypedData,
  hexToBigInt,
  hexToNumber,
  isAddress,
  isHex,
  parseAbi,
  recoverAddress,
  size,
  sliceHex,
  toFunctionSelector,
  type Abi,
  type AbiFunction,
  type AbiParameter,
  type Address,
  type Hex,
} from "viem";
import { SAFE_TX_TYPES } from "../deployments/safe.js";

export { SAFE_TX_TYPES };

/* ---------------------------------------------------------------------------
   ABI
   --------------------------------------------------------------------------- */

/** The Safe v1.4.1 surface the room reads and encodes. */
export const SAFE_ABI = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function VERSION() view returns (string)",
  "function isOwner(address owner) view returns (bool)",
  "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)",
  "event ExecutionSuccess(bytes32 indexed txHash, uint256 payment)",
  "event ExecutionFailure(bytes32 indexed txHash, uint256 payment)",
]);

export const MULTISEND_ABI = parseAbi(["function multiSend(bytes transactions) payable"]);

export const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

/* ---------------------------------------------------------------------------
   Calls and Safe transactions
   --------------------------------------------------------------------------- */

/** One CALL the Safe makes: directly, or as an entry of a MultiSendCallOnly batch. */
export interface SafeCall {
  readonly to: Address;
  readonly value: bigint;
  readonly data: Hex;
  /** Free text from the batch file (its `_comment` or method name). Display only. */
  readonly label?: string;
}

/** Exactly the fields `safeTxHash` commits to. */
export interface SafeTxFields {
  readonly to: Address;
  readonly value: bigint;
  readonly data: Hex;
  /** 0 CALL, 1 DELEGATECALL. */
  readonly operation: 0 | 1;
  readonly safeTxGas: bigint;
  readonly baseGas: bigint;
  readonly gasPrice: bigint;
  readonly gasToken: Address;
  readonly refundReceiver: Address;
  readonly nonce: bigint;
}

/** The EIP-712 hash an owner signs and `execTransaction` verifies. */
export function safeTxHash(chainId: number, safe: Address, tx: SafeTxFields): Hex {
  return hashTypedData({
    domain: { chainId, verifyingContract: getAddress(safe) },
    types: SAFE_TX_TYPES,
    primaryType: "SafeTx",
    message: {
      to: getAddress(tx.to),
      value: tx.value,
      data: tx.data,
      operation: tx.operation,
      safeTxGas: tx.safeTxGas,
      baseGas: tx.baseGas,
      gasPrice: tx.gasPrice,
      gasToken: getAddress(tx.gasToken),
      refundReceiver: getAddress(tx.refundReceiver),
      nonce: tx.nonce,
    },
  });
}

/** Safe MultiSend packing: uint8 operation (0, CALL) | address to | uint256 value | uint256 len | bytes data. */
export function encodeMultiSendCalls(calls: readonly SafeCall[]): Hex {
  if (calls.length === 0) throw new Error("empty batch");
  const packed = concatHex(calls.map((c) => encodePacked(["uint8", "address", "uint256", "uint256", "bytes"], [0, getAddress(c.to), c.value, BigInt(size(c.data)), c.data])));
  return encodeFunctionData({ abi: MULTISEND_ABI, functionName: "multiSend", args: [packed] });
}

/** Inverse of `encodeMultiSendCalls`, from `multiSend(bytes)` calldata. Throws on malformed packing or a non-CALL entry. */
export function decodeMultiSendCalls(data: Hex): SafeCall[] {
  const { functionName, args } = decodeFunctionData({ abi: MULTISEND_ABI, data });
  if (functionName !== "multiSend") throw new Error("not multiSend(bytes)");
  const tx = args[0] as Hex;
  const total = size(tx);
  const out: SafeCall[] = [];
  let i = 0;
  while (i < total) {
    if (i + 85 > total) throw new Error("truncated MultiSend entry");
    const operation = hexToNumber(sliceHex(tx, i, i + 1));
    if (operation !== 0) throw new Error(`MultiSend entry ${out.length} is operation ${operation}; MultiSendCallOnly accepts CALL only`);
    const to = getAddress(sliceHex(tx, i + 1, i + 21));
    const value = hexToBigInt(sliceHex(tx, i + 21, i + 53));
    const len = Number(hexToBigInt(sliceHex(tx, i + 53, i + 85)));
    if (i + 85 + len > total) throw new Error("MultiSend data length overruns the batch");
    const inner = len === 0 ? "0x" : sliceHex(tx, i + 85, i + 85 + len);
    out.push({ to, value, data: inner });
    i += 85 + len;
  }
  if (out.length === 0) throw new Error("empty MultiSend");
  return out;
}

/**
 * One call becomes a plain CALL from the Safe; two or more become one
 * DELEGATECALL into `multiSendCallOnly`, which CALLs each in order and reverts
 * the whole batch if any reverts. Gas fields are zero (the executor pays, no
 * refund), which is what Safe{Wallet} produces by default.
 */
export function buildSafeTx(p: { calls: readonly SafeCall[]; multiSendCallOnly: Address; nonce: bigint }): SafeTxFields {
  if (p.calls.length === 0) throw new Error("a Safe transaction needs at least one call");
  for (const c of p.calls) {
    if (!isAddress(c.to)) throw new Error(`call target ${String(c.to)} is not an address`);
    if (getAddress(c.to) === ZERO_ADDRESS) throw new Error("refusing a call to the zero address");
    if (!isHex(c.data) || c.data.length % 2 !== 0) throw new Error("call data must be even-length hex");
    if (c.value < 0n) throw new Error("call value must be >= 0");
  }
  if (p.nonce < 0n) throw new Error("nonce must be >= 0");
  const gas = { safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO_ADDRESS, refundReceiver: ZERO_ADDRESS, nonce: p.nonce } as const;
  if (p.calls.length === 1) {
    const c = p.calls[0]!;
    return { to: getAddress(c.to), value: c.value, data: c.data, operation: 0, ...gas };
  }
  return { to: getAddress(p.multiSendCallOnly), value: 0n, data: encodeMultiSendCalls(p.calls), operation: 1, ...gas };
}

/**
 * The calls a SafeTx makes, read back from its own fields (never from what the
 * client claimed): the single CALL, or the entries of the MultiSend batch.
 * Refuses a DELEGATECALL to anything but the chain's MultiSendCallOnly.
 */
export function callsOfSafeTx(tx: SafeTxFields, multiSendCallOnly: Address): SafeCall[] {
  if (tx.operation === 0) return [{ to: getAddress(tx.to), value: tx.value, data: tx.data }];
  if (getAddress(tx.to) !== getAddress(multiSendCallOnly)) throw new Error(`DELEGATECALL to ${tx.to} refused: only the canonical MultiSendCallOnly ${multiSendCallOnly} may be delegatecalled`);
  if (tx.value !== 0n) throw new Error("a MultiSend batch carries value inside its entries, not on the outer transaction");
  return decodeMultiSendCalls(tx.data);
}

/* ---------------------------------------------------------------------------
   Transaction Builder import (Safe{Wallet} "Transaction Builder" app JSON)
   --------------------------------------------------------------------------- */

export interface TransactionBuilderBatch {
  readonly chainId: number;
  readonly name: string;
  readonly description: string;
  readonly createdFromSafeAddress: Address | null;
  readonly calls: SafeCall[];
}

type BuilderTx = {
  to: string;
  value?: string | number | null;
  data?: string | null;
  contractMethod?: { inputs: AbiParameter[]; name: string; payable?: boolean } | null;
  contractInputsValues?: Record<string, unknown> | null;
  _expectedCalldata?: string;
  _comment?: string;
};

/** Convert a Transaction Builder string value to what viem's encoder expects for `type`. */
function coerceInput(param: AbiParameter, raw: unknown): unknown {
  const t = param.type;
  let v = raw;
  const isArray = t.endsWith("]");
  const isTuple = t.startsWith("tuple");
  if ((isArray || isTuple) && typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      throw new Error(`${param.name ?? t}: expected a JSON ${isArray ? "array" : "tuple"} string`);
    }
  }
  if (isArray) {
    if (!Array.isArray(v)) throw new Error(`${param.name ?? t}: expected an array`);
    const inner = { ...param, type: t.slice(0, t.lastIndexOf("[")) } as AbiParameter;
    return v.map((x) => coerceInput(inner, x));
  }
  if (isTuple) {
    const comps = (param as { components?: AbiParameter[] }).components ?? [];
    if (Array.isArray(v)) {
      if (v.length !== comps.length) throw new Error(`${param.name ?? t}: tuple has ${v.length} values, ABI has ${comps.length}`);
      return comps.map((c, i) => coerceInput(c, v[i]));
    }
    if (v && typeof v === "object") return comps.map((c) => coerceInput(c, (v as Record<string, unknown>)[c.name ?? ""]));
    throw new Error(`${param.name ?? t}: expected a tuple`);
  }
  if (/^u?int\d*$/.test(t)) {
    if (typeof v === "bigint") return v;
    if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
    if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return BigInt(v.trim());
    throw new Error(`${param.name ?? t}: expected an integer, got ${JSON.stringify(v)}`);
  }
  if (t === "bool") {
    if (typeof v === "boolean") return v;
    if (v === "true") return true;
    if (v === "false") return false;
    throw new Error(`${param.name ?? t}: expected true or false`);
  }
  if (t === "address") {
    if (typeof v !== "string" || !isAddress(v)) throw new Error(`${param.name ?? t}: expected an address, got ${JSON.stringify(v)}`);
    return getAddress(v);
  }
  if (t.startsWith("bytes")) {
    if (typeof v !== "string" || !isHex(v)) throw new Error(`${param.name ?? t}: expected hex bytes`);
    return v;
  }
  if (t === "string") {
    if (typeof v !== "string") throw new Error(`${param.name ?? t}: expected a string`);
    return v;
  }
  throw new Error(`${param.name ?? t}: unsupported ABI type ${t}`);
}

function encodeBuilderTx(t: BuilderTx, index: number): SafeCall {
  if (typeof t.to !== "string" || !isAddress(t.to)) throw new Error(`transaction ${index}: "to" is not an address`);
  const value = t.value === undefined || t.value === null || t.value === "" ? 0n : BigInt(String(t.value));
  if (value < 0n) throw new Error(`transaction ${index}: negative value`);
  let data: Hex;
  if (t.contractMethod && t.contractMethod.name) {
    const fn: AbiFunction = { type: "function", name: t.contractMethod.name, inputs: t.contractMethod.inputs ?? [], outputs: [], stateMutability: t.contractMethod.payable ? "payable" : "nonpayable" };
    const args = fn.inputs.map((p) => coerceInput(p, (t.contractInputsValues ?? {})[p.name ?? ""]));
    data = encodeFunctionData({ abi: [fn] as Abi, functionName: fn.name, args });
    if (typeof t.data === "string" && t.data !== "0x" && t.data.toLowerCase() !== data.toLowerCase()) {
      throw new Error(`transaction ${index}: "data" disagrees with the encoded contractMethod`);
    }
  } else if (t.data === null || t.data === undefined || t.data === "") {
    data = "0x";
  } else if (typeof t.data === "string" && isHex(t.data) && t.data.length % 2 === 0) {
    data = t.data;
  } else {
    throw new Error(`transaction ${index}: "data" is not hex`);
  }
  if (typeof t._expectedCalldata === "string" && t._expectedCalldata.toLowerCase() !== data.toLowerCase()) {
    throw new Error(`transaction ${index}: encoded calldata differs from _expectedCalldata (the file's own cast calldata output)`);
  }
  const label = typeof t._comment === "string" ? t._comment : t.contractMethod?.name ? `${t.contractMethod.name}(${(t.contractMethod.inputs ?? []).map((i) => i.type).join(",")})` : data === "0x" ? "native transfer" : undefined;
  return { to: getAddress(t.to), value, data, ...(label ? { label } : {}) };
}

/**
 * Parse a Safe{Wallet} Transaction Builder export (`version: "1.0"`). Each
 * transaction is encoded from `contractMethod` + `contractInputsValues` when
 * present (the Builder's own format) and taken from `data` otherwise. Throws on
 * anything it cannot encode exactly; never guesses.
 */
export function parseTransactionBuilderBatch(input: unknown): TransactionBuilderBatch {
  const b = (typeof input === "string" ? JSON.parse(input) : input) as { version?: string; chainId?: string | number; meta?: { name?: string; description?: string; createdFromSafeAddress?: string }; transactions?: BuilderTx[] };
  if (!b || typeof b !== "object") throw new Error("not a Transaction Builder batch");
  if (b.version !== undefined && String(b.version) !== "1.0") throw new Error(`unsupported batch version ${String(b.version)}`);
  const chainId = Number(b.chainId);
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error("batch has no chainId");
  if (!Array.isArray(b.transactions) || b.transactions.length === 0) throw new Error("batch has no transactions");
  const from = b.meta?.createdFromSafeAddress;
  return {
    chainId,
    name: String(b.meta?.name ?? ""),
    description: String(b.meta?.description ?? ""),
    createdFromSafeAddress: typeof from === "string" && isAddress(from) ? getAddress(from) : null,
    calls: b.transactions.map((t, i) => encodeBuilderTx(t, i)),
  };
}

/* ---------------------------------------------------------------------------
   The refused-call list: calls whose consequence cannot be walked back
   --------------------------------------------------------------------------- */

export interface DoNotQueueRule {
  readonly selector: Hex;
  readonly signature: string;
  readonly reason: string;
  /** When set, only a call whose first argument is this value is refused (else every call to the selector). */
  readonly onlyWhenArgIs?: Hex;
}

const sel = (sig: string) => toFunctionSelector(sig);

/**
 * Calls the room refuses to store as a proposal, whatever their target. The
 * list is by selector: a compromised admin that could talk the API into
 * storing one of these would still need two owner signatures, but the room's
 * job is to make the mistake impossible to queue, not merely hard to sign.
 */
export const DO_NOT_QUEUE: readonly DoNotQueueRule[] = [
  { selector: sel("function renounceOwnership()"), signature: "renounceOwnership()", reason: "Permanent loss of every owner power on the target (registerApp, unpause, fee-controller install, the RevShare switch). The legitimate form is transferOwnership." },
  { selector: sel("function updateDelay(uint256)"), signature: "updateDelay(uint256)", reason: "A timelock delay change. updateDelay(0) removes the tier and a delay-0 operation executes in the block it is queued; only the Safe could cancel it." },
  { selector: sel("function setProtocolFeeController(address)"), signature: "setProtocolFeeController(address)", reason: "Replaces fee authority over every pool; address(0) zeroes every new pool's protocol fee until reinstalled.", onlyWhenArgIs: `0x${"0".repeat(64)}` },
  { selector: sel("function registerApp(address)"), signature: "registerApp(address)", reason: "Vault.registerApp grants an app permanent authority to move Vault funds and cannot be undone. It is queued on the custody timelock after a review, never signed directly in this room." },
];

export interface DoNotQueueHit {
  readonly index: number;
  readonly to: Address;
  readonly selector: Hex;
  readonly signature: string;
  readonly reason: string;
}

/** Every call in `calls` that the do-not-queue list forbids. Empty means none. */
export function doNotQueueHits(calls: readonly SafeCall[]): DoNotQueueHit[] {
  const out: DoNotQueueHit[] = [];
  calls.forEach((c, index) => {
    if (c.data.length < 10) return;
    const selector = c.data.slice(0, 10).toLowerCase() as Hex;
    for (const rule of DO_NOT_QUEUE) {
      if (rule.selector.toLowerCase() !== selector) continue;
      if (rule.onlyWhenArgIs !== undefined) {
        const arg = c.data.slice(10, 74).toLowerCase();
        if (arg !== rule.onlyWhenArgIs.slice(2).toLowerCase()) continue;
      }
      out.push({ index, to: c.to, selector, signature: rule.signature, reason: rule.reason });
    }
  });
  return out;
}

/* ---------------------------------------------------------------------------
   Signatures
   --------------------------------------------------------------------------- */

export interface SafeOwnerSignature {
  readonly owner: Address;
  /** 65 bytes r‖s‖v with v ∈ {27, 28}: an eth_signTypedData_v4 signature over safeTxHash. */
  readonly signature: Hex;
}

/** r, s, v of a 65-byte signature. Throws on any other length. */
export function splitSignature(signature: Hex): { r: Hex; s: Hex; v: number } {
  if (!isHex(signature) || size(signature) !== 65) throw new Error("a Safe owner signature is exactly 65 bytes");
  return { r: sliceHex(signature, 0, 32), s: sliceHex(signature, 32, 64), v: hexToNumber(sliceHex(signature, 64, 65)) };
}

/**
 * The signer of a typed-data signature over `hash`. Refuses the other Safe
 * signature kinds by their `v`: 31/32 (eth_sign over the prefixed hash — what a
 * wallet produces from personal_sign, and what Safe{Wallet} v1.4.1 disables by
 * default), 0 (contract signature), 1 (pre-approved hash).
 */
export async function recoverSafeSigner(hash: Hex, signature: Hex): Promise<Address> {
  const { v } = splitSignature(signature);
  if (v !== 27 && v !== 28) {
    const kind = v === 31 || v === 32 ? "eth_sign (personal_sign over the hash)" : v === 0 ? "a contract signature" : v === 1 ? "an approved-hash marker" : `v = ${v}`;
    throw new Error(`not an eth_signTypedData_v4 signature: ${kind}. Sign the EIP-712 SafeTx, not its hash.`);
  }
  return getAddress(await recoverAddress({ hash, signature }));
}

/** Signatures concatenated in ascending signer-address order, as execTransaction requires (GS026 otherwise). */
export function packSignatures(sigs: readonly SafeOwnerSignature[]): Hex {
  const seen = new Set<string>();
  const sorted = [...sigs].sort((a, b) => (a.owner.toLowerCase() < b.owner.toLowerCase() ? -1 : a.owner.toLowerCase() > b.owner.toLowerCase() ? 1 : 0));
  for (const s of sorted) {
    const k = s.owner.toLowerCase();
    if (seen.has(k)) throw new Error(`duplicate signature from ${s.owner}`);
    seen.add(k);
    splitSignature(s.signature);
  }
  return concatHex(sorted.map((s) => s.signature));
}

/** `execTransaction(...)` calldata for the Safe, from the fields and the owners' signatures. */
export function encodeExecTransaction(tx: SafeTxFields, sigs: readonly SafeOwnerSignature[]): Hex {
  return encodeFunctionData({
    abi: SAFE_ABI,
    functionName: "execTransaction",
    args: [getAddress(tx.to), tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, getAddress(tx.gasToken), getAddress(tx.refundReceiver), packSignatures(sigs)],
  });
}

/** `getTransactionHash(...)` calldata: the same hash from the contract itself, for a read-only cross-check. */
export function encodeGetTransactionHash(tx: SafeTxFields): Hex {
  return encodeFunctionData({
    abi: SAFE_ABI,
    functionName: "getTransactionHash",
    args: [getAddress(tx.to), tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, getAddress(tx.gasToken), getAddress(tx.refundReceiver), tx.nonce],
  });
}
