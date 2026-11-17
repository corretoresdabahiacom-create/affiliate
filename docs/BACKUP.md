# Backup e recuperação

## Por que não é `wrangler d1 export`
O banco tem uma tabela virtual FTS5 (`program_search`, busca do catálogo) e o D1 **não exporta bancos com tabelas virtuais**: o comando falha (confirmado em teste local; o `d1 export` retorna "cannot export databases with Virtual Tables"). Em vez de remover a tabela em produção para exportar, o backup é próprio:
- `scripts/backup-d1.mjs`: lê os **dados** de cada tabela (em ordem de chaves estrangeiras), gera `INSERT`s com escape correto e um manifesto de contagens, e cifra com GPG (AES-256). O esquema vem das migrações; o índice de busca é recriado na restauração.
- `scripts/restore-d1.mjs`: decifra, aplica as migrações no destino, carrega os dados, recria o índice (`scripts/reindex.sql`), **confere as contagens contra o manifesto** e roda `PRAGMA foreign_key_check`.

## Rotina
- **Antes de cada deploy** (`deploy.yml`): backup cifrado guardado como artefato por 14 dias, se `BACKUP_PASSPHRASE` estiver definido.
- **Semanal** (`backup.yml`, domingo 05:17 UTC): backup + **prova de restauração** em banco local vazio; guardado por 30 dias.
- Segredos do GitHub: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `BACKUP_PASSPHRASE` (≥ 20 caracteres, **guarde também fora do GitHub**: sem ela o backup é irrecuperável).
- O arquivo contém e-mails e dados financeiros. Está cifrado, mas artefatos de repositórios públicos podem ser baixados por qualquer conta do GitHub: por isso a senha longa é obrigatória. Se preferir, mantenha o repositório privado.
- Objetivos práticos: perda máxima de dados (RPO) = até 7 dias entre backups semanais (menos, se houver deploys); tempo de recuperação (RTO) = minutos para o banco, mais o tempo de apontar o Worker para o novo banco.
- O D1 também tem recuperação por tempo (Time Travel) na própria Cloudflare; a janela de retenção depende do plano e **não foi verificada aqui**: confira na documentação da Cloudflare antes de depender dela.

## Restaurar (passo a passo)
1. Baixe o artefato `.sql.gpg` (Actions > execução > Artifacts).
2. Crie um banco **novo**: `cd apps/api && npx wrangler d1 create affiliate-intelligence-restore`.
3. `BACKUP_PASSPHRASE=... node scripts/restore-d1.mjs backup.sql.gpg affiliate-intelligence-restore` (o nome do banco precisa estar em `wrangler.toml` como binding de teste ou use `--config`).
4. Confira a mensagem final ("tabelas conferidas, busca reindexada, chaves estrangeiras íntegras") e algumas telas.
5. Troque o `database_id` em `apps/api/wrangler.toml` para o do banco restaurado e faça o deploy.
6. Restaurar **sobre** o banco em uso é destrutivo e só roda com `RESTORE_CONFIRM=<nome do banco>`. Faça um backup novo antes.

O script recusa: destino com dados diferentes do backup, destino igual ao de produção sem `RESTORE_CONFIRM`, senha errada ou arquivo sem manifesto.

## Testado
- Backup e restauração locais de ponta a ponta (41 tabelas), incluindo texto com aspas, `;`, `DROP TABLE`, acentos e símbolos; senha errada; bloqueio de produção.
- `test/backup.test.ts`: o SQL de reindexação gera exatamente o mesmo índice que a API mantém; o banco tem uma única tabela virtual; toda tabela tem `rowid`.
- **Não testado contra o D1 remoto** (sem credenciais da Cloudflare neste ambiente): o primeiro `backup.yml` real é o teste final.
