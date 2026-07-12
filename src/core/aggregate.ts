import type { MemberKind, MemberTakeoffResult, StrippingGroup } from "./takeoff.js";
import { DISCLAIMER } from "./takeoff.js";
import type { MissingInput } from "./types.js";
import { fix } from "./types.js";

// 数量集計(設計書 §18・§24)。
// 構造部材別 / 脱型区分別 / 材料別・規格別・長さ別に集計する。
// 梁側と梁底は脱型区分が異なるため、常に別の行になる(§10)。

export interface MaterialTotals {
  plywood: {
    fullCount: number;
    cutCount: number;
    totalCount: number;
    usedArea: number; // mm^2
    wasteArea: number; // mm^2(廃棄見込み)
  };
  batten: {
    placedCount: number; // 配置本数
    totalUsedLength: number;
    byStockLength: Record<number, number>; // 規格長さ別の必要本数
    cutPieceCount: number;
  };
  pipe: {
    pieceCount: number;
    totalUsedLength: number;
    byStockLength: Record<number, number>;
    spliceCount: number;
    cutPieceCount: number;
  };
  separator: {
    totalCount: number;
    byLength: Record<number, number>; // 長さ別本数
  };
  formTie: { totalCount: number };
  pcon: { totalCount: number };
}

export interface MemberRow {
  memberId: string;
  memberKind: MemberKind;
  faceCount: number;
  netArea: number;
  plywoodTotal: number;
  battenCount: number;
  pipeCount: number;
  separatorCount: number;
  formTieCount: number;
  pconCount: number;
}

export interface StrippingGroupRow {
  group: StrippingGroup;
  /** 脱型カテゴリ(§11 の集計区分) */
  category: "early_strip" | "support_related" | "slab_bottom" | "beam_bottom" | "remain_last";
  faceCount: number;
  netArea: number;
  plywoodTotal: number;
  battenCount: number;
  pipeCount: number;
}

export interface ProjectAggregate {
  disclaimer: typeof DISCLAIMER;
  totals: MaterialTotals;
  byMember: MemberRow[];
  byStrippingGroup: StrippingGroupRow[];
  blockers: MissingInput[]; // 不足情報(あれば「未計算面あり」)
  warnings: string[];
  errors: string[];
}

/** 脱型区分 → 集計カテゴリ(§11)。梁底は最後まで残置 */
export function strippingCategory(group: StrippingGroup): StrippingGroupRow["category"] {
  switch (group) {
    case "column":
    case "wall":
    case "beam_side":
    case "slab_edge":
    case "footing":
      return "early_strip";
    case "slab_bottom":
      return "slab_bottom";
    case "beam_bottom":
      return "beam_bottom";
  }
}

function mergeCounts(into: Record<number, number>, from: Record<number, number>): void {
  for (const [k, v] of Object.entries(from)) {
    const key = Number(k);
    into[key] = (into[key] ?? 0) + v;
  }
}

export function aggregateProject(members: MemberTakeoffResult[]): ProjectAggregate {
  const totals: MaterialTotals = {
    plywood: { fullCount: 0, cutCount: 0, totalCount: 0, usedArea: 0, wasteArea: 0 },
    batten: { placedCount: 0, totalUsedLength: 0, byStockLength: {}, cutPieceCount: 0 },
    pipe: { pieceCount: 0, totalUsedLength: 0, byStockLength: {}, spliceCount: 0, cutPieceCount: 0 },
    separator: { totalCount: 0, byLength: {} },
    formTie: { totalCount: 0 },
    pcon: { totalCount: 0 },
  };
  const byMember: MemberRow[] = [];
  const groupMap = new Map<StrippingGroup, StrippingGroupRow>();
  const blockers: MissingInput[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  for (const m of members) {
    blockers.push(...m.blockers);
    warnings.push(...m.warnings);
    errors.push(...m.errors);

    for (const f of m.faces) {
      totals.plywood.fullCount += f.plywood.fullCount;
      totals.plywood.cutCount += f.plywood.cutCount;
      totals.plywood.totalCount += f.plywood.totalCount.rounded;
      totals.plywood.usedArea = fix(totals.plywood.usedArea + f.plywood.usedArea);
      totals.plywood.wasteArea = fix(totals.plywood.wasteArea + f.plywood.wasteArea);

      totals.batten.placedCount += f.batten.countTotal.rounded;
      totals.batten.totalUsedLength = fix(totals.batten.totalUsedLength + f.batten.totalUsedLength);
      mergeCounts(totals.batten.byStockLength, f.batten.piecesByStockLength);
      totals.batten.cutPieceCount += f.batten.cutPieces.length;

      totals.pipe.pieceCount += f.pipe.totalPieces.rounded;
      totals.pipe.totalUsedLength = fix(totals.pipe.totalUsedLength + f.pipe.totalUsedLength);
      mergeCounts(totals.pipe.byStockLength, f.pipe.piecesByStockLength);
      totals.pipe.spliceCount += f.pipe.spliceCount;
      totals.pipe.cutPieceCount += f.pipe.cutPieces.length;

      const row = groupMap.get(f.strippingGroup) ?? {
        group: f.strippingGroup,
        category: strippingCategory(f.strippingGroup),
        faceCount: 0,
        netArea: 0,
        plywoodTotal: 0,
        battenCount: 0,
        pipeCount: 0,
      };
      row.faceCount += 1;
      row.netArea = fix(row.netArea + f.netArea);
      row.plywoodTotal += f.plywood.totalCount.rounded;
      row.battenCount += f.batten.countTotal.rounded;
      row.pipeCount += f.pipe.totalPieces.rounded;
      groupMap.set(f.strippingGroup, row);
    }

    for (const p of m.pairs) {
      totals.separator.totalCount += p.separator.count.rounded;
      mergeCounts(totals.separator.byLength, p.separator.countByLength);
      totals.formTie.totalCount += p.formTie.count.rounded;
      totals.pcon.totalCount += p.pcon.count.rounded;
    }

    byMember.push({
      memberId: m.memberId,
      memberKind: m.memberKind,
      faceCount: m.faces.length,
      netArea: fix(m.faces.reduce((s, f) => s + f.netArea, 0)),
      plywoodTotal: m.summary.plywoodTotal,
      battenCount: m.summary.battenCount,
      pipeCount: m.summary.pipeCount,
      separatorCount: m.summary.separatorCount,
      formTieCount: m.summary.formTieCount,
      pconCount: m.summary.pconCount,
    });
  }

  // 脱型区分の標準順(§10: 柱→壁→梁側→スラブ端部→スラブ底→梁底)。梁底が最後
  const order: StrippingGroup[] = [
    "column", "wall", "footing", "beam_side", "slab_edge", "slab_bottom", "beam_bottom",
  ];
  const byStrippingGroup = order
    .filter((g) => groupMap.has(g))
    .map((g) => groupMap.get(g)!);

  return { disclaimer: DISCLAIMER, totals, byMember, byStrippingGroup, blockers, warnings, errors };
}
