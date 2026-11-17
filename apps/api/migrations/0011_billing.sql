-- Fase 8: assinaturas, pagamentos registrados e limites por plano.
-- Preços ficam NULL até o administrador configurar. Nenhum gateway é integrado sem aprovação explícita:
-- o único provedor é "manual" (o administrador registra o pagamento recebido) e "grant" (cortesia).

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL CHECK (status IN ('incomplete','trialing','active','past_due','canceled','expired')),
  trial_ends_at INTEGER,
  trial_used INTEGER NOT NULL DEFAULT 0,
  current_period_start INTEGER,
  current_period_end INTEGER,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  grace_until INTEGER,
  canceled_at INTEGER,
  provider TEXT NOT NULL DEFAULT 'manual' CHECK (provider IN ('manual','grant')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_subs_status ON subscriptions(status, current_period_end);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
  plan_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','paid','failed','refunded')),
  provider TEXT NOT NULL DEFAULT 'manual',
  provider_ref TEXT,
  period_start INTEGER,
  period_end INTEGER,
  paid_at INTEGER,
  note TEXT,
  recorded_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_payments_user ON payments(user_id, created_at);
CREATE INDEX idx_payments_paid ON payments(status, paid_at);
-- Idempotência: o mesmo comprovante não é registrado duas vezes.
CREATE UNIQUE INDEX uq_payments_ref ON payments(provider, provider_ref) WHERE provider_ref IS NOT NULL;

-- Limites iniciais (editáveis em Admin > Planos). Chave ausente = ilimitado; 0 = recurso desligado.
UPDATE plans SET limits = '{"savedPrograms":15,"links":10,"campaigns":3,"aiRequestsMonthly":20,"reports":0}' WHERE id = 'free' AND limits = '{}';
UPDATE plans SET limits = '{"savedPrograms":60,"links":100,"campaigns":15,"aiRequestsMonthly":150,"reports":0}' WHERE id = 'starter' AND limits = '{}';
UPDATE plans SET limits = '{"savedPrograms":300,"links":1000,"campaigns":100,"aiRequestsMonthly":800,"reports":1}' WHERE id = 'pro' AND limits = '{}';
UPDATE plans SET limits = '{"reports":1}' WHERE id = 'business' AND limits = '{}';
