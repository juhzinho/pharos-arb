export const EXAMPLES = [
  { id: "one", amount: "1", min: "0" },
  { id: "hundred", amount: "100", min: "0" },
  { id: "strict", amount: "1", min: "1" },
];

export function buttonLabel(row, lang) {
  return lang === "pt" ? `${row.amount} WPROS, mínimo ${row.min} USDC` : `${row.amount} WPROS, min ${row.min} USDC`;
}
