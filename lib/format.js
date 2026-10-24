export function parseUnits(text, decimals) {
  const raw = String(text ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const [whole, frac = ""] = raw.split(".");
  if (frac.length > decimals) return null;
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || 0);
}

export function formatUnits(value, decimals, places = decimals) {
  const neg = value < 0n;
  const raw = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = (raw % base).toString().padStart(decimals, "0").slice(0, places);
  const text = places === 0 ? whole.toString() : `${whole}.${frac}`;
  return neg ? `-${text}` : text;
}

export function hex(value) {
  return `0x${BigInt(value).toString(16)}`;
}
