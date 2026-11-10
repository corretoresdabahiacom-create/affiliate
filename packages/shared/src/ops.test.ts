import { describe, expect, it } from "vitest";
import {
  adjustmentSchema, canTransition, commissionSchema, isBotUserAgent, isPaidChannel, linkSchema, mapNetworkStatus,
  netAmount, nextStatuses, reconcile, signedAdjustment, type ReconRow,
} from "./index";

describe("ciclo financeiro da comissão", () => {
  it("segue estimada → pendente → aprovada → paga, sem pular para paga", () => {
    expect(canTransition("estimated", "pending")).toBe(true);
    expect(canTransition("pending", "approved")).toBe(true);
    expect(canTransition("approved", "paid")).toBe(true);
    expect(canTransition("estimated", "paid")).toBe(false);
    expect(canTransition("pending", "paid")).toBe(false);
  });
  it("paga é final; rejeitada só reabre como pendente", () => {
    expect(nextStatuses("paid")).toEqual([]);
    expect(nextStatuses("rejected")).toEqual(["pending"]);
    expect(canTransition("paid", "rejected")).toBe(false);
  });
  it("ajustes: reembolso, cancelamento e chargeback sempre descontam", () => {
    expect(signedAdjustment("refund", 10)).toBe(-10);
    expect(signedAdjustment("chargeback", -10)).toBe(-10);
    expect(signedAdjustment("adjustment", 5)).toBe(5);
    expect(netAmount(100, [-20, 5])).toBe(85);
  });
  it("comissão nunca nasce com status no corpo do cadastro", () => {
    const c = commissionSchema.parse({ amount: 10, currency: "usd" });
    expect("status" in c).toBe(false);
    expect(c.currency).toBe("USD");
    expect(c.conversionState).toBe("reported");
  });
  it("status de relatório desconhecido não vira aprovado", () => {
    expect(mapNetworkStatus("Approved")).toBe("approved");
    expect(mapNetworkStatus("reversed")).toBe("rejected");
    expect(mapNetworkStatus("PAGO")).toBe("paid");
    expect(mapNetworkStatus("algo novo")).toBe("pending");
  });
  it("valida ajuste", () => {
    expect(adjustmentSchema.safeParse({ kind: "refund", amount: 5 }).success).toBe(true);
    expect(adjustmentSchema.safeParse({ kind: "x", amount: 5 }).success).toBe(false);
  });
});

describe("conciliação", () => {
  const row = (id: string, ref: string | null, amount: number, status = "approved", currency = "USD"): ReconRow => ({ id, externalRef: ref, amount, currency, status });
  it("classifica iguais, diferenças, ausentes e sem referência", () => {
    const own = [row("o1", "A1", 10), row("o2", "A2", 10), row("o3", "A3", 10, "pending"), row("o4", "A4", 10), row("o5", null, 10), row("o6", "A6", 10, "approved", "BRL")];
    const rep = [row("r1", " a1 ", 10), row("r2", "A2", 12), row("r3", "A3", 10, "approved"), row("r5", "A9", 7), row("r6", "A6", 10)];
    const r = reconcile(own, rep);
    expect(r.matched.map((x) => x.own.id)).toEqual(["o1"]);
    expect(r.amountDiff.map((x) => x.own.id)).toEqual(["o2"]);
    expect(r.statusDiff.map((x) => x.own.id)).toEqual(["o3"]);
    expect(r.currencyDiff.map((x) => x.own.id)).toEqual(["o6"]);
    expect(r.missingInReport.map((x) => x.id)).toEqual(["o4"]);
    expect(r.unreferenced.map((x) => x.id)).toEqual(["o5"]);
    expect(r.missingInOwn.map((x) => x.id)).toEqual(["r5"]);
  });
});

describe("anti-bot e canais", () => {
  it("bloqueia robôs e UA vazio; aceita navegador", () => {
    expect(isBotUserAgent("")).toBe(true);
    expect(isBotUserAgent(null)).toBe(true);
    expect(isBotUserAgent("Googlebot/2.1 (+http://www.google.com/bot.html)")).toBe(true);
    expect(isBotUserAgent("curl/8.0")).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36")).toBe(false);
  });
  it("identifica canal pago", () => {
    expect(isPaidChannel("google_ads")).toBe(true);
    expect(isPaidChannel("seo")).toBe(false);
  });
  it("link rejeita URL perigosa e tag inválida", () => {
    expect(linkSchema.safeParse({ label: "x", url: "javascript:alert(1)" }).success).toBe(false);
    expect(linkSchema.safeParse({ label: "x", url: "https://a.example.com", campaignTag: "Tag com espaço" }).success).toBe(false);
    const ok = linkSchema.parse({ label: "x", url: "https://a.example.com", campaignTag: "BF-2026" });
    expect(ok.campaignTag).toBe("bf-2026");
    expect(ok.trackingMode).toBe("none");
  });
});
