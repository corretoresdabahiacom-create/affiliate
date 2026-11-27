# Relatório de situação e passagem de bastão

Atualizado em 26/11/2026. Versão do código: 0.12.0. Repositório: github.com/corretoresdabahiacom-create/affiliate (branch main).

## 1. O que existe (código)
SaaS "Affiliate Intelligence AI" em monorepo (`apps/api` Worker + D1, `apps/web` React, `packages/shared`). Fases 1 a 9 do prompt mestre concluídas e enviadas: catálogo de programas com aceitação tri-estado, links e cliques (clique ≠ venda), comissões (estimada ≠ aprovada ≠ paga), estúdio de conteúdo com divulgação de afiliado, automação (webhooks assinados, agendador a cada 10 min), integrações Shopee/WeDrop com publicação só após aprovação humana, análise de rentabilidade e relatórios, planos e assinaturas (registro manual de pagamentos), segurança e produção (Fase 9). Detalhes por fase: `CHANGELOG.md`, `README.md`. Segurança: `docs/SECURITY.md`. Backup: `docs/BACKUP.md`. Go-live: `docs/PRODUCTION.md`. Deploy: `docs/DEPLOY.md`.
Testes na última execução do CI: compartilhado 111, API 236, web 85, todos passando; typecheck e build limpos.

## 2. O que está no ar (Cloudflare)
- Worker: `affiliate-intelligence` (o duplicado `affiliate` foi excluído em 26/11). Endereço: https://affiliate-intelligence.corretoresdabahia-com.workers.dev
- Banco D1 `affiliate-intelligence`, id `e94dbd28-a27b-43a8-b3e4-bc18fc78517e` (já no `wrangler.toml`).
- Verificado em 26/11 pelo navegador: `/api/health` ok com banco; rotas privadas dão 401; cabeçalhos de segurança (CSP, HSTS, nosniff, X-Frame-Options) presentes; POST sem cabeçalho anti-CSRF dá 403; corpo > 2 MB dá 413; páginas /login, /privacy e /terms carregam.
- Variáveis no painel batem com o `wrangler.toml`: `ADMIN_EMAILS` = corretoresdabahia.com@gmail.com, `EMAIL_FROM` = onboarding@resend.dev (remetente de teste do Resend), `APP_URL` correto.
- O worker NÃO está conectado ao GitHub pela Cloudflare (Settings › Builds mostra "Connect"). O deploy deve vir do GitHub Actions.

## 2b. Atualização de 26/11 (08:40)
- Resend funcionando: o e-mail "Seu link de acesso" foi **entregue** a corretoresdabahia.com@gmail.com (painel do Resend, status Delivered). Secrets `RESEND_API_KEY` e `CLICK_SALT` cadastrados no Cloudflare. A chave e o sal apareceram em uma captura de tela compartilhada no chat: **rotacionar os dois** (nova chave no Resend, apagar a antiga, atualizar o Secret e dar Deploy; trocar o valor do CLICK_SALT).
- GitHub: segredos CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_API_TOKEN recriados, variável APP_URL ok, BACKUP_PASSPHRASE cadastrado (o aviso de passphrase sumiu).
- O deploy ainda FALHA com o mesmo erro 7403, agora no passo "Backup antes das migrações" (`wrangler d1 execute` na API da Cloudflare): o token do GitHub não tem permissão sobre o D1 desta conta, ou o ACCOUNT_ID não é o da conta do banco (38447d80...). Conferir no token: Account › D1 › Edit, e Account Resources = a conta certa.

## 2c. Atualização de 27/11 (branch `feat/semana-de-conteudo`)
- Novo módulo **Semana de conteúdo** (inspirado no Reel DgG7I24IMDb) e redesenho visual do app todo. Detalhes no `CHANGELOG.md`. Testes locais: shared 119, API 245, web 92, typecheck e build limpos. Ainda não está no ar: depende de o deploy do Actions funcionar (item 1 abaixo); a migração `0013` é aditiva.
- Não existe integração com Instagram, TikTok ou YouTube: o usuário agenda/publica nas plataformas e digita as métricas.
- **Páginas de venda** e **Downloads reels** (27/11): ver CHANGELOG. Pontos de atenção: (1) `/p/*` precisa estar em `run_worker_first` no `wrangler.toml` e fora do `secureHeaders` global (já feito); depois do deploy, conferir que `GET /api/pages` responde 401 (não 404) e que uma página publicada abre em `/p/<endereço>`. (2) As imagens ficam em base64 no D1; se o volume crescer, migrar para R2. (3) Não há baixador de vídeo de terceiros, por decisão (termos das plataformas e direitos autorais). (4) Nenhum modelo promete resultado; o texto de cada modelo traz `[marcadores]` que bloqueiam a publicação até serem trocados.

## 3. Pendências, em ordem
1. **Deploy pelo GitHub Actions falha** nas execuções #13, #14 e #15 (26/11), no passo "Aplicar migrations no D1 (remoto)": `The given account is not valid or is not authorized to access this service [code: 7403]`. Os testes passam e o passo de verificação de segredos passa, então os segredos existem, mas o token da Cloudflare não tem permissão sobre o D1 (ou o `CLOUDFLARE_ACCOUNT_ID` não é o da conta do banco). Correção: recriar o token como "Custom Token" com Account › Workers Scripts › Edit, Account › D1 › Edit, Account › Account Settings › Read e User › Memberships › Read, restrito à conta certa; atualizar o segredo `CLOUDFLARE_API_TOKEN` e conferir o `CLOUDFLARE_ACCOUNT_ID`. Depois, Actions › CI e deploy › Re-run jobs. As execuções #11 e #12 (18/11) passaram, então algo mudou no token ou na conta desde então.
2. **Segredos do worker ausentes:** `RESEND_API_KEY` e `CLICK_SALT` não aparecem em Settings › Variables and secrets. Cadastrar como tipo Secret, depois Deploy. Sem `RESEND_API_KEY` nenhum e-mail sai e, em produção, o link de login não vai para o log; sem o e-mail não há como entrar. A conta Resend deve usar o mesmo e-mail do admin (o remetente de teste só entrega para o dono da conta).
3. **`BACKUP_PASSPHRASE`** (20+ caracteres, copiada também fora do GitHub) ausente: o deploy avisa "sem backup prévio" e o workflow semanal de backup falhou em 22/11. Depois de cadastrá-la, rodar Actions › Backup do banco (semanal) › Run workflow.
4. Variável do GitHub `APP_URL` = https://affiliate-intelligence.corretoresdabahia-com.workers.dev (sem ela o teste de fumaça só avisa).
5. Depois do primeiro login: Admin › Privacidade e termos (nome do operador e e-mail de contato), planos e preços, dias de teste/carência. Os textos legais são modelo e precisam de revisão jurídica.
6. Migração `0012` (índices): confirmar que foi aplicada (`npx wrangler d1 migrations list affiliate-intelligence --remote`); o deploy do Actions aplica quando funcionar.

## 4. Decisões e limitações conhecidas
- zod continua na 3.x. A 4.x reescreve campos não enviados ao editar (`.partial()` mantém `.default()`), o que apagaria dados confirmados. Migrar exige esquemas de edição sem padrões.
- `wrangler d1 export` não funciona neste banco (tabela virtual FTS5); usar `scripts/backup-d1.mjs` e `scripts/restore-d1.mjs` (cifrados, com verificação).
- Sem 2FA, sem teste de invasão externo. Rate limit só nas rotas sensíveis.
- Excluir conta apaga também pagamentos (avaliar retenção fiscal).
- Domínio provisório `workers.dev`: não permite verificar domínio no Resend, então só há envio de teste para o e-mail dono da conta. Para usuários reais é preciso domínio próprio.
- Pagamentos: só registro manual; gateway não escolhido (Mercado Pago é candidato, ainda não verificado). Nada foi verificado contra APIs reais de Shopee, WeDrop, n8n ou Resend.
- Não declarar teste não executado; o que não pôde ser testado está listado acima.

## 5. Regras do projeto (resumo para continuar)
Nunca inventar programas, preços, comissões ou links. Aceitação tri-estado (sim/não/não verificado). Estimado ≠ aprovado ≠ pago. Sem promessa de ganhos. A IA nunca publica nem altera catálogo sem aprovação humana. Dados oficiais nunca são substituídos automaticamente. Não criar contas nem aceitar contratos pelo usuário. LGPD. Preferir infraestrutura gratuita sem cartão. Integração de pagamento só após análise e aprovação explícita. Sem alterações destrutivas sem backup e autorização. Sempre que subir para o GitHub, fazer o deploy. Respostas em português.
