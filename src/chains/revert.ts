/* ============================================================================
   Telling a contract that refused from an endpoint that did not answer.

   Every read in this SDK that maps "the contract reverted" to `null` and lets a
   transport failure throw depends on this one question, and answering it with
   `instanceof` alone is wrong in a way nothing reports: a client built by the
   HOST application raises errors of the host's copy of viem, and where that is
   not the copy this module imports (a linked workspace, a bundler that did not
   dedupe) `instanceof` is false for an error that is exactly a revert. The read
   then throws as if the chain were unreachable.

   So an error is matched by class AND by the name viem gives it, down the chain
   of causes. A name is a string the library sets on its own errors; matching it
   cannot turn a transport failure into a revert, because transport errors carry
   other names.
   ============================================================================ */

import { ContractFunctionRevertedError, ContractFunctionZeroDataError, ExecutionRevertedError } from "viem";

/** A revert is at most a few causes deep (the call, the contract function, the execution). */
const MAX_CAUSE_DEPTH = 8;

const REVERTED: ReadonlySet<string> = new Set(["ExecutionRevertedError", "ContractFunctionRevertedError"]);
const ZERO_DATA = "ContractFunctionZeroDataError";

/**
 * Whether `error` is a contract-level revert rather than a transport failure.
 *
 * @param opts.zeroData Also count "the call returned no data": an address with
 * no code, or a contract with no such function and no fallback. Off by default,
 * because for most reads an address with no code is a wrong address, not an
 * answer.
 */
export function isRevertError(error: unknown, opts: { readonly zeroData?: boolean } = {}): boolean {
  const zeroData = opts.zeroData === true;
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && typeof current === "object" && current !== null; depth++) {
    if (current instanceof ExecutionRevertedError || current instanceof ContractFunctionRevertedError) return true;
    if (zeroData && current instanceof ContractFunctionZeroDataError) return true;
    const name = (current as { readonly name?: unknown }).name;
    if (typeof name === "string" && (REVERTED.has(name) || (zeroData && name === ZERO_DATA))) return true;
    current = (current as { readonly cause?: unknown }).cause;
  }
  return false;
}
