import { describe, expect, it } from "vitest";
import type { PconSpec, SeparatorSpec } from "../src/core/masters.js";
import { layoutSeparators } from "../src/core/separator.js";
import type { SeparatorConfig } from "../src/core/separator.js";

// 設計書 §19 テストD(セパレーター)

const pconA: PconSpec = {
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

function sepSpec(over: Partial<SeparatorSpec> = {}): SeparatorSpec {
  return {
    id: "sep-w38",
    name: "セパW3/8",
    diameter: "W3/8",
    endShape: "C",
    stockLengths: [150, 200, 250, 300],
    customLengthRounding: 5,
    lengthRules: [
      {
        pconSpecId: "pcon-a",
        finishCondition: "打放し",
        formula: { base: "wall_thickness", addend: 0 },
      },
    ],
    rounding: { type: "ceil_unit", unit: 1 },
    ...over,
  };
}

function config(over: Partial<SeparatorConfig> = {}): SeparatorConfig {
  return {
    spec: sepSpec(),
    pcon: pconA,
    finishCondition: "打放し",
    formGap: 180,
    formworkType: "double",
    bands: [
      {
        fromLevel: 0,
        toLevel: 3000,
        horizontalPitch: {
          type: "uniform", pitch: 450, mode: "fixed_pitch", startOffset: 150, endOffset: 150,
        },
        verticalPitch: 450,
      },
    ],
    edgeOffsets: { bottom: 150, topClearance: 150 },
    ...over,
  };
}

describe("長さ計算 (D-16)", () => {
  it("既定: 長さ = 型枠同士の間隔 180 → 規格外なら特注丸め", () => {
    const r = layoutSeparators({ faceWidth: 3600, faceHeight: 3000, config: config() });
    expect(r.blockers).toEqual([]);
    expect(r.length).toBe(180); // 180 は stockLengths になし → 特注だが 5 の倍数
    expect(r.lengthSource).toBe("form_gap");
    expect(r.lengthFormula).toContain("型枠同士の間隔 180");
  });
  it("型枠間隔が規格長さと一致すれば規格品", () => {
    const r = layoutSeparators({
      faceWidth: 3600, faceHeight: 3000, config: config({ formGap: 200 }),
    });
    expect(r.length).toBe(200);
    expect(r.lengthType).toBe("standard");
  });
  it("マスタ方式(明示選択): 間隔180 + 加算0 + Pコン調整10×2 = 200 → 規格品", () => {
    const r = layoutSeparators({
      faceWidth: 3600, faceHeight: 3000, config: config({ lengthMode: "master_rule" }),
    });
    expect(r.length).toBe(200);
    expect(r.lengthSource).toBe("master_rule");
    expect(r.lengthType).toBe("standard");
  });
  it("規格にない長さは特注として丸め単位で切り上げ", () => {
    const r = layoutSeparators({
      faceWidth: 3600, faceHeight: 3000,
      config: config({ lengthMode: "master_rule", formGap: 192 }),
    });
    expect(r.lengthType).toBe("custom");
    expect(r.length).toBe(215); // 192 + 20 = 212 → 5 単位切り上げ
  });
});

describe("長さ未確定時の停止 (D-17)", () => {
  it("マスタ方式でルール未登録 → 計算を停止し、不足項目を表示する", () => {
    const r = layoutSeparators({
      faceWidth: 3600, faceHeight: 3000,
      config: config({ lengthMode: "master_rule", finishCondition: "防水" }), // ルールなし
    });
    expect(r.blockers).toHaveLength(1);
    expect(r.blockers[0]!.code).toBe("SEPARATOR_LENGTH_UNDEFINED");
    expect(r.blockers[0]!.message).toContain("長さを直接入力");
    expect(r.length).toBeNull();
    expect(r.points).toEqual([]);
    expect(r.count.rounded).toBe(0);
  });
  it("型枠間隔が未入力なら計算を停止する", () => {
    const r = layoutSeparators({
      faceWidth: 3600, faceHeight: 3000, config: config({ formGap: 0 }),
    });
    expect(r.blockers[0]!.code).toBe("SEPARATOR_FORM_GAP_UNDEFINED");
    expect(r.count.rounded).toBe(0);
  });
  it("手入力長さは常に最優先", () => {
    const r = layoutSeparators({
      faceWidth: 3600, faceHeight: 3000,
      config: config({ lengthMode: "master_rule", finishCondition: "防水", manualLength: 210 }),
    });
    expect(r.blockers).toEqual([]);
    expect(r.lengthSource).toBe("manual");
    expect(r.length).toBe(210);
  });
});

describe("帯別ピッチの格子 (D-18)", () => {
  it("下部 450/450・上部 600/600 で段数・列数が帯ごとに変わる", () => {
    const r = layoutSeparators({
      faceWidth: 3600, faceHeight: 3000,
      config: config({
        bands: [
          {
            fromLevel: 0, toLevel: 1500,
            horizontalPitch: {
              type: "uniform", pitch: 450, mode: "fixed_pitch", startOffset: 150, endOffset: 150,
            },
            verticalPitch: 450,
          },
          {
            fromLevel: 1500, toLevel: 3000,
            horizontalPitch: {
              type: "uniform", pitch: 600, mode: "fixed_pitch", startOffset: 150, endOffset: 150,
            },
            verticalPitch: 600,
          },
        ],
      }),
    });
    expect(r.blockers).toEqual([]);
    const rows = [...new Set(r.points.map((p) => p.v))].sort((a, b) => a - b);
    // 下帯: 150,600,1050,1500 / 上帯: 2100,2700(1500 は重複除去、2850 が上限)
    expect(rows).toEqual([150, 600, 1050, 1500, 2100, 2700]);
    const lowerCols = r.points.filter((p) => p.v === 150).length;
    const upperCols = r.points.filter((p) => p.v === 2100).length;
    expect(lowerCols).toBe(8); // 150〜3300 @450
    expect(upperCols).toBe(6); // 150〜3150 @600
    expect(r.points).toHaveLength(4 * 8 + 2 * 6);
    expect(r.count.rounded).toBe(44);
  });
});

describe("片面型枠 (D-19 関連)", () => {
  it("既定では配置せず警告(アンカー等別途)", () => {
    const r = layoutSeparators({
      faceWidth: 3600, faceHeight: 3000, config: config({ formworkType: "single" }),
    });
    expect(r.count.rounded).toBe(0);
    expect(r.warnings.some((w) => w.includes("片面型枠"))).toBe(true);
  });
});
