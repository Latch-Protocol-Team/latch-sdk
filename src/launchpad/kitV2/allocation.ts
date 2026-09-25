// SPDX-License-Identifier: MIT
/**
 * A Kit v2 launch's ALLOCATION: the launch-token supply that did NOT go into a
 * locked pool, and who received it.
 *
 * What the kit does (`LaunchpadKitV2.createLaunch` → `LaunchLegs`): it mints
 * `totalSupply` to itself, seeds `seedSupply` across the legs (every seeded
 * unit is locked in `LatchLPLocker` / `LatchBinLPLocker` for good), then sends
 * EVERYTHING it still holds - `totalSupply - seedSupply` plus the few wei of
 * seeding rounding dust - in ONE transfer to `allocationRecipient`, or to the
 * creator when that is zero (only allowed when `seedSupply == totalSupply`, so
 * then it is only dust). The kit asserts it ends holding none.
 *
 * The recipient is NOT stored anywhere on chain: not in `LaunchRecordV2`, not
 * in `LaunchCreated`. The only record is that transfer in the creating
 * transaction's receipt: `Transfer(from = kit, to = recipient)` on the launch
 * token. Seeding moves the token from the kit to the Vault (settlement), so a
 * transfer from the kit to anything but the Vault is the allocation.
 *
 * The kit creates NO token lock, vesting or claim schedule for the allocation:
 * it is a plain ERC-20 balance of the recipient from the launch block on.
 */

import { decodeEventLog, parseAbiItem, type Address, type Hex, type Log, type PublicClient } from "viem";

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

export interface LaunchAllocation {
  /** Who received the unseeded supply (plus seeding dust). */
  readonly recipient: Address;
  /** What that transfer moved, in launch-token base units. */
  readonly amount: bigint;
  /** `totalSupply - seedSupply`: the allocation proper, without dust. */
  readonly unseeded: bigint;
  /** `amount - unseeded`: seeding rounding dust (a few wei). */
  readonly dust: bigint;
  /** `true` when the whole supply was seeded: the transfer is dust only, there is no allocation. */
  readonly dustOnly: boolean;
}

/**
 * Picks the allocation transfer out of a launch transaction's logs (pure).
 * `null` when the receipt shows no transfer from the kit except to the Vault:
 * the whole supply was seeded and no dust was left over.
 */
export function launchAllocationFromLogs(args: {
  readonly logs: readonly Pick<Log, "address" | "data" | "topics">[];
  readonly token: Address;
  readonly kit: Address;
  readonly vault: Address;
  readonly totalSupply: bigint;
  readonly seedSupply: bigint;
}): LaunchAllocation | null {
  const token = args.token.toLowerCase();
  const kit = args.kit.toLowerCase();
  const vault = args.vault.toLowerCase();
  let found: { recipient: Address; amount: bigint } | null = null;
  for (const log of args.logs) {
    if (log.address.toLowerCase() !== token) continue;
    let d: { eventName: string; args: { from: Address; to: Address; value: bigint } };
    try {
      d = decodeEventLog({ abi: [TRANSFER], data: log.data, topics: log.topics as [Hex, ...Hex[]] }) as typeof d;
    } catch {
      continue;
    }
    if (d.args.from.toLowerCase() !== kit) continue;
    const to = d.args.to.toLowerCase();
    if (to === vault) continue;
    // The kit makes exactly one such transfer, last. Keep the last one if a token ever emitted more.
    found = { recipient: d.args.to, amount: d.args.value };
  }
  if (found === null) return null;
  const unseeded = args.totalSupply > args.seedSupply ? args.totalSupply - args.seedSupply : 0n;
  const dust = found.amount > unseeded ? found.amount - unseeded : 0n;
  return { recipient: found.recipient, amount: found.amount, unseeded, dust, dustOnly: unseeded === 0n };
}

/** `launchAllocationFromLogs` over the creating transaction's receipt. */
export async function readLaunchAllocation(
  client: PublicClient,
  args: { readonly txHash: Hex; readonly token: Address; readonly kit: Address; readonly vault: Address; readonly totalSupply: bigint; readonly seedSupply: bigint },
): Promise<LaunchAllocation | null> {
  const receipt = await client.getTransactionReceipt({ hash: args.txHash });
  if (receipt.status !== "success") throw new Error(`Launch transaction ${args.txHash} did not succeed.`);
  return launchAllocationFromLogs({ ...args, logs: receipt.logs });
}
