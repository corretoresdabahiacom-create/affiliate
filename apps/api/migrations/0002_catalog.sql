-- Fase 2: catálogo global de programas de afiliados.
-- Regras: nenhum dado comercial é inventado. Campos de aceitação são tri-estado
-- ('yes' | 'no' | 'unverified'); NULL/ausência nunca significa "sim".
-- Colunas de data são epoch em milissegundos.

CREATE TABLE affiliate_networks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'network' CHECK (kind IN ('network', 'platform')),
  website_url TEXT,
  website_url_status TEXT NOT NULL DEFAULT 'unverified' CHECK (website_url_status IN ('verified', 'unverified', 'unavailable')),
  operational_status TEXT NOT NULL DEFAULT 'unverified' CHECK (operational_status IN ('active', 'migrating', 'closed', 'unverified')),
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Anunciantes/empresas (absorve o antigo conceito de "merchant").
CREATE TABLE advertisers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  website_url TEXT,
  country TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  segment TEXT NOT NULL CHECK (segment IN ('physical', 'saas', 'digital', 'services')),
  name_pt TEXT NOT NULL,
  name_en TEXT NOT NULL,
  name_es TEXT NOT NULL
);

CREATE TABLE affiliate_programs (
  id TEXT PRIMARY KEY,
  advertiser_id TEXT NOT NULL REFERENCES advertisers(id),
  network_id TEXT REFERENCES affiliate_networks(id),
  category_id TEXT REFERENCES categories(id),
  name TEXT NOT NULL,
  segment TEXT NOT NULL CHECK (segment IN ('physical', 'saas', 'digital', 'services')),
  description TEXT,

  accepts_brazil TEXT NOT NULL DEFAULT 'unverified' CHECK (accepts_brazil IN ('yes', 'no', 'unverified')),
  accepts_individuals TEXT NOT NULL DEFAULT 'unverified' CHECK (accepts_individuals IN ('yes', 'no', 'unverified')),
  requires_company TEXT NOT NULL DEFAULT 'unverified' CHECK (requires_company IN ('yes', 'no', 'unverified')),
  requires_website TEXT NOT NULL DEFAULT 'unverified' CHECK (requires_website IN ('yes', 'no', 'unverified')),
  accepts_social TEXT NOT NULL DEFAULT 'unverified' CHECK (accepts_social IN ('yes', 'no', 'unverified')),
  accepts_paid_traffic TEXT NOT NULL DEFAULT 'unverified' CHECK (accepts_paid_traffic IN ('yes', 'no', 'unverified')),
  accepts_organic TEXT NOT NULL DEFAULT 'unverified' CHECK (accepts_organic IN ('yes', 'no', 'unverified')),

  commission_type TEXT NOT NULL DEFAULT 'unknown' CHECK (commission_type IN ('percent', 'fixed', 'tiered', 'unknown')),
  commission_percent REAL,
  commission_fixed REAL,
  currency TEXT,
  is_recurring TEXT NOT NULL DEFAULT 'unverified' CHECK (is_recurring IN ('yes', 'no', 'unverified')),
  recurring_duration_months INTEGER,
  cookie_days INTEGER,
  attribution_model TEXT,
  min_payout REAL,
  payout_currency TEXT,
  payout_frequency TEXT NOT NULL DEFAULT 'unknown' CHECK (payout_frequency IN ('weekly', 'biweekly', 'monthly', 'threshold', 'unknown')),
  payout_methods TEXT NOT NULL DEFAULT '[]',
  validation_days INTEGER,
  refund_policy TEXT,
  approval_requirements TEXT,
  promo_restrictions TEXT,

  official_url TEXT,
  signup_url TEXT,
  signup_url_status TEXT NOT NULL DEFAULT 'unverified' CHECK (signup_url_status IN ('verified', 'unverified', 'unavailable')),
  docs_url TEXT,

  -- Programa encerrado/suspenso/indisponível não aparece na lista padrão.
  lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active', 'closed', 'suspended', 'unavailable')),
  verification_flag TEXT NOT NULL DEFAULT 'none' CHECK (verification_flag IN ('none', 'divergent', 'awaiting_update')),
  last_verified_at INTEGER,
  last_verified_by TEXT,

  dedupe_key TEXT NOT NULL UNIQUE,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_programs_advertiser ON affiliate_programs(advertiser_id);
CREATE INDEX idx_programs_network ON affiliate_programs(network_id);
CREATE INDEX idx_programs_category ON affiliate_programs(category_id);
CREATE INDEX idx_programs_lifecycle ON affiliate_programs(lifecycle_status, segment);

-- Fontes que sustentam os dados. Só fonte oficial (rank <= 3) confirma um campo.
CREATE TABLE program_sources (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN
    ('official_docs', 'official_page', 'official_api', 'official_communication', 'secondary_reliable', 'unconfirmed')),
  field TEXT,
  url TEXT NOT NULL,
  note TEXT,
  consulted_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  recorded_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sources_program ON program_sources(program_id);

-- Histórico de alterações: nunca apagado nem editado (triggers abaixo).
CREATE TABLE program_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by TEXT,
  note TEXT,
  changed_at INTEGER NOT NULL
);
CREATE INDEX idx_history_program ON program_history(program_id, id);
CREATE TRIGGER program_history_no_update BEFORE UPDATE ON program_history
BEGIN SELECT RAISE(ABORT, 'program_history is append-only'); END;
CREATE TRIGGER program_history_no_delete BEFORE DELETE ON program_history
BEGIN SELECT RAISE(ABORT, 'program_history is append-only'); END;

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT,
  description TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_products_program ON products(program_id);

CREATE TABLE offers (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  details TEXT,
  url TEXT,
  starts_at INTEGER,
  ends_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_offers_program ON offers(program_id);

-- Busca de texto (FTS5): reindexada pela API a cada escrita.
CREATE VIRTUAL TABLE program_search USING fts5(program_id UNINDEXED, content, tokenize = 'unicode61 remove_diacritics 2');

INSERT INTO admin_settings (key, value, updated_at) VALUES ('stale_after_days', '90', 0)
  ON CONFLICT(key) DO NOTHING;

-- Taxonomia inicial (só nomes de categorias; nenhum programa, preço ou link).
INSERT INTO categories (id, slug, segment, name_pt, name_en, name_es) VALUES
  ('cat_pt_electronics', 'electronics', 'physical', 'Eletrônicos', 'Electronics', 'Electrónica'),
  ('cat_pt_home', 'home_garden', 'physical', 'Casa e jardim', 'Home and garden', 'Hogar y jardín'),
  ('cat_pt_fashion', 'fashion', 'physical', 'Moda', 'Fashion', 'Moda'),
  ('cat_pt_beauty', 'beauty_health', 'physical', 'Beleza e saúde', 'Beauty and health', 'Belleza y salud'),
  ('cat_pt_sports', 'sports', 'physical', 'Esportes', 'Sports', 'Deportes'),
  ('cat_saas_ai', 'ai_tools', 'saas', 'Ferramentas de IA', 'AI tools', 'Herramientas de IA'),
  ('cat_saas_marketing', 'marketing_tools', 'saas', 'Marketing e vendas', 'Marketing and sales', 'Marketing y ventas'),
  ('cat_saas_productivity', 'productivity', 'saas', 'Produtividade', 'Productivity', 'Productividad'),
  ('cat_saas_hosting', 'hosting_domains', 'saas', 'Hospedagem e domínios', 'Hosting and domains', 'Hosting y dominios'),
  ('cat_saas_design', 'design_video', 'saas', 'Design e vídeo', 'Design and video', 'Diseño y vídeo'),
  ('cat_dig_courses', 'courses', 'digital', 'Cursos online', 'Online courses', 'Cursos en línea'),
  ('cat_dig_ebooks', 'ebooks', 'digital', 'E-books e infoprodutos', 'E-books and info products', 'E-books e infoproductos'),
  ('cat_dig_templates', 'templates', 'digital', 'Templates e ativos digitais', 'Templates and digital assets', 'Plantillas y activos digitales'),
  ('cat_srv_finance', 'finance', 'services', 'Finanças', 'Finance', 'Finanzas'),
  ('cat_srv_travel', 'travel', 'services', 'Viagens', 'Travel', 'Viajes'),
  ('cat_srv_education', 'education_services', 'services', 'Educação e mentorias', 'Education and coaching', 'Educación y mentorías');

-- Redes e plataformas: só o nome. URL, status e condições ficam "não verificados"
-- até um editor registrar fonte oficial. ShareASale: migração para a Awin noticiada
-- na imprensa do setor; estado exato a confirmar na fonte oficial.
INSERT INTO affiliate_networks (id, name, name_key, kind, operational_status, notes, created_at, updated_at) VALUES
  ('net_awin', 'Awin', 'awin', 'network', 'unverified', NULL, 0, 0),
  ('net_shareasale', 'ShareASale', 'shareasale', 'network', 'migrating', 'Migração para a Awin noticiada; confirmar o estado na fonte oficial.', 0, 0),
  ('net_cj', 'CJ Affiliate', 'cj affiliate', 'network', 'unverified', NULL, 0, 0),
  ('net_impact', 'Impact', 'impact', 'platform', 'unverified', NULL, 0, 0),
  ('net_rakuten', 'Rakuten Advertising', 'rakuten advertising', 'network', 'unverified', NULL, 0, 0),
  ('net_partnerstack', 'PartnerStack', 'partnerstack', 'platform', 'unverified', NULL, 0, 0),
  ('net_hotmart', 'Hotmart', 'hotmart', 'platform', 'unverified', NULL, 0, 0),
  ('net_eduzz', 'Eduzz', 'eduzz', 'platform', 'unverified', NULL, 0, 0),
  ('net_monetizze', 'Monetizze', 'monetizze', 'platform', 'unverified', NULL, 0, 0),
  ('net_kiwify', 'Kiwify', 'kiwify', 'platform', 'unverified', NULL, 0, 0),
  ('net_amazon', 'Amazon Associates', 'amazon associates', 'network', 'unverified', NULL, 0, 0),
  ('net_lomadee', 'Lomadee', 'lomadee', 'network', 'unverified', NULL, 0, 0);
