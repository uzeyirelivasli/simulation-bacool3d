// Lokal saxlama (IndexedDB). Gələcəkdə eyni interfeyslə (open / loadAll / attach) backend adapteri yazıla bilər.

export class Persistence {
  constructor(dbName = 'soyuq-baki', storeName = 'objects') {
    this.dbName = dbName;
    this.storeName = storeName;
    this.db = null;
    this.dirty = new Map();
    this.timer = null;
    this.onError = null;
  }

  async open() {
    if (!('indexedDB' in globalThis)) throw new Error('IndexedDB dəstəklənmir');
    this.db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(this.storeName)) {
          req.result.createObjectStore(this.storeName, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB bloklanıb'));
    });
  }

  loadAll() {
    return new Promise((resolve, reject) => {
      const req = this.db.transaction(this.storeName, 'readonly').objectStore(this.storeName).getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
  }

  attach(store, onError) {
    this.onError = onError;
    store.subscribe((change) => {
      if (change.kind === 'set') this.dirty.set(change.id, change.object);
      else if (change.kind === 'remove') this.dirty.set(change.id, null);
      else if (change.kind === 'reset' && change.removed?.length) for (const id of change.removed) this.dirty.set(id, null);
      else return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), 300);
    });
    window.addEventListener('pagehide', () => this.flush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush();
    });
  }

  flush() {
    clearTimeout(this.timer);
    if (!this.db || this.dirty.size === 0) return;
    const batch = [...this.dirty];
    this.dirty.clear();
    try {
      const tx = this.db.transaction(this.storeName, 'readwrite');
      const os = tx.objectStore(this.storeName);
      for (const [id, obj] of batch) {
        if (obj) os.put(obj);
        else os.delete(id);
      }
      tx.onerror = () => this.onError?.(tx.error);
      tx.onabort = () => this.onError?.(tx.error);
    } catch (err) {
      this.onError?.(err);
    }
  }
}