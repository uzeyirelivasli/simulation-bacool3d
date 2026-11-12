// Külək animasiyası: binaların ətrafından axan, sürətə görə rənglənən axın xətləri.
//
// Axın sahəsi: aktiv zonada 8 m-lik şəbəkədə potensial axın (Laplas tənliyi, binalar keçilməz maneədir).
// Bu, tam CFD deyil — burulğanlar yoxdur — amma axının binaların ətrafından dolanmasını və dar keçidlərdə
// sürətlənməsini düzgün göstərir. Binaların arxasındakı zəifləmə istilik modelinin "külək kölgəsi"ndən götürülür.
//
// Çəkiliş: Cesium səhnəsinin üstündə ayrıca 2D canvas. Səhnə özü yenidən render olunmur (kölgə xəritəsi bahalıdır),
// hissəciklər hər kadrda kameranın cari matrisi ilə ekrana proyeksiya edilir.

const Cesium = window.Cesium;

const HEAT_N = 250; // istilik şəbəkəsi (heatmap.js ilə eyni)
const G = 125; // axın şəbəkəsi: 125 × 125 xana (8 m)
const RATIO = HEAT_N / G;
const SOLVE_ITERATIONS = 260;
const OMEGA = 1.86; // SOR relaksasiya əmsalı
const PARTICLES = 720;
const TRAIL = 46; // iz nöqtələrinin sayı
const SAMPLE_MS = 30; // iz nöqtələri arasındakı vaxt
const FLOW_HEIGHT_M = 10; // xətlərin yerdən hündürlüyü
const BUILDING = 3; // KIND.user və yuxarı = bina

// Sürət nisbəti (lokal / sərbəst axın) → rəng. Yavaş (külək kölgəsi) → sürətli (dar keçid).
const COLORS = ['#38bdf8', '#34d399', '#fde047', '#fb923c', '#f43f5e'];
const bucketOf = (r) => (r < 0.45 ? 0 : r < 0.8 ? 1 : r < 1.15 ? 2 : r < 1.5 ? 3 : 4);

export class WindFlow {
  constructor({ viewer, geo, heatmap, size }) {
    this.viewer = viewer;
    this.geo = geo;
    this.heatmap = heatmap;
    this.half = size / 2;
    this.cell = size / G;
    this.enabled = true;
    this.wind = { dx: 0, dy: -1, speed: 0 };
    this.vx = new Float32Array(G * G);
    this.vy = new Float32Array(G * G);
    this.slow = new Float32Array(G * G); // 0…1: külək kölgəsinin gücü
    this.blocked = new Uint8Array(G * G);
    this.ready = false;
    this._key = '';
    this._raf = 0;
    this._last = 0;
    this._acc = 0;
    this._matrix = new Cesium.Matrix4();
    this._vp = new Cesium.Matrix4();

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'wind-canvas';
    viewer.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this._resize();
    new ResizeObserver(() => this._resize()).observe(viewer.container);
    document.addEventListener('visibilitychange', () => this._sync());

    // Hissəciklər: mövqe (lokal metr) + dairəvi iz buferi.
    this.px = new Float32Array(PARTICLES);
    this.py = new Float32Array(PARTICLES);
    this.age = new Float32Array(PARTICLES);
    this.life = new Float32Array(PARTICLES);
    this.ratio = new Float32Array(PARTICLES);
    this.tx = new Float32Array(PARTICLES * TRAIL);
    this.ty = new Float32Array(PARTICLES * TRAIL);
    this.tn = new Uint8Array(PARTICLES); // izdəki nöqtələrin sayı
    this.th = new Uint8Array(PARTICLES); // ən yeni nöqtənin indeksi
    for (let p = 0; p < PARTICLES; p++) this._spawn(p, true);
  }

  setEnabled(on) {
    this.enabled = Boolean(on);
    this._sync();
  }

  // İstilik modeli hər hesablamadan sonra çağırır: field.kind (binalar) və field.shelter (külək kölgəsi).
  update(field, wind) {
    this.wind = wind;
    if (!field || wind.speed <= 0.2) {
      this._sync();
      return;
    }
    // Axın yalnız istiqamət və ya binalar dəyişəndə yenidən hesablanır (saat dəyişəndə yox).
    let sig = 0;
    const { kind } = field;
    for (let c = 0; c < kind.length; c++) if (kind[c] >= BUILDING) sig = (sig + c * 31 + 7) | 0;
    const key = `${wind.dx},${wind.dy}|${sig}`;
    if (key !== this._key) {
      this._key = key;
      this._solve(field, wind);
    }
    this._sync();
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = this.viewer.container.clientWidth;
    const h = this.viewer.container.clientHeight;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.dpr = dpr;
    this.w = w;
    this.h = h;
  }

  // Potensial axın: ∇²φ = 0; maneələrin divarında axın keçmir, sərhəddə bircins külək.
  _solve(field, wind) {
    const { kind, shelter } = field;
    const { blocked, slow, vx, vy } = this;
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        let b = 0;
        let s = 0;
        for (let dj = 0; dj < RATIO; dj++) {
          for (let di = 0; di < RATIO; di++) {
            const c = (j * RATIO + dj) * HEAT_N + i * RATIO + di;
            if (kind[c] >= BUILDING) b = 1;
            s += shelter[c];
          }
        }
        blocked[j * G + i] = b;
        slow[j * G + i] = s / (RATIO * RATIO);
      }
    }
    const len = Math.hypot(wind.dx, wind.dy) || 1;
    const ux = wind.dx / len;
    const uy = wind.dy / len;
    const phi = new Float32Array(G * G);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) phi[j * G + i] = i * ux + j * uy;
    for (let it = 0; it < SOLVE_ITERATIONS; it++) {
      for (let j = 1; j < G - 1; j++) {
        for (let i = 1; i < G - 1; i++) {
          const c = j * G + i;
          if (blocked[c]) continue;
          let sum = 0;
          let n = 0;
          if (!blocked[c - 1]) { sum += phi[c - 1]; n++; }
          if (!blocked[c + 1]) { sum += phi[c + 1]; n++; }
          if (!blocked[c - G]) { sum += phi[c - G]; n++; }
          if (!blocked[c + G]) { sum += phi[c + G]; n++; }
          if (n) phi[c] += OMEGA * (sum / n - phi[c]);
        }
      }
    }
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const c = j * G + i;
        if (blocked[c]) { vx[c] = 0; vy[c] = 0; continue; }
        const l = i > 0 && !blocked[c - 1] ? phi[c - 1] : phi[c];
        const r = i < G - 1 && !blocked[c + 1] ? phi[c + 1] : phi[c];
        const d = j > 0 && !blocked[c - G] ? phi[c - G] : phi[c];
        const u = j < G - 1 && !blocked[c + G] ? phi[c + G] : phi[c];
        const wx = i > 0 && i < G - 1 && !blocked[c - 1] && !blocked[c + 1] ? 2 : 1;
        const wy = j > 0 && j < G - 1 && !blocked[c - G] && !blocked[c + G] ? 2 : 1;
        vx[c] = (r - l) / wx;
        vy[c] = (u - d) / wy;
      }
    }
    this.ready = true;
  }

  _spawn(p, anywhere = false) {
    const { half } = this;
    for (let tries = 0; tries < 12; tries++) {
      const x = (Math.random() * 2 - 1) * half;
      const y = (Math.random() * 2 - 1) * half;
      const c = this._cellOf(x, y);
      if (c >= 0 && !this.blocked[c]) {
        this.px[p] = x;
        this.py[p] = y;
        break;
      }
    }
    this.age[p] = anywhere ? Math.random() * 5 : 0;
    this.life[p] = 5 + Math.random() * 6;
    this.tn[p] = 0;
    this.th[p] = 0;
    this.ratio[p] = 1;
  }

  _cellOf(x, y) {
    const i = Math.floor((x + this.half) / this.cell);
    const j = Math.floor((y + this.half) / this.cell);
    return i < 0 || i >= G || j < 0 || j >= G ? -1 : j * G + i;
  }

  _sync() {
    const active = this.enabled && this.ready && this.wind.speed > 0.2 && document.visibilityState === 'visible';
    if (active && !this._raf) {
      this._last = performance.now();
      this._raf = requestAnimationFrame((t) => this._frame(t));
    } else if (!active && this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
    if (!active) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _frame(now) {
    this._raf = requestAnimationFrame((t) => this._frame(t));
    const dt = Math.min((now - this._last) / 1000, 0.05);
    this._last = now;
    this._acc += dt * 1000;
    const sample = this._acc >= SAMPLE_MS;
    if (sample) this._acc = 0;

    // Görünən sürət: real sürətdən asılıdır, amma zəif küləkdə də hərəkət seçilir.
    const pace = 16 + this.wind.speed * 6.5;
    const { px, py, vx, vy, slow, blocked, half, cell } = this;
    for (let p = 0; p < PARTICLES; p++) {
      const c = this._cellOf(px[p], py[p]);
      if (c < 0 || blocked[c] || (this.age[p] += dt) > this.life[p]) {
        this._spawn(p);
        continue;
      }
      // Ətraf xanalarla ikixətli interpolyasiya → hamar əyrilər.
      const gx = (px[p] + half) / cell - 0.5;
      const gy = (py[p] + half) / cell - 0.5;
      const i0 = Math.min(Math.max(Math.floor(gx), 0), G - 2);
      const j0 = Math.min(Math.max(Math.floor(gy), 0), G - 2);
      const fx = Math.min(Math.max(gx - i0, 0), 1);
      const fy = Math.min(Math.max(gy - j0, 0), 1);
      const a = j0 * G + i0;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const ux = vx[a] * w00 + vx[a + 1] * w10 + vx[a + G] * w01 + vx[a + G + 1] * w11;
      const uy = vy[a] * w00 + vy[a + 1] * w10 + vy[a + G] * w01 + vy[a + G + 1] * w11;
      const damp = 1 - 0.78 * slow[c];
      const r = Math.hypot(ux, uy) * damp;
      this.ratio[p] += (r - this.ratio[p]) * 0.2;
      const k = pace * dt * Math.max(damp, 0.12);
      px[p] += ux * k;
      py[p] += uy * k;
      if (sample) {
        const h = (this.th[p] + 1) % TRAIL;
        this.th[p] = h;
        this.tx[p * TRAIL + h] = px[p];
        this.ty[p * TRAIL + h] = py[p];
        if (this.tn[p] < TRAIL) this.tn[p]++;
      }
    }
    this._draw();
  }

  _draw() {
    const { ctx, w, h, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cam = this.viewer.camera;
    // Lokal ENU → ekran: proyeksiya · görünüş · (ENU → Yer mərkəzli) — kadr başına bir matris.
    Cesium.Matrix4.multiply(cam.frustum.projectionMatrix, cam.viewMatrix, this._vp);
    const m = Cesium.Matrix4.multiply(this._vp, this.geo.enuToFixed, this._matrix);
    const z = FLOW_HEIGHT_M;
    const m0 = m[0]; const m4 = m[4]; const m12 = m[8] * z + m[12];
    const m1 = m[1]; const m5 = m[5]; const m13 = m[9] * z + m[13];
    const m3 = m[3]; const m7 = m[7]; const m15 = m[11] * z + m[15];
    const hw = w / 2;
    const hh = h / 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Üç keçid: tünd haşiyə (istilik xəritəsinin üstündə də seçilsin), bütün iz (solğun) və ön yarısı (parlaq).
    for (let pass = -1; pass < 2; pass++) {
      const count = pass === 1 ? Math.ceil(TRAIL * 0.45) : TRAIL;
      ctx.globalAlpha = pass < 0 ? 0.3 : pass === 0 ? 0.4 : 0.95;
      ctx.lineWidth = pass < 0 ? 3.6 : pass === 0 ? 1.5 : 2.2;
      for (let b = 0; b < COLORS.length; b++) {
        ctx.strokeStyle = pass < 0 ? '#000' : COLORS[b];
        ctx.beginPath();
        for (let p = 0; p < PARTICLES; p++) {
          if (bucketOf(this.ratio[p]) !== b) continue;
          const n = Math.min(this.tn[p], count);
          if (n < 2) continue;
          // Ömrün əvvəlində və sonunda xətt qısalır (qəfil yaranıb-itməsin).
          const fade = Math.min(1, this.age[p] / 0.5, (this.life[p] - this.age[p]) / 0.7);
          const use = Math.max(2, Math.round(n * Math.max(fade, 0.15)));
          let started = false;
          for (let q = 0; q < use; q++) {
            const idx = p * TRAIL + ((this.th[p] - q + TRAIL) % TRAIL);
            const x = this.tx[idx];
            const y = this.ty[idx];
            const cw = m3 * x + m7 * y + m15;
            if (cw <= 0.01) { started = false; continue; }
            const sx = hw + ((m0 * x + m4 * y + m12) / cw) * hw;
            const sy = hh - ((m1 * x + m5 * y + m13) / cw) * hh;
            if (started) ctx.lineTo(sx, sy);
            else { ctx.moveTo(sx, sy); started = true; }
          }
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
}
