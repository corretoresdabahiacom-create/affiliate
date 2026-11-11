# Affiliate Intelligence AI

Plataforma SaaS de descoberta, inteligência e gestão de marketing de afiliados. Este repositório está na **Fase 5 (inteligência artificial)**; o estúdio de conteúdo, as integrações, o analytics e a produção vêm nas fases seguintes (veja o roadmap abaixo).

## O que já funciona (Fase 1)

- Login sem senha por link mágico (15 minutos, uso único), sessão em cookie `HttpOnly`.
- Perfil e onboarding (país, experiência, nichos, canais, orçamento), editável nas configurações.
- Papéis `user`, `editor` e `admin`; primeiro admin definido por `ADMIN_EMAILS`.
- Painel de administração: usuários e papéis, planos (preço e limites configuráveis, nenhum valor fixo no código) e log de auditoria somente de inserção.
- LGPD/GDPR: exportação dos próprios dados e exclusão da conta.
- Interface em PT-BR e EN-US completos e ES em beta; formatação de moeda e data por localidade.
- PWA básico (manifest, ícones, service worker que nunca guarda `/api/*`).
- Proteções: cabeçalhos de segurança, CSRF por cabeçalho + checagem de `Origin`, limite de taxa no login, validação com Zod no backend, tokens guardados só como hash SHA-256.

## O que já funciona (Fase 2)

- Catálogo global de redes, empresas, programas, produtos e ofertas, com categorias em PT/EN/ES.
- Busca de texto (FTS5) e filtros: segmento, categoria, rede, aceita Brasil, recorrente, tipo de tráfego, só verificados.
- Fontes por campo (6 tipos, 4 oficiais), estados de verificação, histórico imutável de alterações e ciclo de vida (encerrados saem da lista).
- Regra de integridade: "sim/não" e valores comerciais só entram com fonte oficial do mesmo campo. Veja [docs/CATALOG.md](docs/CATALOG.md).
- Gestão para editores e administradores, com importação CSV (simulação, duplicados, erros).
- O catálogo começa sem nenhum programa: nada foi inventado.

## O que já funciona (Fase 3)

- Pontuação de 0 a 100 em duas dimensões independentes: qualidade dos dados e atratividade comercial, com justificativa separada em confirmado, interpretação e não verificado. Pesos e faixas editáveis pelo administrador.
- Comparação lado a lado de 2 a 4 programas, compatibilidade com brasileiros e recomendações (disponível só com aceitação confirmada).
- Simulador de comissões (cliques, vendas, meta) e de SaaS recorrente com cenários de cancelamento, sempre rotulado como simulação.
- Central de alertas derivada do histórico, com fonte e data de verificação. Veja [docs/INTELLIGENCE.md](docs/INTELLIGENCE.md).

## O que já funciona (Fase 4)

- Onboarding e perfil ampliado (idiomas, audiência, horas por semana, preferência por físico/SaaS).
- **Meus programas**: 8 status, datas de inscrição/aprovação, ID de afiliado, condições aceitas, anotações, próxima ação, documentos (só referências) e histórico. Programa encerrado no catálogo é sinalizado e não pode ficar "em andamento".
- **Links**: registro com programa, produto, campanha, canal e identificador; QR code gerado no navegador; redirecionamento rastreável próprio só quando o programa **confirmou** permitir. Veja [docs/OPERATIONS.md](docs/OPERATIONS.md).
- **Campanhas** por canal (incluindo tráfego pago, que consulta a regra do programa antes).
- **Comissões**: estimada → pendente → aprovada → paga, com reembolso, cancelamento, chargeback e ajuste; importação CSV do relatório da rede e conciliação.
- **Painel** com indicadores separados por moeda, status e origem.

## O que já funciona (Fase 5)

- **Assistente de IA** ancorado no catálogo: só recebe os fatos do sistema, cada um com o estado da fonte (confirmado por fonte oficial, sem fonte, ou DESCONHECIDO). Se um dado não está confirmado, a resposta diz isso.
- **Conferência automática**: número com unidade (%, dias, moeda) ou link que não esteja nas fontes derruba a resposta; o usuário vê só os dados do sistema.
- Análise de programa (confirmado x faltando, calculado pelo sistema + texto do modelo), estratégia (compatibilidade com o perfil calculada sem IA + sugestão do modelo) e pesquisa em linguagem natural que só devolve programas com o dado confirmado.
- **Controle de custos**: limites por usuário (perguntas e tokens estimados por dia) e global por mês, cache, chave geral para desligar, uso agregado para o administrador. Sem modelo ou no limite, o recurso continua com dados do sistema. Veja [docs/AI.md](docs/AI.md).

## Estúdio (Fase 6, primeira parte)

Inspirado no anúncio de uma plataforma de dropshipping (calendário de produtos sazonais + criação de anúncio em um clique), adaptado às regras deste projeto. Detalhes em [docs/STUDIO.md](docs/STUDIO.md).

- **Calendário sazonal**: nichos por mês cadastrados por editores. Percentual ou métrica só é publicado com a fonte citada; sem dado cadastrado, a tela diz que está vazio. Nada vem pré-carregado.
- **Rascunhos de divulgação em lote** (até 10 programas): título e descrição a partir do catálogo, com descrição opcional da IA conferida contra o catálogo, aviso de afiliado no idioma escolhido e checagem do canal (blog, YouTube, Instagram, TikTok, e-mail). Você revisa, aprova e copia. Nada é publicado em nenhum canal.

## Estrutura

```text
apps/api        Worker (Hono) + D1; serve também o frontend estático
apps/web        React + Vite + Tailwind (PWA, i18n)
packages/shared tipos, enums e schemas Zod compartilhados
docs/           arquitetura e deploy
```

## Rodando localmente

Requer Node 20+.

```bash
npm install --legacy-peer-deps
cp apps/api/.dev.vars.example apps/api/.dev.vars   # edite ADMIN_EMAILS
npm run db:migrate:local
npm run build                                      # gera apps/web/dist
npm run dev:api                                    # http://localhost:8787 (API + app)
```

Em desenvolvimento (`ENVIRONMENT=development`) a API devolve o link de acesso na resposta e a tela de login mostra um botão para abri-lo, sem precisar de e-mail. Em produção isso nunca acontece. Para trabalhar só no frontend com recarga rápida, rode também `npm run dev:web` (porta 5173, com proxy para a API).

## Testes

```bash
npm test            # shared + api (Workers/D1 reais via Miniflare) + web
npm run typecheck
```

## Deploy gratuito, sem cartão

Tudo roda no plano gratuito da Cloudflare (Workers, D1, arquivos estáticos). Passo a passo em [docs/DEPLOY.md](docs/DEPLOY.md). A cada push na `main`, o workflow `.github/workflows/deploy.yml` testa, aplica as migrations e publica.

Limites do plano gratuito a ter em mente: 100.000 requisições por dia, 10 ms de CPU por requisição, 5 milhões de leituras e 100 mil escritas por dia no D1. Detalhes e a recomendação de migrar para o plano pago em produção estão em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Roadmap

| Fase | Conteúdo | Estado |
| --- | --- | --- |
| 0 | Auditoria e arquitetura | Concluída |
| 1 | Fundação: conta, perfil, admin, i18n, PWA | **Concluída** |
| 2 | Catálogo de programas com fontes e verificação | **Concluída** |
| 3 | Pontuação, simulador, comparação, recomendações, alertas | **Concluída** |
| 4 | Gestão do afiliado: programas, links, campanhas, comissões | **Concluída** |
| 5 | Inteligência artificial: assistente, análise, estratégia, pesquisa, RAG, custos | **Concluída** |
| 6 | Estúdio de conteúdo | **Em andamento**: calendário sazonal e rascunhos de divulgação prontos (0.6.0) |
| 7 | Integrações e automações (APIs oficiais, n8n, e-mail, notificações, publicação) | Planejada |
| 8 | Analytics e monetização (cliques, conversões, rentabilidade, relatórios) | Planejada |
| 9 | Segurança e produção (auditoria, backup, performance) | Planejada |

## Princípios do produto

Não inventar programas, preços, comissões ou links. Campos de aceitação têm três estados (`yes`, `no`, `unverified`) e ausência de dado nunca vira confirmação. Clique não é venda, comissão estimada não é aprovada e aprovada não é paga. Nenhuma promessa de ganho.
