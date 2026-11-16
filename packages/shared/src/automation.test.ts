import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, backoffMs, classifyCheck, digestEmail, inboundBodySchema, normalizeContent, safeInternalLink, signPayload, webhookCreateSchema } from "./automation";

describe("assinatura", () => {
  it("é estável, depende do segredo, do tempo e do corpo", async () => {
    const a = await signPayload("s", 100, "{}");
    expect(a).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(await signPayload("s", 100, "{}")).toBe(a);
    expect(await signPayload("t", 100, "{}")).not.toBe(a);
    expect(await signPayload("s", 101, "{}")).not.toBe(a);
    expect(await signPayload("s", 100, "{ }")).not.toBe(a);
  });
  it("bate com um HMAC-SHA256 conhecido (RFC 4231, caso 2)", async () => {
    // chave "Jefe", mensagem "what do ya want for nothing?" = 5bdcc146...; aqui a mensagem é `${ts}.${body}`
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("Jefe"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const ref = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("1.what do ya want for nothing?")))].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(await signPayload("Jefe", 1, "what do ya want for nothing?")).toBe("sha256=" + ref);
  });
});

describe("reenvio", () => {
  it("espera cresce e depois desiste", () => {
    expect([1, 2, 3, 4].map((n) => backoffMs(n))).toEqual([60_000, 300_000, 1_800_000, 7_200_000]);
    expect(backoffMs(MAX_ATTEMPTS)).toBeNull();
    expect(backoffMs(0)).toBe(60_000);
  });
});

describe("entradas validadas", () => {
  it("webhook exige evento válido; entrada rejeita ação desconhecida", () => {
    expect(webhookCreateSchema.safeParse({ label: "x", url: "https://a.example.com", events: ["order.new"] }).success).toBe(true);
    expect(webhookCreateSchema.safeParse({ label: "x", url: "https://a.example.com", events: ["tudo"] }).success).toBe(false);
    expect(webhookCreateSchema.safeParse({ label: "x", url: "nao-e-url", events: ["order.new"] }).success).toBe(false);
    expect(inboundBodySchema.safeParse({ action: "notify", title: "t" }).success).toBe(true);
    expect(inboundBodySchema.safeParse({ action: "drop_table" }).success).toBe(false);
    expect(inboundBodySchema.safeParse({ action: "notify", title: "" }).success).toBe(false);
  });
  it("só links internos em notificações", () => {
    expect(safeInternalLink("/orders")).toBe("/orders");
    expect(safeInternalLink("/programs/abc?x=1")).toBe("/programs/abc?x=1");
    for (const bad of ["https://evil.com", "//evil.com", "javascript:alert(1)", "orders", "/a b", null, undefined]) expect(safeInternalLink(bad as any)).toBeNull();
  });
});

describe("monitor", () => {
  it("normaliza removendo script, estilo, tags e espaços", () => {
    const a = normalizeContent("<html><style>a{}</style><script>x()</script><body>\n Comissão   <b>10%</b> &nbsp; </body></html>");
    expect(a).toBe("comissão 10%");
    expect(normalizeContent("<!-- c --><p>Comissão 10%</p>")).toBe(a);
  });
  const ok = (hash: string) => ({ status: 200, hash });
  it("1ª leitura cria a base sem avisar", () => {
    expect(classifyCheck(null, ok("a"))).toMatchObject({ finding: null, next: { hash: "a", failures: 0 } });
  });
  it("mudança de conteúdo avisa; igual não", () => {
    expect(classifyCheck({ status: 200, hash: "a", failures: 0 }, ok("a")).finding).toBeNull();
    expect(classifyCheck({ status: 200, hash: "a", failures: 0 }, ok("b")).finding).toEqual({ kind: "source_changed" });
  });
  it("falha só avisa na 2ª seguida, uma vez; ao voltar avisa que voltou e não acusa mudança", () => {
    const f1 = classifyCheck({ status: 200, hash: "a", failures: 0 }, { status: 503, hash: null });
    expect(f1.finding).toBeNull();
    expect(f1.next).toEqual({ status: 503, hash: "a", failures: 1 });
    const f2 = classifyCheck(f1.next, { status: null, hash: null });
    expect(f2.finding).toEqual({ kind: "source_down" });
    expect(classifyCheck(f2.next, { status: 404, hash: null }).finding).toBeNull();
    expect(classifyCheck(f2.next, ok("zzz")).finding).toEqual({ kind: "source_back" });
  });
  it("resposta que não é 2xx nunca vira conteúdo", () => {
    expect(classifyCheck({ status: 200, hash: "a", failures: 0 }, { status: 200, hash: null }).next.failures).toBe(1);
  });
});

describe("resumo por e-mail", () => {
  it("lista alertas com fonte (ou o aviso de que não há), cancelamento e idioma", () => {
    const m = digestEmail("en-US", [{ programName: "P", advertiser: "A", category: "closed", sourceUrl: null }, { programName: "Q", advertiser: "B", category: "new_programs", sourceUrl: "https://x.example.com/p" }], "https://app/u");
    expect(m.subject).toContain("2 update(s)");
    expect(m.text).toContain("No official source recorded");
    expect(m.text).toContain("https://x.example.com/p");
    expect(m.text).toContain("https://app/u");
    expect(digestEmail("es", [], "u").subject).toContain("novedad");
    expect(digestEmail("pt-BR", Array(40).fill({ programName: "P", advertiser: "A", category: "c", sourceUrl: null }), "u").text.split("\n- ").length - 1).toBe(30);
  });
});
