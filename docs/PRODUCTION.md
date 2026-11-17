# Checklist de produção

Marque cada item antes de abrir para usuários reais.

## Cloudflare e GitHub
- [ ] `wrangler d1 create affiliate-intelligence` e `database_id` real em `apps/api/wrangler.toml`.
- [ ] Segredos do GitHub: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `BACKUP_PASSPHRASE`. Variável do GitHub: `APP_URL` (para o teste de fumaça).
- [ ] Segredos do Worker (`wrangler secret put`): `CREDENTIALS_KEY` (32 bytes em base64), `CLICK_SALT`, `RESEND_API_KEY` (opcional).
- [ ] Variáveis em `wrangler.toml`: `APP_URL` (HTTPS), `ADMIN_EMAILS`, `EMAIL_FROM` (domínio verificado no provedor).
- [ ] Primeiro deploy verde (testes, migrações, publicação, teste de fumaça).
- [ ] Primeiro `Backup do banco (semanal)` executado manualmente (Actions > Run workflow) e verde.

## Dados do negócio
- [ ] Admin > Privacidade e termos: nome do operador e e-mail de contato; textos revisados por advogado.
- [ ] Admin > Planos: preços e limites definidos (plano sem preço não pode ser assinado).
- [ ] Admin > Receita: dias de teste e de carência.
- [ ] Decisão sobre gateway de pagamento (hoje: registro manual). Veja `docs/MONETIZATION.md`.

## Limites do plano gratuito da Cloudflare (a conferir na documentação vigente)
- 100 mil requisições/dia; 50 consultas ao D1 e 50 chamadas externas por invocação (o sistema trabalha dentro disso: `docs/ARCHITECTURE.md`); 10 ms de CPU por invocação.
- Se o uso crescer, defina `WORKER_PLAN=paid` somente depois de migrar a conta para o plano pago.

## Operação
- Saúde: `GET /api/health` (confere o banco; 503 se o D1 falhar). Use um monitor externo gratuito para chamar essa rota.
- Erros: `wrangler tail` ou os logs do Worker; o agendador registra `[cron] ... falhou`.
- Incidentes: `docs/SECURITY.md`. Restauração: `docs/BACKUP.md`.
