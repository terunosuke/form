import { describe, expect, it } from "vitest";
import { aggregateProject } from "../src/core/aggregate.js";
import type {
  BattenSpec, FormTieSpec, PconSpec, PipeSpec, PlywoodSpec, SeparatorSpec,
} from "../src/core/masters.js";
import type { MaterialConfig } from "../src/core/takeoff.js";
import { takeoffBeam, takeoffFooting, takeoffSlab, takeoffWall } from "../src/core/takeoff.js";

// 梁・スラブ・フーチングの拾い出しと全体集計(テストE-24/25 関連)

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

function config(): MaterialConfig {
  return {
    plywood: { spec: plywood },
    batten: {
      spec: batten,
      pitch: { type: "uniform", pitch: 450, mode: "fixed_pitch", startOffset: 0, endOffset: 0 },
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

describe("梁の拾い出し(梁底の独立管理 E-25)", () => {
  const beam = {
    memberId: "G1", length: 5400, width: 600, depth: 700,
    sideFormLeft: true, sideFormRight: true, bottomForm: true,
  };

  it("梁側と梁底が別の面・別の脱型区分になる", () => {
    const r = takeoffBeam(beam, config());
    expect(r.errors).toEqual([]);
    const groups = r.faces.map((f) => [f.faceType, f.strippingGroup]);
    expect(groups).toContainEqual(["beam_side_left", "beam_side"]);
    expect(groups).toContainEqual(["beam_side_right", "beam_side"]);
    expect(groups).toContainEqual(["beam_bottom", "beam_bottom"]);
    const bottom = r.faces.find((f) => f.faceType === "beam_bottom")!;
    expect(bottom.supportRelated).toBe(true);
    // 底勝ち(既定): 梁底幅 = 梁幅
    expect(bottom.height).toBe(600);
    expect(bottom.notes.some((n) => n.includes("底勝ち"))).toBe(true);
  });

  it("梁側ペアのセパ間隔は梁幅", () => {
    const r = takeoffBeam(beam, config());
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]!.formGap).toBe(600);
    expect(r.pairs[0]!.separator.length).toBe(600);
  });

  it("側勝ちで側枠構成が未入力なら計算を停止する", () => {
    const r = takeoffBeam({ ...beam, bottomWidthRule: "side_wins" }, config());
    expect(r.blockers.some((b) => b.code === "BEAM_BOTTOM_WIDTH_UNDEFINED")).toBe(true);
    expect(r.faces.some((f) => f.faceType === "beam_bottom")).toBe(false);
  });

  it("側勝ち+構成入力ありなら控除された幅になる", () => {
    const r = takeoffBeam(
      {
        ...beam,
        bottomWidthRule: "side_wins",
        sideBuildUp: { plywoodThickness: 12, battenDepth: 60 },
      },
      config(),
    );
    const bottom = r.faces.find((f) => f.faceType === "beam_bottom")!;
    expect(bottom.height).toBe(600 - (12 + 60) * 2);
  });
});

describe("スラブの拾い出し", () => {
  it("スラブ底 + 指定した端部のみ生成、セパなし", () => {
    const r = takeoffSlab(
      {
        memberId: "S1", lengthX: 5460, lengthY: 3640, thickness: 200,
        bottomForm: true, edgeFormFlags: [true, false, true, false],
      },
      config(),
    );
    expect(r.faces.map((f) => f.faceType)).toEqual(["slab_bottom", "slab_edge_1", "slab_edge_3"]);
    const bottom = r.faces[0]!;
    expect(bottom.strippingGroup).toBe("slab_bottom");
    expect(bottom.supportRelated).toBe(true);
    expect(bottom.area).toBe(5460 * 3640);
    expect(r.pairs).toHaveLength(0);
    expect(r.summary.separatorCount).toBe(0);
  });
});

describe("フーチングの拾い出し", () => {
  const footing = { memberId: "F1", width: 2000, depth: 1500, height: 800 };

  it("既定: 四側面・底面なし・対向2ペアのセパ", () => {
    const r = takeoffFooting(footing, config());
    expect(r.faces).toHaveLength(4);
    expect(r.faces.every((f) => f.strippingGroup === "footing")).toBe(true);
    expect(r.faces.some((f) => f.faceType === "footing_bottom")).toBe(false);
    expect(r.pairs).toHaveLength(2);
    expect(r.pairs[0]!.formGap).toBe(2000);
    expect(r.pairs[1]!.formGap).toBe(1500);
  });

  it("底面型枠は手動で有効化できる", () => {
    const r = takeoffFooting({ ...footing, bottomForm: true }, config());
    expect(r.faces.some((f) => f.faceType === "footing_bottom")).toBe(true);
  });

  it("片側の側面をなしにすると対向ペアが消える", () => {
    const r = takeoffFooting({ ...footing, sideFlags: [true, false, true, true] }, config());
    expect(r.pairs).toHaveLength(1);
  });
});

describe("全体集計(梁側と梁底を合算しない §11)", () => {
  it("脱型区分別集計で梁側・梁底・スラブ底が別行になり、梁底が最後", () => {
    const cfg = config();
    const members = [
      takeoffWall(
        { memberId: "W1", length: 3640, height: 3000, thickness: 180, formworkSides: "both" },
        cfg,
      ),
      takeoffBeam(
        {
          memberId: "G1", length: 5400, width: 600, depth: 700,
          sideFormLeft: true, sideFormRight: true, bottomForm: true,
        },
        cfg,
      ),
      takeoffSlab(
        { memberId: "S1", lengthX: 5460, lengthY: 3640, thickness: 200, bottomForm: true },
        cfg,
      ),
    ];
    const agg = aggregateProject(members);
    expect(agg.errors).toEqual([]);
    expect(agg.blockers).toEqual([]);

    const groups = agg.byStrippingGroup.map((g) => g.group);
    expect(groups).toContain("beam_side");
    expect(groups).toContain("beam_bottom");
    expect(groups).toContain("slab_bottom");
    expect(groups[groups.length - 1]).toBe("beam_bottom"); // 最後まで残置

    const beamSide = agg.byStrippingGroup.find((g) => g.group === "beam_side")!;
    const beamBottom = agg.byStrippingGroup.find((g) => g.group === "beam_bottom")!;
    expect(beamSide.plywoodTotal).toBeGreaterThan(0);
    expect(beamBottom.plywoodTotal).toBeGreaterThan(0);
    expect(beamBottom.category).toBe("beam_bottom");

    // 材料別合計 = 部材別合計の総和
    const memberPlywood = agg.byMember.reduce((s, m) => s + m.plywoodTotal, 0);
    expect(agg.totals.plywood.totalCount).toBe(memberPlywood);
    const memberSeps = agg.byMember.reduce((s, m) => s + m.separatorCount, 0);
    expect(agg.totals.separator.totalCount).toBe(memberSeps);

    // 長さ別本数: 壁 180 と梁 600 が別キー
    expect(Object.keys(agg.totals.separator.byLength).map(Number).sort((a, b) => a - b))
      .toEqual([180, 600]);

    expect(agg.disclaimer).toContain("構造安全性を判定するものではありません");
  });
});
