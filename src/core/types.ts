// 共通型定義。内部単位はすべて mm。
// 面ローカル座標系:U = 幅方向、V = 高さ方向(原点は面の左下)。

export interface Point2D {
  u: number;
  v: number;
}

/** 面ローカルUV座標上の矩形(控除領域・板割りセルなどに使用) */
export interface Rect {
  u: number;
  v: number;
  w: number;
  h: number;
}

export type RoundingRule =
  | { type: "none" }
  | { type: "ceil_unit"; unit: number }
  | { type: "ceil_percent"; percent: number };

/** 丸め適用結果。丸め前の生値と計算式を必ず保持する(設計書 §25 追跡性) */
export interface RoundedValue {
  raw: number;
  rounded: number;
  rule: RoundingRule;
  formula: string;
}

/** 数量計算を停止させる不足情報(推測補完の禁止) */
export interface MissingInput {
  code: string;
  message: string;
}

export const EPS = 1e-6;

/** 浮動小数の座標を 0.01mm に整形 */
export function fix(v: number): number {
  return Math.round(v * 100) / 100;
}

export function rectArea(r: Rect): number {
  return r.w * r.h;
}

/** 矩形同士の交差。交差なしは null */
export function rectIntersect(a: Rect, b: Rect): Rect | null {
  const u = Math.max(a.u, b.u);
  const v = Math.max(a.v, b.v);
  const w = Math.min(a.u + a.w, b.u + b.w) - u;
  const h = Math.min(a.v + a.h, b.v + b.h) - v;
  if (w <= EPS || h <= EPS) return null;
  return { u, v, w, h };
}
