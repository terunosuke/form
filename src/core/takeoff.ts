import type { BattenConfig, BattenLayoutResult } from "./batten.js";
import { layoutBattens } from "./batten.js";
import type { FormTieResult, PconResult } from "./hardware.js";
import { calcFormTies, calcPcons } from "./hardware.js";
import type { FormTieSpec, PconSpec, PipeSpec, PlywoodSpec, SeparatorSpec } from "./masters.js";
import type { BeamBottomWidthRule, LayoutOrigin } from "./defaults.js";
import { beamBottomWidth, CONFIRMED_DEFAULTS } from "./defaults.js";
import type { PipeLayoutResult } from "./pipe.js";
import { layoutPipes } from "./pipe.js";
import type { PitchRule } from "./pitch.js";
import type { PlywoodLayoutResult } from "./plywood.js";
import { layoutPlywood } from "./plywood.js";
import type { SeparatorBand, SeparatorLayoutResult, SeparatorLengthMode } from "./separator.js";
import { layoutSeparators } from "./separator.js";
import type { MissingInput, Rect } from "./types.js";
import { EPS } from "./types.js";

// 部材単位の拾い出し(設計書 §20:型枠面を生成し、面に材料を割り付ける)。
// 本モジュールは構造安全性を判定しない。結果には必ず注意書きを含める。

export const DISCLAIMER =
  "本アプリは入力された配置条件に基づいて型枠材料の数量を算出するものであり、" +
  "型枠の構造安全性を判定するものではありません。" +
  "各材料の規格および配置ピッチは、施工計画および構造検討に基づいて入力してください。";

export type TakeoffFaceType =
  | "wall_side_A"
  | "wall_side_B"
  | "column_side_1"
  | "column_side_2"
  | "column_side_3"
  | "column_side_4"
  | "beam_side_left"
  | "beam_side_right"
  | "beam_bottom"
  | "beam_end_start"
  | "beam_end_end"
  | "slab_bottom"
  | "slab_edge_1"
  | "slab_edge_2"
  | "slab_edge_3"
  | "slab_edge_4"
  | "footing_side_1"
  | "footing_side_2"
  | "footing_side_3"
  | "footing_side_4"
  | "footing_bottom";

export type MemberKind = "wall" | "column" | "beam" | "slab" | "footing";

/** 脱型区分(設計書 §10)。梁底は梁側と別区分で最後まで残置可能 */
export type StrippingGroup =
  | "column"
  | "wall"
  | "beam_side"
  | "beam_bottom"
  | "slab_edge"
  | "slab_bottom"
  | "footing";

/** 材料条件一式(材料設定画面 §12 で入力される内容) */
export interface MaterialConfig {
  plywood: {
    spec: PlywoodSpec;
    orientation?: "vertical" | "horizontal";
    layoutOrigin?: LayoutOrigin;
  };
  batten: Omit<BattenConfig, "cornerPositionsU">;
  pipe: { spec: PipeSpec; verticalPitch: PitchRule };
  separator: {
    spec: SeparatorSpec;
    pcon: PconSpec;
    finishCondition?: string;
    lengthMode?: SeparatorLengthMode;
    manualLength?: number;
    bands: SeparatorBand[];
    edgeOffsets: { bottom: number; topClearance: number };
  };
  formTie: { spec: FormTieSpec };
}

/** 1 つの型枠面と、その面への材料割付結果 */
export interface FaceTakeoff {
  faceId: string;
  memberId: string;
  faceType: TakeoffFaceType;
  strippingGroup: StrippingGroup;
  /** 支保工と関連する材料か(スラブ底・梁底) */
  supportRelated: boolean;
  width: number;
  height: number;
  area: number;
  netArea: number;
  deductions: Rect[];
  plywood: PlywoodLayoutResult;
  batten: BattenLayoutResult;
  pipe: PipeLayoutResult;
  errors: string[];
  notes: string[];
}

/** 対向面ペア単位の締結材(セパ・フォームタイ・Pコン) */
export interface PairTakeoff {
  pairId: string;
  faceIdA: string;
  faceIdB: string | null; // 片面型枠時は null
  formGap: number;
  separator: SeparatorLayoutResult;
  formTie: FormTieResult;
  pcon: PconResult;
}

export interface MemberTakeoffResult {
  memberId: string;
  memberKind: MemberKind;
  faces: FaceTakeoff[];
  pairs: PairTakeoff[];
  blockers: MissingInput[];
  warnings: string[];
  errors: string[];
  disclaimer: typeof DISCLAIMER;
  summary: {
    plywoodFull: number;
    plywoodCut: number;
    plywoodTotal: number;
    battenCount: number;
    battenTotalLength: number;
    pipeCount: number;
    pipeTotalLength: number;
    separatorCount: number;
    formTieCount: number;
    pconCount: number;
  };
}

/** ベニヤ割付結果から縦目地(面内部のパネル境界)のU座標を求める */
export function panelJointUs(plywood: PlywoodLayoutResult, faceWidth: number): number[] {
  const joints = new Set<number>();
  for (const p of plywood.placements) {
    for (const u of [p.positionUV.u, p.positionUV.u + p.cutWidth]) {
      if (u > EPS && u < faceWidth - EPS) joints.add(Math.round(u * 100) / 100);
    }
  }
  return [...joints].sort((a, b) => a - b);
}

function takeoffFace(input: {
  faceId: string;
  memberId: string;
  faceType: TakeoffFaceType;
  strippingGroup: StrippingGroup;
  supportRelated?: boolean;
  width: number;
  height: number;
  deductions: Rect[];
  config: MaterialConfig;
}): FaceTakeoff {
  const { width, height, deductions, config } = input;
  const plywood = layoutPlywood({
    faceWidth: width,
    faceHeight: height,
    deductions,
    spec: config.plywood.spec,
    orientation: config.plywood.orientation,
    layoutOrigin: config.plywood.layoutOrigin,
    memberId: input.memberId,
    faceId: input.faceId,
  });
  const batten = layoutBattens({
    faceWidth: width,
    faceHeight: height,
    panelJointUs: panelJointUs(plywood, width),
    config: { ...config.batten },
  });
  const pipe = layoutPipes({
    faceWidth: width,
    faceHeight: height,
    spec: config.pipe.spec,
    verticalPitch: config.pipe.verticalPitch,
  });
  const dedArea = deductions.reduce((s, d) => s + d.w * d.h, 0);
  return {
    faceId: input.faceId,
    memberId: input.memberId,
    faceType: input.faceType,
    strippingGroup: input.strippingGroup,
    supportRelated: input.supportRelated ?? false,
    width,
    height,
    area: width * height,
    netArea: width * height - dedArea,
    deductions,
    plywood,
    batten,
    pipe,
    errors: [...plywood.errors, ...batten.errors, ...pipe.errors],
    notes: batten.notes,
  };
}

function takeoffPair(input: {
  pairId: string;
  faceIdA: string;
  faceIdB: string | null;
  width: number;
  height: number;
  formGap: number;
  formworkType: "single" | "double";
  config: MaterialConfig;
}): PairTakeoff {
  const sep = layoutSeparators({
    faceWidth: input.width,
    faceHeight: input.height,
    config: {
      spec: input.config.separator.spec,
      pcon: input.config.separator.pcon,
      finishCondition: input.config.separator.finishCondition,
      lengthMode: input.config.separator.lengthMode,
      manualLength: input.config.separator.manualLength,
      formGap: input.formGap,
      formworkType: input.formworkType,
      bands: input.config.separator.bands,
      edgeOffsets: input.config.separator.edgeOffsets,
    },
  });
  const formTie = calcFormTies({
    separatorCount: sep.count.rounded,
    formworkType: input.formworkType,
    spec: input.config.formTie.spec,
    separatorSpec: input.config.separator.spec,
    pipeShape: input.config.pipe.spec.shape,
  });
  const pcon = calcPcons({
    separatorCount: sep.count.rounded,
    formworkType: input.formworkType,
    spec: input.config.separator.pcon,
    separatorSpec: input.config.separator.spec,
  });
  return {
    pairId: input.pairId,
    faceIdA: input.faceIdA,
    faceIdB: input.faceIdB,
    formGap: input.formGap,
    separator: sep,
    formTie,
    pcon,
  };
}

function summarize(
  memberId: string,
  memberKind: MemberKind,
  faces: FaceTakeoff[],
  pairs: PairTakeoff[],
  extraBlockers: MissingInput[] = [],
): MemberTakeoffResult {
  const blockers = [...extraBlockers, ...pairs.flatMap((p) => p.separator.blockers)];
  const warnings = pairs.flatMap((p) => p.separator.warnings);
  const errors = [
    ...faces.flatMap((f) => f.errors),
    ...pairs.flatMap((p) => [...p.separator.errors, ...p.formTie.errors, ...p.pcon.errors]),
  ];
  return {
    memberId,
    memberKind,
    faces,
    pairs,
    blockers,
    warnings,
    errors,
    disclaimer: DISCLAIMER,
    summary: {
      plywoodFull: faces.reduce((s, f) => s + f.plywood.fullCount, 0),
      plywoodCut: faces.reduce((s, f) => s + f.plywood.cutCount, 0),
      plywoodTotal: faces.reduce((s, f) => s + f.plywood.totalCount.rounded, 0),
      battenCount: faces.reduce((s, f) => s + f.batten.countTotal.rounded, 0),
      battenTotalLength: faces.reduce((s, f) => s + f.batten.totalUsedLength, 0),
      pipeCount: faces.reduce((s, f) => s + f.pipe.totalPieces.rounded, 0),
      pipeTotalLength: faces.reduce((s, f) => s + f.pipe.totalUsedLength, 0),
      separatorCount: pairs.reduce((s, p) => s + p.separator.count.rounded, 0),
      formTieCount: pairs.reduce((s, p) => s + p.formTie.count.rounded, 0),
      pconCount: pairs.reduce((s, p) => s + p.pcon.count.rounded, 0),
    },
  };
}

// ---- 壁(§9 壁・擁壁) ----

export interface WallTakeoffInput {
  memberId: string;
  length: number; // 壁長さ
  height: number; // 型枠高さ(型枠開始〜終了)
  thickness: number; // 壁厚 = 型枠同士の間隔
  formworkSides: "both" | "sideA" | "sideB";
  deductionsA?: Rect[]; // A面の控除領域(勝ち負け・重複控除)
  deductionsB?: Rect[];
}

export function takeoffWall(input: WallTakeoffInput, config: MaterialConfig): MemberTakeoffResult {
  const faces: FaceTakeoff[] = [];
  const sides: ("A" | "B")[] =
    input.formworkSides === "both" ? ["A", "B"] : [input.formworkSides === "sideA" ? "A" : "B"];
  for (const side of sides) {
    faces.push(
      takeoffFace({
        faceId: `${input.memberId}-${side}`,
        memberId: input.memberId,
        faceType: side === "A" ? "wall_side_A" : "wall_side_B",
        strippingGroup: "wall",
        width: input.length,
        height: input.height,
        deductions: (side === "A" ? input.deductionsA : input.deductionsB) ?? [],
        config,
      }),
    );
  }
  const formworkType = input.formworkSides === "both" ? "double" : "single";
  // セパは対向面ペアにつき 1 系統(両面でも二重計上しない)
  const pairs = [
    takeoffPair({
      pairId: `${input.memberId}-pair`,
      faceIdA: `${input.memberId}-${sides[0]}`,
      faceIdB: formworkType === "double" ? `${input.memberId}-B` : null,
      width: input.length,
      height: input.height,
      formGap: input.thickness,
      formworkType,
      config,
    }),
  ];
  return summarize(input.memberId, "wall", faces, pairs);
}

// ---- 柱(§9 柱。四角形柱、面 1〜4 = 幅面・奥行き面の 2 ペア) ----

export interface ColumnTakeoffInput {
  memberId: string;
  width: number; // 柱幅(面1・面3 の幅)
  depth: number; // 柱奥行き(面2・面4 の幅)
  height: number;
  /** 面 1〜4 の型枠有無(既定すべて true) */
  faceFlags?: [boolean, boolean, boolean, boolean];
  /** 締固め方式(確定 U-2: 既定はセパ方式) */
  tieMethod?: "separator" | "column_clamp";
}

export function takeoffColumn(
  input: ColumnTakeoffInput,
  config: MaterialConfig,
): MemberTakeoffResult {
  const flags = input.faceFlags ?? [true, true, true, true];
  const faceWidths = [input.width, input.depth, input.width, input.depth];
  const faces: FaceTakeoff[] = [];
  for (let i = 0; i < 4; i++) {
    if (!flags[i]) continue;
    faces.push(
      takeoffFace({
        faceId: `${input.memberId}-F${i + 1}`,
        memberId: input.memberId,
        faceType: `column_side_${i + 1}` as TakeoffFaceType,
        strippingGroup: "column",
        width: faceWidths[i]!,
        height: input.height,
        deductions: [],
        config,
      }),
    );
  }
  const pairs: PairTakeoff[] = [];
  const tieMethod = input.tieMethod ?? "separator";
  if (tieMethod === "separator") {
    // 面1-面3(幅面ペア、間隔 = 奥行き)、面2-面4(奥行き面ペア、間隔 = 幅)
    const pairDefs = [
      { a: 0, b: 2, gap: input.depth, w: input.width },
      { a: 1, b: 3, gap: input.width, w: input.depth },
    ];
    for (const pd of pairDefs) {
      if (!flags[pd.a] || !flags[pd.b]) continue; // 対向面がそろわなければセパなし
      pairs.push(
        takeoffPair({
          pairId: `${input.memberId}-pair-F${pd.a + 1}F${pd.b + 1}`,
          faceIdA: `${input.memberId}-F${pd.a + 1}`,
          faceIdB: `${input.memberId}-F${pd.b + 1}`,
          width: pd.w,
          height: input.height,
          formGap: pd.gap,
          formworkType: "double",
          config,
        }),
      );
    }
  }
  const result = summarize(input.memberId, "column", faces, pairs);
  if (tieMethod === "column_clamp") {
    result.warnings.push(
      "柱の締固め方式がコラムクランプのため、セパレーター・フォームタイ・Pコンは計上していません" +
      "(クランプ数量は将来対応)",
    );
  }
  return result;
}

// ---- 梁(§9 梁。梁側左右・梁底・梁端部を別管理、梁底は別脱型区分) ----

export interface BeamTakeoffInput {
  memberId: string;
  length: number; // 梁長さ
  width: number; // 梁幅
  depth: number; // 梁せい
  /** 梁側型枠の高さ。省略時は梁せい(スラブとの取り合いで減る場合に指定) */
  sideHeightLeft?: number;
  sideHeightRight?: number;
  sideFormLeft: boolean;
  sideFormRight: boolean;
  bottomForm: boolean;
  endForms?: { start: boolean; end: boolean };
  /** 梁底幅の算出基準(確定 U-5: 既定は底勝ち = 梁幅) */
  bottomWidthRule?: BeamBottomWidthRule;
  /** side_wins 時に必要な側枠の構成寸法 */
  sideBuildUp?: { plywoodThickness: number; battenDepth: number };
  /** 梁側左右がそろう場合にセパを配置するか(既定 true) */
  separatorsOnSides?: boolean;
  deductionsLeft?: Rect[];
  deductionsRight?: Rect[];
  /** 梁底の控除領域(梁長さ方向 U × 梁底幅 V) */
  deductionsBottom?: Rect[];
  /** 梁底のうち控除する梁長さ方向の範囲(壁の上に梁が乗る場合の壁部分など) */
  bottomDeductionsU?: [number, number][];
}

export function takeoffBeam(input: BeamTakeoffInput, config: MaterialConfig): MemberTakeoffResult {
  const faces: FaceTakeoff[] = [];
  const blockers: MissingInput[] = [];
  const hLeft = input.sideHeightLeft ?? input.depth;
  const hRight = input.sideHeightRight ?? input.depth;

  if (input.sideFormLeft) {
    faces.push(
      takeoffFace({
        faceId: `${input.memberId}-SL`,
        memberId: input.memberId,
        faceType: "beam_side_left",
        strippingGroup: "beam_side",
        width: input.length,
        height: hLeft,
        deductions: input.deductionsLeft ?? [],
        config,
      }),
    );
  }
  if (input.sideFormRight) {
    faces.push(
      takeoffFace({
        faceId: `${input.memberId}-SR`,
        memberId: input.memberId,
        faceType: "beam_side_right",
        strippingGroup: "beam_side",
        width: input.length,
        height: hRight,
        deductions: input.deductionsRight ?? [],
        config,
      }),
    );
  }
  if (input.bottomForm) {
    // 梁底は梁側と別オブジェクト・別脱型区分(§10)。幅は U-5 の設定で決定。
    // 側枠構成(ベニヤ厚 + 桟木せい)は材料条件から取得し、側面が梁底に乗るよう拡張する。
    const rule = input.bottomWidthRule ?? CONFIRMED_DEFAULTS.beamBottomWidthRule;
    const buildUp = input.sideBuildUp ?? {
      plywoodThickness: config.plywood.spec.thickness,
      battenDepth: config.batten.spec.sectionDepth,
    };
    const bw = beamBottomWidth(input.width, rule, buildUp);
    // 壁の上に梁が乗る等の控除(梁長さ方向の範囲 → 梁底全幅を控除)
    const rangeDeductions: Rect[] = (input.bottomDeductionsU ?? []).map(([u0, u1]) => ({
      u: u0, v: 0, w: Math.max(0, u1 - u0), h: bw.width,
    }));
    const face = takeoffFace({
      faceId: `${input.memberId}-B`,
      memberId: input.memberId,
      faceType: "beam_bottom",
      strippingGroup: "beam_bottom",
      supportRelated: true,
      width: input.length, // U = 梁長さ方向
      height: bw.width, // V = 梁幅方向(水平面)
      deductions: [...(input.deductionsBottom ?? []), ...rangeDeductions],
      config,
    });
    face.notes.push(bw.formula);
    faces.push(face);
  }
  const ends = input.endForms ?? { start: false, end: false };
  for (const [key, flag] of [["start", ends.start], ["end", ends.end]] as const) {
    if (!flag) continue;
    faces.push(
      takeoffFace({
        faceId: `${input.memberId}-E${key === "start" ? "S" : "E"}`,
        memberId: input.memberId,
        faceType: key === "start" ? "beam_end_start" : "beam_end_end",
        strippingGroup: "beam_side",
        width: input.width,
        height: input.depth,
        deductions: [],
        config,
      }),
    );
  }

  const pairs: PairTakeoff[] = [];
  if (input.sideFormLeft && input.sideFormRight && (input.separatorsOnSides ?? true)) {
    pairs.push(
      takeoffPair({
        pairId: `${input.memberId}-pair-sides`,
        faceIdA: `${input.memberId}-SL`,
        faceIdB: `${input.memberId}-SR`,
        width: input.length,
        height: Math.min(hLeft, hRight),
        formGap: input.width, // 型枠同士の間隔 = 梁幅
        formworkType: "double",
        config,
      }),
    );
  }
  return summarize(input.memberId, "beam", faces, pairs, blockers);
}

// ---- スラブ(§9 スラブ。スラブ底・外周端部。開口は将来対応) ----

export interface SlabTakeoffInput {
  memberId: string;
  lengthX: number;
  lengthY: number;
  thickness: number; // スラブ厚 = 端部型枠の高さ
  bottomForm: boolean;
  /** 外周 4 辺(X-, X+, Y-, Y+ の順)の端部型枠有無。既定すべて false */
  edgeFormFlags?: [boolean, boolean, boolean, boolean];
  /** スラブ底の控除領域(梁との取り合いなど。底面UV = X×Y) */
  deductionsBottom?: Rect[];
}

export function takeoffSlab(input: SlabTakeoffInput, config: MaterialConfig): MemberTakeoffResult {
  const faces: FaceTakeoff[] = [];
  const flags = input.edgeFormFlags ?? [false, false, false, false];
  if (input.bottomForm) {
    // 端部型枠(側面)がスラブ底に乗るよう、端部がある辺の分だけスラブ底を拡張する。
    const bu = config.plywood.spec.thickness + config.batten.spec.sectionDepth;
    const extraX = (flags[0] ? bu : 0) + (flags[1] ? bu : 0); // X- / X+
    const extraY = (flags[2] ? bu : 0) + (flags[3] ? bu : 0); // Y- / Y+
    const bottomW = input.lengthX + extraX;
    const bottomH = input.lengthY + extraY;
    const face = takeoffFace({
      faceId: `${input.memberId}-B`,
      memberId: input.memberId,
      faceType: "slab_bottom",
      strippingGroup: "slab_bottom",
      supportRelated: true,
      width: bottomW, // U = X 方向(端部を受ける拡張含む)
      height: bottomH, // V = Y 方向(水平面)
      deductions: input.deductionsBottom ?? [],
      config,
    });
    if (extraX > 0 || extraY > 0) {
      face.notes.push(
        `スラブ底は端部型枠を受けるため拡張: ${input.lengthX}×${input.lengthY} → ${bottomW}×${bottomH}` +
        `(側枠構成 ${bu}/辺)`,
      );
    }
    faces.push(face);
  }
  const edgeWidths = [input.lengthY, input.lengthY, input.lengthX, input.lengthX];
  for (let i = 0; i < 4; i++) {
    if (!flags[i]) continue;
    faces.push(
      takeoffFace({
        faceId: `${input.memberId}-E${i + 1}`,
        memberId: input.memberId,
        faceType: `slab_edge_${i + 1}` as TakeoffFaceType,
        strippingGroup: "slab_edge",
        width: edgeWidths[i]!,
        height: input.thickness,
        deductions: [],
        config,
      }),
    );
  }
  // スラブにはセパレーターを配置しない
  return summarize(input.memberId, "slab", faces, []);
}

// ---- フーチング(§9 フーチング。各側面の有無選択、底面は既定なし) ----

export interface FootingTakeoffInput {
  memberId: string;
  width: number; // X 方向
  depth: number; // Y 方向
  height: number;
  /** 側面 1〜4(X-, X+, Y-, Y+)の型枠有無。既定すべて true */
  sideFlags?: [boolean, boolean, boolean, boolean];
  /** 底面型枠(既定 false。必要な場合のみ手動で true) */
  bottomForm?: boolean;
}

export function takeoffFooting(
  input: FootingTakeoffInput,
  config: MaterialConfig,
): MemberTakeoffResult {
  const flags = input.sideFlags ?? [true, true, true, true];
  // 側面 1・2 は幅 = depth(X∓ 面)、側面 3・4 は幅 = width(Y∓ 面)
  const faceWidths = [input.depth, input.depth, input.width, input.width];
  const faces: FaceTakeoff[] = [];
  for (let i = 0; i < 4; i++) {
    if (!flags[i]) continue;
    faces.push(
      takeoffFace({
        faceId: `${input.memberId}-F${i + 1}`,
        memberId: input.memberId,
        faceType: `footing_side_${i + 1}` as TakeoffFaceType,
        strippingGroup: "footing",
        width: faceWidths[i]!,
        height: input.height,
        deductions: [],
        config,
      }),
    );
  }
  if (input.bottomForm) {
    faces.push(
      takeoffFace({
        faceId: `${input.memberId}-B`,
        memberId: input.memberId,
        faceType: "footing_bottom",
        strippingGroup: "footing",
        width: input.width,
        height: input.depth,
        deductions: [],
        config,
      }),
    );
  }
  const pairs: PairTakeoff[] = [];
  const pairDefs = [
    { a: 0, b: 1, gap: input.width, w: input.depth }, // X-/X+ 面ペア: 間隔 = 幅
    { a: 2, b: 3, gap: input.depth, w: input.width }, // Y-/Y+ 面ペア: 間隔 = 奥行き
  ];
  for (const pd of pairDefs) {
    if (!flags[pd.a] || !flags[pd.b]) continue;
    pairs.push(
      takeoffPair({
        pairId: `${input.memberId}-pair-F${pd.a + 1}F${pd.b + 1}`,
        faceIdA: `${input.memberId}-F${pd.a + 1}`,
        faceIdB: `${input.memberId}-F${pd.b + 1}`,
        width: pd.w,
        height: input.height,
        formGap: pd.gap,
        formworkType: "double",
        config,
      }),
    );
  }
  return summarize(input.memberId, "footing", faces, pairs);
}
