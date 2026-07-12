import type { BattenSpec } from "./masters.js";
import type { UniformPitch } from "./pitch.js";
import { computeUniform } from "./pitch.js";
import { applyRounding } from "./rounding.js";
import type { StockPiece } from "./stock.js";
import { countByStockLength, takeFromStock } from "./stock.js";
import type { RoundedValue } from "./types.js";
import { fix } from "./types.js";

// 桟木配置(設計書 §12)。初期版は縦桟木(鉛直材)のみ。
// 基本配置・端部補強・ベニヤ継ぎ目補強・隅部補強を分けて数える。

export type BattenRole = "base" | "edge" | "panel_joint" | "corner";

export interface BattenPlacement {
  positionU: number;
  role: BattenRole;
  /** 高さ範囲分割時は複数ピース(下から順) */
  segments: { lengthNeeded: number; pieces: StockPiece[] }[];
}

export interface BattenConfig {
  spec: BattenSpec;
  pitch: UniformPitch; // 水平配置ピッチ
  placeAtEnds: boolean; // 型枠端部への配置有無
  extraAtPanelJoints: boolean; // ベニヤ継ぎ目への追加配置
  /** 継ぎ目 1 箇所あたりの追加本数(U-11 未確定。既定 1、計算書に注記) */
  jointCountPerJoint?: number;
  extraAtCorners: boolean; // 出隅・入隅への追加配置
  /** 隅位置(面U座標)。呼び出し側(型枠面生成)が指定する */
  cornerPositionsU?: number[];
  /** 隅 1 箇所あたりの追加本数(U-12 未確定。既定 1、計算書に注記) */
  cornerCountPerCorner?: number;
  /** 高さ範囲別ピッチ用の分割(設計書 §19)。connected=連続材 / separate=別材 */
  heightBand?: { boundaryLevel: number; continuity: "continuous" | "separate" };
}

export interface BattenLayoutResult {
  placements: BattenPlacement[];
  countBase: number;
  countEdge: number; // 端部補強分
  countPanelJoint: number; // ベニヤ継ぎ目補強分
  countCorner: number;
  countTotal: RoundedValue; // 配置本数
  totalUsedLength: number; // 使用総延長
  piecesByStockLength: Record<number, number>; // 規格長さ別の必要本数
  cutPieces: { positionU: number; stockLength: number; usedLength: number }[]; // 切断材一覧
  formula: string;
  notes: string[]; // 未確定既定値などの注記
  errors: string[];
}

export interface BattenLayoutInput {
  faceWidth: number;
  faceHeight: number;
  /** ベニヤ割付結果から得た縦目地のU座標 */
  panelJointUs?: number[];
  config: BattenConfig;
}

const POSITION_TOL = 1; // 既存位置との重複判定 1mm

export function layoutBattens(input: BattenLayoutInput): BattenLayoutResult {
  const { faceWidth: W, faceHeight: H, config } = input;
  const notes: string[] = [];
  const errors: string[] = [];

  const base = computeUniform(W, config.pitch);
  errors.push(...base.errors);

  // 位置 → 役割。基本配置を先に置き、重複しない追加のみ受け入れる。
  const placed: { u: number; role: BattenRole }[] = base.positions.map((u) => ({
    u,
    role: "base" as BattenRole,
  }));
  const exists = (u: number) => placed.some((p) => Math.abs(p.u - u) <= POSITION_TOL);

  if (config.placeAtEnds) {
    for (const u of [0, W]) {
      if (!exists(u)) placed.push({ u, role: "edge" });
    }
  }
  if (config.extraAtPanelJoints) {
    const per = config.jointCountPerJoint ?? 1;
    if (config.jointCountPerJoint === undefined) {
      notes.push("ベニヤ継ぎ目補強の本数/箇所は未確定(U-11)のため既定 1 本/箇所で計算");
    }
    for (const ju of input.panelJointUs ?? []) {
      if (ju <= POSITION_TOL || ju >= W - POSITION_TOL) continue; // 面端の目地は端部扱い
      if (exists(ju)) continue; // 既存位置と重複 → 追加しない
      for (let k = 0; k < per; k++) placed.push({ u: fix(ju), role: "panel_joint" });
    }
  }
  if (config.extraAtCorners) {
    const per = config.cornerCountPerCorner ?? 1;
    if (config.cornerCountPerCorner === undefined) {
      notes.push("出隅・入隅補強の本数/箇所は未確定(U-12)のため既定 1 本/箇所で計算");
    }
    for (const cu of config.cornerPositionsU ?? []) {
      if (exists(cu)) continue;
      for (let k = 0; k < per; k++) placed.push({ u: fix(cu), role: "corner" });
    }
  }
  placed.sort((a, b) => a.u - b.u);

  // 長さ決定と材料取り
  const band = config.heightBand;
  const neededLengths: number[] =
    band && band.continuity === "separate"
      ? [band.boundaryLevel, fix(H - band.boundaryLevel)]
      : [H];
  if (band && band.continuity === "continuous") {
    notes.push(`高さ範囲境界 ${band.boundaryLevel} は連続材のため 1 本 ${H} として材料取り`);
  }

  const placements: BattenPlacement[] = [];
  const allPieces: StockPiece[] = [];
  const cutPieces: BattenLayoutResult["cutPieces"] = [];
  for (const p of placed) {
    const segments = neededLengths.map((len) => {
      const take = takeFromStock(len, {
        stockLengths: config.spec.stockLengths,
        spliceAllowed: config.spec.spliceAllowed,
        minUseLength: config.spec.minUseLength,
      });
      errors.push(...take.errors);
      allPieces.push(...take.pieces);
      for (const piece of take.pieces) {
        if (piece.isCut) {
          cutPieces.push({ positionU: p.u, stockLength: piece.stockLength, usedLength: piece.usedLength });
        }
      }
      return { lengthNeeded: len, pieces: take.pieces };
    });
    placements.push({ positionU: p.u, role: p.role, segments });
  }

  const countBase = placed.filter((p) => p.role === "base").length;
  const countEdge = placed.filter((p) => p.role === "edge").length;
  const countPanelJoint = placed.filter((p) => p.role === "panel_joint").length;
  const countCorner = placed.filter((p) => p.role === "corner").length;
  const totalUsedLength = fix(allPieces.reduce((s, p) => s + p.usedLength, 0));

  return {
    placements,
    countBase,
    countEdge,
    countPanelJoint,
    countCorner,
    countTotal: applyRounding(config.spec.rounding, placed.length),
    totalUsedLength,
    piecesByStockLength: countByStockLength(allPieces),
    cutPieces,
    formula:
      `縦桟木: ${base.formula} / 基本 ${countBase} 本 + 端部 ${countEdge} 本 + ` +
      `継ぎ目 ${countPanelJoint} 本 + 隅部 ${countCorner} 本 = ${placed.length} 本、` +
      `使用総延長 ${totalUsedLength}`,
    notes,
    errors,
  };
}
