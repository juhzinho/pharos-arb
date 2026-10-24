const Q96 = 2n ** 96n;
const MAX_TICK = 887272;

const TICK_BITS = [
  [0x1n, 0xfffcb933bd6fad37aa2d162d1a594001n],
  [0x2n, 0xfff97272373d413259a46990580e213an],
  [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn],
  [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
  [0x10n, 0xffcb9843d60f6159c9db58835c926644n],
  [0x20n, 0xff973b41fa98c081472e6896dfb254c0n],
  [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
  [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n],
  [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
  [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
  [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n],
  [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n],
  [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
  [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n],
  [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n],
  [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
  [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
  [0x20000n, 0x5d6af8dedb81196699c329225ee604n],
  [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
  [0x80000n, 0x48a170391f7dc42444e8fa2n],
];

export function getSqrtRatioAtTick(tick) {
  const n = Number(tick);
  if (!Number.isInteger(n) || n < -MAX_TICK || n > MAX_TICK) throw new Error("tick out of range");
  const abs = n < 0 ? -n : n;
  let ratio = (abs & 0x1) !== 0 ? TICK_BITS[0][1] : 0x100000000000000000000000000000000n;
  for (let i = 1; i < TICK_BITS.length; i++) {
    if ((abs & Number(TICK_BITS[i][0])) !== 0) ratio = (ratio * TICK_BITS[i][1]) >> 128n;
  }
  if (n > 0) ratio = (2n ** 256n - 1n) / ratio;
  const round = ratio % 2n ** 32n === 0n ? 0n : 1n;
  return (ratio >> 32n) + round;
}

function floorDiv(a, b) {
  const q = a / b;
  return a < 0n && a % b !== 0n ? q - 1n : q;
}

export function tickBounds(tick, spacing) {
  const lower = floorDiv(BigInt(tick), BigInt(spacing)) * BigInt(spacing);
  return { lower, upper: lower + BigInt(spacing) };
}

function divUp(a, b) {
  return a === 0n ? 0n : (a + b - 1n) / b;
}

export function spotUsdc6PerWpros(sqrtPriceX96) {
  const sqrt = BigInt(sqrtPriceX96);
  return (sqrt * sqrt * 10n ** 18n) / 2n ** 192n;
}

export function quoteSellWpros({ sqrtPriceX96, liquidity, tick, spacing, feePips, amountIn }) {
  const sqrt = BigInt(sqrtPriceX96);
  const fee = (amountIn * BigInt(feePips)) / 1_000_000n;
  const next = (BigInt(liquidity) * Q96 * sqrt) / (BigInt(liquidity) * Q96 + (amountIn - fee) * sqrt);
  const limit = getSqrtRatioAtTick(tickBounds(tick, spacing).lower);
  if (next < limit || next >= sqrt) return { complete: false };
  return { complete: true, amountOut: (BigInt(liquidity) * (sqrt - next)) / Q96, sqrtNext: next };
}

export function quoteBuyWpros({ sqrtPriceX96, liquidity, tick, spacing, feePips, amountOut }) {
  const sqrt = BigInt(sqrtPriceX96);
  const den = BigInt(liquidity) * Q96 - amountOut * sqrt;
  if (den <= 0n) return { complete: false };
  const next = (BigInt(liquidity) * Q96 * sqrt) / den;
  const limit = getSqrtRatioAtTick(tickBounds(tick, spacing).upper);
  if (next > limit || next <= sqrt) return { complete: false };
  const beforeFee = divUp(BigInt(liquidity) * (next - sqrt), Q96);
  return { complete: true, amountIn: divUp(beforeFee * 1_000_000n, 1_000_000n - BigInt(feePips)), sqrtNext: next };
}

export function roundTrip(high, low, amountWpros) {
  const sell = quoteSellWpros({ ...high, amountIn: amountWpros });
  const buy = quoteBuyWpros({ ...low, amountOut: amountWpros });
  if (!sell.complete || !buy.complete) return { complete: false, sellLimited: !sell.complete, buyLimited: !buy.complete, sellSqrt: sell.sqrtNext ?? null, buySqrt: buy.sqrtNext ?? null };
  const sellSpot = (amountWpros * spotUsdc6PerWpros(high.sqrtPriceX96)) / 10n ** 18n;
  const buySpot = divUp(amountWpros * spotUsdc6PerWpros(low.sqrtPriceX96), 10n ** 18n);
  const gross = sellSpot - buySpot;
  const sellAfterFee = (sellSpot * (1_000_000n - BigInt(high.feePips))) / 1_000_000n;
  const buyAfterFee = divUp(buySpot * 1_000_000n, 1_000_000n - BigInt(low.feePips));
  const feeOnly = sellAfterFee - buyAfterFee;
  const quoted = sell.amountOut - buy.amountIn;
  return {
    complete: true,
    gross,
    feeCost: gross - feeOnly,
    slippage: feeOnly - quoted,
    quoted,
    sellOut: sell.amountOut,
    buyIn: buy.amountIn,
    sellSqrt: sell.sqrtNext,
    buySqrt: buy.sqrtNext,
  };
}

export function gasToUsdc6(gasUnits, gasPriceWei, priceUsdc6PerWpros) {
  return (BigInt(gasUnits) * BigInt(gasPriceWei) * BigInt(priceUsdc6PerWpros)) / 10n ** 18n;
}

export function decide({ quoted, gasUsdc6, minUsdc6 }) {
  const net = quoted - gasUsdc6;
  return { net, decision: net > minUsdc6 ? "prepare" : "skip" };
}
