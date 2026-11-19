// Environment configuration. Every value is optional; the platform must run
// with no credentials at all. Server-side secrets never reach the client.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");

function loadDotEnv() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}
const env = Object.assign({}, loadDotEnv(), process.env);
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const bool = (v, d) => v == null || v === "" ? d : /^(1|true|yes|on)$/i.test(String(v));

export const config = {
  port: num(env.PORT, 4173),
  host: env.HOST || "127.0.0.1",
  databasePath: path.resolve(ROOT, env.DATABASE_PATH || "./data/observatory.db"),
  ingestOnStart: bool(env.INGEST_ON_START, false),
  ingestIntervalMinutes: num(env.INGEST_INTERVAL_MINUTES, 0),
  ingestTimeoutMs: num(env.INGEST_TIMEOUT_MS, 15000),
  ingestMaxRetries: num(env.INGEST_MAX_RETRIES, 2),
  lowPowerDefault: bool(env.LOW_POWER_DEFAULT, false),
  logLevel: env.LOG_LEVEL || "info",
  // Optional credentials — presence is reported to the client as a boolean only.
  credentials: {
    huggingface: !!env.HUGGINGFACE_TOKEN,
    openrouter: !!env.OPENROUTER_API_KEY,
    newsapi: !!env.NEWSAPI_KEY
  }
};

export function publicConfig() {
  // Safe subset for /api/v1/config — never includes secret values.
  return {
    lowPowerDefault: config.lowPowerDefault,
    credentialsConfigured: config.credentials,
    ingestIntervalMinutes: config.ingestIntervalMinutes,
    version: "2.0.0"
  };
}
