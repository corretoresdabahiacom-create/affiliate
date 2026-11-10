# Inteligência de oportunidades (Fase 3)

Tudo é calculado por funções puras em `packages/shared/src/intel.ts` e `simulator.ts` (testadas sem banco) e exposto pela API `/api/intel`. A interface está em `/recommendations`, `/compare`, `/simulator`, `/alerts`, no cartão de pontuação de cada programa e na aba **Pontuação** da administração.

## Duas dimensões independentes

**Qualidade dos dados (0–100)** mede quanto a plataforma sabe e consegue comprovar: aceitação (8 campos), comissão, cookie, saque mínimo, frequência de pagamento, validação, link de inscrição verificado, página oficial, existência de fonte oficial e frescor da verificação. A API só grava "sim/não" e valores comerciais com fonte oficial do mesmo campo; por isso, valor conhecido = confirmado. Divergência multiplica por 0,7 e programa encerrado, suspenso ou indisponível vale 0. A lista do que falta confirmar acompanha a nota.

**Atratividade comercial (0–100)** usa os 13 critérios do prompt, com pesos configuráveis:

| Critério | Como entra |
| --- | --- |
| Comissão | só percentual confirmado é pontuado (100% da nota em `commissionPercentFull`, padrão 40%); fixa ou escalonada não é comparável e fica "interpretação" |
| Recorrência | só se confirmada; duração pontua mais; nunca presumida |
| Cookie | dias confirmados, nota cheia em `cookieDaysFull` (60) |
| Aceitação de brasileiros | sim = 1, não = 0, não verificado = sem nota |
| Facilidade de inscrição | derivada só de empresa, site e pessoa física **confirmados** |
| Métodos de pagamento | frequência de pagamento confirmada |
| Valor mínimo de saque | só USD, EUR e GBP (sem conversão cambial inventada) |
| Reputação, demanda, conversão, concorrência, potencial de conteúdo | **sem dado no catálogo**: nunca avaliados nem inventados; ficam em "sem dado" |
| Adequação ao perfil | nicho × segmento, site exigido × site do usuário, preferência por recorrência |

Regras para não superestimar programa incompleto:

1. Só critérios com dado entram na média; a **cobertura** (peso avaliado ÷ peso total) reduz a nota: `nota = média × (0,5 + 0,5 × cobertura)`.
2. Sem nenhum critério derivado do catálogo (só o perfil), a nota é 0.
3. Com qualidade abaixo de `minQualityForTopBands` (padrão 40), a nota fica limitada à faixa "moderada".
4. Programa que não está ativo vale 0.

Faixas padrão do prompt (85 / 70 / 50 / 30) e todos os pesos, referências e a política de tráfego pago são editáveis pelo administrador e gravadas em `admin_settings` (`scoring_config`); a mudança fica na auditoria. Configuração inválida volta ao padrão.

Cada nota traz a justificativa dividida em **dados confirmados**, **interpretações** e **não verificado ou sem dado**. Estimativas só existem no simulador e vêm rotuladas como simulação. Nada é garantia de lucro.

## Compatibilidade com brasileiros e recomendações

- Para usuário do Brasil, "disponível" só com `accepts_brazil = yes` confirmado. "Não verificado" vai para **Para verificar** com o aviso de que não deve ser tratado como disponível, e "não" é excluído (contagem informada).
- O catálogo só tem dado de aceitação para o Brasil. Para outros países, a disponibilidade é "não verificada" e nada é recomendado como disponível.
- Sem país no perfil, não há recomendação.
- Programa que não exige site não penaliza quem não tem site; exigir site sem o usuário ter gera aviso.
- **Tráfego pago:** se o usuário planeja pagar tráfego e o programa o proíbe ou não confirma a permissão, aparece um aviso **impeditivo** (política `block`, padrão) ou apenas de atenção (`warn`). O simulador mostra o mesmo bloqueio quando há custo de tráfego. O sistema não executa anúncios.

## Comparação

`/compare?ids=a,b,c` (2 a 4 programas): nota, qualidade, disponibilidade, verificação, aceitação, comissão, cookie, pagamento, requisitos e avisos lado a lado. Não há "vencedor" automático.

## Simulador

Quatro modos, todos identificados como simulação:

- **A, cliques e conversão:** vendas = cliques × conversão.
- **B, vendas esperadas.**
- **C, meta financeira:** vendas necessárias (arredondadas para cima) e, com conversão, os cliques.
- Resultados: comissão por venda, vendas, valor vendido, comissão mensal e anual, custo (tráfego + conteúdo), lucro mensal e anual, ROI (vazio sem custo) e ponto de equilíbrio.
- **SaaS recorrente:** assinantes, preço, percentual, duração, cancelamento mensal e validação. Três cenários (sem cancelamento, informado, dobrado), com comissão gerada e **já liberada após a validação**. A duração é obrigatória; só se o usuário confirmar que as regras oficiais pagam enquanto o cliente assinar a comissão é tratada como vitalícia.
- Ao abrir pelo programa, preenche apenas dados **confirmados** do catálogo, para o usuário conferir.

## Alertas

Derivados do histórico imutável (`program_history`): novos programas e produtos, alteração de comissão, mudança de regras, programas que passaram a ter recorrência ou a aceitar brasileiros, encerrados ou suspensos, links indisponíveis, produtos descontinuados e informação desatualizada. Cada alerta mostra a fonte oficial mais relevante e a data da última verificação, ou avisa que não há fonte. Preferências por categoria e frequência ficam em `alert_prefs`; "marcar como lido" zera os novos.

## Limites conhecidos

- A frequência escolhida ainda não dispara e-mail; os alertas aparecem só no app.
- Não há alertas de prazo de inscrição, campanhas sem conversão, queda de desempenho nem comissões pendentes: dependem das Fases 4 e 8.
- Reputação, demanda, conversão, concorrência e potencial de conteúdo não têm fonte de dados; entram na nota só quando houver dados verificáveis ou estimativas rotuladas.
- A recomendação é por regras transparentes, sem IA; a camada de IA vem na Fase 5 e não substituirá dado oficial.
- Recomendações avaliam até 300 programas ativos por consulta (limite de CPU do plano gratuito); com catálogo maior será preciso pré-calcular.
