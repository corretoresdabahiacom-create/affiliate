-- Fase 6: calendário sazonal (editorial, global) e rascunhos de divulgação (por usuário).
CREATE TABLE seasonal_entries (
  id TEXT PRIMARY KEY,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  niche TEXT NOT NULL,
  note TEXT,
  metric_label TEXT,
  metric_value TEXT,
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_seasonal_month ON seasonal_entries(month, status);

CREATE TABLE seasonal_entry_programs (
  entry_id TEXT NOT NULL REFERENCES seasonal_entries(id) ON DELETE CASCADE,
  program_id TEXT NOT NULL REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, program_id)
);

CREATE TABLE ad_drafts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id TEXT REFERENCES affiliate_programs(id) ON DELETE SET NULL,
  program_name TEXT NOT NULL,
  channel TEXT NOT NULL,
  locale TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  disclosure TEXT NOT NULL,
  user_link TEXT,
  official_url TEXT,
  channel_field TEXT,
  channel_check TEXT NOT NULL CHECK (channel_check IN ('ok', 'unverified', 'blocked', 'none')),
  text_source TEXT NOT NULL CHECK (text_source IN ('catalog', 'model', 'user')),
  context TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'discarded')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_ad_drafts_user ON ad_drafts(user_id, status, created_at);
