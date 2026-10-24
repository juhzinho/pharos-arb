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
      await sleep(800 * (attempt + 1));
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

async function call(to, data, block) {
  return rpc("eth_call", [{ to, data }, block]);
}

async function readPool(pool, block) {
  const [slot0, liquidity, token0, token1, fee] = await Promise.all([
    call(pool.address, "0x3850c7bd", block),
    call(pool.address, "0x1a686502", block),
    call(pool.address, "0x0dfe1681", block),
    call(pool.address, "0xd21220a7", block),
    call(pool.address, "0xddca3f43", block),
  ]);
  if (addressOf(token0) !== WPROS || addressOf(token1) !== USDC) throw new Error(`${pool.name} is not WPROS/USDC`);
  if (Number(word(fee, 0)) !== pool.feePips) throw new Error(`${pool.name} fee does not match`);
  return {
    ...pool,
    sqrtPriceX96: word(slot0, 0),
    tick: Number(signed(word(slot0, 1))),
    liquidity: word(liquidity, 0),
  };
}

async function latestSwapGas(address, block) {
  let end = block;
  for (let i = 0; i < 4 && end > 0n; i++) {
    const start = end > 499n ? end - 499n : 0n;
    const logs = await rpc("eth_getLogs", [{
      address,
      fromBlock: `0x${start.toString(16)}`,
      toBlock: `0x${end.toString(16)}`,
      topics: [SWAP_TOPIC],
    }]);
    if (logs.length) {
      const receipt = await rpc("eth_getTransactionReceipt", [logs[logs.length - 1].transactionHash]);
      return BigInt(receipt.gasUsed);
    }
    if (start === 0n) break;
    end = start - 1n;
    await sleep(400);
  }
  return null;
}

export async function readMarket() {
  const block = BigInt(await rpc("eth_blockNumber", []));
  const tag = `0x${block.toString(16)}`;
  const header = await rpc("eth_getBlockByNumber", [tag, false]);
  const gasPrice = BigInt(await rpc("eth_gasPrice", []));
  const pools = [];
  for (const pool of POOLS) {
    pools.push(await readPool(pool, tag));
    await sleep(350);
  }
  const gas = [];
  for (const pool of pools) {
    gas.push(await latestSwapGas(pool.address, block));
    await sleep(350);
  }
  return {
    block,
    timestamp: BigInt(header.timestamp),
    gasPrice,
    pools,
    swapGas: gas,
  };
}

export async function nextNonce(address) {
  return BigInt(await rpc("eth_getTransactionCount", [address, "latest"]));
}
