import { describe, expect, it } from "vitest";
import { addMonths, agingBucket, csvCell, epc, planLimit, rate, roi, toCsv, withinLimit } from "./analytics";

describe("indicadores", () => {
  it("ROI, EPC e taxa são null sem base", () => {
    expect(roi(100, 0)).toBeNull();
    expect(roi(100, null)).toBeNull();
    expect(epc(10, 0)).toBeNull();
    expect(rate(1, 0)).toBeNull();
  });
  it("calcula valores", () => {
    expect(roi(150, 100)).toBe(0.5);
    expect(roi(50, 100)).toBe(-0.5);
    expect(epc(10, 200)).toBe(0.05);
    expect(rate(5, 200)).toBe(0.025);
  });
});
describe("addMonths", () => {
  it("ajusta fim de mês", () => {
    expect(new Date(addMonths(Date.UTC(2026, 0, 31), 1)).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(new Date(addMonths(Date.UTC(2026, 11, 15), 1)).toISOString().slice(0, 10)).toBe("2027-01-15");
    expect(new Date(addMonths(Date.UTC(2028, 0, 31), 1)).toISOString().slice(0, 10)).toBe("2028-02-29");
  });
});
describe("aging e CSV", () => {
  it("faixas", () => {
    expect(agingBucket(0)).toBe("0-30");
    expect(agingBucket(31)).toBe("31-60");
    expect(agingBucket(91)).toBe("90+");
  });
  it("neutraliza fórmulas e escapa aspas", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('x"y')).toBe('"x""y"');
    expect(csvCell(-5)).toBe("-5");
    expect(toCsv(["a"], [["+1"]])).toBe("a\r\n'+1\r\n");
  });
});
describe("limites", () => {
  it("ausente é ilimitado, 0 desliga", () => {
    expect(planLimit({}, "links")).toBeNull();
    expect(withinLimit(null, 9999)).toBe(true);
    expect(withinLimit(planLimit({ links: 0 }, "links"), 0)).toBe(false);
    expect(withinLimit(5, 4)).toBe(true);
    expect(withinLimit(5, 5)).toBe(false);
  });
});
