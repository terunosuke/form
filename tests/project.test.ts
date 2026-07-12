import { describe, expect, it } from "vitest";
import type {
  BattenSpec, FormTieSpec, PconSpec, PipeSpec, PlywoodSpec, SeparatorSpec,
} from "../src/core/masters.js";
import {
  deserializeProject, runProject, serializeProject,
  PROJECT_FORMAT_VERSION, type Project,
} from "../src/core/project.js";
import type { MaterialConfig } from "../src/core/takeoff.js";

// プロジェクト保存・再読込・再計算(テストF-29/F-30)

const plywood: PlywoodSpec = {
  id: "ply-12", name: "コンパネ12", width: 910, length: 1820, thickness: 12,
  defaultOrientation: "vertical", jointDirection: "aligned", kerf: 0,
  rounding: { type: "ceil_unit", unit: 1 },
};
const batten: BattenSpec = {
  id: "batten-3060", name: "桟木30×60", sectionWidth: 30, sectionDepth: 60,
  stockLengths: [2000, 3000, 4000], spliceAllowed: true, minUseLength: 100,
  rounding: { type: "ceil_unit", unit: 1 },
};
const pipe: PipeSpec = {
  id: "pipe-50", name: "角パイプ50", shape: "square", width: 50, height: 50,
  wallThickness: 2.3, stockLengths: [2000, 3000, 4000], pipesPerLevel: 1, lineCount: 1,
  spliceAllowed: true, lapLength: 300, splicePosition: "fixed", minUseLength: 100,
  rounding: { type: "ceil_unit", unit: 1 },
};
const separator: SeparatorSpec = {
  id: "sep-w38", name: "セパW3/8", diameter: "W3/8", endShape: "C",
  stockLengths: [], customLengthRounding: 5, lengthRules: [],
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

function materials(battenPitch = 450): MaterialConfig {
  return {
    plywood: { spec: plywood },
    batten: {
      spec: batten,
      pitch: {
        type: "uniform", pitch: battenPitch, mode: "fixed_pitch", startOffset: 0, endOffset: 0,
      },
      placeAtEnds: false,
      extraAtPanelJoints: false,
      extraAtCorners: false,
    },
    pipe: {
      spec: pipe,
      verticalPitch: {
        type: "uniform", pitch: 600, mode: "fixed_pitch", startOffset: 150, endOffset: 100,
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
      edgeOffsets: { bottom: 150, topClearance: 100 },
    },
    formTie: { spec: formTie },
  };
}

function sampleProject(): Project {
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    id: "prj-001",
    name: "テスト現場",
    siteName: "○○ビル",
    workSection: "1工区",
    pourSection: "1回目",
    unit: "mm",
    materials: materials(),
    members: [
      {
        kind: "wall", memberId: "W1",
        length: 3640, height: 3000, thickness: 180, formworkSides: "both",
      },
      { kind: "column", memberId: "C1", width: 800, depth: 600, height: 3000 },
    ],
    manualAdjustments: [],
  };
}

describe("保存・再読込ラウンドトリップ (F-29)", () => {
  it("シリアライズ→デシリアライズで同一内容、実行結果も一致", () => {
    const original = sampleProject();
    const json = serializeProject(original);
    const restored = deserializeProject(json);
    expect(restored.errors).toEqual([]);
    expect(restored.project).toEqual(original);

    const r1 = runProject(original);
    const r2 = runProject(restored.project!);
    expect(r2.aggregate.totals).toEqual(r1.aggregate.totals);
  });

  it("不正なデータはエラーを返す(推測で復元しない)", () => {
    expect(deserializeProject("{oops").project).toBeNull();
    const bad = deserializeProject(
      JSON.stringify({ formatVersion: 99, id: 1, members: [{ kind: "roof" }] }),
    );
    expect(bad.project).toBeNull();
    expect(bad.errors.some((e) => e.includes("保存形式バージョン"))).toBe(true);
    expect(bad.errors.some((e) => e.includes("kind"))).toBe(true);
  });
});

describe("材料条件変更後の再計算 (F-30)", () => {
  it("形状を変えずに桟木ピッチだけ変更 → 桟木数量のみ変わる", () => {
    const p1 = sampleProject();
    const r1 = runProject(p1);

    const p2: Project = { ...p1, materials: materials(300) }; // 450 → 300
    const r2 = runProject(p2);

    // 形状(面数・面積)は不変
    expect(r2.aggregate.byMember.map((m) => m.faceCount))
      .toEqual(r1.aggregate.byMember.map((m) => m.faceCount));
    expect(r2.aggregate.byMember.map((m) => m.netArea))
      .toEqual(r1.aggregate.byMember.map((m) => m.netArea));

    // 桟木は増える、ベニヤ・セパは不変
    expect(r2.aggregate.totals.batten.placedCount)
      .toBeGreaterThan(r1.aggregate.totals.batten.placedCount);
    expect(r2.aggregate.totals.plywood.totalCount).toBe(r1.aggregate.totals.plywood.totalCount);
    expect(r2.aggregate.totals.separator.totalCount)
      .toBe(r1.aggregate.totals.separator.totalCount);
  });
});
