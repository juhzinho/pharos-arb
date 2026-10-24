import { scanRequest } from "../lib/scan.js";

export default async function handler(req, res) {
  const q = new URL(req.url, "http://localhost").searchParams;
  const out = await scanRequest({
    amount: q.get("amount") || "",
    min: q.get("min") || "",
    lang: q.get("lang") === "pt" ? "pt" : "en",
  });
  res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }).end(JSON.stringify(out));
}
