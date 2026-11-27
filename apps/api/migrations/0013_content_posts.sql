-- Semana de conteúdo: plano semanal de posts/vídeos por plataforma, com aprovação humana e métricas informadas pelo usuário.
-- Nada aqui publica sozinho: "scheduled" e "published" são marcações feitas pelo usuário depois de agendar/publicar na plataforma.
CREATE TABLE content_posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  day INTEGER NOT NULL CHECK (day BETWEEN 0 AND 6),
  post_time TEXT,
  title TEXT NOT NULL,
  hook TEXT,
  script TEXT,
  platforms TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'approved', 'scheduled', 'published')),
  uses_affiliate_link INTEGER NOT NULL DEFAULT 0,
  disclosure_confirmed INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  views INTEGER,
  likes INTEGER,
  shares INTEGER,
  saves INTEGER,
  clicks INTEGER,
  retention_pct REAL,
  metrics_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_content_user_week ON content_posts(user_id, week_start);
