#!/usr/bin/env node
// Backup do banco D1: dados em SQL + manifesto de contagens, cifrado com GPG (AES-256).
// Uso: node scripts/backup-d1.mjs [saida.sql.gpg]
// Variáveis: D1_DATABASE (padrão affiliate-intelligence), D1_TARGET (--remote | --local), BACKUP_PASSPHRASE (>= 20 caracteres, obrigatória:
// o arquivo contém e-mails e dados financeiros), BACKUP_PAGE (linhas por consulta, padrão 500).
import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { describeTables, ident, insertOrder, listTables, queryMany, quote, target } from "./d1-lib.mjs";

const DB = process.env.D1_DATABASE ?? "affiliate-intelligence";
const pass = process.env.BACKUP_PASSPHRASE ?? "";
if (pass.length < 20) { console.error("Defina BACKUP_PASSPHRASE com pelo menos 20 caracteres (o backup contém dados pessoais)."); process.exit(2); }
const out = resolve(process.argv[2] ?? `backup-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z.sql.gpg`);
const PAGE = Number(process.env.BACKUP_PAGE ?? 500);

const info = describeTables(DB, listTables(DB));
const tables = insertOrder(info);
const lines = [`-- backup ${DB} ${new Date().toISOString()} alvo=${target()}`, "PRAGMA defer_foreign_keys = on;"];
const counts = Object.fromEntries(tables.map((t) => [t, 0]));
const last = Object.fromEntries(tables.map((t) => [t, 0]));
const pending = new Set(tables);
const select = (t) => `SELECT rowid AS _rid, ${info.get(t).cols.map(ident).join(", ")} FROM ${ident(t)} WHERE rowid > ${last[t]} ORDER BY rowid LIMIT ${PAGE}`;
const body = new Map(tables.map((t) => [t, []]));
// Rodadas: cada chamada lê a próxima página de TODAS as tabelas que ainda têm linhas (poucas chamadas, mesmo com dezenas de tabelas).
while (pending.size) {
  const batch = [...pending];
  const res = queryMany(DB, batch.map(select));
  batch.forEach((t, i) => {
    const rows = res[i];
    const cols = info.get(t).cols;
    for (const r of rows) body.get(t).push(`INSERT INTO ${ident(t)} (${cols.map(ident).join(", ")}) VALUES (${cols.map((c) => quote(r[c])).join(", ")});`);
    counts[t] += rows.length;
    if (rows.length < PAGE) pending.delete(t); else last[t] = rows[rows.length - 1]._rid;
  });
}
for (const t of tables) lines.push(...body.get(t));
lines.splice(1, 0, `-- manifest ${JSON.stringify(counts)}`);
const tmp = `${out}.plain`;
writeFileSync(tmp, lines.join("\n") + "\n", { mode: 0o600 });
const g = spawnSync("gpg", ["--batch", "--yes", "--pinentry-mode", "loopback", "--passphrase-fd", "0", "--symmetric", "--cipher-algo", "AES256", "--output", out, tmp], { input: pass, encoding: "utf8" });
rmSync(tmp, { force: true });
if (g.status !== 0) { console.error(g.stderr); process.exit(1); }
console.log(`Backup cifrado: ${out}\nTabelas: ${tables.length}, linhas: ${Object.values(counts).reduce((a, b) => a + b, 0)}`);
