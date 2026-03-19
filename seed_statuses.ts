import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
dotenv.config();

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  // Create tables
  await sql`
    CREATE TABLE IF NOT EXISTS msbiz_status_types (
      id    TEXT PRIMARY KEY,
      label TEXT NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS msbiz_statuses (
      id          TEXT PRIMARY KEY,
      type_id     TEXT NOT NULL REFERENCES msbiz_status_types(id) ON DELETE CASCADE,
      value       TEXT NOT NULL,
      label       TEXT NOT NULL,
      color_hex   TEXT,
      sort_order  INTEGER DEFAULT 0,
      is_terminal BOOLEAN DEFAULT false,
      UNIQUE(type_id, value)
    )
  `;
  console.log("Tables created.");

  // Seed types
  const types = [
    ['order', 'Order Status'],
    ['pm', 'Price Match Status'],
    ['shipping', 'Shipping / Inbound Status'],
    ['account', 'Account Status'],
    ['exception', 'Exception Status'],
    ['severity', 'Exception Severity'],
    ['price_match', 'Price Match Record Status'],
    ['inbound', 'Inbound Shipment Status'],
    ['outbound', 'Outbound Shipment Status'],
    ['invitation', 'Invitation Status'],
    ['purchase_order', 'Purchase Order Status'],
  ];
  for (const [id, label] of types) {
    await sql`INSERT INTO msbiz_status_types (id, label) VALUES (${id}, ${label}) ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label`;
  }
  console.log("Types seeded.");

  // Seed statuses: [id, type_id, value, label, color_hex, sort_order, is_terminal]
  const statuses: [string, string, string, string, string, number, boolean][] = [
    // order
    ['order.pending',    'order', 'pending',    'Pending',    '#6b7280', 1, false],
    ['order.processing', 'order', 'processing', 'Processing', '#3b82f6', 2, false],
    ['order.shipped',    'order', 'shipped',    'Shipped',    '#f59e0b', 3, false],
    ['order.delivered',  'order', 'delivered',  'Delivered',  '#22c55e', 4, false],
    ['order.confirmed',  'order', 'confirmed',  'Confirmed',  '#10b981', 5, true],
    ['order.cancelled',  'order', 'cancelled',  'Cancelled',  '#374151', 6, true],
    ['order.exception',  'order', 'exception',  'Exception',  '#ef4444', 7, false],
    // pm
    ['pm.unpmed',    'pm', 'unpmed',    'Pending PM',  '#f59e0b', 1, false],
    ['pm.submitted', 'pm', 'submitted', 'Submitted',   '#3b82f6', 2, false],
    ['pm.approved',  'pm', 'approved',  'Approved',    '#22c55e', 3, true],
    ['pm.rejected',  'pm', 'rejected',  'Rejected',    '#ef4444', 4, true],
    ['pm.ineligible','pm', 'ineligible','Ineligible',  '#6b7280', 5, true],
    ['pm.expired',   'pm', 'expired',   'Expired',     '#991b1b', 6, true],
    // shipping
    ['shipping.pending',          'shipping', 'pending',          'Pending',          '#6b7280', 1, false],
    ['shipping.ordered',          'shipping', 'ordered',          'Ordered',          '#f59e0b', 2, false],
    ['shipping.in_transit',       'shipping', 'in_transit',       'In Transit',       '#3b82f6', 3, false],
    ['shipping.out_for_delivery', 'shipping', 'out_for_delivery', 'Out for Delivery', '#8b5cf6', 4, false],
    ['shipping.delivered',        'shipping', 'delivered',        'Delivered',        '#22c55e', 5, true],
    // account
    ['account.Ready',     'account', 'Ready',     'Ready',         '#22c55e', 1, false],
    ['account.Suspended', 'account', 'Suspended', 'Suspended',     '#ef4444', 2, true],
    ['account.Topup',     'account', 'Topup',     'Top Up Needed', '#f59e0b', 3, false],
    ['account.Error',     'account', 'Error',     'Error',         '#f87171', 4, false],
    ['account.Hold',      'account', 'Hold',      'Hold',          '#6b7280', 5, false],
    // exception
    ['exception.open',          'exception', 'open',          'Open',          '#ef4444', 1, false],
    ['exception.investigating', 'exception', 'investigating', 'Investigating', '#f59e0b', 2, false],
    ['exception.resolved',      'exception', 'resolved',      'Resolved',      '#22c55e', 3, true],
    // severity
    ['severity.low',      'severity', 'low',      'Low',      '#22c55e', 1, false],
    ['severity.medium',   'severity', 'medium',   'Medium',   '#f59e0b', 2, false],
    ['severity.high',     'severity', 'high',     'High',     '#ef4444', 3, false],
    ['severity.critical', 'severity', 'critical', 'Critical', '#991b1b', 4, false],
    // price_match
    ['price_match.pending',   'price_match', 'pending',   'Pending',   '#f59e0b', 1, false],
    ['price_match.submitted', 'price_match', 'submitted', 'Submitted', '#3b82f6', 2, false],
    ['price_match.approved',  'price_match', 'approved',  'Approved',  '#22c55e', 3, true],
    ['price_match.rejected',  'price_match', 'rejected',  'Rejected',  '#ef4444', 4, true],
    // inbound
    ['inbound.pending',    'inbound', 'pending',    'Pending',    '#6b7280', 1, false],
    ['inbound.in_transit', 'inbound', 'in_transit', 'In Transit', '#3b82f6', 2, false],
    ['inbound.received',   'inbound', 'received',   'Received',   '#22c55e', 3, true],
    ['inbound.partial',    'inbound', 'partial',    'Partial',    '#f59e0b', 4, false],
    // outbound
    ['outbound.pending',   'outbound', 'pending',   'Pending',   '#6b7280', 1, false],
    ['outbound.shipped',   'outbound', 'shipped',   'Shipped',   '#f59e0b', 2, false],
    ['outbound.delivered', 'outbound', 'delivered', 'Delivered', '#22c55e', 3, true],
    ['outbound.exception', 'outbound', 'exception', 'Exception', '#ef4444', 4, false],
    // invitation
    ['invitation.pending',  'invitation', 'pending',  'Pending',  '#f59e0b', 1, false],
    ['invitation.accepted', 'invitation', 'accepted', 'Accepted', '#22c55e', 2, true],
    ['invitation.expired',  'invitation', 'expired',  'Expired',  '#6b7280', 3, true],
    // purchase_order
    ['purchase_order.pending',   'purchase_order', 'pending',   'Pending',   '#6b7280', 1, false],
    ['purchase_order.approved',  'purchase_order', 'approved',  'Approved',  '#3b82f6', 2, false],
    ['purchase_order.ordered',   'purchase_order', 'ordered',   'Ordered',   '#f59e0b', 3, false],
    ['purchase_order.received',  'purchase_order', 'received',  'Received',  '#22c55e', 4, true],
    ['purchase_order.cancelled', 'purchase_order', 'cancelled', 'Cancelled', '#374151', 5, true],
  ];

  for (const [id, type_id, value, label, color_hex, sort_order, is_terminal] of statuses) {
    await sql`
      INSERT INTO msbiz_statuses (id, type_id, value, label, color_hex, sort_order, is_terminal)
      VALUES (${id}, ${type_id}, ${value}, ${label}, ${color_hex}, ${sort_order}, ${is_terminal})
      ON CONFLICT (id) DO UPDATE SET
        type_id = EXCLUDED.type_id,
        value = EXCLUDED.value,
        label = EXCLUDED.label,
        color_hex = EXCLUDED.color_hex,
        sort_order = EXCLUDED.sort_order,
        is_terminal = EXCLUDED.is_terminal
    `;
  }
  console.log(`Statuses seeded: ${statuses.length} rows.`);
}

main().catch(e => { console.error(e); process.exit(1); });
