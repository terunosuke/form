import { describe, expect, it } from "vitest";
import { aggregateProject } from "../src/core/aggregate.js";
import {
  conditionsCsv, csvCell, faceDetailCsv, materialTotalsCsv, memberRowsCsv,
  strippingCsv, toCsv,
} from "../src/core/export.js";
import type {
  BattenSpec, FormTieSpec, PconSpec, PipeSpec, PlywoodSpec, SeparatorSpec,
} from "../src/core/masters.js";
import { runProject, PROJECT_FORMAT_VERSION, type Project } from "../src/core/project.js";
import type { MaterialConfig } from "../src/core/takeoff.js";

// CSV出力(§23 ステップ10・§24)

const plywood: PlywoodSpec = {
  id: "ply-12", name: "コンパネ,12mm", width: 910, length: 1820, thickness: 12,
  defaultOrientation: "vertical", jointDirection: "aligned", kerf: 0,
  rounding: { type: "ceil_unit", unit: 1 },
};
const batten: BattenSpec = {
  id: "bat", name: "桟木30×60", sectionWidth: 30, sectionDepth: 60,
  stockLengths: [2000, 3000, 4000], spliceAllowed: true, minUseLength: 100,
  rounding: { type: "ceil_unit", unit: 1 },
};
const pipe: PipeSpec = {
  id: "pipe", name: "角パイプ50", shape: "square", width: 50, height: 50,
  wallThickness: 2.3, stockLengths: [2000, 3000, 4000], pipesPerLevel: 1, lineCount: 1,
  spliceAllowed: true, lapLength: 300, splicePosition: "fixed", minUseLength: 100,
  rounding: { type: "ceil_unit", unit: 1 },
};
const separator: SeparatorSpec = {
  id: "sep", name: "セパW3/8", diameter: "W3/8", endShape: "C",
  stockLengths: [], customLengthRounding: 5, lengthRules: [],
  rounding: { type: "ceil_unit", unit: 1 },
};
const pcon: PconSpec = {
  id: "pcon", name: "Pコン", compatibleSeparators: ["sep"], faceShape: "-",
  depth: 0, threadLength: 0, countPerEnd: 1, usage: "other",
  separatorLengthAdjust: 0, rounding: { type: "ceil_unit", unit: 1 },
};
const formTie: FormTieSpec = {
  id: "tie", name: "フォームタイW3/8", compatibleSeparators: ["sep"],
  compatiblePipeShapes: ["square"], countPerSeparatorEnd: 1,
  countPerSideSingle: 1, countPerSideDouble: 2, usage: "common",
  rounding: { type: "ceil_unit", unit: 1 },
};

const materials: MaterialConfig = {
  plywood: { spec: plywood },
  batten: {
    spec: batten,
    pitch: { type: "uniform", pitch: 450, mode: "fixed_pitch", startOffset: 0, endOffset: 0 },
    placeAtEnds: false, extraAtPanelJoints: false, extraAtCorners: false,
  },
  pipe: {
    spec: pipe,
    verticalPitch: {
      type: "uniform", pitch: 600, mode: "fixed_pitch", startOffset: 150, endOffset: 100,
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

const project: Project = {
  formatVersion: PROJECT_FORMAT_VERSION,
  id: "prj", name: "出力テスト", unit: "mm",
  materials,
  members: [
    { kind: "wall", memberId: "W1", length: 3640, height: 3000, thickness: 180,
      formworkSides: "both", placement: { x: 0, y: 0, angleDeg: 0 } },
    { kind: "beam", memberId: "G1", length: 5400, width: 600, depth: 700,
      sideFormLeft: true, sideFormRight: true, bottomForm: true },
  ],
  manualAdjustments: [],
};

describe("CSV基礎", () => {
  it("カンマ・引用符・改行をエスケープする", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("x\ny")).toBe('"x\ny"');
    expect(csvCell(42)).toBe("42");
    expect(toCsv([["a,b", 1], ["c", 2]])).toBe('"a,b",1\r\nc,2\r\n');
  });
});

describe("各CSVの内容", () => {
  const run = runProject(project);
  const agg = aggregateProject(run.memberResults);

  it("材料別合計: 集計値と注意書きを含む", () => {
    const csv = materialTotalsCsv(agg);
    expect(csv).toContain(`ベニヤ,合計枚数,${agg.totals.plywood.totalCount},枚`);
    expect(csv).toContain(`セパレーター,合計本数,${agg.totals.separator.totalCount},本`);
    expect(csv).toContain("長さ 180mm");
    expect(csv).toContain("長さ 600mm");
    expect(csv).toContain("構造安全性を判定するものではありません");
  });

  it("部材別: 全部材の行がある", () => {
    const csv = memberRowsCsv(agg);
    expect(csv).toContain("W1,壁・擁壁");
    expect(csv).toContain("G1,梁");
  });

  it("脱型区分別: 梁側と梁底が別行", () => {
    const csv = strippingCsv(agg);
    expect(csv).toContain("beam_side,先行脱型可能");
    expect(csv).toContain("beam_bottom,梁底(最後まで残置)");
  });

  it("型枠面別: 面とペアの両方の内訳がある", () => {
    const csv = faceDetailCsv(run.memberResults);
    expect(csv).toContain("W1,W1-A,wall_side_A,wall");
    expect(csv).toContain("G1,G1-B,beam_bottom,beam_bottom");
    expect(csv).toContain("G1,G1-pair-sides,600");
  });

  it("計算条件: 規格・ピッチ・部材寸法を含み、placement は含まない", () => {
    const csv = conditionsCsv(project);
    expect(csv).toContain("910×1820×12");
    expect(csv).toContain("型枠同士の間隔");
    expect(csv).toContain("W1,壁・擁壁");
    expect(csv).not.toContain("placement");
    expect(csv).toContain("構造安全性を判定するものではありません");
  });
});
