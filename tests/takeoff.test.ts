import { describe, expect, it } from "vitest";
import type {
  FormTieSpec, PconSpec, PipeSpec, PlywoodSpec, SeparatorSpec, BattenSpec,
} from "../src/core/masters.js";
import type { MaterialConfig } from "../src/core/takeoff.js";
import { DISCLAIMER, takeoffColumn, takeoffWall } from "../src/core/takeoff.js";

// 部材単位の拾い出しパイプライン(型枠面生成 → 材料割付 → 集計)

const plywood: PlywoodSpec = {
  id: "ply-12", name: "コンパネ12", width: 910, length: 1820, thickness: 12,
  defaultOrientation: "vertical", jointDirection: "aligned", kerf: 0,
  rounding: { type: "ceil_unit", unit: 1 },
};
const batten: BattenSpec = {
  id: "batten-3060", name: "桟木30×60", sectionWidth: 30, sectionDepth: 60,
  stockLengths: [2000, 3000, 4000], spliceAllowed: true, minUseLength: 300,
  rounding: { type: "ceil_unit", unit: 1 },
};
const pipe: PipeSpec = {
  id: "pipe-50", name: "角パイプ50", shape: "square", width: 50, height: 50,
  wallThickness: 2.3, stockLengths: [2000, 3000, 4000], pipesPerLevel: 1, lineCount: 1,
  spliceAllowed: true, lapLength: 300, splicePosition: "fixed", minUseLength: 500,
  rounding: { type: "ceil_unit", unit: 1 },
};
const separator: SeparatorSpec = {
  id: "sep-w38", name: "セパW3/8", diameter: "W3/8", endShape: "C",
  stockLengths: [150, 180, 200], customLengthRounding: 5, lengthRules: [],
  rounding: { type: "ceil_unit", unit: 1 },
};
const pcon: PconSpec = {
  id: "pcon-a", name: "Pコン", compatibleSeparators: ["sep-w38"], faceShape: "円錐",
  depth: 25, threadLength: 15, countPerEnd: 1, usage: "exposed",
  separatorLengthAdjust: 10, rounding: { type: "ceil_unit", unit: 1 },
};
const formTie: FormTieSpec = {
  id: "tie-w38", name: "フォームタイW3/8", compatibleSeparators: ["sep-w38"],
  compatiblePipeShapes: ["square"], countPerSeparatorEnd: 1,
  countPerSideSingle: 1, countPerSideDouble: 2, usage: "wall",
  rounding: { type: "ceil_unit", unit: 1 },
};

function config(): MaterialConfig {
  return {
    plywood: { spec: plywood },
    batten: {
      spec: batten,
      pitch: { type: "uniform", pitch: 450, mode: "fixed_pitch", startOffset: 0, endOffset: 0 },
      placeAtEnds: true,
      extraAtPanelJoints: true,
      jointCountPerJoint: 1,
      extraAtCorners: false,
    },
    pipe: {
      spec: pipe,
      verticalPitch: {
        type: "uniform", pitch: 600, mode: "fixed_pitch", startOffset: 300, endOffset: 150,
      },
    },
    separator: {
      spec: separator,
      pcon,
      bands: [
        {
          fromLevel: 0, toLevel: 10000,
          horizontalPitch: {
            type: "uniform", pitch: 450, mode: "fixed_pitch", startOffset: 150, endOffset: 150,
          },
          verticalPitch: 450,
        },
      ],
      edgeOffsets: { bottom: 150, topClearance: 150 },
    },
    formTie: { spec: formTie },
  };
}

describe("壁の拾い出し", () => {
  const wall = {
    memberId: "W1", length: 3640, height: 3000, thickness: 180,
    formworkSides: "both" as const,
  };

  it("両面型枠: 面 2・セパは 1 系統・注意書きあり", () => {
    const r = takeoffWall(wall, config());
    expect(r.errors).toEqual([]);
    expect(r.blockers).toEqual([]);
    expect(r.faces).toHaveLength(2);
    expect(r.pairs).toHaveLength(1);
    expect(r.disclaimer).toBe(DISCLAIMER);

    // ベニヤ: 4 列 × 2 段(上段 1180 切断)× 2 面
    expect(r.summary.plywoodFull).toBe(8);
    expect(r.summary.plywoodCut).toBe(8);

    // セパ: 縦 150〜2850@450 = 7 段 × 横 150〜3450@450 = 8 列 = 56 本(ペアで 1 回のみ)
    expect(r.summary.separatorCount).toBe(56);
    expect(r.pairs[0]!.separator.length).toBe(180); // 型枠同士の間隔
    expect(r.pairs[0]!.separator.lengthSource).toBe("form_gap");
    expect(r.summary.formTieCount).toBe(112); // 両端
    expect(r.summary.pconCount).toBe(112);
  });

  it("桟木はベニヤ縦目地(910 間隔)に追加され、区分が分かれる", () => {
    const r = takeoffWall(wall, config());
    const b = r.faces[0]!.batten;
    // 基本 0〜3600@450 = 9 本(0 含む)、端部 3640 のみ追加、目地 910/2730(1820 は基本 ×、450 の倍数でないため追加)
    expect(b.countBase).toBe(9);
    expect(b.countEdge).toBe(1);
    expect(b.countPanelJoint).toBeGreaterThan(0);
    expect(b.countTotal.rounded).toBe(b.countBase + b.countEdge + b.countPanelJoint);
  });

  it("片面型枠: セパ 0 + 警告、面は 1 つ", () => {
    const r = takeoffWall({ ...wall, formworkSides: "sideA" }, config());
    expect(r.faces).toHaveLength(1);
    expect(r.summary.separatorCount).toBe(0);
    expect(r.warnings.some((w) => w.includes("片面型枠"))).toBe(true);
  });

  it("控除領域が netArea とベニヤ枚数に反映される", () => {
    const withDeduction = takeoffWall(
      { ...wall, deductionsA: [{ u: 0, v: 0, w: 910, h: 3000 }] },
      config(),
    );
    const faceA = withDeduction.faces[0]!;
    expect(faceA.netArea).toBe(3640 * 3000 - 910 * 3000);
    const noDeduction = takeoffWall(wall, config());
    expect(faceA.plywood.placements.length).toBeLessThan(
      noDeduction.faces[0]!.plywood.placements.length,
    );
  });
});

describe("柱の拾い出し", () => {
  const column = { memberId: "C1", width: 800, depth: 600, height: 3000 };

  it("四面 + 2 ペア(間隔 = 奥行き / 幅)", () => {
    const r = takeoffColumn(column, config());
    expect(r.faces).toHaveLength(4);
    expect(r.pairs).toHaveLength(2);
    expect(r.pairs[0]!.formGap).toBe(600); // 幅面ペアの間隔 = 奥行き
    expect(r.pairs[1]!.formGap).toBe(800);
    expect(r.pairs[0]!.separator.length).toBe(600);
    expect(r.pairs[1]!.separator.length).toBe(800);
  });

  it("面を減らすと対向ペアが成立せずセパなし", () => {
    const r = takeoffColumn({ ...column, faceFlags: [true, true, false, true] }, config());
    expect(r.faces).toHaveLength(3);
    expect(r.pairs).toHaveLength(1); // F2-F4 のみ
  });

  it("コラムクランプ方式ではセパ類を計上しない(警告あり)", () => {
    const r = takeoffColumn({ ...column, tieMethod: "column_clamp" }, config());
    expect(r.pairs).toHaveLength(0);
    expect(r.summary.separatorCount).toBe(0);
    expect(r.warnings.some((w) => w.includes("コラムクランプ"))).toBe(true);
  });
});
