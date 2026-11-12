const Cesium = window.Cesium;
const ACCENT = Cesium.Color.fromCssColorString('#e6c867');
const TRUNK_COLOR = Cesium.Color.fromCssColorString('#6b5340');
const CANOPY_COLORS = {
  round: ['#4f7d3a', '#5f8f45', '#6b9a3f'].map((c) => Cesium.Color.fromCssColorString(c)),
  cypress: ['#2f5a36', '#37663c', '#2b5230'].map((c) => Cesium.Color.fromCssColorString(c)),
};

// Profili ox ətrafında fırladaraq az poliqonlu forma yaradır. profile: [[radius, z], ...] aşağıdan yuxarı.
function lathe(profile, slices) {
  const P = profile.length;
  const pos = new Float32Array(P * slices * 3);
  const nrm = new Float32Array(P * slices * 3);
  for (let i = 0; i < P; i++) {
    const [r, z] = profile[i];
    const a = profile[Math.max(i - 1, 0)];
    const b = profile[Math.min(i + 1, P - 1)];
    let nr = b[1] - a[1];
    let nz = -(b[0] - a[0]);
    if (r === 0) { nr = 0; nz = i === 0 ? -1 : 1; }
    const len = Math.hypot(nr, nz) || 1;
    nr /= len;
    nz /= len;
    for (let j = 0; j < slices; j++) {
      const t = (j / slices) * Math.PI * 2;
      const o = (i * slices + j) * 3;
      pos[o] = r * Math.cos(t); pos[o + 1] = r * Math.sin(t); pos[o + 2] = z;
      nrm[o] = nr * Math.cos(t); nrm[o + 1] = nr * Math.sin(t); nrm[o + 2] = nz;
    }
  }
  const idx = [];
  for (let i = 0; i < P - 1; i++) {
    for (let j = 0; j < slices; j++) {
      const a = i * slices + j;
      const b = i * slices + ((j + 1) % slices);
      const c = (i + 1) * slices + ((j + 1) % slices);
      const d = (i + 1) * slices + j;
      idx.push(a, b, c, a, c, d);
    }
  }
  return { pos, nrm, idx: Uint16Array.from(idx), verts: P * slices };
}

const TRUNK = lathe([[1, 0], [0.75, 1]], 6);
const ROUND = lathe([[0, -1], [0.72, -0.62], [1, -0.05], [0.82, 0.55], [0, 1]], 7);
const CYPRESS = lathe([[0.45, 0], [1, 0.28], [0.72, 0.68], [0, 1]], 7);

// Çoxlu ağacı BİR həndəsəyə yazır (bir çəkiliş çağırışı).
class MeshBuilder {
  constructor(enuToFixed, vertexCount, indexCount) {
    this.E = enuToFixed;
    this.positions = new Float64Array(vertexCount * 3);
    this.normals = new Float32Array(vertexCount * 3);
    this.indices = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
    this.v = 0;
    this.i = 0;
  }

  add(tpl, tx, ty, tz, sxy, sz, yaw) {
    const { E, positions: P, normals: N } = this;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const base = this.v;
    for (let k = 0; k < tpl.verts; k++) {
      const o = k * 3;
      const px = tpl.pos[o] * sxy;
      const py = tpl.pos[o + 1] * sxy;
      const x = px * c - py * s + tx;
      const y = px * s + py * c + ty;
      const z = tpl.pos[o + 2] * sz + tz;
      const w = (base + k) * 3;
      P[w] = E[0] * x + E[4] * y + E[8] * z + E[12];
      P[w + 1] = E[1] * x + E[5] * y + E[9] * z + E[13];
      P[w + 2] = E[2] * x + E[6] * y + E[10] * z + E[14];
      let nx = tpl.nrm[o] / sxy;
      let ny = tpl.nrm[o + 1] / sxy;
      let nz = tpl.nrm[o + 2] / sz;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const rx = nx * c - ny * s;
      const ry = nx * s + ny * c;
      N[w] = E[0] * rx + E[4] * ry + E[8] * nz;
      N[w + 1] = E[1] * rx + E[5] * ry + E[9] * nz;
      N[w + 2] = E[2] * rx + E[6] * ry + E[10] * nz;
    }
    for (let q = 0; q < tpl.idx.length; q++) this.indices[this.i++] = base + tpl.idx[q];
    this.v += tpl.verts;
  }

  geometry() {
    return new Cesium.Geometry({
      attributes: {
        position: new Cesium.GeometryAttribute({
          componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: this.positions,
        }),
        normal: new Cesium.GeometryAttribute({
          componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: this.normals,
        }),
      },
      indices: this.indices,
      primitiveType: Cesium.PrimitiveType.TRIANGLES,
      boundingSphere: Cesium.BoundingSphere.fromVertices(this.positions),
    });
  }
}

// Ağac təsviri: { x, y, z (lokal ENU, m), h, variant: 'round'|'cypress', yaw, tint: 0..2, w: en əmsalı }
export class TreeRenderer {
  constructor(viewer, geo) {
    this.viewer = viewer;
    this.geo = geo;
    this.collection = viewer.scene.primitives.add(new Cesium.PrimitiveCollection());
    this.groups = new Map();
  }

  // Bir qrup (park səpələnməsi və ya yol cərgəsi) = bir Primitive; seçim üçün id = sahib obyekt.
  setGroup(key, trees, pickId) {
    this.removeGroup(key);
    if (!trees.length) return;
    this._add(key, this._instances(trees, pickId, false));
  }

  // Tək ağaclar: hamısı bir Primitive-də, amma hər biri ayrıca seçilə bilir.
  setLoose(items) {
    this.removeGroup('__loose');
    if (!items.length) return;
    this._add('__loose', items.flatMap((it) => this._instances([it.tree], it.id, it.selected)));
  }

  removeGroup(key) {
    const primitive = this.groups.get(key);
    if (!primitive) return;
    this.collection.remove(primitive);
    this.groups.delete(key);
  }

  clear() {
    this.collection.removeAll();
    this.groups.clear();
  }

  _add(key, instances) {
    const primitive = new Cesium.Primitive({
      geometryInstances: instances,
      appearance: new Cesium.PerInstanceColorAppearance({ translucent: false, closed: true }),
      asynchronous: false,
      releaseGeometryInstances: true,
      shadows: Cesium.ShadowMode.ENABLED,
    });
    this.collection.add(primitive);
    this.groups.set(key, primitive);
  }

  _instances(trees, id, selected) {
    const E = this.geo.enuToFixed;
    const tint = (c) => (selected ? Cesium.Color.lerp(c, ACCENT, 0.45, new Cesium.Color()) : c);
    const instance = (geometry, color) =>
      new Cesium.GeometryInstance({
        id,
        geometry,
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color) },
      });

    const trunk = new MeshBuilder(E, trees.length * TRUNK.verts, trees.length * TRUNK.idx.length);
    const buckets = new Map();
    for (const t of trees) {
      const variant = t.variant === 'cypress' ? 'cypress' : 'round';
      const radius = 0.025 * t.h + 0.06;
      const trunkH = (variant === 'cypress' ? 0.15 : 0.42) * t.h;
      trunk.add(TRUNK, t.x, t.y, t.z - 0.4, radius, trunkH + 0.4, t.yaw);
      const key = `${variant}:${t.tint % 3}`;
      if (!buckets.has(key)) buckets.set(key, { variant, color: CANOPY_COLORS[variant][t.tint % 3], list: [] });
      buckets.get(key).list.push(t);
    }

    const out = [instance(trunk.geometry(), TRUNK_COLOR)];
    for (const { variant, color, list } of buckets.values()) {
      const tpl = variant === 'cypress' ? CYPRESS : ROUND;
      const mesh = new MeshBuilder(E, list.length * tpl.verts, list.length * tpl.idx.length);
      for (const t of list) {
        if (variant === 'cypress') mesh.add(tpl, t.x, t.y, t.z + 0.1 * t.h, 0.11 * t.h * t.w, 0.9 * t.h, t.yaw);
        else mesh.add(tpl, t.x, t.y, t.z + 0.66 * t.h, 0.3 * t.h * t.w, 0.36 * t.h, t.yaw);
      }
      out.push(instance(mesh.geometry(), tint(color)));
    }
    return out;
  }
}