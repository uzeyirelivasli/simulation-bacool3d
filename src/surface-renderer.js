import { CITY_MODES, nudgeRender } from './city-environment.js';

const Cesium = window.Cesium;
const ACCENT = Cesium.Color.fromCssColorString('#e6c867');

// Parklar və yollar.
// Google / ion rejimləri: yer səthinə "örtülən" (classification) həndəsə — relyefə oturur.
// Açarsız OSM rejimi: yer düzdür, ona görə səthlər yerdən bir neçə santimetr yuxarıda adi həndəsə kimi
// çəkilir; bu halda binaların və ağacların kölgəsi parkın və yolun üzərində də görünür.
// Sıralama: park (1) → avtomobil yolu (2) → piyada yolları (3).
const FLAT_Z = { park: 0.12, road: 0.2, path: 0.26 };

export class SurfaceRenderer {
  constructor(viewer, geo, config, mode) {
    this.viewer = viewer;
    this.geo = geo;
    this.cfg = config.editor;
    this.flat = mode === CITY_MODES.OSM_DEV;
    this.classificationType =
      mode === CITY_MODES.GOOGLE ? Cesium.ClassificationType.CESIUM_3D_TILE : Cesium.ClassificationType.BOTH;
    this.ids = new Set();
    // Düz rejim: sinxron Primitive-lər (seçim və daşıma zamanı sayrışma olmur, dərhal seçilə bilir).
    this.flatCollection = this.flat ? viewer.scene.primitives.add(new Cesium.PrimitiveCollection()) : null;
    this.flatItems = new Map(); // obj.id → Primitive
    this.signatures = new Map(); // eid → həndəsə imzası (daşıma/fırlatmadan sonra yenidən qurmaq üçün)
  }

  upsert(obj, selected = false) {
    if (this.flat) return this._upsertFlat(obj, selected);
    const eid = `obj:${obj.id}`;
    const E = this.viewer.entities;
    const color = this._color(obj, selected);
    const signature = JSON.stringify(obj.geometry.ring ?? obj.geometry.line);
    let entity = E.getById(eid);
    if (entity && this.signatures.get(eid) !== signature) {
      E.remove(entity); // həndəsə dəyişib → yenidən qur
      this.ids.delete(eid);
      entity = undefined;
    }
    const ground = { classificationType: this.classificationType };

    if (obj.type === 'park') {
      if (!entity) {
        E.add({
          id: eid,
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(obj.geometry.ring.flat())),
            material: color,
            ...ground,
            zIndex: 1,
          },
        });
        this.ids.add(eid);
      } else {
        entity.polygon.material = color;
      }
    } else if (obj.type === 'path') {
      const width = Number(obj.props.width) || 0;
      const drawable = obj.props.pathType !== 'treerow' && width > 0;
      const zIndex = obj.props.pathType === 'road' ? 2 : 3;
      if (!drawable) {
        if (entity) { E.remove(entity); this.ids.delete(eid); }
      } else if (!entity) {
        E.add({
          id: eid,
          corridor: {
            positions: Cesium.Cartesian3.fromDegreesArray(obj.geometry.line.flat()),
            width,
            material: color,
            cornerType: Cesium.CornerType.ROUNDED,
            ...ground,
            zIndex,
          },
        });
        this.ids.add(eid);
      } else {
        entity.corridor.width = width;
        entity.corridor.material = color;
        entity.corridor.zIndex = zIndex;
      }
    }
    this.signatures.set(eid, signature);
    nudgeRender(this.viewer.scene, 1500, 250); // yer həndəsəsi asinxron qurulur
  }

  _upsertFlat(obj, selected) {
    this._removeFlat(obj.id);
    const base = this.geo.origin.height;
    const vertexFormat = Cesium.PerInstanceColorAppearance.VERTEX_FORMAT;
    let geometry = null;
    if (obj.type === 'park') {
      geometry = new Cesium.PolygonGeometry({
        polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(obj.geometry.ring.flat())),
        height: base + FLAT_Z.park,
        vertexFormat,
      });
    } else if (obj.type === 'path') {
      const width = Number(obj.props.width) || 0;
      if (obj.props.pathType !== 'treerow' && width > 0) {
        geometry = new Cesium.CorridorGeometry({
          positions: Cesium.Cartesian3.fromDegreesArray(obj.geometry.line.flat()),
          width,
          height: base + (obj.props.pathType === 'road' ? FLAT_Z.road : FLAT_Z.path),
          cornerType: Cesium.CornerType.ROUNDED,
          vertexFormat,
        });
      }
    }
    if (geometry) {
      const primitive = new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({
          id: obj.id,
          geometry,
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(this._color(obj, selected)) },
        }),
        appearance: new Cesium.PerInstanceColorAppearance({ translucent: false, closed: false }),
        asynchronous: false,
        releaseGeometryInstances: true,
        shadows: Cesium.ShadowMode.RECEIVE_ONLY, // bina və ağac kölgələri səthin üzərində görünür
      });
      this.flatCollection.add(primitive);
      this.flatItems.set(obj.id, primitive);
    }
    this.viewer.scene.requestRender();
  }

  _removeFlat(id) {
    const primitive = this.flatItems.get(id);
    if (!primitive) return;
    this.flatCollection.remove(primitive);
    this.flatItems.delete(id);
  }

  remove(id) {
    if (this.flat) {
      this._removeFlat(id);
      this.viewer.scene.requestRender();
      return;
    }
    const eid = `obj:${id}`;
    if (!this.ids.has(eid)) return;
    this.viewer.entities.removeById(eid);
    this.ids.delete(eid);
    this.signatures.delete(eid);
    this.viewer.scene.requestRender();
  }

  clear() {
    if (this.flat) {
      this.flatCollection.removeAll();
      this.flatItems.clear();
      return;
    }
    for (const eid of this.ids) this.viewer.entities.removeById(eid);
    this.ids.clear();
    this.signatures.clear();
  }

  _color(obj, selected) {
    const css = (s, fallback) => Cesium.Color.fromCssColorString(s ?? '') ?? Cesium.Color.fromCssColorString(fallback);
    let color;
    let alpha;
    if (obj.type === 'park') {
      const base = css(this.cfg.parkSurfaces[obj.props.surface]?.color, '#8a7a5c');
      const grass = css(this.cfg.grassColor, '#5c8a45');
      const t = Math.min(Math.max((Number(obj.props.grassCoverage) || 0) / 100, 0), 1);
      color = Cesium.Color.lerp(base, grass, t, new Cesium.Color());
      alpha = this.flat ? 1 : 0.85; // düz rejimdə qeyri-şəffaf → kölgə qəbul edir
    } else {
      color = css(obj.props.color, '#b9b2a3');
      alpha = this.flat ? 1 : 0.93;
    }
    if (selected) color = Cesium.Color.lerp(color, ACCENT, 0.4, new Cesium.Color());
    return color.withAlpha(alpha);
  }
}