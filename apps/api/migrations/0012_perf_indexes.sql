-- Fase 9: índices achados pelo teste de planos de consulta (test/performance.test.ts).
-- Contagem/relatório de cliques por usuário e período; limpeza diária por data.
CREATE INDEX IF NOT EXISTS idx_clicks_user_at ON link_clicks(user_id, at);
CREATE INDEX IF NOT EXISTS idx_clicks_at ON link_clicks(at);
