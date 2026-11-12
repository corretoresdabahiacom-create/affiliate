-- Fase 6 (parte 3): variações, atributos, edição pós-publicação, preço/estoque e pedidos.
ALTER TABLE supplier_products ADD COLUMN variants TEXT;
ALTER TABLE marketplace_listings ADD COLUMN variants TEXT;
ALTER TABLE marketplace_listings ADD COLUMN attributes TEXT NOT NULL DEFAULT '[]';
ALTER TABLE marketplace_listings ADD COLUMN attribute_schema TEXT;
ALTER TABLE marketplace_listings ADD COLUMN price_rule TEXT;
ALTER TABLE marketplace_listings ADD COLUMN update_status TEXT CHECK (update_status IN ('dirty', 'authorized'));
ALTER TABLE marketplace_listings ADD COLUMN shopee_models TEXT;
ALTER TABLE marketplace_listings ADD COLUMN last_synced_at INTEGER;

-- Pedidos reportados pela Shopee. Só o necessário: sem nome, endereço ou contato do comprador.
CREATE TABLE marketplace_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  order_sn TEXT NOT NULL,
  status TEXT NOT NULL,
  ordered_at INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'BRL',
  total REAL,
  items TEXT NOT NULL DEFAULT '[]',
  tracking_number TEXT,
  tracking_status TEXT,
  tracking_events TEXT NOT NULL DEFAULT '[]',
  tracking_checked_at INTEGER,
  supplier_status TEXT NOT NULL DEFAULT 'not_placed' CHECK (supplier_status IN ('not_placed', 'placed', 'shipped', 'delivered', 'problem')),
  supplier_ref TEXT,
  supplier_tracking TEXT,
  synced_at INTEGER NOT NULL,
  UNIQUE (connection_id, order_sn)
);
CREATE INDEX idx_orders_user ON marketplace_orders(user_id, connection_id, ordered_at);
