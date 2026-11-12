import { signedArea, isSelfIntersecting } from './geometry-utils.js';
import { newId } from './object-store.js';
import { MODELS } from './catalog.js';
import {
  modelGeometry, translateGeometry, rotateGeometry, scaleGeometry, setGroundLevel, groundLevel, geometryCenter,
} from './transform.js';

const Cesium = window.Cesium;
// Önbaxış şəffafdır: dərinlik seçiminə (pickPosition) təsir etməsin deyə.
const PREVIEW = Cesium.Color.fromCssColorString('#e6c867').withAlpha(0.9);
const INVALID = Cesium.Color.fromCssColorString('#ff6b6b').withAlpha(0.95);
const GHOST_ID = '__ghost'; // sürüklənən modelin müvəqqəti önbaxışı (yaddaşa düşmür)
const round7 = (v) => Math.round(v * 1e7) / 1e7;
const round2 = (v) => Math.round(v * 100) / 100;
const newSeed = () => Math.floor(Math.random() * 2147483647) + 1;

const TOOLS = ['select', 'building', 'park', 'path', 'tree', 'delete', 'place'];
const DRAW = {
  building: { closed: true, min: 3 },
  park: { closed: true, min: 3 },
  path: { closed: false, min: 2 },
};
const CURSORS = { building: 'crosshair', park: 'crosshair', path: 'crosshair', tree: 'copy', delete: 'not-allowed', place: 'copy' };
const normDeg = (v) => ((Math.round(v) % 360) + 360) % 360;

export class Editor {
  constructor({ viewer, geo, config, store, renderer, sampler, notify }) {
    this.viewer = viewer;
    this.scene = viewer.scene;
    this.geo = geo;
    this.config = config;
    this.cfg = config.editor;
    this.store = store;
    this.renderer = renderer;
    this.sampler = sampler;
    this.notify = notify ?? (() => {});
    this.tool = 'select';
    this.selectedId = null;
    this.treeBrush = { variant: 'mixed', height: this.cfg.defaultTreeHeightM };
    this.draft = [];
    this.lastHit = null;
    this.placing = null; // { model, rotation, viaDrag, last: {x, y, z} } — kataloqdan yerləşdirmə
    this.moving = null; // { id, obj, z, start, dx, dy, moved } — seçilmiş obyektin daşınması
    this.ghostLine = null;
    this.handlers = {};
    this._raf = 0;
    this._cursor = new Cesium.Cartesian2();

    this.preview = this.scene.primitives.add(new Cesium.PrimitiveCollection());
    this.lines = this.preview.add(new Cesium.PolylineCollection());
    this.points = this.preview.add(new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT }));
    this.line = null;

    const T = Cesium.ScreenSpaceEventType;
    this.input = new Cesium.ScreenSpaceEventHandler(this.scene.canvas);
    this.input.setInputAction((e) => this._onClick(e.position), T.LEFT_CLICK);
    this.input.setInputAction(() => { if (DRAW[this.tool]) this.finishDraft(); }, T.LEFT_DOUBLE_CLICK);
    this.input.setInputAction((e) => this._onMove(e.endPosition), T.MOUSE_MOVE);
    this.input.setInputAction((e) => this._onDown(e.position), T.LEFT_DOWN);
    this.input.setInputAction(() => this._onUp(), T.LEFT_UP);
    window.addEventListener('keydown', (e) => this._onKey(e));
    store.subscribe((change) => this._onStore(change));
  }

  on(event, fn) { (this.handlers[event] ??= []).push(fn); }
  _emit(event, payload) { for (const fn of this.handlers[event] ?? []) fn(payload); }

  setTool(name, placing = null) {
    if (!TOOLS.includes(name)) return;
    if (name === 'place' && !placing) return;
    this._clearDraft();
    this._clearGhost();
    this._cancelMove();
    this.placing = name === 'place' ? placing : null;
    this.tool = name;
    if (name !== 'select') this.select(null);
    this.scene.canvas.style.cursor = CURSORS[name] ?? '';
    this._emit('tool', name);
  }

  select(id) {
    if (id === this.selectedId) return;
    const prev = this.selectedId;
    this.selectedId = id;
    for (const [oid, sel] of [[prev, false], [id, true]]) {
      const obj = oid && this.store.get(oid);
      if (obj) this.renderer.upsert(obj, sel);
    }
    this.scene.requestRender();
    this._emit('selection', id);
  }

  undo() { this.store.undo(); }
  redo() { this.store.redo(); }
  deleteSelected() { if (this.selectedId) this.store.remove(this.selectedId); }

  // ---------- Kataloqdan yerləşdirmə (drag-and-drop və ya klik) ----------

  beginPlace(modelId, { viaDrag = false } = {}) {
    const model = MODELS.get(modelId);
    if (!model) return false;
    this.setTool('place', { model, rotation: 0, viaDrag, last: null });
    return true;
  }

  // Kursorun altındakı yer nöqtəsində modelin önbaxışını göstərir.
  placePreview(position) {
    const pl = this.placing;
    if (!pl) return;
    const hit = this._groundHit(position);
    if (!hit) return this._clearGhost();
    pl.last = hit.local;
    this._drawGhost();
  }

  commitPlace(position) {
    const pl = this.placing;
    if (!pl) return false;
    const hit = position ? this._groundHit(position) : null;
    const local = hit?.local ?? pl.last;
    this._clearGhost();
    if (!local) {
      this.notify('Bu nöqtədə yer səthi tapılmadı. Bir az yaxınlaşıb yenidən cəhd edin.', 'warn');
      if (pl.viaDrag) this.setTool('select');
      return false;
    }
    if (!this.geo.isInsideSquare(local.x, local.y, this.config.areas.activeSizeM)) {
      this.notify('Obyektlər yalnız aktiv dizayn zonasının daxilində yerləşdirilə bilər.', 'warn');
      if (pl.viaDrag) this.setTool('select');
      return false;
    }
    const obj = this._modelObject(pl.model, local, pl.rotation, newId());
    this.store.add(obj);
    this.setTool('select');
    this.select(obj.id);
    return true;
  }

  cancelPlace() {
    if (this.tool === 'place') this.setTool('select');
  }

  hidePlacePreview() {
    this._clearGhost();
  }

  _modelObject(model, local, rotation, id) {
    const geometry = modelGeometry(this.geo, model, local, rotation);
    const n = this.store.count(model.kind) + 1;
    const props = model.kind === 'building'
      ? {
        name: `${model.label} ${n}`,
        buildingType: model.buildingType,
        floors: model.floors,
        height: model.height,
        material: this.cfg.defaultMaterial,
        color: this.cfg.materials[this.cfg.defaultMaterial]?.color ?? this.cfg.modelColor,
        roofStyle: model.roofStyle,
      }
      : { name: `${model.label} ${n}`, ...model.props, seed: newSeed() };
    const obj = this._record(model.kind, geometry, { ...props, model: model.id, rotation: normDeg(rotation), scale: 100 });
    obj.id = id;
    return obj;
  }

  _drawGhost() {
    const pl = this.placing;
    if (!pl?.last) return;
    const obj = this._modelObject(pl.model, pl.last, pl.rotation, GHOST_ID);
    const ok = this.geo.isInsideSquare(pl.last.x, pl.last.y, this.config.areas.activeSizeM);
    if (obj.type === 'building') this.renderer.buildings.upsert(obj, true);
    this._outline(obj.geometry.ring, pl.last.z, true, ok);
    this.scene.requestRender();
  }

  _clearGhost() {
    this.renderer.buildings.remove(GHOST_ID);
    if (this.ghostLine) this.ghostLine.show = false;
    this.scene.requestRender();
  }

  // Yer üzərində kontur xətti (önbaxış). coords: [[lon, lat]], z: lokal hündürlük.
  _outline(coords, z, closed, ok = true) {
    const positions = coords.map(([lon, lat]) => {
      const q = this.geo.lonLatToLocal(lon, lat);
      return this.geo.localToCartesian(q.x, q.y, (z || 0) + 0.8);
    });
    if (closed && positions.length > 2) positions.push(positions[0]);
    if (positions.length < 2) {
      if (this.ghostLine) this.ghostLine.show = false;
      return;
    }
    const color = ok ? PREVIEW : INVALID;
    if (!this.ghostLine) {
      this.ghostLine = this.lines.add({ positions, width: 3, material: Cesium.Material.fromType('Color', { color }) });
    } else {
      this.ghostLine.positions = positions;
      this.ghostLine.material.uniforms.color = color;
    }
    this.ghostLine.show = true;
  }

  // ---------- Fırlatma və miqyas ----------

  rotateBy(deg) {
    if (this.placing) {
      this.placing.rotation = normDeg(this.placing.rotation + deg);
      this._drawGhost();
    } else if (this.selectedId) {
      const obj = this.store.get(this.selectedId);
      if (obj && obj.type !== 'tree') this.setRotation(obj.id, (Number(obj.props.rotation) || 0) + deg);
    }
  }

  setRotation(id, value) {
    const obj = this.store.get(id);
    if (!obj) return;
    const next = normDeg(value);
    const delta = next - (Number(obj.props.rotation) || 0);
    if (!delta) return;
    this.store.replace(id, (o) => {
      o.geometry = rotateGeometry(this.geo, o.geometry, delta);
      o.props.rotation = next;
    }, `${id}:rotation`);
  }

  setScale(id, value) {
    const obj = this.store.get(id);
    if (!obj) return;
    const next = Math.min(Math.max(Number(value) || 100, 40), 250);
    const factor = next / (Number(obj.props.scale) || 100);
    if (!Number.isFinite(factor) || Math.abs(factor - 1) < 1e-6) return;
    this.store.replace(id, (o) => {
      o.geometry = scaleGeometry(this.geo, o.geometry, factor);
      o.props.scale = next;
    }, `${id}:scale`);
  }

  // ---------- Seçilmiş obyekti sürükləyərək daşıma ----------

  // Kursor şüasının z hündürlüyündəki üfüqi müstəvi ilə kəsişməsi (lokal x, y).
  _planePoint(position, z) {
    const ray = this.viewer.camera.getPickRay(position);
    if (!ray) return null;
    const o = this.geo.cartesianToLocal(ray.origin);
    const d = Cesium.Matrix4.multiplyByPointAsVector(this.geo.fixedToEnu, ray.direction, new Cesium.Cartesian3());
    const t = (z - o.z) / d.z;
    if (!(t > 0) || !Number.isFinite(t)) return null;
    return { x: o.x + d.x * t, y: o.y + d.y * t };
  }

  _onDown(position) {
    if (this.tool !== 'select' || !this.selectedId) return;
    const { id } = this._pickObject(position);
    if (id !== this.selectedId) return;
    const obj = this.store.get(id);
    const z = groundLevel(obj.geometry);
    const start = this._planePoint(position, z);
    if (!start) return;
    this.moving = { id, obj, z, start, dx: 0, dy: 0, moved: false };
    this.scene.screenSpaceCameraController.enableInputs = false; // kamera yerində qalsın
  }

  _dragMove(position) {
    const m = this.moving;
    const p = this._planePoint(position, m.z);
    if (!p) return;
    m.dx = p.x - m.start.x;
    m.dy = p.y - m.start.y;
    if (!m.moved && Math.hypot(m.dx, m.dy) < 0.4) return;
    m.moved = true;
    this.scene.canvas.style.cursor = 'grabbing';
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      const mv = this.moving;
      if (!mv) return;
      const geometry = translateGeometry(this.geo, mv.obj.geometry, mv.dx, mv.dy);
      const c = geometryCenter(this.geo, geometry);
      const ok = this.geo.isInsideSquare(c.x, c.y, this.config.areas.activeSizeM);
      // Bina canlı daşınır (kölgəsi ilə birlikdə); park və yol üçün yalnız kontur göstərilir.
      if (mv.obj.type === 'building') this.renderer.upsert({ ...mv.obj, geometry }, true);
      const coords = geometry.ring ?? geometry.line ?? [geometry.point];
      this._outline(coords.length > 1 ? coords : this._pointMarker(coords[0]), mv.z, Boolean(geometry.ring) || coords.length === 1, ok);
      this.scene.requestRender();
    });
  }

  _pointMarker([lon, lat]) {
    const c = this.geo.lonLatToLocal(lon, lat);
    return Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      const ll = this.geo.localToLonLat(c.x + 1.5 * Math.cos(a), c.y + 1.5 * Math.sin(a), 0);
      return [ll.longitude, ll.latitude];
    });
  }

  _onUp() {
    const m = this.moving;
    if (!m) return;
    this._endMove();
    if (!m.moved) return; // adi klik: seçimi LEFT_CLICK idarə edir
    let geometry = translateGeometry(this.geo, m.obj.geometry, m.dx, m.dy);
    const c = geometryCenter(this.geo, geometry);
    if (!this.geo.isInsideSquare(c.x, c.y, this.config.areas.activeSizeM)) {
      this.notify('Obyekt aktiv dizayn zonasından kənara çıxarıla bilməz.', 'warn');
      this.renderer.upsert(m.obj, true);
      return;
    }
    const h = this.sampler.heightAt(c.x, c.y, this.renderer.solidPrimitives());
    if (h !== null) geometry = setGroundLevel(geometry, h);
    this.store.replace(m.id, (o) => { o.geometry = geometry; });
  }

  _endMove() {
    this.moving = null;
    this.scene.screenSpaceCameraController.enableInputs = true;
    this.scene.canvas.style.cursor = CURSORS[this.tool] ?? '';
    if (this.ghostLine) this.ghostLine.show = false;
    this.scene.requestRender();
  }

  _cancelMove() {
    const m = this.moving;
    if (!m) return;
    this._endMove();
    if (m.moved && this.store.has(m.id)) this.renderer.upsert(m.obj, m.id === this.selectedId);
  }

  finishDraft() {
    const spec = DRAW[this.tool];
    if (!spec) return;
    const pts = this.draft.map((d) => d.local);
    if (pts.length < spec.min) return this.notify(`Ən azı ${spec.min} nöqtə lazımdır.`, 'warn');
    let verts = [...this.draft];
    if (spec.closed) {
      if (isSelfIntersecting(pts)) return this.notify('Kontur özü ilə kəsişir. Son nöqtəni Backspace ilə silin.', 'warn');
      const area = signedArea(pts);
      if (Math.abs(area) < this.cfg.minAreaM2) return this.notify(`Kontur çox kiçikdir (minimum ${this.cfg.minAreaM2} m²).`, 'warn');
      if (area < 0) verts.reverse();
    } else {
      let length = 0;
      for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (length < 2) return this.notify('Yol çox qısadır.', 'warn');
    }
    const coords = verts.map(({ local }) => {
      const ll = this.geo.localToLonLat(local.x, local.y, local.z);
      return [round7(ll.longitude), round7(ll.latitude)];
    });
    const zs = verts.map((v) => round2(v.local.z)); // sahənin yer səviyyəsinə nisbətən hündürlüklər (m)

    let obj;
    if (this.tool === 'building') obj = this._makeBuilding(coords, zs);
    else if (this.tool === 'park') obj = this._makePark(coords, zs);
    else obj = this._makePath(coords, zs);
    this.store.add(obj);
    this.setTool('select');
    this.select(obj.id);
  }

  _record(type, geometry, props) {
    const now = new Date().toISOString();
    return { id: newId(), type, schema: 1, createdAt: now, updatedAt: now, visible: true, geometry, props };
  }

  _makeBuilding(ring, zs) {
    const type = Object.keys(this.cfg.buildingTypes)[0];
    return this._record('building', { type: 'Polygon', ring, baseRel: Math.min(...zs) }, {
      name: `Bina ${this.store.count('building') + 1}`,
      buildingType: type,
      floors: this.cfg.defaultFloors,
      height: Math.round(this.cfg.defaultFloors * this.cfg.floorHeightM * 10) / 10,
      material: this.cfg.defaultMaterial,
      color: this.cfg.materials[this.cfg.defaultMaterial]?.color ?? this.cfg.modelColor, // ağ maket üslubu
      roofStyle: 'flat',
    });
  }

  _makePark(ring, zs) {
    return this._record('park', { type: 'Polygon', ring, zs }, {
      name: `Park ${this.store.count('park') + 1}`,
      surface: 'soil',
      grassCoverage: 85,
      treeDensity: 4,
      treeVariant: 'mixed',
      treeHeight: this.cfg.defaultTreeHeightM,
      seed: newSeed(),
    });
  }

  _makePath(line, zs) {
    const pathType = 'pedestrian';
    const def = this.cfg.pathTypes[pathType];
    return this._record('path', { type: 'LineString', line, zs }, {
      name: `Yol ${this.store.count('path') + 1}`,
      pathType,
      width: def.width,
      surface: def.surface,
      color: this.cfg.pathSurfaces[def.surface].color,
      treeRow: 'none',
      treeSpacing: 8,
      treeVariant: 'round',
      treeHeight: this.cfg.defaultTreeHeightM,
      seed: newSeed(),
    });
  }

  _placeTree(position) {
    const hit = this._groundHit(position);
    if (!this._validHit(hit)) return;
    if (this.store.count('tree') >= this.cfg.maxLooseTrees) {
      return this.notify(`Tək ağac limiti: ${this.cfg.maxLooseTrees}. Çoxlu ağac üçün park və ya ağac cərgəsindən istifadə edin.`, 'warn');
    }
    const b = this.treeBrush;
    const variant = b.variant === 'mixed' ? (Math.random() < 0.7 ? 'round' : 'cypress') : b.variant;
    const ll = this.geo.localToLonLat(hit.local.x, hit.local.y, hit.local.z);
    this.store.add(this._record('tree',
      { type: 'Point', point: [round7(ll.longitude), round7(ll.latitude)], z: round2(hit.local.z) },
      {
        name: `Ağac ${this.store.count('tree') + 1}`,
        variant,
        height: Math.round(b.height * (0.85 + Math.random() * 0.3) * 10) / 10,
        seed: newSeed(),
      }));
  }

  _onClick(position) {
    if (this.tool === 'place') return this.commitPlace(position);
    if (DRAW[this.tool]) return this._addVertex(position);
    if (this.tool === 'tree') return this._placeTree(position);
    const { id } = this._pickObject(position);
    if (this.tool === 'delete') {
      if (id) this.store.remove(id);
      return;
    }
    this.select(id);
  }

  // → { id, solid, ghost }. solid: 3D həndəsə (bina / ağac); yer səthinə örtülən park və yol deyil.
  // drillPick: istilik xəritəsi kimi üst qatların altındakı obyekti də tapır.
  _pickObject(position, drill = true) {
    let list;
    try {
      list = drill ? this.scene.drillPick(position, 6) : [this.scene.pick(position)];
    } catch {
      list = [];
    }
    for (const picked of list) {
      let raw = picked?.id;
      const isEntity = raw && typeof raw === 'object';
      if (isEntity) raw = raw.id;
      if (typeof raw !== 'string') continue;
      if (raw === GHOST_ID) return { id: null, solid: true, ghost: true };
      if (raw.startsWith('obj:')) raw = raw.slice(4);
      if (this.store.has(raw)) return { id: raw, solid: !isEntity, ghost: false };
      if (raw.startsWith('way/') || raw.startsWith('relation/')) break; // real binanın arxasındakı seçilmir
    }
    return { id: null, solid: false, ghost: false };
  }

  // Yer nöqtəsi. Google rejimində kursor öz bina/ağacımıza (və ya önbaxışa) düşərsə, onun damını yox,
  // bünövrə səviyyəsini götürürük.
  _groundHit(position) {
    const hit = this.sampler.pick(position);
    if (!hit || this.sampler.city?.mode !== 'google') return hit;
    const { id, solid, ghost } = this._pickObject(position, false); // yalnız ən üstdəki obyekt (sürətli)
    if (!solid) return hit;
    let z;
    if (ghost) z = this.placing?.last?.z ?? 0;
    else z = groundLevel(this.store.get(id).geometry);
    const p = this._planePoint(position, z);
    if (!p) return hit;
    const local = { x: p.x, y: p.y, z };
    return { cartesian: this.geo.localToCartesian(local.x, local.y, local.z), local };
  }

  _validHit(hit) {
    if (!hit) {
      this.notify('Bu nöqtədə yer səthi tapılmadı. Bir az yaxınlaşıb yenidən cəhd edin.', 'warn');
      return false;
    }
    if (!this.geo.isInsideSquare(hit.local.x, hit.local.y, this.config.areas.activeSizeM)) {
      this.notify('Obyektlər yalnız aktiv dizayn zonasının daxilində yaradıla bilər.', 'warn');
      return false;
    }
    return true;
  }

  _addVertex(position) {
    // Qapalı konturda ilk nöqtəyə klik → bitir
    if (DRAW[this.tool].closed && this.draft.length >= 3) {
      const first = Cesium.SceneTransforms.worldToWindowCoordinates(this.scene, this._lift(this.draft[0].local));
      if (first && Cesium.Cartesian2.distance(first, position) <= this.cfg.snapClosePx) return this.finishDraft();
    }
    const hit = this._groundHit(position);
    if (!this._validHit(hit)) return;
    const last = this.draft[this.draft.length - 1];
    if (last && Math.hypot(last.local.x - hit.local.x, last.local.y - hit.local.y) < 0.5) return; // ikiqat klik
    if (this.draft.length >= this.cfg.maxVertices) return this.notify(`Maksimum ${this.cfg.maxVertices} nöqtə.`, 'warn');
    this.draft.push(hit);
    this._redrawPoints();
    this._redrawLine();
  }

  _onMove(position) {
    if (this.moving) return this._dragMove(position);
    if (this.tool === 'place' && this.placing && !this.placing.viaDrag) {
      Cesium.Cartesian2.clone(position, this._cursor);
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        this.placePreview(this._cursor);
      });
      return;
    }
    if (!DRAW[this.tool] || this.draft.length === 0) return;
    Cesium.Cartesian2.clone(position, this._cursor);
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      if (!DRAW[this.tool] || this.draft.length === 0) return;
      this.lastHit = this.sampler.pick(this._cursor);
      this._redrawLine();
    });
  }

  _onKey(e) {
    const t = e.target;
    if (t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (mod && key === 'y') {
      e.preventDefault();
      this.redo();
    } else if (!mod && key === 'r') {
      if (this.placing || this.selectedId) {
        e.preventDefault();
        this.rotateBy(e.shiftKey ? -this.cfg.rotateStepDeg : this.cfg.rotateStepDeg);
      }
    } else if (e.key === 'Escape') {
      if (this.moving) this._cancelMove();
      else if (this.draft.length) this._clearDraft();
      else if (this.tool !== 'select') this.setTool('select');
      else this.select(null);
    } else if (e.key === 'Enter' && DRAW[this.tool]) {
      this.finishDraft();
    } else if (e.key === 'Backspace' && DRAW[this.tool] && this.draft.length) {
      e.preventDefault();
      this.draft.pop();
      this._redrawPoints();
      this._redrawLine();
    } else if (e.key === 'Delete') {
      this.deleteSelected();
    }
  }

  _onStore(change) {
    if (change.kind === 'reset') {
      this.renderer.clear();
      this.selectedId = null;
      for (const obj of this.store.all()) this.renderer.upsert(obj, false);
      this._emit('selection', null);
    } else if (change.kind === 'set') {
      this.renderer.upsert(change.object, change.id === this.selectedId);
    } else if (change.kind === 'remove') {
      this.renderer.remove(change.id);
      if (change.id === this.selectedId) {
        this.selectedId = null;
        this._emit('selection', null);
      }
    }
    this.scene.requestRender();
    this._emit('change', change);
  }

  _lift(local) {
    return this.geo.localToCartesian(local.x, local.y, local.z + 0.6);
  }

  _redrawPoints() {
    this.points.removeAll();
    for (const d of this.draft) {
      this.points.add({
        position: this._lift(d.local),
        pixelSize: 8,
        color: PREVIEW,
        outlineColor: Cesium.Color.WHITE.withAlpha(0.9),
        outlineWidth: 1.5,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
    }
    this.scene.requestRender();
  }

  _redrawLine() {
    const positions = this.draft.map((d) => this._lift(d.local));
    if (this.lastHit) positions.push(this._lift(this.lastHit.local));
    if (DRAW[this.tool]?.closed && this.draft.length >= 2 && positions.length >= 3) positions.push(positions[0]);
    if (positions.length >= 2) {
      if (!this.line) {
        this.line = this.lines.add({
          positions,
          width: 2.5,
          material: Cesium.Material.fromType('Color', { color: PREVIEW }),
        });
      } else {
        this.line.positions = positions;
      }
      this.line.show = true;
    } else if (this.line) {
      this.line.show = false;
    }
    this.scene.requestRender();
  }

  _clearDraft() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    this.draft = [];
    this.lastHit = null;
    this.points.removeAll();
    if (this.line) this.line.show = false;
    this.scene.requestRender();
  }
}