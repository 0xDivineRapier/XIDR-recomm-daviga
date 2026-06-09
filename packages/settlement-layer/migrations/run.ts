// Run all migrations in order. Safe to run multiple times (idempotent SQL).
// Usage: node --import tsx/esm migrations/run.ts

import { readFileSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://idrx:idrx@localhost:5432/idrx_settlement";

const pool = new pg.Pool({ connectionString: DATABASE_URL });

const files = readdirSync(__dirname)
  .filter((f) => f.endsWith(".sql"))
  .sort();

for (const file of files) {
  const sql = readFileSync(path.join(__dirname, file), "utf-8");
  console.log(`Running migration: ${file}`);
  await pool.query(sql);
  console.log(`  ✓ ${file}`);
}

await pool.end();
console.log("All migrations applied.");
