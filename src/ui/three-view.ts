// 3D確認画面(設計書 §17・§23 ステップ8)。
// 拾い出し結果(型枠面+材料割付)を、部材の平面配置から3D空間に再構成して表示する。
// 材料別(躯体/ベニヤ/桟木/鋼管/セパレーター)の表示切替に対応。
// 表示は確認用であり、数量はエンジンの計算結果をそのまま使う。

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { MemberInput, ProjectRunResult, Project } from "../core/project.js";
import type { FaceTakeoff, MemberTakeoffResult, TakeoffFaceType } from "../core/takeoff.js";

export type LayerName = "concrete" | "plywood" | "batten" | "pipe" | "separator";

export interface ThreeViewApi {
  update(project: Project, run: ProjectRunResult): void;
  setLayerVisible(layer: LayerName, visible: boolean): void;
}

interface Frame {
  origin: THREE.Vector3; // 面の左下(コンクリート表面)
  u: THREE.Vector3; // 幅方向(単位ベクトル)
  v: THREE.Vector3; // 高さ方向
  n: THREE.Vector3; // 外向き法線
}

const COLORS = {
  concrete: 0xb0b7bd,
  plywood: 0xcaa472,
  batten: 0x8a5a2b,
  pipe: 0x4a6f8a,
  separator: 0xd33e3e,
};

function rot2(x: number, y: number, deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
}

/** 平面配置(XY, mm)。3Dでは X=東, Z=北(平面Yを反転せずZへ), Y=上 とする */
function v3(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, z, y); // (平面x, 高さ, 平面y)
}

function placementOf(m: MemberInput, index: number): { x: number; y: number; angleDeg: number } {
  return m.placement ?? { x: 0, y: 5000 + index * 3000, angleDeg: 0 };
}

/** 部材と面種類から、面のローカル座標系(mm)を求める */
function faceFrame(m: MemberInput, index: number, faceType: TakeoffFaceType): Frame | null {
  const pl = placementOf(m, index);
  const dir = (dx: number, dy: number): THREE.Vector3 => {
    const [x, y] = rot2(dx, dy, pl.angleDeg);
    return v3(x, y, 0);
  };
  const P = (lx: number, ly: number, z: number): THREE.Vector3 => {
    const [x, y] = rot2(lx, ly, pl.angleDeg);
    return v3(pl.x + x, pl.y + y, z);
  };
  const UP = new THREE.Vector3(0, 1, 0);
  const DOWN = new THREE.Vector3(0, -1, 0);

  switch (m.kind) {
    case "wall": {
      const t = m.thickness;
      if (faceType === "wall_side_A") {
        return { origin: P(0, t / 2, 0), u: dir(1, 0), v: UP, n: dir(0, 1) };
      }
      if (faceType === "wall_side_B") {
        return { origin: P(0, -t / 2, 0), u: dir(1, 0), v: UP, n: dir(0, -1) };
      }
      return null;
    }
    case "column": {
      // 配置は角基準: ローカルX 0..width, ローカルY 0..depth
      const w = m.width;
      const d = m.depth;
      switch (faceType) {
        case "column_side_1": // Y- 面(幅 = width)
          return { origin: P(0, 0, 0), u: dir(1, 0), v: UP, n: dir(0, -1) };
        case "column_side_3": // Y+ 面
          return { origin: P(0, d, 0), u: dir(1, 0), v: UP, n: dir(0, 1) };
        case "column_side_2": // X+ 面(幅 = depth)
          return { origin: P(w, 0, 0), u: dir(0, 1), v: UP, n: dir(1, 0) };
        case "column_side_4": // X- 面
          return { origin: P(0, 0, 0), u: dir(0, 1), v: UP, n: dir(-1, 0) };
        default:
          return null;
      }
    }
    case "beam": {
      const w = m.width;
      switch (faceType) {
        case "beam_side_left":
          return { origin: P(0, w / 2, 0), u: dir(1, 0), v: UP, n: dir(0, 1) };
        case "beam_side_right":
          return { origin: P(0, -w / 2, 0), u: dir(1, 0), v: UP, n: dir(0, -1) };
        case "beam_bottom":
          // U = 梁長さ方向, V = 幅方向, 外向き = 下
          return { origin: P(0, -w / 2, 0), u: dir(1, 0), v: dir(0, 1), n: DOWN };
        default:
          return null; // 梁端部の3D表示は将来対応
      }
    }
    case "slab": {
      const lx = m.lengthX;
      const ly = m.lengthY;
      switch (faceType) {
        case "slab_bottom":
          return { origin: P(0, 0, 0), u: dir(1, 0), v: dir(0, 1), n: DOWN };
        case "slab_edge_1":
          return { origin: P(0, 0, 0), u: dir(0, 1), v: UP, n: dir(-1, 0) };
        case "slab_edge_2":
          return { origin: P(lx, 0, 0), u: dir(0, 1), v: UP, n: dir(1, 0) };
        case "slab_edge_3":
          return { origin: P(0, 0, 0), u: dir(1, 0), v: UP, n: dir(0, -1) };
        case "slab_edge_4":
          return { origin: P(0, ly, 0), u: dir(1, 0), v: UP, n: dir(0, 1) };
        default:
          return null;
      }
    }
    case "footing": {
      const w = m.width;
      const d = m.depth;
      switch (faceType) {
        case "footing_side_1":
          return { origin: P(0, 0, 0), u: dir(0, 1), v: UP, n: dir(-1, 0) };
        case "footing_side_2":
          return { origin: P(w, 0, 0), u: dir(0, 1), v: UP, n: dir(1, 0) };
        case "footing_side_3":
          return { origin: P(0, 0, 0), u: dir(1, 0), v: UP, n: dir(0, -1) };
        case "footing_side_4":
          return { origin: P(0, d, 0), u: dir(1, 0), v: UP, n: dir(0, 1) };
        case "footing_bottom":
          return { origin: P(0, 0, 0), u: dir(1, 0), v: dir(0, 1), n: DOWN };
        default:
          return null;
      }
    }
  }
}

/** 面ローカル(u, v, n)座標の中心とサイズから箱メッシュを作る */
function boxOnFrame(
  frame: Frame,
  cu: number, cv: number, cn: number, // 中心(面ローカル)
  su: number, sv: number, sn: number, // サイズ
  material: THREE.Material,
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(su, sv, sn);
  const mesh = new THREE.Mesh(geo, material);
  const basis = new THREE.Matrix4().makeBasis(frame.u, frame.v, frame.n);
  mesh.setRotationFromMatrix(basis);
  mesh.position
    .copy(frame.origin)
    .addScaledVector(frame.u, cu)
    .addScaledVector(frame.v, cv)
    .addScaledVector(frame.n, cn);
  return mesh;
}

function concreteMesh(m: MemberInput, index: number, mat: THREE.Material): THREE.Mesh | null {
  const pl = placementOf(m, index);
  const box = (lx: number, ly: number, h: number, cx: number, cy: number): THREE.Mesh => {
    const geo = new THREE.BoxGeometry(lx, h, ly);
    const mesh = new THREE.Mesh(geo, mat);
    const [wx, wy] = rot2(cx, cy, pl.angleDeg);
    mesh.position.set(pl.x + wx, h / 2, pl.y + wy);
    mesh.rotation.y = (-pl.angleDeg * Math.PI) / 180;
    return mesh;
  };
  switch (m.kind) {
    case "wall":
      return box(m.length, m.thickness, m.height, m.length / 2, 0);
    case "column":
      return box(m.width, m.depth, m.height, m.width / 2, m.depth / 2);
    case "beam":
      return box(m.length, m.width, m.depth, m.length / 2, 0);
    case "slab":
      return box(m.lengthX, m.lengthY, m.thickness, m.lengthX / 2, m.lengthY / 2);
    case "footing":
      return box(m.width, m.depth, m.height, m.width / 2, m.depth / 2);
  }
}

export function initThreeView(container: HTMLElement): ThreeViewApi {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf2f4f7);
  const camera = new THREE.PerspectiveCamera(
    50, container.clientWidth / Math.max(container.clientHeight, 1), 10, 500000,
  );
  camera.position.set(8000, 7000, 12000);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(3000, 1500, 1000);
  controls.update();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(10000, 20000, 8000);
  scene.add(sun);
  const grid = new THREE.GridHelper(40000, 40, 0xc0c8d0, 0xe2e7ec);
  scene.add(grid);

  const layers: Record<LayerName, THREE.Group> = {
    concrete: new THREE.Group(),
    plywood: new THREE.Group(),
    batten: new THREE.Group(),
    pipe: new THREE.Group(),
    separator: new THREE.Group(),
  };
  for (const g of Object.values(layers)) scene.add(g);

  const mats = {
    concrete: new THREE.MeshLambertMaterial({
      color: COLORS.concrete, transparent: true, opacity: 0.35,
    }),
    plywood: new THREE.MeshLambertMaterial({ color: COLORS.plywood }),
    batten: new THREE.MeshLambertMaterial({ color: COLORS.batten }),
    pipe: new THREE.MeshLambertMaterial({ color: COLORS.pipe }),
    separator: new THREE.MeshLambertMaterial({ color: COLORS.separator }),
  };

  function clearGroup(g: THREE.Group): void {
    while (g.children.length > 0) {
      const c = g.children.pop()!;
      if (c instanceof THREE.Mesh) c.geometry.dispose();
    }
  }

  function addFaceMaterials(
    face: FaceTakeoff, frame: Frame,
    plyT: number, battenDepth: number, battenWidth: number,
    pipeW: number, pipeH: number,
  ): void {
    // ベニヤ(面ローカルUV → 3D)
    for (const p of face.plywood.placements) {
      layers.plywood.add(boxOnFrame(
        frame,
        p.positionUV.u + p.cutWidth / 2, p.positionUV.v + p.cutLength / 2, plyT / 2,
        Math.max(p.cutWidth - 4, 4), Math.max(p.cutLength - 4, 4), plyT,
        mats.plywood,
      ));
    }
    // 桟木(縦材。ベニヤの外側)
    for (const b of face.batten.placements) {
      let v0 = 0;
      for (const seg of b.segments) {
        layers.batten.add(boxOnFrame(
          frame,
          b.positionU, v0 + seg.lengthNeeded / 2, plyT + battenDepth / 2,
          battenWidth, Math.max(seg.lengthNeeded - 4, 4), battenDepth,
          mats.batten,
        ));
        v0 += seg.lengthNeeded;
      }
    }
    // 鋼管(水平材。桟木の外側)
    for (const level of face.pipe.levels) {
      layers.pipe.add(boxOnFrame(
        frame,
        face.width / 2, level.levelV, plyT + battenDepth + pipeH / 2,
        face.width, pipeH, pipeW,
        mats.pipe,
      ));
    }
  }

  function update(project: Project, run: ProjectRunResult): void {
    for (const g of Object.values(layers)) clearGroup(g);
    const plyT = project.materials.plywood.spec.thickness;
    const battenDepth = project.materials.batten.spec.sectionDepth;
    const battenWidth = project.materials.batten.spec.sectionWidth;
    const pipeW = project.materials.pipe.spec.width;
    const pipeH = project.materials.pipe.spec.height;

    const byId = new Map<string, { m: MemberInput; index: number }>();
    project.members.forEach((m, index) => byId.set(m.memberId, { m, index }));

    for (const mr of run.memberResults as MemberTakeoffResult[]) {
      const entry = byId.get(mr.memberId);
      if (!entry) continue;
      const concrete = concreteMesh(entry.m, entry.index, mats.concrete);
      if (concrete) layers.concrete.add(concrete);

      const frames = new Map<string, Frame>();
      for (const face of mr.faces) {
        const frame = faceFrame(entry.m, entry.index, face.faceType);
        if (!frame) continue;
        frames.set(face.faceId, frame);
        addFaceMaterials(face, frame, plyT, battenDepth, battenWidth, pipeW, pipeH);
      }
      // セパレーター(対向面ペア。面Aの表面から間隔分だけ貫通)
      for (const pair of mr.pairs) {
        const frame = frames.get(pair.faceIdA);
        if (!frame || pair.separator.points.length === 0) continue;
        for (const pt of pair.separator.points) {
          const geo = new THREE.CylinderGeometry(10, 10, pair.formGap + plyT * 2, 8);
          const mesh = new THREE.Mesh(geo, mats.separator);
          const q = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0), frame.n.clone(),
          );
          mesh.setRotationFromQuaternion(q);
          mesh.position
            .copy(frame.origin)
            .addScaledVector(frame.u, pt.u)
            .addScaledVector(frame.v, pt.v)
            .addScaledVector(frame.n, -(pair.formGap / 2));
          layers.separator.add(mesh);
        }
      }
    }
  }

  function setLayerVisible(layer: LayerName, visible: boolean): void {
    layers[layer].visible = visible;
  }

  function animate(): void {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener("resize", () => {
    camera.aspect = container.clientWidth / Math.max(container.clientHeight, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  return { update, setLayerVisible };
}
