import { describe, expect, it } from "vitest";
import type {
  BattenSpec, FormTieSpec, PconSpec, PipeSpec, PlywoodSpec, SeparatorSpec,
} from "../src/core/masters.js";
import { faceLayoutSvg } from "../src/core/svg.js";
import { takeoffWall, type MaterialConfig } from "../src/core/takeoff.js";

// 板割図SVG(§23 ステップ10)

const plywood: PlywoodSpec = {
  id: "ply", name: "コンパネ12", width: 910, length: 1820, thickness: 12,
  defaultOrientation: "vertical", jointDirection: "aligned", kerf: 0,
  rounding: { type: "ceil_unit", unit: 1 },
};
const batten: BattenSpec = {
  id: "bat", name: "桟木", sectionWidth: 30, sectionDepth: 60,
  stockLengths: [4000], spliceAllowed: true, minUseLength: 100,
  rounding: { type: "ceil_unit", unit: 1 },
};
const pipe: PipeSpec = {
  id: "pipe", name: "角パイプ", shape: "square", width: 50, height: 50,
  wallThickness: 2.3, stockLengths: [4000], pipesPerLevel: 1, lineCount: 1,
  spliceAllowed: true, lapLength: 300, splicePosition: "fixed", minUseLength: 100,
  rounding: { type: "ceil_unit", unit: 1 },
};
const separator: SeparatorSpec = {
  id: "sep", name: "セパ", diameter: "W3/8", endShape: "C",
  stockLengths: [], customLengthRounding: 5, lengthRules: [],
  rounding: { type: "ceil_unit", unit: 1 },
};
const pcon: PconSpec = {
  id: "pcon", name: "Pコン", compatibleSeparators: ["sep"], faceShape: "-",
  depth: 0, threadLength: 0, countPerEnd: 1, usage: "other",
  separatorLengthAdjust: 0, rounding: { type: "ceil_unit", unit: 1 },
};
const formTie: FormTieSpec = {
  id: "tie", name: "Fタイ", compatibleSeparators: ["sep"],
  compatiblePipeShapes: ["square"], countPerSeparatorEnd: 1,
  countPerSideSingle: 1, countPerSideDouble: 2, usage: "common",
  rounding: { type: "ceil_unit", unit: 1 },
};
const config: MaterialConfig = {
  plywood: { spec: plywood },
  batten: {
    spec: batten,
    pitch: { type: "uniform", pitch: 450, mode: "fixed_pitch", startOffset: 0, endOffset: 0 },
    placeAtEnds: false, extraAtPanelJoints: false, extraAtCorners: false,
  },
  pipe: {
    spec: pipe,
    verticalPitch: {
      type: "uniform", pitch: 600, mode: "fixed_pitch", startOffset: 300, endOffset: 150,
    },
  },
  separator: {
    spec: separator, pcon,
    bands: [{
      fromLevel: 0, toLevel: 100000,
      horizontalPitch: {
        type: "uniform", pitch: 450, mode: "fixed_pitch", startOffset: 150, endOffset: 150,
      },
      verticalPitch: 450,
    }],
    edgeOffsets: { bottom: 150, topClearance: 150 },
  },
  formTie: { spec: formTie },
};

describe("板割図SVG", () => {
  const wall = takeoffWall(
    {
      memberId: "W1", length: 4000, height: 3000, thickness: 180,
      formworkSides: "both", deductionsA: [{ u: 0, v: 0, w: 500, h: 500 }],
    },
    config,
  );
  const faceA = wall.faces[0]!;

  it("面・パネル・桟木・鋼管・控除・セパが描画される", () => {
    const svg = faceLayoutSvg(faceA, {
      separatorPoints: wall.pairs[0]!.separator.points,
      battenSectionWidth: 30,
      pipeHeight: 50,
    });
    expect(svg).toContain("<svg");
    expect(svg).toContain("W1-A");
    // パネル矩形数 = 配置数(全判 + 切断)
    const panelRects = (svg.match(/#f7ecd4|#f4cf95/g) ?? []).length;
    expect(panelRects).toBe(faceA.plywood.placements.length);
    // 切断材には寸法ラベル
    expect(svg).toContain("910×1180");
    // 控除領域のハッチ
    expect(svg).toContain("url(#hatch-W1-A)");
    // セパ点
    const sepDots = (svg.match(/<circle/g) ?? []).length;
    expect(sepDots).toBe(wall.pairs[0]!.separator.points.length);
    // 全体寸法ラベル
    expect(svg).toContain(">4000<");
    expect(svg).toContain(">3000<");
  });

  it("表示オプションで桟木・鋼管を消せる", () => {
    const svg = faceLayoutSvg(faceA, { showBattens: false, showPipes: false });
    expect(svg).not.toContain("#8a5a2b");
    expect(svg).not.toContain("#4a6f8a");
  });
});
