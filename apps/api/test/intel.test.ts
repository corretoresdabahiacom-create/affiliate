import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app";

let counter = 0;
type Opts = { method?: string; body?: unknown; cookie?: string };
async function call(path: string, o: Opts = {}) {
  const headers: Record<string, string> = { "cf-connecting-ip": `10.7.${Math.floor(counter / 250)}.${++counter % 250}`, "x-requested-with": "fetch" };
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.cookie) headers.cookie = o.cookie;
  const r = await app.request(path, { method: o.method ?? "GET", headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined }, env);
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
}
async function login(email: string) {
  const h = (ip: string) => ({ "content-type": "application/json", "x-requested-with": "fetch", "cf-connecting-ip": ip });
  const r1 = await app.request("/api/auth/login", { method: "POST", headers: h(`10.6.0.${++counter % 250}`), body: JSON.stringify({ email }) }, env);
  const token = new URL(((await r1.json()) as any).devLink).searchParams.get("token")!;
  const r2 = await app.request("/api/auth/verify", { method: "POST", headers: h(`10.6.1.${counter % 250}`), body: JSON.stringify({ token }) }, env);
  return r2.headers.get("set-cookie")!.split(";")[0]!;
}

let admin = "", editor = "", user = "", advId = "";
const profileBody = (o = {}) => ({ displayName: "U", locale: "pt-BR", country: "BR", niches: ["saas"], channels: ["blog"], hasWebsite: true, wantsRecurring: true, acceptsPaidTraffic: false, ...o });

beforeAll(async () => {
  admin = await login("boss@example.com");
  editor = await login("ed@example.com");
  user = await login("plain@example.com");
  const users = await call("/api/admin/users", { cookie: admin });
  const ed = users.body.users.find((u: any) => u.email === "ed@example.com");
  await call(`/api/admin/users/${ed.id}/role`, { method: "PATCH", body: { role: "editor" }, cookie: admin });
  advId = (await call("/api/catalog/advertisers", { method: "POST", body: { name: "Intel Corp" }, cookie: editor })).body.id;
  await call("/api/me/profile", { method: "PUT", body: profileBody(), cookie: user });
});

const mk = async (name: string) => (await call("/api/catalog/programs", { method: "POST", cookie: editor, body: { advertiserId: advId, name, segment: "saas" } })).body.id as string;
const source = (id: string, field: string | null, type = "official_docs") =>
  call(`/api/catalog/programs/${id}/sources`, { method: "POST", cookie: editor, body: { sourceType: type, field, url: `https://docs.example.com/${field ?? "g"}` } });
const patch = (id: string, body: unknown) => call(`/api/catalog/programs/${id}`, { method: "PATCH", body, cookie: editor });

/** Programa com os fatos principais confirmados por fonte oficial. */
async function confirmed(name: string, brazil: "yes" | "no" = "yes") {
  const id = await mk(name);
  for (const f of ["accepts_brazil", "is_recurring", "commission_percent", "commission_type", "cookie_days", "requires_website", "accepts_individuals", "payout_frequency"]) await source(id, f);
  await source(id, "signup_url");
  const r = await patch(id, {
    acceptsBrazil: brazil, isRecurring: "yes", commissionType: "percent", commissionPercent: 30, cookieDays: 60,
    requiresWebsite: "no", acceptsIndividuals: "yes", payoutFrequency: "monthly",
  });
  expect(r.status).toBe(200);
  await call(`/api/catalog/programs/${id}/verify`, { method: "POST", body: { action: "verify" }, cookie: editor });
  return id;
}

describe("acesso", () => {
  it("exige login", async () => {
    expect((await call("/api/intel/recommendations")).status).toBe(401);
  });
});

describe("pontuação", () => {
  it("programa sem dados: nota 0, brasileiro não verificado, lista o que falta", async () => {
    const id = await mk("Sem Dados");
    const r = await call(`/api/intel/programs/${id}/score`, { cookie: user });
    expect(r.status).toBe(200);
    expect(r.body.score.attractiveness.score).toBe(0);
    expect(r.body.score.availability).toBe("unverified");
    expect(r.body.score.quality.missing).toContain("accepts_brazil");
  });
  it("programa confirmado: justificativas separam confirmado, interpretação e sem dados", async () => {
    const id = await confirmed("Bom Programa");
    const r = await call(`/api/intel/programs/${id}/score`, { cookie: user });
    const items = r.body.score.attractiveness.items;
    const status = (c: string) => items.find((i: any) => i.criterion === c).status;
    expect(status("commission")).toBe("confirmed");
    expect(status("ease")).toBe("interpretation");
    expect(status("demand")).toBe("no_data");
    expect(r.body.score.availability).toBe("confirmed");
    expect(r.body.score.quality.score).toBeGreaterThan(60);
    expect(r.body.score.attractiveness.score).toBeGreaterThan(50);
    expect((await call("/api/intel/programs/nope/score", { cookie: user })).status).toBe(404);
  });
});

describe("comparação", () => {
  it("compara 2 a 4 programas na ordem pedida", async () => {
    const a = await confirmed("Comp A");
    const b = await mk("Comp B");
    const r = await call(`/api/intel/compare?ids=${b},${a}`, { cookie: user });
    expect(r.body.items.map((i: any) => i.program.name)).toEqual(["Comp B", "Comp A"]);
    expect(r.body.items[1].score.attractiveness.score).toBeGreaterThan(r.body.items[0].score.attractiveness.score);
  });
  it("rejeita quantidade inválida", async () => {
    expect((await call("/api/intel/compare?ids=a", { cookie: user })).status).toBe(400);
    expect((await call("/api/intel/compare?ids=a,b,c,d,e", { cookie: user })).status).toBe(400);
  });
});

describe("recomendações", () => {
  it("brasileiro: só entra como recomendado o que tem aceitação confirmada; não verificado vai para 'a verificar'; 'não' é excluído", async () => {
    const yes = await confirmed("Rec Sim");
    const no = await confirmed("Rec Nao", "no");
    const unknown = await mk("Rec Desconhecido");
    await patch(unknown, { commissionType: "unknown" });
    const r = await call("/api/intel/recommendations", { cookie: user });
    const names = (list: any[]) => list.map((i) => i.program.name);
    expect(names(r.body.recommended)).toContain("Rec Sim");
    expect(names(r.body.recommended)).not.toContain("Rec Desconhecido");
    expect(names(r.body.recommended)).not.toContain("Rec Nao");
    expect(names(r.body.toVerify)).not.toContain("Rec Sim");
    expect(r.body.excludedDenied).toBeGreaterThanOrEqual(1);
    expect(r.body.recommended.every((i: any) => i.score.availability === "confirmed")).toBe(true);
    void yes; void no;
  });
  it("sem perfil, sinaliza e nada é 'confirmado' para o país", async () => {
    const fresh = await login("noprofile@example.com");
    const r = await call("/api/intel/recommendations", { cookie: fresh });
    expect(r.body.profileMissing).toBe(true);
    expect(r.body.recommended).toEqual([]);
  });
  it("usuário de outro país: nenhuma recomendação 'disponível' (sem dado de aceitação para o país)", async () => {
    const pt = await login("pt@example.com");
    await call("/api/me/profile", { method: "PUT", body: profileBody({ country: "PT" }), cookie: pt });
    const r = await call("/api/intel/recommendations", { cookie: pt });
    expect(r.body.recommended).toEqual([]);
    expect(r.body.toVerify.length).toBeGreaterThan(0);
  });
  it("tráfego pago: bloqueio aparece quando a permissão não está confirmada", async () => {
    const p = await login("paid@example.com");
    await call("/api/me/profile", { method: "PUT", body: profileBody({ acceptsPaidTraffic: true }), cookie: p });
    const id = await mk("Sem Permissao Paga");
    const r = await call(`/api/intel/programs/${id}/score`, { cookie: p });
    expect(r.body.score.warnings).toContainEqual({ code: "paid_traffic_not_confirmed", severity: "blocker" });
  });
});

describe("configuração administrável", () => {
  const cfg = {
    weights: { commission: 18, recurrence: 14, cookie: 8, reputation: 6, brazil: 12, ease: 8, payout_methods: 4, min_payout: 4, demand: 5, conversion: 5, competition: 4, content_potential: 4, profile_fit: 12 },
    bands: { excellent: 95, good: 90, moderate: 85, low: 80 },
    thresholds: { commissionPercentFull: 40, cookieDaysFull: 60, recurrenceMonthsFull: 24 },
    minQualityForTopBands: 40,
    paidTrafficPolicy: "warn",
  };
  it("só admin altera; configuração inválida é recusada", async () => {
    expect((await call("/api/intel/admin/scoring", { method: "PUT", body: cfg, cookie: editor })).status).toBe(403);
    expect((await call("/api/intel/admin/scoring", { method: "PUT", body: { ...cfg, bands: { excellent: 10, good: 20, moderate: 30, low: 40 } }, cookie: admin })).status).toBe(400);
  });
  it("faixas novas passam a valer para todos", async () => {
    expect((await call("/api/intel/admin/scoring", { method: "PUT", body: cfg, cookie: admin })).status).toBe(200);
    const c = await call("/api/intel/config", { cookie: user });
    expect(c.body.config.bands.moderate).toBe(85);
    const r = await call("/api/intel/recommendations", { cookie: user });
    expect(r.body.recommended.every((i: any) => i.score.attractiveness.score >= 85)).toBe(true);
    const audit = await call("/api/admin/audit", { cookie: admin });
    expect(audit.body.entries.some((e: any) => e.action === "scoring.updated")).toBe(true);
  });
});

describe("alertas", () => {
  it("mudança de comissão e de aceitação geram alertas com fonte e data de verificação", async () => {
    const id = await confirmed("Alerta Prog");
    await source(id, "commission_percent", "official_page");
    await patch(id, { commissionPercent: 35 });
    const r = await call("/api/intel/alerts", { cookie: user });
    const commission = r.body.alerts.find((a: any) => a.category === "commission_changes" && a.programId === id);
    expect(commission.oldValue).toBe("30");
    expect(commission.newValue).toBe("35");
    expect(commission.sourceUrl).toMatch(/^https:\/\//);
    expect(commission.lastVerifiedAt).not.toBeNull();
    expect(r.body.alerts.some((a: any) => a.category === "now_accepts_brazil" && a.programId === id)).toBe(true);
    expect(r.body.alerts.some((a: any) => a.category === "recurring" && a.programId === id)).toBe(true);
    expect(r.body.alerts.some((a: any) => a.category === "new_programs" && a.programId === id)).toBe(true);
  });
  it("programa encerrado e link indisponível geram alerta", async () => {
    const id = await confirmed("Alerta Encerrado");
    await call(`/api/catalog/programs/${id}/status`, { method: "POST", body: { lifecycleStatus: "closed" }, cookie: editor });
    await patch(id, { signupUrlStatus: "unavailable" });
    const r = await call("/api/intel/alerts", { cookie: user });
    expect(r.body.alerts.some((a: any) => a.category === "closed" && a.programId === id)).toBe(true);
    expect(r.body.alerts.some((a: any) => a.category === "broken_links" && a.programId === id)).toBe(true);
  });
  it("informação desatualizada vira alerta", async () => {
    const id = await confirmed("Alerta Velho");
    await env.DB.prepare("UPDATE affiliate_programs SET last_verified_at = ? WHERE id = ?").bind(Date.now() - 200 * 86_400_000, id).run();
    const r = await call("/api/intel/alerts", { cookie: user });
    expect(r.body.alerts.some((a: any) => a.category === "outdated" && a.programId === id)).toBe(true);
  });
  it("preferências filtram categorias; 'marcar como lido' zera os não lidos", async () => {
    const u = await login("alerts@example.com");
    expect((await call("/api/intel/alerts/prefs", { cookie: u })).body.prefs.categories.length).toBe(10);
    expect((await call("/api/intel/alerts/prefs", { method: "PUT", body: { categories: ["commission_changes"], frequency: "weekly" }, cookie: u })).status).toBe(200);
    let r = await call("/api/intel/alerts", { cookie: u });
    expect(r.body.alerts.length).toBeGreaterThan(0);
    expect(r.body.alerts.every((a: any) => a.category === "commission_changes")).toBe(true);
    expect(r.body.unread).toBeGreaterThan(0);
    await call("/api/intel/alerts/seen", { method: "POST", cookie: u });
    r = await call("/api/intel/alerts", { cookie: u });
    expect(r.body.unread).toBe(0);
    expect((await call("/api/intel/alerts/prefs", { cookie: u })).body.prefs.frequency).toBe("weekly");
  });
  it("preferência inválida é recusada", async () => {
    expect((await call("/api/intel/alerts/prefs", { method: "PUT", body: { categories: ["x"], frequency: "daily" }, cookie: user })).status).toBe(400);
  });
});
