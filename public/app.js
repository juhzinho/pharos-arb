import { POOL_CONFIG } from "./config.js";
import { buttonLabel, EXAMPLES } from "./examples.js";

const KEY = "pharos-arb-log";
const $ = (id) => document.getElementById(id);
const copy = {
  en: {
    kicker: "Arbitrage",
    title: "Two prices. One net.",
    lead: "One scan reads the 0.01% and 0.30% WPROS/USDC pools in the same block. Swap fees, in-tick slippage and the gas of the latest single swap on each pool are subtracted from the spread. Two unsigned pool swaps are prepared only when the net is above the minimum.",
    gasNote: "Gas is taken from the latest single swap on each pool. Native PROS is priced from the 0.01% pool, because WPROS is wrapped PROS.",
    pool: (name, spacing, address) => `${name} FaroSwap · tick spacing ${spacing} · ${address}`,
    amount: "WPROS to move",
    min: "Minimum net USDC",
    go: "Scan",
    reading: "Reading the two pools…",
    failed: "The pools could not be read.",
    log: "Scan log",
    empty: "No scans stored yet.",
    gross: "Gross",
    fee: "Fee",
    slip: "Slippage",
    gas: "Gas",
    net: "Net",
    sell: "Sell",
    buy: "Buy",
    block: "Block",
    at: "Time",
    other: "Other way",
    light: "Light",
    dark: "Dark",
    skip: "Skip",
    prepare: "Prepare",
    usdc: "USDC",
    headSkip: "Skip this scan.",
    headGo: "Prepare the two swaps.",
    tick: (amount, name) => `${amount} WPROS does not stay inside the ${name} pool tick, so slippage cannot be estimated.`,
    both: (amount) => `${amount} WPROS does not stay inside either pool tick, so slippage cannot be estimated.`,
    noGas: "A recent single swap was not found, so gas was not measured.",
    below: (net, min) => `Net ${net} USDC is not above ${min} USDC.`,
    above: (net, min) => `Net ${net} USDC is above ${min} USDC. Two unsigned swaps are ready. Nothing was broadcast.`,
  },
  pt: {
    kicker: "Arbitragem",
    title: "Dois preços. Um líquido.",
    lead: "Um escaneamento lê as pools de 0,01% e 0,30% de WPROS/USDC no mesmo bloco. A taxa da pool, o deslizamento no tick e o gás da última troca única de cada pool saem do spread. Prepara duas trocas sem assinatura só quando o líquido fica acima do mínimo.",
    gasNote: "O gás vem da última troca única de cada pool. O PROS nativo usa o preço da pool de 0,01%, porque o WPROS é o PROS envelopado.",
    pool: (name, spacing, address) => `${name} FaroSwap · espaçamento de tick ${spacing} · ${address}`,
    amount: "WPROS a mover",
    min: "Líquido mínimo em USDC",
    go: "Escanear",
    reading: "Escaneando as duas pools…",
    failed: "As pools não puderam ser lidas.",
    log: "Escaneamentos",
    empty: "Ainda não há escaneamentos guardados.",
    gross: "Bruto",
    fee: "Taxa",
    slip: "Deslizamento",
    gas: "Gás",
    net: "Líquido",
    sell: "Vender",
    buy: "Comprar",
    block: "Bloco",
    at: "Hora",
    other: "O outro lado",
    light: "Claro",
    dark: "Escuro",
    skip: "Pular",
    prepare: "Preparar",
    usdc: "USDC",
    headSkip: "Pular este escaneamento.",
    headGo: "Preparar as duas trocas.",
    tick: (amount, name) => `${amount} WPROS não cabe no tick da pool ${name}, então o deslizamento não pode ser estimado.`,
    both: (amount) => `${amount} WPROS não cabe no tick de nenhuma das duas pools, então o deslizamento não pode ser estimado.`,
    noGas: "Não há uma troca única recente, então o gás não foi medido.",
    below: (net, min) => `O líquido de ${net} USDC não está acima de ${min} USDC.`,
    above: (net, min) => `O líquido de ${net} USDC está acima de ${min} USDC. Duas trocas sem assinatura estão prontas. Nada foi enviado.`,
  },
};

let lang = localStorage.getItem("pharos-arb-lang") === "pt" ? "pt" : "en";
let theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
let current = null;

function t() {
  return copy[lang];
}

function shortAddr(value) {
  const raw = String(value || "");
  if (raw.length < 12) return raw;
  return `${raw.slice(0, 6)}…${raw.slice(-4)}`;
}

function poolName(name) {
  const raw = String(name || "");
  return lang === "pt" ? raw.replace(".", ",") : raw.replace(",", ".");
}

function headlineOf(entry) {
  return entry.decision === "prepare" ? t().headGo : t().headSkip;
}

function reasonOf(entry) {
  const text = t();
  if (entry.why === "tick") return text.tick(entry.amount, poolName(entry.limited || ""));
  if (entry.why === "both") return text.both(entry.amount);
  if (entry.why === "no-gas") return text.noGas;
  if (entry.why === "above") return text.above(entry.net, entry.min);
  if (entry.why === "below") return text.below(entry.net, entry.min);
  if (entry.net != null) return entry.decision === "prepare" ? text.above(entry.net, entry.min) : text.below(entry.net, entry.min);
  if (entry.costs?.gas == null && entry.sell) return text.noGas;
  const saved = String(entry.reason || "");
  if (/0[.,]01%/.test(saved) && /tick|deslizamento/.test(saved)) return text.tick(entry.amount, poolName("0.01%"));
  if (/0[.,]30%/.test(saved) && /tick|deslizamento/.test(saved)) return text.tick(entry.amount, poolName("0.30%"));
  if (/either pool tick|nenhuma das duas/.test(saved)) return text.both(entry.amount);
  return saved;
}

function clock(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function usdc(value) {
  if (value == null || value === "—") return "—";
  return `${value} ${t().usdc}`;
}

function applyTheme() {
  if (theme === "light") document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
  localStorage.setItem("pharos-arb-theme", theme);
  for (const button of document.querySelectorAll(".theme [data-theme]")) {
    button.textContent = button.dataset.theme === "dark" ? t().dark : t().light;
    button.classList.toggle("on", button.dataset.theme === theme);
  }
}

function paint() {
  const text = t();
  $("kicker").textContent = text.kicker;
  $("title").textContent = text.title;
  $("lead").textContent = text.lead;
  const lines = [
    ...POOL_CONFIG.map((pool) => text.pool(poolName(pool.name), pool.spacing, shortAddr(pool.address))),
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
  applyTheme();
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

function meter(label, value) {
  const box = document.createElement("div");
  const name = document.createElement("i");
  name.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = value;
  box.append(name, strong);
  return box;
}

function card(entry) {
  const text = t();
  const box = document.createElement("article");
  box.className = `msg ${entry.decision}`;
  const title = document.createElement("b");
  title.textContent = headlineOf(entry);
  const reason = document.createElement("p");
  reason.textContent = reasonOf(entry);
  box.append(title, reason);
  const meters = document.createElement("div");
  meters.className = "meters";
  meters.append(
    meter(text.gross, usdc(entry.gross)),
    meter(text.fee, usdc(entry.costs?.fee)),
    meter(text.slip, usdc(entry.costs?.slippage)),
    meter(text.gas, usdc(entry.costs?.gas)),
    meter(text.net, usdc(entry.net)),
    meter("executed", "false"),
    meter("broadcast", "false"),
  );
  box.append(meters);
  box.append(line(text.block, entry.block));
  if (entry.at) box.append(line(text.at, clock(entry.at)));
  for (const source of entry.sources) box.append(line(poolName(source.name), usdc(source.price)));
  if (entry.sell) box.append(line(text.sell, poolName(entry.sell)), line(text.buy, poolName(entry.buy)));
  if (entry.other) {
    box.append(line(text.other, `${poolName(entry.other.sell)} → ${poolName(entry.other.buy)} · ${usdc(entry.other.net)}`));
  }
  return box;
}

function sameScan(left, right) {
  return left && right && left.block === right.block && left.at === right.at && left.amount === right.amount && left.net === right.net;
}

function historyCard(entry, index) {
  const text = t();
  const item = document.createElement("button");
  item.type = "button";
  item.className = `check ${entry.decision}`;
  item.dataset.i = String(index);
  if (sameScan(current, entry)) item.classList.add("on");
  const title = document.createElement("strong");
  title.textContent = `${headlineOf(entry)} · ${usdc(entry.net ?? "—")}`;
  const meta = document.createElement("span");
  meta.textContent = `${entry.amount} WPROS · ${text.block} ${entry.block}`;
  const flag = document.createElement("em");
  flag.textContent = entry.decision === "prepare" ? text.prepare : text.skip;
  item.append(title, meta, flag);
  return item;
}

function renderLog() {
  const rows = entries();
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "detail";
    empty.textContent = t().empty;
    $("log").replaceChildren(empty);
    return;
  }
  $("log").replaceChildren(...rows.map((entry, index) => historyCard(entry, index)));
}

function remember(entry) {
  const next = [entry, ...entries()].slice(0, 20);
  localStorage.setItem(KEY, JSON.stringify(next));
  renderLog();
}

function revealCard() {
  const run = () => {
    const dock = document.querySelector(".dock");
    const top = document.querySelector(".dock-top");
    const out = $("out");
    if (!dock || !top || !out?.firstElementChild) return;
    const gap = out.getBoundingClientRect().top - top.getBoundingClientRect().bottom;
    if (gap < 8) dock.scrollTop += gap - 12;
  };
  requestAnimationFrame(() => requestAnimationFrame(run));
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
  revealCard();
}

$("log").addEventListener("click", (event) => {
  const row = event.target.closest(".check");
  if (!row) return;
  const entry = entries()[Number(row.dataset.i)];
  if (!entry) return;
  if (entry.amount) $("amount").value = entry.amount;
  if (entry.min != null) $("min").value = String(entry.min).replace(/\.0+$/, "") || "0";
  current = entry;
  paint();
  revealCard();
});

$("chips").addEventListener("click", (event) => {
  const button = event.target.closest("[data-ex]");
  if (!button) return;
  const row = EXAMPLES.find((item) => item.id === button.dataset.ex);
  $("amount").value = row.amount;
  $("min").value = row.min;
  paint();
});

for (const button of document.querySelectorAll(".theme [data-theme]")) {
  button.addEventListener("click", () => {
    theme = button.dataset.theme === "light" ? "light" : "dark";
    applyTheme();
  });
}

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
