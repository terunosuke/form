import { EPS, fix } from "./types.js";

// 材料取り(規格長さからの切り出し・継ぎ足し)。桟木・鋼管で共通。
// 端材は転用しない(初期版):切断 1 本につき原材 1 本を消費する。

export interface StockPiece {
  stockLength: number; // 消費する規格長さ
  usedLength: number; // 実際に使用する長さ
  isCut: boolean; // 切断材か(規格長さそのままなら false)
}

export interface StockTakeResult {
  pieces: StockPiece[];
  spliceCount: number; // 継ぎ箇所数
  totalStockLength: number; // 消費原材の総延長
  totalUsedLength: number; // 使用長の総延長(重ね含む)
  formula: string;
  errors: string[];
}

export interface StockTakeOptions {
  stockLengths: number[];
  spliceAllowed: boolean;
  lapLength?: number; // 継ぎ足し時の重ね長さ
  minUseLength?: number;
}

export function takeFromStock(needed: number, opts: StockTakeOptions): StockTakeResult {
  const errors: string[] = [];
  const stocks = [...opts.stockLengths].sort((a, b) => a - b);
  const empty: StockTakeResult = {
    pieces: [],
    spliceCount: 0,
    totalStockLength: 0,
    totalUsedLength: 0,
    formula: "",
    errors,
  };
  if (stocks.length === 0) {
    errors.push("規格長さが登録されていません");
    return empty;
  }
  if (needed <= EPS) {
    errors.push(`必要長が不正です(${needed})`);
    return empty;
  }
  if (opts.minUseLength !== undefined && needed < opts.minUseLength - EPS) {
    errors.push(`必要長 ${needed} が最小使用長さ ${opts.minUseLength} 未満です`);
    return empty;
  }
  const maxStock = stocks[stocks.length - 1]!;

  const pickFor = (len: number): StockPiece | null => {
    const stock = stocks.find((s) => s >= len - EPS);
    if (stock === undefined) return null;
    return { stockLength: stock, usedLength: fix(len), isCut: stock > len + EPS };
  };

  if (needed <= maxStock + EPS) {
    const piece = pickFor(needed)!;
    return finalize([piece], 0, needed, opts);
  }

  if (!opts.spliceAllowed) {
    errors.push(`必要長 ${needed} が最長規格 ${maxStock} を超えますが、継ぎ足し不可の設定です`);
    return empty;
  }

  const lap = opts.lapLength ?? 0;
  const pieces: StockPiece[] = [];
  let remaining = needed;
  while (remaining > maxStock + EPS) {
    pieces.push({ stockLength: maxStock, usedLength: maxStock, isCut: false });
    remaining = fix(remaining - maxStock + lap); // 次材は重ね分だけ長く必要
  }
  if (opts.minUseLength !== undefined && remaining < opts.minUseLength - EPS) {
    errors.push(
      `継ぎ足し後の残り長 ${remaining} が最小使用長さ ${opts.minUseLength} 未満です。` +
      `継ぎ位置の調整または長さの手動指定が必要です`,
    );
    return empty;
  }
  pieces.push(pickFor(remaining)!);
  return finalize(pieces, pieces.length - 1, needed, opts, lap);
}

function finalize(
  pieces: StockPiece[],
  spliceCount: number,
  needed: number,
  opts: StockTakeOptions,
  lap = 0,
): StockTakeResult {
  const totalStockLength = fix(pieces.reduce((s, p) => s + p.stockLength, 0));
  const totalUsedLength = fix(pieces.reduce((s, p) => s + p.usedLength, 0));
  const desc = pieces
    .map((p) => (p.isCut ? `${p.stockLength} を ${p.usedLength} に切断` : `${p.stockLength} 定尺`))
    .join(" + ");
  return {
    pieces,
    spliceCount,
    totalStockLength,
    totalUsedLength,
    formula:
      `必要長 ${needed} → ${desc}` +
      (spliceCount > 0 ? `(継ぎ ${spliceCount} 箇所、重ね ${lap})` : ""),
    errors: [],
  };
}

/** 規格長さ別の消費本数を集計 */
export function countByStockLength(pieces: StockPiece[]): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const p of pieces) counts[p.stockLength] = (counts[p.stockLength] ?? 0) + 1;
  return counts;
}
