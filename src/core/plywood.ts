import type { PlywoodSpec } from "./masters.js";
import type { LayoutOrigin } from "./defaults.js";
import { CONFIRMED_DEFAULTS } from "./defaults.js";
import { applyRounding } from "./rounding.js";
import type { Rect, RoundedValue } from "./types.js";
import { EPS, fix, rectArea, rectIntersect } from "./types.js";

// ベニヤ割付(設計書 §11)。
// 面積の割り算ではなく、割付原点からグリッドを張って 1 枚ずつ矩形を配置する。
// 端材は転用しない:切断材 1 枚につき原板 1 枚を消費する。

export interface PlywoodPlacement {
  panelNo: number; // 面内連番
  fullOrCut: "full" | "cut";
  positionUV: { u: number; v: number }; // 配置位置(切り出し後の左下)
  orientation: "vertical" | "horizontal";
  cutWidth: number; // 切断後の幅(U方向)。全判は規格どおり
  cutLength: number; // 切断後の長さ(V方向)
  usedArea: number;
  wasteArea: number; // 原板 − 使用面積(全判は 0)
  memberId?: string;
  faceId?: string;
}

export interface Offcut {
  panelNo: number;
  area: number;
  note: string;
}

export interface PlywoodLayoutResult {
  placements: PlywoodPlacement[];
  fullCount: number;
  cutCount: number;
  totalCount: RoundedValue;
  usedArea: number; // mm^2
  wasteArea: number; // 廃棄見込み面積 mm^2
  offcuts: Offcut[]; // 端材一覧(転用はしない)
  formula: string;
  errors: string[];
}

export interface PlywoodLayoutInput {
  faceWidth: number;
  faceHeight: number;
  /** 勝ち負け・重複控除による控除領域(面UV座標) */
  deductions?: Rect[];
  spec: PlywoodSpec;
  orientation?: "vertical" | "horizontal";
  layoutOrigin?: LayoutOrigin; // 既定は左下(U-3)
  memberId?: string;
  faceId?: string;
}

export function layoutPlywood(input: PlywoodLayoutInput): PlywoodLayoutResult {
  const errors: string[] = [];
  const { faceWidth: W, faceHeight: H, spec } = input;
  if (W <= EPS || H <= EPS) errors.push(`型枠面の寸法が不正です(${W} × ${H})`);
  if (spec.width <= EPS || spec.length <= EPS) errors.push("ベニヤ規格の寸法が不正です");
  if (errors.length > 0) {
    return {
      placements: [], fullCount: 0, cutCount: 0,
      totalCount: applyRounding(spec.rounding, 0),
      usedArea: 0, wasteArea: 0, offcuts: [], formula: "", errors,
    };
  }

  const orientation = input.orientation ?? spec.defaultOrientation;
  // 縦使い:長さ(1820)を高さ方向Vに。横使いは90度回転。
  const panelU = orientation === "vertical" ? spec.width : spec.length;
  const panelV = orientation === "vertical" ? spec.length : spec.width;
  const origin = input.layoutOrigin ?? CONFIRMED_DEFAULTS.plywoodLayoutOrigin;
  const stepU = panelU + spec.kerf;
  const stepV = panelV + spec.kerf;
  const deductions = input.deductions ?? [];
  const face: Rect = { u: 0, v: 0, w: W, h: H };
  const sheetArea = panelU * panelV;

  const baseCols = columnStarts(W, panelU, stepU, origin);

  const placements: PlywoodPlacement[] = [];
  const offcuts: Offcut[] = [];
  let panelNo = 0;

  for (let j = 0; j * stepV < H - EPS; j++) {
    const v = j * stepV;
    let cols = baseCols;
    if (spec.jointDirection === "staggered" && j % 2 === 1) {
      cols = staggerColumns(baseCols, stepU, panelU, W);
    }
    for (const u of cols) {
      const cell: Rect = { u, v, w: panelU, h: panelV };
      const inter = rectIntersect(cell, face);
      if (!inter) continue;
      const dedArea = deductions.reduce((s, d) => {
        const o = rectIntersect(inter, d);
        return s + (o ? rectArea(o) : 0);
      }, 0);
      const usedArea = rectArea(inter) - dedArea;
      if (usedArea <= EPS) continue; // 全域が控除領域 → 配置なし

      panelNo++;
      const isFull =
        Math.abs(inter.w - panelU) < EPS && Math.abs(inter.h - panelV) < EPS && dedArea < EPS;
      const wasteArea = isFull ? 0 : fix(sheetArea - usedArea);
      placements.push({
        panelNo,
        fullOrCut: isFull ? "full" : "cut",
        positionUV: { u: fix(inter.u), v: fix(inter.v) },
        orientation,
        cutWidth: fix(inter.w),
        cutLength: fix(inter.h),
        usedArea: fix(usedArea),
        wasteArea,
        memberId: input.memberId,
        faceId: input.faceId,
      });
      if (!isFull) {
        offcuts.push({
          panelNo,
          area: wasteArea,
          note: `原板 ${panelU}×${panelV} から ${fix(inter.w)}×${fix(inter.h)} を使用(残りは転用しない)`,
        });
      }
    }
  }

  const fullCount = placements.filter((p) => p.fullOrCut === "full").length;
  const cutCount = placements.length - fullCount;
  const usedArea = fix(placements.reduce((s, p) => s + p.usedArea, 0));
  const wasteArea = fix(placements.reduce((s, p) => s + p.wasteArea, 0));
  return {
    placements,
    fullCount,
    cutCount,
    totalCount: applyRounding(spec.rounding, placements.length),
    usedArea,
    wasteArea,
    offcuts,
    formula:
      `面 ${W}×${H} に ${spec.name}(${panelU}×${panelV}、${orientation === "vertical" ? "縦使い" : "横使い"}、` +
      `切断代 ${spec.kerf}、原点 ${origin})を割付 → 全判 ${fullCount} 枚 + 切断材 ${cutCount} 枚`,
    errors,
  };
}

function columnStarts(W: number, panelU: number, stepU: number, origin: LayoutOrigin): number[] {
  if (origin === "bottom_left") {
    const cols: number[] = [];
    for (let i = 0; i * stepU < W - EPS; i++) cols.push(i * stepU);
    return cols;
  }
  if (origin === "bottom_right") {
    const cols: number[] = [];
    for (let u = W - panelU; u + panelU > EPS; u -= stepU) cols.push(fix(u));
    return cols.reverse();
  }
  // center:必要最小列数で面全体を覆い、左右対称に配置
  let n = Math.max(1, Math.ceil((W + (stepU - panelU)) / stepU - EPS));
  for (;;) {
    const gridW = n * stepU - (stepU - panelU);
    const start = (W - gridW) / 2;
    if (start <= EPS && start + gridW >= W - EPS) {
      const cols: number[] = [];
      for (let i = 0; i < n; i++) cols.push(fix(start + i * stepU));
      return cols;
    }
    n++;
  }
}

function staggerColumns(base: number[], stepU: number, panelU: number, W: number): number[] {
  const shift = stepU / 2;
  const cols = base.map((u) => fix(u - shift));
  const last = cols[cols.length - 1];
  if (last !== undefined && last + panelU < W - EPS) cols.push(fix(last + stepU));
  return cols;
}
