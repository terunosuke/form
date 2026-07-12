import { describe, expect, it } from "vitest";
import { computeTwoStage, computeUniform } from "../src/core/pitch.js";

// 設計書 §19 テストA(配置計算)

describe("等間隔・固定ピッチ (A-1)", () => {
  it("L=3640, p=450, offset=0 → 0〜3600 の 9 本、端部余り 40", () => {
    const r = computeUniform(3640, {
      type: "uniform", pitch: 450, mode: "fixed_pitch", startOffset: 0, endOffset: 0,
    });
    expect(r.errors).toEqual([]);
    expect(r.positions).toEqual([0, 450, 900, 1350, 1800, 2250, 2700, 3150, 3600]);
    expect(r.remainder).toBe(40);
  });
});

describe("等間隔・均等割り (A-2)", () => {
  it("L=3640, p=450 → 9 スパン・10 本、実ピッチ ≤ 450", () => {
    const r = computeUniform(3640, {
      type: "uniform", pitch: 450, mode: "equal_divide", startOffset: 0, endOffset: 0,
    });
    expect(r.errors).toEqual([]);
    expect(r.positions).toHaveLength(10);
    expect(r.positions[0]).toBe(0);
    expect(r.positions[9]).toBe(3640);
    expect(r.actualPitch).toBeLessThanOrEqual(450);
    expect(r.actualPitch).toBeCloseTo(3640 / 9, 1);
    expect(r.formula).toContain("9 等分");
  });
});

describe("二段階ピッチ (A-3)", () => {
  const base = {
    type: "two_stage" as const,
    boundaryLevel: 1500,
    lower: { pitch: 450, mode: "fixed_pitch" as const },
    upper: { pitch: 600, mode: "fixed_pitch" as const },
    bottomOffset: 0,
    topClearance: 0,
  };
  it("境界配置あり: 0,450,900,1350,1500,2100,2700", () => {
    const r = computeTwoStage(3000, { ...base, placeAtBoundary: true });
    expect(r.errors).toEqual([]);
    expect(r.positions).toEqual([0, 450, 900, 1350, 1500, 2100, 2700]);
  });
  it("境界配置なし: 0,450,900,1350,2100,2700", () => {
    const r = computeTwoStage(3000, { ...base, placeAtBoundary: false });
    expect(r.errors).toEqual([]);
    expect(r.positions).toEqual([0, 450, 900, 1350, 2100, 2700]);
  });
});

describe("最下段高さ・最上段離れ (A-4)", () => {
  it("H=3000, 最下段 150, 最上段離れ 150, p=600 固定", () => {
    const r = computeUniform(3000, {
      type: "uniform", pitch: 600, mode: "fixed_pitch", startOffset: 150, endOffset: 150,
    });
    expect(r.positions).toEqual([150, 750, 1350, 1950, 2550]);
    expect(r.remainder).toBe(300); // 2850 - 2550
  });
});

describe("異常系 (A-5)", () => {
  it("startOffset + endOffset > L はエラーで位置を出さない", () => {
    const r = computeUniform(1000, {
      type: "uniform", pitch: 450, mode: "fixed_pitch", startOffset: 600, endOffset: 600,
    });
    expect(r.positions).toEqual([]);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]).toContain("配置可能範囲がありません");
  });
});
