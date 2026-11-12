# Integrações e montagem de loja (Fase 6, parte 2)

Objetivo: levar produtos do fornecedor para a loja Shopee do próprio usuário, em lote (até 50 anúncios), **publicando só depois de revisão e autorização humana**.

## O que existe

| Peça | Como funciona |
| --- | --- |
| Cofre de credenciais | AES-GCM com o segredo `CREDENTIALS_KEY`. Sem o segredo, nada é guardado. As credenciais nunca voltam pela API nem entram na exportação de dados. |
| Shopee (Open Platform v2) | Assinatura HMAC-SHA256, autorização OAuth feita pelo dono da loja, renovação do token antes de vencer, categorias e canais de envio (como sugestão), envio de imagens e criação do item. |
| Fornecedor (WeDrop ou outro) | Conector configurável: endereço https, cabeçalho de autenticação, token e mapeamento dos campos, com sincronização por API. Também importa CSV e JSON, com simulação antes de gravar. |
| Montagem de loja | Até 50 produtos por vez viram rascunhos de anúncio. Preço por markup ou preço fixo, escolhido pelo usuário. |
| Autorização | Em lote, mas só para rascunhos sem pendência e digitando a quantidade. Editar um anúncio derruba a autorização. |
| Publicação | Só anúncios autorizados; reserva atômica evita publicar duas vezes; o erro da Shopee fica registrado como veio. |

## Fluxo

1. Em **Integrações**, adicione a Shopee (Partner ID e Partner Key do **seu** app na Shopee Open Platform) e clique em Autorizar loja. Adicione o fornecedor.
2. Importe ou sincronize os produtos do fornecedor.
3. Em **Loja**, escolha até 50 produtos e a regra de preço. Os rascunhos aparecem com margem **antes das taxas** e pendências.
4. Escolha categoria, canais de envio e peso (em lote), ajuste títulos e descrições.
5. Selecione os rascunhos, digite a quantidade e autorize. Depois publique os autorizados.

## Regras que o código garante

- Nada é publicado sem rascunho revisado e autorização do usuário; a montagem de 50 só cria rascunhos.
- Pendências que bloqueiam a autorização: título, descrição, preço (maior que o custo), estoque, peso, categoria, canal de envio, imagens; promessa de ganho; número ou link que não está nos dados do fornecedor.
- A IA (opcional) só reescreve a descrição e é conferida contra os dados do fornecedor; se falhar, vale o texto do fornecedor. Conta nos limites de custo da Fase 5.
- O preço de venda é decisão do usuário. A margem mostrada não inclui taxas, comissão nem frete; o sistema não as estima.
- Credenciais: do próprio usuário, cifradas, e apagadas com a conta. O endereço do fornecedor precisa ser https de domínio público (sem IP, localhost ou rede interna), e o host da Shopee só aceita domínios da Shopee.
- Categorias da Shopee são sugestões a partir do nome do produto; quem escolhe é a pessoa.

## Limites e o que não foi verificado

- **Não foi testado contra a Shopee nem contra a WeDrop reais**: não há credenciais neste ambiente. Os testes simulam as respostas. A assinatura foi conferida com um cálculo independente, mas os campos exigidos por categoria (atributos, marca etc.) variam e a documentação completa da Shopee exige login. Se a Shopee recusar um anúncio, o motivo aparece no card e nada fica publicado pela metade.
- **WeDrop**: não encontrei documentação pública de API, então não há endpoints deles no código. Use o conector configurável com a documentação da sua conta, ou importe CSV/JSON. Pedidos, estoque em tempo real e rastreio não estão implementados.
- Variações de produto, atributos obrigatórios por categoria, edição de anúncios já publicados e sincronização de estoque e preço depois de publicado não estão implementados.
- Limite de 500 produtos por importação e de 10 conexões por usuário.
- Host da Shopee para o Brasil: confirme no console da Open Platform; os servidores oferecidos são `partner.shopeemobile.com` e `openplatform.shopee.com.br`.

## Configuração

```bash
openssl rand -base64 32        # gera a chave
npx wrangler secret put CREDENTIALS_KEY
```

Em desenvolvimento, coloque `CREDENTIALS_KEY=...` no `.dev.vars`. Configure a URL de retorno da Shopee (`APP_URL/api/integrations/shopee/callback`) no app da Open Platform.
