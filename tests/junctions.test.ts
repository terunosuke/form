import { describe, expect, it } from "vitest";
import { applyJunctions, detectJunctions } from "../src/core/junctions.js";
import type { MemberInput } from "../src/core/project.js";

// 取り合い自動検出と控除適用(§10・§21、テストE-21/22/23 相当)

const column: MemberInput = {
  kind: "column", memberId: "C1", width: 800, depth: 800, height: 3000,
  placement: { x: 0, y: 0, angleDeg: 0 },
};

// 壁の軸が柱を貫通(柱ローカル y=400 を x方向に横断)
const wallThrough: MemberInput = {
  kind: "wall", memberId: "W1", length: 5000, height: 3000, thickness: 180,
  formworkSides: "both",
  placement: { x: -1000, y: 400, angleDeg: 0 },
};

describe("柱×壁の検出 (E-21)", () => {
  it("壁軸が柱を貫通 → 重なり範囲 1000〜1800mm を検出", () => {
    const cands = detectJunctions([column, wallThrough]);
    expect(cands).toHaveLength(1);
    const c = cands[0]!;
    expect(c.kind).toBe("column_wall");
    expect(c.id).toBe("C1~W1");
    expect(c.uRange).toEqual([1000, 1800]); // 壁始点(-1000)から柱 x=0..800
    expect(c.vRange).toEqual([0, 3000]);
    expect(c.defaultPolicy).toBe("deduct");
  });

  it("壁端が柱に突き付け(端部だけ重なる)", () => {
    const wallButt: MemberInput = {
      kind: "wall", memberId: "W2", length: 3000, height: 3000, thickness: 180,
      formworkSides: "both",
      placement: { x: 800 - 100, y: 400, angleDeg: 0 }, // 100mm だけ柱に入る…ではなく始点側
    };
    // 始点が柱内(x=700)→ 重なりは 0〜100mm
    const cands = detectJunctions([column, wallButt]);
    expect(cands).toHaveLength(1);
    expect(cands[0]!.uRange).toEqual([0, 100]);
  });

  it("離れていれば検出しない / 平面未配置は対象外", () => {
    const far: MemberInput = {
      kind: "wall", memberId: "W3", length: 3000, height: 3000, thickness: 180,
      formworkSides: "both", placement: { x: 5000, y: 5000, angleDeg: 0 },
    };
    const unplaced: MemberInput = {
      kind: "wall", memberId: "W4", length: 3000, height: 3000, thickness: 180,
      formworkSides: "both",
    };
    expect(detectJunctions([column, far, unplaced])).toHaveLength(0);
  });

  it("回転した柱でも検出する", () => {
    const rotCol: MemberInput = {
      kind: "column", memberId: "C2", width: 800, depth: 800, height: 3000,
      placement: { x: 2000, y: 0, angleDeg: 45 },
    };
    const wall: MemberInput = {
      kind: "wall", memberId: "W5", length: 4000, height: 3000, thickness: 180,
      formworkSides: "both", placement: { x: 1000, y: 300, angleDeg: 0 },
    };
    const cands = detectJunctions([rotCol, wall]);
    expect(cands).toHaveLength(1);
    expect(cands[0]!.uRange[1]).toBeGreaterThan(cands[0]!.uRange[0]);
  });

  it("高さが重ならなければ検出しない", () => {
    const highBeam: MemberInput = {
      kind: "beam", memberId: "G1", length: 5000, width: 600, depth: 700,
      sideFormLeft: true, sideFormRight: true, bottomForm: true,
      placement: { x: -1000, y: 400, angleDeg: 0, z: 5000 }, // 柱(0〜3000)より上
    };
    expect(detectJunctions([column, highBeam])).toHaveLength(0);
  });
});

describe("柱×梁の検出と高さ範囲", () => {
  it("梁(z=2300, せい700)と柱(0〜3000)→ 高さ範囲は梁下端基準 0〜700", () => {
    const beam: MemberInput = {
      kind: "beam", memberId: "G2", length: 5000, width: 600, depth: 700,
      sideFormLeft: true, sideFormRight: true, bottomForm: true,
      placement: { x: -1000, y: 400, angleDeg: 0, z: 2300 },
    };
    const cands = detectJunctions([column, beam]);
    expect(cands).toHaveLength(1);
    expect(cands[0]!.kind).toBe("column_beam");
    expect(cands[0]!.vRange).toEqual([0, 700]);
  });
});

describe("控除の適用と勝ち負け変更 (E-22/23)", () => {
  const cands = detectJunctions([column, wallThrough]);

  it("柱勝ち(標準): 壁の両面に控除領域が入る。元データは不変", () => {
    const applied = applyJunctions([column, wallThrough], cands, {});
    const w = applied.find((m) => m.memberId === "W1")!;
    if (w.kind !== "wall") throw new Error("型が不正");
    expect(w.deductionsA).toEqual([{ u: 1000, v: 0, w: 800, h: 3000 }]);
    expect(w.deductionsB).toEqual([{ u: 1000, v: 0, w: 800, h: 3000 }]);
    // 元の members は変更されない
    expect(wallThrough.deductionsA).toBeUndefined();
  });

  it("両方計上に変更すると控除されない", () => {
    const applied = applyJunctions([column, wallThrough], cands, { "C1~W1": "count_both" });
    const w = applied.find((m) => m.memberId === "W1")!;
    if (w.kind !== "wall") throw new Error("型が不正");
    expect(w.deductionsA ?? []).toEqual([]);
  });
});
