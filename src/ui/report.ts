// 印刷用帳票(設計書 §23 ステップ10 の PDF 出力)。
// 印刷用HTMLを別ウィンドウに生成し、ブラウザの「PDFに保存」で出力する。
// 日本語フォントはブラウザ印刷が扱うため、フォント埋め込みは不要。

import type { ProjectAggregate } from "../core/aggregate.js";
import type { Project } from "../core/project.js";
import { faceLayoutSvg } from "../core/svg.js";
import { DISCLAIMER, type MemberTakeoffResult } from "../core/takeoff.js";

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

const m2 = (mm2: number) => (mm2 / 1e6).toFixed(2);
const mtr = (mm: number) => (mm / 1000).toFixed(2);

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function table(headers: string[], rows: (string | number)[][]): string {
  return (
    `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>` +
    rows
      .map((r) => `<tr>${r.map((c, i) =>
        `<td class="${i === 0 ? "l" : ""}">${typeof c === "string" ? esc(c) : c}</td>`).join("")}</tr>`)
      .join("") +
    "</tbody></table>"
  );
}

function stockText(rec: Record<number, number>): string {
  const keys = Object.keys(rec).map(Number).sort((a, b) => a - b);
  return keys.length === 0 ? "-" : keys.map((k) => `${k}mm×${rec[k]}`).join(", ");
}

export function buildReportHtml(
  project: Project,
  memberResults: MemberTakeoffResult[],
  agg: ProjectAggregate,
): string {
  const t = agg.totals;
  const today = new Date().toLocaleDateString("ja-JP");

  let body = `
<h1>型枠材料拾い出し 数量表</h1>
<p class="meta">プロジェクト: ${esc(project.name)}
 / 現場: ${esc(project.siteName ?? "-")}
 / 工区: ${esc(project.workSection ?? "-")}
 / 打設区分: ${esc(project.pourSection ?? "-")}
 / 出力日: ${today}</p>
<p class="disclaimer">${esc(DISCLAIMER)}</p>

<h2>1. 材料別合計</h2>`;
  body += table(
    ["材料", "数量", "内訳・規格別"],
    [
      [`ベニヤ(${project.materials.plywood.spec.name})`, `${t.plywood.totalCount} 枚`,
        `全判 ${t.plywood.fullCount} / 切断 ${t.plywood.cutCount}、使用 ${m2(t.plywood.usedArea)}m²、端材 ${m2(t.plywood.wasteArea)}m²`],
      [`桟木(${project.materials.batten.spec.name})`, `${t.batten.placedCount} 本`,
        `総延長 ${mtr(t.batten.totalUsedLength)}m、規格別 ${stockText(t.batten.byStockLength)}、切断材 ${t.batten.cutPieceCount} 本`],
      [`鋼管(${project.materials.pipe.spec.name})`, `${t.pipe.pieceCount} 本`,
        `総延長 ${mtr(t.pipe.totalUsedLength)}m、規格別 ${stockText(t.pipe.byStockLength)}、継ぎ ${t.pipe.spliceCount} 箇所`],
      [`セパレーター(${project.materials.separator.spec.name})`, `${t.separator.totalCount} 本`,
        `長さ別 ${stockText(t.separator.byLength)}`],
      [`フォームタイ(${project.materials.formTie.spec.name})`, `${t.formTie.totalCount} 個`, "-"],
      [`Pコン(${project.materials.separator.pcon.name})`, `${t.pcon.totalCount} 個`, "-"],
    ],
  );

  body += "<h2>2. 構造部材別</h2>";
  body += table(
    ["部材", "種類", "面数", "面積(m²)", "ベニヤ", "桟木", "鋼管", "セパ", "Fタイ", "Pコン"],
    agg.byMember.map((r) => [
      r.memberId, KIND_LABEL[r.memberKind] ?? r.memberKind, r.faceCount, m2(r.netArea),
      r.plywoodTotal, r.battenCount, r.pipeCount, r.separatorCount, r.formTieCount, r.pconCount,
    ]),
  );

  body += "<h2>3. 脱型区分別(梁側と梁底は合算しない)</h2>";
  body += table(
    ["脱型区分", "区分", "面数", "面積(m²)", "ベニヤ", "桟木", "鋼管"],
    agg.byStrippingGroup.map((g) => [
      g.group, CATEGORY_LABEL[g.category] ?? g.category, g.faceCount, m2(g.netArea),
      g.plywoodTotal, g.battenCount, g.pipeCount,
    ]),
  );

  body += "<h2>4. 板割図</h2>";
  for (const mr of memberResults) {
    for (const f of mr.faces) {
      const pair = mr.pairs.find((p) => p.faceIdA === f.faceId);
      body += `<div class="fig">` + faceLayoutSvg(f, {
        widthPx: 700,
        separatorPoints: pair?.separator.points,
        battenSectionWidth: project.materials.batten.spec.sectionWidth,
        pipeHeight: project.materials.pipe.spec.height,
      }) + `</div>`;
    }
  }

  body += "<h2>5. 計算条件</h2>";
  const mt = project.materials;
  body += table(
    ["区分", "内容"],
    [
      ["ベニヤ", `${mt.plywood.spec.name} ${mt.plywood.spec.width}×${mt.plywood.spec.length}×t${mt.plywood.spec.thickness}、` +
        `${(mt.plywood.orientation ?? mt.plywood.spec.defaultOrientation) === "vertical" ? "縦使い" : "横使い"}、切断代 ${mt.plywood.spec.kerf}`],
      ["桟木", `${mt.batten.spec.name} ${mt.batten.spec.sectionWidth}×${mt.batten.spec.sectionDepth}、` +
        `規格長 ${mt.batten.spec.stockLengths.join("/")}、ピッチ ${JSON.stringify(mt.batten.pitch)}`],
      ["鋼管", `${mt.pipe.spec.name} ${mt.pipe.spec.width}×${mt.pipe.spec.height}×t${mt.pipe.spec.wallThickness}、` +
        `規格長 ${mt.pipe.spec.stockLengths.join("/")}、鉛直ピッチ ${JSON.stringify(mt.pipe.verticalPitch)}、重ね ${mt.pipe.spec.lapLength}`],
      ["セパレーター", `${mt.separator.spec.name}(${mt.separator.spec.diameter})、長さ = ` +
        `${mt.separator.manualLength !== undefined ? `手入力 ${mt.separator.manualLength}mm` : "型枠同士の間隔"}、` +
        `帯 ${JSON.stringify(mt.separator.bands.map((b) => ({ 範囲: [b.fromLevel, b.toLevel], 水平: b.horizontalPitch.pitch, 鉛直: b.verticalPitch })))}`],
      ["フォームタイ", `${mt.formTie.spec.name} 両面 ${mt.formTie.spec.countPerSideDouble}/片面 ${mt.formTie.spec.countPerSideSingle} 個/セパ`],
      ["Pコン", `${mt.separator.pcon.name} 片側 ${mt.separator.pcon.countPerEnd} 個`],
      ["勝ち負け設定", Object.keys(project.junctionPolicies ?? {}).length === 0
        ? "標準(自動判定)のみ"
        : JSON.stringify(project.junctionPolicies)],
    ],
  );

  body += `<p class="disclaimer">${esc(DISCLAIMER)}</p>`;

  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><title>${esc(project.name)} 型枠数量表</title>
<style>
  body { font-family: "Hiragino Sans", "Noto Sans JP", Meiryo, sans-serif;
    font-size: 11px; color: #111; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 13px; margin: 18px 0 6px; border-left: 4px solid #1a5fb4; padding-left: 6px; }
  .meta { color: #444; margin: 0 0 8px; }
  .disclaimer { border: 1px solid #999; padding: 6px 8px; background: #f5f5f5; }
  table { border-collapse: collapse; width: 100%; margin: 4px 0 10px; }
  th, td { border: 1px solid #999; padding: 3px 6px; text-align: right; }
  th { background: #eef2f6; text-align: center; }
  td.l { text-align: left; }
  .fig { page-break-inside: avoid; margin: 8px 0; }
  .noprint { margin: 12px 0; }
  @media print { .noprint { display: none; } }
</style></head><body>
<div class="noprint"><button onclick="window.print()">印刷 / PDFに保存</button>
  <span>ブラウザの印刷ダイアログで「PDFに保存」を選択してください</span></div>
${body}
</body></html>`;
}
