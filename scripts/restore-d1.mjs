#!/usr/bin/env node
// Restaura um backup (.sql.gpg) em um banco D1: aplica as migrações, carrega os dados, recria o índice de busca (FTS)
// e CONFERE as contagens contra o manifesto. Uso: node scripts/restore-d1.mjs backup.sql.gpg NOME_DO_BANCO_DESTINO
// SEGURANÇA: só restaura em banco vazio. Sobrescrever um banco com dados é destrutivo e exige RESTORE_CONFIRM=<nome do banco>.
// O destino igual ao banco de produção também exige RESTORE_CONFIRM. Prefira um banco novo (wrangler d1 create) e troque o database_id depois.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { REINDEX_SQL, extra, ident, query, queryMany, target, wrangler } from "./d1-lib.mjs";

const [file, dest] = process.argv.slice(2);
if (!file || !dest) { console.error("Uso: node scripts/restore-d1.mjs backup.sql.gpg NOME_DO_BANCO_DESTINO"); process.exit(2); }
const prod = process.env.D1_DATABASE ?? "affiliate-intelligence";
const confirmed = process.env.RESTORE_CONFIRM === dest;
if (dest === prod && !confirmed) { console.error(`Destino é o banco de produção (${prod}). Destrutivo: RESTORE_CONFIRM=${prod} node scripts/restore-d1.mjs ...`); process.exit(3); }

const dir = mkdtempSync(join(tmpdir(), "restore-"));
try {
  const plain = join(dir, "restore.sql");
  const g = spawnSync("gpg", ["--batch", "--yes", "--pinentry-mode", "loopback", "--passphrase-fd", "0", "--decrypt", "--output", plain, resolve(file)], { input: process.env.BACKUP_PASSPHRASE ?? "", encoding: "utf8" });
  if (g.status !== 0) { console.error("Falha ao decifrar (senha errada ou arquivo corrompido).\n" + g.stderr); process.exit(1); }
  const sql = readFileSync(plain, "utf8");
  const manifest = JSON.parse(/^-- manifest (.*)$/m.exec(sql)?.[1] ?? "null");
  if (!manifest) { console.error("Backup sem manifesto: arquivo inválido."); process.exit(1); }

  wrangler(["d1", "migrations", "apply", dest, target(), ...extra()]);
  const names = Object.keys(manifest);
  const countAll = () => queryMany(dest, names.map((t) => `SELECT COUNT(*) AS n FROM ${ident(t)}`)).map((r) => r[0].n);
  // As migrações semeiam algumas tabelas (categorias, planos, redes...): só contam como "dados" as tabelas de uso.
  const before = countAll();
  const used = names.filter((t, i) => before[i] > 0 && manifest[t] !== before[i]);
  if (used.length && !confirmed) { console.error(`O destino já tem dados diferentes do backup (${used.join(", ")}). Use um banco vazio ou RESTORE_CONFIRM=${dest} (destrutivo).`); process.exit(3); }
  // Limpa tudo (filhos antes dos pais) para o backup entrar sem conflito com as sementes das migrações.
  queryMany(dest, ["PRAGMA defer_foreign_keys = on", ...[...names].reverse().map((t) => `DELETE FROM ${ident(t)}`)]);

  writeFileSync(join(dir, "full.sql"), `${sql}\n${REINDEX_SQL}\n`);
  wrangler(["d1", "execute", dest, target(), ...extra(), "--file", join(dir, "full.sql"), "--yes"]);

  const bad = [];
  const after = countAll();
  names.forEach((t, i) => { if (after[i] !== manifest[t]) bad.push(`${t}: esperado ${manifest[t]}, restaurado ${after[i]}`); });
  if (bad.length) { console.error("Conferência falhou:\n" + bad.join("\n")); process.exit(4); }
  const fk = query(dest, "PRAGMA foreign_key_check");
  if (fk.length) { console.error(`Conferência falhou: ${fk.length} violações de chave estrangeira.`); process.exit(4); }
  console.log(`Restaurado em ${dest}: ${Object.keys(manifest).length} tabelas conferidas, busca reindexada, chaves estrangeiras íntegras.`);
} finally { rmSync(dir, { recursive: true, force: true }); }
