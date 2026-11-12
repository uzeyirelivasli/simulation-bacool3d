import './editor.css';
import { signedArea } from './geometry-utils.js';

const svg = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
const IC = {
  select: svg('<path d="M5 3l14 7-6 2-2 6z"/>'),
  building: svg('<path d="M4 21V7l8-4v18"/><path d="M12 21V10l8 3v8"/><path d="M3 21h18"/><path d="M7.5 10v.01M7.5 14v.01M7.5 18v.01M16 15v.01M16 18v.01"/>'),
  park: svg('<path d="M3 20h18"/><path d="M5 20c0-5 3-8 7-8s7 3 7 8"/><path d="M12 12V7"/><circle cx="12" cy="5" r="2"/>'),
  path: svg('<path d="M5 21c0-6 14-6 14-12 0-3-3-5-7-5"/><path d="M5 21v.01M12 4v.01"/>'),
  tree: svg('<path d="M12 21v-7"/><path d="M12 3a5 5 0 0 0-4.6 7A4 4 0 0 0 9 17h6a4 4 0 0 0 1.6-7A5 5 0 0 0 12 3z"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>'),
  undo: svg('<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 12h-2" transform="translate(0 -4)"/>'),
  redo: svg('<path d="M15 7l5 5-5 5"/><path d="M20 12H10a6 6 0 0 0 0 12h2" transform="translate(0 -4)"/>'),
};

const DRAW_KEYS = ' · Backspace: son nöqtəni sil · Esc: ləğv';
const HINTS = {
  building: `Bina konturunun künclərini klikləyin · Bitir: ikiqat klik / Enter / ilk nöqtə${DRAW_KEYS}`,
  park: `Park sərhədinin künclərini klikləyin · Bitir: ikiqat klik / Enter / ilk nöqtə${DRAW_KEYS}`,
  path: `Yolun nöqtələrini klikləyin · Bitir: ikiqat klik / Enter${DRAW_KEYS}`,
  tree: 'Ağac əkmək üçün klikləyin · Növ və hündürlük sağ paneldə · Esc: çıx',
  place: 'Modeli xəritədə istədiyiniz yerə qoyun (klik) · R / Shift+R: fırlat · Esc: ləğv',
  drop: 'Modeli xəritədə istədiyiniz yerə buraxın',
  selected: 'Sürüklə: yerini dəyiş · R / Shift+R: fırlat · Delete: sil · Ölçü və mərtəbə sağ paneldə',
  delete: 'Silmək üçün yaratdığınız obyektə klikləyin · Esc: çıx',
};

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const opts = (map) => Object.entries(map).map(([k, v]) => [k, typeof v === 'string' ? v : v.label]);
const fmtArea = (n) => `${Math.round(n).toLocaleString('az-AZ')} m²`;

function buildSchemas(cfg) {
  const treeVariants = opts(cfg.treeVariants);
  const treeVariantsMixed = [['mixed', 'Qarışıq'], ...treeVariants];
  const treeHeight = { key: 'treeHeight', label: 'Ağac hündürlüyü, m', type: 'number', min: 2, max: 25, step: 0.5 };
  // geom: true → dəyər props-a yazılmır, həndəsə çevrilir (redaktor vasitəsilə).
  const rotation = { key: 'rotation', label: 'Fırlanma, °', type: 'number', min: 0, max: 359, step: 5, int: true, geom: true, def: 0 };
  const scale = { key: 'scale', label: 'Ölçü, %', type: 'number', min: 40, max: 250, step: 5, int: true, geom: true, def: 100 };
  const ringArea = (obj, geo) => Math.abs(signedArea(obj.geometry.ring.map(([lon, lat]) => geo.lonLatToLocal(lon, lat))));

  return {
    building: {
      title: 'Bina xüsusiyyətləri', icon: IC.building, del: 'Binanı sil',
      fields: [
        { key: 'name', label: 'Ad', type: 'text', wide: true },
        { key: 'buildingType', label: 'Növ', type: 'select', options: opts(cfg.buildingTypes) },
        { key: 'material', label: 'Fasad materialı', type: 'select', options: opts(cfg.materials), def: cfg.defaultMaterial },
        { key: 'floors', label: 'Mərtəbə sayı', type: 'number', min: 1, max: cfg.maxFloors, step: 1, int: true },
        { key: 'height', label: 'Hündürlük, m', type: 'number', min: cfg.minHeightM, max: cfg.maxHeightM, step: 0.5 },
        { key: 'color', label: 'Rəng', type: 'color' },
        { key: 'roofStyle', label: 'Dam', type: 'select', options: opts(cfg.roofStyles) },
        rotation,
        scale,
      ],
      derive(key, v) {
        if (key === 'material') return { color: cfg.materials[v].color };
        if (key === 'floors') return { height: clamp(Math.round(v * cfg.floorHeightM * 10) / 10, cfg.minHeightM, cfg.maxHeightM) };
        if (key === 'height') return { floors: clamp(Math.round(v / cfg.floorHeightM), 1, cfg.maxFloors) };
        return null;
      },
      stats(obj, geo) {
        const area = ringArea(obj, geo);
        const m = cfg.materials[obj.props.material] ?? cfg.materials[cfg.defaultMaterial];
        const level = (v) => (v >= 0.85 ? 'yüksək' : v >= 0.5 ? 'orta' : 'aşağı');
        return [
          ['Kontur sahəsi', fmtArea(area)],
          ['Ümumi mərtəbə sahəsi', fmtArea(area * (obj.props.floors || 1))],
          ['Yansıtma (albedo)', `${Math.round(m.albedo * 100)} %`],
          ['İstilik yığımı', level(m.store)],
        ];
      },
    },
    park: {
      title: 'Park xüsusiyyətləri', icon: IC.park, del: 'Parkı sil',
      fields: [
        { key: 'name', label: 'Ad', type: 'text', wide: true },
        { key: 'surface', label: 'Əsas səth', type: 'select', options: opts(cfg.parkSurfaces) },
        { key: 'grassCoverage', label: 'Ot örtüyü, %', type: 'number', min: 0, max: 100, step: 5 },
        { key: 'treeDensity', label: 'Ağac / 1000 m²', type: 'number', min: 0, max: 20, step: 0.5 },
        treeHeight,
        { key: 'treeVariant', label: 'Ağac növü', type: 'select', options: treeVariantsMixed, wide: true },
        rotation,
        scale,
      ],
      stats(obj, geo) {
        const area = ringArea(obj, geo);
        const trees = Math.min(Math.round((area * (obj.props.treeDensity || 0)) / 1000), cfg.maxTreesPerGroup);
        return [['Sahə', fmtArea(area)], ['Təxmini ağac sayı', `≈ ${trees.toLocaleString('az-AZ')}`]];
      },
    },
    path: {
      title: 'Yol xüsusiyyətləri', icon: IC.path, del: 'Yolu sil',
      fields: [
        { key: 'name', label: 'Ad', type: 'text', wide: true },
        { key: 'pathType', label: 'Növ', type: 'select', options: opts(cfg.pathTypes), wide: true },
        { key: 'width', label: 'En, m', type: 'number', min: 0.5, max: 30, step: 0.5 },
        { key: 'surface', label: 'Səth', type: 'select', options: opts(cfg.pathSurfaces) },
        { key: 'color', label: 'Səth rəngi', type: 'color' },
        { key: 'treeRow', label: 'Ağac cərgəsi', type: 'select', options: opts(cfg.treeRowSides) },
        { key: 'treeSpacing', label: 'Ağac aralığı, m', type: 'number', min: 2, max: 60, step: 0.5 },
        treeHeight,
        { key: 'treeVariant', label: 'Ağac növü', type: 'select', options: treeVariantsMixed, wide: true },
      ],
      derive(key, v) {
        if (key === 'pathType') {
          const def = cfg.pathTypes[v];
          const patch = { surface: def.surface, color: cfg.pathSurfaces[def.surface].color };
          if (def.width > 0) patch.width = def.width;
          return patch;
        }
        if (key === 'surface') return { color: cfg.pathSurfaces[v].color };
        return null;
      },
      stats(obj, geo) {
        const pts = obj.geometry.line.map(([lon, lat]) => geo.lonLatToLocal(lon, lat));
        let len = 0;
        for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        return [['Uzunluq', `${Math.round(len).toLocaleString('az-AZ')} m`]];
      },
    },
    tree: {
      title: 'Ağac xüsusiyyətləri', icon: IC.tree, del: 'Ağacı sil',
      fields: [
        { key: 'name', label: 'Ad', type: 'text', wide: true },
        { key: 'variant', label: 'Növ', type: 'select', options: treeVariants },
        { key: 'height', label: 'Hündürlük, m', type: 'number', min: 2, max: 25, step: 0.5 },
      ],
    },
    treeBrush: {
      title: 'Yeni ağac ayarları', icon: IC.tree,
      fields: [
        { key: 'variant', label: 'Növ', type: 'select', options: treeVariantsMixed },
        { key: 'height', label: 'Hündürlük, m', type: 'number', min: 2, max: 25, step: 0.5 },
      ],
    },
  };
}

export class EditorUI {
  constructor(root, editor, store, geo, config) {
    this.root = root;
    this.editor = editor;
    this.store = store;
    this.geo = geo;
    this.schemas = buildSchemas(config.editor);
    this.schemaKey = null;
    this.target = null; // { kind: 'object', id } | { kind: 'brush' }
    this._renderToolbar();
    this._renderProps();
    editor.on('tool', (name) => { this._onTool(name); this._refreshTarget(); });
    editor.on('selection', () => { this._refreshTarget(); this._onTool(this.editor.tool); });
    editor.on('change', (change) => this._onChange(change));
    this._syncHistory();
  }

  _renderToolbar() {
    this.toolbar = document.createElement('nav');
    this.toolbar.className = 'toolbar';
    this.toolbar.innerHTML = `
      <button data-tool="select" class="on" title="Seç (Esc)">${IC.select}<span>Seç</span></button>
      <button data-tool="path" title="Yol / cığır / ağac cərgəsi əlavə et">${IC.path}<span>Yol</span></button>
      <button data-tool="tree" title="Ağac ək">${IC.tree}<span>Ağac</span></button>
      <button data-tool="delete" title="Sil">${IC.trash}<span>Sil</span></button>
      <div class="dock-sep"></div>
      <button data-cmd="undo" title="Geri al (Ctrl+Z)" aria-label="Geri al">${IC.undo}</button>
      <button data-cmd="redo" title="Təkrarla (Ctrl+Y)" aria-label="Təkrarla">${IC.redo}</button>`;
    this.hint = document.createElement('div');
    this.hint.className = 'tool-hint hidden';
    this.root.append(this.toolbar, this.hint);
    this.toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn || btn.disabled) return;
      if (btn.dataset.tool) this.editor.setTool(btn.dataset.tool);
      else if (btn.dataset.cmd === 'undo') this.editor.undo();
      else if (btn.dataset.cmd === 'redo') this.editor.redo();
    });
  }

  _renderProps() {
    this.props = document.createElement('section');
    this.props.className = 'section first props hidden';
    (this.root.querySelector('.panel-right') ?? this.root).prepend(this.props);
    this.props.addEventListener('input', (e) => this._onInput(e.target));
    this.props.addEventListener('change', () => this._resync(false));
    this.props.addEventListener('click', (e) => {
      if (e.target.closest('[data-cmd="delete-selected"]')) this.editor.deleteSelected();
    });
  }

  // Forma yalnız konfiqurasiyadakı sabit mətnlərdən qurulur; istifadəçi mətni .value ilə yazılır.
  _renderForm(key) {
    const schema = this.schemas[key];
    const field = (f) => {
      const cls = f.wide ? ' class="wide"' : '';
      let control;
      if (f.type === 'select') {
        control = `<select data-f="${f.key}">${f.options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
      } else if (f.type === 'number') {
        control = `<input data-f="${f.key}" type="number" min="${f.min}" max="${f.max}" step="${f.step}" />`;
      } else if (f.type === 'color') {
        control = `<input data-f="${f.key}" type="color" />`;
      } else {
        control = `<input data-f="${f.key}" type="text" maxlength="60" autocomplete="off" />`;
      }
      return `<label${cls}>${f.label}${control}</label>`;
    };
    this.props.innerHTML = `
      <h3>${schema.icon}${schema.title}</h3>
      <div class="form grid2">
        ${schema.fields.map(field).join('')}
        ${schema.stats ? '<dl class="kv wide" data-el="stats"></dl>' : ''}
        ${schema.del ? `<button class="btn danger wide" data-cmd="delete-selected">${schema.del}</button>` : ''}
      </div>`;
    this.schemaKey = key;
  }

  _refreshTarget() {
    const id = this.editor.selectedId;
    const obj = id ? this.store.get(id) : null;
    let key = null;
    if (obj && this.schemas[obj.type]) {
      key = obj.type;
      this.target = { kind: 'object', id };
    } else if (this.editor.tool === 'tree') {
      key = 'treeBrush';
      this.target = { kind: 'brush' };
    } else {
      this.target = null;
    }
    this.props.classList.toggle('hidden', !key);
    if (!key) return;
    if (this.schemaKey !== key) this._renderForm(key);
    this._resync(false);
  }

  _resync(skipActive) {
    if (!this.target) return;
    if (this.target.kind === 'brush') return this._sync(this.editor.treeBrush, null, skipActive);
    const obj = this.store.get(this.target.id);
    if (obj) this._sync(obj.props, obj, skipActive);
  }

  // skipActive: istifadəçinin hazırda yazdığı sahəyə toxunma
  _sync(values, obj, skipActive) {
    const schema = this.schemas[this.schemaKey];
    for (const el of this.props.querySelectorAll('[data-f]')) {
      if (skipActive && el === document.activeElement) continue;
      const v = values[el.dataset.f] ?? schema.fields.find((f) => f.key === el.dataset.f)?.def;
      if (v !== undefined && String(el.value) !== String(v)) el.value = v;
    }
    const stats = this.props.querySelector('[data-el="stats"]');
    if (stats && obj && schema.stats) {
      stats.textContent = '';
      for (const [label, value] of schema.stats(obj, this.geo)) {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.className = 'mono';
        dd.textContent = value;
        stats.append(dt, dd);
      }
    }
  }

  _onInput(el) {
    const key = el.dataset.f;
    const schema = this.schemas[this.schemaKey];
    const field = schema?.fields.find((f) => f.key === key);
    if (!field || !this.target) return;
    let value;
    if (field.type === 'number') {
      const n = field.int ? parseInt(el.value, 10) : parseFloat(el.value);
      if (!Number.isFinite(n)) return;
      value = clamp(n, field.min, field.max);
    } else if (field.type === 'select') {
      if (!field.options.some(([v]) => v === el.value)) return;
      value = el.value;
    } else if (field.type === 'color') {
      if (!/^#[0-9a-f]{6}$/i.test(el.value)) return;
      value = el.value;
    } else {
      value = el.value.slice(0, 60);
    }
    if (field.geom) {
      if (this.target.kind !== 'object') return;
      if (key === 'rotation') this.editor.setRotation(this.target.id, value);
      else if (key === 'scale') this.editor.setScale(this.target.id, value);
      return;
    }
    const patch = { [key]: value, ...(schema.derive?.(key, value) ?? {}) };
    if (this.target.kind === 'brush') {
      Object.assign(this.editor.treeBrush, patch);
    } else {
      this.store.update(this.target.id, patch, `${this.target.id}:${key}`);
    }
  }

  _onTool(name) {
    this.toolbar.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === name));
    let key = name;
    if (name === 'select' && this.editor.selectedId) key = 'selected';
    else if (name === 'place' && this.editor.placing?.viaDrag) key = 'drop';
    this.hint.textContent = HINTS[key] ?? '';
    this.hint.classList.toggle('hidden', !HINTS[key]);
  }

  _onChange(change) {
    this._syncHistory();
    if (change.kind === 'set' && this.target?.kind === 'object' && change.id === this.target.id) {
      this._sync(change.object.props, change.object, change.source === 'edit');
    }
  }

  _syncHistory() {
    this.toolbar.querySelector('[data-cmd="undo"]').disabled = !this.store.canUndo;
    this.toolbar.querySelector('[data-cmd="redo"]').disabled = !this.store.canRedo;
  }
}