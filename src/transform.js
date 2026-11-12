// Obyekt həndəsəsinin çevrilmələri: daşıma, fırlatma, miqyas. Koordinatlar [lon, lat] kimi saxlanır,
// hesablamalar isə lokal ENU müstəvisində (metr) aparılır.
import { centroid } from './geometry-utils.js';
import { modelRing, rotatePoint } from './catalog.js';

const round7 = (v) => Math.round(v * 1e7) / 1e7;
const round2 = (v) => Math.round(v * 100) / 100;

export const toLocal = (geo, coords) =>
  coords.map(([lon, lat]) => {
    const p = geo.lonLatToLocal(lon, lat);
    return { x: p.x, y: p.y };
  });

const toLonLat = (geo, p) => {
  const ll = geo.localToLonLat(p.x, p.y, 0);
  return [round7(ll.longitude), round7(ll.latitude)];
};

// Obyektin "mərkəzi" (fırlatma və miqyas oxu).
export function geometryCenter(geo, geometry) {
  if (geometry.ring) return centroid(toLocal(geo, geometry.ring));
  if (geometry.line) {
    const pts = toLocal(geo, geometry.line);
    return { x: pts.reduce((s, q) => s + q.x, 0) / pts.length, y: pts.reduce((s, q) => s + q.y, 0) / pts.length };
  }
  const [lon, lat] = geometry.point;
  const p = geo.lonLatToLocal(lon, lat);
  return { x: p.x, y: p.y };
}

// fn: ({x, y}) → {x, y}. Yeni həndəsə obyekti qaytarır (orijinal dəyişmir).
export function mapGeometry(geo, geometry, fn) {
  const conv = (coords) => toLocal(geo, coords).map((q) => toLonLat(geo, fn(q)));
  const out = { ...geometry };
  if (geometry.ring) out.ring = conv(geometry.ring);
  if (geometry.line) out.line = conv(geometry.line);
  if (geometry.point) [out.point] = conv([geometry.point]);
  if (geometry.parts) out.parts = geometry.parts.map((part) => ({ ...part, ring: conv(part.ring) }));
  return out;
}

export const translateGeometry = (geo, geometry, dx, dy) =>
  mapGeometry(geo, geometry, (q) => ({ x: q.x + dx, y: q.y + dy }));

export function rotateGeometry(geo, geometry, deg) {
  const c = geometryCenter(geo, geometry);
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return mapGeometry(geo, geometry, (q) => ({
    x: c.x + (q.x - c.x) * cos - (q.y - c.y) * sin,
    y: c.y + (q.x - c.x) * sin + (q.y - c.y) * cos,
  }));
}

export function scaleGeometry(geo, geometry, factor) {
  const c = geometryCenter(geo, geometry);
  return mapGeometry(geo, geometry, (q) => ({ x: c.x + (q.x - c.x) * factor, y: c.y + (q.y - c.y) * factor }));
}

// Yer səviyyəsini (z) yeniləyir: bina üçün bünövrə, park/yol üçün künc hündürlükləri, ağac üçün nöqtə.
export function setGroundLevel(geometry, z) {
  const out = { ...geometry };
  const v = round2(z);
  if ('baseRel' in geometry) out.baseRel = v;
  if (geometry.zs) out.zs = geometry.zs.map(() => v);
  if ('z' in geometry) out.z = v;
  return out;
}

export function groundLevel(geometry) {
  if (Number.isFinite(geometry.baseRel)) return geometry.baseRel;
  if (Number.isFinite(geometry.z)) return geometry.z;
  if (geometry.zs?.length) return Math.min(...geometry.zs);
  return 0;
}

// Kataloq modeli → saxlanılan həndəsə. center: lokal {x, y, z}; rotation: dərəcə (saat əqrəbinin əksinə).
export function modelGeometry(geo, model, center, rotation = 0) {
  const place = (ring) =>
    ring.map((pt) => {
      const [x, y] = rotatePoint(pt, rotation);
      return toLonLat(geo, { x: center.x + x, y: center.y + y });
    });
  const z = round2(center.z || 0);
  const outer = modelRing(model);
  if (model.kind === 'building') {
    return {
      type: 'Polygon',
      ring: place(outer),
      baseRel: z,
      parts: model.parts.map((part) => ({ ring: place(part.ring), h0: part.h0, h1: part.h1 })),
    };
  }
  return { type: 'Polygon', ring: place(outer), zs: outer.map(() => z) };
}
