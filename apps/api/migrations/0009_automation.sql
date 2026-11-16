-- Fase 7: webhooks de saída (n8n etc.), entrada por token, notificações e monitor de fontes oficiais.

-- Endpoints de saída. O segredo de assinatura fica cifrado no cofre (CREDENTIALS_KEY) e só é mostrado uma vez.
CREATE TABLE webhook_endpoints (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  secret_enc TEXT NOT NULL,
  events TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  consecutive_dead INTEGER NOT NULL DEFAULT 0,
  last_delivery_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_webhook_endpoints_user ON webhook_endpoints(user_id);

CREATE TABLE webhook_deliveries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  response_status INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER
);
CREATE INDEX idx_webhook_deliveries_due ON webhook_deliveries(status, next_attempt_at);
CREATE INDEX idx_webhook_deliveries_user ON webhook_deliveries(user_id, created_at);

-- Entrada: o token aparece uma vez; só o hash fica guardado.
CREATE TABLE inbound_hooks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  actions TEXT NOT NULL,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_inbound_hooks_user ON inbound_hooks(user_id);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at);

-- E-mail é opt-in (LGPD): começa desligado. A frequência vem de alert_prefs.frequency.
ALTER TABLE alert_prefs ADD COLUMN email_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE alert_prefs ADD COLUMN last_digest_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE alert_prefs ADD COLUMN last_event_at INTEGER NOT NULL DEFAULT 0;

-- Monitor de fontes oficiais (global, para não repetir a mesma requisição por usuário).
CREATE TABLE source_checks (
  source_id TEXT PRIMARY KEY REFERENCES program_sources(id) ON DELETE CASCADE,
  last_status INTEGER,
  last_hash TEXT,
  failures INTEGER NOT NULL DEFAULT 0,
  last_checked_at INTEGER NOT NULL,
  changed_at INTEGER
);
CREATE INDEX idx_source_checks_checked ON source_checks(last_checked_at);
