// Workspace — Settings. Persisted preferences, saved views, integration status.
import * as ui from "../components/ui.js";
import { apiGet, apiSend } from "../app/api.js";
import { navigate } from "../app/router.js";
import { state, savePrefs, announce } from "../app/state.js";

function row(label, control, hint) {
  return '<div class="setting-row"><div class="setting-label"><strong>' + ui.h(label) + "</strong>" +
    (hint ? '<span class="setting-hint">' + ui.h(hint) + "</span>" : "") +
    '</div><div class="setting-control">' + control + "</div></div>";
}
function toggle(id, on, label) {
  return '<button class="btn sm" type="button" id="' + id + '" role="switch" aria-checked="' + on + '" aria-pressed="' + on + '" aria-label="' + ui.h(label) + '">' + (on ? "On" : "Off") + "</button>";
}
function setToggle(btn, on) { btn.textContent = on ? "On" : "Off"; btn.setAttribute("aria-pressed", String(on)); btn.setAttribute("aria-checked", String(on)); }

export async function mount(ctx) {
  const main = document.getElementById("main");
  const rm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  main.innerHTML = '<div class="workspace" data-screen-label="settings">' +
    ui.workspaceHeader({ title: "Settings", sub: "Preferences are stored locally and mirrored to the server. No account is required; nothing here is sent to third parties." }) +
    '<div class="grid-2">' +
    ui.panel({ title: "Rendering & motion", body:
      row("Low-power rendering", toggle("set-power", state.lowPower, "Low power"), "Stops auto-rotation and particle motion; the globe stays interactive. Recommended on older hardware.") +
      row("Auto-rotate by default", toggle("set-rotate", state.autoRotate, "Auto rotate"), "Applies when a globe workspace opens. Reduced-motion always overrides this.") +
      row("Default geographic mode", '<select class="input" id="set-mode" aria-label="Default map mode"><option value="globe">Globe</option><option value="flat">Flat map</option></select>', "Used by the overview workspace.") +
      row("Reduced motion (system)", '<span class="mono-note">' + (rm ? "prefers-reduced-motion: reduce" : "no preference") + "</span>", "Read from the operating system. When set, particles and auto-rotation stay off; this cannot be overridden here.") +
      row("Evidence filter", '<select class="input" id="set-evidence" aria-label="Evidence filter"><option value="all">All evidence classes</option><option value="measured">Measured</option><option value="reported">Reported</option><option value="estimated">Estimated</option><option value="synthetic">Synthetic</option></select>', "Stored preference for analytical workspaces. Synthetic data is always labelled regardless of this setting.")
    }) +
    ui.panel({ title: "Panel layout", body:
      ui.note("The overview panel layout (visibility and order) is saved with your preferences and restored on every visit.") +
      '<div class="btn-row"><button class="btn sm" id="set-reset-layout" type="button">Reset overview layout</button><a class="btn sm ghost" data-link href="/">Go to overview</a></div>'
    }) +
    ui.panel({ title: "Saved views", body: '<div id="set-views">' + ui.loadingBlock("Loading saved views…") + "</div>" +
      '<div class="save-view-row"><input class="input" id="set-view-name" type="text" placeholder="Name this view" aria-label="Saved view name" maxlength="60"><button class="btn sm" id="set-view-save" type="button">Save current view</button></div>'
    }) +
    ui.panel({ title: "Integrations & credentials", body: '<div id="set-config">' + ui.loadingBlock("Loading configuration…") + "</div>" }) +
    ui.panel({ title: "Data refresh", body:
      ui.note("Ingestion is a server-side job. Run `npm run ingest` (or `npm run ingest -- --source openrouter`) to refresh public datasets. The platform never fabricates values when a source is unavailable; failures are recorded per source.") +
      '<div class="btn-row"><a class="btn sm" data-link href="/sources">Source health</a><a class="btn sm ghost" data-link href="/legacy">Legacy single-file globe</a></div>'
    }) +
    "</div></div>";

  document.getElementById("set-mode").value = state.geoMode === "flat" ? "flat" : "globe";
  document.getElementById("set-evidence").value = state.evidenceFilter || "all";

  /* saved views */
  const viewsRes = await apiGet("/views", { ttlMs: 0 });
  let views = viewsRes.ok && Array.isArray(viewsRes.data) ? viewsRes.data : [];
  function renderViews() {
    const box = document.getElementById("set-views");
    if (!viewsRes.ok) { box.innerHTML = ui.errorState(viewsRes.error, "set-views-retry"); return; }
    box.innerHTML = views.length ? ui.table({ columns: [
      { key: "name", label: "View", render: r => '<a data-link href="' + ui.h(r.path) + (r.query ? "?" + ui.h(r.query) : "") + '">' + ui.h(r.name) + "</a>" },
      { key: "path", label: "Workspace" },
      { key: "id", label: "", render: r => '<button class="btn sm" type="button" data-del-view="' + r.id + '" aria-label="Delete saved view">Delete</button>' },
    ], rows: views }) : ui.emptyState("No saved views", "Save the current workspace URL as a named view you can return to.");
    for (const b of box.querySelectorAll("[data-del-view]")) b.addEventListener("click", async () => {
      const res = await apiSend("/views/" + b.dataset.delView, "DELETE");
      if (res.ok) { views = views.filter(v => String(v.id) !== String(b.dataset.delView)); renderViews(); announce("Saved view deleted"); }
      else announce("Could not delete view: " + res.error);
    });
  }
  renderViews();
  document.getElementById("set-view-save").addEventListener("click", async () => {
    const name = document.getElementById("set-view-name").value.trim();
    if (!name) { announce("Enter a name for the view"); return; }
    const res = await apiSend("/views", "POST", { name, path: location.pathname, query: location.search.replace(/^\?/, ""), state: { lowPower: state.lowPower, geoMode: state.geoMode } });
    if (res.ok) { views.push(res.data || { id: Date.now(), name, path: location.pathname, query: location.search.replace(/^\?/, "") }); document.getElementById("set-view-name").value = ""; renderViews(); announce("View saved"); }
    else announce("Could not save view: " + res.error);
  });

  /* configuration */
  const cfg = await apiGet("/config", { ttlMs: 0 });
  document.getElementById("set-config").innerHTML = cfg.ok ?
    ui.kv(Object.entries(cfg.data.credentialsConfigured || {}).map(([k, v]) => [k.replace(/_/g, " "), v ? "configured" : "not configured"])) +
    ui.note("Optional tokens improve rate limits only. Every public adapter works without credentials and fails gracefully; a missing token is never treated as missing data. Secret values are never sent to the browser.") +
    ui.kv([["Ingestion interval", cfg.data.ingestIntervalMinutes + " min"], ["API version", cfg.data.version], ["Low-power default", cfg.data.lowPowerDefault ? "on" : "off"]])
    : ui.errorState(cfg.error, "set-retry");

  /* preference controls */
  document.getElementById("set-power").addEventListener("click", e => { state.lowPower = !state.lowPower; setToggle(e.currentTarget, state.lowPower); savePrefs({ lowPower: state.lowPower }); });
  document.getElementById("set-rotate").addEventListener("click", e => { state.autoRotate = !state.autoRotate; setToggle(e.currentTarget, state.autoRotate); savePrefs({ autoRotate: state.autoRotate }); });
  document.getElementById("set-mode").addEventListener("change", e => { state.geoMode = e.target.value; savePrefs({ geoMode: e.target.value }); });
  document.getElementById("set-evidence").addEventListener("change", e => { state.evidenceFilter = e.target.value; savePrefs({ evidenceFilter: e.target.value }); });
  document.getElementById("set-reset-layout").addEventListener("click", () => { savePrefs({ overviewLayout: null }); announce("Overview layout reset"); });
  const onRetry = e => { if (e.target && (e.target.id === "set-retry" || e.target.id === "set-views-retry")) navigate("/settings"); };
  document.addEventListener("click", onRetry);
  return { destroy() { document.removeEventListener("click", onRetry); } };
}
