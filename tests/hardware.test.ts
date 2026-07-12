import { describe, expect, it } from "vitest";
import { calcFormTies, calcPcons } from "../src/core/hardware.js";
import type { FormTieSpec, PconSpec, SeparatorSpec } from "../src/core/masters.js";

// 設計書 §19 テストD(フォームタイ・Pコン)

const sep: SeparatorSpec = {
  id: "sep-w38",
  name: "セパW3/8",
  diameter: "W3/8",
  endShape: "C",
  stockLengths: [200],
  customLengthRounding: 5,
  lengthRules: [],
  rounding: { type: "ceil_unit", unit: 1 },
};

const tie: FormTieSpec = {
  id: "tie-w38",
  name: "フォームタイW3/8",
  compatibleSeparators: ["sep-w38"],
  compatiblePipeShapes: ["square"],
  countPerSeparatorEnd: 1,
  countPerSideSingle: 1,
  countPerSideDouble: 2, // 標準: 両端各 1
  usage: "wall",
  rounding: { type: "ceil_unit", unit: 1 },
};

const pcon: PconSpec = {
  id: "pcon-a",
  name: "Pコン(打放し用)",
  compatibleSeparators: ["sep-w38"],
  faceShape: "円錐",
  depth: 25,
  threadLength: 15,
  countPerEnd: 1,
  usage: "exposed",
  separatorLengthAdjust: 10,
  rounding: { type: "ceil_unit", unit: 1 },
};

describe("両面・片面の使用個数 (D-19)", () => {
  it("両面: セパ 44 本 → フォームタイ 88、Pコン 88", () => {
    const t = calcFormTies({
      separatorCount: 44, formworkType: "double", spec: tie, separatorSpec: sep, pipeShape: "square",
    });
    expect(t.errors).toEqual([]);
    expect(t.count.rounded).toBe(88);
    const p = calcPcons({ separatorCount: 44, formworkType: "double", spec: pcon, separatorSpec: sep });
    expect(p.count.rounded).toBe(88);
  });
  it("片面: 設定値どおり(各 1 個/本)", () => {
    const t = calcFormTies({
      separatorCount: 44, formworkType: "single", spec: tie, separatorSpec: sep, pipeShape: "square",
    });
    expect(t.count.rounded).toBe(44);
    const p = calcPcons({ separatorCount: 44, formworkType: "single", spec: pcon, separatorSpec: sep });
    expect(p.count.rounded).toBe(44);
  });
});

describe("対応外の組合せ (D-20)", () => {
  it("非対応セパはエラーになり自動代替しない", () => {
    const otherSep: SeparatorSpec = { ...sep, id: "sep-w12", name: "セパW1/2" };
    const t = calcFormTies({
      separatorCount: 10, formworkType: "double", spec: tie, separatorSpec: otherSep, pipeShape: "square",
    });
    expect(t.errors.some((e) => e.includes("対応していません"))).toBe(true);
    expect(t.count.rounded).toBe(0);
    const p = calcPcons({ separatorCount: 10, formworkType: "double", spec: pcon, separatorSpec: otherSep });
    expect(p.errors.length).toBeGreaterThan(0);
    expect(p.count.rounded).toBe(0);
  });
  it("非対応の鋼管形状はエラーになる", () => {
    const t = calcFormTies({
      separatorCount: 10, formworkType: "double", spec: tie, separatorSpec: sep, pipeShape: "round",
    });
    expect(t.errors.some((e) => e.includes("パイプに対応していません"))).toBe(true);
  });
});
