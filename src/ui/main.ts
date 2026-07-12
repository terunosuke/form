// 型枠材料拾い出し 最小UI(フェーズ2の先行実装)。
// 数量はすべて計算エンジン(src/core)で算出し、UIは入力と表示のみを担当する。

import { aggregateProject, type ProjectAggregate } from "../core/aggregate.js";
import {
  conditionsCsv, faceDetailCsv, materialTotalsCsv, memberRowsCsv, strippingCsv,
} from "../core/export.js";
import { faceLayoutSvg } from "../core/svg.js";
import {
  applyJunctions, detectJunctions, type JunctionPolicy,
} from "../core/junctions.js";
import { initPlan, type PlanApi, type UnderlayView } from "./plan.js";
import { initThreeView, type LayerName, type ThreeViewApi } from "./three-view.js";
import { buildReportHtml } from "./report.js";
import type {
  BattenSpec, FormTieSpec, PconSpec, PipeSpec, PlywoodSpec, SeparatorSpec,
} from "../core/masters.js";
import {
  deserializeProject, PROJECT_FORMAT_VERSION, runProject, serializeProject,
  type MemberInput, type Project,
} from "../core/project.js";
import { DISCLAIMER, type MaterialConfig, type MemberTakeoffResult } from "../core/takeoff.js";

document.getElementById("disclaimer")!.textContent = DISCLAIMER;

// ---------- 材料条件フォーム ----------

interface FieldDef {
  id: string;
  label: string;
  type: "number" | "text" | "select" | "checkbox";
  options?: [string, string][];
  value: string | number | boolean;
}

const materialFields: { group: string; fields: FieldDef[] }[] = [
  {
    group: "ベニヤ",
    fields: [
      { id: "ply-name", label: "名称", type: "text", value: "コンパネ12" },
      { id: "ply-width", label: "幅 (mm)", type: "number", value: 910 },
      { id: "ply-length", label: "長さ (mm)", type: "number", value: 1820 },
      { id: "ply-thickness", label: "厚さ (mm)", type: "number", value: 12 },
      {
        id: "ply-orientation", label: "向き", type: "select", value: "vertical",
        options: [["vertical", "縦使い"], ["horizontal", "横使い"]],
      },
      {
        id: "ply-joint", label: "目地", type: "select", value: "aligned",
        options: [["aligned", "いも目地"], ["staggered", "千鳥"]],
      },
      { id: "ply-kerf", label: "切断代 (mm)", type: "number", value: 0 },
      {
        id: "ply-origin", label: "割付原点", type: "select", value: "bottom_left",
        options: [["bottom_left", "左下"], ["bottom_right", "右下"], ["center", "中央"]],
      },
    ],
  },
  {
    group: "桟木(縦桟木)",
    fields: [
      { id: "bat-name", label: "名称", type: "text", value: "桟木30×60" },
      { id: "bat-w", label: "断面幅 (mm)", type: "number", value: 30 },
      { id: "bat-d", label: "断面せい (mm)", type: "number", value: 60 },
      { id: "bat-stocks", label: "標準長さ (mm, カンマ区切り)", type: "text", value: "2000,3000,4000" },
      { id: "bat-pitch", label: "水平ピッチ (mm)", type: "number", value: 450 },
      {
        id: "bat-mode", label: "配置方式", type: "select", value: "fixed_pitch",
        options: [["fixed_pitch", "指定ピッチ固定(端部余り)"], ["equal_divide", "均等割り"]],
      },
      { id: "bat-start", label: "左端から最初まで (mm)", type: "number", value: 0 },
      { id: "bat-end", label: "右端から最後まで (mm)", type: "number", value: 0 },
      { id: "bat-ends", label: "型枠端部に配置", type: "checkbox", value: true },
      { id: "bat-joints", label: "ベニヤ継ぎ目に追加", type: "checkbox", value: true },
      { id: "bat-splice", label: "継ぎ足し可", type: "checkbox", value: true },
      { id: "bat-minuse", label: "最小使用長さ (mm)", type: "number", value: 300 },
    ],
  },
  {
    group: "鋼管(大引き)",
    fields: [
      { id: "pipe-name", label: "名称", type: "text", value: "角パイプ50" },
      {
        id: "pipe-shape", label: "形状", type: "select", value: "square",
        options: [["square", "角パイプ"], ["round", "丸パイプ"]],
      },
      { id: "pipe-w", label: "幅 (mm)", type: "number", value: 50 },
      { id: "pipe-h", label: "高さ (mm)", type: "number", value: 50 },
      { id: "pipe-t", label: "肉厚 (mm)", type: "number", value: 2.3 },
      { id: "pipe-stocks", label: "標準長さ (mm, カンマ区切り)", type: "text", value: "2000,3000,4000" },
      { id: "pipe-per", label: "一段当たり本数", type: "number", value: 1 },
      { id: "pipe-lines", label: "列数", type: "number", value: 1 },
      {
        id: "pipe-vmode", label: "鉛直ピッチ方式", type: "select", value: "uniform",
        options: [["uniform", "等間隔"], ["two_stage", "二段階(下部/上部)"]],
      },
      { id: "pipe-pitch", label: "鉛直ピッチ (mm)/二段階時は下部", type: "number", value: 600 },
      { id: "pipe-boundary", label: "二段階: 境界高さ (mm)", type: "number", value: 1500 },
      { id: "pipe-upper-pitch", label: "二段階: 上部ピッチ (mm)", type: "number", value: 900 },
      { id: "pipe-place-boundary", label: "二段階: 境界位置に配置", type: "checkbox", value: true },
      { id: "pipe-bottom", label: "最下段の高さ (mm)", type: "number", value: 300 },
      { id: "pipe-top", label: "最上段からの離れ (mm)", type: "number", value: 150 },
      { id: "pipe-lap", label: "重ね長さ (mm)", type: "number", value: 300 },
      { id: "pipe-splice", label: "継ぎ足し可", type: "checkbox", value: true },
      { id: "pipe-minuse", label: "最小使用長さ (mm)", type: "number", value: 500 },
    ],
  },
  {
    group: "セパレーター(長さ = 型枠同士の間隔)",
    fields: [
      { id: "sep-name", label: "名称", type: "text", value: "セパW3/8" },
      { id: "sep-dia", label: "呼び径", type: "text", value: "W3/8" },
      { id: "sep-stocks", label: "標準長さ一覧 (mm, カンマ区切り・空可)", type: "text", value: "" },
      { id: "sep-round", label: "特注丸め単位 (mm)", type: "number", value: 5 },
      { id: "sep-hpitch", label: "水平ピッチ (mm)", type: "number", value: 450 },
      { id: "sep-hstart", label: "左端から最初まで (mm)", type: "number", value: 150 },
      { id: "sep-hend", label: "右端から最後まで (mm)", type: "number", value: 150 },
      { id: "sep-vpitch", label: "鉛直ピッチ (mm)", type: "number", value: 450 },
      { id: "sep-two", label: "二段階配置(下部/上部で変更)", type: "checkbox", value: false },
      { id: "sep-boundary", label: "二段階: 境界高さ (mm)", type: "number", value: 1500 },
      { id: "sep-hpitch2", label: "二段階: 上部水平ピッチ (mm)", type: "number", value: 600 },
      { id: "sep-vpitch2", label: "二段階: 上部鉛直ピッチ (mm)", type: "number", value: 600 },
      { id: "sep-bottom", label: "最下段の高さ (mm)", type: "number", value: 150 },
      { id: "sep-top", label: "最上段からの離れ (mm)", type: "number", value: 150 },
      { id: "sep-manual", label: "長さ手入力 (mm, 空=型枠間隔)", type: "text", value: "" },
    ],
  },
  {
    group: "フォームタイ・Pコン",
    fields: [
      { id: "tie-name", label: "フォームタイ名称", type: "text", value: "フォームタイW3/8" },
      { id: "tie-double", label: "両面型枠時の個数/セパ", type: "number", value: 2 },
      { id: "tie-single", label: "片面型枠時の個数/セパ", type: "number", value: 1 },
      { id: "pcon-name", label: "Pコン名称", type: "text", value: "Pコン" },
      { id: "pcon-per", label: "片側当たり個数", type: "number", value: 1 },
    ],
  },
];

function renderMaterialsForm(): void {
  const root = document.getElementById("materials-form")!;
  root.innerHTML = "";
  for (const g of materialFields) {
    const h = document.createElement("h3");
    h.textContent = g.group;
    root.appendChild(h);
    const grid = document.createElement("div");
    grid.className = "grid";
    for (const f of g.fields) {
      grid.appendChild(makeField(f));
    }
    root.appendChild(grid);
  }
}

function makeField(f: FieldDef): HTMLElement {
  const label = document.createElement("label");
  if (f.type === "checkbox") label.className = "inline";
  if (f.type === "select") {
    const sel = document.createElement("select");
    sel.id = f.id;
    for (const [v, t] of f.options ?? []) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = t;
      sel.appendChild(o);
    }
    sel.value = String(f.value);
    label.append(f.label, sel);
  } else {
    const input = document.createElement("input");
    input.id = f.id;
    if (f.type === "checkbox") {
      input.type = "checkbox";
      input.checked = Boolean(f.value);
      label.append(input, f.label);
      return label;
    }
    input.type = f.type === "number" ? "number" : "text";
    if (f.type === "number") input.step = "any";
    input.value = String(f.value);
    label.append(f.label, input);
  }
  return label;
}

function val(id: string): string {
  return (document.getElementById(id) as HTMLInputElement | HTMLSelectElement).value.trim();
}
function num(id: string, errors: string[], label: string): number {
  const v = Number(val(id));
  if (!Number.isFinite(v)) errors.push(`${label} が数値ではありません`);
  return v;
}
function checked(id: string): boolean {
  return (document.getElementById(id) as HTMLInputElement).checked;
}
function lengths(id: string, errors: string[], label: string, allowEmpty = false): number[] {
  const s = val(id);
  if (s === "") {
    if (!allowEmpty) errors.push(`${label} が未入力です`);
    return [];
  }
  const arr = s.split(/[,、\s]+/).filter(Boolean).map(Number);
  if (arr.some((n) => !Number.isFinite(n) || n <= 0)) errors.push(`${label} に不正な値があります`);
  return arr;
}

function buildSeparatorBands(errors: string[]) {
  const hPitch = (pitch: number) => ({
    type: "uniform" as const,
    pitch,
    mode: "fixed_pitch" as const,
    startOffset: num("sep-hstart", errors, "セパ左端距離"),
    endOffset: num("sep-hend", errors, "セパ右端距離"),
  });
  if (!checked("sep-two")) {
    return [{
      fromLevel: 0, toLevel: 100000,
      horizontalPitch: hPitch(num("sep-hpitch", errors, "セパ水平ピッチ")),
      verticalPitch: num("sep-vpitch", errors, "セパ鉛直ピッチ"),
    }];
  }
  const boundary = num("sep-boundary", errors, "セパ二段階境界高さ");
  return [
    {
      fromLevel: 0, toLevel: boundary,
      horizontalPitch: hPitch(num("sep-hpitch", errors, "セパ下部水平ピッチ")),
      verticalPitch: num("sep-vpitch", errors, "セパ下部鉛直ピッチ"),
    },
    {
      fromLevel: boundary, toLevel: 100000,
      horizontalPitch: hPitch(num("sep-hpitch2", errors, "セパ上部水平ピッチ")),
      verticalPitch: num("sep-vpitch2", errors, "セパ上部鉛直ピッチ"),
    },
  ];
}

function readMaterials(errors: string[]): MaterialConfig {
  const rounding = { type: "ceil_unit", unit: 1 } as const;
  const plywood: PlywoodSpec = {
    id: "ply", name: val("ply-name"),
    width: num("ply-width", errors, "ベニヤ幅"),
    length: num("ply-length", errors, "ベニヤ長さ"),
    thickness: num("ply-thickness", errors, "ベニヤ厚さ"),
    defaultOrientation: val("ply-orientation") as PlywoodSpec["defaultOrientation"],
    jointDirection: val("ply-joint") as PlywoodSpec["jointDirection"],
    kerf: num("ply-kerf", errors, "切断代"),
    rounding,
  };
  const batten: BattenSpec = {
    id: "bat", name: val("bat-name"),
    sectionWidth: num("bat-w", errors, "桟木断面幅"),
    sectionDepth: num("bat-d", errors, "桟木断面せい"),
    stockLengths: lengths("bat-stocks", errors, "桟木標準長さ"),
    spliceAllowed: checked("bat-splice"),
    minUseLength: num("bat-minuse", errors, "桟木最小使用長さ"),
    rounding,
  };
  const pipeShape = val("pipe-shape") as PipeSpec["shape"];
  const pipe: PipeSpec = {
    id: "pipe", name: val("pipe-name"), shape: pipeShape,
    width: num("pipe-w", errors, "鋼管幅"),
    height: num("pipe-h", errors, "鋼管高さ"),
    wallThickness: num("pipe-t", errors, "鋼管肉厚"),
    stockLengths: lengths("pipe-stocks", errors, "鋼管標準長さ"),
    pipesPerLevel: num("pipe-per", errors, "一段当たり本数"),
    lineCount: num("pipe-lines", errors, "列数"),
    spliceAllowed: checked("pipe-splice"),
    lapLength: num("pipe-lap", errors, "重ね長さ"),
    splicePosition: "fixed",
    minUseLength: num("pipe-minuse", errors, "鋼管最小使用長さ"),
    rounding,
  };
  const separator: SeparatorSpec = {
    id: "sep", name: val("sep-name"), diameter: val("sep-dia"), endShape: "C",
    stockLengths: lengths("sep-stocks", errors, "セパ標準長さ", true),
    customLengthRounding: num("sep-round", errors, "特注丸め単位"),
    lengthRules: [],
    rounding,
  };
  const pcon: PconSpec = {
    id: "pcon", name: val("pcon-name"), compatibleSeparators: ["sep"],
    faceShape: "-", depth: 0, threadLength: 0,
    countPerEnd: num("pcon-per", errors, "Pコン片側個数"),
    usage: "other", separatorLengthAdjust: 0, rounding,
  };
  const formTie: FormTieSpec = {
    id: "tie", name: val("tie-name"), compatibleSeparators: ["sep"],
    compatiblePipeShapes: [pipeShape], countPerSeparatorEnd: 1,
    countPerSideSingle: num("tie-single", errors, "片面フォームタイ個数"),
    countPerSideDouble: num("tie-double", errors, "両面フォームタイ個数"),
    usage: "common", rounding,
  };
  const manualLenStr = val("sep-manual");
  const manualLength = manualLenStr === "" ? undefined : Number(manualLenStr);
  if (manualLength !== undefined && !Number.isFinite(manualLength)) {
    errors.push("セパ長さ手入力が数値ではありません");
  }
  return {
    plywood: {
      spec: plywood,
      layoutOrigin: val("ply-origin") as "bottom_left" | "bottom_right" | "center",
    },
    batten: {
      spec: batten,
      pitch: {
        type: "uniform",
        pitch: num("bat-pitch", errors, "桟木ピッチ"),
        mode: val("bat-mode") as "fixed_pitch" | "equal_divide",
        startOffset: num("bat-start", errors, "桟木左端距離"),
        endOffset: num("bat-end", errors, "桟木右端距離"),
      },
      placeAtEnds: checked("bat-ends"),
      extraAtPanelJoints: checked("bat-joints"),
      jointCountPerJoint: 1,
      extraAtCorners: false,
    },
    pipe: {
      spec: pipe,
      verticalPitch:
        val("pipe-vmode") === "two_stage"
          ? {
              type: "two_stage",
              boundaryLevel: num("pipe-boundary", errors, "鋼管二段階境界高さ"),
              lower: { pitch: num("pipe-pitch", errors, "鋼管下部ピッチ"), mode: "fixed_pitch" },
              upper: {
                pitch: num("pipe-upper-pitch", errors, "鋼管上部ピッチ"),
                mode: "fixed_pitch",
              },
              placeAtBoundary: checked("pipe-place-boundary"),
              bottomOffset: num("pipe-bottom", errors, "鋼管最下段高さ"),
              topClearance: num("pipe-top", errors, "鋼管最上段離れ"),
            }
          : {
              type: "uniform",
              pitch: num("pipe-pitch", errors, "鋼管鉛直ピッチ"),
              mode: "fixed_pitch",
              startOffset: num("pipe-bottom", errors, "鋼管最下段高さ"),
              endOffset: num("pipe-top", errors, "鋼管最上段離れ"),
            },
    },
    separator: {
      spec: separator,
      pcon,
      manualLength,
      bands: buildSeparatorBands(errors),
      edgeOffsets: {
        bottom: num("sep-bottom", errors, "セパ最下段高さ"),
        topClearance: num("sep-top", errors, "セパ最上段離れ"),
      },
    },
    formTie: { spec: formTie },
  };
}

// ---------- 構造部材 ----------

let members: MemberInput[] = [];
const kindCounters: Record<string, number> = {};
const KIND_LABEL: Record<MemberInput["kind"], string> = {
  wall: "壁・擁壁", column: "柱", beam: "梁", slab: "スラブ", footing: "フーチング",
};
const KIND_PREFIX: Record<MemberInput["kind"], string> = {
  wall: "W", column: "C", beam: "G", slab: "S", footing: "F",
};

function newMember(kind: MemberInput["kind"]): MemberInput {
  kindCounters[kind] = (kindCounters[kind] ?? 0) + 1;
  const memberId = `${KIND_PREFIX[kind]}${kindCounters[kind]}`;
  switch (kind) {
    case "wall":
      return { kind, memberId, length: 3640, height: 3000, thickness: 180, formworkSides: "both" };
    case "column":
      return { kind, memberId, width: 800, depth: 800, height: 3000 };
    case "beam":
      return {
        kind, memberId, length: 5400, width: 600, depth: 700,
        sideFormLeft: true, sideFormRight: true, bottomForm: true,
      };
    case "slab":
      return {
        kind, memberId, lengthX: 5460, lengthY: 3640, thickness: 200,
        bottomForm: true, edgeFormFlags: [true, true, true, true],
      };
    case "footing":
      return { kind, memberId, width: 2000, depth: 1500, height: 800 };
  }
}

function numField(
  m: Record<string, unknown>, key: string, label: string,
): HTMLElement {
  const el = document.createElement("label");
  const input = document.createElement("input");
  input.type = "number";
  input.step = "any";
  input.value = String(m[key] ?? "");
  input.onfocus = () => pushHistory();
  input.oninput = () => { m[key] = Number(input.value); planApi?.redraw(); renderJunctions(); };
  el.append(label, input);
  return el;
}
function boolField(m: Record<string, unknown>, key: string, label: string): HTMLElement {
  const el = document.createElement("label");
  el.className = "inline";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(m[key]);
  input.onchange = () => { pushHistory(); m[key] = input.checked; };
  el.append(input, label);
  return el;
}
function selectField(
  m: Record<string, unknown>, key: string, label: string, options: [string, string][],
): HTMLElement {
  const el = document.createElement("label");
  const sel = document.createElement("select");
  for (const [v, t] of options) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t;
    sel.appendChild(o);
  }
  if (m[key] == null) m[key] = options[0]![0]; // 既定値 = 先頭の選択肢
  sel.value = String(m[key]);
  sel.onchange = () => { pushHistory(); m[key] = sel.value; };
  el.append(label, sel);
  return el;
}
/** 3D表示用の底高さZ(数量計算に影響しない) */
function zField(m: MemberInput, idx: number): HTMLElement {
  const el = document.createElement("label");
  const input = document.createElement("input");
  input.type = "number";
  input.step = "any";
  input.value = String(m.placement?.z ?? 0);
  input.onfocus = () => pushHistory();
  input.oninput = () => {
    if (!m.placement) m.placement = { x: 0, y: 5000 + idx * 3000, angleDeg: 0 };
    m.placement.z = Number(input.value);
    renderJunctions();
  };
  el.append("表示底高さZ (mm, 3D用)", input);
  return el;
}

function flagField(
  m: Record<string, unknown>, key: string, index: number, label: string,
): HTMLElement {
  const el = document.createElement("label");
  el.className = "inline";
  const input = document.createElement("input");
  input.type = "checkbox";
  const arr = (m[key] as boolean[] | undefined) ?? [true, true, true, true];
  m[key] = arr;
  input.checked = arr[index]!;
  input.onchange = () => { pushHistory(); arr[index] = input.checked; };
  el.append(input, label);
  return el;
}

let planApi: PlanApi | null = null;
let selectedMemberIndex: number | null = null;
let junctionPolicies: Record<string, JunctionPolicy> = {};

// ---------- Undo / Redo(部材形状・配置・勝ち負けの編集履歴) ----------

const HISTORY_LIMIT = 100;
let undoStack: string[] = [];
let redoStack: string[] = [];

function historySnapshot(): string {
  return JSON.stringify({ members, junctionPolicies });
}

/**
 * 変更を加える直前に呼ぶ。preSnap を渡すと「変更前の状態」を明示的に積む
 * (ドラッグ確定時など、すでに状態が変わってしまっている場合に使う)
 */
function pushHistory(preSnap?: string): void {
  if (preSnap !== undefined && preSnap === historySnapshot()) return; // 実変更なし
  const snap = preSnap ?? historySnapshot();
  if (undoStack[undoStack.length - 1] === snap) return; // 無変更の重複を避ける
  undoStack.push(snap);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack = [];
  updateHistoryButtons();
}

function restoreSnapshot(snap: string): void {
  const s = JSON.parse(snap) as {
    members: MemberInput[];
    junctionPolicies: Record<string, JunctionPolicy>;
  };
  members = s.members;
  junctionPolicies = s.junctionPolicies;
  selectedMemberIndex = null;
  renderMembers();
}

function undo(): void {
  const snap = undoStack.pop();
  if (snap === undefined) return;
  redoStack.push(historySnapshot());
  restoreSnapshot(snap);
  updateHistoryButtons();
}

function redo(): void {
  const snap = redoStack.pop();
  if (snap === undefined) return;
  undoStack.push(historySnapshot());
  restoreSnapshot(snap);
  updateHistoryButtons();
}

function updateHistoryButtons(): void {
  const u = document.getElementById("btn-undo") as HTMLButtonElement | null;
  const r = document.getElementById("btn-redo") as HTMLButtonElement | null;
  if (u) u.disabled = undoStack.length === 0;
  if (r) r.disabled = redoStack.length === 0;
}

function renderJunctions(): void {
  const root = document.getElementById("junctions-list");
  if (!root) return;
  const candidates = detectJunctions(members);
  if (candidates.length === 0) {
    root.innerHTML = `<p class="hint">重なりは検出されていません(平面配置済みの柱×壁・柱×梁が対象)。</p>`;
    return;
  }
  root.innerHTML = "";
  for (const c of candidates) {
    const row = document.createElement("div");
    row.className = "row junction-row";
    const label = document.createElement("span");
    label.textContent = c.description;
    const sel = document.createElement("select");
    for (const [v, t] of [
      ["deduct", `${c.winnerId} 勝ち: ${c.loserId} から控除(標準)`],
      ["count_both", "両方計上: 控除しない"],
    ] as const) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = t;
      sel.appendChild(o);
    }
    sel.value = junctionPolicies[c.id] ?? c.defaultPolicy;
    sel.onchange = () => { junctionPolicies[c.id] = sel.value as JunctionPolicy; };
    row.append(label, sel);
    root.appendChild(row);
  }
}

function renderMembers(): void {
  planApi?.redraw();
  renderJunctions();
  const root = document.getElementById("members-list")!;
  root.innerHTML = "";
  if (members.length === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "部材が未登録です。「部材を追加」で壁・柱・梁・スラブ・フーチングを登録してください。";
    root.appendChild(p);
    return;
  }
  members.forEach((m, idx) => {
    const card = document.createElement("div");
    card.className = "member-card" + (idx === selectedMemberIndex ? " selected" : "");
    card.id = `member-card-${idx}`;
    const head = document.createElement("div");
    head.className = "card-head";
    const title = document.createElement("span");
    title.innerHTML = `<span class="kind">${KIND_LABEL[m.kind]}</span> ${m.memberId}`;
    const del = document.createElement("button");
    del.textContent = "削除";
    del.className = "danger";
    del.onclick = () => { pushHistory(); members.splice(idx, 1); renderMembers(); };
    head.append(title, del);
    card.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "grid";
    const r = m as unknown as Record<string, unknown>;
    switch (m.kind) {
      case "wall":
        grid.append(
          numField(r, "length", "壁長さ (mm)"),
          numField(r, "height", "型枠高さ (mm)"),
          numField(r, "thickness", "壁厚 (mm)"),
          selectField(r, "formworkSides", "型枠面", [
            ["both", "両面"], ["sideA", "片面A"], ["sideB", "片面B"],
          ]),
        );
        break;
      case "column":
        grid.append(
          numField(r, "width", "柱幅 (mm)"),
          numField(r, "depth", "柱奥行き (mm)"),
          numField(r, "height", "柱高さ (mm)"),
          selectField(r, "tieMethod", "締固め方式", [
            ["separator", "セパ方式"], ["column_clamp", "コラムクランプ"],
          ]),
        );
        break;
      case "beam":
        grid.append(
          numField(r, "length", "梁長さ (mm)"),
          numField(r, "width", "梁幅 (mm)"),
          numField(r, "depth", "梁せい (mm)"),
          boolField(r, "sideFormLeft", "梁側左"),
          boolField(r, "sideFormRight", "梁側右"),
          boolField(r, "bottomForm", "梁底"),
          selectField(r, "bottomWidthRule", "梁底幅", [
            ["bottom_wins", "底勝ち(=梁幅)"], ["side_wins", "側勝ち(控除)"],
          ]),
          zField(m, idx),
        );
        break;
      case "slab":
        grid.append(
          numField(r, "lengthX", "X方向長さ (mm)"),
          numField(r, "lengthY", "Y方向長さ (mm)"),
          numField(r, "thickness", "スラブ厚 (mm)"),
          boolField(r, "bottomForm", "スラブ底型枠"),
          flagField(r, "edgeFormFlags", 0, "端部X-"),
          flagField(r, "edgeFormFlags", 1, "端部X+"),
          flagField(r, "edgeFormFlags", 2, "端部Y-"),
          flagField(r, "edgeFormFlags", 3, "端部Y+"),
          zField(m, idx),
        );
        break;
      case "footing":
        grid.append(
          numField(r, "width", "幅 (mm)"),
          numField(r, "depth", "奥行き (mm)"),
          numField(r, "height", "高さ (mm)"),
          flagField(r, "sideFlags", 0, "側面X-"),
          flagField(r, "sideFlags", 1, "側面X+"),
          flagField(r, "sideFlags", 2, "側面Y-"),
          flagField(r, "sideFlags", 3, "側面Y+"),
          boolField(r, "bottomForm", "底面型枠(標準なし)"),
        );
        break;
    }
    card.appendChild(grid);
    root.appendChild(card);
  });
}

// ---------- 実行・結果表示 ----------

const M2 = (mm2: number) => (mm2 / 1e6).toFixed(2);
const M = (mm: number) => (mm / 1000).toFixed(2);

function buildProject(errors: string[]): Project {
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    id: "prj-local",
    name: val("prj-name") || "無題プロジェクト",
    siteName: val("prj-site"),
    workSection: val("prj-section"),
    pourSection: val("prj-pour"),
    unit: "mm",
    materials: readMaterials(errors),
    members,
    underlay: underlay
      ? {
          imageDataUrl: underlay.imageDataUrl,
          mmPerPx: underlay.mmPerPx,
          offsetX: underlay.offsetX,
          offsetY: underlay.offsetY,
          opacity: underlay.opacity,
          scaleSet: underlay.scaleSet,
        }
      : undefined,
    junctionPolicies,
    manualAdjustments: [],
  };
}

function table(headers: string[], rows: (string | number)[][]): string {
  const th = headers.map((h) => `<th>${h}</th>`).join("");
  const trs = rows
    .map((r) =>
      `<tr>${r.map((c, i) => `<td class="${i === 0 ? "text" : ""}">${c}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

function stockCounts(rec: Record<number, number>): string {
  const keys = Object.keys(rec).map(Number).sort((a, b) => a - b);
  if (keys.length === 0) return "-";
  return keys.map((k) => `${k}mm×${rec[k]}`).join(", ");
}

const CATEGORY_LABEL: Record<string, string> = {
  early_strip: "先行脱型可能",
  support_related: "支保工関連",
  slab_bottom: "スラブ底",
  beam_bottom: "梁底(最後まで残置)",
  remain_last: "最後まで残置",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderResults(memberResults: MemberTakeoffResult[], agg: ProjectAggregate): void {
  const root = document.getElementById("results")!;
  let html = "";

  // 不足情報・警告・エラー
  const msgs: string[] = [];
  for (const b of agg.blockers) msgs.push(`<p class="blocker">【不足情報】${esc(b.message)}</p>`);
  for (const w of [...new Set(agg.warnings)]) msgs.push(`<p class="warning">【注意】${esc(w)}</p>`);
  for (const e of [...new Set(agg.errors)]) msgs.push(`<p class="error">【エラー】${esc(e)}</p>`);
  if (msgs.length > 0) html += `<div class="messages">${msgs.join("")}</div>`;
  if (agg.blockers.length > 0) {
    html += `<p class="hint">不足情報がある部材は数量が未計算です。不足項目を入力して再実行してください。</p>`;
  }

  html += "<h3>材料別合計</h3>";
  html += table(
    ["材料", "数量", "内訳・規格別"],
    [
      [
        `ベニヤ(${esc(val("ply-name"))})`,
        `${agg.totals.plywood.totalCount} 枚`,
        `全判 ${agg.totals.plywood.fullCount} / 切断 ${agg.totals.plywood.cutCount}、` +
        `使用 ${M2(agg.totals.plywood.usedArea)}m²、端材 ${M2(agg.totals.plywood.wasteArea)}m²`,
      ],
      [
        `桟木(${esc(val("bat-name"))})`,
        `${agg.totals.batten.placedCount} 本`,
        `総延長 ${M(agg.totals.batten.totalUsedLength)}m、規格別 ${stockCounts(agg.totals.batten.byStockLength)}、` +
        `切断材 ${agg.totals.batten.cutPieceCount} 本`,
      ],
      [
        `鋼管(${esc(val("pipe-name"))})`,
        `${agg.totals.pipe.pieceCount} 本`,
        `総延長 ${M(agg.totals.pipe.totalUsedLength)}m、規格別 ${stockCounts(agg.totals.pipe.byStockLength)}、` +
        `継ぎ ${agg.totals.pipe.spliceCount} 箇所`,
      ],
      [
        `セパレーター(${esc(val("sep-name"))})`,
        `${agg.totals.separator.totalCount} 本`,
        `長さ別 ${stockCounts(agg.totals.separator.byLength)}`,
      ],
      [`フォームタイ(${esc(val("tie-name"))})`, `${agg.totals.formTie.totalCount} 個`, "-"],
      [`Pコン(${esc(val("pcon-name"))})`, `${agg.totals.pcon.totalCount} 個`, "-"],
    ],
  );

  html += "<h3>構造部材別</h3>";
  html += table(
    ["部材", "種類", "面数", "型枠面積(m²)", "ベニヤ", "桟木", "鋼管", "セパ", "Fタイ", "Pコン"],
    agg.byMember.map((m) => [
      m.memberId, KIND_LABEL[m.memberKind], m.faceCount, M2(m.netArea),
      m.plywoodTotal, m.battenCount, m.pipeCount, m.separatorCount, m.formTieCount, m.pconCount,
    ]),
  );

  html += "<h3>脱型区分別(梁側と梁底は合算しません)</h3>";
  html += table(
    ["脱型区分", "区分", "面数", "面積(m²)", "ベニヤ", "桟木", "鋼管"],
    agg.byStrippingGroup.map((g) => [
      g.group, CATEGORY_LABEL[g.category] ?? g.category, g.faceCount, M2(g.netArea),
      g.plywoodTotal, g.battenCount, g.pipeCount,
    ]),
  );

  // 計算根拠(§25 トレース)+ 板割図
  html += "<h3>計算根拠・板割図</h3>";
  const mt = lastRun?.project.materials;
  for (const m of memberResults) {
    html += `<details><summary>${m.memberId}(${KIND_LABEL[m.memberKind]})の計算過程</summary>`;
    for (const f of m.faces) {
      html += `<p class="formula"><b>${f.faceId}</b>(${f.faceType} / 脱型区分 ${f.strippingGroup} / ` +
        `${f.width}×${f.height}mm = ${M2(f.netArea)}m²)\n` +
        `・ベニヤ: ${esc(f.plywood.formula)}\n` +
        `・桟木: ${esc(f.batten.formula)}\n` +
        `・鋼管: ${esc(f.pipe.formula)}` +
        (f.notes.length > 0 ? `\n・注記: ${esc(f.notes.join(" / "))}` : "") +
        `</p>`;
      // 板割図(セパはA面側の格子を重ねる)
      const pair = m.pairs.find((p) => p.faceIdA === f.faceId);
      const svg = faceLayoutSvg(f, {
        separatorPoints: pair?.separator.points,
        battenSectionWidth: mt?.batten.spec.sectionWidth,
        pipeHeight: mt?.pipe.spec.height,
      });
      const href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      html += `<details class="itawari"><summary>板割図: ${f.faceId}</summary>` +
        `<div class="svg-wrap">${svg}</div>` +
        `<a href="${href}" download="${f.faceId}_板割図.svg">SVGをダウンロード</a></details>`;
    }
    for (const p of m.pairs) {
      html += `<p class="formula"><b>${p.pairId}</b>(型枠間隔 ${p.formGap}mm)\n` +
        `・セパ: ${esc(p.separator.formula)}\n` +
        `・フォームタイ: ${esc(p.formTie.formula)}\n` +
        `・Pコン: ${esc(p.pcon.formula)}</p>`;
    }
    html += "</details>";
  }

  html += `<p class="disclaimer" style="color:#222;background:#eef2f6;">${esc(DISCLAIMER)}</p>`;
  root.innerHTML = html;
}

// ---------- 保存・読込 ----------

function saveProject(): void {
  const errors: string[] = [];
  const project = buildProject(errors);
  if (errors.length > 0) {
    alert("入力に不備があります:\n" + errors.join("\n"));
    return;
  }
  const blob = new Blob([serializeProject(project)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${project.name}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function loadProject(file: File): void {
  file.text().then((text) => {
    const r = deserializeProject(text);
    if (!r.project) {
      alert("読み込みに失敗しました:\n" + r.errors.join("\n"));
      return;
    }
    (document.getElementById("prj-name") as HTMLInputElement).value = r.project.name;
    (document.getElementById("prj-site") as HTMLInputElement).value = r.project.siteName ?? "";
    (document.getElementById("prj-section") as HTMLInputElement).value = r.project.workSection ?? "";
    (document.getElementById("prj-pour") as HTMLInputElement).value = r.project.pourSection ?? "";
    members = r.project.members;
    junctionPolicies = r.project.junctionPolicies ?? {};
    if (r.project.underlay) {
      loadUnderlayImage(r.project.underlay.imageDataUrl, r.project.underlay);
    } else {
      underlay = null;
      updateUnderlayUi();
    }
    renderMembers();
    document.getElementById("results")!.innerHTML =
      `<p class="hint">プロジェクトを読み込みました。材料条件は画面の値が使われます。「拾い出しを実行」で再計算してください。</p>`;
  });
}

// ---------- 初期化 ----------

renderMaterialsForm();
renderMembers();

document.getElementById("btn-add-member")!.addEventListener("click", () => {
  const kind = (document.getElementById("member-kind") as HTMLSelectElement)
    .value as MemberInput["kind"];
  pushHistory();
  members.push(newMember(kind));
  renderMembers();
});

document.getElementById("btn-undo")!.addEventListener("click", undo);
document.getElementById("btn-redo")!.addEventListener("click", redo);
window.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return; // 入力中は既定動作
  if (e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
  if (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey)) {
    e.preventDefault(); redo();
  }
});

// ---------- 実行・CSV出力 ----------

let lastRun: {
  project: Project;
  memberResults: MemberTakeoffResult[];
  aggregate: ProjectAggregate;
} | null = null;

const EXPORT_BUTTONS = [
  "btn-csv-materials", "btn-csv-members", "btn-csv-stripping",
  "btn-csv-faces", "btn-csv-conditions", "btn-report",
];

function setExportEnabled(enabled: boolean): void {
  for (const id of EXPORT_BUTTONS) {
    (document.getElementById(id) as HTMLButtonElement).disabled = !enabled;
  }
}

function downloadCsv(filename: string, content: string): void {
  // Excel での文字化け防止のため UTF-8 BOM を付与
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

document.getElementById("btn-run")!.addEventListener("click", () => {
  const errors: string[] = [];
  if (members.length === 0) errors.push("構造部材が未登録です");
  if (underlay && !underlay.scaleSet) {
    errors.push(
      "図面画像の縮尺が未設定です。「縮尺を設定」で2点をクリックし実寸を入力してください" +
      "(縮尺未設定では拾い出しを実行できません)",
    );
  }
  const project = buildProject(errors);
  if (errors.length > 0) {
    document.getElementById("results")!.innerHTML =
      `<div class="messages">${errors.map((e) => `<p class="error">【入力不備】${esc(e)}</p>`).join("")}</div>` +
      `<p class="hint">不足項目を入力してから再実行してください(推測では計算しません)。</p>`;
    lastRun = null;
    setExportEnabled(false);
    return;
  }
  // 勝ち負け(取り合い)の控除を適用してから実行。保存用の形状は元のまま(§26)
  const candidates = detectJunctions(members);
  const effectiveProject: Project = {
    ...project,
    members: applyJunctions(members, candidates, junctionPolicies),
  };
  const { memberResults } = runProject(effectiveProject);
  const aggregate = aggregateProject(memberResults);
  lastRun = { project, memberResults, aggregate };
  setExportEnabled(true);
  renderResults(memberResults, aggregate);
  updateThreeView(effectiveProject, memberResults);
});

function wireExport(id: string, filename: string, gen: () => string): void {
  document.getElementById(id)!.addEventListener("click", () => {
    if (!lastRun) return;
    downloadCsv(`${lastRun.project.name}_${filename}.csv`, gen());
  });
}
wireExport("btn-csv-materials", "材料別合計", () => materialTotalsCsv(lastRun!.aggregate));
wireExport("btn-csv-members", "部材別", () => memberRowsCsv(lastRun!.aggregate));
wireExport("btn-csv-stripping", "脱型区分別", () => strippingCsv(lastRun!.aggregate));
wireExport("btn-csv-faces", "型枠面別内訳", () => faceDetailCsv(lastRun!.memberResults));
wireExport("btn-csv-conditions", "計算条件一覧", () => conditionsCsv(lastRun!.project));

document.getElementById("btn-report")!.addEventListener("click", () => {
  if (!lastRun) return;
  const html = buildReportHtml(lastRun.project, lastRun.memberResults, lastRun.aggregate);
  const win = window.open("", "_blank");
  if (!win) {
    alert("ポップアップがブロックされました。ブラウザの設定で許可してください");
    return;
  }
  win.document.write(html);
  win.document.close();
});

// ---------- 3D確認 ----------

let threeApi: ThreeViewApi | null = null;

function updateThreeView(project: Project, memberResults: MemberTakeoffResult[]): void {
  if (!threeApi) {
    threeApi = initThreeView(document.getElementById("three-container")!);
    const layerIds: [string, LayerName][] = [
      ["layer-concrete", "concrete"], ["layer-plywood", "plywood"],
      ["layer-batten", "batten"], ["layer-pipe", "pipe"], ["layer-separator", "separator"],
      ["layer-formtie", "formtie"], ["layer-pcon", "pcon"],
    ];
    for (const [id, layer] of layerIds) {
      const cb = document.getElementById(id) as HTMLInputElement;
      threeApi!.setLayerVisible(layer, cb.checked); // 初期状態を反映(Pコンは既定オフ)
      cb.addEventListener("change", () => threeApi!.setLayerVisible(layer, cb.checked));
    }
  }
  threeApi.update(project, { memberResults, aggregate: aggregateProject(memberResults) });
}

// ---------- 下敷き画像・縮尺(§5) ----------

let underlay: UnderlayView | null = null;

function scaleStatusText(): string {
  if (!underlay) {
    return "画像なし(PDFは画像化して読み込んでください。PDF直接読み込みは将来対応)";
  }
  return underlay.scaleSet
    ? `縮尺設定済み: ${underlay.mmPerPx.toFixed(2)} mm/px`
    : "縮尺未設定 — 「縮尺を設定」で図面上の2点をクリックし、実寸(mm)を入力してください。縮尺未設定では拾い出しできません";
}

function updateUnderlayUi(): void {
  document.getElementById("scale-status")!.textContent = scaleStatusText();
  (document.getElementById("btn-scale") as HTMLButtonElement).disabled = !underlay;
  (document.getElementById("btn-underlay-clear") as HTMLButtonElement).disabled = !underlay;
  planApi?.redraw();
}

function loadUnderlayImage(dataUrl: string, keep?: Partial<UnderlayView>): void {
  const img = new Image();
  img.onload = () => {
    underlay = {
      img,
      imageDataUrl: dataUrl,
      // 仮縮尺: 画像幅 = 20m として表示(縮尺設定で確定するまで scaleSet=false)
      mmPerPx: keep?.mmPerPx ?? 20000 / img.width,
      offsetX: keep?.offsetX ?? 0,
      offsetY: keep?.offsetY ?? 0,
      opacity: keep?.opacity ?? Number((document.getElementById("underlay-opacity") as HTMLInputElement).value),
      scaleSet: keep?.scaleSet ?? false,
    };
    updateUnderlayUi();
  };
  img.src = dataUrl;
}

function handleUnderlayFile(file: File): void {
  const reader = new FileReader();
  reader.onload = () => loadUnderlayImage(String(reader.result));
  reader.readAsDataURL(file);
}

for (const id of ["underlay-file", "underlay-camera"]) {
  document.getElementById(id)!.addEventListener("change", (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) handleUnderlayFile(f);
    (e.target as HTMLInputElement).value = "";
  });
}

document.getElementById("btn-scale")!.addEventListener("click", () => {
  if (!underlay) return;
  planApi?.startScaleCalibration();
  document.getElementById("scale-status")!.textContent =
    "縮尺計測中: 図面上の2点(寸法が分かる範囲)をクリックしてください(Escで中止)";
});

document.getElementById("underlay-opacity")!.addEventListener("input", (e) => {
  if (underlay) {
    underlay.opacity = Number((e.target as HTMLInputElement).value);
    planApi?.redraw();
  }
});

document.getElementById("btn-underlay-clear")!.addEventListener("click", () => {
  underlay = null;
  updateUnderlayUi();
});

// ---------- 2D平面配置 ----------

let pendingDragSnapshot: string | null = null;

planApi = initPlan({
  canvas: document.getElementById("plan-canvas") as HTMLCanvasElement,
  modeSelect: document.getElementById("plan-mode") as HTMLSelectElement,
  getMembers: () => members,
  addMember: (m) => {
    pushHistory();
    members.push(m);
    renderMembers();
  },
  createMember: (kind) => newMember(kind),
  onSelect: (index) => {
    selectedMemberIndex = index;
    renderMembers();
    if (index !== null) {
      document.getElementById(`member-card-${index}`)?.scrollIntoView({
        behavior: "smooth", block: "nearest",
      });
    }
  },
  onDragStart: () => {
    pendingDragSnapshot = historySnapshot();
  },
  onDragEnd: () => {
    if (pendingDragSnapshot !== null) pushHistory(pendingDragSnapshot);
    pendingDragSnapshot = null;
    renderMembers(); // 寸法カード・取り合いを最新化
  },
  getUnderlay: () => underlay,
  onScalePoints: (p1, p2) => {
    if (!underlay) return;
    const measured = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (measured < 1) {
      alert("2点が近すぎます。もう一度指定してください");
      updateUnderlayUi();
      return;
    }
    const input = prompt("クリックした2点間の実際の距離を mm で入力してください(例: 5400)");
    const real = input === null ? NaN : Number(input.trim());
    if (!Number.isFinite(real) || real <= 0) {
      alert("縮尺は設定されませんでした(数値を入力してください)");
      updateUnderlayUi();
      return;
    }
    // 1点目を固定したまま画像を実寸に合わせる
    const factor = real / measured;
    underlay.mmPerPx *= factor;
    underlay.offsetX = p1.x - (p1.x - underlay.offsetX) * factor;
    underlay.offsetY = p1.y - (p1.y - underlay.offsetY) * factor;
    underlay.scaleSet = true;
    updateUnderlayUi();
  },
});
updateUnderlayUi();

document.getElementById("btn-save")!.addEventListener("click", saveProject);
document.getElementById("file-load")!.addEventListener("change", (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) loadProject(f);
});
