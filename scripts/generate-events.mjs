// SPDX-License-Identifier: MIT
/**
 * Code generator for the LatchProtocol SDK.
 *
 * Reads the Foundry build artifacts produced by the (GPL-licensed) Solidity
 * packages and emits MIT-licensed TypeScript from the *ABI JSON* only.
 *
 * The ABI is a machine-generated interface description - function/event
 * selectors, argument names and argument types. This generator never reads
 * Solidity sources, comments or NatSpec, so nothing expressive crosses the
 * licence boundary into this package.
 *
 * Usage: node scripts/generate-events.mjs [--artifacts <dir>] [--check]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toEventSelector, toEventSignature } from "viem";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "..");
const DEFAULT_ARTIFACTS = resolve(PKG_ROOT, "..", "core", "foundry-out");
const OUT_DIR = join(PKG_ROOT, "src", "generated");

/**
 * Contracts whose events make up the observable surface of the protocol.
 * `ProtocolFees` is the shared base of both pool managers; its events are
 * re-emitted by CLPoolManager and BinPoolManager, and are generated here too
 * so indexers can reference the base definitions directly.
 */
const CONTRACTS = [
  { name: "Vault", artifact: "Vault.sol/Vault.json" },
  { name: "CLPoolManager", artifact: "CLPoolManager.sol/CLPoolManager.json" },
  { name: "BinPoolManager", artifact: "BinPoolManager.sol/BinPoolManager.json" },
  { name: "ProtocolFees", artifact: "ProtocolFees.sol/ProtocolFees.json" },
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const artifactsIdx = argv.indexOf("--artifacts");
const artifactsDir =
  artifactsIdx !== -1 && argv[artifactsIdx + 1]
    ? resolve(process.cwd(), argv[artifactsIdx + 1])
    : DEFAULT_ARTIFACTS;
const checkOnly = argv.includes("--check");

// ---------------------------------------------------------------------------
// Solidity -> TypeScript type mapping
// ---------------------------------------------------------------------------

/** Integer widths at or below this many bits round-trip exactly through `number`. */
const SAFE_INT_BITS = 48;

/**
 * @param {{type: string, components?: any[]}} input
 * @returns {string}
 */
function tsTypeOf(input) {
  const arrayMatch = /^(.*)\[(\d*)\]$/.exec(input.type);
  if (arrayMatch) {
    const inner = tsTypeOf({ ...input, type: arrayMatch[1] });
    return `readonly (${inner})[]`;
  }

  const t = input.type;
  if (t === "address") return "Address";
  if (t === "bool") return "boolean";
  if (t === "string") return "string";
  if (t === "bytes" || /^bytes([1-9]|[12]\d|3[0-2])$/.test(t)) return "Hex";

  const intMatch = /^(u?)int(\d*)$/.exec(t);
  if (intMatch) {
    const bits = intMatch[2] === "" ? 256 : Number(intMatch[2]);
    return bits <= SAFE_INT_BITS ? "number" : "bigint";
  }

  if (t === "tuple") {
    const fields = (input.components ?? []).map(
      (c, i) => `readonly ${c.name || `_${i}`}: ${tsTypeOf(c)}`,
    );
    return `{ ${fields.join("; ")} }`;
  }

  throw new Error(`Unmapped Solidity type: ${t}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pascal = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const jsonLiteral = (v) => JSON.stringify(v);

function loadEvents(contract) {
  const path = join(artifactsDir, contract.artifact);
  if (!existsSync(path)) {
    throw new Error(
      `Artifact not found: ${path}\n` +
        `Build the Solidity packages first, or pass --artifacts <dir>.`,
    );
  }
  const artifact = JSON.parse(readFileSync(path, "utf8"));
  const abi = artifact.abi;
  if (!Array.isArray(abi)) throw new Error(`Artifact has no 'abi' array: ${path}`);
  return abi
    .filter((item) => item.type === "event")
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Renders an ABI event fragment as a TypeScript object literal. */
function renderAbiEvent(event, indent) {
  const pad = " ".repeat(indent);
  const inner = " ".repeat(indent + 2);
  const renderInput = (input, depth) => {
    const p = " ".repeat(depth);
    const parts = [
      `${p}  name: ${jsonLiteral(input.name ?? "")}`,
      `${p}  type: ${jsonLiteral(input.type)}`,
      `${p}  indexed: ${input.indexed === true}`,
    ];
    if (input.internalType) parts.push(`${p}  internalType: ${jsonLiteral(input.internalType)}`);
    if (input.components) {
      const nested = input.components
        .map((c) => renderInput(c, depth + 4))
        .join(",\n");
      parts.push(`${p}  components: [\n${nested}\n${p}  ]`);
    }
    return `${p}{\n${parts.join(",\n")}\n${p}}`;
  };

  const inputs = event.inputs.map((i) => renderInput(i, indent + 4)).join(",\n");
  return [
    `${pad}{`,
    `${inner}type: "event",`,
    `${inner}name: ${jsonLiteral(event.name)},`,
    `${inner}anonymous: ${event.anonymous === true},`,
    `${inner}inputs: [`,
    inputs,
    `${inner}],`,
    `${pad}}`,
  ].join("\n");
}

const BANNER = `// SPDX-License-Identifier: MIT
// -----------------------------------------------------------------------------
// GENERATED FILE - DO NOT EDIT BY HAND.
// Produced by scripts/generate-events.mjs from the compiled contract ABIs.
// Re-run \`npm run generate\` after the contracts are rebuilt.
// -----------------------------------------------------------------------------
`;

// ---------------------------------------------------------------------------
// Emit: abi.ts
// ---------------------------------------------------------------------------

function emitAbi(collected) {
  const lines = [BANNER];
  lines.push(`import type { Abi } from "viem";\n`);

  for (const { name, events } of collected) {
    const constName = `${screamingSnake(name)}_EVENTS_ABI`;
    lines.push(
      `/** Event fragments of the \`${name}\` contract (${events.length} events). */`,
    );
    lines.push(`export const ${constName} = [`);
    lines.push(events.map((e) => renderAbiEvent(e, 2)).join(",\n"));
    lines.push(`] as const satisfies Abi;\n`);
  }

  lines.push(`/** Every event fragment the protocol can emit, keyed by contract. */`);
  lines.push(`export const LATCH_PROTOCOL_EVENT_ABIS = {`);
  for (const { name } of collected) {
    lines.push(`  ${name}: ${screamingSnake(name)}_EVENTS_ABI,`);
  }
  lines.push(`} as const;\n`);

  lines.push(`/** Flat ABI containing the event fragments of every core contract. */`);
  lines.push(`export const LATCH_PROTOCOL_EVENTS_ABI = [`);
  for (const { name } of collected) {
    lines.push(`  ...${screamingSnake(name)}_EVENTS_ABI,`);
  }
  lines.push(`] as const satisfies Abi;`);

  return lines.join("\n") + "\n";
}

/** `CLPoolManager` -> `CL_POOL_MANAGER`, `DynamicLPFeeUpdated` -> `DYNAMIC_LP_FEE_UPDATED`. */
function screamingSnake(name) {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toUpperCase();
}

// ---------------------------------------------------------------------------
// Emit: events.ts
// ---------------------------------------------------------------------------

function emitEvents(collected) {
  const lines = [BANNER];
  lines.push(`import type { Address, Hex } from "viem";\n`);

  // --- per-event argument interfaces -------------------------------------
  const descriptors = [];

  for (const { name: contract, events } of collected) {
    lines.push(
      `// ---------------------------------------------------------------------------`,
    );
    lines.push(`// ${contract}`);
    lines.push(
      `// ---------------------------------------------------------------------------\n`,
    );

    for (const event of events) {
      const typeName = `${contract}${pascal(event.name)}Args`;
      const signature = toEventSignature(event);
      const topic0 = toEventSelector(event);

      lines.push(`/**`);
      lines.push(` * Decoded arguments of \`${contract}.${event.name}\`.`);
      lines.push(` *`);
      lines.push(` * Signature: \`${signature}\``);
      lines.push(` * topic0: \`${topic0}\``);
      lines.push(` */`);
      lines.push(`export interface ${typeName} {`);
      event.inputs.forEach((input, i) => {
        const fieldName = input.name && input.name.length > 0 ? input.name : `arg${i}`;
        const indexedNote = input.indexed ? " (indexed)" : "";
        lines.push(`  /** \`${input.type}\`${indexedNote} */`);
        lines.push(`  readonly ${fieldName}: ${tsTypeOf(input)};`);
      });
      if (event.inputs.length === 0) lines.push(`  // no arguments`);
      lines.push(`}\n`);

      descriptors.push({
        contract,
        eventName: event.name,
        typeName,
        signature,
        topic0,
        indexedCount: event.inputs.filter((i) => i.indexed).length,
        constName: `${screamingSnake(contract)}_${screamingSnake(event.name)}`,
      });
    }
  }

  // --- topic0 constants ---------------------------------------------------
  lines.push(
    `// ---------------------------------------------------------------------------`,
  );
  lines.push(`// topic0 (event selector) constants`);
  lines.push(
    `// ---------------------------------------------------------------------------\n`,
  );
  lines.push(`export const EVENT_TOPICS = {`);
  for (const d of descriptors) {
    lines.push(`  /** \`${d.signature}\` */`);
    lines.push(`  ${d.constName}: ${jsonLiteral(d.topic0)},`);
  }
  lines.push(`} as const satisfies Record<string, Hex>;\n`);

  // --- descriptor table ---------------------------------------------------
  lines.push(
    `// ---------------------------------------------------------------------------`,
  );
  lines.push(`// Runtime descriptor table`);
  lines.push(
    `// ---------------------------------------------------------------------------\n`,
  );
  lines.push(`export interface EventDescriptor {`);
  lines.push(`  /** Contract that declares the event. */`);
  lines.push(`  readonly contract: ContractName;`);
  lines.push(`  /** Solidity event name (not unique across contracts). */`);
  lines.push(`  readonly eventName: string;`);
  lines.push(`  /** Canonical signature used to derive topic0. */`);
  lines.push(`  readonly signature: string;`);
  lines.push(`  /** keccak256 of the canonical signature. */`);
  lines.push(`  readonly topic0: Hex;`);
  lines.push(`  /** Number of indexed parameters (topics 1..3). */`);
  lines.push(`  readonly indexedCount: number;`);
  lines.push(`}\n`);

  lines.push(`export const EVENT_DESCRIPTORS = [`);
  for (const d of descriptors) {
    lines.push(
      `  { contract: ${jsonLiteral(d.contract)}, eventName: ${jsonLiteral(
        d.eventName,
      )}, signature: ${jsonLiteral(d.signature)}, topic0: ${jsonLiteral(
        d.topic0,
      )}, indexedCount: ${d.indexedCount} },`,
    );
  }
  lines.push(`] as const satisfies readonly EventDescriptor[];\n`);

  // --- contract / event name unions --------------------------------------
  lines.push(`export const CONTRACT_NAMES = [`);
  for (const { name } of collected) lines.push(`  ${jsonLiteral(name)},`);
  lines.push(`] as const;\n`);
  lines.push(`export type ContractName = (typeof CONTRACT_NAMES)[number];\n`);

  for (const { name: contract, events } of collected) {
    lines.push(
      `export type ${contract}EventName =\n${events
        .map((e) => `  | ${jsonLiteral(e.name)}`)
        .join("\n")};\n`,
    );
  }

  // --- per-contract arg maps ---------------------------------------------
  for (const { name: contract, events } of collected) {
    lines.push(`/** Maps each \`${contract}\` event name to its decoded argument type. */`);
    lines.push(`export interface ${contract}EventArgsMap {`);
    for (const e of events) {
      lines.push(`  ${jsonLiteral(e.name)}: ${contract}${pascal(e.name)}Args;`);
    }
    lines.push(`}\n`);
  }

  // --- discriminated union ------------------------------------------------
  lines.push(`/** Envelope carried by every decoded log. */`);
  lines.push(`export interface DecodedEventBase {`);
  lines.push(`  readonly address: Address;`);
  lines.push(`  readonly blockNumber: bigint;`);
  lines.push(`  readonly blockTimestamp: bigint;`);
  lines.push(`  readonly transactionHash: Hex;`);
  lines.push(`  readonly logIndex: number;`);
  lines.push(`}\n`);

  for (const d of descriptors) {
    lines.push(`export interface ${d.contract}${pascal(d.eventName)}Event extends DecodedEventBase {`);
    lines.push(`  readonly contract: ${jsonLiteral(d.contract)};`);
    lines.push(`  readonly eventName: ${jsonLiteral(d.eventName)};`);
    lines.push(`  readonly args: ${d.typeName};`);
    lines.push(`}\n`);
  }

  lines.push(`/** Every decoded protocol event, discriminated by \`contract\` + \`eventName\`. */`);
  lines.push(
    `export type LatchProtocolEvent =\n${descriptors
      .map((d) => `  | ${d.contract}${pascal(d.eventName)}Event`)
      .join("\n")};\n`,
  );

  lines.push(`/** Total number of distinct event declarations across all core contracts. */`);
  lines.push(`export const EVENT_COUNT = ${descriptors.length} as const;\n`);

  lines.push(
    `/** Number of unique event signatures (deduplicated across contracts). */`,
  );
  const uniqueTopics = new Set(descriptors.map((d) => d.topic0));
  lines.push(`export const UNIQUE_EVENT_SIGNATURE_COUNT = ${uniqueTopics.size} as const;`);

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const collected = CONTRACTS.map((c) => ({ name: c.name, events: loadEvents(c) }));

  const outputs = {
    "abi.ts": emitAbi(collected),
    "events.ts": emitEvents(collected),
  };

  mkdirSync(OUT_DIR, { recursive: true });

  let drift = false;
  for (const [file, contents] of Object.entries(outputs)) {
    const path = join(OUT_DIR, file);
    const existing = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (existing === contents) continue;
    if (checkOnly) {
      drift = true;
      console.error(`out of date: ${path}`);
    } else {
      writeFileSync(path, contents, "utf8");
    }
  }

  if (checkOnly && drift) {
    console.error("Generated sources are stale. Run `npm run generate`.");
    process.exit(1);
  }

  const total = collected.reduce((n, c) => n + c.events.length, 0);
  const unique = new Set(
    collected.flatMap((c) => c.events.map((e) => toEventSelector(e))),
  ).size;
  for (const c of collected) {
    console.log(`  ${c.name.padEnd(16)} ${String(c.events.length).padStart(2)} events`);
  }
  console.log(
    `generated ${total} event declarations (${unique} unique signatures) into src/generated/`,
  );
}

main();
