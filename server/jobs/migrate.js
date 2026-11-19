// Standalone migration runner: node server/jobs/migrate.js
import { config } from "../config.js";
import { openDatabase, migrate, closeDatabase } from "../db.js";
const db = openDatabase(config.databasePath);
const applied = migrate(db);
console.log("Migrations present:", applied.join(", "));
console.log("Database:", config.databasePath);
closeDatabase();
