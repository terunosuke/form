import { describe, expect, it } from "vitest";
import type { PlywoodSpec } from "../src/core/masters.js";
import { layoutPlywood } from "../src/core/plywood.js";

// 設計書 §19 テストB(ベニヤ割付)

function spec(over: Partial<PlywoodSpec> = {}): PlywoodSpec {
  return {
    id: "ply-12",
    name: "コンパネ12",
    width: 910,
    length: 1820,
    thickness: 12,
    defaultOrientation: "vertical",
    jointDirection: "aligned",
    kerf: 0,
    rounding: { type: "ceil_unit", unit: 1 },
    ...over,
  };
}

describe("縦使い・割り切れる面 (B-6)", () => {
  it("3640×3640 → 全判 8 枚・切断 0・端材 0", () => {
    const r = layoutPlywood({ faceWidth: 3640, faceHeight: 3640, spec: spec() });
    expect(r.errors).toEqual([]);
    expect(r.fullCount).toBe(8);
    expect(r.cutCount).toBe(0);
    expect(r.wasteArea).toBe(0);
    expect(r.usedArea).toBe(3640 * 3640);
    expect(r.totalCount.rounded).toBe(8);
  });
});

describe("切断材が出る面 (B-7)", () => {
  it("4000×3000 → 全判 4 枚 + 切断 6 枚、使用面積 = 面全体", () => {
    const r = layoutPlywood({ faceWidth: 4000, faceHeight: 3000, spec: spec() });
    expect(r.fullCount).toBe(4); // 下段 910×1820 が 4 枚
    expect(r.cutCount).toBe(6); // 上段 4 枚(910×1180)+ 右端列 2 枚
    expect(r.usedArea).toBe(4000 * 3000);
    // 端材 = 消費原板面積 − 使用面積
    expect(r.wasteArea).toBeCloseTo(10 * 910 * 1820 - 4000 * 3000, 0);
    expect(r.offcuts).toHaveLength(6);
  });
});

describe("横使い (B-8)", () => {
  it("板割りが 90 度回転する(1820×910 セル)", () => {
    const r = layoutPlywood({
      faceWidth: 3640, faceHeight: 1820, spec: spec(), orientation: "horizontal",
    });
    expect(r.fullCount).toBe(4); // 1820×910 × 2列2段
    expect(r.cutCount).toBe(0);
  });
  it("千鳥目地では奇数段が半枚ずれる", () => {
    const r = layoutPlywood({
      faceWidth: 3640, faceHeight: 3640, spec: spec({ jointDirection: "staggered" }),
    });
    // 2段目(v=1820)は半枚ずれ → 左右端に切断材が出る
    const upper = r.placements.filter((p) => p.positionUV.v === 1820);
    expect(upper.some((p) => p.fullOrCut === "cut")).toBe(true);
    expect(r.usedArea).toBe(3640 * 3640);
  });
});

describe("控除領域 (B-9)", () => {
  it("セル全体が控除領域 → 配置なし、部分控除 → 切断材", () => {
    // 面 1820×1820、右列(u=910〜1820)を全高で控除
    const r = layoutPlywood({
      faceWidth: 1820, faceHeight: 1820, spec: spec(),
      deductions: [{ u: 910, v: 0, w: 910, h: 1820 }],
    });
    expect(r.placements).toHaveLength(1); // 右列は配置なし
    expect(r.placements[0]!.fullOrCut).toBe("full");

    // 部分控除:右列の下半分だけ控除 → 右列は切断材(使用面積が減る)
    const r2 = layoutPlywood({
      faceWidth: 1820, faceHeight: 1820, spec: spec(),
      deductions: [{ u: 910, v: 0, w: 910, h: 910 }],
    });
    expect(r2.placements).toHaveLength(2);
    const right = r2.placements.find((p) => p.positionUV.u === 910)!;
    expect(right.fullOrCut).toBe("cut");
    expect(right.usedArea).toBe(910 * 1820 - 910 * 910);
  });
});

describe("切断代 (B-10)", () => {
  it("kerf の有無で列数が変わる(W=3650: kerf0 → 5列、kerf5 → 4列)", () => {
    const r0 = layoutPlywood({ faceWidth: 3650, faceHeight: 1820, spec: spec() });
    const cols0 = new Set(r0.placements.map((p) => p.positionUV.u)).size;
    expect(cols0).toBe(5); // 最終列は幅 10 の切断材

    const r5 = layoutPlywood({ faceWidth: 3650, faceHeight: 1820, spec: spec({ kerf: 5 }) });
    const cols5 = new Set(r5.placements.map((p) => p.positionUV.u)).size;
    expect(cols5).toBe(4);
    expect(r0.placements.length).not.toBe(r5.placements.length);
  });
});

describe("割付原点 (U-3)", () => {
  it("bottom_right では切断材が左端に出る", () => {
    const r = layoutPlywood({
      faceWidth: 2000, faceHeight: 1820, spec: spec(), layoutOrigin: "bottom_right",
    });
    const cut = r.placements.find((p) => p.fullOrCut === "cut")!;
    expect(cut.positionUV.u).toBe(0); // 左端
    expect(cut.cutWidth).toBe(180); // 2000 - 910×2
  });
  it("center では切断材が左右対称に出る", () => {
    const r = layoutPlywood({
      faceWidth: 2000, faceHeight: 1820, spec: spec(), layoutOrigin: "center",
    });
    const cuts = r.placements.filter((p) => p.fullOrCut === "cut");
    expect(cuts).toHaveLength(2);
    expect(cuts[0]!.cutWidth).toBeCloseTo(cuts[1]!.cutWidth, 2);
  });
});
