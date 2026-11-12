-- Fase 6 (parte 2): conexões (credenciais cifradas), produtos de fornecedor e anúncios do marketplace.
CREATE TABLE integration_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('shopee', 'supplier')),
  label TEXT NOT NULL,
  config TEXT NOT NULL,          -- só dados NÃO secretos (host, partner_id, mapeamento)
  secrets_enc TEXT,              -- AES-GCM: chave do parceiro, token, access/refresh token
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'error')),
  status_detail TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_conn_user ON integration_connections(user_id, provider);

CREATE TABLE supplier_products (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  sku TEXT,
  name TEXT NOT NULL,
  description TEXT,
  cost_price REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'BRL',
  stock INTEGER,
  images TEXT NOT NULL DEFAULT '[]',
  category TEXT,
  weight_kg REAL,
  source TEXT NOT NULL CHECK (source IN ('csv', 'json', 'api')),
  synced_at INTEGER NOT NULL,
  UNIQUE (connection_id, external_id)
);
CREATE INDEX idx_supplier_user ON supplier_products(user_id, connection_id);

CREATE TABLE marketplace_listings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  supplier_product_id TEXT REFERENCES supplier_products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  price REAL NOT NULL,
  cost_price REAL NOT NULL,
  currency TEXT NOT NULL,
  stock INTEGER,
  weight_kg REAL,
  category_id INTEGER,
  logistics_channel_ids TEXT NOT NULL DEFAULT '[]',
  images TEXT NOT NULL DEFAULT '[]',
  context TEXT NOT NULL,
  text_source TEXT NOT NULL CHECK (text_source IN ('supplier', 'model', 'user')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'publishing', 'published', 'failed', 'discarded')),
  external_item_id TEXT,
  last_error TEXT,
  authorized_at INTEGER,
  published_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_listings_user ON marketplace_listings(user_id, status, created_at);
