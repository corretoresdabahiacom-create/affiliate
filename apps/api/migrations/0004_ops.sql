-- Fase 4: gestão do afiliado (programas, links, campanhas, comissões).
-- Todas as tabelas do usuário têm ON DELETE CASCADE: excluir a conta apaga tudo (LGPD/GDPR).

ALTER TABLE affiliate_programs ADD COLUMN allows_redirect TEXT NOT NULL DEFAULT 'unverified'
  CHECK (allows_redirect IN ('yes', 'no', 'unverified'));

ALTER TABLE user_profiles ADD COLUMN languages TEXT NOT NULL DEFAULT '[]';
ALTER TABLE user_profiles ADD COLUMN audience_size INTEGER;
ALTER TABLE user_profiles ADD COLUMN weekly_hours INTEGER;
ALTER TABLE user_profiles ADD COLUMN prefers_physical INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_profiles ADD COLUMN prefers_saas INTEGER NOT NULL DEFAULT 0;

CREATE TABLE user_programs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id TEXT NOT NULL REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'saved' CHECK (status IN
    ('interested','saved','application_pending','approved','rejected','active','suspended','closed')),
  applied_at INTEGER,
  approved_at INTEGER,
  affiliate_id TEXT,
  accepted_terms TEXT,
  notes TEXT,
  next_action TEXT,
  next_action_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, program_id)
);
CREATE INDEX idx_user_programs_user ON user_programs(user_id, status);

CREATE TABLE user_program_history (
  id TEXT PRIMARY KEY,
  user_program_id TEXT NOT NULL REFERENCES user_programs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX idx_uph_up ON user_program_history(user_program_id, at);

-- Apenas referências (título + link). Nenhum arquivo é guardado.
CREATE TABLE user_program_docs (
  id TEXT PRIMARY KEY,
  user_program_id TEXT NOT NULL REFERENCES user_programs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  program_id TEXT REFERENCES affiliate_programs(id) ON DELETE SET NULL,
  product_name TEXT,
  channel TEXT NOT NULL,
  keyword TEXT,
  audience TEXT,
  budget REAL,
  ad_spend REAL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','paused','ended')),
  starts_at INTEGER,
  ends_at INTEGER,
  clicks_reported INTEGER,
  conversions_reported INTEGER,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_campaigns_user ON campaigns(user_id);

CREATE TABLE affiliate_links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  program_id TEXT REFERENCES affiliate_programs(id) ON DELETE SET NULL,
  product_id TEXT,
  product_name TEXT,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'other',
  campaign_tag TEXT,
  tracking_mode TEXT NOT NULL DEFAULT 'none' CHECK (tracking_mode IN ('none','own_redirect')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_links_user ON affiliate_links(user_id);

-- Sem IP e sem cookie: só um hash diário com sal.
CREATE TABLE link_clicks (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL REFERENCES affiliate_links(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  source TEXT,
  visitor_hash TEXT NOT NULL
);
CREATE INDEX idx_clicks_link ON link_clicks(link_id, at);

CREATE TABLE commissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id TEXT REFERENCES affiliate_programs(id) ON DELETE SET NULL,
  link_id TEXT REFERENCES affiliate_links(id) ON DELETE SET NULL,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  product_name TEXT,
  channel TEXT,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'estimated' CHECK (status IN ('estimated','pending','approved','paid','rejected')),
  conversion_state TEXT NOT NULL DEFAULT 'reported' CHECK (conversion_state IN ('reported','confirmed')),
  occurred_at INTEGER NOT NULL,
  approved_at INTEGER,
  paid_at INTEGER,
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','csv','api','own_tracking')),
  external_ref TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_commissions_user ON commissions(user_id, status);
CREATE UNIQUE INDEX uq_commissions_csv_ref ON commissions(user_id, program_id, external_ref)
  WHERE origin = 'csv' AND external_ref IS NOT NULL;

CREATE TABLE commission_adjustments (
  id TEXT PRIMARY KEY,
  commission_id TEXT NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('refund','cancellation','chargeback','adjustment')),
  amount REAL NOT NULL,
  note TEXT,
  at INTEGER NOT NULL
);
