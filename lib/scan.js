import { appendFile, mkdir } from "node:fs/promises";
import { readMarket, nextNonce } from "./chain.js";
import { formatUnits, hex, parseUnits } from "./format.js";
import { CHAIN_ID, SAMPLE } from "./pools.js";
import { decide, gasToUsdc6, roundTrip, spotUsdc6PerWpros } from "./quote.js";

const TEXT = {
  en: {
    badAmount: "The amount is not a WPROS amount.",
    badMin: "The minimum is not a USDC amount.",
    zero: "The amount is zero.",
    unread: "The pools could not be read.",
    tick: (amount, name) => `${amount} WPROS does not stay inside the ${name} pool tick, so the slippage estimate stops.`,
    both: (amount) => `${amount} WPROS does not stay inside either pool tick, so the slippage estimate stops.`,
    noGas: "A recent single swap was not found, so gas was not measured.",
    skip: (net, min) => `Net ${net} USDC is not above ${min} USDC.`,
    go: (net, min) => `Net ${net} USDC is above ${min} USDC. Two unsigned swaps are ready. Nothing was broadcast.`,
    headSkip: "Skip this scan.",
    headGo: "Prepare the two swaps.",
  },
  pt: {
    badAmount: "A quantidade não é um valor em WPROS.",
    badMin: "O mínimo não é um valor em USDC.",
    zero: "A quantidade é zero.",
    unread: "As pools não puderam ser lidas.",
    tick: (amount, name) => `${amount} WPROS não cabe no tick da pool ${name}, então a estimativa de deslizamento para.`,
    both: (amount) => `${amount} WPROS não cabe no tick de nenhuma das pools, então a estimativa de deslizamento para.`,
    noGas: "Não há uma troca única recente, então o gás não foi medido.",
    skip: (net, min) => `O líquido de ${net} USDC não está acima de ${min} USDC.`,
    go: (net, min) => `O líquido de ${net} USDC está acima de ${min} USDC. Duas trocas sem assinatura estão prontas. Nada foi enviado.`,
    headSkip: "Pular esta leitura.",
    headGo: "Preparar as duas trocas.",
  },
};

function pad32(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function addr(value) {
  return value.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

export function encodePoolSwap({ recipient, zeroForOne, amountSpecified, sqrtPriceLimitX96 }) {
  const amount = amountSpecified < 0n ? (1n << 256n) + amountSpecified : amountSpecified;
  return `0x128acb08${[
    addr(recipient), pad32(zeroForOne ? 1 : 0), pad32(amount), pad32(sqrtPriceLimitX96), pad32(0xa0), pad32(0),
  ].join("")}`;
}

function money(value) {
  return formatUnits(value, 6, 6);
}

function spotGross(left, right, amountRaw) {
  const leftSpot = spotUsdc6PerWpros(left.sqrtPriceX96);
  const rightSpot = spotUsdc6PerWpros(right.sqrtPriceX96);
  const high = leftSpot > rightSpot ? leftSpot : rightSpot;
  const low = leftSpot > rightSpot ? rightSpot : leftSpot;
  const sell = (amountRaw * high) / 10n ** 18n;
  const buy = low === 0n ? 0n : (amountRaw * low + 10n ** 18n - 1n) / 10n ** 18n;
  return sell - buy;
}

function reject(t, reason) {
  return { ok: false, headline: reason, reason, executed: false, broadcast: false };
}

function base(t, extra) {
  return { ok: true, executed: false, broadcast: false, ...extra, headline: extra.decision === "prepare" ? t.headGo : t.headSkip };
}

export function evaluateScan({ amount, min, pools, swapGas, gasPrice, block, nonce = 0n, lang = "en" }) {
  const t = TEXT[lang === "pt" ? "pt" : "en"];
  const amountRaw = parseUnits(amount, 18);
  const minRaw = parseUnits(min, 6);
  if (amountRaw === null) return reject(t, t.badAmount);
  if (amountRaw === 0n) return reject(t, t.zero);
  if (minRaw === null) return reject(t, t.badMin);

  const [left, right] = pools;
  const forward = roundTrip(left, right, amountRaw);
  const back = roundTrip(right, left, amountRaw);
  const attempts = [
    { sell: left, buy: right, trip: forward },
    { sell: right, buy: left, trip: back },
  ].filter((row) => row.trip.complete);
  const sources = pools.map((pool) => ({
    name: pool.name,
    price: money(spotUsdc6PerWpros(pool.sqrtPriceX96)),
  }));
  const common = { amount: String(amount).trim(), min: money(minRaw), block: block.toString(), sources };

  if (!attempts.length) {
    const names = [];
    if (forward.sellLimited || back.buyLimited) names.push(left.name);
    if (forward.buyLimited || back.sellLimited) names.push(right.name);
    const unique = [...new Set(names)];
    const reason = unique.length === 1 ? t.tick(common.amount, unique[0]) : t.both(common.amount);
    return base(t, { ...common, decision: "skip", reason, sell: null, buy: null, gross: money(spotGross(left, right, amountRaw)), costs: { fee: null, slippage: null, gas: null }, net: null, transactions: null });
  }

  attempts.sort((a, b) => (a.trip.quoted > b.trip.quoted ? -1 : 1));
  const best = attempts[0];
  if (swapGas.some((gas) => gas == null)) {
    return base(t, {
      ...common,
      decision: "skip",
      reason: t.noGas,
      sell: best.sell.name,
      buy: best.buy.name,
      gross: money(best.trip.gross),
      costs: { fee: money(best.trip.feeCost), slippage: money(best.trip.slippage), gas: null },
      net: null,
      transactions: null,
    });
  }

  const deep = pools.find((pool) => pool.name === "0.01%") ?? pools[0];
  const gasUnits = swapGas[0] + swapGas[1];
  const gasUsdc = gasToUsdc6(gasUnits, gasPrice, spotUsdc6PerWpros(deep.sqrtPriceX96));
  const { net, decision } = decide({ quoted: best.trip.quoted, gasUsdc6: gasUsdc, minUsdc6: minRaw });
  const reason = decision === "prepare" ? t.go(money(net), money(minRaw)) : t.skip(money(net), money(minRaw));
  let transactions = null;
  if (decision === "prepare") {
    const gasFor = (pool) => (swapGas[pools.indexOf(pool)] * 12n) / 10n;
    const sellBound = best.trip.sellSqrt;
    const buyBound = best.trip.buySqrt;
    transactions = [
      swapTx({ pool: best.sell.address, zeroForOne: true, amountSpecified: amountRaw, sqrtPriceLimitX96: sellBound, nonce, gas: gasFor(best.sell), gasPrice }),
      swapTx({ pool: best.buy.address, zeroForOne: false, amountSpecified: -amountRaw, sqrtPriceLimitX96: buyBound, nonce: nonce + 1n, gas: gasFor(best.buy), gasPrice }),
    ];
  }
  return base(t, {
    ...common,
    decision,
    reason,
    sell: best.sell.name,
    buy: best.buy.name,
    gross: money(best.trip.gross),
    costs: { fee: money(best.trip.feeCost), slippage: money(best.trip.slippage), gas: money(gasUsdc) },
    net: money(net),
    transactions,
  });
}

function swapTx({ pool, zeroForOne, amountSpecified, sqrtPriceLimitX96, nonce, gas, gasPrice }) {
  return {
    from: SAMPLE,
    to: pool,
    data: encodePoolSwap({ recipient: SAMPLE, zeroForOne, amountSpecified, sqrtPriceLimitX96 }),
    value: "0x0",
    gas: hex(gas),
    gasPrice: hex(gasPrice),
    nonce: hex(nonce),
    chainId: hex(CHAIN_ID),
    type: "0x0",
  };
}

export async function scanRequest({ amount, min, lang }) {
  const t = TEXT[lang === "pt" ? "pt" : "en"];
  const amountRaw = parseUnits(amount, 18);
  const minRaw = parseUnits(min, 6);
  if (amountRaw === null) return reject(t, t.badAmount);
  if (amountRaw === 0n) return reject(t, t.zero);
  if (minRaw === null) return reject(t, t.badMin);
  try {
    const market = await readMarket();
    const first = evaluateScan({ amount, min, ...market, lang });
    if (first.decision !== "prepare") return first;
    return evaluateScan({ amount, min, ...market, nonce: await nextNonce(SAMPLE), lang });
  } catch (error) {
    return reject(t, t.unread);
  }
}

export async function record(entry) {
  const dir = new URL("../data/", import.meta.url);
  await mkdir(dir, { recursive: true });
  await appendFile(new URL("scans.jsonl", dir), `${JSON.stringify(entry)}\n`);
}
