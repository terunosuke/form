import { describe, expect, it } from "vitest";
import { layoutBattens } from "../src/core/batten.js";
import type { BattenSpec } from "../src/core/masters.js";
import type { UniformPitch } from "../src/core/pitch.js";

// 設計書 §19 テストC(桟木)

function spec(over: Partial<BattenSpec> = {}): BattenSpec {
  return {
    id: "batten-3060",
    name: "桟木30×60",
    sectionWidth: 30,
    sectionDepth: 60,
    stockLengths: [2000, 3000, 4000],
    spliceAllowed: false,
    minUseLength: 300,
    rounding: { type: "ceil_unit", unit: 1 },
    ...over,
  };
}

const pitch450: UniformPitch = {
  type: "uniform", pitch: 450, mode: "fixed_pitch", startOffset: 0, endOffset: 0,
};

describe("ベニヤ継ぎ目への追加配置 (C-11)", () => {
  it("継ぎ目が既存位置と重複するときはスキップされる", () => {
    // W=1820: 基本位置 0,450,900,1350,1800。目地 910(追加)と 1350(重複→スキップ)
    const r = layoutBattens({
      faceWidth: 1820, faceHeight: 2000,
      panelJointUs: [910, 1350],
      config: {
        spec: spec(), pitch: pitch450, placeAtEnds: false,
        extraAtPanelJoints: true, extraAtCorners: false,
      },
    });
    expect(r.countBase).toBe(5);
    expect(r.countPanelJoint).toBe(1); // 910 のみ追加
    expect(r.countTotal.rounded).toBe(6);
    expect(r.notes.some((n) => n.includes("U-11"))).toBe(true);
  });
  it("端部配置は端部補強として別カウントされる", () => {
    // W=2000: 基本 0,450,...,1800。placeAtEnds で 2000 のみ追加(0 は基本と重複)
    const r = layoutBattens({
      faceWidth: 2000, faceHeight: 2000,
      config: {
        spec: spec(), pitch: pitch450, placeAtEnds: true,
        extraAtPanelJoints: false, extraAtCorners: false,
      },
    });
    expect(r.countBase).toBe(5);
    expect(r.countEdge).toBe(1);
  });
});

describe("高さ範囲別の分割材 (C-12)", () => {
  const cfgBase = {
    spec: spec(), pitch: pitch450, placeAtEnds: false,
    extraAtPanelJoints: false, extraAtCorners: false,
  };
  it("separate → 1 本の桟木が上下 2 ピースになる", () => {
    const r = layoutBattens({
      faceWidth: 900, faceHeight: 4000,
      config: { ...cfgBase, heightBand: { boundaryLevel: 2000, continuity: "separate" } },
    });
    expect(r.errors).toEqual([]);
    // 位置 0,450,900 の 3 本 × 2 ピース(2000+2000)
    expect(r.placements[0]!.segments).toHaveLength(2);
    expect(r.totalUsedLength).toBe(3 * 4000);
    expect(r.piecesByStockLength[2000]).toBe(6);
  });
  it("continuous → 1 本 4000 として材料取りされる", () => {
    const r = layoutBattens({
      faceWidth: 900, faceHeight: 4000,
      config: { ...cfgBase, heightBand: { boundaryLevel: 2000, continuity: "continuous" } },
    });
    expect(r.placements[0]!.segments).toHaveLength(1);
    expect(r.piecesByStockLength[4000]).toBe(3);
  });
});

describe("最小使用長さ (C-15)", () => {
  it("minUseLength 未満の必要長はエラーになる", () => {
    const r = layoutBattens({
      faceWidth: 900, faceHeight: 250, // 250 < minUseLength 300
      config: {
        spec: spec(), pitch: pitch450, placeAtEnds: false,
        extraAtPanelJoints: false, extraAtCorners: false,
      },
    });
    expect(r.errors.some((e) => e.includes("最小使用長さ"))).toBe(true);
  });
});
