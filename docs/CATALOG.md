# Catálogo de programas (Fase 2)

O catálogo é global (compartilhado por todos os usuários) e só é escrito por `editor` e `admin`. Qualquer usuário autenticado lê.

## Regra central: nada nasce confirmado

- Campos de aceitação (`accepts_brazil`, `accepts_individuals`, `requires_company`, `requires_website`, `accepts_social`, `accepts_paid_traffic`, `accepts_organic`, `is_recurring`) têm três estados: `yes`, `no`, `unverified`. O padrão é `unverified`, e ausência de dado nunca vira "sim".
- Para gravar `yes`/`no`, um valor de comissão, cookie, pagamento mínimo, validação, frequência de pagamento, ou marcar o link de inscrição como `verified`, é preciso que o programa tenha uma **fonte oficial** (`official_docs`, `official_page`, `official_api` ou `official_communication`) registrada **para aquele mesmo campo**. Caso contrário a API responde `422 official_source_required` com a lista de campos.
- Um programa novo não aceita nenhum desses fatos na criação (não há fonte ainda): cria-se primeiro, registra-se a fonte, depois se grava o dado.
- Fonte `secondary_reliable` ou `unconfirmed` pode ser registrada, mas não libera nenhum dado nem pode "confirmar" (`unofficial_source_cannot_confirm`).
- Trocar o link de inscrição derruba o status `verified` para `unverified`.
- "Marcar como verificado" exige ao menos uma fonte oficial. Reativar um programa encerrado exige fonte oficial para `lifecycle_status`.
- Programas `closed`, `suspended` e `unavailable` ficam fora da lista padrão; só editor/admin os consulta, pedindo `lifecycle=`.

## Estados de verificação

Calculados por `verificationState` (função pura em `packages/shared/src/catalog.ts`), nesta ordem de precedência: ciclo de vida não ativo (`closed`, `suspended`, `unavailable`) > `divergent` > `awaiting_update` > `never_verified` > `outdated` (mais de `stale_after_days`, padrão 90, configurável em `admin_settings`) > `verified_recently`.

## Modelo

`affiliate_networks`, `advertisers` (absorve "merchants"), `categories` (taxonomia semeada com nomes em PT/EN/ES), `affiliate_programs`, `program_sources`, `program_history` (somente inserção, por gatilho), `products`, `offers`, e `program_search` (FTS5, reindexada a cada escrita).

A migration semeia **apenas** nomes de categorias e de redes/plataformas. Nenhuma URL, comissão, termo ou programa foi inventado; todas as redes entram `unverified`. Exceção registrada: **ShareASale** entra como `migrating`, porque a imprensa do setor (Hello Partner, FMTC) noticia a migração para a Awin; a nota na própria linha diz que o estado exato deve ser confirmado na fonte oficial.

## API (`/api/catalog`)

| Método e rota | Quem | O que faz |
| --- | --- | --- |
| `GET /meta` | logado | redes, categorias, segmentos, prazo de desatualização |
| `GET /programs` | logado | busca e filtros: `q`, `segment`, `category`, `network`, `advertiser`, `accepts_brazil`, `recurring`, `individuals`, `requires_company`, `requires_website`, `traffic`, `payout_currency`, `verified`, `sort`, `limit`, `offset` |
| `GET /programs/:id` | logado | detalhe com fontes, histórico, produtos, ofertas |
| `GET /advertisers?q=` | logado | busca de empresas |
| `POST/PUT /networks`, `POST/PUT /advertisers`, `POST /categories` | editor/admin | cadastro |
| `POST /programs`, `PATCH /programs/:id` | editor/admin | cria e altera, com as regras acima e histórico |
| `POST /programs/:id/status` | editor/admin | ciclo de vida |
| `POST /programs/:id/sources` | editor/admin | registra fonte |
| `POST /programs/:id/verify` | editor/admin | `verify`, `flag_divergent`, `flag_awaiting`, `clear_flag` |
| `POST /programs/:id/products\|offers`, `DELETE /products\|offers/:id` | editor/admin | produtos e ofertas |
| `POST /import` | editor/admin | CSV (até 100 linhas), com `dryRun`; relata criados, duplicados e erros |

Filtros de aceitação com `yes` devolvem somente o que está **confirmado**.

## Interface

`/programs` (descoberta com filtros e selos de texto), `/programs/:id` (detalhe, fontes, histórico e, para editores, painel de edição) e `/catalog` (novo programa, redes, empresas, importação CSV). Textos em PT-BR, EN-US e ES.

## Limites conhecidos

- Não há exclusão de fonte nem de programa (por segurança do histórico); usa-se o ciclo de vida.
- A importação aceita 100 linhas por vez para caber nas 50 subrequisições do plano gratuito.
- Não há rastreamento automático de mudanças nas páginas dos programas; a verificação é manual por editores (coleta automatizada e IA ficam para fases futuras e sempre com revisão humana).
- Nenhum programa real foi cadastrado: o catálogo começa vazio de programas, por decisão do produto.
