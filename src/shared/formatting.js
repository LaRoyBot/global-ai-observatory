// Shared numeric/period formatting. One implementation for every workspace so
// abbreviations, exact-value tooltips and percentages stay consistent.
export const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
export function periodLabel(p) { if (!p || typeof p !== "string") return "—"; const [y, m] = p.split("-"); return MONTHS[parseInt(m, 10) - 1] + " " + y; }
export function periodShort(p) { if (!p || typeof p !== "string") return "—"; const [y, m] = p.split("-"); return MONTHS[parseInt(m, 10) - 1].slice(0, 3).toUpperCase() + " " + y; }
export function fmtCompact(n) {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}
export const fmtExact = n => n.toLocaleString("en-US");
export const fmtPct = x => (x >= 9.95 ? x.toFixed(1) : x.toFixed(2)) + "%";
export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
export function fmtInt(n) { return Number(n).toLocaleString("en-US"); }
export function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "2-digit" });
}
export function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-GB", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
