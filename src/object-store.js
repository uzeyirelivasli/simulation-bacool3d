// Bütün istifadəçi obyektləri üçün mərkəzi model + geri al / təkrarla.
// Dəyişiklik hadisələri: { kind: 'set' | 'remove' | 'reset', id, object, source }

const clone = (o) => (o == null ? null : structuredClone(o));

export function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `o-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class ObjectStore {
  constructor({ historyLimit = 100 } = {}) {
    this.objects = new Map();
    this.listeners = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.historyLimit = historyLimit;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get(id) { return this.objects.get(id) ?? null; }
  has(id) { return this.objects.has(id); }
  all() { return [...this.objects.values()]; }
  count(type) { return this.all().filter((o) => o.type === type).length; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  // Saxlanmış obyektləri yükləyir; tarixçəyə düşmür.
  load(list) {
    this.objects.clear();
    for (const o of list ?? []) {
      if (o && typeof o.id === 'string' && o.type && o.geometry && o.props) this.objects.set(o.id, o);
    }
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this._emit({ kind: 'reset' });
  }

  add(obj) {
    this._commit(obj.id, null, obj);
  }

  remove(id) {
    const before = this.objects.get(id);
    if (before) this._commit(id, before, null);
  }

  // coalesceKey: eyni sahənin ardıcıl dəyişiklikləri (yazarkən) bir tarixçə addımına birləşir.
  update(id, propsPatch, coalesceKey = null) {
    const current = this.objects.get(id);
    if (!current) return;
    const after = clone(current);
    Object.assign(after.props, propsPatch);
    after.updatedAt = new Date().toISOString();
    this._commit(id, current, after, coalesceKey);
  }

  // Obyekti bütöv dəyişir (həndəsə daxil): daşıma, fırlatma, miqyas. mutate(kopya) kopyanı yerində dəyişir.
  replace(id, mutate, coalesceKey = null) {
    const current = this.objects.get(id);
    if (!current) return;
    const after = clone(current);
    mutate(after);
    after.updatedAt = new Date().toISOString();
    this._commit(id, current, after, coalesceKey);
  }

  // Bütün obyektləri silir (tarixçə də sıfırlanır).
  clearAll() {
    const ids = [...this.objects.keys()];
    this.objects.clear();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this._emit({ kind: 'reset', removed: ids });
  }

  undo() {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    this.redoStack.push(cmd);
    this._apply(cmd.id, cmd.before, 'undo');
    return true;
  }

  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    this.undoStack.push(cmd);
    this._apply(cmd.id, cmd.after, 'redo');
    return true;
  }

  _commit(id, before, after, coalesceKey = null) {
    const now = Date.now();
    const last = this.undoStack[this.undoStack.length - 1];
    if (coalesceKey && last && last.key === coalesceKey && last.id === id && now - last.t < 1000) {
      last.after = clone(after);
      last.t = now;
    } else {
      this.undoStack.push({ id, before: clone(before), after: clone(after), key: coalesceKey, t: now });
      if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
    }
    this.redoStack.length = 0;
    this._apply(id, after, 'edit');
  }

  _apply(id, state, source) {
    if (state) {
      const object = clone(state);
      this.objects.set(id, object);
      this._emit({ kind: 'set', id, object, source });
    } else {
      this.objects.delete(id);
      this._emit({ kind: 'remove', id, source });
    }
  }

  _emit(change) {
    for (const fn of this.listeners) fn(change);
  }
}