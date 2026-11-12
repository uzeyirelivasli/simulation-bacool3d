import './heatmap.css';
import { CITY_MODES, nudgeRender } from './city-environment.js';
import { pointInPolygon } from './geometry-utils.js';
import './catalog.css';

const Cesium = window.Cesium;

// ---- Sadələşdirilmiş mikroiqlim modeli (demo). Əmsallar ölçmə deyil, təxmini qiymətlərdir. ----
const N = 250; // şəbəkə: 250 × 250 xana (1 km zonada 4 m)
const K = {
  urban: 6, // açıq şəhər səthinin tam günəşdə əlavə isinməsi, °C
  grass: 1.5,
  park: { soil: 5, gravel: 5.5, paving: 7 },
  path: { asphalt: 10, paving: 7, gravel: 5.5, soil: 5 },
};
const SHADE_BUILDING = 1.0;
const SHADE_TREE = 0.75;
const TREE_COOL_RADIUS = 12; // m
const TREE_COOL = 0.45; // °C, hər ağac üçün mərkəzdə
const TREE_COOL_MAX = 3;
const PARK_REACH = 30; // m
const BUILDING_REACH = 10; // m
const MAX_SHADOW = 250; // m
const MIN_SUN_EL = 0.07; // rad (~4°): üfüqə yaxın günəşdə kölgə uzunluğu məhdudlaşdırılır
const KIND = { open: 0, park: 1, path: 2, user: 3, real: 4 }; // xananın səth növü
// Rəng şkalası: T0 − 8 … T0 + 2 (cəmi 10 °C). Dar diapazon + çox pilləli palitra → 1 °C fərq də aydın seçilir.
const RANGE_BELOW = 8;
const RANGE_ABOVE = 2;
const STOPS = [
  [0, [30, 64, 175]], [0.14, [37, 99, 235]], [0.28, [6, 182, 212]], [0.42, [16, 185, 129]],
  [0.55, [163, 230, 53]], [0.67, [250, 204, 21]], [0.79, [249, 115, 22]], [0.9, [220, 38, 38]], [1, [127, 29, 29]],
];
const ALPHA = 205;
const REL_RANGE = 3; // nisbi rejim: −3 … +3 °C (bazaya nisbətən)
const VENT_MAX = 1.5; // küləyin açıq sahədə verdiyi maksimal sərinlik hissi, °C
const WIND = { // küləyin haradan əsdiyi → şəbəkədə hansı tərəfə apardığı (dx: şərq, dy: şimal)
  N: { dx: 0, dy: -1, label: 'Şimal' }, NE: { dx: -1, dy: -1, label: 'Şimal-şərq' },
  E: { dx: -1, dy: 0, label: 'Şərq' }, SE: { dx: -1, dy: 1, label: 'Cənub-şərq' },
  S: { dx: 0, dy: 1, label: 'Cənub' }, SW: { dx: 1, dy: 1, label: 'Cənub-qərb' },
  W: { dx: 1, dy: 0, label: 'Qərb' }, NW: { dx: 1, dy: -1, label: 'Şimal-qərb' },
};

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

const LUT = (() => {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let a = STOPS[0];
    let b = STOPS[STOPS.length - 1];
    for (let s = 0; s < STOPS.length - 1; s++) {
      if (t >= STOPS[s][0] && t <= STOPS[s + 1][0]) { a = STOPS[s]; b = STOPS[s + 1]; break; }
    }
    const f = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(a[1][c] + (b[1][c] - a[1][c]) * f);
  }
  return lut;
})();

function distToPolyline(px, py, pts, closed) {
  let best = Infinity;
  const n = pts.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
    if (d < best) best = d;
  }
  return best;
}

const bounds = (pts, pad = 0) => {
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const q of pts) {
    if (q.x < minX) minX = q.x;
    if (q.x > maxX) maxX = q.x;
    if (q.y < minY) minY = q.y;
    if (q.y > maxY) maxY = q.y;
  }
  return [minX - pad, maxX + pad, minY - pad, maxY + pad];
};

export class Heatmap {
  constructor({ viewer, geo, config, store, layer, city, sampler, root }) {
    this.viewer = viewer;
    this.geo = geo;
    this.config = config;
    this.store = store;
    this.layer = layer;
    this.city = city;
    this.sampler = sampler;
    this.mode = city.mode ?? CITY_MODES.OSM_DEV;
    this.size = config.areas.activeSizeM;
    this.half = this.size / 2;
    this.cell = this.size / N;
    this.enabled = false; // rəngli qatın görünməsi; model özü həmişə hesablanır (kursor temperaturu üçün)
    this.probeOn = true;
    this.baseTemp = 40;
    this.hour = 15;
    this.flowOn = true; // külək animasiyası
    this.relative = false; // false: mütləq °C; true: bazaya (obyektsiz vəziyyətə) nisbətən fərq
    this.wind = { ...config.wind.initial };
    this.materials = config.editor.materials;
    this.matDefault = this.materials[config.editor.defaultMaterial];
    this.matExisting = this.materials[config.editor.existingMaterial];
    this.realHeight = new Float32Array(N * N);
    this.treeLists = new Map();
    this.timer = null;
    this.playTimer = null;
    this.canvas = this._blankCanvas();
    this.field = null; // son hesablanmış sahə
    this.real = []; // real binalar (statik)
    this.realById = new Map();
    this.realIndex = new Int32Array(N * N).fill(-1);
    this.realNear = new Float32Array(N * N);
    this.realVersion = 0;
    this._shadeCache = null;
    this._baseline = null;
    this._xs = new Float64Array(64);
    this._qx = new Float64Array(4);
    this._qy = new Float64Array(4);

    this._tapTrees(layer.trees);
    store.subscribe(() => this.schedule());
    this._buildUI(root);
    this._buildEntity();
    this._buildProbe(root);
    this.setFootprints(city.footprints ?? []);
    this._applyClock();
    this._updateLabels();
  }

  schedule(delay = 220) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.compute(), delay);
  }

  // Real binaların konturları (şəhər məlumatı yüklənəndə və ya fonda gələndə çağırılır).
  setFootprints(footprints) {
    const reach = this.half + MAX_SHADOW;
    const total = N * N;
    this.real = [];
    this.realById = new Map();
    this.realIndex = new Int32Array(total).fill(-1);
    this.realNear = new Float32Array(total);
    this.realHeight = new Float32Array(total);
    for (const f of footprints) {
      const n = f.pts.length;
      if (n < 3) continue;
      const px = new Float64Array(n);
      const py = new Float64Array(n);
      let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
      for (let i = 0; i < n; i++) {
        const { x, y } = f.pts[i];
        px[i] = x; py[i] = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (maxX < -reach || minX > reach || maxY < -reach || minY > reach) continue;
      const r = { id: f.id, px, py, n, base: f.base, top: f.top, minX, maxX, minY, maxY, name: f.name, levels: f.levels, pts: f.pts };
      const idx = this.real.push(r) - 1;
      this.realById.set(f.id, r);
      if (maxX < -this.half - BUILDING_REACH || minX > this.half + BUILDING_REACH
        || maxY < -this.half - BUILDING_REACH || minY > this.half + BUILDING_REACH) continue;
      if (f.base < 3) this._scan(px, py, n, 0, 0, this.realIndex, idx); // keçidlər (min_height) maskaya düşmür
      const near = this.realNear;
      const index = this.realIndex;
      this._box(minX - BUILDING_REACH, maxX + BUILDING_REACH, minY - BUILDING_REACH, maxY + BUILDING_REACH, (c, x, y) => {
        if (index[c] === idx) return;
        const d = distToPolyline(x, y, f.pts, true);
        if (d < BUILDING_REACH) {
          const v = 1 - d / BUILDING_REACH;
          if (v > near[c]) near[c] = v;
        }
      });
    }
    for (let c = 0; c < total; c++) if (this.realIndex[c] >= 0) this.realHeight[c] = this.real[this.realIndex[c]].top;
    this.realVersion += 1;
    this._shadeCache = null;
    this._baseline = null;
    this.schedule(0);
  }

  // Ağac düzülüşlərini renderdən izləyirik: park və cərgə ağacları ayrıca saxlanmır, hər dəfə yaradılır.
  _tapTrees(tr) {
    const lists = this.treeLists;
    const { setGroup, setLoose, removeGroup, clear } = tr;
    tr.setGroup = (key, trees, id) => {
      setGroup.call(tr, key, trees, id);
      if (trees.length) lists.set(key, trees);
      else lists.delete(key);
      this.schedule();
    };
    tr.setLoose = (items) => {
      setLoose.call(tr, items);
      lists.set('__loose', items.map((it) => it.tree));
      this.schedule();
    };
    tr.removeGroup = (key) => {
      removeGroup.call(tr, key);
      if (lists.delete(key)) this.schedule();
    };
    tr.clear = () => {
      clear.call(tr);
      lists.clear();
      this.schedule();
    };
  }

  _blankCanvas() {
    const c = document.createElement('canvas');
    c.width = N;
    c.height = N;
    return c;
  }

  _buildEntity() {
    const b = this.geo.boundsDegrees(this.size);
    const flat = this.mode === CITY_MODES.OSM_DEV;
    if (!flat && !Cesium.Entity.supportsMaterialsforEntitiesOnTerrain(this.viewer.scene)) {
      console.warn('[SOYUQ] Bu brauzer yer səthində şəkil materialını dəstəkləmir — istilik xəritəsi görünməyə bilər.');
    }
    // Açarsız OSM rejimində yer düzdür: qat yerdən 0.5 m yuxarıda adi səth kimi çəkilir (park və yolların üstündə).
    const placement = flat
      ? { height: this.geo.origin.height + 0.5 }
      : {
        classificationType:
          this.mode === CITY_MODES.GOOGLE ? Cesium.ClassificationType.CESIUM_3D_TILE : Cesium.ClassificationType.BOTH,
        zIndex: 10,
      };
    this.entity = this.viewer.entities.add({
      id: 'heatmap',
      show: false,
      rectangle: {
        coordinates: Cesium.Rectangle.fromDegrees(b.west, b.south, b.east, b.north),
        material: new Cesium.ImageMaterialProperty({
          image: new Cesium.CallbackProperty(() => this.canvas, false),
          transparent: true,
        }),
        ...placement,
      },
    });
  }

  _buildUI(root) {
    const el = document.createElement('div');
    el.className = 'heatbar';
    el.innerHTML = `
      <div class="heat-row">
        <label class="toggle"><input type="checkbox" data-h="on" /><span class="switch"></span>İstilik xəritəsi</label>
        <label class="toggle"><input type="checkbox" data-h="probe" checked /><span class="switch"></span>Kursor °C</label>
        <label class="heat-field">Maks. temp., °C
          <input data-h="temp" type="number" min="20" max="50" step="1" value="${this.baseTemp}" /></label>
        <div class="heat-mode segmented" title="Mütləq: temperatur °C. Nisbi: əlavə etdiyiniz obyektlərin yaratdığı fərq (əvvəl → sonra).">
          <button data-mode="abs" class="on">Mütləq °C</button>
          <button data-mode="rel">Nisbi Δ</button>
        </div>
      </div>
      <div class="heat-row">
        <button class="heat-play" data-h="play" title="Günü oynat (06:00 → 20:00)" aria-label="Günü oynat">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path data-h="play-icon" d="M8 5l11 7-11 7z"/></svg></button>
        <label class="heat-field grow">Saat
          <input data-h="hour" type="range" min="6" max="20" step="0.25" value="${this.hour}" />
          <b class="mono" data-h="hour-label"></b></label>
        <span class="heat-sun mono" data-h="sun" title="Günəşin üfüqdən hündürlüyü"></span>
      </div>
      <div class="heat-stats">
        <span title="Günəş altında, açıq şəhər səthində temperatur">Açıq sahə <b class="mono" data-h="air">—</b></span>
        <span title="Zonanın açıq səthinin kölgədə olan hissəsi">Kölgədə <b class="mono" data-h="shade">—</b></span>
        <span title="Əlavə etdiyiniz obyektlərin təsir etdiyi sahədə orta temperatur fərqi">Müdaxilə <b class="mono" data-h="delta">—</b></span>
        <span title="Zonadakı ən sərin nöqtə">Ən sərin <b class="mono" data-h="min">—</b></span>
        <span title="Müdaxilə nəticəsində sərinləyən sahə">Sərinləyən <b class="mono" data-h="area">—</b></span>
      </div>
      <div class="heat-row">
        <span class="mono" data-h="lo"></span>
        <div class="heat-legend"></div>
        <span class="mono" data-h="hi"></span>
        <span class="heat-note">Sadələşdirilmiş model · real ölçmə deyil</span>
      </div>`;
    el.querySelector('.heat-legend').style.background =
      `linear-gradient(90deg, ${STOPS.map(([t, c]) => `rgb(${c.join(',')}) ${t * 100}%`).join(', ')})`;
    root.appendChild(el);
    this.ui = el;

    // Külək paneli (yuxarıda): 8 sektorlu kompas — sektor küləyin HARADAN əsdiyini göstərir.
    const order = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const names = { N: 'N', NE: 'NE', E: 'E', SE: 'SE', S: 'S', SW: 'SW', W: 'W', NW: 'NW' };
    const R1 = 58;
    const R0 = 25;
    const pt = (r, deg) => {
      const a = ((deg - 90) * Math.PI) / 180;
      return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
    };
    const sectors = order.map((d, i) => {
      const a0 = i * 45 - 21.2;
      const a1 = i * 45 + 21.2;
      const [lx, ly] = pt((R1 + R0) / 2 + 1, i * 45).split(',');
      return `<g class="wind-sector" data-wind="${d}" role="button" tabindex="0" aria-label="${WIND[d].label} küləyi">
        <title>${WIND[d].label} küləyi (${WIND[d].label.toLowerCase()}dan əsir)</title>
        <path d="M${pt(R1, a0)} A${R1},${R1} 0 0 1 ${pt(R1, a1)} L${pt(R0, a1)} A${R0},${R0} 0 0 0 ${pt(R0, a0)} Z"/>
        <text x="${lx}" y="${ly}">${names[d]}</text></g>`;
    }).join('');
    const card = document.createElement('div');
    card.className = 'windcard';
    card.innerHTML = `
      <div class="windcard-head"><span>Külək</span><b class="mono" data-h="wind-label"></b></div>
      <div class="windcard-body">
        <svg class="wind-compass" viewBox="-64 -64 128 128" aria-label="Külək istiqaməti">
          ${sectors}
          <g class="wind-hub" data-preset="calm" role="button" tabindex="0" aria-label="Sakit hava">
            <title>Sakit hava (küləyi söndür)</title>
            <circle r="${R0 - 4}"/>
            <path class="wind-needle" data-h="needle" d="M0 -13 L5.5 7 L0 3.5 L-5.5 7 Z"/>
          </g>
        </svg>
        <div class="windcard-side">
          <label class="wind-speed"><span>Sürət</span>
            <input data-h="wind" type="range" min="0" max="${this.config.wind.maxSpeed}" step="0.5" value="${this.wind.speed}" /></label>
          <div class="wind-presets">
            ${Object.entries(this.config.wind.presets).map(([k, w]) => `<button data-preset="${k}">${w.label}</button>`).join('')}
          </div>
          <label class="toggle"><input type="checkbox" data-h="flow" checked /><span class="switch"></span>Animasiya</label>
        </div>
      </div>`;
    root.appendChild(card);
    this.windUi = card;
    this.$ = (name) => el.querySelector(`[data-h="${name}"]`) ?? card.querySelector(`[data-h="${name}"]`);
    this.$$ = (sel) => [...el.querySelectorAll(sel), ...card.querySelectorAll(sel)];

    this.$('on').addEventListener('change', (e) => {
      this.enabled = e.target.checked;
      this.entity.show = this.enabled;
      this.compute();
      nudgeRender(this.viewer.scene, 2500, 250);
    });
    this.$('probe').addEventListener('change', (e) => {
      this.probeOn = e.target.checked;
      if (!this.probeOn) this._hideProbe();
    });
    this.$('temp').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      if (!Number.isFinite(v)) return;
      this.baseTemp = clamp(v, 20, 50);
      this._updateLabels();
      this.compute();
    });
    this.$('hour').addEventListener('input', (e) => {
      this.setHour(parseFloat(e.target.value));
    });
    this.$('play').addEventListener('click', () => this.togglePlay());
    this.$('wind').addEventListener('input', (e) => this.setWind(this.wind.from, parseFloat(e.target.value)));
    const onClick = (e) => {
      const btn = e.target.closest('[data-wind], [data-preset], [data-mode]');
      if (!btn) return;
      e.stopPropagation();
      if (btn.dataset.wind) this.setWind(btn.dataset.wind, this.wind.speed || 5);
      else if (btn.dataset.preset) {
        const w = this.config.wind.presets[btn.dataset.preset];
        this.setWind(btn.dataset.preset === 'calm' ? this.wind.from : w.from, w.speed);
      } else if (btn.dataset.mode) this.setRelative(btn.dataset.mode === 'rel');
    };
    el.addEventListener('click', onClick);
    card.addEventListener('click', onClick);
    card.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role="button"]')) {
        e.preventDefault();
        onClick(e);
      }
    });
    this.$('flow').addEventListener('change', (e) => {
      this.flowOn = e.target.checked;
      this.onFlowToggle?.(this.flowOn);
    });
    this._syncWind();
  }

  // Külək: from — haradan əsir (N, NE, …), speed — m/s. 0 = sakit hava (külək modeli söndürülür).
  setWind(from, speed) {
    this.wind = { from: WIND[from] ? from : 'N', speed: clamp(Number(speed) || 0, 0, this.config.wind.maxSpeed) };
    this._syncWind();
    this.compute();
  }

  _syncWind() {
    const { from, speed } = this.wind;
    const slider = this.$('wind');
    if (Number(slider.value) !== speed) slider.value = speed;
    this.$('wind-label').textContent = speed > 0 ? `${WIND[from].label} · ${speed.toFixed(1)} m/s` : 'Sakit';
    this.$$('[data-wind]').forEach((b) => b.classList.toggle('on', speed > 0 && b.dataset.wind === from));
    // Mərkəzdəki ox küləyin HARA əsdiyini göstərir.
    const blow = (Math.atan2(WIND[from].dx, WIND[from].dy) * 180) / Math.PI;
    const needle = this.$('needle');
    needle.setAttribute('transform', `rotate(${blow.toFixed(0)})`);
    needle.style.opacity = speed > 0 ? 1 : 0.25;
    const presets = this.config.wind.presets;
    this.$$('button[data-preset]').forEach((b) => {
      const w = presets[b.dataset.preset];
      b.classList.toggle('on', w.speed === speed && (speed === 0 || w.from === from));
    });
  }

  // Mütləq (°C) ↔ nisbi (obyektsiz vəziyyətə nisbətən fərq) göstərmə rejimi.
  setRelative(on) {
    this.relative = Boolean(on);
    this.$$('[data-mode]').forEach((b) => b.classList.toggle('on', (b.dataset.mode === 'rel') === this.relative));
    this._updateLabels();
    if (this.field && this.enabled) this._paint();
  }

  setHour(hour) {
    this.hour = clamp(Number.isFinite(hour) ? hour : 15, 6, 20);
    const slider = this.$('hour');
    if (Number(slider.value) !== this.hour) slider.value = this.hour;
    this._applyClock();
    this._updateLabels();
    this.compute();
  }

  // Günü avtomatik oynadır: kölgələrin və temperaturun necə dəyişdiyini göstərmək üçün.
  togglePlay() {
    const icon = this.$('play-icon');
    if (this.playTimer) {
      clearInterval(this.playTimer);
      this.playTimer = null;
      icon.setAttribute('d', 'M8 5l11 7-11 7z');
      return;
    }
    icon.setAttribute('d', 'M7 5h4v14H7zM13 5h4v14h-4z');
    if (this.hour >= 20) this.setHour(6);
    this.playTimer = setInterval(() => {
      if (this.hour >= 20) return this.togglePlay();
      this.setHour(this.hour + 0.25);
    }, 160);
  }

  _updateLabels() {
    const hh = Math.floor(this.hour);
    const mm = Math.round((this.hour - hh) * 60);
    this.$('hour-label').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    this.$('lo').textContent = this.relative ? `−${REL_RANGE}°` : `${(this.baseTemp - RANGE_BELOW).toFixed(0)}°`;
    this.$('hi').textContent = this.relative ? `+${REL_RANGE}°` : `${(this.baseTemp + RANGE_ABOVE).toFixed(0)}°`;
    this.ui.querySelector('.heat-legend').style.background = this.relative
      ? 'linear-gradient(90deg, rgb(26,80,230), rgba(96,190,255,0.35) 47%, rgba(255,255,255,0.08) 50%, rgba(255,170,120,0.35) 53%, rgb(205,30,30))'
      : `linear-gradient(90deg, ${STOPS.map(([t, c]) => `rgb(${c.join(',')}) ${t * 100}%`).join(', ')})`;
    const el = (this._sun().el * 180) / Math.PI;
    this.$('sun').textContent = `☀ ${Math.max(0, el).toFixed(0)}°`;
  }

  _julian() {
    const { utcOffsetHours, representativeDate } = this.config.time;
    const hh = Math.floor(this.hour);
    const mm = Math.round((this.hour - hh) * 60);
    const pad = (n) => String(n).padStart(2, '0');
    const sign = utcOffsetHours >= 0 ? '+' : '-';
    return Cesium.JulianDate.fromIso8601(
      `${representativeDate}T${pad(hh)}:${pad(mm)}:00${sign}${pad(Math.abs(utcOffsetHours))}:00`,
    );
  }

  // Səhnənin günəş işığını (və deməli real vaxt kölgələrini) seçilmiş saata uyğunlaşdırır.
  _applyClock() {
    this.viewer.clock.currentTime = this._julian();
    this.viewer.scene.requestRender();
  }

  _airTemp() {
    return this.baseTemp - 4.5 * (1 - Math.cos((2 * Math.PI * (this.hour - 15)) / 24));
  }

  // Günəşin mövqeyi — Cesium-un səhnədə istifadə etdiyi eyni efemerid, ona görə istilik modelindəki
  // kölgələr ekrandakı 3D kölgələrlə üst-üstə düşür. east/north: günəşə doğru üfüqi vahid vektor.
  _sun() {
    const time = this._julian();
    const sunInertial = Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(time, new Cesium.Cartesian3());
    const toFixed = Cesium.Transforms.computeTemeToPseudoFixedMatrix(time, new Cesium.Matrix3());
    const sunFixed = Cesium.Matrix3.multiplyByVector(toFixed, sunInertial, new Cesium.Cartesian3());
    const dir = Cesium.Cartesian3.subtract(sunFixed, this.geo.originCartesian, new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(dir, dir);
    const l = Cesium.Matrix4.multiplyByPointAsVector(this.geo.fixedToEnu, dir, new Cesium.Cartesian3());
    const horiz = Math.hypot(l.x, l.y) || 1;
    return { el: Math.asin(clamp(l.z, -1, 1)), s: Math.max(0, l.z), east: l.x / horiz, north: l.y / horiz };
  }

  _box(minX, maxX, minY, maxY, fn) {
    const { half, cell } = this;
    const i0 = Math.max(0, Math.floor((minX + half) / cell));
    const i1 = Math.min(N - 1, Math.floor((maxX + half) / cell));
    const j0 = Math.max(0, Math.floor((minY + half) / cell));
    const j1 = Math.min(N - 1, Math.floor((maxY + half) / cell));
    for (let j = j0; j <= j1; j++) {
      const y = -half + (j + 0.5) * cell;
      for (let i = i0; i <= i1; i++) fn(j * N + i, -half + (i + 0.5) * cell, y);
    }
  }

  // Poliqonun (px, py; sürüşmə ox, oy) daxilindəki xanalara val yazır (mövcud dəyər kiçikdirsə).
  // Sətir-sətir doldurma: qabarıq olmayan konturlar (L, U formalar) üçün də dəqiqdir.
  _scan(px, py, n, ox, oy, arr, val) {
    const { half, cell } = this;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const y = py[i] + oy;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const j0 = Math.max(0, Math.ceil((minY + half) / cell - 0.5));
    const j1 = Math.min(N - 1, Math.floor((maxY + half) / cell - 0.5));
    if (j1 < j0) return;
    if (this._xs.length < n) this._xs = new Float64Array(n * 2);
    const xs = this._xs;
    for (let j = j0; j <= j1; j++) {
      const y = -half + (j + 0.5) * cell;
      let m = 0;
      for (let a = 0, b = n - 1; a < n; b = a++) {
        const ay = py[a] + oy;
        const by = py[b] + oy;
        if ((ay > y) !== (by > y)) {
          const x = px[a] + ox + ((y - ay) * (px[b] - px[a])) / (by - ay);
          let k = m++; // sıralı əlavə
          while (k > 0 && xs[k - 1] > x) { xs[k] = xs[k - 1]; k--; }
          xs[k] = x;
        }
      }
      const row = j * N;
      for (let k = 0; k + 1 < m; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] + half) / cell - 0.5));
        const i1 = Math.min(N - 1, Math.floor((xs[k + 1] + half) / cell - 0.5));
        for (let i = i0; i <= i1; i++) if (arr[row + i] < val) arr[row + i] = val;
      }
    }
  }

  // Prizmanın (kontur, z0…z1) yerə düşən kölgəsi: konturun günəşin əksinə "süpürülmüş" izi.
  // Kölgə = başlanğıc kontur + kölgə istiqamətinə baxan tərəflərin süpürdüyü paraleloqramlar
  // (digər tərəflərin izi bunların içində qalır, ona görə hesablanmır).
  _castPrism(px, py, n, z0, z1, sun, invTan, arr, val) {
    const d0 = Math.min(z0 * invTan, MAX_SHADOW);
    const d1 = Math.min(z1 * invTan, MAX_SHADOW);
    const ox0 = -sun.east * d0;
    const oy0 = -sun.north * d0;
    this._scan(px, py, n, ox0, oy0, arr, val);
    if (d1 - d0 < 0.5) return;
    const ox1 = -sun.east * d1;
    const oy1 = -sun.north * d1;
    let area = 0;
    for (let a = 0, b = n - 1; a < n; b = a++) area += px[b] * py[a] - px[a] * py[b];
    const sign = area >= 0 ? 1 : -1; // saat əqrəbinin əksinə → +1
    const qx = this._qx;
    const qy = this._qy;
    for (let a = 0, b = n - 1; a < n; b = a++) {
      // b → a tərəfinin xarici normalı ilə kölgə istiqamətinin (−günəş) skalyar hasili
      const facing = sign * ((py[a] - py[b]) * -sun.east - (px[a] - px[b]) * -sun.north);
      if (facing <= 0) continue;
      qx[0] = px[b] + ox0; qy[0] = py[b] + oy0;
      qx[1] = px[a] + ox0; qy[1] = py[a] + oy0;
      qx[2] = px[a] + ox1; qy[2] = py[a] + oy1;
      qx[3] = px[b] + ox1; qy[3] = py[b] + oy1;
      this._scan(qx, qy, 4, 0, 0, arr, val);
    }
  }

  // Real binaların kölgəsi yalnız günəşin mövqeyindən asılıdır → hər saat üçün bir dəfə hesablanıb keşdə qalır
  // (sürgünü irəli-geri çəkəndə və günü oynadanda təkrar hesablanmır).
  _realShade(sun, invTan) {
    if (this._shadeCache?.version !== this.realVersion) this._shadeCache = { version: this.realVersion, map: new Map() };
    const cached = this._shadeCache.map.get(this.hour);
    if (cached) return cached;
    const shade = new Uint8Array(N * N);
    if (sun.s > 0) {
      const { half } = this;
      for (const r of this.real) {
        const L = Math.min(r.top * invTan, MAX_SHADOW);
        const sx = -sun.east * L;
        const sy = -sun.north * L;
        // Kölgə zonaya çatmırsa, keç.
        if (Math.max(r.maxX, r.maxX + sx) < -half || Math.min(r.minX, r.minX + sx) > half
          || Math.max(r.maxY, r.maxY + sy) < -half || Math.min(r.minY, r.minY + sy) > half) continue;
        this._castPrism(r.px, r.py, r.n, r.base, r.top, sun, invTan, shade, 1);
      }
    }
    this._shadeCache.map.set(this.hour, shade);
    return shade;
  }

  _local(coords) {
    return coords.map(([lon, lat]) => {
      const p = this.geo.lonLatToLocal(lon, lat);
      return { x: p.x, y: p.y };
    });
  }

  // Temperatur sahəsi. objects / treeLists boşdursa → "müdaxiləsiz" baza vəziyyəti (yalnız real şəhər).
  _field(objects, treeLists, sun, invTan, air) {
    const { cell } = this;
    const total = N * N;
    const k = new Float32Array(total).fill(K.urban);
    const shade = Float32Array.from(this._realShade(sun, invTan));
    const parkCool = new Float32Array(total);
    const treeCool = new Float32Array(total);
    // Divar təsirləri (material əmsalları ilə çəkilmiş yaxınlıq): yığılmış istilik, əks olunan günəş, yaşıl fasad.
    const ex = this.matExisting;
    const stor = Float32Array.from(this.realNear, (v) => v * ex.store);
    const refl = Float32Array.from(this.realNear, (v) => v * ex.reflect);
    const gcool = new Float32Array(total);
    const height = Float32Array.from(this.realHeight);
    const retain = new Float32Array(total);
    const kind = new Uint8Array(total);
    const owner = new Int32Array(total).fill(-1); // istifadəçi binasının objects massivindəki indeksi
    const { s, east, north } = sun;
    const evening = clamp((this.hour - 16) / 4, 0, 1);
    for (let c = 0; c < total; c++) if (this.realIndex[c] >= 0) kind[c] = KIND.real;

    // 1) Parklar: sərin səth + ətrafa sərinlik
    for (const o of objects) {
      if (o.type !== 'park') continue;
      const pts = this._local(o.geometry.ring);
      const cov = clamp((Number(o.props.grassCoverage) || 0) / 100, 0, 1);
      const base = K.park[o.props.surface] ?? 5;
      const kp = base + (K.grass - base) * cov;
      this._box(...bounds(pts, PARK_REACH), (c, x, y) => {
        if (pointInPolygon({ x, y }, pts)) {
          k[c] = kp;
          parkCool[c] = Math.max(parkCool[c], 0.6 + cov);
          if (kind[c] === KIND.open) kind[c] = KIND.park;
        } else {
          const d = distToPolyline(x, y, pts, true);
          if (d < PARK_REACH) parkCool[c] = Math.max(parkCool[c], (0.4 + 0.8 * cov) * (1 - d / PARK_REACH));
        }
      });
    }

    // 2) Yollar: səth növünə görə isinmə
    for (const o of objects) {
      if (o.type !== 'path' || o.props.pathType === 'treerow') continue;
      const width = Number(o.props.width) || 0;
      if (width <= 0) continue;
      const pts = this._local(o.geometry.line);
      const reach = Math.max(width / 2, cell * 0.6);
      const f = clamp(width / cell, 0.35, 1); // ensiz yol xananı qismən örtür
      const ks = K.path[o.props.surface] ?? 7;
      const ret = (o.props.surface === 'asphalt' ? 1.5 : 0.4) * f;
      this._box(...bounds(pts, reach), (c, x, y) => {
        if (distToPolyline(x, y, pts, false) <= reach) {
          k[c] += (ks - k[c]) * f;
          retain[c] = Math.max(retain[c], ret);
          if (kind[c] === KIND.open || kind[c] === KIND.park) kind[c] = KIND.path;
        }
      });
    }

    // 3) İstifadəçi binaları: dəqiq kölgə (hər həcm ayrıca) + divar yaxınlığında yığılmış istilik
    objects.forEach((o, oi) => {
      if (o.type !== 'building') return;
      const H = Number(o.props.height) || 0;
      const parts = o.geometry.parts?.length ? o.geometry.parts : [{ ring: o.geometry.ring, h0: 0, h1: 1 }];
      if (s > 0) {
        for (const part of parts) {
          const pts = this._local(part.ring);
          const px = Float64Array.from(pts, (q) => q.x);
          const py = Float64Array.from(pts, (q) => q.y);
          this._castPrism(px, py, pts.length, H * (Number(part.h0) || 0), H * (Number(part.h1) || 1), sun, invTan, shade, SHADE_BUILDING);
        }
      }
      const pts = this._local(o.geometry.ring);
      const m = this.materials[o.props.material] ?? this.matDefault;
      this._box(...bounds(pts, BUILDING_REACH), (c, x, y) => {
        if (pointInPolygon({ x, y }, pts)) {
          kind[c] = KIND.user;
          owner[c] = oi;
          height[c] = H;
        } else {
          const d = distToPolyline(x, y, pts, true);
          if (d < BUILDING_REACH) {
            const v = 1 - d / BUILDING_REACH;
            if (v * m.store > stor[c]) stor[c] = v * m.store;
            if (v * m.reflect > refl[c]) refl[c] = v * m.reflect;
            if (v * m.cool > gcool[c]) gcool[c] = v * m.cool;
          }
        }
      });
    });

    // 4) Ağaclar: kölgə + buxarlanma sərinliyi
    for (const list of treeLists) {
      for (const t of list) {
        if (Math.abs(t.x) > this.half + 40 || Math.abs(t.y) > this.half + 40) continue;
        const R = Math.max((t.variant === 'cypress' ? 0.11 : 0.3) * t.h * (t.w || 1), 1.2) + cell * 0.4;
        if (s > 0) {
          const d0 = 0.35 * t.h * invTan;
          const d1 = Math.min(0.95 * t.h * invTan, MAX_SHADOW);
          const steps = Math.min(16, Math.max(1, Math.ceil((d1 - d0) / R)));
          for (let q = 0; q <= steps; q++) {
            const d = d0 + ((d1 - d0) * q) / steps;
            const cx = t.x - east * d;
            const cy = t.y - north * d;
            this._box(cx - R, cx + R, cy - R, cy + R, (c, x, y) => {
              if (Math.hypot(x - cx, y - cy) <= R && shade[c] < SHADE_TREE) shade[c] = SHADE_TREE;
            });
          }
        }
        this._box(t.x - TREE_COOL_RADIUS, t.x + TREE_COOL_RADIUS, t.y - TREE_COOL_RADIUS, t.y + TREE_COOL_RADIUS, (c, x, y) => {
          const d = Math.hypot(x - t.x, y - t.y);
          if (d < TREE_COOL_RADIUS) treeCool[c] += TREE_COOL * (1 - d / TREE_COOL_RADIUS);
        });
      }
    }

    // 5) Külək: binaların arxasında "külək kölgəsi" və park/ağac sərinliyinin külək istiqamətində daşınması.
    // 8 istiqamət şəbəkənin 8 qonşusuna uyğundur → bir keçidlə (külək tərəfdən başlayaraq) hesablanır.
    const day = 0.35 + 0.65 * s;
    const speed = this.wind.speed;
    const cool = new Float32Array(total);
    for (let c = 0; c < total; c++) cool[c] = (parkCool[c] + Math.min(treeCool[c], TREE_COOL_MAX)) * day;
    const shelter = new Float32Array(total);
    if (speed > 0.2) {
      const { dx, dy } = WIND[this.wind.from];
      const step = cell * Math.hypot(dx, dy);
      const plume = Math.min(160, 10 * speed); // sərinliyin daşındığı məsafə, m
      const decay = Math.exp(-step / plume);
      const dilute = 1 / (1 + speed / 15); // güclü külək sərin havanı durulaşdırır
      const remain = new Float32Array(total); // qalan külək kölgəsi məsafəsi, m
      const carried = new Float32Array(total);
      for (let jj = 0; jj < N; jj++) {
        const j = dy >= 0 ? jj : N - 1 - jj;
        const uj = j - dy;
        for (let ii = 0; ii < N; ii++) {
          const i = dx >= 0 ? ii : N - 1 - ii;
          const ui = i - dx;
          const c = j * N + i;
          const up = ui >= 0 && ui < N && uj >= 0 && uj < N ? uj * N + ui : -1;
          const upRemain = up >= 0 ? remain[up] - step : 0;
          if (kind[c] >= KIND.user) {
            remain[c] = Math.max(Math.min(4 * height[c], 110), upRemain); // kölgə uzunluğu ≈ 4 × hündürlük
            continue;
          }
          remain[c] = upRemain > 0 ? upRemain : 0;
          shelter[c] = Math.min(1, remain[c] / 16);
          const upCool = up >= 0 && kind[up] < KIND.user ? carried[up] * decay : 0;
          carried[c] = cool[c] > upCool ? cool[c] : upCool;
          const moved = carried[c] * dilute;
          if (moved > cool[c]) cool[c] = moved;
        }
      }
    }

    // 6) Temperatur sahəsi. Sakit havada açıq, günəşli şəhər səthi = hava temperaturu.
    // Külək açıq yerdə sərinlik hissi verir və isti səthlərin artıq istiliyini aparır; külək kölgəsində bu olmur.
    const wallHeat = 0.3 + 0.8 * evening;
    const vent = VENT_MAX * (1 - Math.exp(-speed / 5));
    const raw = new Float32Array(total);
    for (let c = 0; c < total; c++) {
      const exposure = 1 - shelter[c];
      const damp = 1 / (1 + (speed * exposure) / 5);
      const surf = (k[c] - K.urban) * (1 - shade[c]) * s; // səth növünün təsiri (asfalt +, ot −)
      const hot = (surf > 0 ? surf : 0) + stor[c] * wallHeat + refl[c] * s * (1 - shade[c]) + retain[c] * evening;
      raw[c] = air
        - K.urban * shade[c] * s
        + (surf < 0 ? surf : 0)
        + hot * damp
        - cool[c]
        - gcool[c] * day
        - vent * exposure;
    }

    // 7) Yumşaltma (3 × 3). Bina altındakı xanalar ortalamaya qatılmır.
    const T = new Float32Array(total);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const c = j * N + i;
        if (kind[c] >= KIND.user) { T[c] = raw[c]; continue; }
        let sum = 0;
        let n = 0;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= N) continue;
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            if (ii < 0 || ii >= N) continue;
            const cc = jj * N + ii;
            if (kind[cc] >= KIND.user) continue;
            sum += raw[cc];
            n++;
          }
        }
        T[c] = n ? sum / n : raw[c];
      }
    }
    return { T, shade, kind, owner, shelter, ref: air - vent };
  }

  compute() {
    clearTimeout(this.timer);
    const { cell } = this;
    const sun = this._sun();
    const invTan = 1 / Math.tan(Math.max(sun.el, MIN_SUN_EL));
    const air = this._airTemp();
    const objects = [...this.layer.records.values()].map((r) => r.obj).filter((o) => o.visible !== false);

    // Baza (müdaxiləsiz) sahə: saat və temperatur dəyişməyənə qədər keşdə saxlanır.
    const baseKey = `${this.hour}|${this.baseTemp}|${this.realVersion}|${this.wind.from}|${this.wind.speed}`;
    if (this._baseline?.key !== baseKey) {
      this._baseline = { key: baseKey, field: this._field([], [], sun, invTan, air) };
    }
    const base = this._baseline.field.T;
    const hasObjects = objects.length > 0 || this.treeLists.size > 0;
    const f = hasObjects ? this._field(objects, [...this.treeLists.values()], sun, invTan, air) : this._baseline.field;
    this.field = { ...f, base, objects, air, sun, invTan, version: (this._fieldVersion = (this._fieldVersion ?? 0) + 1) };

    // Statistika
    const { T, shade, kind } = f;
    let minT = Infinity;
    let open = 0;
    let shaded = 0;
    let affected = 0;
    let affectedSum = 0;
    let cooled = 0;
    for (let c = 0; c < N * N; c++) {
      if (kind[c] >= KIND.user) continue;
      open++;
      const v = T[c];
      if (v < minT) minT = v;
      if (shade[c] >= SHADE_TREE) shaded++;
      const d = v - base[c];
      if (Math.abs(d) > 0.15) { affected++; affectedSum += d; }
      if (d < -0.15) cooled++;
    }
    const fmt = (v) => `${v >= 0.05 ? '+' : v <= -0.05 ? '−' : ''}${Math.abs(v).toFixed(1)} °C`;
    this.$('air').textContent = `${f.ref.toFixed(1)} °C`;
    this.$('shade').textContent = open ? `${Math.round((shaded / open) * 100)} %` : '—';
    this.$('delta').textContent = affected ? fmt(affectedSum / affected) : '—';
    this.$('min').textContent = Number.isFinite(minT) ? `${minT.toFixed(1)} °C` : '—';
    this.$('area').textContent = `${Math.round(cooled * cell * cell).toLocaleString('az-AZ')} m²`;

    if (this.enabled) this._paint();
    if (this._lastPointer) this._showProbe(this._lastPointer.x, this._lastPointer.y);
    this.onField?.(this.field, { ...WIND[this.wind.from], speed: this.wind.speed });
  }

  // Rəngləmə (şimal yuxarıda)
  _paint() {
    const { T, kind, base } = this.field;
    const canvas = this._blankCanvas();
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(N, N);
    const lo = this.baseTemp - RANGE_BELOW;
    const span = RANGE_BELOW + RANGE_ABOVE;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const c = j * N + i;
        if (kind[c] >= KIND.user) continue; // bina altı: şəffaf
        const o = ((N - 1 - j) * N + i) * 4;
        if (this.relative) {
          // Yalnız dəyişən yerlər rənglənir: mavi = sərinlədi, qırmızı = isindi.
          const d = T[c] - base[c];
          const a = clamp((Math.abs(d) - 0.1) / REL_RANGE, 0, 1);
          if (a <= 0) continue;
          const t = Math.sqrt(a);
          img.data[o] = d < 0 ? 96 - 70 * t : 255 - 50 * t;
          img.data[o + 1] = d < 0 ? 190 - 110 * t : 170 - 140 * t;
          img.data[o + 2] = d < 0 ? 255 - 25 * t : 120 - 90 * t;
          img.data[o + 3] = 90 + 150 * t;
          continue;
        }
        const li = Math.round(clamp((T[c] - lo) / span, 0, 1) * 255) * 3;
        img.data[o] = LUT[li];
        img.data[o + 1] = LUT[li + 1];
        img.data[o + 2] = LUT[li + 2];
        img.data[o + 3] = ALPHA;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.canvas = canvas; // yeni obyekt → Cesium teksturu yeniləyir
    nudgeRender(this.viewer.scene, 600, 150);
  }

  // ---------- Kursor altındakı nöqtənin temperaturu ----------

  _buildProbe(root) {
    const el = document.createElement('div');
    el.className = 'probe hidden';
    root.appendChild(el);
    this.probeEl = el;
    this._lastPointer = null;
    this._probeRaf = 0;
    const canvas = this.viewer.scene.canvas;
    canvas.addEventListener('pointermove', (e) => {
      if (!this.probeOn || e.buttons !== 0) return this._hideProbe();
      const r = canvas.getBoundingClientRect();
      this._lastPointer = { x: e.clientX - r.left, y: e.clientY - r.top, cx: e.clientX, cy: e.clientY };
      if (this._probeRaf) return;
      this._probeRaf = requestAnimationFrame(() => {
        this._probeRaf = 0;
        if (this._lastPointer) this._showProbe(this._lastPointer.x, this._lastPointer.y);
      });
    });
    canvas.addEventListener('pointerleave', () => this._hideProbe());
    canvas.addEventListener('pointerdown', () => this._hideProbe());
    canvas.addEventListener('wheel', () => this._hideProbe(), { passive: true });
  }

  _hideProbe() {
    this._lastPointer = null;
    this.probeEl.classList.add('hidden');
  }

  // Ekran nöqtəsi → { building } və ya { c } (şəbəkə xanası).
  probe(x, y) {
    const f = this.field;
    if (!f) return null;
    const pos = new Cesium.Cartesian2(x, y);
    const fromReal = (r) => r && {
      key: r.id, title: r.name || 'Mövcud bina', height: r.top, levels: r.levels,
      material: this.matExisting, assumed: true, pts: r.pts,
    };
    const fromUser = (obj) => obj && {
      key: obj.id, title: obj.props.name, height: Number(obj.props.height) || 0, levels: obj.props.floors,
      material: this.materials[obj.props.material] ?? this.matDefault, assumed: false, pts: this._local(obj.geometry.ring),
    };
    let building = null;
    const picked = this.viewer.scene.pick(pos, 3, 3);
    let raw = picked?.id;
    if (raw && typeof raw === 'object') raw = raw.id;
    if (typeof raw === 'string') {
      if (this.realById.has(raw)) building = fromReal(this.realById.get(raw));
      else {
        const obj = this.store.get(raw);
        if (obj?.type === 'building') building = fromUser(obj);
      }
    }
    if (building) return { building };
    const hit = this.sampler.pick(pos);
    if (!hit || !this.geo.isInsideSquare(hit.local.x, hit.local.y, this.size)) return null;
    const i = clamp(Math.floor((hit.local.x + this.half) / this.cell), 0, N - 1);
    const j = clamp(Math.floor((hit.local.y + this.half) / this.cell), 0, N - 1);
    const c = j * N + i;
    if (f.kind[c] === KIND.real) building = fromReal(this.real[this.realIndex[c]]);
    else if (f.kind[c] === KIND.user) building = fromUser(f.objects[f.owner[c]]);
    else return { c };
    return building ? { building } : null;
  }

  // Binanın səth temperaturları (sadələşdirilmiş): dam, günəşə baxan fasad, kölgədəki fasad.
  _buildingTemps(m, f) {
    const { s, el } = f.sun;
    const evening = clamp((this.hour - 16) / 4, 0, 1);
    const vent = f.air - f.ref;
    const wall = s > 0 ? Math.cos(Math.max(el, 0)) * 0.9 : 0; // şaquli səthə düşən günəş
    return {
      roof: f.air + m.surface * s - vent,
      sunny: f.air + m.surface * wall - vent * 0.6,
      shady: f.air + m.surface * 0.12 * s + m.store * 2 * evening - m.cool - vent * 0.6,
    };
  }

  // Binanın ətrafındakı (12 m) açıq səthin orta temperaturu: indi və obyektsiz baza vəziyyətində.
  _surroundings(b, f) {
    if (this._ringCache?.version !== f.version) this._ringCache = { version: f.version, map: new Map() };
    const cached = this._ringCache.map.get(b.key);
    if (cached) return cached;
    const R = 12;
    let now = 0;
    let before = 0;
    let n = 0;
    let nb = 0;
    this._box(...bounds(b.pts, R), (c, x, y) => {
      if (pointInPolygon({ x, y }, b.pts) || distToPolyline(x, y, b.pts, true) > R) return;
      if (f.kind[c] < KIND.user) { now += f.T[c]; n++; }
      if (this.realIndex[c] < 0) { before += f.base[c]; nb++; }
    });
    const out = { now: n ? now / n : null, before: nb ? before / nb : null };
    this._ringCache.map.set(b.key, out);
    return out;
  }

  _showProbe(x, y) {
    const info = this.probeOn ? this.probe(x, y) : null;
    const el = this.probeEl;
    if (!info) return el.classList.add('hidden');
    const f = this.field;
    const deg = (v) => `${v.toFixed(1)} °C`;
    const signed = (v) => `${v >= 0.05 ? '+' : v <= -0.05 ? '−' : ''}${Math.abs(v).toFixed(1)} °C`;
    const tone = (v) => (v <= -0.1 ? 'cool' : v >= 0.1 ? 'warm' : '');
    const swatch = (t) => {
      const li = Math.round(clamp((t - (this.baseTemp - RANGE_BELOW)) / (RANGE_BELOW + RANGE_ABOVE), 0, 1) * 255) * 3;
      return `rgb(${LUT[li]},${LUT[li + 1]},${LUT[li + 2]})`;
    };
    el.textContent = '';
    const add = (cls, html) => {
      const d = document.createElement('div');
      d.className = cls;
      d.innerHTML = html;
      el.appendChild(d);
      return d;
    };
    const beforeAfter = (before, now) =>
      add('probe-row', `<span>Əvvəl → indi</span><b class="${tone(now - before)}">${before.toFixed(1)} → ${deg(now)}</b>`);
    if (info.building) {
      const b = info.building;
      const m = b.material;
      const t = this._buildingTemps(m, f);
      add('probe-title', '').textContent = b.title;
      add('probe-row', `<span>Hündürlük</span><b>${b.height.toFixed(0)} m${b.levels ? ` · ${Math.round(b.levels)} mərt.` : ''}</b>`);
      add('probe-row', `<span>Material${b.assumed ? ' (fərziyyə)' : ''}</span><b>${m.label} · ${Math.round(m.albedo * 100)} %</b>`);
      add('probe-sep', '');
      add('probe-row', `<span>Dam</span><b>${deg(t.roof)}</b>`);
      add('probe-row', `<span>Günəşli fasad</span><b>${deg(t.sunny)}</b>`);
      add('probe-row', `<span>Kölgəli fasad</span><b>${deg(t.shady)}</b>`);
      if (f.sun.s > 0) add('probe-row', `<span>Kölgə uzunluğu</span><b>${Math.min(b.height * f.invTan, 999).toFixed(0)} m</b>`);
      const around = this._surroundings(b, f);
      if (around.now !== null) {
        add('probe-sep', '');
        if (around.before !== null && Math.abs(around.now - around.before) >= 0.1) {
          add('probe-row', '<span>Ətrafda (12 m), orta</span>');
          beforeAfter(around.before, around.now);
        } else {
          add('probe-row', `<span>Ətrafda (12 m), orta</span><b>${deg(around.now)}</b>`);
        }
      }
    } else {
      const { c } = info;
      const t = f.T[c];
      add('probe-temp', `<span class="probe-swatch" style="background:${swatch(t)}"></span>${t.toFixed(1)} °C`);
      const where = f.shade[c] >= SHADE_BUILDING ? 'Bina kölgəsində' : f.shade[c] >= SHADE_TREE ? 'Ağac kölgəsində' : 'Günəşdə';
      const surface = f.kind[c] === KIND.park ? 'Park' : f.kind[c] === KIND.path ? 'Yol' : 'Açıq səth';
      add('probe-row', `<span>${where}</span><span>${surface}</span>`);
      if (this.wind.speed > 0.2 && f.shelter[c] > 0.5) add('probe-row', '<span>Külək kölgəsində (hava durğundur)</span>');
      const dRef = t - f.ref;
      add('probe-row', `<span>Açıq sahədən fərq</span><b class="${tone(dRef)}">${signed(dRef)}</b>`);
      const dBase = t - f.base[c];
      if (Math.abs(dBase) >= 0.1) {
        add('probe-sep', '');
        beforeAfter(f.base[c], t);
        add('probe-row', `<span>Müdaxilənin təsiri</span><b class="${tone(dBase)}">${signed(dBase)}</b>`);
      }
    }
    el.classList.remove('hidden');
    // Ekranın kənarında tooltip içəri tərəfə çevrilir.
    const p = this._lastPointer;
    if (p) {
      const w = el.offsetWidth + 24;
      const h = el.offsetHeight + 24;
      el.style.left = `${p.cx + w > window.innerWidth ? p.cx - w - 8 : p.cx}px`;
      el.style.top = `${p.cy + h > window.innerHeight ? p.cy - h - 8 : p.cy}px`;
    }
  }
}
