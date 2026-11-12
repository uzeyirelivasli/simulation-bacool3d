import { CITY_MODES } from './city-environment.js';

const svg = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;

export const ICON = {
  logo: svg('<path d="M3 21h18"/><path d="M5 21V10l4-2.5V21"/><path d="M9 21V5l6 3v13"/><path d="M15 21v-9l4-1.5V21"/>'),
  pin: svg('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  steps: svg('<path d="M4 6h16M4 12h10M4 18h6"/>'),
  gauge: svg('<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4.5-5.5"/><circle cx="12" cy="17" r="1"/>'),
  layers: svg('<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>'),
  orbit: svg('<circle cx="12" cy="12" r="2.5"/><ellipse cx="12" cy="12" rx="9.5" ry="4.5"/>'),
  plan: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M12 4v16"/>'),
  eye: svg('<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  expand: svg('<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  compass: svg('<circle cx="12" cy="12" r="9"/><path d="M12 6l2.6 6H9.4z"/><path d="M12 12v6"/>'),
  key: svg('<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l2.5 2.5M14.5 8.5L16 10"/>'),
  alert: svg('<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5h.01"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
};

const MODE_INFO = {
  [CITY_MODES.GOOGLE]: {
    label: 'Google Fotorealistik 3D',
    tone: 'ok',
    note: 'Real fotorealistik şəhər modeli. Mövcud binalar kontekstdir və redaktə edilmir.',
  },
  [CITY_MODES.ION_OSM]: {
    label: 'OSM 3D Binalar · Cesium ion',
    tone: 'warn',
    note: 'Development rejimi — fotorealistik deyil.',
  },
  [CITY_MODES.OSM_DEV]: {
    label: 'Şəhər maketi · OpenStreetMap',
    tone: 'ok',
    note: 'Real bina konturlarından qurulmuş ağ maket.',
  },
};

export class Interface {
  constructor(root, config) {
    this.root = root;
    this.config = config;
    this.handlers = {};
    this._render();
    this._bind();
  }

  on(event, fn) {
    (this.handlers[event] ??= []).push(fn);
  }

  _emit(event, payload) {
    for (const fn of this.handlers[event] ?? []) fn(payload);
  }

  _el(name) {
    return this.root.querySelector(`[data-el="${name}"]`);
  }

  _render() {
    const { origin, areas, quality, time } = this.config;
    const a = areas.activeSizeM / 1000;
    const c = areas.contextSizeM / 1000;
    this.root.innerHTML = `
      <div class="splash" data-el="splash">
        <div class="splash-inner">
          <div class="brand-mark lg"><img src="logo.png" alt="" /></div>
          <div class="splash-title">BACOOL</div>
          <div class="splash-sub" data-el="splash-text">Bakının 3D modeli hazırlanır…</div>
          <div class="splash-bar"><span></span></div>
        </div>
      </div>
      <aside class="panel panel-left">
        <a class="brand" href="index.html" title="Təqdimat səhifəsinə qayıt">
          <div class="brand-mark"><img src="logo.png" alt="Bacool" /></div>
          <div><div class="brand-title">BACOOL</div><div class="brand-sub">Şəhər istiliyi və kölgə simulyatoru</div></div>
        </a>
        <div class="mode-badge" data-el="mode"><span class="dot"></span><span data-el="mode-label">Qoşulur…</span></div>
        <p class="mode-note" data-el="mode-note"></p>
        <section class="section catalog" data-el="catalog"></section>
        <details class="section fold">
          <summary><h3>${ICON.pin}Məkan</h3></summary>
          <dl class="kv">
            <dt>Coğrafi en</dt><dd class="mono">${origin.latitude.toFixed(4)}°</dd>
            <dt>Coğrafi uzunluq</dt><dd class="mono">${origin.longitude.toFixed(4)}°</dd>
            <dt>Aktiv dizayn zonası</dt><dd class="mono">${a} × ${a} km</dd>
            <dt>Kontekst zonası</dt><dd class="mono">${c} × ${c} km</dd>
            <dt>Yer səthi (ellipsoid)</dt><dd class="mono" data-el="ground">ölçülür…</dd>
            <dt>Koordinat sistemi</dt><dd>Lokal ENU, metr</dd>
            <dt>Vaxt qurşağı</dt><dd class="mono">UTC+${time.utcOffsetHours}</dd>
          </dl>
        </details>
      </aside>
      <aside class="panel panel-right">
        <section class="section first">
          <h3>${ICON.layers}Qatlar</h3>
          <label class="toggle"><input type="checkbox" data-toggle="shadows" checked /><span class="switch"></span>Kölgələr</label>
          <label class="toggle"><input type="checkbox" data-toggle="active" checked /><span class="switch"></span>Aktiv zona</label>
          <label class="toggle"><input type="checkbox" data-toggle="context" checked /><span class="switch"></span>Kontekst sərhədi</label>
          <label class="toggle" data-el="clip-row"><input type="checkbox" data-toggle="clip" /><span class="switch"></span>Kontekstdən kənarı gizlət</label>
        </section>
        <details class="section fold">
          <summary><h3>${ICON.gauge}Performans</h3></summary>
          <div class="metrics">
            <div class="metric"><div class="metric-val mono" data-el="fps">—</div><div class="metric-lbl">kadr/san</div></div>
            <div class="metric"><div class="metric-val mono" data-el="pending">—</div><div class="metric-lbl">gözləyən tayl</div></div>
            <div class="metric"><div class="metric-val mono" data-el="memory">—</div><div class="metric-lbl">yaddaş, MB</div></div>
          </div>
          <div class="field-label">Detal səviyyəsi</div>
          <div class="segmented">
            ${Object.entries(quality.presets).map(([k, p]) =>
              `<button data-quality="${k}" class="${k === quality.default ? 'on' : ''}">${p.label}</button>`).join('')}
          </div>
          <p class="hint">Səhnə yalnız dəyişiklik olduqda render olunur. Boş vəziyyətdə kadr sayının 0 olması normaldır.</p>
        </details>
      </aside>
      <nav class="dock">
        <button data-view="overview" class="on" title="Ümumi görünüş">${ICON.orbit}<span>Ümumi</span></button>
        <button data-view="top" title="Yuxarıdan plan görünüşü">${ICON.plan}<span>Plan</span></button>
        <button data-view="close" title="Yaxın plan">${ICON.eye}<span>Yaxın</span></button>
        <button data-view="context" title="Geniş kontekst">${ICON.expand}<span>Kontekst</span></button>
        <div class="dock-sep"></div>
        <button data-action="zoom-in" title="Yaxınlaşdır">${ICON.plus}</button>
        <button data-action="zoom-out" title="Uzaqlaşdır">${ICON.minus}</button>
        <button data-action="north" title="Şimala yönəlt">${ICON.compass}</button>
      </nav>
      <div class="toasts" data-el="toasts"></div>
      <div class="modal-backdrop hidden" data-el="modal"></div>
    `;
  }

  _bind() {
    this.root.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const { view, quality, action } = btn.dataset;
      if (view) {
        this.root.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b === btn));
        this._emit('view', view);
      } else if (quality) {
        this.root.querySelectorAll('[data-quality]').forEach((b) => b.classList.toggle('on', b === btn));
        this._emit('quality', quality);
      } else if (action === 'zoom-in') this._emit('zoom', +1);
      else if (action === 'zoom-out') this._emit('zoom', -1);
      else if (action === 'north') this._emit('north');
      else if (action === 'close-modal') this.hideModal();
      else if (action === 'dismiss') btn.closest('.toast')?.remove();
    });
    this.root.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.toggle) this._emit('toggle', { id: t.dataset.toggle, value: t.checked });
    });
  }

  setMode(mode, { buildingCount } = {}) {
    const info = MODE_INFO[mode];
    if (!info) return;
    this._el('mode').className = `mode-badge ${info.tone}`;
    this._el('mode-label').textContent = info.label;
    this._el('mode-note').textContent =
      mode === CITY_MODES.OSM_DEV && buildingCount
        ? `${info.note} ${buildingCount.toLocaleString('az-AZ')} bina konturu.`
        : info.note;
  }

  setGround(height, measured) {
    this._el('ground').textContent = `${height.toFixed(1)} m${measured ? '' : ' (təxmini)'}`;
  }

  setTelemetry({ fps, pending, memoryMB }) {
    this._el('fps').textContent = fps === 0 ? 'boşda' : String(fps);
    this._el('pending').textContent = pending == null ? '—' : String(pending);
    this._el('memory').textContent = memoryMB == null ? '—' : memoryMB.toFixed(0);
  }

  setSplashText(text) {
    const el = this._el('splash-text');
    if (el) el.textContent = text;
  }

  setPendingTiles(n) {
    if (this._el('splash') && n > 0) this.setSplashText(`3D tayllar axınla yüklənir · ${n} gözləyir`);
  }

  hideSplash() {
    const el = this._el('splash');
    if (!el || el.classList.contains('gone')) return;
    el.classList.add('gone');
    setTimeout(() => el.remove(), 900);
  }

  disableToggle(id, reason) {
    const input = this.root.querySelector(`[data-toggle="${id}"]`);
    if (!input) return;
    input.disabled = true;
    const label = input.closest('.toggle');
    label.classList.add('disabled');
    label.title = reason;
  }

  showSetupModal() {
    const modal = this._el('modal');
    modal.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div class="modal-icon">${ICON.key}</div>
          <div>
            <h2>Google Maps API açarı tapılmadı</h2>
            <p>Fotorealistik Bakı modeli üçün Map Tiles API açarı lazımdır. Hazırda tətbiq development rejimində, OpenStreetMap məlumatları ilə işləyir.</p>
          </div>
        </div>
        <ol class="steps">
          <li>Google Cloud Console-da layihə yaradın və billing hesabını qoşun.</li>
          <li><b>Map Tiles API</b> xidmətini aktiv edin.</li>
          <li>API açarı yaradın və onu məhdudlaşdırın: <i>HTTP referrer</i> (məs. <code>http://localhost:5173/*</code>) və yalnız <i>Map Tiles API</i>.</li>
          <li>Layihə qovluğunda <code>.env.local</code> faylı yaradın:<pre>VITE_GOOGLE_MAPS_API_KEY=sizin_açarınız</pre></li>
          <li>Dev serveri yenidən başladın: <code>npm run dev</code></li>
        </ol>
        <div class="modal-actions">
          <a class="btn ghost" href="https://developers.google.com/maps/documentation/tile/3d-tiles" target="_blank" rel="noopener">Sənədlər</a>
          <button class="btn primary" data-action="close-modal">Development rejimində davam et</button>
        </div>
      </div>`;
    modal.classList.remove('hidden');
  }

  hideModal() {
    this._el('modal').classList.add('hidden');
  }

  toast(message, tone = 'info', { title, persistent = false } = {}) {
    const el = document.createElement('div');
    el.className = `toast ${tone}`;
    el.innerHTML = `${tone === 'info' ? ICON.info : ICON.alert}
      <div class="toast-body"><b></b><span></span></div>
      <button data-action="dismiss" aria-label="Bağla">${ICON.close}</button>`;
    const b = el.querySelector('b');
    if (title) b.textContent = title;
    else b.remove();
    el.querySelector('span').textContent = message;
    this._el('toasts').appendChild(el);
    if (!persistent) setTimeout(() => el.remove(), 7000);
  }

  showError(title, message, { persistent = true } = {}) {
    this.toast(message, 'error', { title, persistent });
  }
}
