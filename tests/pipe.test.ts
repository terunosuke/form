import { describe, expect, it } from "vitest";
import type { PipeSpec } from "../src/core/masters.js";
import { layoutPipes } from "../src/core/pipe.js";

// 設計書 §19 テストC(鋼管)

function spec(over: Partial<PipeSpec> = {}): PipeSpec {
  return {
    id: "pipe-50",
    name: "角パイプ50",
    shape: "square",
    width: 50,
    height: 50,
    wallThickness: 2.3,
    stockLengths: [2000, 3000, 4000],
    pipesPerLevel: 1,
    lineCount: 1,
    spliceAllowed: true,
    lapLength: 300,
    splicePosition: "fixed",
    minUseLength: 500,
    rounding: { type: "ceil_unit", unit: 1 },
    ...over,
  };
}

describe("継ぎ足し (C-13)", () => {
  it("必要長 7200、規格 {2000,3000,4000}、重ね 300 → 4000 定尺 + 3500 切断、継ぎ 1", () => {
    const r = layoutPipes({
      faceWidth: 7200, faceHeight: 1000, spec: spec(),
      verticalPitch: {
        type: "uniform", pitch: 600, mode: "fixed_pitch", startOffset: 300, endOffset: 300,
      },
    });
    expect(r.errors).toEqual([]);
    expect(r.levelCount).toBe(1); // 位置 300 のみ(900 > 700 で不可)
    const level = r.levels[0]!;
    expect(level.pieces).toHaveLength(2);
    expect(level.pieces[0]).toMatchObject({ stockLength: 4000, usedLength: 4000, isCut: false });
    expect(level.pieces[1]).toMatchObject({ stockLength: 4000, usedLength: 3500, isCut: true });
    expect(r.spliceCount).toBe(1);
    expect(r.totalUsedLength).toBe(7500); // 7200 + 重ね 300
    expect(r.piecesByStockLength[4000]).toBe(2);
    expect(r.cutPieces).toHaveLength(1);
  });
  it("継ぎ足し不可で最長規格超えはエラー", () => {
    const r = layoutPipes({
      faceWidth: 7200, faceHeight: 1000, spec: spec({ spliceAllowed: false }),
      verticalPitch: {
        type: "uniform", pitch: 600, mode: "fixed_pitch", startOffset: 300, endOffset: 300,
      },
    });
    expect(r.errors.some((e) => e.includes("継ぎ足し不可"))).toBe(true);
  });
});

describe("二本抱き (C-14)", () => {
  it("pipesPerLevel=2 で本数・総延長が 2 倍になる", () => {
    const vp = {
      type: "uniform" as const, pitch: 600, mode: "fixed_pitch" as const,
      startOffset: 300, endOffset: 150,
    };
    const single = layoutPipes({ faceWidth: 3600, faceHeight: 1800, spec: spec(), verticalPitch: vp });
    const twin = layoutPipes({
      faceWidth: 3600, faceHeight: 1800, spec: spec({ pipesPerLevel: 2 }), verticalPitch: vp,
    });
    expect(single.levelCount).toBe(3); // 300, 900, 1500
    expect(twin.levelCount).toBe(3);
    expect(twin.totalPieces.rounded).toBe(single.totalPieces.rounded * 2);
    expect(twin.totalUsedLength).toBe(single.totalUsedLength * 2);
  });
});

describe("二段階ピッチの段位置 (A-4 関連)", () => {
  it("最下段高さ・最上段離れが段位置に効く", () => {
    const r = layoutPipes({
      faceWidth: 3000, faceHeight: 3000, spec: spec(),
      verticalPitch: {
        type: "two_stage", boundaryLevel: 1500,
        lower: { pitch: 450, mode: "fixed_pitch" },
        upper: { pitch: 600, mode: "fixed_pitch" },
        placeAtBoundary: true, bottomOffset: 150, topClearance: 150,
      },
    });
    expect(r.levels.map((l) => l.levelV)).toEqual([150, 600, 1050, 1500, 2100, 2700]);
  });
});
