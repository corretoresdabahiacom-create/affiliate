# Deploy na Cloudflare (gratuito, sem cartão)

Um único Worker serve a API (`/api/*`) e o frontend estático. O banco é o D1. O plano gratuito da Cloudflare não pede cartão de crédito.

## 1. Conta e ferramentas

1. Crie uma conta em <https://dash.cloudflare.com/sign-up>.
2. Instale as dependências: `npm install --legacy-peer-deps`.
3. Faça login na CLI: `npx wrangler login`.

## 2. Banco de dados

```bash
cd apps/api
npx wrangler d1 create affiliate-intelligence
```

Copie o `database_id` impresso para `apps/api/wrangler.toml`, no bloco `[[d1_databases]]`, e faça commit.

## 3. Variáveis

Em `apps/api/wrangler.toml`, bloco `[vars]`:

| Variável | O que colocar |
| --- | --- |
| `APP_URL` | A URL pública, por exemplo `https://affiliate-intelligence.SEU-SUBDOMINIO.workers.dev` (sem barra no fim). É usada no link do e-mail e na checagem de `Origin`. |
| `ADMIN_EMAILS` | Seu e-mail (vários, separados por vírgula). Quem entrar com ele vira administrador. |
| `EMAIL_FROM` | Remetente dos e-mails de acesso. |

Não altere `ENVIRONMENT = "production"`: é ele que impede a API de devolver o link de acesso na resposta.

## 4. E-mail de acesso

O login por link precisa enviar e-mail. O código usa a API do Resend quando existe o segredo `RESEND_API_KEY`:

```bash
cd apps/api
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put CLICK_SALT   # sal do hash de cliques (texto aleatório longo)
npx wrangler secret put CREDENTIALS_KEY   # 32 bytes em base64 (openssl rand -base64 32): cifra as credenciais de integrações
```

Antes de depender disso, confirme na página do provedor o plano gratuito, a necessidade de cartão e a verificação de domínio para o remetente; essas condições não foram verificadas aqui. Sem o segredo, a aplicação sobe, mas ninguém recebe o link. Para trocar de provedor, altere só `apps/api/src/mailer.ts`.

## 5. Primeiro deploy manual (opcional)

```bash
npm run build
npm run db:migrate:remote
cd apps/api && npx wrangler deploy
```

## 6. Deploy automático a cada push no GitHub

O workflow `.github/workflows/deploy.yml` roda em cada push na `main`: instala, verifica tipos, testa, compila, aplica as migrations no D1 e publica.

Crie dois segredos em *Settings > Secrets and variables > Actions*:

- `CLOUDFLARE_ACCOUNT_ID`: aparece na página inicial do dashboard da Cloudflare.
- `CLOUDFLARE_API_TOKEN`: em *My Profile > API Tokens > Create Token*, use o modelo **Edit Cloudflare Workers** e acrescente a permissão **Account > D1 > Edit**.

Se os segredos não existirem, o job de deploy falha com uma mensagem explicando o que falta; os testes continuam rodando.

## Problemas comuns

- **Login funciona mas o link não chega:** falta `RESEND_API_KEY` ou o remetente não está verificado no provedor.
- **403 `origin_not_allowed`:** `APP_URL` não é igual à URL pela qual você acessa o app.
- **Erros `D1` após muito uso:** o plano gratuito tem limites diários de leitura e escrita; veja `docs/ARCHITECTURE.md`.

## Fase 8 (0.11.0)
- Rode as migrações (`0011_billing.sql`) antes do deploy. Ela define limites iniciais nos planos que ainda estavam sem limites: usuários existentes no plano Free que já passaram deles continuam com seus dados, mas não criam mais itens até o administrador ajustar os limites em Admin > Planos.
- Defina os preços dos planos em Admin > Planos (ficam vazios por padrão; plano sem preço não pode ser assinado).
- Sem novas variáveis de ambiente. O passo de cobrança roda no mesmo cron de 10 minutos.

## Fase 9: segredos, variáveis e verificações do deploy
- Segredos do GitHub (Settings > Secrets and variables > Actions): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `BACKUP_PASSPHRASE` (≥ 20 caracteres; guarde uma cópia fora do GitHub).
- Variável do GitHub: `APP_URL` (endereço público em HTTPS), usada no teste de fumaça (`/api/health` com `"ok":true` e cabeçalho CSP em `/`).
- Migrações: até `0012_perf_indexes.sql`.
- O deploy faz, nesta ordem: testes e auditoria de dependências, backup cifrado (se houver `BACKUP_PASSPHRASE`), migrações, publicação, teste de fumaça.
- Backup semanal com prova de restauração: `.github/workflows/backup.yml`. Veja `docs/BACKUP.md`, `docs/SECURITY.md` e `docs/PRODUCTION.md`.
