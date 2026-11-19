// SQLite access layer — Node built-in node:sqlite, zero external dependencies.
// Migrations are plain SQL files applied in lexical order and recorded in
// schema_migrations, so the strategy is documented and repeatable.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

let db = null;
let dbPath = null;

export function openDatabase(filePath) {
  if (db && dbPath === filePath) return db;
  if (db) db.close();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  db = new DatabaseSync(filePath);
  dbPath = filePath;
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

export function getDb() {
  if (!db) throw new Error("Database not opened. Call openDatabase(path) first.");
  return db;
}

export function closeDatabase() {
  if (db) { db.close(); db = null; dbPath = null; }
}

export function migrate(database = getDb()) {
  database.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(database.prepare("SELECT version FROM schema_migrations").all().map(r => r.version));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql")).sort();
  const run = database.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)");
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    database.exec("BEGIN");
    try {
      database.exec(sql);
      run.run(file, new Date().toISOString());
      database.exec("COMMIT");
    } catch (err) {
      database.exec("ROLLBACK");
      throw new Error("Migration " + file + " failed: " + err.message);
    }
  }
  return files;
}

// Small helpers used by repositories. node:sqlite returns null-prototype objects;
// plain() converts them so JSON serialization and property access behave normally.
export function plain(row) {
  return row == null ? null : Object.assign({}, row);
}
export function plainAll(rows) {
  return rows.map(plain);
}
export function jsonField(value, fallback) {
  if (value == null || value === "") return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}
