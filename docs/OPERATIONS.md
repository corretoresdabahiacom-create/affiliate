# Gestão do afiliado (Fase 4)

Tudo aqui é privado do usuário: cada consulta filtra por `user_id` e a exclusão da conta apaga os dados em cascata. `/api/me/export` devolve uma cópia.

## Meus programas

- Status guardados em inglês (`interested`, `saved`, `application_pending`, `approved`, `rejected`, `active`, `suspended`, `closed`) e traduzidos na tela.
- Data de inscrição e de aprovação são preenchidas na primeira vez que o status as implica, ou informadas pelo usuário. Nada é inventado.
- Programa que deixou de estar ativo no catálogo não pode ser marcado como pendente, aprovado ou ativo, e aparece com aviso de revisão.
- O link oficial de inscrição aparece com seu estado (`verified`/`unverified`). O usuário se cadastra no site do programa: a plataforma não cria contas nem aceita contratos.
- Documentos: título e link http(s) (até 30 por programa). Nenhum arquivo é armazenado.

## Links e rastreamento próprio

1. O link é guardado **exatamente** como informado; parâmetros de rastreamento nunca são alterados.
2. `trackingMode = own_redirect` só é aceito se o programa tem `allows_redirect = yes` (confirmado por fonte oficial) e está ativo. Caso contrário, `redirect_not_allowed`.
3. `GET /r/:code` responde 302 para a URL guardada. Responde 410 se o link está inativo, deixou de ser `own_redirect` ou o programa deixou de permitir/estar ativo.
4. Contagem de cliques: ignora User-Agent vazio ou de robô; o mesmo visitante (hash diário) em 30 minutos conta uma vez; no máximo 500 cliques contados por link por hora. O redirecionamento continua funcionando mesmo quando o clique não é contado.
5. Privacidade: o hash usa `sha256(ip | user-agent | dia | CLICK_SALT)`. Defina `CLICK_SALT` como segredo em produção (`wrangler secret put CLICK_SALT`). Sem cookies e sem guardar IP.
6. Clique não é venda: aparece sempre separado de conversões e comissões.

## Campanhas

Canais: blog, YouTube, Instagram, TikTok, Pinterest, LinkedIn, e-mail, SEO, orgânico e os anúncios pagos (Google, Meta, YouTube, Pinterest, TikTok e LinkedIn Ads). Em canal pago vinculado a um programa:

| `accepts_paid_traffic` | Resultado |
| --- | --- |
| `yes` | permitido |
| `no` | bloqueado sempre (`paid_traffic_forbidden`) |
| `unverified` | segue a política do administrador: bloqueia (`paid_traffic_not_confirmed`) ou apenas avisa |

Cliques e conversões digitados na campanha têm origem "manual" e não são confirmação da rede.

## Comissões

Ciclo: `estimated → pending → approved → paid`; `rejected` pode voltar a `pending`; `paid` é final e trava edição. Toda comissão nasce **estimada** e **informada**; só a importação do relatório da rede marca como **confirmada pela rede**. Reembolso, cancelamento e chargeback entram como ajustes negativos e reduzem o valor líquido.

Importação CSV (até 200 linhas): colunas `external_ref` e `amount` obrigatórias; `currency`, `status`, `date`, `product` opcionais. Simulação (`dryRun`) não grava. Reimportar atualiza o que mudou e não duplica (mesma referência). Status desconhecido vira `pending`, nunca `approved`. Registros vindos da rede não são editáveis à mão.

Conciliação: compara registros próprios (manual e rastreamento próprio) com os da rede pela referência: iguais, valor diferente, moeda diferente, status diferente, próprios que a rede não listou, próprios sem referência e da rede sem registro próprio.

## Painel

Mostra programas descobertos/salvos/em análise, inscrições pendentes, aprovações e rejeições, produtos divulgados, links, cliques (próprios e informados, separados), conversões (confirmadas pela rede e informadas por você) e comissões por moeda e status. Nunca soma moedas diferentes, nunca trata estimada como aprovada ou paga e nunca trata clique como venda.
