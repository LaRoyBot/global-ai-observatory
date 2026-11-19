// Reusable UI primitives. Every workspace builds panels from these so the
// design language, provenance indicators and empty/error states stay identical.
import { escapeHtml, fmtCompact, fmtExact, fmtPct, fmtDate, fmtDateTime } from "../shared/formatting.js";

export const h = escapeHtml;
export { fmtCompact, fmtExact, fmtPct, fmtDate, fmtDateTime };

export function evidenceBadge(cls, title) {
  const labels = { measured: "Measured", reported: "Reported", estimated: "Estimated", synthetic: "Synthetic" };
  const c = cls || "reported";
  return '<span class="badge ' + h(c) + '" title="' + h(title || "Evidence class: " + c) + '"><span class="bdot"></span>' + h(labels[c] || c) + "</span>";
}
export function freshnessBadge(f, title) {
  const c = f || "unknown";
  return '<span class="badge ' + h(c) + '" title="' + h(title || "Freshness: " + c) + '"><span class="bdot"></span>' + h(c) + "</span>";
}
export function availabilityBadge(a, title) {
  const c = a || "unavailable";
  return '<span class="badge ' + h(c) + '" title="' + h(title || "Availability: " + c) + '"><span class="bdot"></span>' + h(c) + "</span>";
}
export function statusBadge(s) {
  const c = s || "unknown";
  return '<span class="badge status-' + h(c) + '" title="Facility status: ' + h(c) + '"><span class="bdot"></span>' + h(c.replace(/_/g, " ")) + "</span>";
}
export function provenance(row) {
  return '<span class="tag-row">' + evidenceBadge(row.evidence_class) +
    (row.freshness ? freshnessBadge(row.freshness) : "") +
    (row.source_id ? '<span class="badge" title="Source: ' + h(row.source_id) + '">' + h(row.source_id) + "</span>" : "") + "</span>";
}

export function panel({ title, body, tools = "", link = null, span = 0, id = "" }) {
  const cls = "panel" + (span ? " span" + span : "");
  const linkHtml = link ? '<a class="panel-link" data-link href="' + h(link.href) + '">' + h(link.label) + " →</a>" : "";
  return '<section class="' + cls + '"' + (id ? ' id="' + h(id) + '"' : "") + '>' +
    '<div class="panel-head"><h3 class="panel-title">' + h(title) + '</h3><div class="panel-tools">' + tools + linkHtml + "</div></div>" +
    '<div class="panel-body">' + body + "</div></section>";
}

export function statRow(items) {
  return '<div class="stat-row">' + items.map(it =>
    '<div class="stat"><div class="stat-label">' + h(it.label) + '</div>' +
    '<div class="stat-value ' + (it.tone || "") + '"' + (it.exact != null ? ' title="' + h(fmtExact(it.exact)) + (it.unit ? " " + it.unit : "") + '"' : "") + ">" + h(it.value) + "</div>" +
    (it.sub ? '<div class="stat-sub">' + h(it.sub) + "</div>" : "") + "</div>").join("") + "</div>";
}

export function kv(rows) {
  return '<div class="kv">' + rows.map(r =>
    '<span class="k">' + h(r[0]) + '</span><span class="v ' + (r[2] || "") + '"' + (r[3] != null ? ' title="' + h(r[3]) + '"' : "") + ">" + h(r[1]) + "</span>").join("") + "</div>";
}

export function rankList(rows, { max = null, valueKey = "total", nameKey = "name", shareKey = "share", hrefFn = null, codeKey = "code", barTone = "" } = {}) {
  if (!rows || !rows.length) return emptyState("No observations", "Nothing is recorded for this selection and period. This is a coverage gap, not a zero.");
  const top = max != null ? max : Math.max(...rows.map(r => r[valueKey] || 0), 1);
  return '<ol class="rank-list">' + rows.map((r, i) => {
    const name = r[nameKey] || r[codeKey] || "—";
    const val = r[valueKey] || 0;
    const share = r[shareKey];
    const inner = '<span class="rank-num">' + String(r.rank || i + 1).padStart(2, "0") + "</span>" +
      '<span class="rank-mid"><span class="rank-name">' + h(name) + '</span><span class="bar ' + barTone + '"><span style="width:' + (val / top * 100).toFixed(1) + '%"></span></span></span>' +
      '<span class="rank-right"><span class="rank-val" title="' + h(fmtExact(val)) + '">' + h(fmtCompact(val)) + "</span>" +
      (share != null ? '<span class="rank-share">' + h(fmtPct(share * 100)) + "</span>" : "") + "</span>";
    if (hrefFn) return '<li><a class="rank-row" data-link href="' + h(hrefFn(r)) + '">' + inner + "</a></li>";
    return '<li><button type="button" class="rank-row" data-code="' + h(r[codeKey] || "") + '">' + inner + "</button></li>";
  }).join("") + "</ol>";
}

export function table({ columns, rows, empty = "No records", rowHref = null }) {
  if (!rows || !rows.length) return emptyState("No records", empty);
  const head = "<tr>" + columns.map(c => "<th" + (c.numeric ? ' style="text-align:right"' : "") + ">" + h(c.label) + "</th>").join("") + "</tr>";
  const body = rows.map(r => "<tr>" + columns.map(c => {
    const raw = c.render ? c.render(r) : h(r[c.key] == null ? "—" : String(r[c.key]));
    return "<td" + (c.numeric ? ' class="num"' : "") + ">" + (rowHref ? '<a data-link href="' + h(rowHref(r)) + '">' + raw + "</a>" : raw) + "</td>";
  }).join("") + "</tr>").join("");
  return '<div style="overflow-x:auto"><table class="tbl"><thead>' + head + "</thead><tbody>" + body + "</tbody></table></div>";
}

export function emptyState(title, msg) {
  return '<div class="empty"><strong>' + h(title) + "</strong>" + h(msg || "") + "</div>";
}
export function errorState(message, retryId) {
  return '<div class="error-block"><strong>Source unavailable.</strong> ' + h(message || "Unknown error") +
    "<br>This is a failure state, not a zero value. Other datasets are unaffected." +
    (retryId ? ' <button class="btn sm" id="' + h(retryId) + '" style="margin-top:8px">Retry</button>' : "") + "</div>";
}
export function loadingBlock(text = "LOADING…") {
  return '<div class="loading-block"><span class="spinner"></span>' + h(text) + "</div>";
}
export function note(text) { return '<p class="note">' + h(text) + "</p>"; }

export function tabs(items, activeId, attr = "data-tab") {
  return '<div class="seg" role="tablist">' + items.map(it =>
    '<button role="tab" ' + attr + '="' + h(it.id) + '" aria-pressed="' + (it.id === activeId) + '">' + h(it.label) + "</button>").join("") + "</div>";
}

// Lightweight inline SVG charts — no chart library, no per-frame cost.
export function barChart(series, { width = 320, height = 90, tone = "var(--selected-blue)", labelKey = "label", valueKey = "value" } = {}) {
  if (!series || !series.length) return emptyState("No series", "No observations available for this chart.");
  const max = Math.max(...series.map(s => s[valueKey] || 0), 1);
  const bw = width / series.length;
  const bars = series.map((s, i) => {
    const v = s[valueKey] || 0;
    const bh = Math.max(1, (v / max) * (height - 18));
    return '<rect x="' + (i * bw + bw * 0.18).toFixed(1) + '" y="' + (height - 14 - bh).toFixed(1) + '" width="' + (bw * 0.64).toFixed(1) +
      '" height="' + bh.toFixed(1) + '" fill="' + tone + '" opacity="0.85"><title>' + h(s[labelKey] + ": " + fmtExact(v)) + "</title></rect>" +
      '<text x="' + (i * bw + bw / 2).toFixed(1) + '" y="' + (height - 3) + '" font-size="7.5" fill="var(--text-muted)" text-anchor="middle" font-family="var(--font-mono)">' + h(String(s[labelKey]).slice(0, 7)) + "</text>";
  }).join("");
  return '<svg viewBox="0 0 ' + width + " " + height + '" width="100%" height="' + height + '" role="img" aria-label="Bar chart">' + bars + "</svg>";
}

export function lineChart(points, { width = 320, height = 96, tone = "var(--input-cyan)", valueKey = "value", labelKey = "label" } = {}) {
  if (!points || points.length < 2) return emptyState("Not enough history", "A trend requires at least two dated observations. No history is manufactured.");
  const vals = points.map(p => p[valueKey] || 0);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const coords = points.map((p, i) => [i * step, height - 16 - ((p[valueKey] - min) / span) * (height - 26)]);
  const d = coords.map((c, i) => (i ? "L" : "M") + c[0].toFixed(1) + " " + c[1].toFixed(1)).join(" ");
  const dots = coords.map((c, i) => '<circle cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) + '" r="2.4" fill="' + tone + '"><title>' + h(points[i][labelKey] + ": " + fmtExact(points[i][valueKey])) + "</title></circle>").join("");
  return '<svg viewBox="0 0 ' + width + " " + height + '" width="100%" height="' + height + '" role="img" aria-label="Trend chart">' +
    '<path d="' + d + '" fill="none" stroke="' + tone + '" stroke-width="1.4"/>' + dots +
    '<text x="0" y="' + (height - 3) + '" font-size="7.5" fill="var(--text-muted)" font-family="var(--font-mono)">' + h(points[0][labelKey]) + "</text>" +
    '<text x="' + width + '" y="' + (height - 3) + '" font-size="7.5" fill="var(--text-muted)" text-anchor="end" font-family="var(--font-mono)">' + h(points[points.length - 1][labelKey]) + "</text></svg>";
}

export function splitBar(inputShare, { height = 7 } = {}) {
  const pct = Math.max(0, Math.min(100, inputShare * 100));
  return '<div class="balance-bar" style="height:' + height + 'px" title="Input ' + pct.toFixed(1) + '% / Output ' + (100 - pct).toFixed(1) + '%">' +
    '<span class="in" style="width:' + pct.toFixed(2) + '%"></span><span class="out" style="width:' + (100 - pct).toFixed(2) + '%"></span></div>';
}

export function sourceLink(row, label = "Source") {
  if (!row.source_url) return '<span class="note">' + h(row.source_id || "no source recorded") + "</span>";
  return '<a href="' + h(row.source_url) + '" target="_blank" rel="noopener noreferrer">' + h(label) + " ↗</a>";
}
export function workspaceHeader({ title, sub, actions = "", context = "" }) {
  return '<div class="ws-head"><div><h1 class="ws-title">' + h(title) + '</h1><p class="ws-sub">' + h(sub) + "</p></div>" +
    '<div class="ws-actions">' + actions + "</div></div>" + (context ? '<div class="ws-context">' + context + "</div>" : "");
}
