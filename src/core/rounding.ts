import type { RoundingRule, RoundedValue } from "./types.js";

// 確定事項 U-4:既定は 1 単位切り上げ・予備率 0%。
// 予備率(ceil_percent)は明示入力時のみ使用し、計算式に予備率を明記する。
export const DEFAULT_ROUNDING: RoundingRule = { type: "ceil_unit", unit: 1 };

export function applyRounding(rule: RoundingRule, raw: number): RoundedValue {
  switch (rule.type) {
    case "none":
      return { raw, rounded: raw, rule, formula: `丸めなし: ${raw}` };
    case "ceil_unit": {
      const rounded = Math.ceil(raw / rule.unit - 1e-9) * rule.unit + 0; // -0 を +0 に正規化
      return {
        raw,
        rounded,
        rule,
        formula: `${raw} を ${rule.unit} 単位で切り上げ → ${rounded}`,
      };
    }
    case "ceil_percent": {
      const withSpare = raw * (1 + rule.percent / 100);
      const rounded = Math.ceil(withSpare - 1e-9);
      return {
        raw,
        rounded,
        rule,
        formula: `${raw} × (1 + 予備率 ${rule.percent}%) = ${withSpare} を切り上げ → ${rounded}`,
      };
    }
  }
}
