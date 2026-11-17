-- Notificações traduzíveis: os valores ficam em `data` e o front monta a frase no idioma de quem lê.
ALTER TABLE notifications ADD COLUMN data TEXT;

-- Rodízio do agendador: cada execução atende primeiro quem foi visto há mais tempo.
ALTER TABLE alert_prefs ADD COLUMN pass_at INTEGER NOT NULL DEFAULT 0;
