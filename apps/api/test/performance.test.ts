import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

/**
 * Consultas quentes (as que rodam a cada requisição, no agendador ou em listas do usuário) precisam usar índice.
 * Se uma consulta nova varrer uma tabela inteira, este teste mostra qual.
 */
const HOT: Array<[string, string, unknown[]]> = [
  ["sessão", "SELECT u.id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?", ["h", 1]],
  ["links do usuário", "SELECT * FROM affiliate_links WHERE user_id = ? ORDER BY created_at DESC", ["u"]],
  ["link por código", "SELECT * FROM affiliate_links WHERE code = ?", ["c"]],
  ["cliques por link", "SELECT COUNT(*) FROM link_clicks WHERE link_id = ? AND at >= ?", ["l", 1]],
  ["cliques do usuário no período", "SELECT COUNT(*) FROM link_clicks WHERE user_id = ? AND at >= ? AND at < ?", ["u", 1, 2]],
  ["comissões do usuário", "SELECT * FROM commissions WHERE user_id = ? AND status = ?", ["u", "approved"]],
  ["campanhas do usuário", "SELECT * FROM campaigns WHERE user_id = ?", ["u"]],
  ["programas salvos", "SELECT * FROM user_programs WHERE user_id = ?", ["u"]],
  ["entregas de webhook pendentes", "SELECT * FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 20", [1]],
  ["notificações do usuário", "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", ["u"]],
  ["assinaturas vencendo", "SELECT * FROM subscriptions WHERE status = 'active' AND current_period_end <= ?", [1]],
  ["pagamentos do usuário", "SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 20", ["u"]],
  ["uso de IA no mês", "SELECT COUNT(*) FROM ai_usage WHERE user_id = ? AND mode = 'llm' AND at >= ?", ["u", 1]],
  ["anúncios do usuário", "SELECT * FROM marketplace_listings WHERE user_id = ? ORDER BY created_at DESC, id", ["u"]],
  ["limpeza de cliques antigos", "DELETE FROM link_clicks WHERE at < ?", [1]],
  ["sessões vencidas (limpeza)", "DELETE FROM sessions WHERE expires_at < ?", [1]],
];

describe("planos de consulta", () => {
  for (const [name, sql, args] of HOT) {
    it(`${name} não varre a tabela inteira`, async () => {
      let rows: Array<{ detail: string }>;
      try {
        rows = (await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...args).all<{ detail: string }>()).results;
      } catch (e) {
        throw new Error(`consulta inválida (${name}): ${(e as Error).message}`);
      }
      // "SCAN tabela" sem "USING INDEX" é varredura completa; "SCAN ... USING COVERING INDEX" lê só o índice.
      const full = rows.filter((r) => /\bSCAN\b/.test(r.detail) && !/USING (COVERING )?INDEX/.test(r.detail) && !/USING INTEGER PRIMARY KEY/.test(r.detail));
      expect(full.map((r) => r.detail)).toEqual([]);
    });
  }
});
