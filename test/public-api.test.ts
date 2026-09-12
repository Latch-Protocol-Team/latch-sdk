// SPDX-License-Identifier: MIT
/* ============================================================================
   Guards on the PACKAGE ROOT's export surface.

   A published name can never be taken back: if `@latchprotocol/sdk` 0.1.0 binds
   `NATIVE_CURRENCY` to the wrong value, the fix is 0.2.0 and a migration note in
   every integrator's codebase. So the root barrel gets its own test, separate
   from the tests of the modules it re-exports.

   The specific hazard is a NAME COLLISION between an `export *` and an explicit
   `export { ... } from`. TypeScript and ESM both resolve that silently in favour
   of the explicit re-export — no error, no warning, at compile time or run time.
   The star-exported binding simply stops existing at the root, and the only
   symptom is a consumer getting an object where they expected a string.

   That is the same failure mode as an ABI that decodes without erroring: nothing
   throws at the point of the mistake, so only an assertion catches it.
   ============================================================================ */

import { describe, expect, it } from "vitest";

import * as sdk from "../src/index.js";

import * as currencyModule from "../src/types/currency.js";
import * as balanceDeltaModule from "../src/types/balanceDelta.js";
import * as feeModule from "../src/types/fee.js";
import * as parametersModule from "../src/types/parameters.js";
import * as poolKeyModule from "../src/types/poolKey.js";
import * as bitmapModule from "../src/hooks/bitmap.js";
import * as endpointsModule from "../src/chains/endpoints.js";
import * as transportModule from "../src/chains/transport.js";
import * as deploymentsModule from "../src/deployments/index.js";

/** Exactly the modules `src/index.ts` re-exports with `export *`. */
const STAR_EXPORTED: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["types/currency", currencyModule],
  ["types/balanceDelta", balanceDeltaModule],
  ["types/fee", feeModule],
  ["types/parameters", parametersModule],
  ["types/poolKey", poolKeyModule],
  ["hooks/bitmap", bitmapModule],
  ["chains/endpoints", endpointsModule],
  ["chains/transport", transportModule],
];

describe("root export surface", () => {
  /* `types/currency.ts` and `deployments/index.ts` both define a binding called
     NATIVE_CURRENCY, and they mean entirely different things: a zero-address
     sentinel for "this pool leg is the chain's native asset", versus a per-chain
     table of native-currency metadata. Both reach the root barrel, so exactly one
     wins and the other silently disappears. */
  it("binds NATIVE_CURRENCY to the native-asset sentinel, not the chain table", () => {
    expect(sdk.NATIVE_CURRENCY).toBe(currencyModule.NATIVE_CURRENCY);
    expect(typeof sdk.NATIVE_CURRENCY).toBe("string");
  });

  /* The concrete consequence, asserted separately so a regression names the
     symptom rather than just the binding. Every currency helper takes a string;
     the deployments table is an object, and `.toLowerCase` is not a function. */
  it("keeps the currency helpers usable with the root NATIVE_CURRENCY", () => {
    expect(sdk.isNativeCurrency(sdk.NATIVE_CURRENCY)).toBe(true);
    expect(sdk.currenciesEqual(sdk.NATIVE_CURRENCY, currencyModule.NATIVE_CURRENCY)).toBe(true);
  });

  /* The per-chain table is still needed; it just may not squat on the sentinel's
     name. Assert both remaining routes to it stay open. */
  it("still exposes the per-chain native-currency table, under a distinct name", () => {
    expect(sdk.CHAIN_NATIVE_CURRENCIES).toBe(deploymentsModule.NATIVE_CURRENCY);
    expect(sdk.deployments.NATIVE_CURRENCY).toBe(deploymentsModule.NATIVE_CURRENCY);
    expect(typeof sdk.CHAIN_NATIVE_CURRENCIES).toBe("object");
  });

  /* The general rule, so the NEXT collision fails here instead of in a
     consumer's editor: anything a star-exported module exports must be reachable
     at the root AS THE SAME VALUE. An explicit re-export that shadows a star
     export breaks this and nothing else reports it. */
  it("lets no explicit re-export shadow a star-exported binding", () => {
    const shadowed: string[] = [];
    for (const [moduleName, mod] of STAR_EXPORTED) {
      for (const [name, value] of Object.entries(mod)) {
        if (!(name in sdk)) {
          shadowed.push(`${moduleName}.${name} is missing from the root`);
          continue;
        }
        if ((sdk as Record<string, unknown>)[name] !== value) {
          shadowed.push(`${moduleName}.${name} is shadowed at the root by a different value`);
        }
      }
    }
    expect(shadowed).toEqual([]);
  });
});
