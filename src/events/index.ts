// SPDX-License-Identifier: MIT
/**
 * Typed protocol events.
 *
 * Everything under `src/generated` is produced by `npm run generate` from the
 * compiled contract ABIs. This module re-exports it and adds the small runtime
 * helpers an indexer needs: look a log's topic0 up, and decode it.
 */

import { decodeEventLog, type Hex, type Log } from "viem";
import {
  BIN_POOL_MANAGER_EVENTS_ABI,
  CL_POOL_MANAGER_EVENTS_ABI,
  LATCH_PROTOCOL_EVENTS_ABI,
  LATCH_PROTOCOL_EVENT_ABIS,
  PROTOCOL_FEES_EVENTS_ABI,
  VAULT_EVENTS_ABI,
} from "../generated/abi.js";
import {
  EVENT_DESCRIPTORS,
  type ContractName,
  type EventDescriptor,
} from "../generated/events.js";

export * from "../generated/abi.js";
export * from "../generated/events.js";

/** Every descriptor sharing a topic0, across all contracts. */
const BY_TOPIC: ReadonlyMap<Hex, readonly EventDescriptor[]> = (() => {
  const map = new Map<Hex, EventDescriptor[]>();
  for (const descriptor of EVENT_DESCRIPTORS) {
    const bucket = map.get(descriptor.topic0);
    if (bucket) bucket.push(descriptor);
    else map.set(descriptor.topic0, [descriptor]);
  }
  return map;
})();

/** Descriptors keyed by `"Contract.Event"`. */
const BY_QUALIFIED_NAME: ReadonlyMap<string, EventDescriptor> = new Map(
  EVENT_DESCRIPTORS.map((d) => [`${d.contract}.${d.eventName}`, d]),
);

/**
 * All events matching a topic0.
 *
 * Several contracts declare identical events (both pool managers emit
 * `ProtocolFeeUpdated`, for instance), so a topic0 can map to more than one
 * descriptor. Disambiguate with the log's emitting address.
 */
export function descriptorsForTopic(topic0: Hex): readonly EventDescriptor[] {
  return BY_TOPIC.get(topic0.toLowerCase() as Hex) ?? BY_TOPIC.get(topic0) ?? [];
}

/** Looks a descriptor up by contract and event name. */
export function descriptorFor(
  contract: ContractName,
  eventName: string,
): EventDescriptor | undefined {
  return BY_QUALIFIED_NAME.get(`${contract}.${eventName}`);
}

/** True when `topic0` belongs to a protocol event. */
export function isProtocolEventTopic(topic0: Hex): boolean {
  return descriptorsForTopic(topic0).length > 0;
}

/** Every topic0 the protocol can emit, deduplicated - useful as a log filter. */
export const ALL_EVENT_TOPICS: readonly Hex[] = [...BY_TOPIC.keys()];

/** Event ABI for a single contract. */
export function eventAbiFor(contract: ContractName) {
  return LATCH_PROTOCOL_EVENT_ABIS[contract];
}

/** A decoded log, tagged with the contract whose ABI decoded it. */
export interface DecodedProtocolLog {
  readonly contract: ContractName;
  readonly eventName: string;
  readonly args: Record<string, unknown>;
}

/**
 * Decodes a log against a contract's event ABI.
 *
 * Returns `undefined` rather than throwing when the log is not one of that
 * contract's events, so it can be used to filter a mixed stream.
 */
export function decodeProtocolLog(
  contract: ContractName,
  log: Pick<Log, "data" | "topics">,
): DecodedProtocolLog | undefined {
  const topic0 = log.topics[0];
  if (topic0 === undefined) return undefined;
  const candidates = descriptorsForTopic(topic0).filter((d) => d.contract === contract);
  if (candidates.length === 0) return undefined;

  try {
    const decoded = decodeEventLog({
      abi: eventAbiFor(contract),
      data: log.data,
      topics: log.topics,
    });
    return {
      contract,
      eventName: decoded.eventName as string,
      args: (decoded.args ?? {}) as Record<string, unknown>,
    };
  } catch {
    return undefined;
  }
}

/** Event ABIs re-exported under short names for convenience. */
export const EventAbis = {
  Vault: VAULT_EVENTS_ABI,
  CLPoolManager: CL_POOL_MANAGER_EVENTS_ABI,
  BinPoolManager: BIN_POOL_MANAGER_EVENTS_ABI,
  ProtocolFees: PROTOCOL_FEES_EVENTS_ABI,
  All: LATCH_PROTOCOL_EVENTS_ABI,
} as const;
