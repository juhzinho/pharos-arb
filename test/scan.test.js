import assert from "node:assert/strict";
import test from "node:test";
import { buttonLabel, EXAMPLES } from "../public/examples.js";
import { formatUnits, parseUnits } from "../lib/format.js";
import { POOLS, SAMPLE } from "../lib/pools.js";
import { POOL_CONFIG } from "../public/config.js";
import { getSqrtRatioAtTick, quoteSellWpros, roundTrip, tickBounds } from "../lib/quote.js";
import { evaluateScan } from "../lib/scan.js";

function pool(name, tick, fee, spacing, address, liquidity = 10n ** 24n) {
  const { lower, upper } = tickBounds(tick, spacing);
  const sqrtPriceX96 = (getSqrtRatioAtTick(lower) + getSqrtRatioAtTick(upper)) / 2n;
  return { name, feePips: fee, spacing, address, tick: Number(lower), liquidity, sqrtPriceX96 };
}

const wide = [pool("0.01%", -279000, 100, 1, POOLS[0].address), pool("0.30%", -280000, 3000, 60, POOLS[1].address)];
const flat = [pool("0.01%", -280000, 100, 1, POOLS[0].address), pool("0.30%", -280000, 3000, 60, POOLS[1].address)];
const thin = [pool("0.01%", -280000, 100, 1, POOLS[0].address, 1000n), pool("0.30%", -280520, 3000, 60, POOLS[1].address, 1000n)];

function scan(pools, extra = {}) {
  return evaluateScan({
    amount: "1",
    min: "0",
    pools,
    swapGas: [120000n, 160000n],
    gasPrice: 1n,
    block: 21000000n,
    timestamp: 1760000000n,
    nonce: 7n,
    lang: "en",
    ...extra,
  });
}

test("tick zero is one to one", () => {
  assert.equal(getSqrtRatioAtTick(0), 2n ** 96n);
});

test("fees, slippage and the quoted net add back to the gross spread", () => {
  const trip = roundTrip(wide[0], wide[1], 10n ** 18n);
  assert.equal(trip.complete, true);
  assert.equal(trip.gross - trip.feeCost - trip.slippage, trip.quoted);
});

test("a size that leaves the tick is skipped and nothing is prepared", () => {
  const out = scan(thin, { amount: "10" });
  assert.equal(out.decision, "skip");
  assert.match(out.reason, /slippage estimate stops/);
  assert.match(out.gross, /^-?\d+\.\d{6}$/);
  assert.equal(out.net, null);
  assert.equal(out.transactions, null);
  assert.equal(out.broadcast, false);
  assert.equal(out.executed, false);
  assert.equal(out.sources.length, 2);
});

test("a spread that clears the minimum prepares two unsigned swaps", () => {
  const out = scan(wide, { amount: "10", min: "0" });
  assert.equal(out.headline, "Prepare the two swaps.");
  assert.equal(out.decision, "prepare");
  assert.match(out.reason, /Nothing was broadcast/);
  assert.equal(out.transactions.length, 2);
  assert.equal(out.transactions[0].from, SAMPLE);
  assert.equal(out.transactions[0].to, wide[0].address);
  assert.equal(out.transactions[1].to, wide[1].address);
  assert.equal(out.transactions[0].data.slice(0, 10), "0x128acb08");
  assert.equal(out.transactions[0].type, "0x0");
  assert.equal(out.transactions[0].chainId, "0x688");
  assert.equal(out.transactions[0].value, "0x0");
  assert.equal(out.transactions[1].nonce, "0x8");
  assert.equal(out.broadcast, false);
  assert.equal(out.executed, false);
  const sellAmount = BigInt(`0x${out.transactions[0].data.slice(2 + 8 + 2 * 64, 2 + 8 + 3 * 64)}`);
  const sellLimit = BigInt(`0x${out.transactions[0].data.slice(2 + 8 + 3 * 64, 2 + 8 + 4 * 64)}`);
  const sell = quoteSellWpros({ ...wide[0], amountIn: 10n * 10n ** 18n });
  assert.equal(sellAmount, 10n * 10n ** 18n);
  assert.equal(sellLimit, sell.sqrtNext);
  const buyAmount = BigInt(`0x${out.transactions[1].data.slice(2 + 8 + 2 * 64, 2 + 8 + 3 * 64)}`);
  assert.equal(buyAmount, (1n << 256n) - 10n * 10n ** 18n);
});

test("a net that only meets the minimum is skipped", () => {
  const cleared = scan(wide, { amount: "1", min: "0" });
  const same = scan(wide, { amount: "1", min: cleared.net });
  assert.equal(same.decision, "skip");
  assert.match(same.reason, /is not above/);
  assert.equal(same.transactions, null);
});

test("the same price is not taken", () => {
  const out = scan(flat);
  assert.equal(out.decision, "skip");
  assert.equal(out.transactions, null);
  assert.ok(out.costs.fee);
  assert.ok(out.costs.gas);
  assert.ok(out.net.startsWith("-"));
});

test("missing gas skips before a transaction is built", () => {
  const out = scan(wide, { swapGas: [120000n, null] });
  assert.equal(out.decision, "skip");
  assert.match(out.reason, /single swap was not found/);
  assert.equal(out.costs.gas, null);
  assert.equal(out.transactions, null);
});

test("unreadable amounts are not a scan", () => {
  assert.equal(scan(wide, { amount: "1e2" }).ok, false);
  assert.equal(scan(wide, { amount: "0" }).ok, false);
  assert.equal(scan(wide, { min: "-1" }).ok, false);
  assert.equal(parseUnits("1.1234567", 6), null);
  assert.equal(formatUnits(-1500000n, 6, 6), "-1.500000");
});

test("the page configuration is the pools the scan reads", () => {
  assert.deepEqual(
    POOL_CONFIG.map((pool) => [pool.name, pool.feePips, pool.spacing, pool.address]),
    POOLS.map((pool) => [pool.name, pool.feePips, pool.spacing, pool.address]),
  );
});

test("example buttons name the values they fill", () => {
  assert.deepEqual(EXAMPLES.map((row) => buttonLabel(row, "en")), [
    "1 WPROS, min 0 USDC",
    "100 WPROS, min 0 USDC",
    "1 WPROS, min 1 USDC",
  ]);
  assert.equal(buttonLabel(EXAMPLES[0], "pt"), "1 WPROS, mínimo 0 USDC");
});
