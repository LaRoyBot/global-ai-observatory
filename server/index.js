// Global AI Observatory — HTTP server (Node built-ins only, zero dependencies).
// Serves the modular front end, the JSON API, and deep links via SPA fallback.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { config, ROOT } from "./config.js";
import { openDatabase } from "./db.js";
import { handleApi, sendJson } from "./api.js";
import { seed } from "./jobs/seed.js";
import { runIngestion } from "./jobs/ingest.js";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".map": "application/json", ".md": "text/markdown; charset=utf-8"
};

// Static allowlist — no directory traversal, no accidental exposure of server code or .env.
function resolveStatic(pathname) {
  const clean = decodeURIComponent(pathname).replace(/\0/g, "");
  if (clean.includes("..")) return null;
  if (clean === "/" || clean === "/index.html") return path.join(ROOT, "public", "index.html");
  if (clean === "/legacy" || clean === "/legacy/index.html") return path.join(ROOT, "index.html");
  const prefixes = ["/src/", "/vendor/", "/data/reference/", "/data/synthetic/", "/docs/", "/public/"];
  const hit = prefixes.find(p => clean.startsWith(p));
  if (!hit) return null;
  const rel = hit === "/public/" ? clean.slice("/public".length) : clean;
  const base = hit === "/vendor/" ? path.join(ROOT, "public", "vendor") : ROOT;
  const file = path.join(base, rel);
  if (!file.startsWith(base)) return null;
  return file;
}

function serveFile(res, file) {
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return false;
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "content-length": stat.size,
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=300",
      "x-content-type-options": "nosniff"
    });
    fs.createReadStream(file).pipe(res);
    return true;
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  res.setHeader("x-frame-options", "SAMEORIGIN");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  if (url.pathname.startsWith("/api/")) {
    if (!url.pathname.startsWith("/api/v1/")) return sendJson(res, 404, { error: { code: "not_found", message: "Unknown API version" } });
    return handleApi(req, res, url);
  }
  if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: { code: "method_not_allowed", message: "Static resources are read-only" } });
  const file = resolveStatic(url.pathname);
  if (file && fs.existsSync(file) && fs.statSync(file).isFile()) return serveFile(res, file);
  // Deep links (/flows, /countries/IND, ...) resolve to the application shell.
  const shell = path.join(ROOT, "public", "index.html");
  if (fs.existsSync(shell)) return serveFile(res, shell);
  return sendJson(res, 503, { error: { code: "shell_missing", message: "Application shell not built yet (public/index.html missing)." } });
});

async function main() {
  openDatabase(config.databasePath);
  const seedReport = await seed({ quiet: false });
  console.log("[seed] " + JSON.stringify(seedReport.counts));
  if (seedReport.gaps.length) console.warn("[seed] coverage gaps: " + seedReport.gaps.join("; "));
  if (config.ingestOnStart) {
    runIngestion({ reason: "startup" }).then(r => console.log("[ingest] " + JSON.stringify(r.summary))).catch(e => console.error("[ingest] failed", e.message));
  }
  if (config.ingestIntervalMinutes > 0) {
    setInterval(() => runIngestion({ reason: "scheduled" }).catch(e => console.error("[ingest] scheduled failed", e.message)),
      config.ingestIntervalMinutes * 60000).unref();
  }
  server.listen(config.port, config.host, () => {
    console.log("Global AI Observatory running at http://" + config.host + ":" + config.port);
    console.log("Legacy single-file globe preserved at http://" + config.host + ":" + config.port + "/legacy");
  });
}
main().catch(err => { console.error("Startup failed:", err); process.exit(1); });

export { server };
