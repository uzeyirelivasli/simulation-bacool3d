import { BuildingRenderer } from './building-renderer.js';
import { SurfaceRenderer } from './surface-renderer.js';
import { TreeRenderer } from './tree-renderer.js';
import { pointInPolygon, signedArea } from './geometry-utils.js';

const TAU = Math.PI * 2;

// Təkrarlana bilən təsadüfi ədədlər: eyni "seed" → eyni ağac düzülüşü.
function mulberry32(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distToPolyline(p, pts, closed) {
  let best = Infinity;
  const n = pts.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
    t = Math.min(Math.max(t, 0), 1);
    const d = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
    if (d < best) best = d;
  }
  return best;
}

const pickVariant = (v, r) => (v === 'mixed' ? (r < 0.7 ? 'round' : 'cypress') : v === 'cypress' ? 'cypress' : 'round');
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// Mərkəzi model → səhnə. Binalar, səthlər və ağaclar üçün renderləri birləşdirir.
export class ObjectLayer {
  constructor(viewer, geo, config, mode) {
    this.viewer = viewer;
    this.geo = geo;
    this.cfg = config.editor;
    this.buildings = new BuildingRenderer(viewer, geo, config);
    this.surfaces = new SurfaceRenderer(viewer, geo, config, mode);
    this.trees = new TreeRenderer(viewer, geo);
    this.records = new Map(); // id → { obj, selected }
    this._looseDirty = false;
    this._parkTimer = null;
  }

  upsert(obj, selected = false) {
    const prev = this.records.get(obj.id);
    const changed = prev?.obj !== obj; // yalnız seçim dəyişibsə ağacları yenidən qurmuruq
    this.records.set(obj.id, { obj, selected });
    if (obj.type === 'building') {
      this.buildings.upsert(obj, selected);
    } else if (obj.type === 'park') {
      this.surfaces.upsert(obj, selected);
      if (changed) this._parkTrees(obj);
    } else if (obj.type === 'path') {
      this.surfaces.upsert(obj, selected);
      if (changed) {
        this._pathTrees(obj);
        this._scheduleParkRefresh();
      }
    } else if (obj.type === 'tree') {
      this._markLoose();
    }
  }

  remove(id) {
    const rec = this.records.get(id);
    if (!rec) return;
    this.records.delete(id);
    const { type } = rec.obj;
    if (type === 'building') this.buildings.remove(id);
    if (type === 'park' || type === 'path') {
      this.surfaces.remove(id);
      this.trees.removeGroup(id);
    }
    if (type === 'path') this._scheduleParkRefresh();
    if (type === 'tree') this._markLoose();
  }

  // Öz 3D həndəsəmiz (yer hündürlüyü ölçülərkən nəzərə alınmamalıdır).
  solidPrimitives() {
    return [...this.buildings.items.values(), ...this.trees.groups.values()];
  }

  clear() {
    this.records.clear();
    this.buildings.clear();
    this.surfaces.clear();
    this.trees.clear();
  }

  // ---- Tək ağaclar ----
  _markLoose() {
    if (this._looseDirty) return;
    this._looseDirty = true;
    queueMicrotask(() => {
      this._looseDirty = false;
      const items = [];
      for (const { obj, selected } of this.records.values()) {
        if (obj.type !== 'tree') continue;
        const [lon, lat] = obj.geometry.point;
        const p = this.geo.lonLatToLocal(lon, lat);
        const rng = mulberry32(obj.props.seed);
        items.push({
          id: obj.id,
          selected,
          tree: {
            x: p.x, y: p.y, z: Number(obj.geometry.z) || 0,
            h: clamp(Number(obj.props.height) || this.cfg.defaultTreeHeightM, 2, 30),
            variant: obj.props.variant, yaw: rng() * TAU, tint: Math.floor(rng() * 3), w: 0.85 + rng() * 0.3,
          },
        });
      }
      this.trees.setLoose(items);
      this.viewer.scene.requestRender();
    });
  }

  // ---- Park ağacları (sıxlığa görə səpələnmə) ----
  _parkTrees(obj) {
    const p = obj.props;
    const density = clamp(Number(p.treeDensity) || 0, 0, 20); // ağac / 1000 m²
    const pts = this._local(obj.geometry.ring, obj.geometry.zs);
    const area = Math.abs(signedArea(pts));
    const cap = this.cfg.maxTreesPerGroup;
    const target = Math.min((area * density) / 1000, cap);
    if (target < 1) return this.trees.removeGroup(obj.id);

    const s = Math.sqrt(area / target);
    const H = clamp(Number(p.treeHeight) || this.cfg.defaultTreeHeightM, 2, 30);
    const xs = pts.map((q) => q.x);
    const ys = pts.map((q) => q.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const obstacles = this._pathObstacles();
    const rng = mulberry32(p.seed);
    const trees = [];
    outer: for (let gy = minY + s / 2; gy < maxY; gy += s) {
      for (let gx = minX + s / 2; gx < maxX; gx += s) {
        // Təsadüfi ədədlər həmişə eyni sırada götürülür ki, düzülüş sabit qalsın.
        const [jx, jy, rh, rv, ryaw, rt] = [rng(), rng(), rng(), rng(), rng(), rng()];
        const pt = { x: gx + (jx - 0.5) * 0.8 * s, y: gy + (jy - 0.5) * 0.8 * s };
        if (!pointInPolygon(pt, pts)) continue;
        if (distToPolyline(pt, pts, true) < 1) continue;
        if (obstacles.some((o) => distToPolyline(pt, o.pts, false) < o.half)) continue; // cığırın üstündə ağac olmasın
        trees.push({
          x: pt.x, y: pt.y, z: this._idw(pt, pts),
          h: H * (0.75 + 0.5 * rh), variant: pickVariant(p.treeVariant, rv),
          yaw: ryaw * TAU, tint: Math.floor(rt * 3), w: 0.85 + 0.3 * jy,
        });
        if (trees.length >= cap) break outer;
      }
    }
    this.trees.setGroup(obj.id, trees, obj.id);
  }

  // ---- Yol boyunca ağac cərgələri ----
  _pathTrees(obj) {
    const p = obj.props;
    const sides =
      p.pathType === 'treerow' ? [0] : p.treeRow === 'left' ? [1] : p.treeRow === 'right' ? [-1] : p.treeRow === 'both' ? [1, -1] : [];
    if (!sides.length) return this.trees.removeGroup(obj.id);

    const pts = this._local(obj.geometry.line, obj.geometry.zs);
    const spacing = clamp(Number(p.treeSpacing) || 8, 2, 60);
    const H = clamp(Number(p.treeHeight) || this.cfg.defaultTreeHeightM, 2, 30);
    const offset = (Number(p.width) || 0) / 2 + 1.2;
    const cap = this.cfg.maxTreesPerGroup;
    const rng = mulberry32(p.seed);
    const trees = [];
    for (const side of sides) {
      let next = spacing / 2;
      let walked = 0;
      for (let i = 0; i < pts.length - 1 && trees.length < cap; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 1e-6) continue;
        const ux = (b.x - a.x) / len;
        const uy = (b.y - a.y) / len;
        while (next <= walked + len && trees.length < cap) {
          const t = (next - walked) / len;
          const [rh, rv, ryaw, rt] = [rng(), rng(), rng(), rng()];
          trees.push({
            x: a.x + (b.x - a.x) * t - uy * offset * side,
            y: a.y + (b.y - a.y) * t + ux * offset * side,
            z: a.z + (b.z - a.z) * t,
            h: H * (0.88 + 0.24 * rh), variant: pickVariant(p.treeVariant, rv),
            yaw: ryaw * TAU, tint: Math.floor(rt * 3), w: 0.9 + 0.2 * rv,
          });
          next += spacing;
        }
        walked += len;
      }
    }
    this.trees.setGroup(obj.id, trees, obj.id);
  }

  _scheduleParkRefresh() {
    clearTimeout(this._parkTimer);
    this._parkTimer = setTimeout(() => {
      for (const { obj } of this.records.values()) if (obj.type === 'park') this._parkTrees(obj);
      this.viewer.scene.requestRender();
    }, 150);
  }

  _pathObstacles() {
    const out = [];
    for (const { obj } of this.records.values()) {
      if (obj.type !== 'path' || obj.props.pathType === 'treerow') continue;
      out.push({ half: (Number(obj.props.width) || 0) / 2 + 0.8, pts: this._local(obj.geometry.line, obj.geometry.zs) });
    }
    return out;
  }

  _local(coords, zs) {
    return coords.map(([lon, lat], i) => {
      const p = this.geo.lonLatToLocal(lon, lat);
      return { x: p.x, y: p.y, z: Number(zs?.[i]) || 0 };
    });
  }

  // Künc nöqtələrinin hündürlüyündən interpolyasiya (hər ağac üçün səhnəni ölçmək bahalıdır).
  _idw(pt, pts) {
    let sw = 0;
    let sz = 0;
    for (const q of pts) {
      const w = 1 / ((pt.x - q.x) ** 2 + (pt.y - q.y) ** 2 + 1);
      sw += w;
      sz += w * q.z;
    }
    return sw ? sz / sw : 0;
  }
}