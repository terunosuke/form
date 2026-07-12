import type { FaceTakeoff } from "./takeoff.js";

// 板割図・配置図のSVG生成(設計書 §23 ステップ10)。
// 型枠面1面につき1枚。ベニヤ割付(全判/切断材)、桟木位置、鋼管段、
// セパレーター位置、控除領域を実寸比で描く。

export interface FaceSvgOptions {
  /** 図の横幅(px)。高さは面の縦横比から決まる */
  widthPx?: number;
  showBattens?: boolean;
  showPipes?: boolean;
  /** 対向面ペアのセパ格子(面ローカルUV) */
  separatorPoints?: { u: number; v: number }[];
  battenSectionWidth?: number; // 桟木断面幅(mm)
  pipeHeight?: number; // 鋼管高さ(mm)
}

function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function faceLayoutSvg(face: FaceTakeoff, opts: FaceSvgOptions = {}): string {
  const W = face.width;
  const H = face.height;
  if (W <= 0 || H <= 0) return "<svg xmlns='http://www.w3.org/2000/svg'/>";
  const widthPx = opts.widthPx ?? 760;
  const margin = { top: 34, left: 58, right: 16, bottom: 30 };
  const s = (widthPx - margin.left - margin.right) / W;
  const bodyH = H * s;
  const totalW = widthPx;
  const totalH = margin.top + bodyH + margin.bottom;

  // 面ローカル(u右, v上・原点左下)→ SVG(y下向き)
  const X = (u: number) => margin.left + u * s;
  const Y = (v: number) => margin.top + bodyH - v * s;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH.toFixed(0)}" ` +
    `viewBox="0 0 ${totalW} ${totalH.toFixed(0)}" font-family="sans-serif">`,
  );
  parts.push(
    `<defs><pattern id="hatch-${face.faceId}" width="8" height="8" ` +
    `patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<line x1="0" y1="0" x2="0" y2="8" stroke="#999" stroke-width="1.5"/></pattern></defs>`,
  );
  parts.push(`<rect width="${totalW}" height="${totalH.toFixed(0)}" fill="#fff"/>`);

  // タイトル・寸法
  parts.push(
    `<text x="${margin.left}" y="16" font-size="13" fill="#222">` +
    `${escXml(face.faceId)}(${escXml(face.faceType)} / 脱型区分 ${escXml(face.strippingGroup)})</text>`,
  );
  parts.push(
    `<text x="${(margin.left + widthPx - margin.right) / 2}" y="${totalH - 8}" ` +
    `font-size="11" fill="#333" text-anchor="middle">${W}</text>`,
  );
  parts.push(
    `<text x="14" y="${margin.top + bodyH / 2}" font-size="11" fill="#333" ` +
    `text-anchor="middle" transform="rotate(-90 14 ${margin.top + bodyH / 2})">${H}</text>`,
  );

  // ベニヤ(全判 = 薄黄、切断材 = 濃いめ+寸法表示)
  for (const p of face.plywood.placements) {
    const x = X(p.positionUV.u);
    const y = Y(p.positionUV.v + p.cutLength);
    const w = p.cutWidth * s;
    const h = p.cutLength * s;
    const fill = p.fullOrCut === "full" ? "#f7ecd4" : "#f4cf95";
    parts.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" ` +
      `height="${h.toFixed(1)}" fill="${fill}" stroke="#b8892f" stroke-width="1"/>`,
    );
    if (p.fullOrCut === "cut" && w > 44 && h > 14) {
      parts.push(
        `<text x="${(x + w / 2).toFixed(1)}" y="${(y + h / 2).toFixed(1)}" font-size="10" ` +
        `fill="#7a5c14" text-anchor="middle" dominant-baseline="middle">` +
        `${p.cutWidth}×${p.cutLength}</text>`,
      );
    }
  }

  // 控除領域(斜線ハッチ)
  for (const d of face.deductions) {
    parts.push(
      `<rect x="${X(d.u).toFixed(1)}" y="${Y(d.v + d.h).toFixed(1)}" ` +
      `width="${(d.w * s).toFixed(1)}" height="${(d.h * s).toFixed(1)}" ` +
      `fill="url(#hatch-${face.faceId})" stroke="#888" stroke-width="1"/>`,
    );
  }

  // 桟木(縦材)
  if (opts.showBattens !== false) {
    const bw = Math.max((opts.battenSectionWidth ?? 30) * s, 1.5);
    for (const b of face.batten.placements) {
      let v0 = 0;
      for (const seg of b.segments) {
        parts.push(
          `<rect x="${(X(b.positionU) - bw / 2).toFixed(1)}" ` +
          `y="${Y(v0 + seg.lengthNeeded).toFixed(1)}" width="${bw.toFixed(1)}" ` +
          `height="${(seg.lengthNeeded * s).toFixed(1)}" fill="#8a5a2b" opacity="0.55"/>`,
        );
        v0 += seg.lengthNeeded;
      }
    }
  }

  // 鋼管(水平段)
  if (opts.showPipes !== false) {
    const ph = Math.max((opts.pipeHeight ?? 50) * s, 1.5);
    for (const level of face.pipe.levels) {
      parts.push(
        `<rect x="${X(0).toFixed(1)}" y="${(Y(level.levelV) - ph / 2).toFixed(1)}" ` +
        `width="${(W * s).toFixed(1)}" height="${ph.toFixed(1)}" fill="#4a6f8a" opacity="0.55"/>`,
      );
    }
  }

  // セパレーター(格子点)
  for (const pt of opts.separatorPoints ?? []) {
    parts.push(
      `<circle cx="${X(pt.u).toFixed(1)}" cy="${Y(pt.v).toFixed(1)}" r="3.5" ` +
      `fill="#d33e3e" stroke="#fff" stroke-width="1"/>`,
    );
  }

  // 面外形(最前面)
  parts.push(
    `<rect x="${X(0)}" y="${Y(H).toFixed(1)}" width="${(W * s).toFixed(1)}" ` +
    `height="${bodyH.toFixed(1)}" fill="none" stroke="#222" stroke-width="1.5"/>`,
  );

  parts.push("</svg>");
  return parts.join("");
}
