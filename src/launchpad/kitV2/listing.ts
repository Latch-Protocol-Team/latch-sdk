/**
 * The launch listing: what `LatchLaunchRegistry` stores about a launch, and the rules a caller has
 * to satisfy before `createLaunch` will accept one.
 *
 * ################ THE KIT TAKES THE TYPED STRUCT, NOT BYTES ################
 *
 * An earlier draft of this file encoded `LaunchMetadata` by hand, because `LaunchParamsV2.listing`
 * was going to be an opaque `bytes` blob. That design was ABANDONED after it was measured: an
 * opaque member cost `LaunchpadKitV2` 798 bytes MORE than the struct, because a dynamic byte
 * string has to be copied into memory with runtime length handling. The kit takes the struct, viem
 * encodes it from the contract ABI, and this file does NOT duplicate the layout — which also
 * removes the failure mode that draft carried, where a silently out-of-date local ABI produced a
 * blob that only failed at launch time.
 *
 * ################ WHAT THIS FILE IS FOR ################
 *
 * Validation and rendering, mirroring `LatchLaunchRegistry._boundHandle` so a caller fails locally
 * with a message naming the field, instead of paying gas to revert with `InvalidHandle`. The
 * contract is still the authority: everything here is a courtesy, and none of it is a guarantee.
 *
 * ⚠ HANDLES ARE `string` ON CHAIN, and that is load-bearing rather than incidental. They were
 * `bytes32` until 2026-09-24, and that encoding cost the kit 913 bytes and pushed it past EIP-170 —
 * undeployable, while every in-EVM test passed, because forge does not enforce that limit. See the
 * block above `LaunchMetadata` in `ILatchLaunchRegistry.sol` for the measurements. Do not
 * reintroduce a fixed-width encoding here on the assumption it is cheaper.
 */

/** The X handle limit the registry enforces. X's own maximum, not a Latch choice. */
export const MAX_X_HANDLE_BYTES = 15;

/** The Telegram handle limit the registry enforces. Telegram's own maximum. */
export const MAX_TELEGRAM_HANDLE_BYTES = 32;

/**
 * What the registry accepts in a handle: the intersection of X's and Telegram's alphabets.
 *
 * This single character class is what rejects a leading at-sign, a `/`, a scheme, whitespace, a NUL
 * and every bidi override — which is the whole reason these fields are handles and not URLs. A
 * handle renders to exactly one URL, so there is no homoglyph domain to hide behind.
 */
const HANDLE_RE = /^[A-Za-z0-9_]*$/;

/**
 * Check a social handle against the registry's rules, returning the trimmed value.
 *
 * Takes a HANDLE, not a URL: `latchprotocol`, never `https://x.com/latchprotocol` and never
 * `@latchprotocol`. Empty is legal and means "none" — every link on a record is optional.
 *
 * Length is measured in BYTES, not characters, because that is what the contract measures. The
 * separate errors for "@" and for a URL exist because those are the two mistakes a human actually
 * makes, and "only letters, digits and underscore" is a poor explanation of either.
 *
 * ⚠ REFUSES an over-long handle rather than truncating it. Truncation is unsafe here in a way that
 * is easy to miss: nothing downstream can tell a handle that was cut short from one that was always
 * that short, so a truncated value renders as a working link to somebody else's account.
 */
export function assertHandle(handle: string, maxBytes: number, label: string): string {
  const h = handle.trim();
  if (h === "") return "";
  if (h.startsWith("@")) throw new RangeError(`${label}: drop the leading "@" — store the handle itself (${h})`);
  if (/^https?:\/\//i.test(h) || h.includes("/")) throw new RangeError(`${label}: store the handle, not a URL (${h})`);
  if (!HANDLE_RE.test(h)) throw new RangeError(`${label}: only letters, digits and underscore are allowed (${h})`);
  const bytes = new TextEncoder().encode(h).length;
  if (bytes > maxBytes) throw new RangeError(`${label}: ${bytes} bytes, the maximum is ${maxBytes} (${h})`);
  return h;
}

/**
 * The listing a caller supplies — exactly `LaunchMetadata`'s four members, in its order.
 *
 * There is no `iconURI`: it was removed on 2026-09-24 because a fifth member costs the kit ~980
 * bytes and puts it over EIP-170. An icon belongs in the token list or the launch's own
 * `metadataURI`, where being wrong costs a broken image rather than a broken record.
 */
export interface LaunchListingInput {
  readonly description: string;
  readonly websiteURI: string;
  /** X handle without the "@", e.g. `latchprotocol`. Empty for none. */
  readonly xHandle: string;
  /** Telegram handle, group or channel without the "@". Empty for none. */
  readonly telegramHandle: string;
}

/**
 * Validate a listing and return it ready to pass as `LaunchParamsV2.listing`.
 *
 * The two URI-ish members are deliberately NOT validated, and that is the registry's own position
 * rather than an oversight: a contract cannot make a URL safe to render, and a partial filter would
 * be read by front ends as a guarantee it cannot give. A consumer must allowlist the scheme at
 * render time, escape, truncate, and never infer identity from any of it. The handles ARE checked,
 * because for them a total check exists.
 */
export function prepareLaunchListing(listing: LaunchListingInput): LaunchListingInput {
  return {
    description: listing.description,
    websiteURI: listing.websiteURI,
    xHandle: assertHandle(listing.xHandle, MAX_X_HANDLE_BYTES, "xHandle"),
    telegramHandle: assertHandle(listing.telegramHandle, MAX_TELEGRAM_HANDLE_BYTES, "telegramHandle"),
  };
}

/**
 * `https://x.com/<handle>`, or `null` where there is no handle.
 *
 * Render this rather than any stored URL. Returns `null` for a value that does not satisfy the
 * handle rules, so a record written by an older or non-conforming path cannot produce a link — a
 * dead link is recoverable, a link to the wrong account is not.
 */
export function xUrlOf(handle: string): string | null {
  const h = handle.trim();
  if (h === "" || !HANDLE_RE.test(h)) return null;
  return `https://x.com/${h}`;
}

/** `https://t.me/<handle>`, or `null` where there is no handle. Same contract as `xUrlOf`. */
export function telegramUrlOf(handle: string): string | null {
  const h = handle.trim();
  if (h === "" || !HANDLE_RE.test(h)) return null;
  return `https://t.me/${h}`;
}
