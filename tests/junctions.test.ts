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
    expect(c.winnerId).toBe("C1");
    expect(c.loserId).toBe("W1");
    expect(c.uRange).toEqual([1000, 1800]); // 壁始点(-1000)から柱 x=0..800
    expect(c.vRange).toEqual([0, 3000]);
    expect(c.defaultPolicy).toBe("deduct");
  });

  it("壁端が柱に突き付け(端部だけ重なる)", () => {
    const wallButt: MemberInput = {
      kind: "wall", memberId: "W2", length: 3000, height: 3000, thickness: 180,
      formworkSides: "both",
      placement: { x: 800 - 100, y: 400, angleDeg: 0 }, // 始点が柱内(x=700)
    };
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
    expect(cands[0]!.uRange![1]).toBeGreaterThan(cands[0]!.uRange![0]);
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

describe("壁×壁の検出 (E-26 相当)", () => {
  it("T字取り合い: 後に登録した壁が負け、通し壁の厚さ分を控除", () => {
    const through: MemberInput = {
      kind: "wall", memberId: "WA", length: 6000, height: 3000, thickness: 200,
      formworkSides: "both", placement: { x: 0, y: 0, angleDeg: 0 },
    };
    // WB は WA に直交して突き付け(WB 軸は y=-2000 から y=+50 まで)
    const butting: MemberInput = {
      kind: "wall", memberId: "WB", length: 2050, height: 3000, thickness: 180,
      formworkSides: "both", placement: { x: 3000, y: -2000, angleDeg: 90 },
    };
    const cands = detectJunctions([through, butting]);
    expect(cands).toHaveLength(1);
    const c = cands[0]!;
    expect(c.kind).toBe("wall_wall");
    expect(c.winnerId).toBe("WA"); // 先に登録した壁が通し
    expect(c.loserId).toBe("WB");
    // WA のフットプリントは y=-100〜+100 → WB 軸(始点 y=-2000)の 1900〜2050mm
    expect(c.uRange).toEqual([1900, 2050]);
  });

  it("十字交差でも候補は1件(先勝ち)で、負け側だけ控除される", () => {
    const a: MemberInput = {
      kind: "wall", memberId: "WA", length: 6000, height: 3000, thickness: 200,
      formworkSides: "both", placement: { x: 0, y: 0, angleDeg: 0 },
    };
    const b: MemberInput = {
      kind: "wall", memberId: "WB", length: 4000, height: 3000, thickness: 180,
      formworkSides: "both", placement: { x: 3000, y: -2000, angleDeg: 90 },
    };
    const cands = detectJunctions([a, b]);
    expect(cands).toHaveLength(1);
    const applied = applyJunctions([a, b], cands, {});
    const wa = applied.find((m) => m.memberId === "WA")!;
    const wb = applied.find((m) => m.memberId === "WB")!;
    if (wa.kind !== "wall" || wb.kind !== "wall") throw new Error("型が不正");
    expect(wa.deductionsA ?? []).toEqual([]);
    expect(wb.deductionsA).toHaveLength(1);
    expect(wb.deductionsA![0]!.w).toBe(200); // 通し壁の厚さ分
  });
});

describe("壁×梁の同一ライン(壁の上に梁が乗る)", () => {
  it("平行かつ同一通りの壁と梁 → 梁底の重なりを控除範囲として検出", () => {
    const wall: MemberInput = {
      kind: "wall", memberId: "W10", length: 4000, height: 3000, thickness: 200,
      formworkSides: "both", placement: { x: 1000, y: 0, angleDeg: 0 },
    };
    const beam: MemberInput = {
      kind: "beam", memberId: "G10", length: 6000, width: 300, depth: 600,
      sideFormLeft: true, sideFormRight: true, bottomForm: true,
      placement: { x: 0, y: 0, angleDeg: 0, z: 3000 }, // 壁天端に乗る
    };
    const cands = detectJunctions([wall, beam]);
    expect(cands).toHaveLength(1);
    const c = cands[0]!;
    expect(c.kind).toBe("wall_beam");
    expect(c.winnerId).toBe("W10");
    expect(c.loserId).toBe("G10");
    expect(c.uRange).toEqual([1000, 5000]); // 梁始点0基準で壁 1000〜5000

    const applied = applyJunctions([wall, beam], cands, {});
    const g = applied.find((m) => m.memberId === "G10")!;
    if (g.kind !== "beam") throw new Error("型が不正");
    expect(g.bottomDeductionsU).toEqual([[1000, 5000]]);
    // 梁側は控除されない
    expect(g.deductionsLeft ?? []).toEqual([]);
  });

  it("梁のZ未指定(0)なら検出し、適用時に梁下端を壁天端へ自動配置する", () => {
    const wall: MemberInput = {
      kind: "wall", memberId: "W12", length: 4000, height: 3000, thickness: 200,
      formworkSides: "both", placement: { x: 0, y: 0, angleDeg: 0 },
    };
    const beam: MemberInput = {
      kind: "beam", memberId: "G12", length: 6000, width: 300, depth: 600,
      sideFormLeft: true, sideFormRight: true, bottomForm: true,
      placement: { x: 0, y: 0, angleDeg: 0 }, // z 未指定
    };
    const cands = detectJunctions([wall, beam]);
    expect(cands).toHaveLength(1);
    expect(cands[0]!.description).toContain("壁天端(Z=3000)");

    const applied = applyJunctions([wall, beam], cands, {});
    const g = applied.find((m) => m.memberId === "G12")!;
    expect(g.placement!.z).toBe(3000); // 壁天端に自動配置
    expect(beam.placement!.z).toBeUndefined(); // 元データは不変
  });

  it("梁のZが明示されて壁天端から離れていれば対象外 / 一致すればZは変えない", () => {
    const wall: MemberInput = {
      kind: "wall", memberId: "W13", length: 4000, height: 3000, thickness: 200,
      formworkSides: "both", placement: { x: 0, y: 0, angleDeg: 0 },
    };
    const floating: MemberInput = {
      kind: "beam", memberId: "G13", length: 6000, width: 300, depth: 600,
      sideFormLeft: true, sideFormRight: true, bottomForm: true,
      placement: { x: 0, y: 0, angleDeg: 0, z: 6000 }, // 壁天端3000から離れている
    };
    expect(detectJunctions([wall, floating]).filter((c) => c.kind === "wall_beam"))
      .toHaveLength(0);

    const onTop: MemberInput = {
      ...floating, memberId: "G14",
      placement: { x: 0, y: 0, angleDeg: 0, z: 3000 },
    } as MemberInput;
    const cands = detectJunctions([wall, onTop]);
    expect(cands).toHaveLength(1);
    const applied = applyJunctions([wall, onTop], cands, {});
    expect(applied.find((m) => m.memberId === "G14")!.placement!.z).toBe(3000); // 維持
  });

  it("直交する壁と梁は同一ライン扱いしない(控除しない)", () => {
    const wall: MemberInput = {
      kind: "wall", memberId: "W11", length: 4000, height: 3000, thickness: 200,
      formworkSides: "both", placement: { x: 2000, y: -2000, angleDeg: 90 },
    };
    const beam: MemberInput = {
      kind: "beam", memberId: "G11", length: 6000, width: 300, depth: 600,
      sideFormLeft: true, sideFormRight: true, bottomForm: true,
      placement: { x: 0, y: 0, angleDeg: 0, z: 3000 },
    };
    expect(detectJunctions([wall, beam]).filter((c) => c.kind === "wall_beam")).toHaveLength(0);
  });
});

describe("梁×スラブの検出", () => {
  const slab: MemberInput = {
    kind: "slab", memberId: "S1", lengthX: 6000, lengthY: 4000, thickness: 200,
    bottomForm: true, placement: { x: 0, y: 0, angleDeg: 0, z: 3000 },
  };
  it("スラブ底(z=3000)を支える梁(z=2300, せい700)→ スラブ底に領域控除", () => {
    const beam: MemberInput = {
      kind: "beam", memberId: "G3", length: 8000, width: 600, depth: 700,
      sideFormLeft: true, sideFormRight: true, bottomForm: true,
      placement: { x: -1000, y: 2000, angleDeg: 0, z: 2300 },
    };
    const cands = detectJunctions([slab, beam]);
    expect(cands).toHaveLength(1);
    const c = cands[0]!;
    expect(c.kind).toBe("beam_slab");
    expect(c.winnerId).toBe("G3");
    expect(c.loserId).toBe("S1");
    expect(c.region).toEqual({ u: 0, v: 1700, w: 6000, h: 600 }); // 梁幅600の帯

    const applied = applyJunctions([slab, beam], cands, {});
    const s = applied.find((m) => m.memberId === "S1")!;
    if (s.kind !== "slab") throw new Error("型が不正");
    expect(s.deductionsBottom).toHaveLength(1);
  });
  it("高さが離れている梁は対象外 / 底型枠なしスラブは対象外", () => {
    const lowBeam: MemberInput = {
      kind: "beam", memberId: "G4", length: 8000, width: 600, depth: 700,
      sideFormLeft: true, sideFormRight: true, bottomForm: true,
      placement: { x: -1000, y: 2000, angleDeg: 0, z: 0 }, // 梁天端700 << スラブ底3000
    };
    expect(detectJunctions([slab, lowBeam])).toHaveLength(0);
    const noBottom: MemberInput = { ...slab, memberId: "S2", bottomForm: false } as MemberInput;
    const beam: MemberInput = {
      kind: "beam", memberId: "G5", length: 8000, width: 600, depth: 700,
      sideFormLeft: true, sideFormRight: true, bottomForm: true,
      placement: { x: -1000, y: 2000, angleDeg: 0, z: 2300 },
    };
    expect(detectJunctions([noBottom, beam])).toHaveLength(0);
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
    expect(wallThrough.deductionsA).toBeUndefined();
  });

  it("両方計上に変更すると控除されない", () => {
    const applied = applyJunctions([column, wallThrough], cands, { "C1~W1": "count_both" });
    const w = applied.find((m) => m.memberId === "W1")!;
    if (w.kind !== "wall") throw new Error("型が不正");
    expect(w.deductionsA ?? []).toEqual([]);
  });
});
