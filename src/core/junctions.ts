import type { MemberInput } from "./project.js";
import type { Rect } from "./types.js";
import { EPS, fix } from "./types.js";

// 取り合い(勝ち負け)・重複控除(設計書 §10・§21)。
// 平面配置から次の重なりを自動検出する。
//   柱×壁 / 柱×梁: 標準は柱勝ち(壁・梁側から控除)
//   壁×壁:         標準は先に登録した壁が通し(後の壁から控除)
//   梁×スラブ:     標準は梁勝ち(スラブ底から梁の通過範囲を控除)
// ユーザーは候補ごとに「控除する(標準)/両方計上(控除しない)」を選択できる。
// 壁×梁の重ね(§7)は同一位置の併存を許すため控除対象にしない。

export type JunctionPolicy = "deduct" | "count_both";

export interface JunctionCandidate {
  id: string; // 例 "C1~W1"
  kind: "column_wall" | "column_beam" | "wall_wall" | "beam_slab";
  winnerId: string; // 勝ち側(通し)
  loserId: string; // 負け側(控除される側)
  /** 負け側が壁・梁のとき: 軸に沿った控除範囲(mm、部材始点基準) */
  uRange?: [number, number];
  /** 負け側が壁・梁のとき: 下端基準の高さ範囲(mm) */
  vRange?: [number, number];
  /** 負け側がスラブ底のとき: スラブ底面UV上の控除領域 */
  region?: Rect;
  defaultPolicy: JunctionPolicy;
  description: string;
}

interface Seg {
  x: number; y: number; dx: number; dy: number; len: number; z: number; h: number;
}

interface ORect {
  x: number; y: number; angleDeg: number; w: number; d: number;
}

function axisSeg(m: MemberInput): Seg | null {
  if (!m.placement) return null; // 平面未配置の部材は検出対象外
  if (m.kind !== "wall" && m.kind !== "beam") return null;
  const rad = (m.placement.angleDeg * Math.PI) / 180;
  const z = m.placement.z ?? 0;
  const h = m.kind === "wall" ? m.height : m.depth;
  return {
    x: m.placement.x, y: m.placement.y,
    dx: Math.cos(rad), dy: Math.sin(rad),
    len: m.length, z, h,
  };
}

/** 壁・梁の平面フットプリント(軸振り分けの回転矩形) */
function footprintRect(m: MemberInput): ORect | null {
  if (!m.placement) return null;
  if (m.kind === "wall" || m.kind === "beam") {
    const wid = m.kind === "wall" ? m.thickness : m.width;
    const rad = (m.placement.angleDeg * Math.PI) / 180;
    // 原点 = 始点から幅方向に -wid/2 ずらした角
    const vx = -Math.sin(rad);
    const vy = Math.cos(rad);
    return {
      x: m.placement.x - vx * (wid / 2),
      y: m.placement.y - vy * (wid / 2),
      angleDeg: m.placement.angleDeg,
      w: m.length,
      d: wid,
    };
  }
  if (m.kind === "column") {
    return {
      x: m.placement.x, y: m.placement.y, angleDeg: m.placement.angleDeg,
      w: m.width, d: m.depth,
    };
  }
  if (m.kind === "slab") {
    return {
      x: m.placement.x, y: m.placement.y, angleDeg: m.placement.angleDeg,
      w: m.lengthX, d: m.lengthY,
    };
  }
  return null;
}

function toLocal(rect: ORect, x: number, y: number): [number, number] {
  const rad = (-rect.angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const tx = x - rect.x;
  const ty = y - rect.y;
  return [tx * cos - ty * sin, tx * sin + ty * cos];
}

/** 軸線分を回転矩形でクリップし、軸パラメータ範囲(mm)を返す(Liang–Barsky) */
function clipSegByRect(seg: Seg, rect: ORect): [number, number] | null {
  const [px, py] = toLocal(rect, seg.x, seg.y);
  const [qx, qy] = toLocal(rect, seg.x + seg.dx * seg.len, seg.y + seg.dy * seg.len);
  const dx = qx - px;
  const dy = qy - py;
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
  if (!clip(-dx, px)) return null;
  if (!clip(dx, rect.w - px)) return null;
  if (!clip(-dy, py)) return null;
  if (!clip(dy, rect.d - py)) return null;
  if (t1 - t0 < EPS) return null;
  return [fix(t0 * seg.len), fix(t1 * seg.len)];
}

/** 高さ範囲の重なり(部材下端基準)。10mm 未満は null */
function heightOverlap(
  segZ: number, segH: number, otherZ: number, otherH: number,
): [number, number] | null {
  const v0 = Math.max(0, otherZ - segZ);
  const v1 = Math.min(segH, otherZ + otherH - segZ);
  if (v1 - v0 < 10) return null;
  return [fix(v0), fix(v1)];
}

const KIND_JA: Record<string, string> = {
  wall: "壁", beam: "梁", column: "柱", slab: "スラブ", footing: "フーチング",
};

function axisCandidate(
  kind: JunctionCandidate["kind"],
  winner: MemberInput, loser: MemberInput,
  uRange: [number, number], vRange: [number, number],
): JunctionCandidate {
  return {
    id: `${winner.memberId}~${loser.memberId}`,
    kind,
    winnerId: winner.memberId,
    loserId: loser.memberId,
    uRange,
    vRange,
    defaultPolicy: "deduct",
    description:
      `${winner.memberId}(${KIND_JA[winner.kind]})と ${loser.memberId}(${KIND_JA[loser.kind]})が重なっています: ` +
      `${loser.memberId} の軸方向 ${uRange[0]}〜${uRange[1]}mm × 高さ ${vRange[0]}〜${vRange[1]}mm`,
  };
}

export function detectJunctions(members: MemberInput[]): JunctionCandidate[] {
  const out: JunctionCandidate[] = [];

  // ---- 柱×壁・柱×梁(柱勝ち) ----
  for (const col of members) {
    if (col.kind !== "column" || !col.placement) continue;
    const colRect = footprintRect(col)!;
    const colZ = col.placement.z ?? 0;
    for (const m of members) {
      const seg = axisSeg(m);
      if (!seg) continue;
      const range = clipSegByRect(seg, colRect);
      if (!range || range[1] - range[0] < 10) continue;
      const vr = heightOverlap(seg.z, seg.h, colZ, col.height);
      if (!vr) continue;
      out.push(axisCandidate(
        m.kind === "wall" ? "column_wall" : "column_beam", col, m, range, vr,
      ));
    }
  }

  // ---- 壁×壁(先に登録した壁が通し) ----
  const walls = members.filter(
    (m): m is Extract<MemberInput, { kind: "wall" }> => m.kind === "wall" && !!m.placement,
  );
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const winner = walls[i]!;
      const loser = walls[j]!;
      const seg = axisSeg(loser)!;
      const range = clipSegByRect(seg, footprintRect(winner)!);
      if (!range || range[1] - range[0] < 10) continue;
      const vr = heightOverlap(
        seg.z, seg.h, winner.placement!.z ?? 0, winner.height,
      );
      if (!vr) continue;
      out.push(axisCandidate("wall_wall", winner, loser, range, vr));
    }
  }

  // ---- 梁×スラブ(梁勝ち: スラブ底から梁の通過範囲を控除) ----
  for (const slab of members) {
    if (slab.kind !== "slab" || !slab.placement || !slab.bottomForm) continue;
    const slabRect = footprintRect(slab)!;
    const slabZ = slab.placement.z ?? 0;
    for (const beam of members) {
      if (beam.kind !== "beam" || !beam.placement) continue;
      const beamZ = beam.placement.z ?? 0;
      // スラブ底が梁の高さ範囲(±50mm)に接している場合のみ
      if (slabZ < beamZ - 50 || slabZ > beamZ + beam.depth + 50) continue;
      // 梁フットプリントの4隅をスラブローカルへ → 外接矩形をスラブ矩形でクリップ
      const bf = footprintRect(beam)!;
      const rad = (bf.angleDeg * Math.PI) / 180;
      const ux = Math.cos(rad);
      const uy = Math.sin(rad);
      const vx = -uy;
      const vy = ux;
      const cornersW: [number, number][] = [
        [bf.x, bf.y],
        [bf.x + ux * bf.w, bf.y + uy * bf.w],
        [bf.x + ux * bf.w + vx * bf.d, bf.y + uy * bf.w + vy * bf.d],
        [bf.x + vx * bf.d, bf.y + vy * bf.d],
      ];
      const local = cornersW.map(([x, y]) => toLocal(slabRect, x, y));
      const u0 = Math.max(0, Math.min(...local.map((p) => p[0])));
      const u1 = Math.min(slabRect.w, Math.max(...local.map((p) => p[0])));
      const v0 = Math.max(0, Math.min(...local.map((p) => p[1])));
      const v1 = Math.min(slabRect.d, Math.max(...local.map((p) => p[1])));
      if (u1 - u0 < 10 || v1 - v0 < 10) continue;
      out.push({
        id: `${beam.memberId}~${slab.memberId}`,
        kind: "beam_slab",
        winnerId: beam.memberId,
        loserId: slab.memberId,
        region: { u: fix(u0), v: fix(v0), w: fix(u1 - u0), h: fix(v1 - v0) },
        defaultPolicy: "deduct",
        description:
          `${beam.memberId}(梁)と ${slab.memberId}(スラブ底)が重なっています: ` +
          `スラブ底 X ${fix(u0)}〜${fix(u1)}mm × Y ${fix(v0)}〜${fix(v1)}mm` +
          `(梁が斜め配置の場合は外接矩形で控除)`,
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
    const m = byId.get(c.loserId);
    if (!m) continue;
    if ((m.kind === "wall" || m.kind === "beam") && c.uRange && c.vRange) {
      const region: Rect = {
        u: c.uRange[0],
        v: c.vRange[0],
        w: fix(c.uRange[1] - c.uRange[0]),
        h: fix(c.vRange[1] - c.vRange[0]),
      };
      if (m.kind === "wall") {
        m.deductionsA = [...(m.deductionsA ?? []), region];
        m.deductionsB = [...(m.deductionsB ?? []), region];
      } else {
        m.deductionsLeft = [...(m.deductionsLeft ?? []), region];
        m.deductionsRight = [...(m.deductionsRight ?? []), region];
      }
    } else if (m.kind === "slab" && c.region) {
      m.deductionsBottom = [...(m.deductionsBottom ?? []), c.region];
    }
  }
  return cloned;
}
