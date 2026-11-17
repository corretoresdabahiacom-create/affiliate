// Utilidades de backup/restauração do D1 (sem dependências). O `wrangler d1 export` NÃO serve aqui:
// o banco tem uma tabela virtual FTS5 (busca do catálogo) e o D1 não exporta bancos com tabelas virtuais.
// Por isso o backup lê tabela a tabela (dados, em SQL) e a restauração reaplica as migrações e recria o índice de busca.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../apps/api");
export const target = () => process.env.D1_TARGET ?? "--remote";
export const extra = () => (process.env.D1_EXTRA ? process.env.D1_EXTRA.split(" ").filter(Boolean) : []);

export function wrangler(args, { json = false } = {}) {
  const r = spawnSync("npx", ["wrangler", ...args], { cwd: API_DIR, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, env: { ...process.env, NO_COLOR: "1" } });
  if (r.status !== 0) throw new Error(`wrangler ${args.slice(0, 3).join(" ")} falhou:\n${(r.stderr || r.stdout || "").slice(-1500)}`);
  if (!json) return r.stdout;
  const start = r.stdout.indexOf("[");
  return JSON.parse(r.stdout.slice(start));
}

/** Várias instruções em UMA chamada do wrangler (cada chamada custa alguns segundos). Devolve uma lista de resultados por instrução. */
export const queryMany = (db, sqls) => wrangler(["d1", "execute", db, target(), ...extra(), "--json", "--command", sqls.join(";\n")], { json: true }).map((x) => x.results ?? []);
export const query = (db, sql) => queryMany(db, [sql])[0];

export const quote = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : typeof v === "boolean" ? (v ? "1" : "0") : `'${String(v).replace(/'/g, "''")}'`);
export const ident = (n) => `"${n.replace(/"/g, '""')}"`;

/** Tabelas de dados: sem as internas do SQLite/Cloudflare, sem o controle de migrações e sem o índice FTS (recriado na restauração). */
export const listTables = (db) =>
  query(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' AND name NOT LIKE 'program_search%' ORDER BY name").map((r) => r.name);

/** Colunas e dependências (chaves estrangeiras) de todas as tabelas, em uma única chamada. */
export function describeTables(db, tables) {
  const res = queryMany(db, tables.flatMap((t) => [`PRAGMA table_info(${ident(t)})`, `PRAGMA foreign_key_list(${ident(t)})`]));
  return new Map(tables.map((t, i) => [t, { cols: res[2 * i].map((c) => c.name), deps: [...new Set(res[2 * i + 1].map((r) => r.table))].filter((x) => tables.includes(x) && x !== t) }]));
}

/** Ordem de inserção respeitando chaves estrangeiras (pais antes dos filhos). */
export function insertOrder(info) {
  const tables = [...info.keys()];
  const deps = new Map(tables.map((t) => [t, info.get(t).deps]));
  const out = [], seen = new Set();
  const visit = (t, stack = []) => { if (seen.has(t) || stack.includes(t)) return; for (const d of deps.get(t)) visit(d, [...stack, t]); seen.add(t); out.push(t); };
  tables.forEach((t) => visit(t));
  return out;
}

export const REINDEX_SQL = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "reindex.sql"), "utf8");
