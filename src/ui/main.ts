// 型枠材料拾い出し 最小UI(フェーズ2の先行実装)。
// 数量はすべて計算エンジン(src/core)で算出し、UIは入力と表示のみを担当する。

import { aggregateProject } from "../core/aggregate.js";
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
      { id: "pipe-pitch", label: "鉛直ピッチ (mm)", type: "number", value: 600 },
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
      verticalPitch: {
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
      bands: [
        {
          fromLevel: 0, toLevel: 100000,
          horizontalPitch: {
            type: "uniform",
            pitch: num("sep-hpitch", errors, "セパ水平ピッチ"),
            mode: "fixed_pitch",
            startOffset: num("sep-hstart", errors, "セパ左端距離"),
            endOffset: num("sep-hend", errors, "セパ右端距離"),
          },
          verticalPitch: num("sep-vpitch", errors, "セパ鉛直ピッチ"),
        },
      ],
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
  input.oninput = () => { m[key] = Number(input.value); };
  el.append(label, input);
  return el;
}
function boolField(m: Record<string, unknown>, key: string, label: string): HTMLElement {
  const el = document.createElement("label");
  el.className = "inline";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(m[key]);
  input.onchange = () => { m[key] = input.checked; };
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
  sel.onchange = () => { m[key] = sel.value; };
  el.append(label, sel);
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
  input.onchange = () => { arr[index] = input.checked; };
  el.append(input, label);
  return el;
}

function renderMembers(): void {
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
    card.className = "member-card";
    const head = document.createElement("div");
    head.className = "card-head";
    const title = document.createElement("span");
    title.innerHTML = `<span class="kind">${KIND_LABEL[m.kind]}</span> ${m.memberId}`;
    const del = document.createElement("button");
    del.textContent = "削除";
    del.className = "danger";
    del.onclick = () => { members.splice(idx, 1); renderMembers(); };
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

function renderResults(memberResults: MemberTakeoffResult[]): void {
  const agg = aggregateProject(memberResults);
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

  // 計算根拠(§25 トレース)
  html += "<h3>計算根拠</h3>";
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
  members.push(newMember(kind));
  renderMembers();
});

document.getElementById("btn-run")!.addEventListener("click", () => {
  const errors: string[] = [];
  if (members.length === 0) errors.push("構造部材が未登録です");
  const project = buildProject(errors);
  if (errors.length > 0) {
    document.getElementById("results")!.innerHTML =
      `<div class="messages">${errors.map((e) => `<p class="error">【入力不備】${esc(e)}</p>`).join("")}</div>` +
      `<p class="hint">不足項目を入力してから再実行してください(推測では計算しません)。</p>`;
    return;
  }
  const { memberResults } = runProject(project);
  renderResults(memberResults);
});

document.getElementById("btn-save")!.addEventListener("click", saveProject);
document.getElementById("file-load")!.addEventListener("change", (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) loadProject(f);
});
