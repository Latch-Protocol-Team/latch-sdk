/**
 * Client for the Latch Router API tier: `/v1/chains/:chainId/{quote,swap,simulate,sources,fee-config}`.
 *
 * MIT, viem-only, no dependency on the router engine. The engine runs server-side; this is the
 * typed HTTP surface a widget, a tenant's DEX or a script uses.
 *
 * WHAT THIS CLIENT CHECKS, because a swap transaction is the one thing an integration must not take
 * on trust from an HTTP response:
 *  - `tx.to` must be Latch's UniversalRouter or LatchFillRouter for that chain, read from this SDK's
 *    OWN address book (never from the API response). For a chain the address book does not list yet,
 *    the caller passes `allowedTargets`; with neither, `swap` refuses rather than returning calldata
 *    addressed to a contract nobody verified. A compromised or spoofed API endpoint therefore cannot
 *    hand a wallet a transaction to an arbitrary contract through this client.
 *  - `tx.chainId`, `tx.from` and the token pair must be what was asked for.
 *  - amounts arrive as decimal strings and are parsed to `bigint`; a non-integer is a hard error.
 *
 * API keys belong on servers. In a browser, call the router anonymously (it has its own small
 * anonymous limit) or through your own backend.
 */
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { getDeployment } from "../deployments/index.js";

export interface LatchRouterClientOptions {
  /** API origin, e.g. `https://api.latches.fun`. No trailing path. */
  readonly baseUrl: string;
  /** Server-side only. Sent as `X-API-Key`; needs the `router:quote` scope. */
  readonly apiKey?: string;
  /** Injected for tests or non-standard runtimes. Defaults to global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Per-request timeout. Default 15 s. */
  readonly timeoutMs?: number;
  /**
   * Extra transaction targets accepted per chain, for chains the address book does not list yet
   * (a fork, a devnet, a chain launching). Compared case-insensitively.
   */
  readonly allowedTargets?: Readonly<Record<number, readonly Address[]>>;
}

export type RouterErrorCode =
  | "NO_ROUTE"
  | "STATE_UNREADABLE"
  | "APPROVAL_REQUIRED"
  | "INSUFFICIENT_BALANCE"
  | "SIMULATION_FAILED"
  | "RATE_LIMITED"
  | "BAD_REQUEST"
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNAUTHORIZED"
  | "INTERNAL"
  | "UNTRUSTED_RESPONSE"
  | "TRANSPORT";

export class LatchRouterError extends Error {
  constructor(
    readonly code: RouterErrorCode | string,
    message: string,
    readonly status: number | null,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "LatchRouterError";
  }
}

export interface RouterRoutedFee {
  /** Basis points of what reaches the venue, READ from LatchFillRouter. 0 on a Latch pool. */
  readonly bps: number;
  /** In `currency`, the input the user parts with. */
  readonly amount: bigint;
  readonly currency: Address;
  readonly budget: bigint;
  readonly refund: bigint;
  readonly exempt: boolean;
  /** The contract the fee was read from; `null` for a Latch route (no fill router involved). */
  readonly readFrom: Address | null;
}

export interface RouterQuote {
  readonly requestId: string;
  readonly chainId: number;
  readonly tokenIn: Address;
  readonly tokenOut: Address;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly minAmountOut: bigint;
  readonly slippageBps: number;
  /** `null` when the router could not take a reference quote. Never a guess. */
  readonly priceImpactBps: number | null;
  readonly gasEstimate: bigint;
  readonly gasCostNative: bigint;
  readonly gasAdjusted: boolean;
  /** The routed fee on its own line. Price impact and the fee are different numbers. */
  readonly protocolFee: RouterRoutedFee;
  /** The chosen route as the API describes it (venue id, execution path, legs and hops). */
  readonly route: {
    readonly source: string;
    readonly execution: "latch-universal-router" | "latch-fill-router";
    readonly to: Address;
    readonly legs: readonly { readonly shareBps: number; readonly source: string; readonly hops: readonly Record<string, unknown>[] }[];
  };
  readonly quotedAt: number;
  readonly expiresAt: number;
  readonly blockNumber: bigint;
  readonly diagnostics: readonly { readonly sourceId: string; readonly outcome: string; readonly detail?: string }[];
}

export interface RouterSwap {
  readonly tx: { readonly chainId: number; readonly from: Address; readonly to: Address; readonly data: Hex; readonly value: bigint; readonly gas: bigint };
  readonly minAmountOut: bigint;
  readonly deadline: number;
  readonly recipient: Address;
  readonly quote: RouterQuote;
  /** How `tx.to` was verified: against the SDK address book, or against `allowedTargets`. */
  readonly targetVerifiedBy: "address-book" | "allowed-targets";
}

export interface RouterApproval {
  readonly kind: "erc20-approve" | "permit2-approve";
  readonly token: Address;
  readonly spender: Address;
  readonly to: Address;
  readonly data: Hex;
  readonly amount: bigint;
}

const DEC = /^[0-9]{1,78}$/;

function big(v: unknown, what: string): bigint {
  if (typeof v !== "string" || !DEC.test(v)) throw new LatchRouterError("UNTRUSTED_RESPONSE", `${what} is not a decimal integer string`, null);
  return BigInt(v);
}

function addr(v: unknown, what: string): Address {
  if (typeof v !== "string" || !isAddress(v, { strict: false })) throw new LatchRouterError("UNTRUSTED_RESPONSE", `${what} is not an address`, null);
  return getAddress(v);
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function parseQuote(d: Record<string, any>): RouterQuote {
  const f = d["protocolFee"] ?? {};
  return {
    requestId: String(d["requestId"]),
    chainId: Number(d["chainId"]),
    tokenIn: addr(d["tokenIn"], "tokenIn"),
    tokenOut: addr(d["tokenOut"], "tokenOut"),
    amountIn: big(d["amountIn"], "amountIn"),
    amountOut: big(d["amountOut"], "amountOut"),
    minAmountOut: big(d["minAmountOut"], "minAmountOut"),
    slippageBps: Number(d["slippageBps"]),
    priceImpactBps: d["priceImpactBps"] === null ? null : Number(d["priceImpactBps"]),
    gasEstimate: big(d["gasEstimate"], "gasEstimate"),
    gasCostNative: big(d["gasCostNative"], "gasCostNative"),
    gasAdjusted: Boolean(d["gasAdjusted"]),
    protocolFee: {
      bps: Number(f["bps"]),
      amount: big(f["amount"], "protocolFee.amount"),
      currency: addr(f["currency"], "protocolFee.currency"),
      budget: big(f["budget"], "protocolFee.budget"),
      refund: big(f["refund"], "protocolFee.refund"),
      exempt: Boolean(f["exempt"]),
      readFrom: f["readFrom"] === null ? null : addr(f["readFrom"], "protocolFee.readFrom"),
    },
    route: {
      source: String(d["route"]?.["source"]),
      execution: d["route"]?.["execution"],
      to: addr(d["route"]?.["to"], "route.to"),
      legs: (d["route"]?.["legs"] ?? []) as RouterQuote["route"]["legs"],
    },
    quotedAt: Number(d["quotedAt"]),
    expiresAt: Number(d["expiresAt"]),
    blockNumber: big(d["blockNumber"], "blockNumber"),
    diagnostics: (d["diagnostics"] ?? []) as RouterQuote["diagnostics"],
  };
}

/** Parses the approval steps an APPROVAL_REQUIRED error carries. */
export function approvalsOf(err: unknown): RouterApproval[] {
  if (!(err instanceof LatchRouterError) || err.code !== "APPROVAL_REQUIRED") return [];
  const steps = (err.details as { approvals?: unknown[] } | undefined)?.approvals ?? [];
  return steps.map((s, i) => {
    const o = s as Record<string, unknown>;
    return {
      kind: o["kind"] as RouterApproval["kind"],
      token: addr(o["token"], `approvals[${i}].token`),
      spender: addr(o["spender"], `approvals[${i}].spender`),
      to: addr(o["to"], `approvals[${i}].to`),
      data: o["data"] as Hex,
      amount: big(o["amount"], `approvals[${i}].amount`),
    };
  });
}

export class LatchRouterClient {
  private readonly base: string;
  private readonly f: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opts: LatchRouterClientOptions) {
    const u = new URL(opts.baseUrl);
    if (u.protocol !== "https:" && u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
      throw new Error("LatchRouterClient: baseUrl must be https (http only for localhost)");
    }
    this.base = opts.baseUrl.replace(/\/+$/, "");
    this.f = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  /**
   * The targets a swap from this client may be addressed to on `chainId`: the address book's
   * UniversalRouter and LatchFillRouter, plus `allowedTargets`. Empty = nothing verifiable.
   */
  trustedTargets(chainId: number): { targets: Address[]; source: RouterSwap["targetVerifiedBy"] | null } {
    const d = getDeployment(chainId);
    const fromBook = d ? [d.universalRouter, ...(d.fillRouter ? [d.fillRouter] : [])] : [];
    const extra = [...(this.opts.allowedTargets?.[chainId] ?? [])];
    if (fromBook.length > 0) return { targets: [...fromBook, ...extra], source: "address-book" };
    if (extra.length > 0) return { targets: extra, source: "allowed-targets" };
    return { targets: [], source: null };
  }

  private async req(method: "GET" | "POST", path: string, body?: unknown): Promise<Record<string, any>> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.f(`${this.base}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(this.opts.apiKey ? { "X-API-Key": this.opts.apiKey } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) } : {}),
        signal: ctl.signal,
      });
    } catch (err) {
      throw new LatchRouterError("TRANSPORT", `router API unreachable: ${(err as Error).message}`, null);
    } finally {
      clearTimeout(t);
    }
    let json: Record<string, any>;
    try {
      json = (await res.json()) as Record<string, any>;
    } catch {
      throw new LatchRouterError("TRANSPORT", `router API answered ${res.status} with a non-JSON body`, res.status);
    }
    if (!res.ok) {
      const e = json["error"] ?? {};
      throw new LatchRouterError(String(e["code"] ?? "INTERNAL"), String(e["message"] ?? `HTTP ${res.status}`), res.status, e["details"]);
    }
    if (!json["data"]) throw new LatchRouterError("UNTRUSTED_RESPONSE", "router API response has no data", res.status);
    return json;
  }

  async quote(p: { chainId: number; tokenIn: Address; tokenOut: Address; amountIn: bigint; slippageBps?: number }): Promise<RouterQuote> {
    if (p.amountIn <= 0n) throw new RangeError("amountIn must be positive");
    const qs = new URLSearchParams({ tokenIn: p.tokenIn, tokenOut: p.tokenOut, amount: p.amountIn.toString() });
    if (p.slippageBps !== undefined) qs.set("slippageBps", String(p.slippageBps));
    const r = await this.req("GET", `/v1/chains/${p.chainId}/quote?${qs.toString()}`);
    const q = parseQuote(r["data"]);
    if (q.chainId !== p.chainId || !same(q.tokenIn, p.tokenIn) || !same(q.tokenOut, p.tokenOut) || q.amountIn !== p.amountIn) {
      throw new LatchRouterError("UNTRUSTED_RESPONSE", "the quote does not match the request", null);
    }
    return q;
  }

  /**
   * Calldata for the user's wallet to sign. Throws `APPROVAL_REQUIRED` (use {@link approvalsOf}),
   * `INSUFFICIENT_BALANCE`, `SIMULATION_FAILED`, `NO_ROUTE` or `STATE_UNREADABLE` rather than returning
   * a transaction that did not simulate. Refuses a `tx.to` it cannot verify (see the module header).
   */
  async swap(p: {
    chainId: number;
    tokenIn: Address;
    tokenOut: Address;
    amountIn: bigint;
    sender: Address;
    recipient?: Address;
    slippageBps?: number;
    deadline?: number;
    amountOutMinimum?: bigint;
  }): Promise<RouterSwap> {
    const { targets, source } = this.trustedTargets(p.chainId);
    if (!source) {
      throw new LatchRouterError("UNTRUSTED_RESPONSE", `no verifiable router address for chain ${p.chainId}: it is not in the address book; pass allowedTargets`, null);
    }
    const r = await this.req("POST", `/v1/chains/${p.chainId}/swap`, {
      tokenIn: p.tokenIn,
      tokenOut: p.tokenOut,
      amountIn: p.amountIn.toString(),
      sender: p.sender,
      ...(p.recipient ? { recipient: p.recipient } : {}),
      ...(p.slippageBps !== undefined ? { slippageBps: p.slippageBps } : {}),
      ...(p.deadline !== undefined ? { deadline: p.deadline } : {}),
      ...(p.amountOutMinimum !== undefined ? { amountOutMinimum: p.amountOutMinimum.toString() } : {}),
    });
    const d = r["data"];
    const tx = d["tx"] ?? {};
    const out: RouterSwap = {
      tx: {
        chainId: Number(tx["chainId"]),
        from: addr(tx["from"], "tx.from"),
        to: addr(tx["to"], "tx.to"),
        data: tx["data"] as Hex,
        value: big(tx["value"], "tx.value"),
        gas: big(tx["gas"], "tx.gas"),
      },
      minAmountOut: big(d["minAmountOut"], "minAmountOut"),
      deadline: Number(d["deadline"]),
      recipient: addr(d["recipient"], "recipient"),
      quote: parseQuote(d["quote"]),
      targetVerifiedBy: source,
    };
    if (!targets.some((t) => same(t, out.tx.to))) {
      throw new LatchRouterError("UNTRUSTED_RESPONSE", `tx.to ${out.tx.to} is not a Latch router for chain ${p.chainId}`, null);
    }
    if (out.tx.chainId !== p.chainId || !same(out.tx.from, p.sender) || !same(out.recipient, p.recipient ?? p.sender)) {
      throw new LatchRouterError("UNTRUSTED_RESPONSE", "the swap does not match the request (chain, sender or recipient)", null);
    }
    if (!same(out.quote.tokenIn, p.tokenIn) || !same(out.quote.tokenOut, p.tokenOut) || out.quote.amountIn !== p.amountIn) {
      throw new LatchRouterError("UNTRUSTED_RESPONSE", "the swap's quote does not match the request", null);
    }
    if (typeof out.tx.data !== "string" || !/^0x[0-9a-fA-F]*$/.test(out.tx.data)) {
      throw new LatchRouterError("UNTRUSTED_RESPONSE", "tx.data is not hex", null);
    }
    return out;
  }

  async simulate(p: { chainId: number; from: Address; to: Address; data: Hex; value?: bigint }) {
    const r = await this.req("POST", `/v1/chains/${p.chainId}/simulate`, { from: p.from, to: p.to, data: p.data, value: (p.value ?? 0n).toString() });
    const d = r["data"];
    return {
      ok: d["ok"] === true,
      blockNumber: big(d["blockNumber"], "blockNumber"),
      gas: big(d["gas"], "gas"),
      fill: d["fill"]
        ? { amountOut: big(d["fill"]["amountOut"], "fill.amountOut"), spent: big(d["fill"]["spent"], "fill.spent"), feeAmount: big(d["fill"]["feeAmount"], "fill.feeAmount"), refund: big(d["fill"]["refund"], "fill.refund") }
        : null,
    };
  }

  async sources(chainId: number): Promise<{ routers: { universalRouter: Address | null; fillRouter: Address | null }; sources: { id: string; name: string; kind: string; execution: string; target: Address; enabled: boolean; reason?: string }[] }> {
    const r = await this.req("GET", `/v1/chains/${chainId}/sources`);
    return { routers: r["data"]["routers"], sources: r["data"]["sources"] };
  }

  /** The routed fee as read on chain by the API. Compare with `readContract(fillRouter, "feeBps")` to verify. */
  async feeConfig(chainId: number): Promise<Record<string, unknown>> {
    const r = await this.req("GET", `/v1/chains/${chainId}/fee-config`);
    return r["data"];
  }
}
