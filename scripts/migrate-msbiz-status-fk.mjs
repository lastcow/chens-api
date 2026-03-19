import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env");

// Parse DATABASE_URL from .env
const envContent = readFileSync(envPath, "utf-8");
const match = envContent.match(/DATABASE_URL="([^"]+)"/);
if (!match) throw new Error("DATABASE_URL not found in .env");
const DATABASE_URL = match[1];

const sql = neon(DATABASE_URL);

const statements = [
  `UPDATE msbiz_accounts SET status = 'Ready' WHERE status = 'active'`,
  `ALTER TABLE msbiz_accounts ALTER COLUMN status SET DEFAULT 'Ready'`,
  `ALTER TABLE msbiz_accounts ADD COLUMN IF NOT EXISTS status_id TEXT REFERENCES msbiz_statuses(id) ON DELETE SET NULL`,
  `UPDATE msbiz_accounts SET status_id = 'account.' || status`,
  `ALTER TABLE msbiz_accounts DROP COLUMN IF EXISTS status`,
  `ALTER TABLE msbiz_accounts RENAME COLUMN status_id TO status`,
  `ALTER TABLE msbiz_accounts ALTER COLUMN status SET NOT NULL`,
  `ALTER TABLE msbiz_accounts ALTER COLUMN status SET DEFAULT 'account.Ready'`,
];

console.log("Starting migration...");
for (const stmt of statements) {
  console.log("Running:", stmt.substring(0, 80) + (stmt.length > 80 ? "..." : ""));
  await sql.query(stmt);
  console.log("  ✓ OK");
}
console.log("\nMigration complete!");

// Verify
const rows = await sql`SELECT id, status FROM msbiz_accounts LIMIT 5`;
console.log("\nSample rows after migration:");
for (const row of rows) {
  console.log(`  id=${row.id.substring(0, 8)}… status=${row.status}`);
}
