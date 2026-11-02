import { POOLS, RPC, SWAP_TOPIC, USDC, WPROS } from "./pools.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpcOne(method, params, attempt = 0) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) {
    const message = body.error.message || "rpc";
    if (attempt < 3 && /too fast|cu limit|rate/i.test(message)) {
      await sleep(700 * (attempt + 1));
      return rpcOne(method, params, attempt + 1);
    }
    throw new Error(message);
  }
  return body.result;
}

async function rpcMany(calls, attempt = 0) {
  if (!calls.length) return [];
  if (calls.length === 1) return [await rpcOne(calls[0].method, calls[0].params)];
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(calls.map((call, index) => ({ jsonrpc: "2.0", id: index + 1, method: call.method, params: call.params }))),
  });
  const body = await res.json();
  const rows = Array.isArray(body) ? body : body ? [body] : [];
  const limited = rows.find((row) => row?.error && /too fast|cu limit|rate/i.test(row.error.message || ""));
  if (limited && attempt < 3) {
    await sleep(700 * (attempt + 1));
    return rpcMany(calls, attempt + 1);
  }
  if (!Array.isArray(body)) {
    const out = [];
    for (const call of calls) out.push(await rpcOne(call.method, call.params));
    return out;
  }
  const byId = new Map(body.map((row) => [Number(row.id), row]));
  return calls.map((call, index) => {
    const row = byId.get(index + 1);
    if (!row) throw new Error("rpc");
    if (row.error) throw new Error(row.error.message || "rpc");
    return row.result;
  });
}

function word(hex, index = 0) {
  return BigInt(`0x${hex.slice(2 + index * 64, 2 + (index + 1) * 64)}`);
}

function addressOf(hex) {
  return `0x${hex.slice(26, 66).toLowerCase()}`;
}

function signed(value) {
  return value >= 2n ** 255n ? value - 2n ** 256n : value;
}

function hex(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function callSpec(to, data, tag) {
  return { method: "eth_call", params: [{ to, data }, tag] };
}

function decodePool(pool, slot0, liquidity, token0, token1, fee) {
  if (addressOf(token0) !== WPROS || addressOf(token1) !== USDC) throw new Error(`${pool.name} is not WPROS/USDC`);
  if (Number(word(fee, 0)) !== pool.feePips) throw new Error(`${pool.name} fee does not match`);
  return {
    ...pool,
    sqrtPriceX96: word(slot0, 0),
    tick: Number(signed(word(slot0, 1))),
    liquidity: word(liquidity, 0),
  };
}

function oneSwap(receipt, pool) {
  if (!receipt || receipt.status !== "0x1") return false;
  const swaps = receipt.logs.filter((log) => log.topics?.[0] === SWAP_TOPIC);
  return swaps.length === 1 && swaps[0].address.toLowerCase() === pool.toLowerCase();
}

async function singleSwapGas(address, head) {
  const ranges = [];
  const add = (to) => {
    if (to <= 0n) return;
    const end = to > head ? head : to;
    const from = end > 999n ? end - 999n : 0n;
    ranges.push([from, end]);
  };
  add(head);
  for (let i = 1; i <= 20; i++) add(head - BigInt(i) * 1000n);
  const seen = new Set();
  for (const [from, to] of ranges) {
    let logs = [];
    try {
      logs = await rpcOne("eth_getLogs", [{
        address,
        fromBlock: hex(from),
        toBlock: hex(to),
        topics: [SWAP_TOPIC],
      }]);
    } catch {
      continue;
    }
    for (const log of logs.reverse()) {
      const hash = log.transactionHash;
      if (seen.has(hash)) continue;
      seen.add(hash);
      const receipt = await rpcOne("eth_getTransactionReceipt", [hash]);
      if (oneSwap(receipt, address)) return BigInt(receipt.gasUsed);
    }
  }
  return null;
}

export async function readMarket() {
  const block = BigInt(await rpcOne("eth_blockNumber", []));
  const tag = hex(block);
  const headerCalls = [
    { method: "eth_getBlockByNumber", params: [tag, false] },
    { method: "eth_gasPrice", params: [] },
  ];
  const poolCalls = [];
  for (const pool of POOLS) {
    poolCalls.push(
      callSpec(pool.address, "0x3850c7bd", tag),
      callSpec(pool.address, "0x1a686502", tag),
      callSpec(pool.address, "0x0dfe1681", tag),
      callSpec(pool.address, "0xd21220a7", tag),
      callSpec(pool.address, "0xddca3f43", tag),
    );
  }
  const rows = await rpcMany([...headerCalls, ...poolCalls]);
  const header = rows[0];
  const gasPrice = BigInt(rows[1]);
  const pools = POOLS.map((pool, index) => {
    const base = 2 + index * 5;
    return decodePool(pool, rows[base], rows[base + 1], rows[base + 2], rows[base + 3], rows[base + 4]);
  });
  const swapGas = await Promise.all(pools.map((pool) => singleSwapGas(pool.address, block)));
  return { block, timestamp: BigInt(header.timestamp), gasPrice, pools, swapGas };
}

export async function nextNonce(address) {
  return BigInt(await rpcOne("eth_getTransactionCount", [address, "latest"]));
}
