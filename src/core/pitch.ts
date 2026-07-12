import { EPS, fix } from "./types.js";

// 配置ピッチ計算(設計書 §7・§19)。
// 桟木・鋼管・セパレーターで共通利用する。ピッチの自動設計は行わず、
// 指定された条件から位置列を機械的に生成するのみ。

export type SpacingMode = "fixed_pitch" | "equal_divide";

export interface UniformPitch {
  type: "uniform";
  pitch: number;
  mode: SpacingMode;
  /** 左端(または下端)から最初の部材までの距離 */
  startOffset: number;
  /** 右端(または上端)から最後の部材までの距離 */
  endOffset: number;
}

export interface TwoStagePitch {
  type: "two_stage";
  /** 型枠下端からの境界高さ */
  boundaryLevel: number;
  lower: { pitch: number; mode: SpacingMode };
  upper: { pitch: number; mode: SpacingMode };
  /** 境界位置に部材を配置するか */
  placeAtBoundary: boolean;
  /** 最下段の高さ */
  bottomOffset: number;
  /** 最上段からの離れ */
  topClearance: number;
}

export type PitchRule = UniformPitch | TwoStagePitch;

export interface PitchResult {
  positions: number[];
  /** equal_divide 時の実ピッチ(fixed_pitch 時は指定ピッチ) */
  actualPitch?: number;
  /** fixed_pitch 時の端部余り寸法 */
  remainder?: number;
  /** 計算式の説明(計算書に表示) */
  formula: string;
  errors: string[];
}

export function computeUniform(length: number, cfg: UniformPitch): PitchResult {
  const errors: string[] = [];
  if (cfg.pitch <= 0) errors.push(`ピッチは正の値を指定してください(指定値: ${cfg.pitch})`);
  const start = cfg.startOffset;
  const end = length - cfg.endOffset;
  if (end - start < -EPS) {
    errors.push(
      `配置可能範囲がありません(startOffset ${cfg.startOffset} + endOffset ${cfg.endOffset} > 全長 ${length})`,
    );
  }
  if (errors.length > 0) return { positions: [], formula: "", errors };

  if (end - start <= EPS) {
    return {
      positions: [fix(start)],
      actualPitch: 0,
      remainder: 0,
      formula: `有効長 0 のため ${fix(start)} に 1 本のみ配置`,
      errors,
    };
  }

  if (cfg.mode === "fixed_pitch") {
    const positions: number[] = [];
    for (let i = 0; start + i * cfg.pitch <= end + EPS; i++) {
      positions.push(fix(start + i * cfg.pitch));
    }
    const last = positions[positions.length - 1]!;
    const remainder = fix(end - last);
    return {
      positions,
      actualPitch: cfg.pitch,
      remainder,
      formula:
        `${fix(start)} から指定ピッチ ${cfg.pitch} 固定で ${positions.length} 本配置、` +
        `端部余り ${remainder}`,
      errors,
    };
  }

  // equal_divide: 指定ピッチ以下となるように有効長を均等割り(両端に配置)
  const eff = end - start;
  const n = Math.ceil(eff / cfg.pitch - EPS);
  const actual = eff / n;
  const positions: number[] = [];
  for (let i = 0; i <= n; i++) positions.push(fix(start + actual * i));
  return {
    positions,
    actualPitch: fix(actual),
    remainder: 0,
    formula:
      `有効長 ${fix(eff)} を ${n} 等分(実ピッチ ${fix(actual)} ≤ 指定 ${cfg.pitch})、` +
      `両端含め ${n + 1} 本配置`,
    errors,
  };
}

// 二段階配置の境界の扱い:
//  placeAtBoundary = true  → 境界位置に必ず 1 本配置(下部範囲の末尾として追加)。
//                            上部範囲は境界を起点とし、境界位置の重複は除去する。
//  placeAtBoundary = false → 境界位置には配置しない。下部範囲は境界未満まで、
//                            上部範囲(fixed)は境界 + 上部ピッチ から開始する。
export function computeTwoStage(length: number, cfg: TwoStagePitch): PitchResult {
  const errors: string[] = [];
  const top = length - cfg.topClearance;
  if (cfg.boundaryLevel <= cfg.bottomOffset + EPS || cfg.boundaryLevel >= top - EPS) {
    errors.push(
      `境界高さ ${cfg.boundaryLevel} が配置範囲(${cfg.bottomOffset}〜${fix(top)})の内側にありません`,
    );
  }
  if (cfg.lower.pitch <= 0 || cfg.upper.pitch <= 0) {
    errors.push("下部・上部のピッチは正の値を指定してください");
  }
  if (errors.length > 0) return { positions: [], formula: "", errors };

  const lower = computeUniform(cfg.boundaryLevel, {
    type: "uniform",
    pitch: cfg.lower.pitch,
    mode: cfg.lower.mode,
    startOffset: cfg.bottomOffset,
    endOffset: 0,
  });
  let lowerPositions = lower.positions;
  if (!cfg.placeAtBoundary) {
    lowerPositions = lowerPositions.filter((p) => p < cfg.boundaryLevel - EPS);
  } else if (
    lowerPositions.length === 0 ||
    Math.abs(lowerPositions[lowerPositions.length - 1]! - cfg.boundaryLevel) > EPS
  ) {
    lowerPositions = [...lowerPositions, fix(cfg.boundaryLevel)];
  }

  const upperStart = cfg.placeAtBoundary
    ? cfg.boundaryLevel
    : cfg.upper.mode === "fixed_pitch"
      ? cfg.boundaryLevel + cfg.upper.pitch
      : cfg.boundaryLevel;
  const upper = computeUniform(length, {
    type: "uniform",
    pitch: cfg.upper.pitch,
    mode: cfg.upper.mode,
    startOffset: upperStart,
    endOffset: cfg.topClearance,
  });
  // 境界位置の重複除去(placeAtBoundary=false の equal_divide も境界起点を落とす)
  const upperPositions = upper.positions.filter((p) =>
    cfg.placeAtBoundary
      ? Math.abs(p - cfg.boundaryLevel) > EPS
      : p > cfg.boundaryLevel + EPS,
  );

  const positions = [...lowerPositions, ...upperPositions];
  return {
    positions,
    formula:
      `二段階配置: 下部[${cfg.bottomOffset}〜${cfg.boundaryLevel}] ${lower.formula} / ` +
      `上部[${cfg.boundaryLevel}〜${fix(top)}] ${upper.formula} / ` +
      `境界配置${cfg.placeAtBoundary ? "あり" : "なし"}、合計 ${positions.length} 本`,
    errors: [...lower.errors, ...upper.errors],
  };
}

export function computePitch(length: number, rule: PitchRule): PitchResult {
  return rule.type === "uniform" ? computeUniform(length, rule) : computeTwoStage(length, rule);
}
