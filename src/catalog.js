// Hazır model kataloqu: ağ "maket" üslubunda binalar və parklar.
// Hər model lokal metrlə (x → Şərq, y → Şimal) təsvir olunur; mərkəz (0, 0)-dır.
// Bina hissələri (parts): { ring, h0, h1 } — h0/h1 ümumi hündürlüyün payıdır (0…1),
// ona görə mərtəbə sayı dəyişəndə bütün model proporsional uzanır.

const rect = (w, d, cx = 0, cy = 0) => [
  [cx - w / 2, cy - d / 2], [cx + w / 2, cy - d / 2], [cx + w / 2, cy + d / 2], [cx - w / 2, cy + d / 2],
];

const circle = (r, n = 20, cx = 0, cy = 0) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });

// Künc radiusu olan düzbucaqlı (park konturları üçün daha yumşaq görünüş).
function roundedRect(w, d, r, seg = 4) {
  const out = [];
  const corners = [[w / 2 - r, -d / 2 + r, -90], [w / 2 - r, d / 2 - r, 0], [-w / 2 + r, d / 2 - r, 90], [-w / 2 + r, -d / 2 + r, 180]];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = ((start + (90 * i) / seg) * Math.PI) / 180;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return out;
}

// Sərbəst formalı ("üzvi") park konturu — sabit əmsallarla, təsadüfilik yoxdur.
function blob(rx, ry, n = 22) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + 0.13 * Math.sin(2 * a + 0.6) + 0.09 * Math.sin(3 * a + 2.1) + 0.05 * Math.cos(5 * a);
    return [rx * k * Math.cos(a), ry * k * Math.sin(a)];
  });
}

const lShape = (w, d, t) => [
  [-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, -d / 2 + t], [-w / 2 + t, -d / 2 + t], [-w / 2 + t, d / 2], [-w / 2, d / 2],
];

// Cənuba açılan həyətli U forma.
const uShape = (w, d, t) => [
  [-w / 2, -d / 2], [-w / 2 + t, -d / 2], [-w / 2 + t, d / 2 - t], [w / 2 - t, d / 2 - t],
  [w / 2 - t, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2],
];

const FLOOR = 3.2;
const b = (id, label, floors, parts, extra = {}) => ({
  id, kind: 'building', label, floors, height: Math.round(floors * FLOOR * 10) / 10, parts,
  buildingType: 'residential', roofStyle: 'flat', ...extra,
});

export const BUILDING_MODELS = [
  b('house', 'Fərdi ev', 2, [{ ring: rect(12, 10), h0: 0, h1: 1 }], { roofStyle: 'pyramid', size: '12 × 10 m' }),
  b('block5', '5 mərtəbəli blok', 5, [{ ring: rect(60, 13), h0: 0, h1: 1 }], { size: '60 × 13 m' }),
  b('slab9', '9 mərtəbəli ev', 9, [
    { ring: rect(72, 14), h0: 0, h1: 0.96 },
    { ring: rect(8, 6, -22, 0), h0: 0.96, h1: 1 },
    { ring: rect(8, 6, 22, 0), h0: 0.96, h1: 1 },
  ], { size: '72 × 14 m' }),
  b('lblock', 'L formalı ev', 7, [{ ring: lShape(48, 40, 14), h0: 0, h1: 1 }], { size: '48 × 40 m' }),
  b('ublock', 'Həyətli məhəllə', 6, [{ ring: uShape(56, 44, 13), h0: 0, h1: 1 }], { size: '56 × 44 m' }),
  b('tower16', '16 mərtəbəli qüllə', 16, [
    { ring: rect(24, 24), h0: 0, h1: 0.95 },
    { ring: rect(10, 10), h0: 0.95, h1: 1 },
  ], { size: '24 × 24 m' }),
  b('podium', 'Podiumlu ofis', 22, [
    { ring: rect(52, 38), h0: 0, h1: 0.16 },
    { ring: rect(26, 24, 6, 2), h0: 0.16, h1: 1 },
  ], { buildingType: 'office', size: '52 × 38 m' }),
  b('stepped', 'Pilləli qüllə', 30, [
    { ring: rect(34, 34), h0: 0, h1: 0.42 },
    { ring: rect(25, 25), h0: 0.42, h1: 0.76 },
    { ring: rect(16, 16), h0: 0.76, h1: 1 },
  ], { buildingType: 'office', size: '34 × 34 m' }),
  b('mall', 'Ticarət mərkəzi', 3, [
    { ring: rect(84, 52), h0: 0, h1: 0.8 },
    { ring: rect(40, 26), h0: 0.8, h1: 1 },
  ], { buildingType: 'commercial', size: '84 × 52 m', height: 16 }),
];

const p = (id, label, ring, props, size) => ({
  id, kind: 'park', label, ring, size,
  props: { surface: 'soil', grassCoverage: 85, treeDensity: 5, treeVariant: 'mixed', treeHeight: 7, ...props },
});

export const PARK_MODELS = [
  p('pocket', 'Cib parkı', roundedRect(22, 18, 3, 2), { treeDensity: 9, treeHeight: 6 }, '22 × 18 m'),
  p('round', 'Dairəvi skver', circle(22, 24), { treeDensity: 6, treeVariant: 'round' }, 'Ø 44 m'),
  p('yard', 'Məhəllə bağı', roundedRect(46, 32, 5, 3), { treeDensity: 7 }, '46 × 32 m'),
  p('strip', 'Yaşıl zolaq', roundedRect(120, 12, 3, 2), { treeDensity: 14, treeVariant: 'round', treeHeight: 8, grassCoverage: 70 }, '120 × 12 m'),
  p('medium', 'Orta park', roundedRect(90, 64, 12, 4), { treeDensity: 6, treeHeight: 8 }, '90 × 64 m'),
  p('large', 'Böyük park', blob(88, 60), { treeDensity: 5.5, treeHeight: 9, grassCoverage: 90 }, '≈ 170 × 120 m'),
];

export const MODELS = new Map([...BUILDING_MODELS, ...PARK_MODELS].map((m) => [m.id, m]));

// Modelin xarici konturu (seçim, sahə və istilik maskası üçün). Birinci hissə həmişə ən geniş olandır.
export const modelRing = (model) => (model.kind === 'building' ? model.parts[0].ring : model.ring);

export function rotatePoint([x, y], deg) {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}

// ---------- Kataloq kartları üçün izometrik miniatürlər (SVG) ----------

const ISO_X = 0.866;
const iso = (x, y, z) => [(x - y) * ISO_X, -(x + y) * 0.5 - z];

function shadeOf(nx, ny) {
  // Baxış cənub-qərbdəndir; işıq cənubdan düşür.
  const light = Math.max(0, -ny) * 0.75 + Math.max(0, -nx) * 0.2;
  const v = Math.round(168 + 62 * Math.min(1, light));
  return `rgb(${v},${v + 4},${v + 9})`;
}

function prismFaces(ring, z0, z1) {
  const faces = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const c = ring[(i + 1) % n];
    const ex = c[0] - a[0];
    const ey = c[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    const nx = ey / len; // kontur saat əqrəbinin əksinədir → xarici normal
    const ny = -ex / len;
    if (nx + ny >= 0) continue; // kameraya arxa çevrilmiş üz
    faces.push({
      depth: (a[0] + c[0] + a[1] + c[1]) / 2,
      pts: [iso(a[0], a[1], z0), iso(c[0], c[1], z0), iso(c[0], c[1], z1), iso(a[0], a[1], z1)],
      fill: shadeOf(nx, ny),
    });
  }
  faces.sort((f, g) => g.depth - f.depth); // uzaqdan yaxına
  faces.push({ pts: ring.map(([x, y]) => iso(x, y, z1)), fill: '#f6f8fb' });
  return faces;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function inside(pt, ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[j];
    if ((ay > pt[1]) !== (by > pt[1]) && pt[0] < ((bx - ax) * (pt[1] - ay)) / (by - ay) + ax) hit = !hit;
  }
  return hit;
}

export function modelThumb(model, w = 104, h = 70) {
  const shapes = []; // { pts: [[sx, sy]], fill, stroke }
  const circles = [];
  if (model.kind === 'building') {
    const H = model.height;
    // Yerə düşən kölgə: konturun şimal-şərqə sürüşdürülmüş izi.
    const base = model.parts[0].ring;
    const k = Math.min(H * 0.45, 26);
    shapes.push({ pts: base.map(([x, y]) => iso(x + k, y + k * 0.15, 0)), fill: 'rgba(0,0,0,0.28)' });
    const parts = [...model.parts].sort((a, c) => a.h0 - c.h0);
    for (const part of parts) {
      for (const f of prismFaces(part.ring, part.h0 * H, part.h1 * H)) shapes.push({ ...f, stroke: 'rgba(40,52,66,0.55)' });
    }
    if (model.roofStyle === 'pyramid') {
      const top = parts[parts.length - 1];
      const cx = top.ring.reduce((s, q) => s + q[0], 0) / top.ring.length;
      const cy = top.ring.reduce((s, q) => s + q[1], 0) / top.ring.length;
      const apex = iso(cx, cy, H * 1.45);
      top.ring.forEach((a, i) => {
        const c = top.ring[(i + 1) % top.ring.length];
        const nx = c[1] - a[1];
        const ny = -(c[0] - a[0]);
        if (nx + ny >= 0) return;
        shapes.push({ pts: [iso(a[0], a[1], H), iso(c[0], c[1], H), apex], fill: ny < 0 ? '#e3e8ee' : '#c5cdd7', stroke: 'rgba(40,52,66,0.55)' });
      });
    }
  } else {
    shapes.push({ pts: model.ring.map(([x, y]) => iso(x, y, 0)), fill: '#5f9148', stroke: 'rgba(20,40,20,0.6)' });
    const xs = model.ring.map((q) => q[0]);
    const ys = model.ring.map((q) => q[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const rng = mulberry(model.id.length * 7919 + model.ring.length);
    const span = Math.max(maxX - minX, maxY - minY);
    const r = Math.max(span * 0.055, 1.6);
    const trees = [];
    for (let i = 0; i < 400 && trees.length < 14; i++) {
      const pt = [minX + rng() * (maxX - minX), minY + rng() * (maxY - minY)];
      if (!inside(pt, model.ring)) continue;
      if (trees.some((t) => Math.hypot(t[0] - pt[0], t[1] - pt[1]) < r * 1.9)) continue;
      trees.push(pt);
    }
    trees.sort((a, c) => c[0] + c[1] - (a[0] + a[1]));
    for (const [x, y] of trees) {
      const [sx, sy] = iso(x, y, r * 1.5);
      const [gx, gy] = iso(x + r * 0.9, y + r * 0.2, 0);
      circles.push({ cx: gx, cy: gy, rx: r * 1.1, ry: r * 0.55, fill: 'rgba(0,0,0,0.22)' });
      circles.push({ cx: sx, cy: sy, rx: r, ry: r, fill: rng() < 0.5 ? '#3f7a34' : '#4c8a3c', stroke: 'rgba(15,35,15,0.5)' });
    }
  }

  let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
  const grow = (x, y) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const s of shapes) for (const [x, y] of s.pts) grow(x, y);
  for (const c of circles) { grow(c.cx - c.rx, c.cy - c.ry); grow(c.cx + c.rx, c.cy + c.ry); }
  const pad = 5;
  const scale = Math.min((w - pad * 2) / (maxX - minX || 1), (h - pad * 2) / (maxY - minY || 1));
  const ox = (w - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = (h - (maxY - minY) * scale) / 2 - minY * scale;
  const f = (v) => v.toFixed(1);
  const body = shapes.map((s) =>
    `<polygon points="${s.pts.map(([x, y]) => `${f(x * scale + ox)},${f(y * scale + oy)}`).join(' ')}" fill="${s.fill}"${s.stroke ? ` stroke="${s.stroke}" stroke-width="0.6" stroke-linejoin="round"` : ' stroke="none"'}/>`,
  ).join('') + circles.map((c) =>
    `<ellipse cx="${f(c.cx * scale + ox)}" cy="${f(c.cy * scale + oy)}" rx="${f(c.rx * scale)}" ry="${f(c.ry * scale)}" fill="${c.fill}"${c.stroke ? ` stroke="${c.stroke}" stroke-width="0.5"` : ' stroke="none"'}/>`,
  ).join('');
  return `<svg class="thumb" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${body}</svg>`;
}
