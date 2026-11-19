// Shared application + geographic state. One source of truth for selection,
// layers and filters so the globe, flat map and every workspace stay in sync.
import { apiGet, apiSend } from "./api.js";

const listeners = new Set();
export const state = {
  selectedCountry: null,
  selectedProvider: null,
  selectedModel: null,
  selectedSite: null,
  activeLayers: ["flows"],
  geoMode: "globe",            // globe | flat
  evidenceFilter: "all",       // all | verified | estimated | synthetic
  period: null,
  lowPower: false,
  reducedMotion: false,
  autoRotate: true,
  prefs: {},
  config: null,
  overview: null
};

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(reason) { for (const fn of [...listeners]) { try { fn(state, reason); } catch (err) { console.error("[state] listener", err); } } }
export function patch(partial, reason = "patch") { Object.assign(state, partial); emit(reason); }

export function selectCountry(iso3, reason = "select-country") {
  state.selectedCountry = iso3 || null;
  emit(reason);
}
export function setLayerVisible(id, visible) {
  const set = new Set(state.activeLayers);
  if (visible) set.add(id); else set.delete(id);
  state.activeLayers = [...set];
  emit("layers");
}

const PREF_KEY = "observatory.prefs.v1";
export function loadLocalPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || "{}"); } catch { return {}; }
}
export function saveLocalPrefs(prefs) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {}
}
export async function loadPrefs() {
  const local = loadLocalPrefs();
  const res = await apiGet("/settings", { ttlMs: 0 });
  const remote = res.ok && res.data ? res.data : {};
  state.prefs = Object.assign({}, remote, local);
  if (state.prefs.lowPower != null) state.lowPower = !!state.prefs.lowPower;
  if (state.prefs.geoMode) state.geoMode = state.prefs.geoMode;
  if (state.prefs.evidenceFilter) state.evidenceFilter = state.prefs.evidenceFilter;
  if (Array.isArray(state.prefs.activeLayers)) state.activeLayers = state.prefs.activeLayers;
  return state.prefs;
}
export async function savePrefs(partial) {
  state.prefs = Object.assign({}, state.prefs, partial);
  saveLocalPrefs(state.prefs);
  emit("prefs");
  await apiSend("/settings", "PUT", state.prefs);
}
export function announce(msg) {
  const n = document.getElementById("sr-status");
  if (n) n.textContent = msg;
}
