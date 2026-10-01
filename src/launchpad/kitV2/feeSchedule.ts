// SPDX-License-Identifier: MIT
/* ============================================================================
   A launch guard's fee schedule, resolved off chain for any second.

   BOTH GENERATIONS OF GUARD share it (`./guardGeneration.js`): the schedule says
   how much the fee is, the generation says who charges it and in which currency.
   This is `feeAt(poolId, timestamp)` of `LaunchGuardHook` / `BinLaunchGuardHook`,
   line for line:

       not enabled                     the final fee, from birth
       timestamp <  startTime          the opening fee
       elapsed   >= decaySeconds       the final fee
       otherwise                       opening - floor(spread * elapsed / decaySeconds)

   The DISCOUNT is floored, so the RATE rounds up, as the contract's does.

   WHY IT EXISTS. A fee that decays changes with no transaction, so no log marks
   the second it changes and a stored rate is not a live one. Anything that
   serves a rate from indexed logs resolves it against a clock with this, and
   says which clock. A caller with a chain to hand reads `currentFee(poolId)`
   instead: that is the authority.

   Rates are hundredths of a bip (1_000_000 = 100%), whatever the fields that
   carry them are called: the guard's `initialFeeBips` and `finalFeeBips` are in
   these units too.
   ============================================================================ */

/** The five numbers of `getLaunch(poolId)` (or of a `LaunchConfigured` log) that decide the fee. */
export interface GuardFeeSchedule {
  /** Unix seconds. */
  readonly startTime: bigint | number;
  readonly decaySeconds: number;
  /** The opening fee, hundredths of a bip (`initialFeeBips`). */
  readonly initialFeePips: number;
  /** The permanent fee, hundredths of a bip (`finalFeeBips`). */
  readonly finalFeePips: number;
  /** `false`: no opening window; the pool charges the final fee from birth. */
  readonly enabled: boolean;
}

/** Where a schedule stands at a given second. `flat`: the schedule is not enabled, so there is no window. */
export type GuardFeePhase = "flat" | "scheduled" | "decaying" | "settled";

const MAX_FEE_PIPS = 1_000_000;

function assertPips(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_FEE_PIPS) {
    throw new RangeError(`${name} must be an integer in [0, ${MAX_FEE_PIPS}], received ${value}`);
  }
}

function assertSchedule(schedule: GuardFeeSchedule): void {
  assertPips(schedule.initialFeePips, "initialFeePips");
  assertPips(schedule.finalFeePips, "finalFeePips");
  if (!Number.isInteger(schedule.decaySeconds) || schedule.decaySeconds < 0) {
    throw new RangeError(`decaySeconds must be a non-negative integer, received ${schedule.decaySeconds}`);
  }
  /* The guard refuses a schedule that rises; one that reached here was not written by a guard. */
  if (schedule.enabled && schedule.initialFeePips < schedule.finalFeePips) {
    throw new RangeError(`a schedule decays: the opening fee ${schedule.initialFeePips} is below the final fee ${schedule.finalFeePips}`);
  }
}

function seconds(value: bigint | number, name: string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) throw new RangeError(`${name} is non-negative, received ${value}`);
    return value;
  }
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer, received ${value}`);
  return BigInt(value);
}

/** The fee, in hundredths of a bip, a swap landing at `timestamp` (unix seconds) pays under `schedule`. */
export function guardFeeAt(schedule: GuardFeeSchedule, timestamp: bigint | number): number {
  assertSchedule(schedule);
  const at = seconds(timestamp, "timestamp");
  const start = seconds(schedule.startTime, "startTime");
  if (!schedule.enabled) return schedule.finalFeePips;
  if (at < start) return schedule.initialFeePips;
  const elapsed = at - start;
  if (elapsed >= BigInt(schedule.decaySeconds)) return schedule.finalFeePips;
  const spread = BigInt(schedule.initialFeePips - schedule.finalFeePips);
  const discount = (spread * elapsed) / BigInt(schedule.decaySeconds);
  return schedule.initialFeePips - Number(discount);
}

/** Where `schedule` stands at `timestamp`: before its window, inside it, past it, or without one. */
export function guardFeePhaseAt(schedule: GuardFeeSchedule, timestamp: bigint | number): GuardFeePhase {
  assertSchedule(schedule);
  if (!schedule.enabled) return "flat";
  const at = seconds(timestamp, "timestamp");
  const start = seconds(schedule.startTime, "startTime");
  if (at < start) return "scheduled";
  return at - start >= BigInt(schedule.decaySeconds) ? "settled" : "decaying";
}
