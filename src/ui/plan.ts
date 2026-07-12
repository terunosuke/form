// 2D平面配置ビュー(設計書 §23 ステップ3〜4 の先行実装)。
// 部材の作図(壁・梁 = 2点、柱・スラブ・フーチング = 対角2点)、選択、移動を行う。
// 平面配置(placement)は表示・作図用であり、数量計算には影響しない。

import type { MemberInput, PlanPlacement, Underlay } from "../core/project.js";

export interface PlanApi {
  redraw(): void;
  /** 縮尺設定モード開始(次の2クリックを計測点として扱う) */
  startScaleCalibration(): void;
}

export interface UnderlayView extends Underlay {
  img: HTMLImageElement;
}

export interface PlanOptions {
  canvas: HTMLCanvasElement;
  modeSelect: HTMLSelectElement;
  getMembers(): MemberInput[];
  /** 作図完了時に部材を追加する(main 側でカード再描画) */
  addMember(m: MemberInput): void;
  /** 種類ごとの既定値付き部材を生成する(main 側の連番管理を使う) */
  createMember(kind: MemberInput["kind"]): MemberInput;
  /** 選択変更(カードのハイライト用)。null = 選択解除 */
  onSelect(index: number | null): void;
  /** 下敷き画像(なければ null) */
  getUnderlay?(): UnderlayView | null;
  /** 縮尺計測の2点が確定したとき(world mm) */
  onScalePoints?(p1: Point, p2: Point): void;
}

type Mode = "select" | MemberInput["kind"];

const SNAP = 50; // 作図スナップ (mm)
const COLORS: Record<MemberInput["kind"], string> = {
  wall: "#1a5fb4",
  column: "#b3261e",
  beam: "#9a6700",
  slab: "#5f6b7a",
  footing: "#6b21a8",
};

interface Point {
  x: number;
  y: number;
}

export function initPlan(opts: PlanOptions): PlanApi {
  const { canvas } = opts;
  const ctx = canvas.getContext("2d")!;

  // ビュー状態: world(mm) → screen(px)
  let scale = 0.06;
  let panX = -500; // 画面左上の world 座標
  let panY = -500;

  let firstPoint: Point | null = null; // 2点作図の1点目
  let cursor: Point | null = null;
  let scaleMode = false; // 縮尺計測モード
  let scalePoint: Point | null = null; // 計測1点目(スナップなしの生座標)
  let selected: number | null = null;
  let dragging: { index: number; offsetX: number; offsetY: number } | null = null;
  let panning: { startX: number; startY: number; panX0: number; panY0: number } | null = null;

  function mode(): Mode {
    return opts.modeSelect.value as Mode;
  }

  function toWorld(e: MouseEvent): Point {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / scale + panX,
      y: (e.clientY - r.top) / scale + panY,
    };
  }
  function snap(p: Point): Point {
    return { x: Math.round(p.x / SNAP) * SNAP, y: Math.round(p.y / SNAP) * SNAP };
  }
  function sx(wx: number): number {
    return (wx - panX) * scale;
  }
  function sy(wy: number): number {
    return (wy - panY) * scale;
  }

  /** 保存済み配置、なければ表示用の自動配置(保存しない) */
  function placementOf(m: MemberInput, index: number): PlanPlacement & { auto: boolean } {
    if (m.placement) return { ...m.placement, auto: false };
    return { x: 0, y: 5000 + index * 3000, angleDeg: 0, auto: true };
  }

  /** 部材の平面フットプリント(回転前のローカル寸法と基準点の扱い) */
  function footprint(m: MemberInput): { len: number; wid: number; axisBased: boolean } {
    switch (m.kind) {
      case "wall":
        return { len: m.length, wid: m.thickness, axisBased: true };
      case "beam":
        return { len: m.length, wid: m.width, axisBased: true };
      case "column":
        return { len: m.width, wid: m.depth, axisBased: false };
      case "slab":
        return { len: m.lengthX, wid: m.lengthY, axisBased: false };
      case "footing":
        return { len: m.width, wid: m.depth, axisBased: false };
    }
  }

  /** 回転を含む外形4頂点(world)。axisBased は始点から軸方向、その他は角基準 */
  function corners(m: MemberInput, index: number): Point[] {
    const pl = placementOf(m, index);
    const f = footprint(m);
    const rad = (pl.angleDeg * Math.PI) / 180;
    const ux = Math.cos(rad);
    const uy = Math.sin(rad);
    const vx = -uy;
    const vy = ux;
    if (f.axisBased) {
      // 軸線 = 始点から len。幅 wid は軸に対して振り分け
      const hw = f.wid / 2;
      return [
        { x: pl.x + vx * hw, y: pl.y + vy * hw },
        { x: pl.x + ux * f.len + vx * hw, y: pl.y + uy * f.len + vy * hw },
        { x: pl.x + ux * f.len - vx * hw, y: pl.y + uy * f.len - vy * hw },
        { x: pl.x - vx * hw, y: pl.y - vy * hw },
      ];
    }
    return [
      { x: pl.x, y: pl.y },
      { x: pl.x + ux * f.len, y: pl.y + uy * f.len },
      { x: pl.x + ux * f.len + vx * f.wid, y: pl.y + uy * f.len + vy * f.wid },
      { x: pl.x + vx * f.wid, y: pl.y + vy * f.wid },
    ];
  }

  function pointInPolygon(p: Point, poly: Point[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!;
      const b = poly[j]!;
      if (a.y > p.y !== b.y > p.y &&
          p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
    return inside;
  }

  function hitTest(p: Point): number | null {
    const members = opts.getMembers();
    for (let i = members.length - 1; i >= 0; i--) {
      if (pointInPolygon(p, corners(members[i]!, i))) return i;
    }
    return null;
  }

  // ---------- 描画 ----------

  function drawGrid(): void {
    const w = canvas.width;
    const h = canvas.height;
    const step = 1000; // 1m グリッド
    const x0 = Math.floor(panX / step) * step;
    const y0 = Math.floor(panY / step) * step;
    for (let x = x0; sx(x) < w; x += step) {
      ctx.strokeStyle = x % 5000 === 0 ? "#c5cdd6" : "#e8ecf0";
      ctx.beginPath();
      ctx.moveTo(sx(x), 0);
      ctx.lineTo(sx(x), h);
      ctx.stroke();
    }
    for (let y = y0; sy(y) < h; y += step) {
      ctx.strokeStyle = y % 5000 === 0 ? "#c5cdd6" : "#e8ecf0";
      ctx.beginPath();
      ctx.moveTo(0, sy(y));
      ctx.lineTo(canvas.width, sy(y));
      ctx.stroke();
    }
    // 原点
    ctx.fillStyle = "#8a94a0";
    ctx.beginPath();
    ctx.arc(sx(0), sy(0), 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawMember(m: MemberInput, index: number): void {
    const pts = corners(m, index);
    const pl = placementOf(m, index);
    const color = COLORS[m.kind];
    ctx.beginPath();
    ctx.moveTo(sx(pts[0]!.x), sy(pts[0]!.y));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(sx(pts[i]!.x), sy(pts[i]!.y));
    ctx.closePath();
    ctx.fillStyle = color + (m.kind === "slab" ? "22" : "3a");
    ctx.fill();
    ctx.lineWidth = index === selected ? 3 : 1.5;
    ctx.strokeStyle = index === selected ? "#e01b24" : color;
    ctx.setLineDash(pl.auto ? [6, 4] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    // 軸線(壁・梁)
    const f = footprint(m);
    if (f.axisBased) {
      const rad = (pl.angleDeg * Math.PI) / 180;
      ctx.strokeStyle = color;
      ctx.setLineDash([10, 5]);
      ctx.beginPath();
      ctx.moveTo(sx(pl.x), sy(pl.y));
      ctx.lineTo(sx(pl.x + Math.cos(rad) * f.len), sy(pl.y + Math.sin(rad) * f.len));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // ラベル
    const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
    const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
    ctx.fillStyle = "#222";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(m.memberId + (pl.auto ? "(未配置)" : ""), sx(cx), sy(cy));
  }

  function drawPreview(): void {
    if (!firstPoint || !cursor) return;
    const p2 = snap(cursor);
    ctx.strokeStyle = "#e01b24";
    ctx.setLineDash([5, 5]);
    const md = mode();
    if (md === "wall" || md === "beam") {
      ctx.beginPath();
      ctx.moveTo(sx(firstPoint.x), sy(firstPoint.y));
      ctx.lineTo(sx(p2.x), sy(p2.y));
      ctx.stroke();
      const len = Math.round(Math.hypot(p2.x - firstPoint.x, p2.y - firstPoint.y));
      ctx.fillStyle = "#e01b24";
      ctx.font = "12px sans-serif";
      ctx.fillText(`${len}mm`, sx((firstPoint.x + p2.x) / 2), sy((firstPoint.y + p2.y) / 2) - 6);
    } else {
      ctx.strokeRect(
        sx(Math.min(firstPoint.x, p2.x)),
        sy(Math.min(firstPoint.y, p2.y)),
        Math.abs(p2.x - firstPoint.x) * scale,
        Math.abs(p2.y - firstPoint.y) * scale,
      );
    }
    ctx.setLineDash([]);
  }

  function drawUnderlay(): void {
    const ul = opts.getUnderlay?.();
    if (!ul) return;
    ctx.save();
    ctx.globalAlpha = ul.opacity;
    ctx.drawImage(
      ul.img,
      sx(ul.offsetX),
      sy(ul.offsetY),
      ul.img.width * ul.mmPerPx * scale,
      ul.img.height * ul.mmPerPx * scale,
    );
    ctx.restore();
  }

  function drawScaleMarkers(): void {
    if (!scaleMode) return;
    ctx.fillStyle = "#e01b24";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(
      scalePoint === null ? "縮尺計測: 1点目をクリック" : "縮尺計測: 2点目をクリック",
      8, 16,
    );
    if (scalePoint) {
      ctx.beginPath();
      ctx.arc(sx(scalePoint.x), sy(scalePoint.y), 5, 0, Math.PI * 2);
      ctx.fill();
      if (cursor) {
        ctx.strokeStyle = "#e01b24";
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(sx(scalePoint.x), sy(scalePoint.y));
        ctx.lineTo(sx(cursor.x), sy(cursor.y));
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  function redraw(): void {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fbfcfd";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawUnderlay();
    drawGrid();
    const members = opts.getMembers();
    // 面もの(スラブ・フーチング)を先に、線もの・柱を後に描く
    const order = [...members.keys()].sort((a, b) => {
      const za = members[a]!.kind === "slab" || members[a]!.kind === "footing" ? 0 : 1;
      const zb = members[b]!.kind === "slab" || members[b]!.kind === "footing" ? 0 : 1;
      return za - zb;
    });
    for (const i of order) drawMember(members[i]!, i);
    drawPreview();
    drawScaleMarkers();
    // スケール表示
    ctx.fillStyle = "#666";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`グリッド1m / 表示倍率 ${(scale * 1000).toFixed(0)}px/m`, 8, canvas.height - 8);
  }

  // ---------- 作図・操作 ----------

  function finishDraw(p2raw: Point): void {
    const md = mode();
    if (md === "select" || !firstPoint) return;
    const p1 = firstPoint;
    const p2 = snap(p2raw);
    firstPoint = null;

    if (md === "wall" || md === "beam") {
      const len = Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y) / SNAP) * SNAP;
      if (len < 100) return; // 短すぎる線は無視
      const angleDeg = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
      const m = opts.createMember(md);
      if (m.kind === "wall") m.length = len;
      if (m.kind === "beam") m.length = len;
      m.placement = { x: p1.x, y: p1.y, angleDeg: Math.round(angleDeg * 10) / 10 };
      opts.addMember(m);
      return;
    }

    const w = Math.abs(p2.x - p1.x);
    const h = Math.abs(p2.y - p1.y);
    if (w < 100 || h < 100) return;
    const m = opts.createMember(md);
    if (m.kind === "column") {
      m.width = w;
      m.depth = h;
    } else if (m.kind === "slab") {
      m.lengthX = w;
      m.lengthY = h;
    } else if (m.kind === "footing") {
      m.width = w;
      m.depth = h;
    }
    m.placement = { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), angleDeg: 0 };
    opts.addMember(m);
  }

  canvas.addEventListener("mousedown", (e) => {
    const p = toWorld(e);
    if (e.button === 1 || e.button === 2) {
      panning = { startX: e.clientX, startY: e.clientY, panX0: panX, panY0: panY };
      e.preventDefault();
      return;
    }
    if (scaleMode) {
      // 縮尺計測はスナップせず生座標で拾う
      if (scalePoint === null) {
        scalePoint = p;
      } else {
        const p1 = scalePoint;
        scaleMode = false;
        scalePoint = null;
        opts.onScalePoints?.(p1, p);
      }
      redraw();
      return;
    }
    if (mode() === "select") {
      const hit = hitTest(p);
      selected = hit;
      opts.onSelect(hit);
      if (hit !== null) {
        const members = opts.getMembers();
        const m = members[hit]!;
        const pl = placementOf(m, hit);
        dragging = { index: hit, offsetX: p.x - pl.x, offsetY: p.y - pl.y };
      } else {
        panning = { startX: e.clientX, startY: e.clientY, panX0: panX, panY0: panY };
      }
      redraw();
      return;
    }
    // 作図モード
    if (firstPoint === null) {
      firstPoint = snap(p);
    } else {
      finishDraw(p);
    }
    redraw();
  });

  canvas.addEventListener("mousemove", (e) => {
    cursor = toWorld(e);
    if (panning) {
      panX = panning.panX0 - (e.clientX - panning.startX) / scale;
      panY = panning.panY0 - (e.clientY - panning.startY) / scale;
      redraw();
      return;
    }
    if (dragging) {
      const members = opts.getMembers();
      const m = members[dragging.index]!;
      const nx = Math.round((cursor.x - dragging.offsetX) / SNAP) * SNAP;
      const ny = Math.round((cursor.y - dragging.offsetY) / SNAP) * SNAP;
      const prev = m.placement ?? placementOf(m, dragging.index);
      m.placement = { x: nx, y: ny, angleDeg: prev.angleDeg };
      redraw();
      return;
    }
    if (firstPoint || (scaleMode && scalePoint)) redraw();
  });

  window.addEventListener("mouseup", () => {
    dragging = null;
    panning = null;
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const wx = mx / scale + panX;
    const wy = my / scale + panY;
    scale *= Math.exp(-e.deltaY * 0.001);
    scale = Math.min(1, Math.max(0.005, scale));
    panX = wx - mx / scale;
    panY = wy - my / scale;
    redraw();
  }, { passive: false });

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      firstPoint = null;
      scaleMode = false;
      scalePoint = null;
      redraw();
    }
  });

  opts.modeSelect.addEventListener("change", () => {
    firstPoint = null;
    redraw();
  });

  redraw();
  return {
    redraw,
    startScaleCalibration() {
      scaleMode = true;
      scalePoint = null;
      firstPoint = null;
      redraw();
    },
  };
}
