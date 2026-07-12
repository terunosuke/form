import type { ProjectAggregate } from "./aggregate.js";
import type { Project } from "./project.js";
import type { MemberTakeoffResult } from "./takeoff.js";
import { DISCLAIMER } from "./takeoff.js";

// CSV出力(設計書 §23 ステップ10・§24)。
// Excel での文字化けを避けるため、ダウンロード時に UTF-8 BOM を付与する想定。
// 数量の生成はエンジン側で完結しており、本モジュールは整形のみを行う。

const KIND_LABEL: Record<string, string> = {
  wall: "壁・擁壁", column: "柱", beam: "梁", slab: "スラブ", footing: "フーチング",
};
const CATEGORY_LABEL: Record<string, string> = {
  early_strip: "先行脱型可能",
  support_related: "支保工関連",
  slab_bottom: "スラブ底",
  beam_bottom: "梁底(最後まで残置)",
  remain_last: "最後まで残置",
};

export function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const m2 = (mm2: number) => (mm2 / 1e6).toFixed(3);
const m = (mm: number) => (mm / 1000).toFixed(2);

function stockRows(
  label: string, byStock: Record<number, number>, unit: string,
): (string | number)[][] {
  return Object.keys(byStock)
    .map(Number)
    .sort((a, b) => a - b)
    .map((k) => [label, `規格 ${k}mm`, byStock[k]!, unit]);
}

/** 材料別合計(§24) */
export function materialTotalsCsv(agg: ProjectAggregate): string {
  const t = agg.totals;
  const rows: (string | number)[][] = [
    ["材料", "項目", "数量", "単位"],
    ["ベニヤ", "全判枚数", t.plywood.fullCount, "枚"],
    ["ベニヤ", "切断材枚数", t.plywood.cutCount, "枚"],
    ["ベニヤ", "合計枚数", t.plywood.totalCount, "枚"],
    ["ベニヤ", "使用面積", m2(t.plywood.usedArea), "m2"],
    ["ベニヤ", "端材面積(廃棄見込み)", m2(t.plywood.wasteArea), "m2"],
    ["桟木", "配置本数", t.batten.placedCount, "本"],
    ["桟木", "使用総延長", m(t.batten.totalUsedLength), "m"],
    ...stockRows("桟木", t.batten.byStockLength, "本"),
    ["桟木", "切断材本数", t.batten.cutPieceCount, "本"],
    ["鋼管", "必要本数", t.pipe.pieceCount, "本"],
    ["鋼管", "使用総延長", m(t.pipe.totalUsedLength), "m"],
    ...stockRows("鋼管", t.pipe.byStockLength, "本"),
    ["鋼管", "継ぎ箇所数", t.pipe.spliceCount, "箇所"],
    ["セパレーター", "合計本数", t.separator.totalCount, "本"],
    ...Object.keys(t.separator.byLength)
      .map(Number)
      .sort((a, b) => a - b)
      .map((k): (string | number)[] =>
        ["セパレーター", `長さ ${k}mm`, t.separator.byLength[k]!, "本"]),
    ["フォームタイ", "合計個数", t.formTie.totalCount, "個"],
    ["Pコン", "合計個数", t.pcon.totalCount, "個"],
    [],
    ["注意書き", DISCLAIMER],
  ];
  return toCsv(rows);
}

/** 構造部材別内訳 */
export function memberRowsCsv(agg: ProjectAggregate): string {
  const rows: (string | number)[][] = [
    ["部材ID", "種類", "面数", "型枠面積(m2)", "ベニヤ(枚)", "桟木(本)", "鋼管(本)",
      "セパ(本)", "フォームタイ(個)", "Pコン(個)"],
    ...agg.byMember.map((r): (string | number)[] => [
      r.memberId, KIND_LABEL[r.memberKind] ?? r.memberKind, r.faceCount, m2(r.netArea),
      r.plywoodTotal, r.battenCount, r.pipeCount, r.separatorCount, r.formTieCount, r.pconCount,
    ]),
  ];
  return toCsv(rows);
}

/** 脱型区分別内訳(§11。梁側と梁底は別行) */
export function strippingCsv(agg: ProjectAggregate): string {
  const rows: (string | number)[][] = [
    ["脱型区分", "カテゴリ", "面数", "面積(m2)", "ベニヤ(枚)", "桟木(本)", "鋼管(本)"],
    ...agg.byStrippingGroup.map((g): (string | number)[] => [
      g.group, CATEGORY_LABEL[g.category] ?? g.category,
      g.faceCount, m2(g.netArea), g.plywoodTotal, g.battenCount, g.pipeCount,
    ]),
  ];
  return toCsv(rows);
}

/** 型枠面別内訳+締結材ペア別内訳 */
export function faceDetailCsv(memberResults: MemberTakeoffResult[]): string {
  const rows: (string | number)[][] = [
    ["部材ID", "面ID", "面種類", "脱型区分", "幅(mm)", "高さ(mm)", "控除後面積(m2)",
      "ベニヤ全判", "ベニヤ切断", "桟木(本)", "桟木延長(m)", "鋼管(本)", "鋼管延長(m)"],
  ];
  for (const mr of memberResults) {
    for (const f of mr.faces) {
      rows.push([
        mr.memberId, f.faceId, f.faceType, f.strippingGroup, f.width, f.height, m2(f.netArea),
        f.plywood.fullCount, f.plywood.cutCount,
        f.batten.countTotal.rounded, m(f.batten.totalUsedLength),
        f.pipe.totalPieces.rounded, m(f.pipe.totalUsedLength),
      ]);
    }
  }
  rows.push([]);
  rows.push(["部材ID", "ペアID", "型枠間隔(mm)", "セパ本数", "セパ長さ(mm)",
    "フォームタイ(個)", "Pコン(個)"]);
  for (const mr of memberResults) {
    for (const p of mr.pairs) {
      rows.push([
        mr.memberId, p.pairId, p.formGap,
        p.separator.count.rounded, p.separator.length ?? "未確定",
        p.formTie.count.rounded, p.pcon.count.rounded,
      ]);
    }
  }
  return toCsv(rows);
}

/** 計算条件一覧(使用した入力値・規格・ピッチ。§25 の追跡性) */
export function conditionsCsv(project: Project): string {
  const mt = project.materials;
  const pitchDesc = (p: unknown): string => JSON.stringify(p);
  const rows: (string | number)[][] = [
    ["区分", "項目", "値"],
    ["プロジェクト", "名称", project.name],
    ["プロジェクト", "現場名", project.siteName ?? ""],
    ["プロジェクト", "工区", project.workSection ?? ""],
    ["プロジェクト", "打設区分", project.pourSection ?? ""],
    ["プロジェクト", "単位", project.unit],
    ["ベニヤ", "名称", mt.plywood.spec.name],
    ["ベニヤ", "幅×長さ×厚さ(mm)",
      `${mt.plywood.spec.width}×${mt.plywood.spec.length}×${mt.plywood.spec.thickness}`],
    ["ベニヤ", "向き", mt.plywood.orientation ?? mt.plywood.spec.defaultOrientation],
    ["ベニヤ", "目地", mt.plywood.spec.jointDirection],
    ["ベニヤ", "切断代(mm)", mt.plywood.spec.kerf],
    ["ベニヤ", "割付原点", mt.plywood.layoutOrigin ?? "bottom_left"],
    ["桟木", "名称", mt.batten.spec.name],
    ["桟木", "断面(mm)", `${mt.batten.spec.sectionWidth}×${mt.batten.spec.sectionDepth}`],
    ["桟木", "標準長さ(mm)", mt.batten.spec.stockLengths.join(" ")],
    ["桟木", "配置ピッチ", pitchDesc(mt.batten.pitch)],
    ["桟木", "型枠端部に配置", mt.batten.placeAtEnds ? "する" : "しない"],
    ["桟木", "ベニヤ継ぎ目に追加", mt.batten.extraAtPanelJoints ? "する" : "しない"],
    ["桟木", "最小使用長さ(mm)", mt.batten.spec.minUseLength],
    ["鋼管", "名称", mt.pipe.spec.name],
    ["鋼管", "形状", mt.pipe.spec.shape === "square" ? "角パイプ" : "丸パイプ"],
    ["鋼管", "断面(mm)",
      `${mt.pipe.spec.width}×${mt.pipe.spec.height}×t${mt.pipe.spec.wallThickness}`],
    ["鋼管", "標準長さ(mm)", mt.pipe.spec.stockLengths.join(" ")],
    ["鋼管", "一段当たり本数×列数", `${mt.pipe.spec.pipesPerLevel}×${mt.pipe.spec.lineCount}`],
    ["鋼管", "鉛直配置ピッチ", pitchDesc(mt.pipe.verticalPitch)],
    ["鋼管", "重ね長さ(mm)", mt.pipe.spec.lapLength],
    ["セパレーター", "名称", mt.separator.spec.name],
    ["セパレーター", "呼び径", mt.separator.spec.diameter],
    ["セパレーター", "長さの決定方法",
      mt.separator.manualLength !== undefined
        ? `手入力 ${mt.separator.manualLength}mm`
        : "型枠同士の間隔"],
    ...mt.separator.bands.map((b, i): (string | number)[] => [
      "セパレーター",
      `帯${i + 1} [${b.fromLevel}〜${b.toLevel}]`,
      `水平 ${pitchDesc(b.horizontalPitch)} / 鉛直ピッチ ${b.verticalPitch}`,
    ]),
    ["セパレーター", "最下段高さ/最上段離れ(mm)",
      `${mt.separator.edgeOffsets.bottom} / ${mt.separator.edgeOffsets.topClearance}`],
    ["フォームタイ", "名称", mt.formTie.spec.name],
    ["フォームタイ", "両面/片面の個数",
      `${mt.formTie.spec.countPerSideDouble} / ${mt.formTie.spec.countPerSideSingle}`],
    ["Pコン", "名称", mt.separator.pcon.name],
    ["Pコン", "片側当たり個数", mt.separator.pcon.countPerEnd],
    [],
    ["部材ID", "種類", "入力寸法"],
    ...project.members.map((mem): (string | number)[] => {
      const { kind, memberId, ...rest } = mem as unknown as Record<string, unknown> & {
        kind: string; memberId: string;
      };
      delete rest["placement"];
      return [memberId, KIND_LABEL[kind] ?? kind, JSON.stringify(rest)];
    }),
    [],
    ["注意書き", DISCLAIMER],
  ];
  return toCsv(rows);
}
