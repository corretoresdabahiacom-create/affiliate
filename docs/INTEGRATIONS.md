# Integrações, montagem de loja e operação (Fase 6, partes 2 e 3)

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

## Operação da loja (parte 3)

| Peça | Como funciona |
| --- | --- |
| Variações | Até 2 níveis (ex.: Cor, Tamanho) e 50 modelos, com custo, preço e estoque por modelo. Vêm do conector/JSON (`variants`) ou do CSV: uma linha por modelo com `external_id` repetido e as colunas `tier1_name, option1, tier2_name, option2, variant_sku, variant_cost, variant_stock`. O preço de cada modelo segue a regra escolhida; o item é criado e depois as variações (`init_tier_variation`). |
| Atributos obrigatórios | Ao escolher a categoria, o sistema consulta os atributos dela na Shopee. Os obrigatórios bloqueiam a autorização até a pessoa preencher com dado real; o sistema não inventa valores. |
| Editar publicado | Título, descrição, preço e estoque (por modelo, se houver) podem ser editados. A edição vira "alteração pendente" e só vai para a Shopee depois de nova autorização (mesma confirmação da quantidade). Categoria, canais, imagens, atributos e peso ficam travados. |
| Sincronização | "Comparar" confronta os publicados com o catálogo atual do fornecedor e só propõe estoque e preço (preço só se a regra for markup). Aplicar cria alteração pendente, que ainda exige autorização. |
| Estoque automático | Opcional, desligado por padrão, por conexão. Ligado, um agendador (a cada 6 horas) atualiza só o estoque dos publicados sem alteração pendente; preço nunca muda sozinho. Cada atualização fica na auditoria (`listing.stock_auto`). |
| Pedidos | Busca os pedidos da Shopee (1 a 15 dias) e guarda só o necessário (número, status, itens, total). Nome, endereço, telefone e documento do comprador não são pedidos nem guardados. |
| Ficha do fornecedor | Lista o que comprar no fornecedor com o custo real de cada item. Item sem anúncio correspondente aparece como "sem custo conhecido"; o total só aparece se todos tiverem custo. O sistema não compra por você: o andamento (comprado, enviado, entregue, problema, nº do pedido, rastreio do fornecedor) é registrado à mão. |
| Rastreio | Atualização sob demanda do código e dos eventos de rastreio da Shopee. |

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
- **WeDrop**: não encontrei documentação pública de API, então não há endpoints deles no código. Use o conector configurável com a documentação da sua conta, ou importe CSV/JSON. O estoque só é atualizado quando o conector é sincronizado ou o CSV reimportado.
- Os endpoints da parte 3 (`get_attributes`, `init_tier_variation`, `get_model_list`, `update_item`, `update_price`, `update_stock`, `get_order_list`, `get_order_detail`, `get_tracking_number`, `get_tracking_info`) foram escritos a partir do que conheço da API v2 e **não foram verificados** contra a Shopee real; os testes só simulam as respostas. Se a Shopee recusar, o erro aparece como veio. Limites de nome (14 caracteres no nível, 20 na opção) são conservadores.
- Se as variações falharem depois de o item ser criado, o item fica registrado: a nova tentativa continua dele e não cria outro.
- O custo das variações e a margem continuam sem taxas, comissão e frete.
- Não há compra automática no fornecedor nem leitura de dados do comprador.
- Limite de 500 produtos por importação e de 10 conexões por usuário.
- Host da Shopee para o Brasil: confirme no console da Open Platform; os servidores oferecidos são `partner.shopeemobile.com` e `openplatform.shopee.com.br`.

## Configuração

```bash
openssl rand -base64 32        # gera a chave
npx wrangler secret put CREDENTIALS_KEY
```

Em desenvolvimento, coloque `CREDENTIALS_KEY=...` no `.dev.vars`. Configure a URL de retorno da Shopee (`APP_URL/api/integrations/shopee/callback`) no app da Open Platform.
