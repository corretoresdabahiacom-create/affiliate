import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/app";

let counter = 0;
const uniq = () => `${Date.now()}-${++counter}`;

type Opts = { method?: string; body?: unknown; cookie?: string; ip?: string; csrf?: boolean; origin?: string };

async function call(path: string, o: Opts = {}) {
  const headers: Record<string, string> = { "cf-connecting-ip": o.ip ?? `10.0.0.${counter % 250}` };
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.cookie) headers.cookie = o.cookie;
  if (o.csrf !== false) headers["x-requested-with"] = "fetch";
  if (o.origin) headers.origin = o.origin;
  return app.request(
    path,
    { method: o.method ?? "GET", headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined },
    env,
  );
}

/** Faz o fluxo completo de login e devolve o cookie de sessão. */
async function login(email: string, ip?: string) {
  const r1 = await call("/api/auth/login", { method: "POST", body: { email }, ip });
  expect(r1.status).toBe(200);
  const { devLink } = (await r1.json()) as { devLink: string };
  const token = new URL(devLink).searchParams.get("token")!;
  const r2 = await call("/api/auth/verify", { method: "POST", body: { token }, ip });
  expect(r2.status).toBe(200);
  const setCookie = r2.headers.get("set-cookie")!;
  expect(setCookie).toContain("ai_session=");
  return { cookie: setCookie.split(";")[0]!, token, body: (await r2.json()) as any };
}

describe("saúde e proteção básica", () => {
  it("responde /api/health", async () => {
    const r = await call("/api/health");
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).ok).toBe(true);
  });

  it("envia cabeçalhos de segurança", async () => {
    const r = await call("/api/health");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("bloqueia POST sem o cabeçalho anti-CSRF", async () => {
    const r = await call("/api/auth/login", { method: "POST", body: { email: "a@b.com" }, csrf: false });
    expect(r.status).toBe(403);
  });

  it("bloqueia POST com Origin de outro site", async () => {
    const r = await call("/api/auth/login", {
      method: "POST",
      body: { email: "a@b.com" },
      origin: "https://evil.example",
    });
    expect(r.status).toBe(403);
  });

  it("rota inexistente em /api devolve JSON 404", async () => {
    const r = await call("/api/nada");
    expect(r.status).toBe(404);
    expect(((await r.json()) as any).error).toBe("not_found");
  });
});

describe("autenticação por link mágico", () => {
  it("cria usuário no primeiro login e abre sessão", async () => {
    const email = `user-${uniq()}@example.com`;
    const { cookie, body } = await login(email);
    expect(body.user.email).toBe(email);
    expect(body.user.role).toBe("user");
    const me = await call("/api/me", { cookie });
    expect(me.status).toBe(200);
    expect(((await me.json()) as any).user.email).toBe(email);
  });

  it("o cookie de sessão é HttpOnly e SameSite=Lax", async () => {
    const email = `cookie-${uniq()}@example.com`;
    const r1 = await call("/api/auth/login", { method: "POST", body: { email } });
    const token = new URL(((await r1.json()) as any).devLink).searchParams.get("token")!;
    const r2 = await call("/api/auth/verify", { method: "POST", body: { token } });
    const sc = r2.headers.get("set-cookie")!.toLowerCase();
    expect(sc).toContain("httponly");
    expect(sc).toContain("samesite=lax");
  });

  it("o token só funciona uma vez", async () => {
    const email = `once-${uniq()}@example.com`;
    const { token } = await login(email);
    const again = await call("/api/auth/verify", { method: "POST", body: { token } });
    expect(again.status).toBe(400);
  });

  it("rejeita token inventado", async () => {
    const r = await call("/api/auth/verify", { method: "POST", body: { token: "x".repeat(43) } });
    expect(r.status).toBe(400);
  });

  it("não guarda o token em texto puro no banco", async () => {
    const email = `hash-${uniq()}@example.com`;
    const { token } = await login(email);
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_tokens WHERE token_hash = ?").bind(token).first<{
      n: number;
    }>();
    expect(row!.n).toBe(0);
  });

  it("e-mail inválido devolve 400", async () => {
    const r = await call("/api/auth/login", { method: "POST", body: { email: "invalido" } });
    expect(r.status).toBe(400);
  });

  it("limita pedidos de login por e-mail (5 por hora)", async () => {
    const email = `limit-${uniq()}@example.com`;
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await call("/api/auth/login", { method: "POST", body: { email }, ip: `172.16.0.${i + 1}` });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it("logout encerra a sessão", async () => {
    const { cookie } = await login(`logout-${uniq()}@example.com`);
    expect((await call("/api/auth/logout", { method: "POST", cookie })).status).toBe(200);
    expect((await call("/api/me", { cookie })).status).toBe(401);
  });

  it("sem cookie, /api/me devolve 401", async () => {
    expect((await call("/api/me")).status).toBe(401);
  });
});

describe("perfil e onboarding", () => {
  it("salva o perfil e marca o onboarding como concluído", async () => {
    const { cookie } = await login(`profile-${uniq()}@example.com`);
    const before = (await (await call("/api/me", { cookie })).json()) as any;
    expect(before.profile.onboarded).toBe(false);

    const put = await call("/api/me/profile", {
      method: "PUT",
      cookie,
      body: {
        displayName: "Ana",
        locale: "en-US",
        country: "br",
        experience: "beginner",
        niches: ["saas", "ai_tools"],
        channels: ["blog", "youtube"],
        hasWebsite: true,
        monthlyBudgetUsd: 100,
        wantsRecurring: true,
      },
    });
    expect(put.status).toBe(200);
    const { profile } = (await put.json()) as any;
    expect(profile.country).toBe("BR");
    expect(profile.niches).toEqual(["saas", "ai_tools"]);
    expect(profile.onboarded).toBe(true);
    expect(profile.wantsRecurring).toBe(true);
  });

  it("rejeita nicho inválido", async () => {
    const { cookie } = await login(`bad-${uniq()}@example.com`);
    const r = await call("/api/me/profile", { method: "PUT", cookie, body: { niches: ["inventado"] } });
    expect(r.status).toBe(400);
  });

  it("isola dados entre usuários", async () => {
    const a = await login(`iso-a-${uniq()}@example.com`);
    const b = await login(`iso-b-${uniq()}@example.com`);
    await call("/api/me/profile", { method: "PUT", cookie: a.cookie, body: { displayName: "Alice" } });
    await call("/api/me/profile", { method: "PUT", cookie: b.cookie, body: { displayName: "Bruno" } });
    const meA = (await (await call("/api/me", { cookie: a.cookie })).json()) as any;
    const meB = (await (await call("/api/me", { cookie: b.cookie })).json()) as any;
    expect(meA.profile.displayName).toBe("Alice");
    expect(meB.profile.displayName).toBe("Bruno");
  });

  it("exporta os dados do próprio usuário", async () => {
    const email = `export-${uniq()}@example.com`;
    const { cookie } = await login(email);
    const r = await call("/api/me/export", { cookie });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).user.email).toBe(email);
  });

  it("exclui a conta, derruba a sessão e mantém a auditoria", async () => {
    const email = `del-${uniq()}@example.com`;
    const { cookie, body } = await login(email);
    const id = body.user.id as string;
    expect((await call("/api/me", { method: "DELETE", cookie })).status).toBe(200);
    expect((await call("/api/me", { cookie })).status).toBe(401);
    const user = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
    expect(user).toBeNull();
    const prof = await env.DB.prepare("SELECT user_id FROM user_profiles WHERE user_id = ?").bind(id).first();
    expect(prof).toBeNull();
    const log = await env.DB.prepare("SELECT action FROM audit_logs WHERE user_id = ? AND action = 'user.deleted'")
      .bind(id)
      .first();
    expect(log).not.toBeNull();
  });
});

describe("administração e papéis", () => {
  it("usuário comum não acessa rotas de admin", async () => {
    const { cookie } = await login(`plain-${uniq()}@example.com`);
    expect((await call("/api/admin/users", { cookie })).status).toBe(403);
    expect((await call("/api/admin/audit", { cookie })).status).toBe(403);
    expect((await call("/api/admin/plans", { cookie })).status).toBe(403);
  });

  it("sem login, rotas de admin devolvem 401", async () => {
    expect((await call("/api/admin/users")).status).toBe(401);
  });

  it("e-mail em ADMIN_EMAILS vira admin e lista usuários", async () => {
    const { cookie, body } = await login("boss@example.com");
    expect(body.user.role).toBe("admin");
    const r = await call("/api/admin/users", { cookie });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).users.length).toBeGreaterThan(0);
  });

  it("admin altera o papel de outro usuário e registra na auditoria", async () => {
    const admin = await login("boss@example.com");
    const target = await login(`target-${uniq()}@example.com`);
    const id = target.body.user.id as string;
    const r = await call(`/api/admin/users/${id}/role`, {
      method: "PATCH",
      cookie: admin.cookie,
      body: { role: "editor" },
    });
    expect(r.status).toBe(200);
    const me = (await (await call("/api/me", { cookie: target.cookie })).json()) as any;
    expect(me.user.role).toBe("editor");
    const audit = (await (await call("/api/admin/audit", { cookie: admin.cookie })).json()) as any;
    expect(audit.entries.some((e: any) => e.action === "user.role_changed" && e.target === id)).toBe(true);
  });

  it("admin não altera o próprio papel", async () => {
    const admin = await login("boss@example.com");
    const r = await call(`/api/admin/users/${admin.body.user.id}/role`, {
      method: "PATCH",
      cookie: admin.cookie,
      body: { role: "user" },
    });
    expect(r.status).toBe(400);
  });

  it("rejeita papel inválido", async () => {
    const admin = await login("boss@example.com");
    const r = await call(`/api/admin/users/qualquer/role`, {
      method: "PATCH",
      cookie: admin.cookie,
      body: { role: "root" },
    });
    expect(r.status).toBe(400);
  });

  it("planos começam sem preço e o admin configura", async () => {
    const admin = await login("boss@example.com");
    const list = (await (await call("/api/admin/plans", { cookie: admin.cookie })).json()) as any;
    expect(list.plans.map((p: any) => p.id)).toEqual(["free", "starter", "pro", "business"]);
    expect(list.plans.every((p: any) => p.monthlyPriceCents === null)).toBe(true);

    const put = await call("/api/admin/plans/starter", {
      method: "PUT",
      cookie: admin.cookie,
      body: { monthlyPriceCents: 1900, currency: "usd", limits: { ai_requests: 100 } },
    });
    expect(put.status).toBe(200);
    const after = (await (await call("/api/admin/plans", { cookie: admin.cookie })).json()) as any;
    const starter = after.plans.find((p: any) => p.id === "starter");
    expect(starter.monthlyPriceCents).toBe(1900);
    expect(starter.currency).toBe("USD");
    expect(starter.limits).toEqual({ ai_requests: 100 });
  });
});

describe("integridade do banco", () => {
  it("auditoria é somente de inserção", async () => {
    await env.DB.prepare("INSERT INTO audit_logs (user_id, action, created_at) VALUES (NULL, 'test', 1)").run();
    await expect(env.DB.prepare("UPDATE audit_logs SET action = 'x'").run()).rejects.toThrow();
    await expect(env.DB.prepare("DELETE FROM audit_logs").run()).rejects.toThrow();
  });

  it("papel inválido é rejeitado pelo banco", async () => {
    await expect(
      env.DB.prepare("INSERT INTO users (id, email, role, created_at) VALUES ('x', 'x@x.com', 'root', 1)").run(),
    ).rejects.toThrow();
  });
});
