-- ============================================================
-- MS Business Module Migration
-- All tables prefixed with msbiz_
-- Existing tables (prof_*, UserModule, etc.) are NOT touched
-- ============================================================

-- Permission system (shared across modules, not msbiz-specific)
CREATE TABLE IF NOT EXISTS user_module_permissions (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id      TEXT NOT NULL,
  module       TEXT NOT NULL,  -- 'msbiz', 'canvas_lms', etc.
  role_name    TEXT NOT NULL DEFAULT 'viewer',
  permissions  JSONB NOT NULL DEFAULT '{}',
  granted_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, module)
);

-- Module invitations (msbiz invite-only)
CREATE TABLE IF NOT EXISTS msbiz_invitations (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email        TEXT NOT NULL,
  role_name    TEXT NOT NULL DEFAULT 'viewer',
  permissions  JSONB NOT NULL DEFAULT '{}',
  token        TEXT NOT NULL UNIQUE,
  invited_by   TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  accepted_at  TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending/accepted/expired/revoked
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Microsoft accounts (MS.com credentials)
CREATE TABLE IF NOT EXISTS msbiz_accounts (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id          TEXT NOT NULL,
  email            TEXT NOT NULL,
  password_enc     TEXT NOT NULL,  -- AES-256-GCM encrypted
  display_name     TEXT,
  status           TEXT NOT NULL DEFAULT 'active',  -- active/suspended/locked
  notes            TEXT,
  last_used_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_msbiz_accounts_user ON msbiz_accounts(user_id);

-- Addresses
CREATE TABLE IF NOT EXISTS msbiz_addresses (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id          TEXT NOT NULL,
  label            TEXT,
  full_address     TEXT NOT NULL,
  street1          TEXT,
  street2          TEXT,
  city             TEXT,
  state            TEXT,
  zip              TEXT,
  country          TEXT DEFAULT 'US',
  google_place_id  TEXT,
  lat              NUMERIC(10,7),
  lng              NUMERIC(10,7),
  is_warehouse     BOOLEAN NOT NULL DEFAULT false,
  contact_name     TEXT,
  contact_phone    TEXT,
  is_shared        BOOLEAN NOT NULL DEFAULT false,  -- admin-shared addresses
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_msbiz_addresses_user ON msbiz_addresses(user_id);

-- Warehouses
CREATE TABLE IF NOT EXISTS msbiz_warehouses (
  id                       TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id                  TEXT NOT NULL,
  name                     TEXT NOT NULL,
  address_id               TEXT REFERENCES msbiz_addresses(id),
  owner_name               TEXT,
  owner_contact            TEXT,
  inbound_cost_per_unit    NUMERIC(10,2) DEFAULT 0,
  outbound_cost_per_unit   NUMERIC(10,2) DEFAULT 0,
  notes                    TEXT,
  active                   BOOLEAN NOT NULL DEFAULT true,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Inventory
CREATE TABLE IF NOT EXISTS msbiz_inventory (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  warehouse_id     TEXT NOT NULL REFERENCES msbiz_warehouses(id),
  sku              TEXT NOT NULL,
  product_name     TEXT NOT NULL,
  qty_on_hand      INT NOT NULL DEFAULT 0,
  qty_reserved     INT NOT NULL DEFAULT 0,
  unit_cost        NUMERIC(10,2),
  notes            TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (warehouse_id, sku)
);

-- Orders
CREATE TABLE IF NOT EXISTS msbiz_orders (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id          TEXT NOT NULL,
  account_id       TEXT NOT NULL REFERENCES msbiz_accounts(id),
  ms_order_number  TEXT NOT NULL,
  order_date       DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',
  items            JSONB NOT NULL DEFAULT '[]',
  subtotal         NUMERIC(10,2) DEFAULT 0,
  tax              NUMERIC(10,2) DEFAULT 0,
  shipping_cost    NUMERIC(10,2) DEFAULT 0,
  total            NUMERIC(10,2) DEFAULT 0,
  shipping_address_id TEXT REFERENCES msbiz_addresses(id),
  tracking_number  TEXT,
  carrier          TEXT,
  pm_status        TEXT NOT NULL DEFAULT 'unpmed',
  pm_deadline_at   TIMESTAMPTZ,
  pm_amount        NUMERIC(10,2),
  pm_submitted_at  TIMESTAMPTZ,
  inbound_status   TEXT NOT NULL DEFAULT 'pending',
  exception_count  INT NOT NULL DEFAULT 0,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_msbiz_orders_user ON msbiz_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_msbiz_orders_account ON msbiz_orders(account_id);
CREATE INDEX IF NOT EXISTS idx_msbiz_orders_pm_status ON msbiz_orders(pm_status);
CREATE INDEX IF NOT EXISTS idx_msbiz_orders_pm_deadline ON msbiz_orders(pm_deadline_at);

-- Inbound
CREATE TABLE IF NOT EXISTS msbiz_inbound (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id          TEXT NOT NULL,
  order_id         TEXT NOT NULL REFERENCES msbiz_orders(id),
  warehouse_id     TEXT NOT NULL REFERENCES msbiz_warehouses(id),
  sku              TEXT NOT NULL,
  product_name     TEXT NOT NULL,
  qty_expected     INT NOT NULL DEFAULT 0,
  qty_received     INT NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'pending',
  tracking_number  TEXT,
  carrier          TEXT,
  expected_at      TIMESTAMPTZ,
  received_at      TIMESTAMPTZ,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_msbiz_inbound_order ON msbiz_inbound(order_id);
CREATE INDEX IF NOT EXISTS idx_msbiz_inbound_warehouse ON msbiz_inbound(warehouse_id);

-- Outbound
CREATE TABLE IF NOT EXISTS msbiz_outbound (
  id                       TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id                  TEXT NOT NULL,
  warehouse_id             TEXT NOT NULL REFERENCES msbiz_warehouses(id),
  destination_type         TEXT NOT NULL DEFAULT 'customer',
  destination_address_id   TEXT REFERENCES msbiz_addresses(id),
  tracking_number          TEXT,
  carrier                  TEXT,
  status                   TEXT NOT NULL DEFAULT 'pending',
  items                    JSONB NOT NULL DEFAULT '[]',
  qty_total                INT NOT NULL DEFAULT 0,
  per_item_cost            NUMERIC(10,2) DEFAULT 0,
  total_warehouse_cost     NUMERIC(10,2) DEFAULT 0,
  shipping_cost            NUMERIC(10,2) DEFAULT 0,
  shipped_at               TIMESTAMPTZ,
  delivered_at             TIMESTAMPTZ,
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Price Matches
CREATE TABLE IF NOT EXISTS msbiz_price_matches (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id          TEXT NOT NULL,
  order_id         TEXT NOT NULL REFERENCES msbiz_orders(id),
  order_item_ref   TEXT,
  product_name     TEXT NOT NULL,
  sku              TEXT,
  original_price   NUMERIC(10,2) NOT NULL,
  match_price      NUMERIC(10,2) NOT NULL,
  match_source     TEXT,
  match_source_url TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  submitted_at     TIMESTAMPTZ,
  approved_at      TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_msbiz_pm_order ON msbiz_price_matches(order_id);
CREATE INDEX IF NOT EXISTS idx_msbiz_pm_expires ON msbiz_price_matches(expires_at);
CREATE INDEX IF NOT EXISTS idx_msbiz_pm_status ON msbiz_price_matches(status);

-- PM Rules
CREATE TABLE IF NOT EXISTS msbiz_pm_rules (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id              TEXT NOT NULL UNIQUE,
  pm_window_days       INT NOT NULL DEFAULT 60,
  remind_days_before   INT NOT NULL DEFAULT 3,
  notify_discord       BOOLEAN NOT NULL DEFAULT true,
  notify_email         BOOLEAN NOT NULL DEFAULT false,
  enabled              BOOLEAN NOT NULL DEFAULT true,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Invoices
CREATE TABLE IF NOT EXISTS msbiz_invoices (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id          TEXT NOT NULL,
  qb_invoice_id    TEXT,
  qb_customer_id   TEXT,
  qb_customer_name TEXT,
  order_ids        JSONB NOT NULL DEFAULT '[]',
  status           TEXT NOT NULL DEFAULT 'draft',
  subtotal         NUMERIC(10,2) DEFAULT 0,
  tax              NUMERIC(10,2) DEFAULT 0,
  total            NUMERIC(10,2) DEFAULT 0,
  currency         TEXT DEFAULT 'USD',
  issued_at        DATE,
  due_at           DATE,
  paid_at          DATE,
  qb_synced_at     TIMESTAMPTZ,
  qb_error         TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Costs
CREATE TABLE IF NOT EXISTS msbiz_costs (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT NOT NULL,
  type       TEXT NOT NULL,
  ref_id     TEXT,
  ref_type   TEXT,
  payee      TEXT,
  amount     NUMERIC(10,2) NOT NULL,
  currency   TEXT DEFAULT 'USD',
  paid_at    DATE,
  description TEXT,
  receipt_url TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_msbiz_costs_user ON msbiz_costs(user_id);
CREATE INDEX IF NOT EXISTS idx_msbiz_costs_ref ON msbiz_costs(ref_id, ref_type);

-- Tracking events
CREATE TABLE IF NOT EXISTS msbiz_tracking_events (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  ref_id          TEXT NOT NULL,
  ref_type        TEXT NOT NULL,
  tracking_number TEXT NOT NULL,
  carrier         TEXT,
  status          TEXT,
  event_type      TEXT,
  description     TEXT,
  location        TEXT,
  event_at        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_msbiz_tracking_ref ON msbiz_tracking_events(ref_id, ref_type);

-- Exceptions
CREATE TABLE IF NOT EXISTS msbiz_exceptions (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id          TEXT NOT NULL,
  type             TEXT NOT NULL,
  ref_id           TEXT,
  ref_type         TEXT,
  severity         TEXT NOT NULL DEFAULT 'medium',
  title            TEXT NOT NULL,
  description      TEXT,
  status           TEXT NOT NULL DEFAULT 'open',
  assigned_to      TEXT,
  resolved_at      TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_msbiz_exceptions_user ON msbiz_exceptions(user_id);
CREATE INDEX IF NOT EXISTS idx_msbiz_exceptions_status ON msbiz_exceptions(status);

-- Reminders
CREATE TABLE IF NOT EXISTS msbiz_reminders (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT NOT NULL,
  type       TEXT NOT NULL,
  ref_id     TEXT,
  ref_type   TEXT,
  message    TEXT NOT NULL,
  remind_at  TIMESTAMPTZ NOT NULL,
  sent_at    TIMESTAMPTZ,
  status     TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_msbiz_reminders_user_status ON msbiz_reminders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_msbiz_reminders_remind_at ON msbiz_reminders(remind_at);

-- Audit log
CREATE TABLE IF NOT EXISTS msbiz_audit_log (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id      TEXT NOT NULL,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  before_state JSONB,
  after_state  JSONB,
  ip_address   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_msbiz_audit_user ON msbiz_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_msbiz_audit_entity ON msbiz_audit_log(entity_type, entity_id);
