import { describe, expect, it } from "vitest";
import { MESSAGES } from "./messages";
import { translate } from "./index";

describe("i18n", () => {
  const ptKeys = Object.keys(MESSAGES["pt-BR"]).sort();

  it.each(["en-US", "es"] as const)("%s tem exatamente as mesmas chaves do pt-BR", (loc) => {
    expect(Object.keys(MESSAGES[loc]).sort()).toEqual(ptKeys);
  });

  it.each(["pt-BR", "en-US", "es"] as const)("%s não tem textos vazios", (loc) => {
    for (const [k, v] of Object.entries(MESSAGES[loc])) {
      expect(v.trim(), `${loc}:${k}`).not.toBe("");
    }
  });

  it("mantém as mesmas variáveis {x} em todos os idiomas", () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of ptKeys as (keyof (typeof MESSAGES)["pt-BR"])[]) {
      expect(vars(MESSAGES["en-US"][k]), k).toBe(vars(MESSAGES["pt-BR"][k]));
      expect(vars(MESSAGES.es[k]), k).toBe(vars(MESSAGES["pt-BR"][k]));
    }
  });

  it("substitui variáveis", () => {
    expect(translate("pt-BR", "dashboard.welcome", { name: "Ana" })).toBe("Olá, Ana");
    expect(translate("en-US", "dashboard.welcome", { name: "Ana" })).toBe("Hello, Ana");
  });

  it("rótulos em português não ficam em inglês", () => {
    expect(translate("pt-BR", "nav.logout")).toBe("Sair");
    expect(translate("pt-BR", "nav.settings")).toBe("Configurações");
  });
});
