import { POOL_CONFIG } from "./config.js";
import { buttonLabel, EXAMPLES } from "./examples.js";

const KEY = "pharos-arb-log";
const $ = (id) => document.getElementById(id);
const copy = {
  en: {
    kicker: "Arbitrage",
    title: "Two prices. One net.",
    lead: "One scan reads the two WPROS/USDC pools in the same block. Fees, in-tick slippage and the gas of the latest single swap on each pool come off the spread. Two unsigned pool swaps are prepared only when the net is above the minimum.",
    gasNote: "Gas from the latest single swap on each pool. PROS is priced with the 0.01% pool, because WPROS is wrapped PROS.",
    amount: "WPROS to move",
    min: "Minimum net USDC",
    go: "Scan",
    reading: "Reading the two pools…",
    failed: "The pools could not be read.",
    log: "Scan log",
    gross: "Gross",
    fee: "Fee",
    slip: "Slippage",
    gas: "Gas",
    net: "Net",
    sell: "Sell",
    buy: "Buy",
    block: "Block",
  },
  pt: {
    kicker: "Arbitragem",
    title: "Dois preços. Um líquido.",
    lead: "Uma leitura olha as duas pools de WPROS/USDC no mesmo bloco. Taxa, deslizamento dentro do tick e o gás da última troca única de cada pool saem do spread. Duas trocas sem assinatura na própria pool só são preparadas quando o líquido fica acima do mínimo.",
    gasNote: "Gás da última troca única de cada pool. O PROS usa o preço da pool 0,01%, porque WPROS é PROS embrulhado.",
    amount: "WPROS a mover",
    min: "Líquido mínimo em USDC",
    go: "Ler",
    reading: "Lendo as duas pools…",
    failed: "As pools não puderam ser lidas.",
    log: "Registro das leituras",
    gross: "Bruto",
    fee: "Taxa",
    slip: "Deslizamento",
    gas: "Gás",
    net: "Líquido",
    sell: "Vender",
    buy: "Comprar",
    block: "Bloco",
  },
};

let lang = localStorage.getItem("pharos-arb-lang") === "pt" ? "pt" : "en";
let current = null;

function t() {
  return copy[lang];
}

function paint() {
  const text = t();
  $("kicker").textContent = text.kicker;
  $("title").textContent = text.title;
  $("lead").textContent = text.lead;
  const lines = [
    ...POOL_CONFIG.map((pool) => lang === "pt"
      ? `Pool ${pool.name.replace(".", ",")} · taxa ${pool.feePips} · espaçamento ${pool.spacing} · ${pool.address}`
      : `${pool.name} pool · fee ${pool.feePips} · spacing ${pool.spacing} · ${pool.address}`),
    text.gasNote,
  ];
  $("rules").replaceChildren(...lines.map((line) => {
    const span = document.createElement("span");
    span.textContent = line;
    return span;
  }));
  $("amountL").textContent = text.amount;
  $("minL").textContent = text.min;
  $("go").textContent = text.go;
  $("logLabel").textContent = text.log;
  document.documentElement.lang = lang;
  for (const button of document.querySelectorAll(".lang button")) button.classList.toggle("on", button.dataset.lang === lang);
  $("chips").replaceChildren(...EXAMPLES.map((row) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.ex = row.id;
    button.textContent = buttonLabel(row, lang);
    button.classList.toggle("on", $("amount").value === row.amount && $("min").value === row.min);
    return button;
  }));
  renderLog();
  if (current) show(current);
}

function entries() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(saved) ? saved.filter(real) : [];
  } catch {
    return [];
  }
}

function real(entry) {
  return entry && (entry.decision === "prepare" || entry.decision === "skip") && entry.executed === false && entry.broadcast === false && entry.sources?.length === 2;
}

function line(label, value) {
  const p = document.createElement("p");
  p.className = "detail";
  p.textContent = `${label} ${value}`;
  return p;
}

function card(entry) {
  const text = t();
  const box = document.createElement("article");
  box.className = `msg ${entry.decision}`;
  const title = document.createElement("b");
  title.textContent = entry.headline;
  const reason = document.createElement("p");
  reason.textContent = entry.reason;
  box.append(title, reason);
  box.append(line(text.block, entry.block));
  for (const source of entry.sources) box.append(line(source.name, `${source.price} USDC`));
  if (entry.sell) box.append(line(text.sell, entry.sell), line(text.buy, entry.buy));
  box.append(line(text.gross, entry.gross ?? "—"));
  box.append(line(text.fee, entry.costs?.fee ?? "—"));
  box.append(line(text.slip, entry.costs?.slippage ?? "—"));
  box.append(line(text.gas, entry.costs?.gas ?? "—"));
  box.append(line(text.net, entry.net ?? "—"));
  box.append(line("executed", "false"));
  box.append(line("broadcast", "false"));
  return box;
}

function renderLog() {
  $("log").replaceChildren(...entries().map(card));
}

function remember(entry) {
  const next = [entry, ...entries()].slice(0, 20);
  localStorage.setItem(KEY, JSON.stringify(next));
  renderLog();
}

function show(entry) {
  current = entry;
  $("status").textContent = "";
  const box = card(entry);
  if (entry.transactions) {
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(entry.transactions, null, 2);
    box.append(pre);
  }
  $("out").replaceChildren(box);
}

$("chips").addEventListener("click", (event) => {
  const button = event.target.closest("[data-ex]");
  if (!button) return;
  const row = EXAMPLES.find((item) => item.id === button.dataset.ex);
  $("amount").value = row.amount;
  $("min").value = row.min;
  paint();
});

for (const button of document.querySelectorAll(".lang button")) {
  button.addEventListener("click", () => {
    lang = button.dataset.lang;
    localStorage.setItem("pharos-arb-lang", lang);
    paint();
  });
}

$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("go").disabled = true;
  $("status").textContent = t().reading;
  $("out").replaceChildren();
  try {
    const query = new URLSearchParams({ amount: $("amount").value.trim(), min: $("min").value.trim(), lang });
    const res = await fetch(`/api/scan?${query}`);
    const data = await res.json();
    if (!real(data)) {
      $("status").textContent = data.reason || data.headline || "";
      return;
    }
    show(data);
    remember(data);
  } catch {
    $("status").textContent = t().failed;
  } finally {
    $("go").disabled = false;
  }
});

paint();
