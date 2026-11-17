# Automações, notificações e monitoramento (Fase 7)

Tudo aqui respeita as regras do projeto: **o sistema não publica em redes sociais por conta própria**, **o catálogo oficial nunca é alterado automaticamente** e **nenhum dado pessoal de comprador sai do sistema**.

## O que existe

| Peça | Para que serve | Onde |
| --- | --- | --- |
| Webhooks de saída | Avisar o n8n, Make, Zapier ou código seu quando algo acontece | `/automations` |
| Gancho de entrada | O n8n mandar uma notificação ou importar produtos do fornecedor | `/automations` |
| Notificações | Central dentro do sistema (pedidos novos, publicação, achados do monitor) | `/notifications` |
| Resumo por e-mail | Mudanças do catálogo na frequência de Alertas; opt-in, com cancelamento em 1 clique | `/notifications` |
| Monitor de fontes | Avisar quando uma página oficial mudou ou saiu do ar | `/notifications` |
| Importação CSV/JSON | Já existia (catálogo do fornecedor, com simulação) e agora também é acionável pelo gancho de entrada | Integrações |
| Publicação na Shopee | Fase 6; os eventos `listing.published` e `listing.updated` avisam o n8n | Loja |

## Webhooks de saída

Eventos: `listing.published`, `listing.updated`, `order.new`, `ad.approved`, `alert.new`, `monitor.finding`, `test.ping`.

Cada entrega é um `POST` JSON `{ id, event, createdAt, data }` com os cabeçalhos:

- `x-ai-event`, `x-ai-delivery` (id, serve para deduplicar no receptor);
- `x-ai-timestamp` (segundos) e `x-ai-signature` = `sha256=` + HMAC-SHA256 hex de `"<timestamp>.<corpo>"` com o segredo `whsec_...`.

Para validar no receptor: recalcule o HMAC sobre `timestamp + "." + corpo bruto`, compare em tempo constante e recuse timestamps com mais de 5 minutos.

Garantias e limites:

- Segredo mostrado **uma vez**; fica cifrado no cofre (`CREDENTIALS_KEY`). Sem o cofre não se criam webhooks.
- Só `https` e domínio público (sem localhost, IP, nome sem ponto, `.local/.internal`). A regra é conferida de novo a cada entrega. Redirecionamentos não são seguidos.
- Resposta 2xx = entregue. Qualquer outra coisa reenvia (1 min, 5 min, 30 min, 2 h, 6 h) até 5 tentativas; depois a entrega fica "dead". O reenvio roda no agendador (a cada 10 minutos, um lote por vez), então a espera real pode passar um pouco do previsto.
- 10 entregas "dead" seguidas desativam o endpoint e geram **uma** notificação; a fila dele é descartada. Desligar à mão também descarta a fila, sem contar como falha. Reativar zera a contagem.
- O teste manual (`test.ping`) é entregue na hora e responde pelo próprio ping, mesmo com outras entregas na fila.
- No máximo 10 endpoints por conta. Histórico de entregas é apagado depois de 30 dias.
- Os dados dos eventos são os seus (ids, nomes de produto, status, totais). Pedidos: número, status, total e quantidade de itens; nada do comprador.
- Entrega é "pelo menos uma vez": o mesmo evento pode chegar duas vezes se o receptor demorar a responder. Use `x-ai-delivery` para deduplicar.

## Gancho de entrada (n8n → sistema)

`POST {APP_URL}/api/hooks/in/{id}` com `Authorization: Bearer <token>` e corpo JSON. Ações liberadas por gancho:

- `{ "action": "notify", "title": "...", "body": "...", "link": "/orders" }`: cria uma notificação. `link` só é aceito se começar com `/` (link externo é descartado).
- `{ "action": "supplier.import", "connectionId": "...", "format": "csv"|"json", "data": "...", "dryRun": true }`: mesma importação da tela, só na sua conta, com simulação.

O token aparece uma vez e só o hash é guardado. Token errado, ausente ou gancho inexistente respondem igual (401). Limite de 60 chamadas por minuto por gancho. Esta rota não usa o cabeçalho CSRF (é chamada de servidor); a proteção é o token.

## Notificações e e-mail

- Notificações internas: pedidos novos, resultado de publicação, webhook desativado, achados do monitor e as criadas pelo gancho.
- E-mail é **opt-in** (desligado por padrão, LGPD). Ao ligar, a base é "agora": o primeiro resumo só sai depois do intervalo da frequência (a de Alertas: instantâneo ≈ a cada hora, diário, semanal). Só marca como enviado se o provedor aceitou. Todo e-mail traz o link de cancelamento (`/api/unsubscribe`, assinado, sem login).
- Precisa de `RESEND_API_KEY`, `EMAIL_FROM` e `CLICK_SALT`. Sem eles o sistema avisa na tela e não envia nada.
- O evento `alert.new` segue a mesma lógica dos alertas: a primeira passada só marca o ponto de partida, depois vai um lote com o que apareceu (até 20 itens, com `total` e `truncated` quando houver mais). Cada passada usa o próprio relógio como marco: nada sai duas vezes nem fica de fora.
- Usuários são atendidos em rodízio (quem foi visto há mais tempo primeiro), alguns por execução.

## Monitor de fontes oficiais

- Olha só fontes de tipo oficial (`official_docs`, `official_page`, `official_api`, `official_communication`) de programas **ativos que algum usuário segue**, no máximo uma vez por dia cada, algumas por execução (as mais antigas primeiro). A mesma página cadastrada para vários campos é verificada e avisada **uma vez só**.
- Compara o texto da página sem scripts, estilos e espaços (ruído não conta). A primeira leitura só cria a base.
- Avisa: "mudou" (revise as regras), "fora do ar" (só na 2ª falha seguida, uma vez) e "voltou". **Nunca altera o catálogo nem a data de verificação**: quem confirma e atualiza é uma pessoa com a fonte.
- Segue até 3 redirecionamentos, conferindo cada destino (https, domínio público). Tempo limite de 8 s; lê no máximo 1 MB por página e descarta o resto sem baixar.
- Limitação: páginas que carregam o conteúdo por JavaScript, ou que mostram texto que muda a cada visita (datas, contadores), podem gerar avisos de "mudou" sem mudança real nas regras, ou nenhum aviso. É um sinal para olhar a fonte, não uma garantia.

## Agendador e orçamento por execução

`wrangler.toml` declara `[triggers] crons = ["*/10 * * * *"]` (a cada 10 minutos, gratuito no Workers).

No plano gratuito da Cloudflare cada execução tem o mesmo orçamento de uma requisição: **50 consultas ao D1** (um `db.batch()` conta como 1) e **50 chamadas externas**. O agendador divide esse orçamento em fatias e cada tarefa faz só o que cabe; o resto fica para a execução seguinte:

- reenvio de webhooks (até ~30% do orçamento);
- monitor de fontes (até ~25% das consultas e ~30% das chamadas);
- resumos por e-mail e `alert.new` (até ~25%), em rodízio entre usuários;
- limpeza (só na janela das 03h00–03h09 UTC);
- estoque automático com o que sobrar, começando pelos anúncios sincronizados há mais tempo.

Com `WORKER_PLAN=paid` (conta no Workers Paid) os orçamentos passam a 900 consultas e 900 chamadas por execução.

Consequência prática no plano gratuito: algumas dezenas de usuários com resumo por e-mail, algumas centenas de páginas monitoradas por dia e algumas dezenas de anúncios com estoque atualizado por execução. Para volumes maiores, use o Workers Paid.

## Privacidade

Todas as tabelas novas têm `user_id ... ON DELETE CASCADE` (`source_checks` é global e só guarda estado de páginas públicas). A exportação (`/api/me/export`) inclui notificações, webhooks e ganchos **sem** segredo nem token; excluir a conta apaga tudo.

## O que não foi feito

- Conectores de redes de afiliados (Awin, Impact, etc.): não há documentação nem credencial verificadas aqui, e o projeto não inventa integração. O caminho para dados de redes é importar CSV/JSON pelo gancho de entrada ou pela tela.
- Publicação direta em Instagram, YouTube, WhatsApp etc.: fica a cargo do fluxo que você montar no n8n a partir do evento `ad.approved`. O sistema só entrega o texto aprovado.
- Nada disso foi testado contra um n8n real nem contra o Resend real; os testes simulam as respostas.

## Cobrança no agendador (0.11.0)
Cada execução também chama `runBilling` (fatia de 10% das consultas ao D1): encerra testes vencidos, move períodos vencidos para `past_due` e expira os que passaram da carência, 40 assinaturas por vez, em lote. Ver `docs/MONETIZATION.md`.
