# Changelog

## 0.11.0 — Fase 8: analytics e monetização

### Novo
- **Rentabilidade por campanha** (`/api/analytics/profitability`, tela Relatórios): ROI realizado (só comissão aprovada/paga), ROI projetado (inclui pendente e estimada, nunca apresentado como recebido), EPC e taxa de conversão sobre cliques do redirecionamento próprio. Sem custo ou sem cliques o indicador é `null` (traço na tela). Moedas diferentes nunca se misturam; comissão em outra moeda fica fora do ROI e é sinalizada. Reembolsos e estornos entram líquidos.
- **Relatórios** (`/api/analytics/report`): séries por dia/semana/mês, por programa e pendentes/estimadas por idade (0-30, 31-60, 61-90, 90+) para cobrar a rede após o período de validação. Exportação CSV com proteção contra injeção de fórmula. Recurso `reports` controlado pelo plano.
- **Assinaturas e pagamentos** (`/api/billing`, tela Plano): teste gratuito (dias configuráveis, uma vez por usuário), renovação, cancelamento ao fim do período, inadimplência com carência configurável e volta ao Free sem apagar dados. Pagamento é registrado pelo administrador (manual, idempotente por comprovante), com cortesia e reembolso.
- **Limites por plano** aplicados em programas salvos, links, campanhas, consultas mensais à IA e relatórios; editáveis em Admin > Planos. Chave ausente = ilimitado, 0 = desligado, administrador sem limite. Resposta `402 plan_limit`.
- **Receita no Admin**: receita mensal recorrente (preço de tabela das assinaturas ativas), recebido em 30 dias, por status; sempre por moeda.
- Passo `billing` no agendador (a cada 10 min, fatia de 10% do orçamento): trial acabou, período venceu, carência acabou; avisos por notificação traduzida.
- Exportação LGPD inclui assinatura e pagamentos.

### Banco
`0011_billing.sql`: `subscriptions`, `payments` (índice único por provedor+comprovante) e limites iniciais dos planos (somente se ainda `{}`). Preços continuam vazios até o administrador definir.

### Limitações
- Nenhum gateway integrado (exige análise de custos, disponibilidade, requisitos legais e aprovação explícita). Não há cobrança automática nem Pix/cartão.
- Mudança de plano com assinatura ativa exige cancelar antes (sem pró-rata).
- O limite de IA por plano não tem teste de ponta a ponta (o ambiente de teste não tem Workers AI).
- Excluir a conta apaga também os pagamentos (cascata); retenção fiscal deve ser avaliada antes de operar comercialmente.

## 0.10.0 — Auditoria: limites do plano gratuito e correções

### Erro principal encontrado
No plano gratuito da Cloudflare cada requisição pode fazer 50 consultas ao D1 e 50 chamadas externas. Medido nos testes antes da correção:
importar 500 linhas = 1.003 consultas; montar 50 rascunhos = 107; ajustar 50 = 102; autorizar 50 = 102; publicar 50 = 305 consultas e 150 chamadas; buscar 120 pedidos = 366. Em produção, essas ações falhariam.

### Corrigido
- Medidor de consultas por requisição (`budget.ts`); testes em modo estrito (`STRICT_BUDGET=1`).
- Gravação em lote na importação do fornecedor, montagem, ajuste e autorização em lote, pedidos e sincronização. Depois: 9, 9, 4, 4, 11 e 4 consultas.
- Publicação em etapas (`pendingIds`), com a tela repetindo até terminar; texto da IA em etapas (`/listings/ai-text`).
- Agendador a cada 10 minutos, com fatias de orçamento por tarefa e rodízio entre usuários; `WORKER_PLAN=paid` para contas pagas.
- Webhooks: endpoint desligado não gera falhas nem avisos repetidos; fila descartada ao desligar; teste manual responde pelo próprio ping; resposta descartada sem leitura.
- Alertas: o marco de cada passada é o próprio relógio (sem duplicar nem perder); `alert.new` informa `total` e `truncated`.
- Monitor: mesma página em vários campos verificada e avisada uma vez; leitura limitada a 1 MB de fato; avisos e eventos de seguidores em lote.
- Gancho de entrada: id fora do formato não consulta o banco; falhas limitadas por IP sem esgotar a cota do dono.
- Autorização em lote não autoriza anúncio editado no meio do caminho (`changed_meanwhile`).
- Notificações no idioma de quem lê (valores em `data`, migration `0010`).
- Espanhol padronizado em "tú" (36 textos estavam em "usted"); texto do cancelamento de e-mail em 3 idiomas.
- Versões dos pacotes alinhadas ao CHANGELOG.

### Novo
- Disjuntor do estoque automático: se uma importação zerar de uma vez boa parte da loja, a sincronização pausa e avisa, sem tocar na Shopee.

## Fase 7 — Integrações e automações (0.9.0)

- Migration `0009_automation.sql`: `webhook_endpoints`, `webhook_deliveries`, `inbound_hooks`, `notifications`, `source_checks`; `alert_prefs` ganha `email_enabled`, `last_digest_at`, `last_event_at`.
- Webhooks de saída assinados (HMAC-SHA256) com reenvio e desativação automática; gancho de entrada por token (`notify`, `supplier.import`).
- Notificações internas, resumo por e-mail opt-in com cancelamento em 1 clique, evento `alert.new`.
- Monitor de fontes oficiais: só avisa, nunca altera o catálogo.
- Agendador de hora em hora (reenvio, resumos, monitor; estoque a cada 6 h; limpeza diária).
- Telas `/automations` e `/notifications`. Documentação em `docs/AUTOMATION.md`.
- Testes: shared 105, api 170, web 76; typecheck e build limpos.
- Não verificado contra n8n/Resend reais. Sem conectores de redes de afiliados (sem documentação verificada).

## Fase 6 (parte 3) — Operação da loja (0.8.0)

Pedido: implementar o que ficou de fora da parte 2.

### Implementado

- Migration `0008_store_ops.sql`: variações e atributos nos anúncios, `update_status`, `marketplace_orders`.
- Variações (2 níveis, até 50 modelos) com preço e estoque por modelo; importação por CSV agrupada por produto.
- Atributos obrigatórios da categoria bloqueiam a autorização até serem preenchidos.
- Edição de anúncios publicados com nova autorização; campos estruturais travados; criação idempotente do item e das variações.
- Comparação e aplicação de estoque/preço do fornecedor (sempre como alteração pendente) e estoque automático opcional via agendador.
- Pedidos sem dados do comprador, ficha do fornecedor (compra manual), andamento manual e rastreio. Tela `/orders`.

### Testes

`@ai/shared` 94, `@ai/api` 146, `@ai/web` 69; typecheck e build limpos; migração aplicada em e2e local.

### Não verificado

Nada foi testado contra Shopee/WeDrop reais; ver `docs/INTEGRATIONS.md`.

## Fase 6 (parte 2) — Integração Shopee/fornecedor e montagem de loja (0.7.0)

Pedido: reproduzir o fluxo do vídeo (catálogo do fornecedor, preços, publicação na Shopee e montagem de 50 anúncios), com publicação só após revisão e autorização humana.

### Implementado

- Migration `0007_market.sql`: `integration_connections` (segredos cifrados), `supplier_products`, `marketplace_listings`; tudo apagado com a conta; exportação sem segredos.
- Cofre AES-GCM (`CREDENTIALS_KEY`), cliente Shopee Open Platform v2 (assinatura HMAC, OAuth, renovação de token, categorias, canais, imagens, `add_item`), conector de fornecedor configurável e importação CSV/JSON com simulação.
- API `/api/integrations` e `/api/market`: montagem de até 50 rascunhos, edição em lote de categoria/envio/peso, autorização com confirmação da quantidade, publicação com reserva atômica e erro da Shopee registrado.
- Telas `/integrations` e `/store` em PT-BR, EN-US e ES.
- Correção: `callModel` agora limpa o temporizador e trata rejeição tardia; o teste do erro de modelo (Fase 5) deixou de gerar erro não tratado que fazia o comando de testes sair com falha.

### Testes

| Pacote | Testes | Resultado |
| --- | --- | --- |
| `@ai/shared` | 79 | passaram |
| `@ai/api` | 136 | passaram |
| `@ai/web` | 60 | passaram |

### Limitações (leia antes de usar)

- **Nada foi testado contra a Shopee ou a WeDrop reais** (sem credenciais aqui). Respostas simuladas; assinatura conferida por cálculo independente.
- **WeDrop não tem documentação pública de API**: não há endpoints dela no código; use o conector configurável ou CSV/JSON.
- Sem variações, atributos obrigatórios por categoria, edição de anúncio publicado, sincronização de estoque/preço pós-publicação, pedidos ou rastreio.
- Margem sem taxas, comissão e frete da Shopee (não estimados).

## Fase 6 (parte 1) — Estúdio: calendário sazonal e rascunhos (0.6.0)

Origem: vídeo de anúncio de uma plataforma de dropshipping (produtos sazonais, "quero anunciar esse produto", montagem de loja automática). Foi adaptado ao SaaS de afiliados, sem copiar números de marketing, marca nem integrações de terceiros.

### Implementado

- Migration `0006_studio.sql`: `seasonal_entries`, `seasonal_entry_programs`, `ad_drafts` (rascunhos apagados com a conta e incluídos em `/api/me/export`).
- API `/api/studio`: calendário (leitura para todos, escrita só para editor/admin, com auditoria) e rascunhos (gerar em lote até 10, editar, aprovar, descartar, exportar texto, excluir).
- Regras: métrica sazonal exige rótulo, valor e link da fonte; programas fora do ar são ignorados; canal que o programa não aceita (`no`) bloqueia a aprovação; canal não verificado exige confirmação do usuário; texto com promessa de ganho ou com número/link fora do catálogo não é aprovado; editar um rascunho aprovado reabre a aprovação; só aprovado pode ser copiado; a divulgação de afiliado é incluída no texto.
- IA (opcional): só reescreve a descrição, conferida contra o catálogo; se falhar na conferência ou prometer ganho, vale o texto do catálogo. Conta nos mesmos limites de custo da Fase 5.
- Telas `/seasonal` e `/studio` em PT-BR, EN-US e ES.

### Testes

| Pacote | Testes | Resultado |
| --- | --- | --- |
| `@ai/shared` | 79 | passaram |
| `@ai/api` | 119 | passaram |
| `@ai/web` | 53 | passaram |

Também: `tsc` limpo, `vite build` e teste local com a migration 0006 aplicada.

### Fora do escopo (de propósito)

- Integração com WeDrop, Shopee ou outro marketplace e publicação automática de anúncios: exigem API e credenciais de terceiros, e o projeto não publica sem aprovação humana.
- Catálogo de produtos de terceiros, preços de revenda e "% de crescimento" prontos: não existem dados verificados para isso.
- O calendário começa vazio. Alguém da equipe editorial precisa cadastrar as entradas com fontes.
- O restante da Fase 6 (por exemplo, outros formatos de conteúdo) continua pendente.

## Fase 5 — Inteligência artificial (0.5.0)

### Implementado

- `packages/shared/src/ai.ts`: fatos do catálogo com estado da fonte, conferência de ancoragem (números e links), compatibilidade com o perfil, pesquisa em linguagem natural determinística, prompts e configuração de custos.
- Migration `0005_ai.sql` (`ai_usage`, `ai_cache`, apagadas com a conta) e API `/api/ai`: assistente, pesquisa, análise e estratégia por programa, status, configuração e uso (admin).
- Modelo: Workers AI (`[ai]` no `wrangler.toml`), sem cartão; injetável nos testes. Sem o binding, ou no limite, a IA responde só com dados do sistema.
- Telas: `/assistant` (chat e pesquisa), painel de análise/estratégia no programa e aba IA na administração. PT-BR, EN-US e ES.
- Documentação em `docs/AI.md`.

### Testes executados

| Pacote | Testes | Resultado |
| --- | --- | --- |
| `@ai/shared` | 72 | passaram |
| `@ai/api` (Workers + D1 via Miniflare) | 107 | passaram |
| `@ai/web` (jsdom) | 47 | passaram |

Também: `tsc` limpo, `vite build` e teste ponta a ponta com `wrangler dev` e as cinco migrations (sem modelo: resposta só com fatos e fontes; sem dados: nada inventado; pesquisa; uso do admin).

### Limitações conhecidas

- **O modelo real não foi testado**: o ambiente não tem credencial da Cloudflare. Os testes simulam o modelo, inclusive respostas com comissão e link inventados. Teste com o binding real após o deploy.
- A recuperação (RAG) usa busca textual FTS5 e filtros sobre o catálogo, sem vetores; funciona bem para nomes e atributos, menos para perguntas muito abstratas.
- Os limites usam tokens estimados (4 caracteres por token), não o consumo medido pela Cloudflare, e não há valor em dinheiro.
- A conferência checa números com unidade e links; afirmações sem número (ex.: "aceita brasileiros") dependem do prompt e do contexto.
- O histórico de conversa fica só no navegador; nada é guardado no servidor além de contagens e cache por usuário.
- Para testes, o `vitest.config.ts` gera `wrangler.vitest.toml` sem o `[ai]` (o binding exige sessão remota); está no `.gitignore`.

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
