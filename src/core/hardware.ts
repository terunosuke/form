import type { FormTieSpec, PconSpec, SeparatorSpec } from "./masters.js";
import { applyRounding } from "./rounding.js";
import type { RoundedValue } from "./types.js";

// フォームタイ・Pコン数量計算(設計書 §15)。
// セパレーター配置本数から算出する。対応外の組合せは自動代替せずエラーとする。

export interface FormTieResult {
  count: RoundedValue;
  formula: string;
  errors: string[];
}

export function calcFormTies(input: {
  separatorCount: number;
  formworkType: "single" | "double";
  spec: FormTieSpec;
  separatorSpec: SeparatorSpec;
  pipeShape: "square" | "round";
}): FormTieResult {
  const errors: string[] = [];
  const { spec, separatorSpec } = input;
  if (!spec.compatibleSeparators.includes(separatorSpec.id)) {
    errors.push(
      `フォームタイ ${spec.name} はセパレーター ${separatorSpec.name} に対応していません。` +
      `対応する組合せを材料マスタで選択してください`,
    );
  }
  if (!spec.compatiblePipeShapes.includes(input.pipeShape)) {
    errors.push(
      `フォームタイ ${spec.name} は${input.pipeShape === "square" ? "角" : "丸"}パイプに対応していません`,
    );
  }
  if (errors.length > 0) {
    return { count: applyRounding(spec.rounding, 0), formula: "", errors };
  }
  const perSep =
    input.formworkType === "double" ? spec.countPerSideDouble : spec.countPerSideSingle;
  const raw = input.separatorCount * perSep;
  return {
    count: applyRounding(spec.rounding, raw),
    formula:
      `セパ ${input.separatorCount} 本 × ${input.formworkType === "double" ? "両面" : "片面"}使用個数 ` +
      `${perSep} = ${raw} 個`,
    errors,
  };
}

export interface PconResult {
  count: RoundedValue;
  formula: string;
  errors: string[];
}

export function calcPcons(input: {
  separatorCount: number;
  formworkType: "single" | "double";
  spec: PconSpec;
  separatorSpec: SeparatorSpec;
}): PconResult {
  const errors: string[] = [];
  const { spec, separatorSpec } = input;
  if (!spec.compatibleSeparators.includes(separatorSpec.id)) {
    errors.push(
      `Pコン ${spec.name} はセパレーター ${separatorSpec.name} に対応していません。` +
      `対応する組合せを材料マスタで選択してください`,
    );
  }
  if (errors.length > 0) {
    return { count: applyRounding(spec.rounding, 0), formula: "", errors };
  }
  const ends = input.formworkType === "double" ? 2 : 1;
  const raw = input.separatorCount * spec.countPerEnd * ends;
  return {
    count: applyRounding(spec.rounding, raw),
    formula:
      `セパ ${input.separatorCount} 本 × 片側 ${spec.countPerEnd} 個 × ` +
      `${ends} 端部(${input.formworkType === "double" ? "両面" : "片面"}) = ${raw} 個` +
      `(セパ長さへの調整 ${spec.separatorLengthAdjust}/側 はセパ長さ計算で反映済み)`,
    errors,
  };
}
