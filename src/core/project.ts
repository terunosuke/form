import { aggregateProject, type ProjectAggregate } from "./aggregate.js";
import type { MaterialConfig, MemberTakeoffResult } from "./takeoff.js";
import {
  takeoffBeam, takeoffColumn, takeoffFooting, takeoffSlab, takeoffWall,
  type BeamTakeoffInput, type ColumnTakeoffInput, type FootingTakeoffInput,
  type SlabTakeoffInput, type WallTakeoffInput,
} from "./takeoff.js";

// プロジェクト保存・再計算(設計書 §26)。
// 形状(部材入力)と材料条件を分離して保持し、材料条件を変更しても
// 形状を維持したまま数量だけを再計算できる。

export const PROJECT_FORMAT_VERSION = 1;

/** 2D平面図上の配置(数量計算には影響しない。作図・表示用) */
export interface PlanPlacement {
  x: number; // mm
  y: number; // mm
  angleDeg: number; // 反時計回り(壁・梁の軸方向)
  /** 3D表示用の底高さ(mm)。梁・スラブの表示位置。省略時 0 */
  z?: number;
}

export type MemberInput =
  | ({ kind: "wall"; placement?: PlanPlacement } & WallTakeoffInput)
  | ({ kind: "column"; placement?: PlanPlacement } & ColumnTakeoffInput)
  | ({ kind: "beam"; placement?: PlanPlacement } & BeamTakeoffInput)
  | ({ kind: "slab"; placement?: PlanPlacement } & SlabTakeoffInput)
  | ({ kind: "footing"; placement?: PlanPlacement } & FootingTakeoffInput);

export interface Project {
  formatVersion: number;
  id: string;
  name: string; // プロジェクト名
  siteName?: string; // 現場名
  workSection?: string; // 工区
  pourSection?: string; // コンクリート打設区分
  unit: "mm"; // 初期版は mm 固定
  materials: MaterialConfig; // 材料マスタ+配置ピッチ(プロジェクトコピー)
  members: MemberInput[]; // 構造部材(形状・寸法・型枠面の指定)
  /** 手動修正内容(将来: 3D画面での個別修正を記録) */
  manualAdjustments: unknown[];
}

export interface ProjectRunResult {
  memberResults: MemberTakeoffResult[];
  aggregate: ProjectAggregate;
}

/** 全部材の拾い出しを実行し、集計を返す。材料条件変更後の再計算もこの関数のみ */
export function runProject(project: Project): ProjectRunResult {
  const memberResults = project.members.map((m) => {
    switch (m.kind) {
      case "wall":
        return takeoffWall(m, project.materials);
      case "column":
        return takeoffColumn(m, project.materials);
      case "beam":
        return takeoffBeam(m, project.materials);
      case "slab":
        return takeoffSlab(m, project.materials);
      case "footing":
        return takeoffFooting(m, project.materials);
    }
  });
  return { memberResults, aggregate: aggregateProject(memberResults) };
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export interface DeserializeResult {
  project: Project | null;
  errors: string[];
}

export function deserializeProject(json: string): DeserializeResult {
  const errors: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { project: null, errors: [`JSONの解析に失敗しました: ${String(e)}`] };
  }
  if (typeof raw !== "object" || raw === null) {
    return { project: null, errors: ["プロジェクトデータが不正です"] };
  }
  const p = raw as Partial<Project>;
  if (p.formatVersion !== PROJECT_FORMAT_VERSION) {
    errors.push(
      `対応していない保存形式バージョンです(ファイル: ${p.formatVersion}, 対応: ${PROJECT_FORMAT_VERSION})`,
    );
  }
  if (typeof p.id !== "string" || typeof p.name !== "string") {
    errors.push("プロジェクトの id / name がありません");
  }
  if (typeof p.materials !== "object" || p.materials === null) {
    errors.push("材料条件(materials)がありません");
  }
  if (!Array.isArray(p.members)) {
    errors.push("構造部材(members)がありません");
  } else {
    const kinds = new Set(["wall", "column", "beam", "slab", "footing"]);
    p.members.forEach((m, i) => {
      if (typeof m !== "object" || m === null || !kinds.has((m as { kind?: string }).kind ?? "")) {
        errors.push(`members[${i}] の部材種類(kind)が不正です`);
      }
    });
  }
  if (errors.length > 0) return { project: null, errors };
  return { project: p as Project, errors: [] };
}
