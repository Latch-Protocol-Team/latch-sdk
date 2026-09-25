/* ============================================================================
   Market reads for one pool, from the chain alone.

   What a token page needs - trades, a price series, volume, holders - and where
   each number comes from, so a page can label it:

     trades      the pool manager's `Swap` logs for the pool id (CL or Bin)
     price       the pool's own price after each swap (`sqrtPriceX96` in a CL
                 swap, `activeId` in a Bin swap), and `getSlot0` for "now"
     volume      the quote-side amount of every swap, summed
     holders     the token's `Transfer` logs, reduced to balances

   NOTHING HERE IS PRICED IN DOLLARS. Every price is "quote per launch token"
   and every volume is in the quote currency; a pad that wants a dollar figure
   needs a price for the quote it can defend (CLAUDE.md, "No invented data").

   Swap deltas follow the vault's convention: a NEGATIVE amount was paid by the
   trader, a POSITIVE one received. `side` is judged from the launch token's
   delta - a trade that received it is a buy.
   ============================================================================ */

import { getAbiItem, parseAbiItem, type Address, type Hex, type PublicClient } from "viem";

import { BIN_POOL_MANAGER_EVENTS_ABI, CL_POOL_MANAGER_EVENTS_ABI } from "../generated/abi.js";
import { binRawPriceFromId } from "../launchpad/kitV2/binPrice.js";
import { readBinPoolKeyParameters } from "../types/poolKey.js";
import type { PoolKey } from "../types/poolKey.js";

const CL_SWAP = getAbiItem({ abi: CL_POOL_MANAGER_EVENTS_ABI, name: "Swap" });
const BIN_SWAP = getAbiItem({ abi: BIN_POOL_MANAGER_EVENTS_ABI, name: "Swap" });
const CL_INITIALIZE = getAbiItem({ abi: CL_POOL_MANAGER_EVENTS_ABI, name: "Initialize" });
const BIN_INITIALIZE = getAbiItem({ abi: BIN_POOL_MANAGER_EVENTS_ABI, name: "Initialize" });
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

const CL_SLOT0_ABI = [
  {
    type: "function",
    name: "getSlot0",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
] as const;
const BIN_SLOT0_ABI = [
  {
    type: "function",
    name: "getSlot0",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      { name: "activeId", type: "uint24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
] as const;

const Q96 = 2n ** 96n;

/** The pool a market read is about, and how to orient its prices. */
export interface MarketPool {
  readonly poolId: Hex;
  readonly kind: "CL" | "Bin";
  readonly key: PoolKey;
  /** Whether the launch (base) token is `currency0`. Prices are quoted per base token. */
  readonly baseIsCurrency0: boolean;
  readonly baseDecimals: number;
  readonly quoteDecimals: number;
}

export interface Trade {
  readonly blockNumber: bigint;
  readonly txHash: Hex;
  readonly logIndex: number;
  /** The pool manager's caller: a router or a custom integration, not the end user. */
  readonly sender: Address;
  readonly side: "buy" | "sell";
  /** Raw units of the base token moved, absolute. */
  readonly baseAmount: bigint;
  /** Raw units of the quote moved, absolute. */
  readonly quoteAmount: bigint;
  /** The pool's price AFTER this swap, quote per whole base token. */
  readonly price: number;
  /** `block.timestamp` of the block, once `withTimestamps` has run; `null` before. */
  readonly timestamp: number | null;
}

/** `sqrtPriceX96` (currency1 per currency0, raw) as quote per whole base token. */
export function priceFromSqrt(sqrtPriceX96: bigint, pool: Pick<MarketPool, "baseIsCurrency0" | "baseDecimals" | "quoteDecimals">): number {
  const s = Number(sqrtPriceX96) / Number(Q96);
  const raw1per0 = s * s;
  return orient(raw1per0, pool);
}

/** A Bin `activeId` as quote per whole base token. */
export function priceFromBinId(activeId: number, binStep: number, pool: Pick<MarketPool, "baseIsCurrency0" | "baseDecimals" | "quoteDecimals">): number {
  return orient(binRawPriceFromId(activeId, binStep), pool);
}

function orient(raw1per0: number, pool: Pick<MarketPool, "baseIsCurrency0" | "baseDecimals" | "quoteDecimals">): number {
  const [d0, d1] = pool.baseIsCurrency0 ? [pool.baseDecimals, pool.quoteDecimals] : [pool.quoteDecimals, pool.baseDecimals];
  const human1per0 = raw1per0 * 10 ** (d0 - d1);
  return pool.baseIsCurrency0 ? human1per0 : 1 / human1per0;
}

function abs(n: bigint): bigint {
  return n < 0n ? -n : n;
}

/** Every swap in the pool since `fromBlock`, oldest first. One `eth_getLogs`. */
export async function readPoolTrades(
  client: PublicClient,
  pool: MarketPool,
  opts: { readonly fromBlock: bigint; readonly toBlock?: bigint | "latest" },
): Promise<readonly Trade[]> {
  const toBlock = opts.toBlock ?? "latest";
  const manager = pool.key.poolManager;
  const base = { address: manager, args: { id: pool.poolId }, fromBlock: opts.fromBlock, toBlock } as const;
  if (pool.kind === "CL") {
    const logs = await client.getLogs({ ...base, event: CL_SWAP });
    return logs.map((l) => {
      const a0 = l.args.amount0 as bigint;
      const a1 = l.args.amount1 as bigint;
      const baseDelta = pool.baseIsCurrency0 ? a0 : a1;
      const quoteDelta = pool.baseIsCurrency0 ? a1 : a0;
      return {
        blockNumber: l.blockNumber,
        txHash: l.transactionHash,
        logIndex: l.logIndex,
        sender: l.args.sender as Address,
        side: baseDelta > 0n ? "buy" : "sell",
        baseAmount: abs(baseDelta),
        quoteAmount: abs(quoteDelta),
        price: priceFromSqrt(l.args.sqrtPriceX96 as bigint, pool),
        timestamp: null,
      };
    });
  }
  const { binStep } = readBinPoolKeyParameters(pool.key);
  const logs = await client.getLogs({ ...base, event: BIN_SWAP });
  return logs.map((l) => {
    const a0 = l.args.amount0 as bigint;
    const a1 = l.args.amount1 as bigint;
    const baseDelta = pool.baseIsCurrency0 ? a0 : a1;
    const quoteDelta = pool.baseIsCurrency0 ? a1 : a0;
    return {
      blockNumber: l.blockNumber,
      txHash: l.transactionHash,
      logIndex: l.logIndex,
      sender: l.args.sender as Address,
      side: baseDelta > 0n ? "buy" : "sell",
      baseAmount: abs(baseDelta),
      quoteAmount: abs(quoteDelta),
      price: priceFromBinId(Number(l.args.activeId), binStep, pool),
      timestamp: null,
    };
  });
}

/**
 * Fill `timestamp` from block headers, one `eth_getBlockByNumber` per DISTINCT
 * block, `concurrency` at a time. The candle builder needs real time, and a
 * log carries only a block number.
 */
export async function withTimestamps(client: PublicClient, trades: readonly Trade[], concurrency = 8): Promise<readonly Trade[]> {
  const blocks = [...new Set(trades.map((t) => t.blockNumber))];
  const ts = new Map<bigint, number>();
  for (let i = 0; i < blocks.length; i += concurrency) {
    const chunk = blocks.slice(i, i + concurrency);
    const headers = await Promise.all(chunk.map((b) => client.getBlock({ blockNumber: b })));
    for (const h of headers) ts.set(h.number, Number(h.timestamp));
  }
  return trades.map((t) => ({ ...t, timestamp: ts.get(t.blockNumber) ?? null }));
}

/** The pool's price right now, from `getSlot0`. */
export async function readSpotPrice(client: PublicClient, pool: MarketPool): Promise<number> {
  if (pool.kind === "CL") {
    const [sqrtPriceX96] = await client.readContract({ address: pool.key.poolManager, abi: CL_SLOT0_ABI, functionName: "getSlot0", args: [pool.poolId] });
    return priceFromSqrt(sqrtPriceX96, pool);
  }
  const { binStep } = readBinPoolKeyParameters(pool.key);
  const [activeId] = await client.readContract({ address: pool.key.poolManager, abi: BIN_SLOT0_ABI, functionName: "getSlot0", args: [pool.poolId] });
  return priceFromBinId(Number(activeId), binStep, pool);
}

/* ------------------------------------------------------------------ series --- */

export interface Candle {
  /** Bucket start, unix seconds. */
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  /** Quote moved inside the bucket, raw units. */
  readonly volumeQuote: bigint;
  readonly trades: number;
}

/**
 * OHLC candles of `bucketSeconds` from timestamped trades. A bucket with no
 * trade is NOT emitted (the chart draws the gap); a trade without a timestamp
 * is skipped. Open is the first post-swap price in the bucket, close the last.
 */
export function buildCandles(trades: readonly Trade[], bucketSeconds: number): readonly Candle[] {
  if (!Number.isInteger(bucketSeconds) || bucketSeconds <= 0) throw new RangeError("bucketSeconds must be a positive integer");
  const out: Candle[] = [];
  let cur: { time: number; open: number; high: number; low: number; close: number; volumeQuote: bigint; trades: number } | null = null;
  const sorted = [...trades].filter((t) => t.timestamp !== null).sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
  for (const t of sorted) {
    const ts = t.timestamp as number;
    const bucket = ts - (ts % bucketSeconds);
    if (cur === null || cur.time !== bucket) {
      if (cur !== null) out.push(cur);
      cur = { time: bucket, open: t.price, high: t.price, low: t.price, close: t.price, volumeQuote: t.quoteAmount, trades: 1 };
    } else {
      cur.high = Math.max(cur.high, t.price);
      cur.low = Math.min(cur.low, t.price);
      cur.close = t.price;
      cur.volumeQuote += t.quoteAmount;
      cur.trades += 1;
    }
  }
  if (cur !== null) out.push(cur);
  return out;
}

export interface MarketStats {
  readonly trades: number;
  readonly buys: number;
  readonly sells: number;
  /** Quote moved, raw units. */
  readonly volumeQuote: bigint;
  /** Price after the first and last trade in the window; `null` with no trade. */
  readonly first: number | null;
  readonly last: number | null;
  /** `(last - first) / first`, or `null`. */
  readonly change: number | null;
  readonly lastTrade: Trade | null;
}

/** Counts and volume over the trades whose timestamp is >= `since` (all of them when `since` is 0). */
export function marketStats(trades: readonly Trade[], since = 0): MarketStats {
  const inWindow = trades.filter((t) => since === 0 || (t.timestamp !== null && t.timestamp >= since));
  const sorted = [...inWindow].sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
  const first = sorted[0]?.price ?? null;
  const lastTrade = sorted[sorted.length - 1] ?? null;
  const last = lastTrade?.price ?? null;
  return {
    trades: sorted.length,
    buys: sorted.filter((t) => t.side === "buy").length,
    sells: sorted.filter((t) => t.side === "sell").length,
    volumeQuote: sorted.reduce((s, t) => s + t.quoteAmount, 0n),
    first,
    last,
    change: first === null || last === null || first === 0 ? null : (last - first) / first,
    lastTrade,
  };
}

/* ----------------------------------------------------------------- holders --- */

export interface Holder {
  readonly address: Address;
  readonly balance: bigint;
  /** Share of `totalSupply`, 0..1. */
  readonly share: number;
}

export interface HolderScan {
  readonly holders: readonly Holder[];
  readonly holderCount: number;
  readonly transfers: number;
  readonly totalSupply: bigint;
  readonly fromBlock: bigint;
}

/**
 * Balances reduced from the token's `Transfer` logs since `fromBlock` (the
 * launch block: the token is minted there, so the reduction is complete).
 * Sorted largest first. Zero balances are dropped; the zero address is never a
 * holder. The Vault (which custodies every pool's reserves) and the lockers
 * appear as holders, because they are: a table labels them, it does not hide
 * them.
 */
export async function readHolders(
  client: PublicClient,
  token: Address,
  opts: { readonly fromBlock: bigint; readonly totalSupply: bigint; readonly toBlock?: bigint | "latest" },
): Promise<HolderScan> {
  const logs = await client.getLogs({ address: token, event: TRANSFER, fromBlock: opts.fromBlock, toBlock: opts.toBlock ?? "latest" });
  const balances = new Map<string, bigint>();
  for (const l of logs) {
    const from = (l.args.from as Address).toLowerCase();
    const to = (l.args.to as Address).toLowerCase();
    const v = l.args.value as bigint;
    if (from !== "0x0000000000000000000000000000000000000000") balances.set(from, (balances.get(from) ?? 0n) - v);
    if (to !== "0x0000000000000000000000000000000000000000") balances.set(to, (balances.get(to) ?? 0n) + v);
  }
  const holders = [...balances.entries()]
    .filter(([, b]) => b > 0n)
    .map(([a, b]) => ({ address: a as Address, balance: b, share: opts.totalSupply === 0n ? 0 : Number((b * 1_000_000n) / opts.totalSupply) / 1_000_000 }))
    .sort((x, y) => (x.balance === y.balance ? 0 : x.balance > y.balance ? -1 : 1));
  return { holders, holderCount: holders.length, transfers: logs.length, totalSupply: opts.totalSupply, fromBlock: opts.fromBlock };
}

/* --------------------------------------------------------------- directory --- */

/** A pool as the chain's own `Initialize` log describes it: the whole key, so a router can use it. */
export interface PoolListing {
  readonly poolId: Hex;
  readonly kind: "CL" | "Bin";
  readonly key: PoolKey;
  readonly createdAtBlock: bigint;
  readonly txHash: Hex;
}

/**
 * Every pool initialised on the CL and Bin pool managers since `fromBlock`,
 * from their `Initialize` logs, oldest first. Two `eth_getLogs`. This is the
 * directory a DEX front routes through: nothing is listed that the chain did
 * not open, and nothing that it did is left out.
 */
export async function readPoolDirectory(
  client: PublicClient,
  managers: { readonly clPoolManager: Address; readonly binPoolManager: Address },
  opts: { readonly fromBlock: bigint; readonly toBlock?: bigint | "latest" },
): Promise<readonly PoolListing[]> {
  const toBlock = opts.toBlock ?? "latest";
  const [cl, bin] = await Promise.all([
    client.getLogs({ address: managers.clPoolManager, event: CL_INITIALIZE, fromBlock: opts.fromBlock, toBlock }),
    client.getLogs({ address: managers.binPoolManager, event: BIN_INITIALIZE, fromBlock: opts.fromBlock, toBlock }),
  ]);
  const keyOf = (l: { args: Record<string, unknown> }, poolManager: Address): PoolKey => ({
    currency0: l.args["currency0"] as Address,
    currency1: l.args["currency1"] as Address,
    hooks: l.args["hooks"] as Address,
    poolManager,
    fee: Number(l.args["fee"]),
    parameters: l.args["parameters"] as Hex,
  });
  const out: PoolListing[] = [
    ...cl.map((l) => ({ poolId: l.args.id as Hex, kind: "CL" as const, key: keyOf(l as never, managers.clPoolManager), createdAtBlock: l.blockNumber, txHash: l.transactionHash })),
    ...bin.map((l) => ({ poolId: l.args.id as Hex, kind: "Bin" as const, key: keyOf(l as never, managers.binPoolManager), createdAtBlock: l.blockNumber, txHash: l.transactionHash })),
  ];
  return out.sort((a, b) => (a.createdAtBlock === b.createdAtBlock ? 0 : a.createdAtBlock < b.createdAtBlock ? -1 : 1));
}
