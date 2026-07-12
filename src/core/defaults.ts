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
 * 底勝ち(標準): 側面のベニヤ・桟木が梁底に乗るよう、梁底を側枠構成分だけ広げる
 *   (梁底幅 = 梁幅 + (ベニヤ厚 + 桟木せい) × 2)。
 * 側勝ち: 梁底が側枠の内側に納まるよう、梁底を側枠構成分だけ狭める。
 * sideBuildUp が未指定のときは構成 0(梁幅そのまま)として扱う。
 */
export function beamBottomWidth(
  beamWidth: number,
  rule: BeamBottomWidthRule,
  sideBuildUp?: { plywoodThickness: number; battenDepth: number },
): BeamBottomWidthResult {
  const bu = sideBuildUp ? sideBuildUp.plywoodThickness + sideBuildUp.battenDepth : 0;
  if (rule === "bottom_wins") {
    const width = beamWidth + bu * 2;
    return {
      width,
      formula:
        `底勝ち: 梁底幅 = 梁幅 ${beamWidth} + (ベニヤ厚 + 桟木せい ${bu}) × 2 = ${width}` +
        `(側面が梁底に乗る)`,
    };
  }
  const width = beamWidth - bu * 2;
  return {
    width,
    formula:
      `側勝ち: 梁底幅 = 梁幅 ${beamWidth} − (ベニヤ厚 + 桟木せい ${bu}) × 2 = ${width}`,
  };
}

/** 側枠構成(ベニヤ厚 + 桟木せい)。底面が側面を受ける寸法拡張に使う */
export function sideBuildUpMm(plywoodThickness: number, battenDepth: number): number {
  return plywoodThickness + battenDepth;
}
