-- Recria o índice de busca (FTS5) do catálogo. Mesma expressão de reindexStatements() em apps/api/src/catalog.ts;
-- o teste apps/api/test/backup.test.ts garante que o resultado é idêntico.
DELETE FROM program_search;
INSERT INTO program_search (program_id, content)
SELECT p.id,
  p.name || ' ' || a.name || ' ' || COALESCE(p.description, '') || ' ' ||
  COALESCE(n.name, '') || ' ' || COALESCE(c.name_pt || ' ' || c.name_en || ' ' || c.name_es, '')
FROM affiliate_programs p
JOIN advertisers a ON a.id = p.advertiser_id
LEFT JOIN affiliate_networks n ON n.id = p.network_id
LEFT JOIN categories c ON c.id = p.category_id;
