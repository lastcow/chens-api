import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

// Load .env manually
const envFile = new URL("../.env", import.meta.url).pathname;
const envContent = readFileSync(envFile, "utf8");
for (const line of envContent.split("\n")) {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) {
    const key = m[1].trim();
    const val = m[2].trim().replace(/^"|"$/g, "");
    process.env[key] = val;
  }
}

const sql = neon(process.env.DATABASE_URL);

async function run() {
  console.log("Step 1: Create msbiz_order_items table...");
  await sql`
    CREATE TABLE IF NOT EXISTS msbiz_order_items (
      id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      order_id        TEXT NOT NULL REFERENCES msbiz_orders(id) ON DELETE CASCADE,
      merchandise_id  TEXT,
      name            TEXT NOT NULL,
      qty             INTEGER NOT NULL DEFAULT 1,
      unit_price      NUMERIC(10,2) NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_order_items_order ON msbiz_order_items(order_id)`;
  console.log("✓ msbiz_order_items created");

  console.log("Step 2: Migrate existing JSONB items...");
  const orders = await sql`SELECT id, items FROM msbiz_orders WHERE items IS NOT NULL AND items != 'null'::jsonb AND jsonb_array_length(items) > 0`;
  console.log(`  Found ${orders.length} orders with items`);
  
  let migrated = 0;
  for (const order of orders) {
    const items = Array.isArray(order.items) ? order.items : [];
    for (const item of items) {
      if (!item.name) continue;
      // Check if already migrated
      const existing = await sql`SELECT id FROM msbiz_order_items WHERE order_id = ${order.id} AND name = ${item.name} LIMIT 1`;
      if (existing.length > 0) continue;
      await sql`
        INSERT INTO msbiz_order_items (order_id, merchandise_id, name, qty, unit_price)
        VALUES (${order.id}, ${item.merchandise_id ?? null}, ${item.name}, ${item.qty ?? 1}, ${item.unit_price ?? 0})
      `;
      migrated++;
    }
  }
  console.log(`  Migrated ${migrated} items`);

  console.log("Step 3: Update msbiz_price_matches...");
  await sql`ALTER TABLE msbiz_price_matches ADD COLUMN IF NOT EXISTS order_item_id TEXT REFERENCES msbiz_order_items(id) ON DELETE SET NULL`;
  
  // Check if columns exist before dropping
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'msbiz_price_matches'
    AND column_name IN ('product_name','sku','order_item_ref')
  `;
  const colNames = cols.map(c => c.column_name);
  
  if (colNames.includes('product_name')) {
    await sql`ALTER TABLE msbiz_price_matches DROP COLUMN IF EXISTS product_name`;
    console.log("  Dropped product_name");
  }
  if (colNames.includes('sku')) {
    await sql`ALTER TABLE msbiz_price_matches DROP COLUMN IF EXISTS sku`;
    console.log("  Dropped sku");
  }
  if (colNames.includes('order_item_ref')) {
    await sql`ALTER TABLE msbiz_price_matches DROP COLUMN IF EXISTS order_item_ref`;
    console.log("  Dropped order_item_ref");
  }
  console.log("✓ msbiz_price_matches updated");

  console.log("Step 4: Drop msbiz_orders.items JSONB column...");
  await sql`ALTER TABLE msbiz_orders DROP COLUMN IF EXISTS items`;
  console.log("✓ msbiz_orders.items dropped");

  console.log("\n✅ Migration complete!");
}

run().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
