import { POOLS, RPC, SWAP_TOPIC, USDC, WPROS } from "./pools.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(method, params, attempt = 0) {
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
      return rpc(method, params, attempt + 1);
    }
    throw new Error(message);
  }
  return body.result;
}

function word(hex, index) {
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

async function call(to, data, block) {
  return rpc("eth_call", [{ to, data }, block]);
}

async function readPool(pool, block) {
  const [slot0, liquidity, token0, token1, fee, code] = await Promise.all([
    call(pool.address, "0x3850c7bd", block),
    call(pool.address, "0x1a686502", block),
    call(pool.address, "0x0dfe1681", block),
    call(pool.address, "0xd21220a7", block),
    call(pool.address, "0xddca3f43", block),
    rpc("eth_getCode", [pool.address, block]),
  ]);
  if (addressOf(token0) !== WPROS || addressOf(token1) !== USDC) throw new Error(`${pool.name} is not WPROS/USDC`);
  if (Number(word(fee, 0)) !== pool.feePips) throw new Error(`${pool.name} fee does not match`);
  if (!code.includes("128acb08")) throw new Error(`${pool.name} has no swap`);
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

async function singleSwapGas(address, block) {
  let end = block;
  for (let window = 0; window < 4 && end > 0n; window++) {
    const start = end > 499n ? end - 499n : 0n;
    const logs = await rpc("eth_getLogs", [{
      address,
      fromBlock: hex(start),
      toBlock: hex(end),
      topics: [SWAP_TOPIC],
    }]);
    const hashes = [];
    for (let i = logs.length - 1; i >= 0 && hashes.length < 8; i--) {
      if (!hashes.includes(logs[i].transactionHash)) hashes.push(logs[i].transactionHash);
    }
    for (const hash of hashes) {
      const receipt = await rpc("eth_getTransactionReceipt", [hash]);
      if (oneSwap(receipt, address)) return BigInt(receipt.gasUsed);
      await sleep(200);
    }
    if (start === 0n) break;
    end = start - 1n;
    await sleep(300);
  }
  return null;
}

export async function readMarket() {
  const block = BigInt(await rpc("eth_blockNumber", []));
  const tag = hex(block);
  const header = await rpc("eth_getBlockByNumber", [tag, false]);
  const gasPrice = BigInt(await rpc("eth_gasPrice", []));
  const pools = [];
  for (const pool of POOLS) {
    pools.push(await readPool(pool, tag));
    await sleep(300);
  }
  const gas = [];
  for (const pool of pools) {
    gas.push(await singleSwapGas(pool.address, block));
    await sleep(300);
  }
  return { block, timestamp: BigInt(header.timestamp), gasPrice, pools, swapGas: gas };
}

export async function nextNonce(address) {
  return BigInt(await rpc("eth_getTransactionCount", [address, "latest"]));
}
