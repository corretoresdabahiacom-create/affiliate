# Monetização e analytics (Fase 8)

## Planos e limites
Os planos (`free`, `starter`, `pro`, `business`) vêm da tabela `plans`. **Preços e limites são do administrador** (Admin > Planos): nenhum valor fixo no código. A migração `0011` só preenche limites iniciais quando o plano ainda não tinha limites; preços ficam vazios.

| Chave | Efeito |
| --- | --- |
| `savedPrograms`, `links`, `campaigns` | máximo de registros do usuário |
| `aiRequestsMonthly` | chamadas reais ao modelo por mês (respostas em cache e "só fatos" não contam) |
| `reports` | 0 desliga os relatórios completos |

Chave ausente = ilimitado; `0` = desligado; administrador não tem limite. Estouro devolve `402 {"error":"plan_limit","key","limit","used"}`.

## Ciclo da assinatura
`incomplete` (aguardando pagamento) → `active` → `past_due` (carência) → `expired`; `trialing` (teste) → `expired`; `canceled`.
- Assinar sem teste cria uma pendência; **o plano só muda quando o administrador registra o pagamento**.
- Com teste (`billing.trialDays` > 0, uma vez por usuário) o plano vale na hora e expira sem pagamento.
- Pagamento registrado estende 1 mês (antecipado empilha no fim do período). Repetir o mesmo comprovante não duplica.
- Período vencido → `past_due` por `billing.graceDays` (padrão 7) → `expired` e plano Free. Dados nunca são apagados.
- Cancelar ativa agenda o fim do período; reembolso do período vigente encerra o acesso pago.
- O agendador (a cada 10 min) faz as transições e avisa por notificação.

## Pagamentos — estado e decisão pendente
Não há gateway integrado. O sistema aceita apenas `manual` (administrador registra o que recebeu) e `grant` (cortesia). A integração de pagamento só deve ser feita após análise de custos, disponibilidade no Brasil, requisitos legais/fiscais e **sua aprovação explícita**; nada foi verificado junto a nenhum provedor. O ponto de extensão é `recordPayment()` em `billing.ts`: um provedor futuro chama a mesma função (idempotente por `provider_ref`) a partir de um webhook assinado.

## Indicadores
- `ROI = (resultado − custo) / custo`. Realizado = aprovada + paga (líquida de reembolso/estorno); projetado = + pendente + estimada.
- `EPC = realizado / cliques próprios`; conversão = conversões confirmadas / cliques próprios.
- Sem custo informado ou sem cliques: `null`. Custo e comissão só são comparados na mesma moeda.
- Cliques medem apenas o redirecionamento próprio; clique não é venda e o rastreamento próprio não confirma venda.
- A Fase 4 já cobre conciliação com relatórios das redes (`/api/ops/reconciliation`).

## Relatórios
`GET /api/analytics/report?from&to&groupBy=day|week|month[&format=csv&section=series|programs|aging]`. Intervalo máximo de 366 dias. CSV com `'` na frente de células que começam com `= + - @`.
