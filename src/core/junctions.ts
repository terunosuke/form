import type { MemberInput } from "./project.js";
import type { Rect } from "./types.js";
import { EPS, fix } from "./types.js";

// 取り合い(勝ち負け)・重複控除(設計書 §10・§21)。
// 初期版は「柱×壁」「柱×梁」を平面配置から自動検出する。
// 標準は柱勝ち(壁・梁側の面から柱と重なる範囲を控除)。ユーザーは
// 候補ごとに「柱勝ち(控除)/両方計上(控除しない)」を選択できる。
// 壁×壁・壁×梁・梁×スラブなどの自動検出は将来対応。

export type JunctionPolicy = "deduct" | "count_both";

export interface JunctionCandidate {
  id: string; // 例 "C1~W1"
  kind: "column_wall" | "column_beam";
  columnId: string;
  /** 控除される側(壁または梁) */
  memberId: string;
  /** 部材軸に沿った重なり範囲(mm、部材始点基準) */
  uRange: [number, number];
  /** 部材下端基準の高さ範囲(mm) */
  vRange: [number, number];
  defaultPolicy: JunctionPolicy; // 標準: 柱勝ち = deduct
  description: string;
}

interface Seg {
  x: number; y: number; dx: number; dy: number; len: number; z: number; h: number;
}

function axisSeg(m: MemberInput): Seg | null {
  if (!m.placement) return null; // 平面未配置の部材は検出対象外
  if (m.kind !== "wall" && m.kind !== "beam") return null;
  const rad = (m.placement.angleDeg * Math.PI) / 180;
  const len = m.length;
  const z = m.placement.z ?? 0;
  const h = m.kind === "wall" ? m.height : m.depth;
  return {
    x: m.placement.x, y: m.placement.y,
    dx: Math.cos(rad), dy: Math.sin(rad),
    len, z, h,
  };
}

/** 軸線分を柱の回転矩形でクリップし、軸パラメータ範囲(mm)を返す */
function clipByColumn(
  seg: Seg,
  col: { x: number; y: number; angleDeg: number; w: number; d: number },
): [number, number] | null {
  // 柱ローカル座標へ(柱の角を原点、X: 0..w, Y: 0..d)
  const rad = (-col.angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const toLocal = (x: number, y: number): [number, number] => {
    const tx = x - col.x;
    const ty = y - col.y;
    return [tx * cos - ty * sin, tx * sin + ty * cos];
  };
  const [px, py] = toLocal(seg.x, seg.y);
  const [qx, qy] = toLocal(seg.x + seg.dx * seg.len, seg.y + seg.dy * seg.len);
  const dx = qx - px;
  const dy = qy - py;
  // Liang–Barsky
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < EPS) return q >= -EPS;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-dx, px - 0)) return null;
  if (!clip(dx, col.w - px)) return null;
  if (!clip(-dy, py - 0)) return null;
  if (!clip(dy, col.d - py)) return null;
  if (t1 - t0 < EPS) return null;
  return [fix(t0 * seg.len), fix(t1 * seg.len)];
}

export function detectJunctions(members: MemberInput[]): JunctionCandidate[] {
  const out: JunctionCandidate[] = [];
  const columns = members.filter(
    (m): m is Extract<MemberInput, { kind: "column" }> => m.kind === "column" && !!m.placement,
  );
  for (const col of columns) {
    const colZ = col.placement!.z ?? 0;
    for (const m of members) {
      const seg = axisSeg(m);
      if (!seg) continue;
      const range = clipByColumn(seg, {
        x: col.placement!.x, y: col.placement!.y, angleDeg: col.placement!.angleDeg,
        w: col.width, d: col.depth,
      });
      if (!range) continue;
      if (range[1] - range[0] < 10) continue; // 10mm 未満の重なりは無視
      // 高さ範囲の重なり(部材下端基準)
      const v0 = Math.max(0, colZ - seg.z);
      const v1 = Math.min(seg.h, colZ + col.height - seg.z);
      if (v1 - v0 < 10) continue;
      out.push({
        id: `${col.memberId}~${m.memberId}`,
        kind: m.kind === "wall" ? "column_wall" : "column_beam",
        columnId: col.memberId,
        memberId: m.memberId,
        uRange: range,
        vRange: [fix(v0), fix(v1)],
        defaultPolicy: "deduct",
        description:
          `${col.memberId}(柱)と ${m.memberId}(${m.kind === "wall" ? "壁" : "梁"})が重なっています: ` +
          `軸方向 ${range[0]}〜${range[1]}mm × 高さ ${fix(v0)}〜${fix(v1)}mm`,
      });
    }
  }
  return out;
}

/**
 * 勝ち負けの決定に従い、控除領域を部材入力に注入した複製を返す。
 * 元の members は変更しない(§26: 形状を維持したまま再計算)。
 */
export function applyJunctions(
  members: MemberInput[],
  candidates: JunctionCandidate[],
  policies: Record<string, JunctionPolicy>,
): MemberInput[] {
  const cloned = members.map((m) => structuredClone(m));
  const byId = new Map(cloned.map((m) => [m.memberId, m]));
  for (const c of candidates) {
    const policy = policies[c.id] ?? c.defaultPolicy;
    if (policy !== "deduct") continue; // 両方計上 = 控除しない
    const m = byId.get(c.memberId);
    if (!m) continue;
    const region: Rect = {
      u: c.uRange[0],
      v: c.vRange[0],
      w: fix(c.uRange[1] - c.uRange[0]),
      h: fix(c.vRange[1] - c.vRange[0]),
    };
    if (m.kind === "wall") {
      m.deductionsA = [...(m.deductionsA ?? []), region];
      m.deductionsB = [...(m.deductionsB ?? []), region];
    } else if (m.kind === "beam") {
      m.deductionsLeft = [...(m.deductionsLeft ?? []), region];
      m.deductionsRight = [...(m.deductionsRight ?? []), region];
    }
  }
  return cloned;
}
