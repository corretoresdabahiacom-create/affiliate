# Arquitetura (Fases 1 e 2)

## Visão geral

```text
Navegador (React PWA)
   │  fetch /api/*  (cookie HttpOnly, cabeçalho X-Requested-With)
   ▼
Cloudflare Worker (Hono)  ── arquivos estáticos de apps/web/dist (mesma origem)
   │
   ▼
D1 (SQLite): users, user_profiles, sessions, login_tokens,
             rate_limits, plans, admin_settings, audit_logs,
             affiliate_networks, advertisers, categories, affiliate_programs,
             program_sources, program_history, products, offers, program_search (FTS5)
```

Frontend e API na mesma origem eliminam CORS e simplificam o cookie de sessão.

## Decisões

| Tema | Decisão | Motivo |
| --- | --- | --- |
| Login | Link mágico, sem senha | O plano gratuito do Workers dá 10 ms de CPU por requisição; hash de senha não cabe |
| Sessão | Token aleatório de 256 bits; só o hash SHA-256 fica no D1; cookie `HttpOnly`, `SameSite=Lax`, 30 dias | Vazamento do banco não entrega sessões |
| Link de acesso | 15 minutos, uso único, consumo atômico (`UPDATE ... WHERE used_at IS NULL`) | Evita reutilização e corrida entre pedidos |
| Enumeração de contas | `/api/auth/login` responde igual exista ou não a conta | Não revela quem tem cadastro |
| CSRF | `SameSite=Lax` + exigência de `X-Requested-With: fetch` + checagem de `Origin` | Formulários de outros sites não conseguem o cabeçalho |
| Isolamento | Toda tabela privada tem `user_id`; as rotas leem o usuário da sessão, nunca de parâmetro | Um usuário só alcança os próprios dados |
| Auditoria | Triggers bloqueiam `UPDATE` e `DELETE`; `user_id` sem chave estrangeira | Registro sobrevive à exclusão da conta, com id pseudônimo |
| Planos | Preço e limites em tabela, editáveis pelo admin, `NULL` por padrão | Nenhum valor comercial fixo no código |
| Papéis | `user`, `editor`, `admin`; admin não altera o próprio papel | Evita ficar sem administrador por engano |

## Limites do plano gratuito (conferidos na documentação oficial da Cloudflare)

- Workers: 100.000 requisições por dia, 10 ms de CPU por requisição, 50 subrequisições por invocação; cada consulta ao D1 conta como subrequisição.
- D1: 5 milhões de linhas lidas e 100 mil escritas por dia, 5 GB no total, redefinição às 00:00 UTC; ao exceder, as consultas falham.

Para uso real com clientes, o Workers Paid (a partir de US$ 5 por mês) remove os tetos diários. O código não muda.

## Próximas fases

- **Fase 2 (feita):** catálogo global; veja [CATALOG.md](CATALOG.md). Busca com FTS5 para caber nas leituras diárias do D1; importação em lotes de até 100 linhas por causa do limite de subrequisições.
- **Fase 3 (feita):** pontuação, comparação, simulador, recomendações e alertas; veja [INTELLIGENCE.md](INTELLIGENCE.md). Cálculo em funções puras no pacote compartilhado, configuração em `admin_settings`, alertas derivados do histórico imutável.
- **Fase 4:** gestão do afiliado (programas salvos, inscrições, links, campanhas, comissões manuais).
- **Eventos de alto volume (Fase 8):** cliques no Analytics Engine e agregação diária no D1; nunca uma linha por clique.
- **Rate limit:** hoje usa o D1 (poucas escritas, só no login). Se o tráfego crescer, migrar para o recurso nativo de rate limiting do Workers.
