// Application shell: navigation rail, top bar, global search, routing, boot.
import * as router from "./router.js";
import * as store from "./state.js";
import { apiGet } from "./api.js";
import { h, loadingBlock, emptyState } from "../components/ui.js";

const NAV = [
  { href: "/overview", label: "Overview", icon: "M3 12h4l3-7 4 14 3-7h4" },
  { href: "/flows", label: "Token Flows", icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" },
  { href: "/infrastructure", label: "Infrastructure", icon: "M4 20V9l8-5 8 5v11M9 20v-6h6v6" },
  { href: "/economics", label: "Economics", icon: "M4 19V5m0 14h16M8 15l3-4 3 2 4-6" },
  { href: "/adoption", label: "Adoption", icon: "M4 18a8 8 0 0 1 16 0M12 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" },
  { href: "/intelligence", label: "Intelligence", icon: "M5 5h14v14H5zM8 9h8M8 12h8M8 15h5" }
];
const NAV_SECONDARY = [
  { href: "/compare", label: "Compare", icon: "M8 4v16M16 4v16M4 8h8M12 16h8" },
  { href: "/sources", label: "Data Sources", icon: "M12 4c4 0 7 1.3 7 3s-3 3-7 3-7-1.3-7-3 3-3 7-3ZM5 7v10c0 1.7 3 3 7 3s7-1.3 7-3V7" },
  { href: "/settings", label: "Settings", icon: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0-6v2m0 12v2M3 12h2m12 0h2M5.6 5.6l1.4 1.4m9.9 9.9 1.4 1.4m0-12.7-1.4 1.4M7 17l-1.4 1.4" }
];

function navHtml(items) {
  return items.map(it =>
    '<a class="nav-item" data-link href="' + it.href + '" data-nav="' + it.href + '">' +
    '<svg class="nav-ico" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="' + it.icon + '" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
    '<span class="nav-text">' + h(it.label) + "</span></a>").join("");
}

function renderNav() {
  const rail = document.getElementById("rail");
  rail.innerHTML = '<span class="rail-label">Workspaces</span>' + navHtml(NAV) +
    '<span class="rail-label">Systems</span>' + navHtml(NAV_SECONDARY) +
    '<div class="rail-foot">Hybrid data: verified public sources plus clearly-labelled synthetic fixtures.<br><a data-link href="/sources">Source health →</a></div>';
}
function markActive(path) {
  for (const a of document.querySelectorAll("[data-nav]")) {
    const target = a.getAttribute("data-nav");
    const active = path === target || (target !== "/overview" && path.startsWith(target + "/")) || (target === "/overview" && (path === "/" || path === "/overview"));
    if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
}

/* ---------------- global search ---------------- */
let searchTimer = null, searchItems = [], searchIndex = -1;
function openSearch() {
  const d = document.getElementById("search-dialog");
  if (!d.open) d.showModal();
  const input = document.getElementById("search-input");
  input.value = "";
  document.getElementById("search-results").innerHTML = emptyState("Search the observatory", "Countries, providers, models, infrastructure sites, research items and adoption metrics.");
  searchItems = []; searchIndex = -1;
  setTimeout(() => input.focus(), 30);
}
function closeSearch() { const d = document.getElementById("search-dialog"); if (d.open) d.close(); }
function renderSearchResults(groups, query) {
  const box = document.getElementById("search-results");
  searchItems = [];
  if (!groups || !groups.length) {
    box.innerHTML = emptyState("No matches", 'Nothing matched "' + query + '". Try a country name, provider, model or facility.');
    return;
  }
  box.innerHTML = groups.map(g =>
    '<div class="search-group-label">' + h(g.label) + "</div>" +
    g.results.map(r => {
      searchItems.push(r);
      const i = searchItems.length - 1;
      return '<button class="search-item" data-search-index="' + i + '"><span class="si-title">' + h(r.title) + '</span><span class="si-sub">' + h(r.subtitle || "") + (r.external ? " · external source ↗" : "") + "</span></button>";
    }).join("")).join("");
}
async function runSearch(query) {
  if (!query.trim()) return;
  const res = await apiGet("/search?q=" + encodeURIComponent(query), { ttlMs: 0 });
  if (!res.ok) { document.getElementById("search-results").innerHTML = emptyState("Search unavailable", res.error); return; }
  renderSearchResults(res.data.groups, query);
}
function activateSearchItem(i) {
  const item = searchItems[i];
  if (!item) return;
  closeSearch();
  if (item.external) window.open(item.href, "_blank", "noopener");
  else router.navigate(item.href);
}
function wireSearch() {
  const dialog = document.getElementById("search-dialog");
  const input = document.getElementById("search-input");
  document.getElementById("btn-search").addEventListener("click", openSearch);
  document.getElementById("search-close").addEventListener("click", closeSearch);
  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = input.value;
    searchTimer = setTimeout(() => runSearch(q), 220);
  });
  input.addEventListener("keydown", e => {
    const items = [...document.querySelectorAll(".search-item")];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      searchIndex = e.key === "ArrowDown" ? Math.min(items.length - 1, searchIndex + 1) : Math.max(0, searchIndex - 1);
      items.forEach((n, i) => n.classList.toggle("active", i === searchIndex));
    } else if (e.key === "Enter") {
      e.preventDefault();
      activateSearchItem(searchIndex >= 0 ? searchIndex : 0);
    }
  });
  document.getElementById("search-results").addEventListener("click", e => {
    const btn = e.target.closest("[data-search-index]");
    if (btn) activateSearchItem(Number(btn.getAttribute("data-search-index")));
  });
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openSearch(); }
  });
}

/* ---------------- routes ---------------- */
const W = name => () => import("../workspaces/" + name + ".js");
router.route("/", W("overview"), { title: "Overview" });
router.route("/overview", W("overview"), { title: "Overview" });
router.route("/flows", W("flows"), { title: "AI Token Flows" });
router.route("/infrastructure", W("infrastructure"), { title: "Infrastructure Atlas" });
router.route("/economics", W("economics"), { title: "AI Economics" });
router.route("/adoption", W("adoption"), { title: "AI Adoption Observatory" });
router.route("/intelligence", W("intelligence"), { title: "Intelligence & Research" });
router.route("/sources", W("sources"), { title: "Data Sources & Health" });
router.route("/settings", W("settings"), { title: "Settings" });
router.route("/compare", W("compare"), { title: "Comparison Studio" });
router.route("/countries/:iso", W("country-profile"), { title: "Country Profile" });
router.route("/providers/:slug", W("provider-profile"), { title: "Provider Profile" });
router.route("/models/:slug", W("model-profile"), { title: "Model Profile" });
router.onNotFound(({ path }) => {
  document.getElementById("main").innerHTML =
    '<div class="workspace"><h1 class="ws-title">Not found</h1><p class="ws-sub">No workspace is registered at <span class="mono">' + h(path) + '</span>.</p>' +
    '<p style="margin-top:14px"><a class="btn" data-link href="/overview">Return to Overview</a></p></div>';
  document.getElementById("topbar-title").textContent = "Not found";
});
router.before(ctx => {
  document.getElementById("topbar-title").textContent = ctx.meta.title || "Observatory";
  markActive(ctx.path);
  document.getElementById("main").innerHTML = loadingBlock("LOADING WORKSPACE…");
  document.getElementById("main").scrollTop = 0;
});

/* ---------------- boot ---------------- */
async function boot() {
  renderNav();
  wireSearch();
  document.getElementById("btn-settings").addEventListener("click", () => router.navigate("/settings"));
  const cfg = await apiGet("/config");
  if (cfg.ok) {
    store.state.config = cfg.data;
    if (cfg.data.lowPowerDefault) store.state.lowPower = true;
  }
  store.state.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  await store.loadPrefs();
  const ov = await apiGet("/overview", { ttlMs: 60000 });
  if (ov.ok) store.state.overview = ov.data;
  await router.start();
}
boot().catch(err => {
  console.error("[shell] boot failed", err);
  document.getElementById("main").innerHTML =
    '<div class="workspace"><div class="error-block"><strong>The observatory could not start.</strong> ' + h(err.message || String(err)) +
    "<br>Check that the server is running (npm start) and that the database migrated successfully.</div></div>";
});
