-- Fase 1: fundação. Usuários, sessões, perfil, planos, auditoria e limites.
-- Dados privados sempre carregam user_id; o catálogo (Fase 2) será global.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'editor', 'admin')),
  plan_id TEXT NOT NULL DEFAULT 'free',
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE user_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT,
  locale TEXT NOT NULL DEFAULT 'pt-BR' CHECK (locale IN ('pt-BR', 'en-US', 'es')),
  country TEXT,
  experience TEXT CHECK (experience IN ('none', 'beginner', 'intermediate', 'advanced')),
  niches TEXT NOT NULL DEFAULT '[]',
  channels TEXT NOT NULL DEFAULT '[]',
  has_website INTEGER NOT NULL DEFAULT 0,
  monthly_budget_usd INTEGER,
  wants_recurring INTEGER NOT NULL DEFAULT 0,
  accepts_paid_traffic INTEGER NOT NULL DEFAULT 0,
  onboarded_at INTEGER,
  updated_at INTEGER NOT NULL
);

-- Guardamos apenas o hash do token; o valor original só existe no e-mail e na URL.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE login_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'pt-BR',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX idx_login_tokens_expires ON login_tokens(expires_at);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

-- Preços e limites são configuráveis pelo administrador; nenhum valor fixo no código.
CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_price_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'USD',
  limits TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
INSERT INTO plans (id, name, monthly_price_cents, limits, sort_order) VALUES
  ('free', 'Free', NULL, '{}', 0),
  ('starter', 'Starter', NULL, '{}', 1),
  ('pro', 'Pro', NULL, '{}', 2),
  ('business', 'Business', NULL, '{}', 3);

CREATE TABLE admin_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- user_id sem chave estrangeira de propósito: o registro de auditoria sobrevive
-- à exclusão da conta, guardando apenas o identificador pseudônimo.
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);

-- Auditoria só de inserção.
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
