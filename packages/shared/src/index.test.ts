import { describe, expect, it } from "vitest";
import {
  APPLICATION_STATUS,
  COMMISSION_STATUS,
  TRI_STATE,
  formatCurrency,
  loginRequestSchema,
  profileSchema,
} from "./index";

describe("schemas compartilhados", () => {
  it("normaliza o e-mail para minúsculas e remove espaços", () => {
    const r = loginRequestSchema.parse({ email: "  Ana@Example.COM " });
    expect(r.email).toBe("ana@example.com");
  });

  it("rejeita e-mail inválido", () => {
    expect(loginRequestSchema.safeParse({ email: "nao-e-email" }).success).toBe(false);
  });

  it("aplica padrões do perfil", () => {
    const p = profileSchema.parse({});
    expect(p.locale).toBe("pt-BR");
    expect(p.niches).toEqual([]);
    expect(p.hasWebsite).toBe(false);
  });

  it("rejeita nicho desconhecido", () => {
    expect(profileSchema.safeParse({ niches: ["inexistente"] }).success).toBe(false);
  });

  it("converte país para maiúsculas com 2 letras", () => {
    expect(profileSchema.parse({ country: "br" }).country).toBe("BR");
    expect(profileSchema.safeParse({ country: "BRA" }).success).toBe(false);
  });
});

describe("enums de domínio", () => {
  it("tri-estado tem exatamente yes, no e unverified", () => {
    expect([...TRI_STATE]).toEqual(["yes", "no", "unverified"]);
  });
  it("status de inscrição segue o prompt mestre", () => {
    expect(APPLICATION_STATUS).toContain("application_pending");
    expect(APPLICATION_STATUS).toHaveLength(8);
  });
  it("ciclo de comissão tem cinco estados", () => {
    expect([...COMMISSION_STATUS]).toEqual(["estimated", "pending", "approved", "paid", "rejected"]);
  });
});

describe("formatação por localidade", () => {
  it("formata BRL em pt-BR", () => {
    expect(formatCurrency(1234.5, "BRL", "pt-BR").replace(/\s/g, " ")).toContain("1.234,50");
  });
  it("formata USD em en-US", () => {
    expect(formatCurrency(1234.5, "USD", "en-US")).toBe("$1,234.50");
  });
});
