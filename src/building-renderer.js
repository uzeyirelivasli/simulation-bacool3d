import { centroid, pointInPolygon, signedArea } from './geometry-utils.js';

const Cesium = window.Cesium;
const ACCENT = Cesium.Color.fromCssColorString('#e6c867');

// Hər bina = bir sinxron Primitive (bir çəkiliş çağırışı). Silinəndə GPU resursları azad olunur.
export class BuildingRenderer {
  constructor(viewer, geo, config) {
    this.viewer = viewer;
    this.geo = geo;
    this.cfg = config.editor;
    this.collection = viewer.scene.primitives.add(new Cesium.PrimitiveCollection());
    this.items = new Map();
  }

  upsert(obj, selected = false) {
    this.remove(obj.id);
    if (obj.type !== 'building' || obj.visible === false) return;
    const primitive = this._build(obj, selected);
    if (!primitive) return;
    this.collection.add(primitive);
    this.items.set(obj.id, primitive);
  }

  remove(id) {
    const primitive = this.items.get(id);
    if (!primitive) return;
    this.collection.remove(primitive); // destroyPrimitives = true → resurslar azad olunur
    this.items.delete(id);
  }

  clear() {
    this.collection.removeAll();
    this.items.clear();
  }

  _build(obj, selected) {
    let ring = obj.geometry.ring;
    if (!Array.isArray(ring) || ring.length < 3) return null;
    let local = ring.map(([lon, lat]) => this.geo.lonLatToLocal(lon, lat));
    if (signedArea(local) < 0) {
      ring = [...ring].reverse();
      local = [...local].reverse();
    }

    const p = obj.props;
    const total = Math.min(Math.max(Number(p.height) || this.cfg.minHeightM, this.cfg.minHeightM), this.cfg.maxHeightM);
    const ground = this.geo.origin.height + (Number(obj.geometry.baseRel) || 0);
    const baseColor = Cesium.Color.fromCssColorString(p.color ?? '') ?? Cesium.Color.LIGHTGRAY;
    const wallColor = selected ? Cesium.Color.lerp(baseColor, ACCENT, 0.4, new Cesium.Color()) : baseColor;
    const roofColor = Cesium.Color.lerp(wallColor, Cesium.Color.BLACK, 0.14, new Cesium.Color());

    const vertexFormat = Cesium.PerInstanceColorAppearance.VERTEX_FORMAT;
    const colorAttr = (c) => ({ color: Cesium.ColorGeometryInstanceAttribute.fromColor(c) });
    const prism = (coords, bottom, top, color) =>
      new Cesium.GeometryInstance({
        id: obj.id,
        geometry: new Cesium.PolygonGeometry({
          polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(coords.flat())),
          height: bottom,
          extrudedHeight: top,
          vertexFormat,
        }),
        attributes: colorAttr(color),
      });

    const instances = [];
    const slab = 0.5; // dam zolağı
    const parts = Array.isArray(obj.geometry.parts) && obj.geometry.parts.length ? obj.geometry.parts : null;

    if (parts) {
      // Kataloq modeli: bir neçə pilləli həcm (podium + qüllə və s.). h0/h1 ümumi hündürlüyün payıdır.
      for (const part of parts) {
        if (!Array.isArray(part.ring) || part.ring.length < 3) continue;
        const z0 = ground + total * (Number(part.h0) || 0);
        const z1 = ground + total * Math.min(Math.max(Number(part.h1) || 1, 0), 1);
        if (z1 - z0 < 0.3) continue;
        const bottom = part.h0 > 0 ? z0 : z0 - this.cfg.baseSkirtM;
        const top = Math.max(z1 - slab, bottom + 0.1);
        instances.push(prism(part.ring, bottom, top, wallColor));
        instances.push(prism(part.ring, top, z1, roofColor));
      }
      if (p.roofStyle === 'pyramid' && parts.length === 1) {
        const c = centroid(local);
        const roofH = Math.min(8, Math.max(2, total * 0.45));
        if (pointInPolygon(c, local)) {
          instances.push(new Cesium.GeometryInstance({
            id: obj.id,
            geometry: this._pyramid(ring, c, ground + total, ground + total + roofH),
            attributes: colorAttr(roofColor),
          }));
        }
      }
    } else {
      const roofH = Math.min(8, Math.max(2, total * 0.22));
      const c = centroid(local);
      const pyramid = p.roofStyle === 'pyramid' && total - roofH >= 2.5 && pointInPolygon(c, local);
      const bottom = ground - this.cfg.baseSkirtM;
      if (pyramid) {
        const wallTop = ground + total - roofH;
        instances.push(prism(ring, bottom, wallTop, wallColor));
        instances.push(new Cesium.GeometryInstance({
          id: obj.id,
          geometry: this._pyramid(ring, c, wallTop, ground + total),
          attributes: colorAttr(roofColor),
        }));
      } else {
        instances.push(prism(ring, bottom, ground + total - slab, wallColor));
        instances.push(prism(ring, ground + total - slab, ground + total, roofColor));
      }
    }
    if (!instances.length) return null;

    return new Cesium.Primitive({
      geometryInstances: instances,
      appearance: new Cesium.PerInstanceColorAppearance({ translucent: false, closed: true }),
      asynchronous: false, // kiçik həndəsə: dərhal yenilənir, sayrışma olmur
      releaseGeometryInstances: true,
      shadows: Cesium.ShadowMode.ENABLED, // kölgə salır və qəbul edir
    });
  }

  // Kontur saat əqrəbinin əksinədir (yuxarıdan baxanda) → üzlər xaricə baxır.
  _pyramid(ring, c, baseHeight, apexHeight) {
    const apexLL = this.geo.localToLonLat(c.x, c.y, 0);
    const apex = Cesium.Cartesian3.fromDegrees(apexLL.longitude, apexLL.latitude, apexHeight);
    const corners = ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, baseHeight));
    const n = corners.length;
    const positions = new Float64Array(n * 9);
    const normals = new Float32Array(n * 9);
    const indices = new Uint16Array(n * 3);
    const ab = new Cesium.Cartesian3();
    const ac = new Cesium.Cartesian3();
    const nrm = new Cesium.Cartesian3();
    for (let i = 0; i < n; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % n];
      Cesium.Cartesian3.subtract(b, a, ab);
      Cesium.Cartesian3.subtract(apex, a, ac);
      Cesium.Cartesian3.cross(ab, ac, nrm);
      if (Cesium.Cartesian3.magnitudeSquared(nrm) > 0) Cesium.Cartesian3.normalize(nrm, nrm);
      [a, b, apex].forEach((v, k) => {
        const o = i * 9 + k * 3;
        positions[o] = v.x; positions[o + 1] = v.y; positions[o + 2] = v.z;
        normals[o] = nrm.x; normals[o + 1] = nrm.y; normals[o + 2] = nrm.z;
        indices[i * 3 + k] = i * 3 + k;
      });
    }
    return new Cesium.Geometry({
      attributes: {
        position: new Cesium.GeometryAttribute({
          componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: positions,
        }),
        normal: new Cesium.GeometryAttribute({
          componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: normals,
        }),
      },
      indices,
      primitiveType: Cesium.PrimitiveType.TRIANGLES,
      boundingSphere: Cesium.BoundingSphere.fromVertices(positions),
    });
  }
}