-- Páginas de venda: páginas públicas simples (HTML gerado pelo servidor) e as imagens delas.
-- Imagens ficam no D1 em base64 (até ~350 KB cada, já reduzidas no navegador) para não depender de armazenamento pago.
CREATE TABLE sales_pages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  template_id TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER
);
CREATE INDEX idx_sales_pages_user ON sales_pages (user_id, updated_at);

CREATE TABLE page_images (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL REFERENCES sales_pages(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_page_images_page ON page_images (page_id);
CREATE INDEX idx_page_images_user ON page_images (user_id);
