// Workspace — Data Sources & System Health.
// Operational health is derived from retrieval outcomes, never from configuration.
import * as ui from "../components/ui.js";
import { apiGet } from "../app/api.js";
import { navigate } from "../app/router.js";
import { fmtDateTime } from "../shared/formatting.js";

function mdToHtml(md) {
  const esc = ui.h(md);
  return esc.split(/\n{2,}/).map(block => {
    const lines = block.split("\n");
    if (/^#{1,4}\s/.test(lines[0])) {
      const level = Math.min(lines[0].match(/^#+/)[0].length + 2, 6);
      return "<h" + level + ' class="md-h">' + lines[0].replace(/^#+\s/, "") + "</h" + level + ">" +
        (lines.length > 1 ? '<p class="md-p">' + lines.slice(1).join("<br>") + "</p>" : "");
    }
    if (lines.every(l => /^[-*]\s/.test(l))) return '<ul class="md-ul">' + lines.map(l => "<li>" + l.replace(/^[-*]\s/, "") + "</li>").join("") + "</ul>";
    return '<p class="md-p">' + lines.join("<br>") + "</p>";
  }).join("").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
}
const STATUS_LABEL = { available: "available", partial: "partial", failed: "failed", unknown: "never run", configured: "configured", never_run: "never run", stale: "stale", degraded: "degraded", unavailable: "unavailable" };
function sourceStatus(s) {
  const label = STATUS_LABEL[s] || s || "unknown";
  return '<span class="badge ' + ui.h(s || "unknown") + '" title="Operational status derived from retrieval outcomes"><span class="bdot"></span>' + ui.h(label) + "</span>";
}

export async function mount(ctx) {
  const main = document.getElementById("main");
  main.innerHTML = '<div class="workspace" data-screen-label="sources">' +
    ui.workspaceHeader({ title: "Data Sources & System Health", sub: "Every dataset's origin, licence, freshness, limitations and retrieval history. Operational status is derived from actual retrieval outcomes — a configured source is not a healthy source." }) +
    '<div id="src-body">' + ui.loadingBlock("Loading source registry…") + "</div></div>";
  const [srcR, methR, healthR] = await Promise.all([apiGet("/sources", { ttlMs: 0 }), apiGet("/methodology"), apiGet("/health", { ttlMs: 0 })]);
  const body = document.getElementById("src-body");
  const onRetry = e => { if (e.target && e.target.id === "src-retry") navigate("/sources"); };
  document.addEventListener("click", onRetry);
  if (!srcR.ok) { body.innerHTML = ui.errorState(srcR.error, "src-retry"); return { destroy() { document.removeEventListener("click", onRetry); } }; }
  const sources = srcR.data.sources;
  const health = healthR.ok ? healthR.data : null;

  const summary = health ? ui.statRow([
    { label: "Database", value: health.database === "ok" ? "OK" : String(health.database), tone: health.database === "ok" ? "" : "amber" },
    { label: "Sources registered", value: String(sources.length) },
    { label: "Available", value: String(sources.filter(s => s.status === "available").length), tone: "green" },
    { label: "Never run", value: String(sources.filter(s => !s.last_attempt_at).length), tone: "amber", sub: "configured ≠ healthy" },
    { label: "Failed / partial", value: String(sources.filter(s => ["failed", "partial", "stale", "degraded"].includes(s.status)).length), tone: "estimated" },
  ]) : "";

  const cards = sources.map(s => {
    const limitations = Array.isArray(s.limitations) ? s.limitations : [];
    const datasets = Array.isArray(s.datasets) ? s.datasets : [];
    const runs = Array.isArray(s.runs) ? s.runs : [];
    return ui.panel({
      title: s.name,
      tools: sourceStatus(s.status) + ui.freshnessBadge(s.freshness) + ui.availabilityBadge(s.availability),
      link: s.url ? { href: s.url, label: "Official source" } : null,
      body: ui.kv([
        ["Owner", s.owner || "—"],
        ["Access method", s.access_method || "—"],
        ["Licence", s.license || "—"],
        ["Attribution", s.attribution || "—"],
        ["Granularity", s.granularity || "—"],
        ["Update frequency", s.update_frequency || "—"],
        ["Rate limits", s.rate_limit || "none documented"],
        ["Parser version", s.parser_version || "—"],
        ["Last successful retrieval", fmtDateTime(s.last_success_at)],
        ["Last attempted retrieval", fmtDateTime(s.last_attempt_at)],
        ["Records written", String(s.records_written || 0)],
        ["Datasets supplied", datasets.join(", ") || "—"],
      ]) +
      (s.failure_reason ? '<div class="failure-note"><strong>Last failure:</strong> ' + ui.h(s.failure_reason) + "</div>" : "") +
      (limitations.length ? '<div class="limitations"><div class="subhead">Known coverage limitations</div><ul>' + limitations.map(l => "<li>" + ui.h(l) + "</li>").join("") + "</ul></div>" : "") +
      (runs.length ? '<details class="runs"><summary>Recent retrievals (' + runs.length + ")</summary>" + ui.table({ columns: [
        { key: "started_at", label: "Started", render: r => fmtDateTime(r.started_at) },
        { key: "status", label: "Status", render: r => sourceStatus(r.status) },
        { key: "records_written", label: "Written", numeric: true },
        { key: "raw_count", label: "Raw", numeric: true },
        { key: "error", label: "Error", render: r => r.error ? ui.h(String(r.error).slice(0, 140)) : "—" },
      ], rows: runs }) + "</details>" : ui.note("No retrieval runs recorded yet. Run npm run ingest to populate this source.")),
    });
  }).join("");

  const methodology = methR.ok ? methR.data.map(m => ui.panel({
    title: m.title,
    tools: '<span class="mono-note">applies to: ' + ui.h((Array.isArray(m.applies_to) ? m.applies_to : []).join(", ")) + " · updated " + ui.h(String(m.updated_at || "").slice(0, 10)) + "</span>",
    body: '<div class="md-body">' + mdToHtml(m.body_md) + "</div>",
  })).join("") : ui.errorState(methR.error, "src-retry");

  body.innerHTML = summary +
    ui.note("Health indicators come from retrieval outcomes and freshness windows. Content quality (coverage, granularity, comparability) is reported separately through limitations and evidence classes. A source that is merely configured is shown as never-run, not as healthy.") +
    '<div class="grid-2" style="margin-top:14px">' + cards + "</div>" +
    '<div class="section-head"><h2>Methodology</h2><span class="mono-note">published with the platform · versioned in the database</span></div>' +
    '<div class="grid-2">' + methodology + "</div>";

  return { destroy() { document.removeEventListener("click", onRetry); } };
}
