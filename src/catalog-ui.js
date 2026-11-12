import './catalog.css';
import { BUILDING_MODELS, PARK_MODELS, modelThumb } from './catalog.js';

const Cesium = window.Cesium;

// 1 × 1 şəffaf şəkil: brauzerin standart "sürükləmə kölgəsi" əvəzinə xəritədə 3D önbaxış görünür.
const BLANK = new Image();
BLANK.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const card = (m) => `
  <div class="model-card" role="button" tabindex="0" draggable="true" data-model="${m.id}" title="${m.label} — sürükləyib xəritəyə buraxın">
    ${modelThumb(m)}
    <span class="model-name">${m.label}</span>
    <span class="model-meta">${m.kind === 'building' ? `${m.floors} mərtəbə · ` : ''}${m.size.replace(/ × /g, '×')}</span>
  </div>`;

const drawCard = (tool, label) => `
  <div class="model-card draw" role="button" tabindex="0" data-draw="${tool}" title="Küncləri klikləyərək sərbəst kontur çəkin">
    <svg class="thumb" viewBox="0 0 104 70" width="104" height="70" aria-hidden="true">
      <polygon points="22,48 40,20 78,16 86,44 54,56" fill="rgba(255,255,255,0.08)" stroke="#ffffff" stroke-width="1.4" stroke-dasharray="4 3" stroke-linejoin="round"/>
      <g fill="#ffffff" stroke="none"><circle cx="22" cy="48" r="2.6"/><circle cx="40" cy="20" r="2.6"/><circle cx="78" cy="16" r="2.6"/><circle cx="86" cy="44" r="2.6"/><circle cx="54" cy="56" r="2.6"/></g>
    </svg>
    <span class="model-name">${label}</span>
    <span class="model-meta">kliklə çək</span>
  </div>`;

// Model kataloqu: kartı xəritəyə sürükləyib buraxmaq (və ya karta, sonra xəritəyə klikləmək) kifayətdir.
export class CatalogUI {
  constructor({ root, viewer, editor, store }) {
    this.viewer = viewer;
    this.editor = editor;
    this.store = store;
    this._raf = 0;
    this._pos = new Cesium.Cartesian2();

    const host = root.querySelector('[data-el="catalog"]') ?? root;
    host.innerHTML = `
      <h3><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>Model kataloqu</h3>
      <p class="hint catalog-hint">Kartı <b>sürükləyib xəritəyə buraxın</b>. Yerləşdirdikdən sonra obyekti sürükləyərək daşıya, <b>R</b> ilə fırlada bilərsiniz.</p>
      <div class="catalog-tabs segmented">
        <button data-tab="building" class="on">Binalar</button>
        <button data-tab="park">Parklar</button>
      </div>
      <div class="catalog-grid" data-grid="building">${BUILDING_MODELS.map(card).join('')}${drawCard('building', 'Sərbəst bina')}</div>
      <div class="catalog-grid hidden" data-grid="park">${PARK_MODELS.map(card).join('')}${drawCard('park', 'Sərbəst park')}</div>
      <button class="btn ghost catalog-clear" data-cmd="clear-all">Bütün obyektləri sil</button>`;
    this.el = host;
    this._bind();
    editor.on('tool', () => this._syncActive());
    store.subscribe(() => this._syncClear());
    this._syncClear();
  }

  _bind() {
    const { el, editor } = this;
    el.addEventListener('click', (e) => {
      e.stopPropagation(); // interface.js-in ümumi düymə idarəçisinə düşməsin
      const btn = e.target.closest('[data-tab], [data-model], [data-draw], [data-cmd]');
      if (!btn || btn.disabled) return;
      if (btn.dataset.tab) {
        el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b === btn));
        el.querySelectorAll('[data-grid]').forEach((g) => g.classList.toggle('hidden', g.dataset.grid !== btn.dataset.tab));
      } else if (btn.dataset.model) {
        // Klik rejimi: kartı seç → xəritədə kliklə (trekpad və toxunma ekranları üçün).
        if (editor.placing?.model.id === btn.dataset.model) editor.cancelPlace();
        else editor.beginPlace(btn.dataset.model);
      } else if (btn.dataset.draw) {
        editor.setTool(editor.tool === btn.dataset.draw ? 'select' : btn.dataset.draw);
      } else if (btn.dataset.cmd === 'clear-all') {
        if (this.store.all().length && window.confirm('Əlavə etdiyiniz bütün obyektlər silinsin? Bu əməliyyat geri qaytarılmır.')) {
          editor.setTool('select');
          this.store.clearAll();
        }
      }
    });

    // Kartlar <div role="button">-dur (Firefox <button> elementlərini sürükləməyə icazə vermir).
    el.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.model-card')) {
        e.preventDefault();
        e.target.click();
      }
    });
    el.addEventListener('dragstart', (e) => {
      const btn = e.target.closest?.('[data-model]');
      if (!btn) return e.preventDefault();
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', btn.dataset.model);
      try { e.dataTransfer.setDragImage(BLANK, 0, 0); } catch { /* köhnə brauzer */ }
      editor.beginPlace(btn.dataset.model, { viaDrag: true });
      btn.classList.add('dragging');
    });
    el.addEventListener('dragend', (e) => {
      e.target.closest?.('[data-model]')?.classList.remove('dragging');
      if (editor.placing?.viaDrag) editor.cancelPlace(); // xəritədən kənara buraxılıb
    });

    // Xəritə: buraxma hədəfi. #ui-root "pointer-events: none" olduğu üçün hadisələr birbaşa canvas-a düşür.
    const target = this.viewer.container;
    const toCanvas = (e) => {
      const r = this.viewer.scene.canvas.getBoundingClientRect();
      this._pos.x = e.clientX - r.left;
      this._pos.y = e.clientY - r.top;
      return this._pos;
    };
    target.addEventListener('dragover', (e) => {
      if (!editor.placing?.viaDrag) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      toCanvas(e);
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        if (editor.placing?.viaDrag) editor.placePreview(this._pos);
      });
    });
    target.addEventListener('dragleave', (e) => {
      if (editor.placing?.viaDrag && !target.contains(e.relatedTarget)) editor.hidePlacePreview();
    });
    target.addEventListener('drop', (e) => {
      if (!editor.placing?.viaDrag) return;
      e.preventDefault();
      cancelAnimationFrame(this._raf);
      this._raf = 0;
      editor.commitPlace(Cesium.Cartesian2.clone(toCanvas(e)));
    });
  }

  _syncActive() {
    const { editor, el } = this;
    const placing = editor.placing && !editor.placing.viaDrag ? editor.placing.model.id : null;
    el.querySelectorAll('[data-model]').forEach((b) => b.classList.toggle('on', b.dataset.model === placing));
    el.querySelectorAll('[data-draw]').forEach((b) => b.classList.toggle('on', b.dataset.draw === editor.tool));
  }

  _syncClear() {
    const btn = this.el.querySelector('[data-cmd="clear-all"]');
    if (btn) btn.disabled = this.store.all().length === 0;
  }
}
