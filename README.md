# Affiliate Intelligence AI

Plataforma SaaS de descoberta, inteligência e gestão de marketing de afiliados. Este repositório está na **Fase 3 (inteligência de oportunidades)**; a gestão do afiliado e a IA vêm nas fases seguintes (veja o roadmap abaixo).

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
| 4 | Inscrições, links e comissões manuais | Próxima |
| 5 a 9 | IA, conteúdo, integrações, analytics, produção | Planejadas |

## Princípios do produto

Não inventar programas, preços, comissões ou links. Campos de aceitação têm três estados (`yes`, `no`, `unverified`) e ausência de dado nunca vira confirmação. Clique não é venda, comissão estimada não é aprovada e aprovada não é paga. Nenhuma promessa de ganho.
