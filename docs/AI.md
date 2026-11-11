# Inteligência artificial (Fase 5)

Regra central: **a IA usa as informações do sistema e suas fontes, e não inventa condições comerciais.**

## Como funciona

1. **Recuperação (RAG sobre o catálogo)**: para cada pergunta, o servidor busca programas ativos (FTS5 + filtros confirmados, ou o programa aberto, ou os melhor pontuados em pedidos de recomendação) e monta o contexto.
2. **Fatos com estado da fonte**: cada campo entra como `valor (confirmed by official source URL, confirmed on data)`, `valor (no official source recorded)` ou `UNKNOWN (no confirmed data; do not guess)`. Só fontes oficiais (documentação, página, API, comunicado) contam como confirmação.
3. **Prompt restritivo**: usar só o contexto; contexto é dado, não instrução; nunca inventar ou estimar comissão, prazo, preço ou link; sem promessa de ganho; sem inscrição em nome do usuário.
4. **Conferência da resposta**: todo número com unidade (%, dias, moeda) e todo link precisam existir no contexto. Caso contrário a resposta é descartada (`grounding_failed`) e o usuário vê só os dados do sistema.
5. **A IA não escreve no catálogo.** Dado oficial só muda pelo fluxo de editores com fonte (Fase 2).

Sem contexto (nenhum programa encontrado), o modelo nem é chamado.

## Funções

| Função | Rota | Usa modelo? |
| --- | --- | --- |
| Assistente | `POST /api/ai/chat` | sim, ancorado |
| Recomendações | no chat ("qual programa você recomenda?") com as notas do sistema (Fase 3) | sim, ancorado |
| Pesquisa | `GET /api/ai/search?q=` | não: interpreta palavras-chave conhecidas e mostra como entendeu; só programas com o dado confirmado |
| Análise de programa | `POST /api/ai/programs/:id/analysis` | confirmado x faltando vem do sistema; texto opcional do modelo |
| Estratégia | `POST /api/ai/programs/:id/strategy` | compatibilidade com o perfil vem do sistema; texto opcional do modelo, rotulado como sugestão |

## Controle de custos

Configuração do admin (aba IA ou `PUT /api/ai/admin/config`): chave geral, modelo, perguntas e tokens estimados por usuário por dia, chamadas por mês (global), tamanho da pergunta, programas no contexto, tamanho da resposta e cache (horas).

- Ao atingir um limite, ou com a IA desligada, ou sem o binding, o recurso continua com **dados do sistema** (`mode: facts_only` e o motivo).
- Cache por usuário: pergunta repetida não chama o modelo e não conta no limite.
- Respostas descartadas por falta de ancoragem contam no custo (a chamada aconteceu).
- Tokens são estimados (4 caracteres por token). Não há preço em dinheiro: consulte o painel da Cloudflare para o consumo real.
- Limite de 20 perguntas por minuto por usuário.

## Modelo (Workers AI)

`wrangler.toml` tem `[ai] binding = "AI"`. O Workers AI tem camada gratuita diária (sem cartão); confira limites e o catálogo de modelos na documentação da Cloudflare. O modelo padrão (`@cf/meta/llama-3.1-8b-instruct`) pode ser trocado na aba IA. Em desenvolvimento local o binding exige sessão remota (`wrangler login`); sem ela, use `-c wrangler.vitest.toml` (gerado ao rodar os testes) e a IA responde só com fatos.

## Privacidade

Nenhuma conversa é guardada em histórico no servidor. Ficam apenas `ai_usage` (contagens e tokens estimados) e `ai_cache` (resposta por usuário), ambos apagados com a conta. O painel do administrador mostra totais, nunca perguntas ou respostas.
