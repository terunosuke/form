import type { PconSpec, SeparatorSpec } from "./masters.js";
import type { UniformPitch } from "./pitch.js";
import { computeUniform } from "./pitch.js";
import { applyRounding } from "./rounding.js";
import type { MissingInput, RoundedValue } from "./types.js";
import { EPS, fix } from "./types.js";

// セパレーター配置(設計書 §14)。
// 長さは材料マスタ(lengthRules)または手入力からのみ決定する。
// ルール未登録かつ手入力なしの場合は計算を停止し、不足情報を返す(推測禁止)。

export interface SeparatorBand {
  fromLevel: number;
  toLevel: number;
  horizontalPitch: UniformPitch; // この帯の水平ピッチ
  verticalPitch: number; // この帯の鉛直ピッチ
}

export interface SeparatorConfig {
  spec: SeparatorSpec;
  pcon: PconSpec;
  finishCondition: string;
  wallThickness: number;
  formworkType: "single" | "double";
  /** 片面型枠でもセパを配置する場合 true(既定 false = 本数 0 + 警告) */
  placeOnSingleSided?: boolean;
  bands: SeparatorBand[];
  edgeOffsets: { bottom: number; topClearance: number };
  /** マスタにルールがない場合の手入力長さ */
  manualLength?: number;
}

export interface SeparatorGridPoint {
  u: number;
  v: number;
}

export interface SeparatorLayoutResult {
  points: SeparatorGridPoint[];
  count: RoundedValue; // 配置本数
  /** 決定したセパ長さ。未確定(blockers あり)の場合 null */
  length: number | null;
  lengthSource: "master_rule" | "manual" | null;
  lengthType: "standard" | "custom" | null; // 規格品か特注か
  lengthFormula: string;
  countByLength: Record<number, number>; // 長さ別本数
  blockers: MissingInput[]; // 不足情報(あれば数量は未確定)
  warnings: string[];
  formula: string;
  errors: string[];
}

export function layoutSeparators(input: {
  faceWidth: number;
  faceHeight: number;
  config: SeparatorConfig;
}): SeparatorLayoutResult {
  const { faceWidth: W, faceHeight: H, config } = input;
  const errors: string[] = [];
  const warnings: string[] = [];
  const blockers: MissingInput[] = [];

  const emptyResult = (formula: string): SeparatorLayoutResult => ({
    points: [],
    count: applyRounding(config.spec.rounding, 0),
    length: null,
    lengthSource: null,
    lengthType: null,
    lengthFormula: "",
    countByLength: {},
    blockers,
    warnings,
    formula,
    errors,
  });

  if (config.formworkType === "single" && !config.placeOnSingleSided) {
    warnings.push(
      "片面型枠のためセパレーターは配置しません(アンカー等は別途)。" +
      "配置する場合は placeOnSingleSided を有効にしてください",
    );
    return emptyResult("片面型枠: セパ本数 0");
  }

  // ---- 長さの決定(推測禁止) ----
  let length: number | null = null;
  let lengthSource: SeparatorLayoutResult["lengthSource"] = null;
  let lengthFormula = "";
  if (config.manualLength !== undefined) {
    length = config.manualLength;
    lengthSource = "manual";
    lengthFormula = `手入力長さ ${length}`;
  } else {
    const rule = config.spec.lengthRules.find(
      (r) =>
        r.pconSpecId === config.pcon.id &&
        r.finishCondition === config.finishCondition &&
        (!r.validThicknessRange ||
          (config.wallThickness >= r.validThicknessRange[0] - EPS &&
            config.wallThickness <= r.validThicknessRange[1] + EPS)),
    );
    if (!rule) {
      blockers.push({
        code: "SEPARATOR_LENGTH_UNDEFINED",
        message:
          `セパレーター長さの計算ルールが材料マスタに未登録です` +
          `(セパ: ${config.spec.name}, Pコン: ${config.pcon.name}, 仕上げ: ${config.finishCondition}, ` +
          `壁厚: ${config.wallThickness})。長さを直接入力してください`,
      });
      return emptyResult("セパ長さ未確定のため計算を停止");
    }
    length = fix(
      config.wallThickness + rule.formula.addend + config.pcon.separatorLengthAdjust * 2,
    );
    lengthSource = "master_rule";
    lengthFormula =
      `長さ = 壁厚 ${config.wallThickness} + 加算 ${rule.formula.addend} + ` +
      `Pコン調整 ${config.pcon.separatorLengthAdjust} × 2 = ${length}`;
  }

  // 規格品か特注か
  let lengthType: "standard" | "custom";
  let finalLength = length;
  if (config.spec.stockLengths.some((s) => Math.abs(s - length!) < EPS)) {
    lengthType = "standard";
  } else {
    lengthType = "custom";
    const unit = config.spec.customLengthRounding;
    if (unit > 0) {
      finalLength = Math.ceil(length / unit - EPS) * unit;
      lengthFormula += ` → 規格外のため特注長 ${finalLength}(${unit} 単位切り上げ)`;
    }
  }

  // ---- 格子生成(帯ごとに鉛直・水平ピッチ) ----
  const points: SeparatorGridPoint[] = [];
  const bandFormulas: string[] = [];
  const topLimit = H - config.edgeOffsets.topClearance;
  let lastRowV = -Infinity;
  const bands = [...config.bands].sort((a, b) => a.fromLevel - b.fromLevel);
  for (let bi = 0; bi < bands.length; bi++) {
    const band = bands[bi]!;
    if (band.verticalPitch <= 0) {
      errors.push(`帯 ${bi + 1} の鉛直ピッチが不正です(${band.verticalPitch})`);
      continue;
    }
    const rowStart = Math.max(band.fromLevel, config.edgeOffsets.bottom);
    const rowEnd = Math.min(band.toLevel, topLimit);
    const rows: number[] = [];
    for (let v = rowStart; v <= rowEnd + EPS; v = fix(v + band.verticalPitch)) {
      if (Math.abs(v - lastRowV) < EPS) continue; // 帯境界の重複行を除去
      rows.push(fix(v));
    }
    if (rows.length > 0) lastRowV = rows[rows.length - 1]!;
    let colsCount = 0;
    for (const v of rows) {
      const cols = computeUniform(W, band.horizontalPitch);
      errors.push(...cols.errors);
      colsCount = cols.positions.length;
      for (const u of cols.positions) points.push({ u, v });
    }
    bandFormulas.push(
      `帯[${band.fromLevel}〜${band.toLevel}]: 鉛直 ${band.verticalPitch} で ${rows.length} 段 × ` +
      `水平 ${band.horizontalPitch.pitch} で ${colsCount} 列`,
    );
  }

  const count = applyRounding(config.spec.rounding, points.length);
  return {
    points,
    count,
    length: finalLength,
    lengthSource,
    lengthType,
    lengthFormula,
    countByLength: finalLength !== null ? { [finalLength]: points.length } : {},
    blockers,
    warnings,
    formula:
      `${config.spec.name}(${config.spec.diameter}): ${bandFormulas.join(" / ")} → ` +
      `合計 ${points.length} 本、${lengthFormula}`,
    errors,
  };
}
