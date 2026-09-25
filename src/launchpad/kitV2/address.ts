// SPDX-License-Identifier: MIT
/* ============================================================================
   Where a Kit v2 launch token will land, before it exists.

   A launch's pool ids contain the token address, so a UI must know the address
   to show the pools, check the CL side rule (token sorting decides it) or map a
   Bin shape onto ids. The kit makes it predictable, in two nested hashes:

     salt      = keccak256(abi.encode(launcher, userSalt))       // the kit folds in msg.sender
     effective = keccak256(abi.encode(kit, salt))                 // the factory folds in ITS caller
     token     = CREATE2(factory, effective, launchTokenInitCodeHash)

   Folding the launcher in means a front-runner copying a pending `createLaunch`
   lands on a different address: nobody can squat another launcher's token.

   Two ways to get it, and they must agree:

     * `predictLaunchTokenAddress` - pure, from the kit address, the factory
       address and the factory's `launchTokenInitCodeHash()`. No RPC needed once
       those three are known; good for mining a vanity salt.
     * `readPredictedLaunchToken` - `kit.predictLaunchToken(launcher, userSalt)`
       on chain. The authority.

   `predictLaunchTokenChecked` does both and throws if they differ, which can only
   mean the SDK and the deployed kit disagree about the rule - never render a pool
   id derived from an address in that state.
   ============================================================================ */

import {
  encodeAbiParameters,
  getContractAddress,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { LAUNCHPAD_KIT_V2_ABI, LAUNCH_TOKEN_FACTORY_ABI } from "../generated/abi.js";

const ADDRESS_BYTES32 = [{ type: "address" }, { type: "bytes32" }] as const;

/** `keccak256(abi.encode(launcher, userSalt))`: the salt the kit hands the factory. */
export function kitV2LaunchSalt(launcher: Address, userSalt: Hex): Hex {
  return keccak256(encodeAbiParameters(ADDRESS_BYTES32, [launcher, userSalt]));
}

export interface PredictLaunchTokenArgs {
  /** The `LaunchpadKitV2` the launch will be sent to. */
  readonly kit: Address;
  /** `kit.tokenFactory()`. */
  readonly factory: Address;
  /** `factory.launchTokenInitCodeHash()`. Read it; it is a property of the factory build. */
  readonly initCodeHash: Hex;
  /** The account that will SEND `createLaunch` (`msg.sender`), not the creator field. */
  readonly launcher: Address;
  /** `LaunchParamsV2.userSalt`. */
  readonly userSalt: Hex;
}

/** The launch token address, computed off chain. See the module header for the rule. */
export function predictLaunchTokenAddress(args: PredictLaunchTokenArgs): Address {
  const salt = kitV2LaunchSalt(args.launcher, args.userSalt);
  const effective = keccak256(encodeAbiParameters(ADDRESS_BYTES32, [args.kit, salt]));
  return getContractAddress({
    opcode: "CREATE2",
    from: args.factory,
    salt: effective,
    bytecodeHash: args.initCodeHash,
  });
}

/** `kit.predictLaunchToken(launcher, userSalt)`, on chain. */
export async function readPredictedLaunchToken(
  client: PublicClient,
  kit: Address,
  launcher: Address,
  userSalt: Hex,
): Promise<Address> {
  return client.readContract({
    address: kit,
    abi: LAUNCHPAD_KIT_V2_ABI,
    functionName: "predictLaunchToken",
    args: [launcher, userSalt],
  });
}

/** The two inputs off-chain prediction needs besides the kit address: the factory and its init-code hash. */
export async function readLaunchTokenFactoryInputs(
  client: PublicClient,
  kit: Address,
): Promise<{ readonly factory: Address; readonly initCodeHash: Hex }> {
  const factory = await client.readContract({ address: kit, abi: LAUNCHPAD_KIT_V2_ABI, functionName: "tokenFactory" });
  const initCodeHash = await client.readContract({
    address: factory,
    abi: LAUNCH_TOKEN_FACTORY_ABI,
    functionName: "launchTokenInitCodeHash",
  });
  return { factory, initCodeHash };
}

/**
 * Both routes, cross-checked. Returns the address only when the kit's own view
 * and the off-chain computation agree.
 */
export async function predictLaunchTokenChecked(
  client: PublicClient,
  kit: Address,
  launcher: Address,
  userSalt: Hex,
): Promise<Address> {
  const [{ factory, initCodeHash }, onChain] = await Promise.all([
    readLaunchTokenFactoryInputs(client, kit),
    readPredictedLaunchToken(client, kit, launcher, userSalt),
  ]);
  const offChain = predictLaunchTokenAddress({ kit, factory, initCodeHash, launcher, userSalt });
  if (offChain.toLowerCase() !== onChain.toLowerCase()) {
    throw new Error(
      `LaunchpadKitV2 at ${kit} predicts ${onChain} but the SDK computes ${offChain}. The SDK and this kit ` +
        "disagree about the launch-token address rule; do not derive pool ids from either until that is explained.",
    );
  }
  return onChain;
}
