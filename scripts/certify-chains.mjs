// Certifies every Latch target chain for a deployment — READ-ONLY.
//
// For each chain in `src/chains/endpoints.ts` (`CHAIN_RPCS`, read from the built SDK) it
// answers, against a live node and never from documentation:
//
//   1. chain id     eth_chainId matches; which endpoint answered within the 12 s budget
//   2. EVM opcodes  TSTORE/TLOAD (EIP-1153, decides the build profile), PUSH0 (EIP-3855),
//                   MCOPY (EIP-5656) — each a contract-creation `eth_call` whose initcode
//                   executes the opcode and RETURNs a value the script checks exactly
//   3. clock        `NUMBER` vs `eth_blockNumber` (own clock or a parent chain's, as on
//                   Arbitrum Nitro/Orbit) and the cadence of `NUMBER` measured over real time
//   4. code         Permit2, Multicall3, Safe 1.4.1 + 1.3.0 factory/singleton, the Latch
//                   governance Safe, the Create3Factory, the wrapped native, any Latch core
//   5. gas          eth_gasPrice and the native symbol/decimals, for the funding estimate
//
// JSON-RPC methods used: eth_chainId, eth_call, eth_getCode, eth_getBlockByNumber,
// eth_blockNumber, eth_gasPrice. Nothing is signed, nothing is sent, no key is read.
//
// Run:  node scripts/certify-chains.mjs                       # every chain, 120 s cadence
//       node scripts/certify-chains.mjs base bsc              # only the named chain keys
//       node scripts/certify-chains.mjs --cadence=180         # longer cadence window (s)
//       node scripts/certify-chains.mjs --cadence=0           # skip the cadence window
//       node scripts/certify-chains.mjs --out=/tmp/cert.json  # where the JSON lands
//
// Needs the SDK built (`npm run build` in packages/sdk) because it imports the shipped
// endpoint list and address book from `dist/`, so the certified list is exactly the one
// consumers get. The JSON it writes is an ARTEFACT: `docs/chain-certification.md` and
// `packages/core/script/config/eip1153.json` are edited BY HAND from it, so a bad run
// cannot silently rewrite a deploy gate.
//
// Wrapped-native addresses are the ONLY input here that comes from documentation. Each
// carries the URL it was read from; the script then checks code, `symbol()` and
// `decimals()` on chain. A chain with no sourced address reads "unknown" — never guessed.
import { writeFileSync } from "node:fs";
import { createPublicClient, http, keccak256, decodeAbiParameters, hexToBigInt } from "viem";
import * as viemChains from "viem/chains";

let CHAIN_RPCS, LATCH_DEPLOYMENTS;
try {
  ({ CHAIN_RPCS } = await import("../dist/chains/endpoints.js"));
  ({ LATCH_DEPLOYMENTS } = await import("../dist/deployments/index.js"));
} catch (e) {
  console.error("Build the SDK first (npm run build in packages/sdk): " + e.message);
  process.exit(2);
}

/* ---------------------------------------------------------------- probes */

// Contract-creation payloads. Each is initcode whose *execution* is the test; the
// value RETURNed is checked exactly, so an endpoint that answers `0x` for anything
// (some gateways do) cannot pass by accident.
const PROBES = {
  // PUSH1 1 · PUSH1 0 · TSTORE · PUSH1 0 · TLOAD · PUSH1 0 · MSTORE · PUSH1 32 · PUSH1 0 · RETURN
  tstore: { data: "0x600160005d60005c60005260206000f3", expect: 1n, opcode: "TSTORE/TLOAD 0x5d/0x5c" },
  // control: identical shape with SSTORE/SLOAD — valid on every EVM
  sstore: { data: "0x600160005560005460005260206000f3", expect: 1n, opcode: "SSTORE/SLOAD 0x55/0x54" },
  // PUSH0 · ISZERO · PUSH1 0 · MSTORE · PUSH1 32 · PUSH1 0 · RETURN  → 1 only if PUSH0 pushed 0
  push0: { data: "0x5f1560005260206000f3", expect: 1n, opcode: "PUSH0 0x5f" },
  // PUSH1 1 · PUSH1 0 · MSTORE · PUSH1 32(len) · PUSH1 0(src) · PUSH1 32(dst) · MCOPY · PUSH1 32 · PUSH1 32 · RETURN
  mcopy: { data: "0x60016000526020600060205e60206020f3", expect: 1n, opcode: "MCOPY 0x5e" },
};
// NUMBER · PUSH1 0 · MSTORE · TIMESTAMP · PUSH1 32 · MSTORE · PUSH1 64 · PUSH1 0 · RETURN
const CLOCK_PROBE = "0x436000524260205260406000f3";

/* ------------------------------------------------------------- addresses */

const CANONICAL = {
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  safe141ProxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
  safe141Singleton: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
  safe141SingletonL2: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
  safe130ProxyFactory: "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2",
  safe130Singleton: "0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552",
  // The governance Safe of record (owner decision 2026-09-24, 3-of-4). Certification asks "does the
  // Safe exist on this chain yet?", so it must ask about the Safe we will actually deploy under —
  // not the superseded 2-of-3 `0x715a…3432`, which exists on 4663/Sepolia and nowhere new.
  latchSafe: "0xeA7903Ed7d5FAE93CE1500ED2c4df138bDF0a038",
  create3Factory: "0x6ffdf9a3df7e9dd55bad2e60c7405cd181005633",
};

// Wrapped native per chain id: address + the page it was read from, read 2026-09-18.
// `kind` says what the contract IS per that page: a WETH9-style wrapper (`deposit`/`withdraw`),
// or a native-mirror ERC-20 (the gas token itself exposes an ERC-20 face; no wrapping exists).
// `null` = unknown: no page owned by the chain names one, and nothing is guessed.
// The script does NOT trust these: it reads code, symbol() and decimals() on chain.
const WRAPPED_NATIVE = {
  1: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", kind: "weth9", source: "https://weth.io/ — 'Ethereum Mainnet (canonical)'. Ethereum has no chain-operator document; this is the WETH project's own page." },
  8453: { address: "0x4200000000000000000000000000000000000006", kind: "weth9", source: "https://docs.base.org/base-chain/network-information/base-contracts — row 'WETH9' under L2 Contract Addresses, Base Mainnet" },
  56: { address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", kind: "weth9", source: "https://www.bnbchain.org/en/blog/what-is-wbnb — 'Contract Address: https://bscscan.com/token/0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'" },
  59144: { address: "0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f", kind: "weth9", source: "https://github.com/Consensys/linea-token-list/blob/main/json/linea-mainnet-token-shortlist.json — symbol WETH, tokenType 'native', chainId 59144" },
  4663: { address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", kind: "weth9", source: "https://docs.robinhood.com/chain/contracts — 'WETH'. Same address the Latch periphery was deployed against (packages/periphery/script/config/latch-robinhood.json)." },
  57073: { address: "0x4200000000000000000000000000000000000006", kind: "weth9", source: "https://docs.inkonchain.com/useful-information/contracts — 'WETH9', Ink Mainnet" },
  196: { address: "0xe538905cf8410324e03A5A23C1c177a474D59b2b", kind: "weth9", source: "https://web3.okx.com/token/x-layer/0xe538905cf8410324e03a5a23c1c177a474d59b2b — OKX (the chain operator) lists it as 'Wrapped OKB (WOKB)'; OKX's X Layer developer docs pages list no contract addresses at all" },
  999: { address: "0x5555555555555555555555555555555555555555", kind: "weth9", source: "https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/wrapped-hype — 'A canonical system contract for wrapped HYPE is deployed at 0x555...5'" },
  143: { address: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A", kind: "weth9", source: "https://docs.monad.xyz/developer-essentials/network-information — 'Canonical Contracts', WMON (Wrapped MON), Monad Mainnet" },
  9745: { address: "0x6100E367285b01F48D07953803A2d8dCA5D19873", kind: "weth9", source: "https://docs.plasma.org/docs/plasma-chain/network-information/plasma-contracts — 'WXPL9'" },
  988: { address: "0x779Ded0c9e1022225f8E0630b35a9b54bE713736", kind: "native-mirror", source: "https://docs.stable.xyz/en/explanation/usdt-as-gas-token/ — USDT0 is BOTH the gas token and an ERC-20 on the same balance: 'No second token, no wrapping'. The gUSDT predeploy 0x…1000 is sunset. Mainnet ERC-20 face: 0x779d…3736" },
  11155111: { address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", kind: "weth9", source: "NO chain-owned document names a Sepolia WETH (several WETH9 deployments exist). This is the one the Latch Sepolia periphery was deployed against: packages/periphery/script/config/latch-sepolia.json / the SDK address book." },
  // Monad Testnet was REMOVED 2026-09-24 by owner decision; its token address and source are gone
  // with it, deliberately. Monad MAINNET (143) stays and is listed above.
  2201: { address: "0x78cf24370174180738c5b8e352b6d14c83a6c9a9", kind: "native-mirror", source: "https://docs.stable.xyz/en/explanation/usdt-as-gas-token/ — 'Testnet: 0x78cf…c9a9' (USDT0 ERC-20 face of the gas token; no wrapping on Stable)" },
  5042002: { address: "0x3600000000000000000000000000000000000000", kind: "native-mirror", source: "https://docs.arc.io/arc/references/contract-addresses — USDC ERC-20 face (6 decimals) of the native gas USDC (18 decimals); 'There is no wrapped USDC address on Arc'" },
};

const ERC20_META_ABI = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
];
const SAFE_ABI = [
  { type: "function", name: "VERSION", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "getOwners", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { type: "function", name: "getThreshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];

/* ----------------------------------------------------------------- args */

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const CADENCE_SECONDS = Number(flag("cadence", "120"));
const OUT = flag("out", "chain-certification.json");
const TIMEOUT_MS = Number(flag("timeout", "12000"));
const selected = args.filter((a) => !a.startsWith("--"));
const chainKeys = selected.length ? selected : Object.keys(CHAIN_RPCS);
for (const k of chainKeys) if (!CHAIN_RPCS[k]) { console.error(`unknown chain key ${k}`); process.exit(2); }

/* ------------------------------------------------------------- helpers */

const client = (url) => createPublicClient({ transport: http(url, { timeout: TIMEOUT_MS, retryCount: 0 }) });
const errText = (e) => String(e?.shortMessage ?? e?.message ?? e).split("\n")[0].slice(0, 200);
const EXEC_FAIL = /invalid opcode|invalid instruction|opcode .* not (defined|supported)|execution reverted|revert|invalid jump|bad instruction|out of gas/i;
const now = () => Date.now();

async function withTiming(fn) {
  const t = now();
  const v = await fn();
  return { v, ms: now() - t };
}

/** Runs a creation `eth_call` and classifies the outcome. */
async function creationCall(c, data, expect) {
  try {
    const r = await c.call({ data });
    const out = r.data ?? "0x";
    if (out.length < 66) return { ok: false, kind: "unexpected", detail: `returned ${out}` };
    const word = hexToBigInt(`0x${out.slice(2, 66)}`);
    if (expect !== undefined && word !== expect) return { ok: false, kind: "unexpected", detail: `returned ${out.slice(0, 66)}` };
    return { ok: true, kind: "ok", detail: out };
  } catch (e) {
    const t = errText(e);
    return { ok: false, kind: EXEC_FAIL.test(t) ? "execution-failed" : "rpc-error", detail: t };
  }
}

function decodeClock(hex) {
  const [number, timestamp] = decodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], hex);
  return { number, timestamp };
}

async function codeAt(clients, address) {
  try {
    const { value: code, endpoint } = await withFallback(clients, (cc) => cc.getCode({ address }));
    if (!code || code === "0x") return { present: false, bytes: 0, hash: null, endpoint };
    return { present: true, bytes: (code.length - 2) / 2, hash: keccak256(code), endpoint };
  } catch (e) {
    return { present: null, bytes: null, hash: null, error: errText(e) };
  }
}

async function tryRead(clients, address, abi, functionName) {
  try {
    return { value: (await withFallback(clients, (cc) => cc.readContract({ address, abi, functionName }))).value };
  } catch (e) {
    return { error: errText(e) };
  }
}

/**
 * Runs a node read against each live endpoint in order until one answers, retrying a
 * transport failure once after a pause. Public gateways rate-limit (thirdweb fronts
 * several chains behind ONE limiter), so a single 429 must not become a "?" in the table.
 */
async function withFallback(clients, fn) {
  let last;
  for (const { url, client: cc } of clients) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return { value: await fn(cc), endpoint: url };
      } catch (e) {
        last = e;
        if (EXEC_FAIL.test(errText(e))) throw e; // a contract answer, not a transport failure
        await new Promise((res) => setTimeout(res, 1500));
      }
    }
  }
  throw last;
}

const jsonSafe = (v) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

/* -------------------------------------------------------------- per chain */

async function certify(key) {
  const cfg = CHAIN_RPCS[key];
  const chainId = cfg.chainId;
  const r = { key, name: cfg.name, chainId, startedAt: new Date().toISOString(), endpoints: [] };

  // 1. find the first endpoint that answers eth_chainId correctly inside the budget
  let primary = null;
  for (const ep of cfg.endpoints) {
    const c = client(ep.url);
    try {
      const { v: id, ms } = await withTiming(() => c.getChainId());
      r.endpoints.push({ url: ep.url, chainId: id, ms, ok: id === chainId });
      if (id === chainId && !primary) primary = { url: ep.url, client: c, ms };
    } catch (e) {
      r.endpoints.push({ url: ep.url, chainId: null, ms: null, ok: false, error: errText(e) });
    }
  }
  if (!primary) {
    r.reachable = false;
    r.verdict = "UNREACHABLE — no listed endpoint answered eth_chainId with the expected id within the budget";
    return r;
  }
  r.reachable = true;
  r.primaryEndpoint = primary.url;
  r.primaryLatencyMs = primary.ms;
  const c = primary.client;
  const live = r.endpoints.filter((e) => e.ok).map((e) => e.url);
  const liveClients = live.map((url) => ({ url, client: url === primary.url ? c : client(url) }));

  // 2. opcodes. TSTORE is asked of EVERY live endpoint (one endpoint can be wrong);
  //    the rest are asked of the primary, falling through on an RPC-policy error.
  r.opcodes = {};
  const perEndpoint = [];
  for (const url of live) {
    const cc = url === primary.url ? c : client(url);
    const t = await creationCall(cc, PROBES.tstore.data, PROBES.tstore.expect);
    const s = t.kind === "rpc-error" ? null : await creationCall(cc, PROBES.sstore.data, PROBES.sstore.expect);
    perEndpoint.push({ url, tstore: t.kind, tstoreDetail: t.detail, sstoreControl: s ? s.kind : "not-asked" });
  }
  r.opcodes.tstorePerEndpoint = perEndpoint;
  const conclusive = perEndpoint.filter((p) => p.tstore !== "rpc-error" && p.sstoreControl === "ok");
  const yes = conclusive.filter((p) => p.tstore === "ok").length;
  const no = conclusive.filter((p) => p.tstore === "execution-failed").length;
  r.opcodes.eip1153 = conclusive.length === 0 ? null : no === 0 ? true : yes === 0 ? false : "disagree";
  r.opcodes.eip1153Tally = `${yes} yes / ${no} no / ${perEndpoint.length - conclusive.length} inconclusive of ${perEndpoint.length}`;

  for (const name of ["push0", "mcopy"]) {
    let res = null;
    for (const url of live) {
      const cc = url === primary.url ? c : client(url);
      res = await creationCall(cc, PROBES[name].data, PROBES[name].expect);
      res.endpoint = url;
      if (res.kind !== "rpc-error") break;
    }
    r.opcodes[name] = res ? { supported: res.kind === "ok" ? true : res.kind === "execution-failed" ? false : null, kind: res.kind, detail: res.detail, endpoint: res.endpoint } : null;
  }

  // 3. clock. NUMBER/TIMESTAMP from the EVM, eth_blockNumber and the header from the node.
  r.clock = {};
  let clockClient = c;
  let clockUrl = primary.url;
  let first = null;
  for (const url of live) {
    const cc = url === primary.url ? c : client(url);
    const probe = await creationCall(cc, CLOCK_PROBE);
    if (probe.kind === "ok") { first = decodeClock(probe.detail); clockClient = cc; clockUrl = url; break; }
    r.clock.lastProbeError = probe.detail;
  }
  if (!first) {
    r.clock.error = "no live endpoint executed the NUMBER/TIMESTAMP creation call";
  } else {
    const wall0 = now();
    const header = await withFallback(liveClients, (cc) => cc.getBlock({ blockTag: "latest" })).then((x) => x.value).catch((e) => ({ error: errText(e) }));
    const rpcNumber = header.number ?? (await withFallback(liveClients, (cc) => cc.getBlockNumber()).then((x) => x.value).catch(() => null));
    const l1BlockNumber = header.l1BlockNumber ?? null; // Arbitrum Nitro headers carry this
    r.clock.endpoint = clockUrl;
    r.clock.contractNumber = first.number;
    r.clock.contractTimestamp = first.timestamp;
    r.clock.rpcBlockNumber = rpcNumber;
    r.clock.rpcTimestamp = header.timestamp ?? null;
    r.clock.headerL1BlockNumber = l1BlockNumber === null ? null : BigInt(l1BlockNumber);
    const diff = rpcNumber === null ? null : (first.number > rpcNumber ? first.number - rpcNumber : rpcNumber - first.number);
    // Own clock: NUMBER sits within a few blocks of eth_blockNumber. Parent: it is a different
    // number entirely (on Nitro it equals the header's l1BlockNumber).
    const l1 = l1BlockNumber === null ? null : BigInt(l1BlockNumber);
    const nearL1 = l1 !== null && (l1 > first.number ? l1 - first.number : first.number - l1) <= 3n;
    // NUMBER and the header were read moments apart, possibly from different endpoints that
    // lag each other, so some slack is expected: 100 blocks is 30 s on the fastest chain here,
    // while a parent clock differs by tens of millions.
    r.clock.kind = diff === null ? "unknown" : diff <= 100n ? "own" : nearL1 ? "parent (Arbitrum Nitro/Orbit: NUMBER == header.l1BlockNumber)" : "parent-or-lagging";
    r.clock.rpcMinusContract = rpcNumber === null ? null : rpcNumber - first.number;

    // cadence of NUMBER over real time, sampled every ~20 s
    if (CADENCE_SECONDS > 0) {
      const samples = [{ wallMs: 0, number: first.number, timestamp: first.timestamp }];
      const stepMs = Math.min(20000, CADENCE_SECONDS * 1000);
      while (now() - wall0 < CADENCE_SECONDS * 1000) {
        await new Promise((res) => setTimeout(res, stepMs));
        const p = await creationCall(clockClient, CLOCK_PROBE);
        if (p.kind === "ok") {
          const d = decodeClock(p.detail);
          samples.push({ wallMs: now() - wall0, number: d.number, timestamp: d.timestamp });
        } else {
          samples.push({ wallMs: now() - wall0, error: p.detail });
        }
      }
      const good = samples.filter((s) => !s.error);
      const a = good[0];
      const b = good[good.length - 1];
      const dN = b.number - a.number;
      const dWall = (b.wallMs - a.wallMs) / 1000;
      const dTs = Number(b.timestamp - a.timestamp);
      r.clock.cadence = {
        samples: samples.length,
        failed: samples.length - good.length,
        wallSeconds: Number(dWall.toFixed(1)),
        contractBlocksAdvanced: dN,
        chainSecondsAdvanced: dTs,
        secondsPerContractBlockWall: dN > 0n ? Number((dWall / Number(dN)).toFixed(3)) : null,
        secondsPerContractBlockChain: dN > 0n ? Number((dTs / Number(dN)).toFixed(3)) : null,
        // a rough L2 block time from headers, for the parent-vs-own narrative
        rpcBlocksAdvanced: null,
      };
      const header2 = await withFallback(liveClients, (cc) => cc.getBlock({ blockTag: "latest" })).then((x) => x.value).catch(() => null);
      if (header2 && rpcNumber !== null) {
        const dRpc = header2.number - rpcNumber;
        r.clock.cadence.rpcBlocksAdvanced = dRpc;
        r.clock.cadence.secondsPerRpcBlock = dRpc > 0n ? Number((Number(header2.timestamp - header.timestamp) / Number(dRpc)).toFixed(3)) : null;
      }
    }
  }

  // 4. code presence
  r.code = {};
  for (const [name, address] of Object.entries(CANONICAL)) r.code[name] = { address, ...(await codeAt(liveClients, address)) };
  // Safe versions / owners where the singleton or the Latch Safe exists
  for (const name of ["safe141Singleton", "safe141SingletonL2", "safe130Singleton"]) {
    if (r.code[name].present) r.code[name].version = (await tryRead(liveClients, CANONICAL[name], SAFE_ABI, "VERSION")).value ?? null;
  }
  if (r.code.latchSafe.present) {
    r.code.latchSafe.version = (await tryRead(liveClients, CANONICAL.latchSafe, SAFE_ABI, "VERSION")).value ?? null;
    r.code.latchSafe.owners = (await tryRead(liveClients, CANONICAL.latchSafe, SAFE_ABI, "getOwners")).value ?? null;
    const th = (await tryRead(liveClients, CANONICAL.latchSafe, SAFE_ABI, "getThreshold")).value;
    r.code.latchSafe.threshold = th === undefined ? null : Number(th);
  }
  const wn = WRAPPED_NATIVE[chainId];
  if (wn) {
    r.wrappedNative = { ...wn, ...(await codeAt(liveClients, wn.address)) };
    if (r.wrappedNative.present) {
      r.wrappedNative.symbol = (await tryRead(liveClients, wn.address, ERC20_META_ABI, "symbol")).value ?? null;
      const d = (await tryRead(liveClients, wn.address, ERC20_META_ABI, "decimals")).value;
      r.wrappedNative.decimals = d === undefined ? null : Number(d);
    }
  } else {
    r.wrappedNative = { address: null, source: null, present: null, note: "unknown — no address sourced from the chain's own documentation" };
  }
  const dep = LATCH_DEPLOYMENTS[chainId];
  if (dep) {
    r.latch = { recorded: true };
    for (const name of ["vault", "clPoolManager", "binPoolManager", "registry", "universalRouter", "permit2", "weth"]) {
      if (dep[name]) r.latch[name] = { address: dep[name], ...(await codeAt(liveClients, dep[name])) };
    }
  } else {
    r.latch = { recorded: false };
  }

  // 5. gas + native
  try {
    r.gasPriceWei = (await withFallback(liveClients, (cc) => cc.getGasPrice())).value;
  } catch (e) {
    r.gasPriceWei = null;
    r.gasPriceError = errText(e);
  }
  const vc = Object.values(viemChains).find((x) => x && typeof x === "object" && x.id === chainId && x.nativeCurrency);
  r.native = vc ? { ...vc.nativeCurrency, source: `viem/chains ${vc.name} (documentation, not read from chain)` } : { source: "not in viem/chains" };

  r.finishedAt = new Date().toISOString();
  return r;
}

/* ----------------------------------------------------------------- main */

const started = new Date();
console.error(`certify-chains: ${chainKeys.length} chain(s), cadence ${CADENCE_SECONDS} s, timeout ${TIMEOUT_MS} ms`);
const results = await Promise.all(
  chainKeys.map((k) =>
    certify(k).catch((e) => ({ key: k, name: CHAIN_RPCS[k].name, chainId: CHAIN_RPCS[k].chainId, reachable: false, verdict: `script error: ${errText(e)}` })),
  ),
);

const mark = (v) => (v === true ? "yes" : v === false ? "NO" : v === null || v === undefined ? "?" : String(v));
const codeMark = (x) => (x?.present === true ? "yes" : x?.present === false ? "no" : "?");
const rows = results.map((r) => {
  if (!r.reachable) return [r.name, r.chainId, "UNREACHABLE", "", "", "", "", "", "", "", "", "", "", "", r.verdict];
  const e = r.opcodes.eip1153;
  const profile = e === true ? "default" : e === false ? "legacy" : "UNDECIDED";
  const cad = r.clock.cadence;
  const clock = r.clock.error ? "?" : `${r.clock.kind.split(" ")[0]}${cad?.secondsPerContractBlockChain != null ? ` ${cad.secondsPerContractBlockChain}s` : ""}`;
  const safeInfra = `${codeMark(r.code.safe141ProxyFactory)}/${codeMark(r.code.safe141Singleton)}${r.code.safe141SingletonL2?.present ? "+L2" : ""} 1.3:${codeMark(r.code.safe130ProxyFactory)}/${codeMark(r.code.safe130Singleton)}`;
  const latch = r.latch.recorded ? (r.latch.vault?.present === true ? "yes" : r.latch.vault?.present === false ? "recorded, NO CODE" : "recorded, unread") : "no";
  const wn = r.wrappedNative.present === null ? "unknown" : r.wrappedNative.present ? `${r.wrappedNative.symbol ?? "?"}` : "NO CODE";
  return [
    r.name, r.chainId, new URL(r.primaryEndpoint).host, `${mark(e)} → ${profile}`, mark(r.opcodes.push0?.supported), mark(r.opcodes.mcopy?.supported),
    clock, codeMark(r.code.permit2), codeMark(r.code.multicall3), safeInfra, codeMark(r.code.latchSafe), codeMark(r.code.create3Factory), wn, latch,
    r.gasPriceWei == null ? "?" : `${(Number(r.gasPriceWei) / 1e9).toPrecision(3)} gwei ${r.native.symbol ?? ""}`,
  ];
});
const header = ["chain", "id", "endpoint", "EIP-1153 → profile", "PUSH0", "MCOPY", "clock", "Permit2", "MC3", "Safe 1.4.1 f/s", "Latch Safe", "Create3", "wrapped", "Latch", "gas"];
const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => String(row[i]).length)));
const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join("  ");
console.log(line(header));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const row of rows) console.log(line(row));

const out = { generatedAt: started.toISOString(), cadenceSeconds: CADENCE_SECONDS, timeoutMs: TIMEOUT_MS, probes: PROBES, clockProbe: CLOCK_PROBE, canonical: CANONICAL, chains: results };
writeFileSync(OUT, JSON.stringify(jsonSafe(out), null, 2));
console.error(`\nwrote ${OUT}`);
