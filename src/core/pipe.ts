import type { PipeSpec } from "./masters.js";
import type { PitchRule } from "./pitch.js";
import { computePitch } from "./pitch.js";
import { applyRounding } from "./rounding.js";
import type { StockPiece } from "./stock.js";
import { countByStockLength, takeFromStock } from "./stock.js";
import type { RoundedValue } from "./types.js";
import { fix } from "./types.js";

// 鋼管配置(設計書 §13)。標準は角パイプ・水平方向・一段 1 本。
// 二本抱き(pipesPerLevel=2)・複数列(lineCount>1)も同じ構造で計算する。

export interface PipeLevel {
  levelV: number; // 段の高さ位置
  neededLength: number; // この段の必要長さ
  linesPerLevel: number; // 一段あたりの本数 × 列数
  pieces: StockPiece[]; // 1 ライン分の材料取り
  spliceCount: number; // 1 ライン分の継ぎ箇所数
  formula: string;
}

export interface PipeLayoutResult {
  levels: PipeLevel[];
  levelCount: number; // 配置段数
  totalUsedLength: number; // 使用総延長(全ライン合計)
  piecesByStockLength: Record<number, number>; // 規格長さ別の必要本数
  totalPieces: RoundedValue;
  spliceCount: number; // 継ぎ箇所数(全ライン合計)
  cutPieces: { levelV: number; stockLength: number; usedLength: number }[];
  formula: string;
  errors: string[];
}

export interface PipeLayoutInput {
  faceWidth: number;
  faceHeight: number;
  spec: PipeSpec;
  /** 鉛直配置ピッチ(最下段高さ = startOffset / 最上段離れ = endOffset、または二段階) */
  verticalPitch: PitchRule;
}

export function layoutPipes(input: PipeLayoutInput): PipeLayoutResult {
  const { faceWidth: W, faceHeight: H, spec } = input;
  const errors: string[] = [];
  const rows = computePitch(H, input.verticalPitch);
  errors.push(...rows.errors);

  const linesPerLevel = spec.pipesPerLevel * spec.lineCount;
  const levels: PipeLevel[] = [];
  const allPieces: StockPiece[] = [];
  const cutPieces: PipeLayoutResult["cutPieces"] = [];
  let spliceCount = 0;

  for (const v of rows.positions) {
    const take = takeFromStock(W, {
      stockLengths: spec.stockLengths,
      spliceAllowed: spec.spliceAllowed,
      lapLength: spec.lapLength,
      minUseLength: spec.minUseLength,
    });
    errors.push(...take.errors);
    for (let line = 0; line < linesPerLevel; line++) {
      allPieces.push(...take.pieces);
      spliceCount += take.spliceCount;
      for (const piece of take.pieces) {
        if (piece.isCut) {
          cutPieces.push({ levelV: v, stockLength: piece.stockLength, usedLength: piece.usedLength });
        }
      }
    }
    levels.push({
      levelV: v,
      neededLength: W,
      linesPerLevel,
      pieces: take.pieces,
      spliceCount: take.spliceCount,
      formula: take.formula,
    });
  }

  const totalUsedLength = fix(allPieces.reduce((s, p) => s + p.usedLength, 0));
  return {
    levels,
    levelCount: levels.length,
    totalUsedLength,
    piecesByStockLength: countByStockLength(allPieces),
    totalPieces: applyRounding(spec.rounding, allPieces.length),
    spliceCount,
    cutPieces,
    formula:
      `${spec.name}(${spec.shape === "square" ? "角" : "丸"}パイプ、一段 ${spec.pipesPerLevel} 本 × ` +
      `${spec.lineCount} 列): ${rows.formula} → ${levels.length} 段、` +
      `使用総延長 ${totalUsedLength}、継ぎ ${spliceCount} 箇所`,
    errors,
  };
}
