import type { RoundingRule } from "./types.js";

// フェーズ0で確定した既定値(2026-07-12 発注者回答)。設計書 §2 参照。

export type LayoutOrigin = "bottom_left" | "bottom_right" | "center";
export type ColumnTieMethod = "separator" | "column_clamp";
export type BeamBottomWidthRule = "bottom_wins" | "side_wins";

export const CONFIRMED_DEFAULTS = {
  /** U-2:柱の締固め方式の標準はセパ方式 */
  columnTieMethod: "separator" as ColumnTieMethod,
  /** U-3:ベニヤ割付原点の既定は左下 */
  plywoodLayoutOrigin: "bottom_left" as LayoutOrigin,
  /** U-4:1単位切り上げ・予備率0%(予備率は明示入力時のみ) */
  rounding: { type: "ceil_unit", unit: 1 } as RoundingRule,
  sparePercent: 0,
  /** U-5:梁底型枠幅の既定は底勝ち(梁底幅 = 梁幅) */
  beamBottomWidthRule: "bottom_wins" as BeamBottomWidthRule,
} as const;

export interface BeamBottomWidthResult {
  width: number;
  formula: string;
}

/**
 * 梁底型枠幅の算出(U-5)。
 * side_wins の場合は側枠のベニヤ厚と桟木せいが必要。未指定なら例外にせず
 * 呼び出し側で不足情報(MissingInput)として扱えるよう null を返す。
 */
export function beamBottomWidth(
  beamWidth: number,
  rule: BeamBottomWidthRule,
  sideBuildUp?: { plywoodThickness: number; battenDepth: number },
): BeamBottomWidthResult | null {
  if (rule === "bottom_wins") {
    return { width: beamWidth, formula: `底勝ち: 梁底幅 = 梁幅 ${beamWidth}` };
  }
  if (!sideBuildUp) return null;
  const deduct = (sideBuildUp.plywoodThickness + sideBuildUp.battenDepth) * 2;
  return {
    width: beamWidth - deduct,
    formula:
      `側勝ち: 梁底幅 = 梁幅 ${beamWidth} − (ベニヤ厚 ${sideBuildUp.plywoodThickness} + ` +
      `桟木せい ${sideBuildUp.battenDepth}) × 2 = ${beamWidth - deduct}`,
  };
}
