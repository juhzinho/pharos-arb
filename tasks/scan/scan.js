import { record, scanRequest } from "../../lib/scan.js";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const lang = arg("--lang") === "pt" ? "pt" : "en";
const out = await scanRequest({ amount: arg("--amount", "1"), min: arg("--min", "0"), lang });
if (out.ok) await record(out);
console.log(out.headline);
if (out.sources) {
  for (const source of out.sources) console.log(`${source.name}  ${source.price} USDC`);
  console.log(`gross ${out.gross ?? "—"}`);
  console.log(`fee ${out.costs.fee ?? "—"}  slippage ${out.costs.slippage ?? "—"}  gas ${out.costs.gas ?? "—"}`);
  console.log(`net ${out.net ?? "—"}`);
  console.log(`${out.decision} · ${out.reason}`);
}
console.log("broadcast false");
