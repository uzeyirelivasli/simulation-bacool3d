const Cesium = window.Cesium;

export const CITY_MODES = Object.freeze({
  GOOGLE: 'google',
  ION_OSM: 'ion-osm',
  OSM_DEV: 'osm-dev',
});

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}: vaxt bitdi`)), ms)),
  ]);

export function nudgeRender(scene, durationMs = 3000, stepMs = 250) {
  const end = performance.now() + durationMs;
  const tick = () => {
    scene.requestRender();
    if (performance.now() < end) setTimeout(tick, stepMs);
  };
  tick();
}

export class CityEnvironment {
  constructor(viewer, config, hooks = {}) {
    this.viewer = viewer;
    this.scene = viewer.scene;
    this.config = config;
    this.hooks = hooks;
    this.mode = null;
    this.tileset = null;
    this.devBuildings = null;
    this.devBuildingCount = 0;
    // Real binaların konturları (lokal ENU, metr): kölgə və istilik modeli üçün. Bütün rejimlərdə doldurulur.
    this.footprints = [];
    this.footprintSource = null; // 'snapshot' | 'cache' | 'overpass'
    this.pendingTiles = 0;
    this.qualityKey = config.quality.default;
    this.clipCollection = null;
  }

  async loadGoogle() {
    const key = this.config.googleMapsApiKey;
    if (!key) throw new Error('GOOGLE_MAPS_API_KEY təyin edilməyib');
    Cesium.GoogleMaps.defaultApiKey = key;
    this.scene.globe.show = false;
    const tileset = await Cesium.createGooglePhotorealistic3DTileset(
      { key, onlyUsingWithGoogleGeocoder: true },
      this._tilesetOptions(),
    );
    this._attachTileset(tileset);
    this.mode = CITY_MODES.GOOGLE;
    return tileset;
  }

  async loadIonOsm() {
    Cesium.Ion.defaultAccessToken = this.config.cesiumIonToken;
    this.scene.globe.show = true;
    this.viewer.imageryLayers.removeAll();
    this.viewer.imageryLayers.add(Cesium.ImageryLayer.fromWorldImagery());
    this.viewer.terrainProvider = await Cesium.createWorldTerrainAsync();
    const tileset = await Cesium.createOsmBuildingsAsync(this._tilesetOptions());
    tileset.style = new Cesium.Cesium3DTileStyle({ color: "color('#cfd8e2')" });
    this._attachTileset(tileset);
    this.mode = CITY_MODES.ION_OSM;
    return tileset;
  }

  async loadOsmDev(geo) {
    this.mode = CITY_MODES.OSM_DEV;
    this.scene.globe.show = true;
    this.viewer.imageryLayers.removeAll();
    const layer = this.viewer.imageryLayers.addImageryProvider(
      new Cesium.OpenStreetMapImageryProvider({
        url: 'https://tile.openstreetmap.org/',
        credit: '© OpenStreetMap contributors (ODbL)',
      }),
    );
    layer.brightness = 0.6;
    layer.saturation = 0; // qara-ağ altlıq
    layer.contrast = 1.1;
    this.hooks.onStatus?.('OpenStreetMap bina konturları yüklənir…');
    const elements = await this._fetchBuildings(geo);
    this.hooks.onStatus?.('3D bina həndəsəsi qurulur…');
    this.devBuildings = this._buildExtrusions(this._parseRings(elements, geo));
    this.scene.primitives.add(this.devBuildings);
    await this._waitForPrimitive(this.devBuildings);
    this.hooks.onInitialLoad?.();
  }

  _tilesetOptions() {
    const q = this.config.quality.presets[this.qualityKey];
    return {
      maximumScreenSpaceError: q.sse,
      cacheBytes: this.config.quality.cacheBytes,
      maximumCacheOverflowBytes: this.config.quality.maximumCacheOverflowBytes,
      dynamicScreenSpaceError: true,
      dynamicScreenSpaceErrorDensity: 2.0e-4,
      dynamicScreenSpaceErrorFactor: 24.0,
      dynamicScreenSpaceErrorHeightFalloff: 0.25,
      foveatedScreenSpaceError: true,
      foveatedConeSize: 0.15,
      foveatedMinimumScreenSpaceErrorRelaxation: q.sse * 0.5,
      foveatedTimeDelay: 0.2,
      cullRequestsWhileMoving: true,
      cullRequestsWhileMovingMultiplier: 60,
      preloadWhenHidden: false,
      preloadFlightDestinations: true,
      skipLevelOfDetail: false,
      showCreditsOnScreen: true,
      enableCollision: true,
    };
  }

  _attachTileset(tileset) {
    this.tileset = tileset;
    tileset.shadows = Cesium.ShadowMode.ENABLED;
    this.scene.primitives.add(tileset);
    tileset.loadProgress.addEventListener((pending, processing) => {
      this.pendingTiles = pending + processing;
      this.hooks.onTiles?.(this.pendingTiles);
    });
    tileset.initialTilesLoaded.addEventListener(() => this.hooks.onInitialLoad?.());
    let failures = 0;
    tileset.tileFailed.addEventListener((event) => {
      failures += 1;
      console.warn('[SOYUQ] Tayl yüklənmədi:', event.message, event.url);
      this.hooks.onTileFailure?.(failures, event);
    });
  }

  setQuality(key) {
    const q = this.config.quality.presets[key];
    if (!q) return;
    this.qualityKey = key;
    if (this.tileset) {
      this.tileset.maximumScreenSpaceError = q.sse;
      this.tileset.foveatedMinimumScreenSpaceErrorRelaxation = q.sse * 0.5;
    }
    this.viewer.resolutionScale = q.resolutionScale;
    this.scene.requestRender();
  }

  setContextClip(enabled, geo) {
    if (!this.tileset || !Cesium.ClippingPolygonCollection.isSupported(this.scene)) return false;
    if (!this.clipCollection) {
      const flat = geo.squareCornersLonLat(this.config.areas.contextSizeM).flatMap((p) => [p.longitude, p.latitude]);
      this.clipCollection = new Cesium.ClippingPolygonCollection({
        polygons: [new Cesium.ClippingPolygon({ positions: Cesium.Cartesian3.fromDegreesArray(flat) })],
        inverse: true,
        enabled,
      });
      this.tileset.clippingPolygons = this.clipCollection;
    } else {
      this.clipCollection.enabled = enabled;
    }
    this.scene.requestRender();
    return true;
  }

  async sampleGroundHeight(geo) {
    const points = [];
    for (const dx of [-150, 0, 150]) {
      for (const dy of [-150, 0, 150]) {
        const p = geo.localToLonLat(dx, dy, 0);
        points.push(Cesium.Cartographic.fromDegrees(p.longitude, p.latitude));
      }
    }
    let sampled;
    if (this.mode === CITY_MODES.GOOGLE) {
      if (!this.scene.sampleHeightSupported) return null;
      sampled = await withTimeout(this.scene.sampleHeightMostDetailed(points), 25000, 'Hündürlük ölçmə');
    } else if (this.mode === CITY_MODES.ION_OSM) {
      sampled = await withTimeout(
        Cesium.sampleTerrainMostDetailed(this.viewer.terrainProvider, points), 25000, 'Relyef ölçmə',
      );
    } else {
      return 0;
    }
    const heights = sampled.map((c) => c?.height).filter(Number.isFinite).sort((a, b) => a - b);
    if (!heights.length) return null;
    return heights[Math.floor((heights.length - 1) * 0.2)];
  }

  // Google / ion rejimlərində binalar tayl kimi gəlir və ayrı-ayrı konturları yoxdur.
  // İstilik modeli üçün konturları fonda ayrıca yükləyirik (səhnəyə heç nə əlavə olunmur).
  async loadFootprintsOnly(geo) {
    const elements = await this._fetchBuildings(geo);
    this._parseRings(elements, geo);
    return this.footprints;
  }

  // Bina konturları: lokal snapshot → brauzer keşi → Overpass serverləri (növbə ilə).
  async _fetchBuildings(geo) {
    const { snapshotUrl, overpassEndpoints } = this.config.devFallback;
    const bounds = geo.boundsDegrees(this.config.areas.contextSizeM);
    const bbox = [bounds.south, bounds.west, bounds.north, bounds.east].map((v) => v.toFixed(5)).join(',');
    const valid = (json) => Array.isArray(json?.elements) && json.elements.length > 0;

    if (snapshotUrl) {
      try {
        const res = await withTimeout(fetch(snapshotUrl, { cache: 'no-cache' }), 8000, 'Snapshot');
        if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
          const json = await res.json();
          if (valid(json)) {
            this.footprintSource = 'snapshot';
            return json.elements;
          }
        }
      } catch { /* snapshot yoxdur — normal haldır */ }
    }

    const cacheKey = `https://soyuq.local/osm-buildings?bbox=${bbox}`;
    let cache = null;
    try {
      cache = 'caches' in globalThis ? await caches.open('soyuq-osm-v1') : null;
      const hit = await cache?.match(cacheKey);
      if (hit) {
        const json = await hit.json();
        if (valid(json)) {
          this.footprintSource = 'cache';
          return json.elements;
        }
      }
    } catch { cache = null; }

    const query =
      `[out:json][timeout:50];` +
      `(way["building"](${bbox});relation["building"]["type"="multipolygon"](${bbox}););` +
      `out geom;`;
    let lastError = new Error('Overpass ünvanı təyin edilməyib');
    for (const endpoint of overpassEndpoints) {
      try {
        const response = await withTimeout(
          fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'data=' + encodeURIComponent(query),
          }),
          45000,
          'Overpass API',
        );
        if (!response.ok) throw new Error(`Overpass API cavabı: HTTP ${response.status}`);
        const json = await response.json();
        if (!valid(json)) throw new Error('Overpass boş cavab qaytardı');
        this.footprintSource = 'overpass';
        this.lastOverpassJson = json; // soyuq.exportBuildings() ilə fayla yazmaq üçün
        try {
          await cache?.put(cacheKey, new Response(JSON.stringify({ elements: json.elements }), {
            headers: { 'Content-Type': 'application/json' },
          }));
        } catch { /* keş dolubsa da davam edirik */ }
        return json.elements;
      } catch (err) {
        lastError = err;
        console.warn('[SOYUQ] Overpass cəhdi alınmadı:', endpoint, err?.message ?? err);
      }
    }
    throw lastError;
  }

  _heightFromTags(tags) {
    const num = (v) => {
      const n = parseFloat(String(v ?? '').replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    };
    const { defaultBuildingHeightM, floorHeightM } = this.config.devFallback;
    let top = num(tags.height);
    const levels = num(tags['building:levels']);
    if (top === null && levels !== null) {
      top = levels * floorHeightM + (num(tags['roof:levels']) ?? 0) * floorHeightM * 0.5;
    }
    if (top === null) top = defaultBuildingHeightM;
    const base = Math.max(0, num(tags.min_height) ?? 0);
    return { base, top: Math.min(Math.max(top, base + 2.5), 350) };
  }

  // Overpass elementləri → { id, coords: [[lon, lat]], pts: [{x, y}], base, top, inActive }
  _parseRings(elements, geo) {
    const raw = [];
    for (const el of elements) {
      if (el.type === 'way' && el.geometry) {
        raw.push({ id: `way/${el.id}`, tags: el.tags ?? {}, geometry: el.geometry });
      } else if (el.type === 'relation' && el.members) {
        el.members.forEach((m, i) => {
          if (m.role === 'outer' && m.geometry) {
            raw.push({ id: `relation/${el.id}/${i}`, tags: el.tags ?? {}, geometry: m.geometry });
          }
        });
      }
    }
    const rings = [];
    for (const ring of raw) {
      const coords = [];
      for (const p of ring.geometry) {
        const last = coords[coords.length - 1];
        if (!last || last[0] !== p.lon || last[1] !== p.lat) coords.push([p.lon, p.lat]);
      }
      if (coords.length > 2) {
        const [f, l] = [coords[0], coords[coords.length - 1]];
        if (f[0] === l[0] && f[1] === l[1]) coords.pop();
      }
      if (coords.length < 3) continue;
      const { base, top } = this._heightFromTags(ring.tags);
      const pts = coords.map(([lon, lat]) => {
        const q = geo.lonLatToLocal(lon, lat);
        return { x: q.x, y: q.y };
      });
      const cx = pts.reduce((s, q) => s + q.x, 0) / pts.length;
      const cy = pts.reduce((s, q) => s + q.y, 0) / pts.length;
      rings.push({
        id: ring.id, coords, pts, base, top,
        name: ring.tags.name ?? null,
        levels: parseFloat(ring.tags['building:levels']) || null,
        inActive: geo.isInsideSquare(cx, cy, this.config.areas.activeSizeM),
      });
    }
    this.footprints = rings;
    return rings;
  }

  _buildExtrusions(rings) {
    const activeColor = Cesium.Color.fromCssColorString('#dfe7ef');
    const contextColor = Cesium.Color.fromCssColorString('#86909c');
    const instances = [];
    for (const ring of rings) {
      const { base, top } = ring;
      const color = Cesium.Color.lerp(
        ring.inActive ? activeColor : contextColor,
        Cesium.Color.WHITE,
        Math.min(top / 120, 1) * 0.25,
        new Cesium.Color(),
      );
      instances.push(new Cesium.GeometryInstance({
        id: ring.id,
        geometry: new Cesium.PolygonGeometry({
          polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ring.coords.flat())),
          height: base,
          extrudedHeight: top,
          vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
        }),
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color) },
      }));
    }
    this.devBuildingCount = instances.length;
    return new Cesium.Primitive({
      geometryInstances: instances,
      appearance: new Cesium.PerInstanceColorAppearance({ translucent: false, closed: true }),
      asynchronous: true,
      releaseGeometryInstances: true,
      shadows: Cesium.ShadowMode.ENABLED, // real binalar kölgə salır və qəbul edir
    });
  }

  async _waitForPrimitive(primitive, timeoutMs = 30000) {
    const start = performance.now();
    while (!primitive.ready) {
      if (performance.now() - start > timeoutMs) throw new Error('Bina həndəsəsi vaxtında hazırlanmadı');
      this.scene.requestRender();
      await new Promise((r) => setTimeout(r, 150));
    }
    this.scene.requestRender();
  }
}
