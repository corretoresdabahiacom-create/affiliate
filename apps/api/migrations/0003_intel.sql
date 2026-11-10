-- Fase 3: preferências e leitura dos alertas por usuário.
-- Os alertas em si são derivados do histórico imutável do catálogo (program_history).
CREATE TABLE alert_prefs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  categories TEXT NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('instant', 'daily', 'weekly')),
  seen_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
