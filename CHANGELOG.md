# Changelog

## Fase 2 — Catálogo (0.2.0)

### Implementado

- Migration `0002_catalog.sql`: redes, anunciantes, categorias, programas (campos de aceitação tri-estado), fontes, histórico imutável, produtos, ofertas e índice FTS5.
- Regras compartilhadas (`packages/shared/src/catalog.ts`): estados de verificação, tipos de fonte, chave de deduplicação, esquemas Zod.
- API `/api/catalog`: leitura, busca e filtros para todos; gestão, fontes, verificação, ciclo de vida, produtos, ofertas e importação CSV para editor/admin.
- Telas `/programs`, `/programs/:id` e `/catalog` em PT-BR, EN-US e ES.
- Documentação em `docs/CATALOG.md`.

### Testes executados

| Pacote | Testes | Resultado |
| --- | --- | --- |
| `@ai/shared` | 22 | passaram |
| `@ai/api` (Workers + D1 via Miniflare) | 50 | passaram |
| `@ai/web` (jsdom) | 22 | passaram |

Também: `tsc` limpo nos três pacotes, `vite build`, e teste manual ponta a ponta com `wrangler dev` e as duas migrations (recusa de fato sem fonte, busca, importação com duplicado, fallback de SPA).

### Limitações conhecidas

- O catálogo começa sem programas; as redes semeadas têm só o nome. ShareASale está como "em migração" com base na imprensa do setor; confirmar na fonte oficial.
- Verificação é manual; coleta automatizada e IA ficam para fases futuras, sempre com aprovação humana.
- Importação limitada a 100 linhas por vez; não há exclusão de fontes ou programas.
- Continuam valendo as limitações da Fase 1 (e-mail e deploy não testados com contas reais; sem testes de navegador).

## Fase 1 — Fundação (0.1.0)

### Implementado

- Monorepo (npm workspaces): `apps/api`, `apps/web`, `packages/shared`.
- API em Hono sobre Cloudflare Workers com D1 e migration `0001_init.sql`.
- Autenticação por link mágico, sessões, logout, perfil, onboarding, exportação e exclusão de conta.
- Painel de administração: usuários e papéis, planos configuráveis, auditoria.
- Frontend React com PT-BR, EN-US e ES (beta), Tailwind e PWA básico.
- Workflow de GitHub Actions: testes, migrations remotas e deploy na Cloudflare a cada push na `main`.

### Testes executados

| Pacote | Testes | Resultado |
| --- | --- | --- |
| `@ai/shared` | 10 | passaram |
| `@ai/api` (Workers + D1 via Miniflare) | 28 | passaram |
| `@ai/web` (jsdom) | 16 | passaram |

Também executados: `tsc` sem erros nos três pacotes, `vite build`, e um teste manual ponta a ponta com `wrangler dev` (health, arquivo estático, fallback de SPA, login, verificação, `/api/me`, rota de admin e bloqueio de POST sem cabeçalho anti-CSRF).

### Limitações conhecidas

- O envio real de e-mail não foi testado: depende de uma chave do provedor (Resend) e de remetente verificado.
- O deploy na Cloudflare não foi executado: exige a conta e os segredos do usuário e o repositório no GitHub.
- Não há testes de navegador de ponta a ponta (Playwright); a interface é coberta por testes de componentes.
- Rate limit baseado em D1; adequado para o login, não para tráfego alto.
- Catálogo, pontuação, simulador e demais módulos não existem ainda (Fases 2 a 9).
