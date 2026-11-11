-- Fase 5: uso e cache da IA. Nenhum texto de conversa é guardado em histórico.
CREATE TABLE ai_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('llm', 'cached')),
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  grounded INTEGER NOT NULL DEFAULT 1,
  at INTEGER NOT NULL
);
CREATE INDEX idx_ai_usage_user ON ai_usage(user_id, at);
CREATE INDEX idx_ai_usage_at ON ai_usage(at);

-- Cache por usuário (a resposta pode depender do perfil). Apagado com a conta.
CREATE TABLE ai_cache (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answer TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_ai_cache_user ON ai_cache(user_id);
