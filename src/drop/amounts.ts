// SPDX-License-Identifier: MIT
/**
 * Recipient lists: exact decimal amounts and CSV parsing shared by multisend
 * and Merkle drops.
 *
 * EXACT, NEVER FLOAT. "0.1" of an 18-decimal token is 100000000000000000 base
 * units, not 100000000000000005 (what `0.1 * 1e18` gives). Amounts are parsed
 * from the text digit by digit; a value with more fractional digits than the
 * token has is an error, never silently rounded.
 */

import { getAddress, isAddress, zeroAddress, type Address } from "viem";

export class AmountParseError extends Error {
  override readonly name = "AmountParseError";
}

/**
 * `"12.5"` with 6 decimals → `12500000n`. Accepts `123`, `123.`, `.5`,
 * `0.000001`; rejects signs, exponents, separators, and more fractional digits
 * than `decimals`.
 */
export function parseAmountExact(text: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new AmountParseError(`Unsupported decimals ${decimals}.`);
  const t = text.trim();
  const m = /^(\d*)(?:\.(\d*))?$/.exec(t);
  if (t === "" || m === null || (m[1] === "" && (m[2] ?? "") === "")) {
    throw new AmountParseError(`"${text}" is not a plain decimal number (digits and one "." only).`);
  }
  const whole = m[1] ?? "";
  const frac = m[2] ?? "";
  if (frac.length > decimals) {
    const extra = frac.slice(decimals);
    if (/[^0]/.test(extra)) {
      throw new AmountParseError(`"${text}" has ${frac.length} decimal places; this token has ${decimals}.`);
    }
  }
  const fracPadded = frac.slice(0, decimals).padEnd(decimals, "0");
  return BigInt((whole === "" ? "0" : whole) + fracPadded);
}

/** Base units → an exact decimal string, trailing zeros trimmed (`12500000n`, 6 → `"12.5"`). */
export function formatAmountExact(value: bigint, decimals: number): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  if (decimals === 0) return `${neg ? "-" : ""}${v}`;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac === "" ? "" : `.${frac}`}`;
}

export interface Recipient {
  readonly account: Address;
  /** Base units. */
  readonly amount: bigint;
}

export interface ParsedRecipient extends Recipient {
  /** 1-based line in the input. */
  readonly line: number;
}

export interface RecipientIssue {
  readonly line: number;
  readonly severity: "error" | "warning";
  readonly message: string;
}

export interface ParsedRecipients {
  readonly rows: readonly ParsedRecipient[];
  readonly issues: readonly RecipientIssue[];
  /** Sum of every accepted row, base units. */
  readonly total: bigint;
  /** True when no issue is an error. */
  readonly ok: boolean;
  /** A first line that was recognised as a header and skipped. */
  readonly header: string | null;
}

export interface ParseRecipientsOptions {
  /** The token's decimals. Amounts are decimal text in whole tokens unless `unit` is `"base"`. */
  readonly decimals: number;
  readonly unit?: "decimal" | "base";
  /** Refuse (as an error) an address that appears twice. Default: a warning, and both rows kept. */
  readonly duplicates?: "warn" | "error";
}

function unquote(s: string): string {
  const t = s.trim();
  return t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) ? t.slice(1, -1).trim() : t;
}

/**
 * One recipient per line: `address,amount` (also `;`, tab or spaces between
 * the two). Blank lines and `#` comments are skipped; a first line that is not
 * an address is taken as a header. Every problem is reported with its line;
 * nothing is dropped silently.
 */
export function parseRecipientsCsv(text: string, opts: ParseRecipientsOptions): ParsedRecipients {
  const rows: ParsedRecipient[] = [];
  const issues: RecipientIssue[] = [];
  const firstLine = new Map<string, number>();
  let header: string | null = null;
  let sawData = false;
  const lines = text.split(/\r\n|\n|\r/);
  lines.forEach((rawLine, i) => {
    const line = i + 1;
    const trimmed = rawLine.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    const fields = trimmed
      .split(/[,;\t]|\s+/)
      .map(unquote)
      .filter((f) => f !== "");
    const [addr, amt, ...rest] = fields;
    if (!sawData && header === null && addr !== undefined && !addr.toLowerCase().startsWith("0x")) {
      header = trimmed;
      return;
    }
    sawData = true;
    if (addr === undefined || amt === undefined) {
      issues.push({ line, severity: "error", message: "Expected two fields: address, amount." });
      return;
    }
    if (rest.length > 0) {
      issues.push({ line, severity: "error", message: `Expected two fields, found ${fields.length}. Amounts cannot contain "," as a thousands separator.` });
      return;
    }
    if (!isAddress(addr, { strict: false })) {
      issues.push({ line, severity: "error", message: `"${addr}" is not an address.` });
      return;
    }
    if (addr !== addr.toLowerCase() && addr.slice(2) !== addr.slice(2).toUpperCase() && !isAddress(addr, { strict: true })) {
      issues.push({ line, severity: "error", message: `"${addr}" fails its mixed-case checksum; it may contain a typo.` });
      return;
    }
    const account = getAddress(addr);
    if (account === zeroAddress) {
      issues.push({ line, severity: "error", message: "The zero address cannot receive." });
      return;
    }
    let amount: bigint;
    try {
      if (opts.unit === "base") {
        if (!/^\d+$/.test(amt)) throw new AmountParseError(`"${amt}" is not a whole number of base units.`);
        amount = BigInt(amt);
      } else {
        amount = parseAmountExact(amt, opts.decimals);
      }
    } catch (e) {
      issues.push({ line, severity: "error", message: e instanceof Error ? e.message : String(e) });
      return;
    }
    if (amount === 0n) issues.push({ line, severity: "warning", message: "Amount is zero." });
    const k = account.toLowerCase();
    const seen = firstLine.get(k);
    if (seen !== undefined) {
      issues.push({
        line,
        severity: opts.duplicates === "error" ? "error" : "warning",
        message: `Same address as line ${seen}.`,
      });
      if (opts.duplicates === "error") return;
    } else {
      firstLine.set(k, line);
    }
    rows.push({ line, account, amount });
  });
  if (rows.length === 0 && !issues.some((x) => x.severity === "error")) {
    issues.push({ line: 0, severity: "error", message: "No recipients found." });
  }
  const total = rows.reduce((s, r) => s + r.amount, 0n);
  return { rows, issues, total, ok: !issues.some((x) => x.severity === "error"), header };
}

/** Sum repeated addresses into one row each, in first-seen order. */
export function mergeDuplicateRecipients<T extends Recipient>(rows: readonly T[]): Recipient[] {
  const by = new Map<string, { account: Address; amount: bigint }>();
  for (const r of rows) {
    const k = r.account.toLowerCase();
    const cur = by.get(k);
    if (cur) cur.amount += r.amount;
    else by.set(k, { account: r.account, amount: r.amount });
  }
  return [...by.values()];
}
