# Changelog

## Fase 4 — Gestão do afiliado (0.4.0)

### Implementado

- Migration `0004_ops.sql`: `allows_redirect` no catálogo (tri-estado), perfil ampliado e tabelas `user_programs`, `user_program_history`, `user_program_docs`, `campaigns`, `affiliate_links`, `link_clicks`, `commissions`, `commission_adjustments` (todas apagadas em cascata com a conta).
- `packages/shared/src/ops.ts`: ciclo financeiro da comissão, valor líquido, conciliação, anti-bot e esquemas.
- API `/api/ops` (programas, links, campanhas, comissões, importação CSV, conciliação, painel) e redirecionamento público `/r/:code`.
- Telas: Meus programas, Links (com QR), Campanhas, Comissões (importação e conciliação), painel de operação, perfil ampliado e botão "Salvar e acompanhar" no programa. PT-BR, EN-US e ES.
- Exportação da conta (`/api/me/export`) inclui os dados operacionais.
- Documentação em `docs/OPERATIONS.md`.

### Testes executados

| Pacote | Testes | Resultado |
| --- | --- | --- |
| `@ai/shared` | 59 | passaram |
| `@ai/api` (Workers + D1 via Miniflare) | 87 | passaram |
| `@ai/web` (jsdom) | 40 | passaram |

Também: `tsc` limpo, `vite build` e teste ponta a ponta com `wrangler dev` e as quatro migrations (link rastreável recusado sem confirmação oficial; liberado após fonte oficial; `/r/código` responde 302 para a URL exata, conta 1 clique humano e ignora robô; rota desconhecida 404; páginas do app continuam servidas).

### Defeitos encontrados e corrigidos durante a fase

- Importação circular entre `index.ts` e `ops.ts` deixava os enums indefinidos em tempo de execução; constantes de status foram para `statuses.ts`.
- `INSERT` do perfil com 17 valores para 18 colunas; corrigido.

### Limitações conhecidas

- Documentos de programa são só título e link; nenhum arquivo é armazenado.
- Não há origem "API" ainda (sincronização com redes é da Fase 6); a importação CSV é a forma de trazer dados da rede.
- Cada clique vira uma linha no D1; alto volume exige agregação (Fase 8). Há teto de 500 cliques contados por link por hora.
- Preferências do perfil (físico/SaaS, horas, audiência, idiomas) são guardadas mas ainda não entram na pontuação.
- Tráfego pago é bloqueado/avisado só pelo campo `accepts_paid_traffic` do programa; não há integração com as plataformas de anúncio.
- O bundle do frontend passou de 500 kB por causa dos três idiomas; divisão em partes fica para a Fase 9.

## Fase 3 — Inteligência de oportunidades (0.3.0)

### Implementado

- Motor de pontuação puro (`packages/shared`): qualidade dos dados e atratividade comercial, faixas e pesos configuráveis, cobertura que reduz a nota de programas incompletos, justificativas em confirmado, interpretação e não verificado.
- Simulador (cliques, vendas, meta) e de SaaS recorrente com cenários de cancelamento e validação.
- Migration `0003_intel.sql` e API `/api/intel`: pontuação, comparação, recomendações, alertas e preferências, configuração de pontuação (admin).
- Telas: cartão de pontuação no programa, `/recommendations`, `/compare`, `/simulator`, `/alerts` e aba Pontuação na administração, em PT-BR, EN-US e ES.
- Documentação em `docs/INTELLIGENCE.md`.

### Testes executados

| Pacote | Testes | Resultado |
| --- | --- | --- |
| `@ai/shared` | 49 | passaram |
| `@ai/api` (Workers + D1 via Miniflare) | 66 | passaram |
| `@ai/web` (jsdom) | 31 | passaram |

Também: `tsc` limpo, `vite build` e teste ponta a ponta com `wrangler dev` e as três migrations (nota 0 sem fonte; 65 "moderada" com quatro fatos confirmados; recomendação e alertas com fonte).

### Defeito encontrado e corrigido durante a fase

- Um programa sem nenhum dado confirmado chegava à faixa "moderada" só pela adequação ao perfil. Agora, sem critério derivado do catálogo, a nota é 0 (teste de regressão incluído).

### Limitações conhecidas

- Alertas só no app; a frequência escolhida ainda não envia e-mail. Sem alertas de prazo, campanhas, desempenho e comissões (Fases 4 e 8).
- Reputação, demanda, conversão, concorrência e potencial de conteúdo não têm fonte de dados e ficam fora da nota.
- Recomendações por regras, sem IA (Fase 5); avalia até 300 programas ativos por consulta.

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
