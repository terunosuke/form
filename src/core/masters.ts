import type { RoundingRule } from "./types.js";

// 材料マスタのデータモデル(設計書 §6)。
// 寸法・係数の既定値は確定事項のみ。根拠のない値は登録しない。

export type SpecId = string;

export interface PlywoodSpec {
  id: SpecId;
  name: string;
  width: number; // 標準 910
  length: number; // 標準 1820
  thickness: number;
  defaultOrientation: "vertical" | "horizontal"; // 標準は縦使い
  jointDirection: "aligned" | "staggered";
  kerf: number; // 切断代
  rounding: RoundingRule;
}

export interface BattenSpec {
  id: SpecId;
  name: string;
  sectionWidth: number;
  sectionDepth: number;
  stockLengths: number[]; // 標準長さ(昇順でなくてよい)
  spliceAllowed: boolean;
  minUseLength: number;
  rounding: RoundingRule;
}

export interface PipeSpec {
  id: SpecId;
  name: string;
  shape: "square" | "round"; // 標準は角パイプ
  width: number;
  height: number;
  wallThickness: number;
  stockLengths: number[];
  pipesPerLevel: number; // 一段当たりの本数(標準 1、二本抱き = 2)
  lineCount: number; // 列数(標準 1)
  spliceAllowed: boolean;
  lapLength: number; // 重ね長さ
  splicePosition: "stagger" | "fixed";
  minUseLength: number;
  rounding: RoundingRule;
}

export interface SeparatorLengthRule {
  pconSpecId: SpecId;
  finishCondition: string; // 打放し / 化粧 / 防水 など
  /** 長さ = 壁厚 + addend(+ Pコンの separatorLengthAdjust × 2) */
  formula: { base: "wall_thickness"; addend: number };
  validThicknessRange?: [number, number];
}

export interface SeparatorSpec {
  id: SpecId;
  name: string;
  diameter: string; // 標準 "W3/8"
  endShape: string;
  stockLengths: number[]; // 標準長さ一覧
  customLengthRounding: number; // 特注長さの丸め単位
  /** 確定事項 U-1:初期は空。未登録条件では計算を停止し手入力を要求する */
  lengthRules: SeparatorLengthRule[];
  rounding: RoundingRule;
}

export interface FormTieSpec {
  id: SpecId;
  name: string;
  compatibleSeparators: SpecId[];
  compatiblePipeShapes: ("square" | "round")[];
  countPerSeparatorEnd: number; // 1端部あたり個数(標準 1)
  countPerSideSingle: number; // 片面型枠時の使用個数
  countPerSideDouble: number; // 両面型枠時の使用個数(標準 = 両端各1 = 2)
  usage: "wall" | "column" | "beam" | "common";
  rounding: RoundingRule;
}

export interface PconSpec {
  id: SpecId;
  name: string;
  compatibleSeparators: SpecId[];
  faceShape: string;
  depth: number;
  threadLength: number;
  countPerEnd: number; // 片側あたり個数(標準 1)
  usage: "exposed" | "finished" | "waterproof" | "other";
  /** セパレーター長さへの加算(+)/控除(−)。片側あたり */
  separatorLengthAdjust: number;
  rounding: RoundingRule;
}
