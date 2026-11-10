import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app";

let counter = 0;
type Opts = { method?: string; body?: unknown; cookie?: string };
async function call(path: string, o: Opts = {}) {
  const headers: Record<string, string> = { "cf-connecting-ip": `10.9.${Math.floor(counter / 250)}.${++counter % 250}` };
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.cookie) headers.cookie = o.cookie;
  headers["x-requested-with"] = "fetch";
  const r = await app.request(path, { method: o.method ?? "GET", headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined }, env);
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
}
async function login(email: string) {
  const r1 = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-requested-with": "fetch", "cf-connecting-ip": `10.8.0.${++counter % 250}` },
    body: JSON.stringify({ email }),
  }, env);
  const { devLink } = (await r1.json()) as any;
  const token = new URL(devLink).searchParams.get("token")!;
  const r2 = await app.request("/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json", "x-requested-with": "fetch", "cf-connecting-ip": `10.8.1.${counter % 250}` },
    body: JSON.stringify({ token }),
  }, env);
  return r2.headers.get("set-cookie")!.split(";")[0]!;
}

let admin = "";
let editor = "";
let user = "";
let advId = "";
let netId = "";
let catId = "";

beforeAll(async () => {
  admin = await login("boss@example.com");
  editor = await login("ed@example.com");
  user = await login("plain@example.com");
  const me = await call("/api/admin/users", { cookie: admin });
  const ed = me.body.users.find((u: any) => u.email === "ed@example.com");
  await call(`/api/admin/users/${ed.id}/role`, { method: "PATCH", body: { role: "editor" }, cookie: admin });
  const meta = await call("/api/catalog/meta", { cookie: user });
  netId = meta.body.networks.find((n: any) => n.name === "Awin").id;
  catId = meta.body.categories[0].id;
  const a = await call("/api/catalog/advertisers", { method: "POST", body: { name: "Acme Cloud" }, cookie: editor });
  advId = a.body.id;
});

const newProgram = async (name: string, extra: Record<string, unknown> = {}) =>
  call("/api/catalog/programs", {
    method: "POST",
    cookie: editor,
    body: { advertiserId: advId, networkId: netId, categoryId: catId, name, segment: "saas", ...extra },
  });

describe("acesso", () => {
  it("exige login", async () => {
    expect((await call("/api/catalog/programs")).status).toBe(401);
  });
  it("usuário comum lê mas não escreve", async () => {
    expect((await call("/api/catalog/programs", { cookie: user })).status).toBe(200);
    expect((await call("/api/catalog/networks", { method: "POST", body: { name: "X" }, cookie: user })).status).toBe(403);
    expect((await call("/api/catalog/programs", { method: "POST", body: {}, cookie: user })).status).toBe(403);
  });
  it("traz a taxonomia e as redes iniciais sem dados comerciais inventados", async () => {
    const meta = await call("/api/catalog/meta", { cookie: user });
    expect(meta.body.categories.length).toBeGreaterThan(10);
    const awin = meta.body.networks.find((n: any) => n.name === "Awin");
    expect(awin.websiteUrl).toBeNull();
    expect(awin.websiteUrlStatus).toBe("unverified");
    const programs = await call("/api/catalog/programs?limit=5", { cookie: user });
    expect(programs.body.total).toBeGreaterThanOrEqual(0);
  });
});

describe("criação e regras de integridade", () => {
  it("cria programa com tudo 'não verificado'", async () => {
    const r = await newProgram("Programa Base");
    expect(r.status).toBe(201);
    const d = await call(`/api/catalog/programs/${r.body.id}`, { cookie: user });
    expect(d.body.program.acceptsBrazil).toBe("unverified");
    expect(d.body.program.verification).toBe("never_verified");
    expect(d.body.history[0].field).toBe("created");
  });

  it("não deixa nascer um fato confirmado sem fonte", async () => {
    const r = await newProgram("Programa Invencionice", { acceptsBrazil: "yes", commissionPercent: 30 });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("official_source_required");
    expect(r.body.fields).toContain("acceptsBrazil");
    expect(r.body.fields).toContain("commissionPercent");
  });

  it("rejeita duplicado (mesmo anunciante, rede e nome normalizado)", async () => {
    await newProgram("Programa Duplicado");
    const r = await newProgram("  programa  DUPLICADO ");
    expect(r.status).toBe(409);
  });
});

describe("fontes e verificação", () => {
  it("sim/não e comissão só com fonte oficial que cubra o campo", async () => {
    const id = (await newProgram("Programa Fonte")).body.id;
    const url = `/api/catalog/programs/${id}`;

    let r = await call(url, { method: "PATCH", body: { acceptsBrazil: "yes" }, cookie: editor });
    expect(r.status).toBe(422);

    // fonte secundária não basta
    await call(`${url}/sources`, { method: "POST", cookie: editor, body: { sourceType: "secondary_reliable", field: "accepts_brazil", url: "https://blog.example.com/x" } });
    r = await call(url, { method: "PATCH", body: { acceptsBrazil: "yes" }, cookie: editor });
    expect(r.status).toBe(422);

    // fonte oficial de outro campo também não
    await call(`${url}/sources`, { method: "POST", cookie: editor, body: { sourceType: "official_docs", field: "cookie_days", url: "https://docs.example.com/c" } });
    r = await call(url, { method: "PATCH", body: { acceptsBrazil: "yes" }, cookie: editor });
    expect(r.status).toBe(422);

    // fonte oficial do campo certo libera
    await call(`${url}/sources`, { method: "POST", cookie: editor, body: { sourceType: "official_docs", field: "accepts_brazil", url: "https://docs.example.com/terms", confirmedAt: Date.now() } });
    r = await call(url, { method: "PATCH", body: { acceptsBrazil: "yes" }, cookie: editor });
    expect(r.status).toBe(200);
    expect(r.body.changed).toContain("accepts_brazil");

    // voltar para "não verificado" nunca exige fonte
    r = await call(url, { method: "PATCH", body: { acceptsBrazil: "unverified" }, cookie: editor });
    expect(r.status).toBe(200);

    const d = await call(url, { cookie: user });
    const fields = d.body.history.map((h: any) => h.field);
    expect(fields).toContain("accepts_brazil");
    expect(fields).toContain("source_added");
  });

  it("fonte não oficial não pode confirmar", async () => {
    const id = (await newProgram("Programa Sem Confirmar")).body.id;
    const r = await call(`/api/catalog/programs/${id}/sources`, {
      method: "POST", cookie: editor,
      body: { sourceType: "unconfirmed", url: "https://x.example.com", confirmedAt: Date.now() },
    });
    expect(r.status).toBe(422);
  });

  it("rejeita URL perigosa na fonte", async () => {
    const id = (await newProgram("Programa Url")).body.id;
    const r = await call(`/api/catalog/programs/${id}/sources`, {
      method: "POST", cookie: editor, body: { sourceType: "official_page", url: "javascript:alert(1)" },
    });
    expect(r.status).toBe(400);
  });

  it("verificar exige fonte oficial; depois fica 'verificado recentemente'; sinalizações mudam o estado", async () => {
    const id = (await newProgram("Programa Verificar")).body.id;
    const base = `/api/catalog/programs/${id}`;
    expect((await call(`${base}/verify`, { method: "POST", body: { action: "verify" }, cookie: editor })).status).toBe(422);

    await call(`${base}/sources`, { method: "POST", cookie: editor, body: { sourceType: "official_page", url: "https://example.com/program" } });
    expect((await call(`${base}/verify`, { method: "POST", body: { action: "verify" }, cookie: editor })).status).toBe(200);
    expect((await call(base, { cookie: user })).body.program.verification).toBe("verified_recently");

    await call(`${base}/verify`, { method: "POST", body: { action: "flag_divergent" }, cookie: editor });
    expect((await call(base, { cookie: user })).body.program.verification).toBe("divergent");
    await call(`${base}/verify`, { method: "POST", body: { action: "flag_awaiting" }, cookie: editor });
    expect((await call(base, { cookie: user })).body.program.verification).toBe("awaiting_update");
    await call(`${base}/verify`, { method: "POST", body: { action: "clear_flag" }, cookie: editor });
    expect((await call(base, { cookie: user })).body.program.verification).toBe("verified_recently");
  });

  it("link de inscrição só vira 'verificado' com fonte oficial e perde o selo ao mudar", async () => {
    const id = (await newProgram("Programa Link", { signupUrl: "https://example.com/join" })).body.id;
    const base = `/api/catalog/programs/${id}`;
    expect((await call(base, { method: "PATCH", body: { signupUrlStatus: "verified" }, cookie: editor })).status).toBe(422);
    await call(`${base}/sources`, { method: "POST", cookie: editor, body: { sourceType: "official_page", field: "signup_url", url: "https://example.com/join" } });
    expect((await call(base, { method: "PATCH", body: { signupUrlStatus: "verified" }, cookie: editor })).status).toBe(200);
    await call(base, { method: "PATCH", body: { signupUrl: "https://example.com/new" }, cookie: editor });
    expect((await call(base, { cookie: user })).body.program.signupUrlStatus).toBe("unverified");
  });
});

describe("ciclo de vida", () => {
  it("encerrado some da lista padrão, aparece para editor e só reativa com fonte", async () => {
    const id = (await newProgram("Programa Encerrado Zeta")).body.id;
    const base = `/api/catalog/programs/${id}`;
    expect((await call(`${base}/status`, { method: "POST", body: { lifecycleStatus: "closed" }, cookie: editor })).status).toBe(200);

    const list = await call("/api/catalog/programs?q=Encerrado Zeta", { cookie: user });
    expect(list.body.total).toBe(0);
    const asEditor = await call("/api/catalog/programs?q=Encerrado Zeta&lifecycle=closed", { cookie: editor });
    expect(asEditor.body.total).toBe(1);
    // usuário comum não consegue pedir inativos
    expect((await call("/api/catalog/programs?q=Encerrado Zeta&lifecycle=closed", { cookie: user })).body.total).toBe(0);
    expect((await call(base, { cookie: user })).body.program.verification).toBe("closed");

    expect((await call(`${base}/status`, { method: "POST", body: { lifecycleStatus: "active" }, cookie: editor })).status).toBe(422);
  });
});

describe("busca e filtros", () => {
  it("busca por texto sem acento e por prefixo", async () => {
    await call("/api/catalog/advertisers", { method: "POST", body: { name: "Édu Plataforma" }, cookie: editor }).then(async (a) => {
      await call("/api/catalog/programs", { method: "POST", cookie: editor, body: { advertiserId: a.body.id, name: "Cursos Avançados", segment: "digital", description: "Aulas de programação" } });
    });
    const r = await call("/api/catalog/programs?q=edu progr", { cookie: user });
    expect(r.body.items.some((p: any) => p.name === "Cursos Avançados")).toBe(true);
  });
  it("consulta maliciosa não quebra o FTS", async () => {
    const r = await call(`/api/catalog/programs?q=${encodeURIComponent('" OR 1=1 --')}`, { cookie: user });
    expect(r.status).toBe(200);
    expect((await call("/api/catalog/programs?q=%22%22%22", { cookie: user })).status).toBe(200);
  });
  it("filtro 'aceita Brasil = sim' devolve só o confirmado, nunca o não verificado", async () => {
    const a = (await newProgram("Programa Brasil Sim")).body.id;
    await newProgram("Programa Brasil Desconhecido");
    await call(`/api/catalog/programs/${a}/sources`, { method: "POST", cookie: editor, body: { sourceType: "official_docs", field: "accepts_brazil", url: "https://docs.example.com/br" } });
    await call(`/api/catalog/programs/${a}`, { method: "PATCH", body: { acceptsBrazil: "yes" }, cookie: editor });
    const r = await call("/api/catalog/programs?accepts_brazil=yes&limit=100", { cookie: user });
    expect(r.body.items.length).toBeGreaterThan(0);
    expect(r.body.items.every((p: any) => p.acceptsBrazil === "yes")).toBe(true);
    expect(r.body.items.some((p: any) => p.name === "Programa Brasil Desconhecido")).toBe(false);
  });
  it("filtra por segmento, rede e categoria", async () => {
    const r = await call(`/api/catalog/programs?segment=saas&network=${netId}&limit=100`, { cookie: user });
    expect(r.body.items.every((p: any) => p.segment === "saas" && p.network.id === netId)).toBe(true);
  });
  it("paginação respeita o limite", async () => {
    const r = await call("/api/catalog/programs?limit=2", { cookie: user });
    expect(r.body.items.length).toBeLessThanOrEqual(2);
  });
});

describe("produtos e ofertas", () => {
  it("cria e remove com histórico", async () => {
    const id = (await newProgram("Programa Itens")).body.id;
    const p = await call(`/api/catalog/programs/${id}/products`, { method: "POST", cookie: editor, body: { name: "Plano Pro" } });
    expect(p.status).toBe(201);
    const o = await call(`/api/catalog/programs/${id}/offers`, { method: "POST", cookie: editor, body: { title: "Oferta de teste" } });
    expect(o.status).toBe(201);
    let d = await call(`/api/catalog/programs/${id}`, { cookie: user });
    expect(d.body.products).toHaveLength(1);
    expect(d.body.offers).toHaveLength(1);
    expect((await call(`/api/catalog/products/${p.body.id}`, { method: "DELETE", cookie: editor })).status).toBe(200);
    d = await call(`/api/catalog/programs/${id}`, { cookie: user });
    expect(d.body.products).toHaveLength(0);
  });
});

describe("histórico", () => {
  it("é somente de inserção", async () => {
    const id = (await newProgram("Programa Historico")).body.id;
    await expect(env.DB.prepare("DELETE FROM program_history WHERE program_id = ?").bind(id).run()).rejects.toThrow();
    await expect(env.DB.prepare("UPDATE program_history SET field = 'x' WHERE program_id = ?").bind(id).run()).rejects.toThrow();
  });
});

describe("importação CSV", () => {
  const csv = [
    "advertiser,advertiser_url,network,program,segment,category,official_url",
    'Beta SaaS,https://beta.example.com,Awin,Beta Afiliados,saas,ai_tools,https://beta.example.com/aff',
    '"Gama, Inc",,,Gama Parceiros,digital,,',
    "Beta SaaS,,Awin,beta  afiliados,saas,,",
    "Delta,,RedeInexistente,Delta Prog,saas,,",
    "Eps,,,Eps Prog,invalido,,",
    "Zeta,,,Zeta Prog,saas,,javascript:alert(1)",
  ].join("\n");

  it("simulação não grava", async () => {
    const r = await call("/api/catalog/import", { method: "POST", cookie: editor, body: { csv, dryRun: true } });
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(2);
    const list = await call("/api/catalog/programs?q=Beta Afiliados", { cookie: user });
    expect(list.body.total).toBe(0);
  });
  it("importa, reporta duplicados e erros, e nada vem confirmado", async () => {
    const r = await call("/api/catalog/import", { method: "POST", cookie: editor, body: { csv } });
    expect(r.body.created).toBe(2);
    expect(r.body.duplicates).toEqual([{ line: 4, reason: "already_exists" }]);
    expect(r.body.errors.map((e: any) => e.error).sort()).toEqual(["invalid_official_url", "invalid_row", "unknown_network"]);
    const list = await call("/api/catalog/programs?q=Gama Parceiros", { cookie: user });
    expect(list.body.items[0].acceptsBrazil).toBe("unverified");
    expect(list.body.items[0].verification).toBe("never_verified");
    // reimportar o mesmo arquivo não duplica
    const again = await call("/api/catalog/import", { method: "POST", cookie: editor, body: { csv } });
    expect(again.body.created).toBe(0);
  });
  it("usuário comum não importa; colunas obrigatórias são exigidas", async () => {
    expect((await call("/api/catalog/import", { method: "POST", cookie: user, body: { csv } })).status).toBe(403);
    expect((await call("/api/catalog/import", { method: "POST", cookie: editor, body: { csv: "a,b\n1,2" } })).status).toBe(400);
  });
});
