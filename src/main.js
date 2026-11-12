import './styles.css';
import { CONFIG } from './config.js';
import { GeographicSystem } from './geographic-system.js';
import { CityEnvironment, CITY_MODES } from './city-environment.js';
import { CameraSystem } from './camera-system.js';
import { AreaOverlay } from './area-overlay.js';
import { Interface } from './interface.js';
import { ObjectStore } from './object-store.js';
import { Persistence } from './persistence.js';
import { GroundSampler } from './ground-sampler.js';
import { ObjectLayer } from './object-layer.js';
import { Editor } from './editor.js';
import { EditorUI } from './editor-ui.js';
import { Heatmap } from './heatmap.js';
import { CatalogUI } from './catalog-ui.js';
import { WindFlow } from './wind-flow.js';
import './theme.css'; // ən sonda: qara-ağ mövzu


const Cesium = window.Cesium;

function createViewer() {
  const viewer = new Cesium.Viewer('cesiumContainer', {
    baseLayer: false,
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    vrButton: false,
    infoBox: false,
    selectionIndicator: false,
    scene3DOnly: true,
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
    shadows: CONFIG.shadows.enabled,
    terrainShadows: Cesium.ShadowMode.RECEIVE_ONLY,
  });
  const { scene } = viewer;
  scene.backgroundColor = Cesium.Color.fromCssColorString('#0b0e12');
  scene.globe.baseColor = Cesium.Color.fromCssColorString('#1b2028');
  scene.globe.depthTestAgainstTerrain = true;
  scene.fog.enabled = true;
  scene.skyAtmosphere.show = true;
  viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  // Real vaxt kölgələri: günəş səhnə saatından götürülür (saat sürgüsü → viewer.clock).
  const sm = viewer.shadowMap;
  sm.softShadows = CONFIG.shadows.soft;
  sm.darkness = CONFIG.shadows.darkness;
  sm.maximumDistance = CONFIG.shadows.maximumDistanceM;
  sm.size = CONFIG.quality.presets[CONFIG.quality.default].shadowSize;
  sm.fadingEnabled = false; // alçaq günəşdə də (səhər / axşam) uzun kölgələr görünsün
  // Böyük səhnədə (≈3 km) standart sürüşmə dəyərləri bina üzlərində zolaqlı "kölgə səs-küyü" yaradır.
  // Bu sahələr Cesium-da ictimai API deyil, ona görə mövcudluğu yoxlanılır.
  const bias = sm._primitiveBias;
  if (bias) {
    Object.assign(bias, CONFIG.shadows.primitiveBias);
    sm.dirty = true;
  }

  const { utcOffsetHours, representativeDate, initialLocalTime } = CONFIG.time;
  const sign = utcOffsetHours >= 0 ? '+' : '-';
  const off = String(Math.abs(utcOffsetHours)).padStart(2, '0');
  viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(`${representativeDate}T${initialLocalTime}:00${sign}${off}:00`);
  viewer.clock.shouldAnimate = false;
  return viewer;
}

function describeTileError(err) {
  const code = err?.statusCode;
  if (code === 400) return 'Sorğu rədd edildi (400). API açarı etibarsız ola bilər.';
  if (code === 403) return 'Giriş qadağandır (403). Map Tiles API aktiv deyil, billing qoşulmayıb və ya açarın referrer məhdudiyyəti bu ünvana icazə vermir.';
  if (code === 429) return 'Kvota aşılıb (429). Google Cloud Console-da kvotaları yoxlayın.';
  return err?.message ?? String(err);
}

async function loadCity(city, geo, ui) {
  if (CONFIG.googleMapsApiKey) {
    try {
      ui.setSplashText('Google Photorealistic 3D Tiles qoşulur…');
      await city.loadGoogle();
      return;
    } catch (err) {
      console.error(err);
      ui.showError('Google 3D Tiles yüklənmədi', describeTileError(err));
    }
  } else {
    ui.showSetupModal();
  }
  if (CONFIG.cesiumIonToken) {
    try {
      ui.setSplashText('Cesium OSM Buildings yüklənir…');
      await city.loadIonOsm();
      return;
    } catch (err) {
      console.error(err);
      ui.showError('Cesium ion yüklənmədi', err?.message ?? String(err));
    }
  }
  try {
    await city.loadOsmDev(geo);
  } catch (err) {
    console.error(err);
    ui.hideSplash();
    ui.showError(
      'OSM binaları yüklənmədi',
      `${err.message}. Xəritə altlığı göstərilir; Overpass API-ni bir az sonra yenidən yoxlayın.`,
    );
  }
}

// Keyfiyyət səviyyəsinin SSE-dən kənar hissələri: MSAA, tayl keşi, panel bulanıqlığı, qlobus sərhədi.
function applyQualityExtras(viewer, city, geo, key) {
  const q = CONFIG.quality.presets[key];
  if (!q) return;
  const { scene } = viewer;
  if (scene.msaaSupported) scene.msaaSamples = q.msaa;
  if (viewer.shadowMap.size !== q.shadowSize) viewer.shadowMap.size = q.shadowSize;
  if (city.tileset) {
    city.tileset.cacheBytes = q.cacheMB * 1048576;
    city.tileset.maximumCacheOverflowBytes = (q.cacheMB / 2) * 1048576;
  }
  if (city.mode && city.mode !== CITY_MODES.GOOGLE) {
    if (q.limitGlobe) {
      const b = geo.boundsDegrees(CONFIG.quality.globeLimitSizeM);
      scene.globe.cartographicLimitRectangle = Cesium.Rectangle.fromDegrees(b.west, b.south, b.east, b.north);
    } else {
      scene.globe.cartographicLimitRectangle = Cesium.Rectangle.clone(Cesium.Rectangle.MAX_VALUE);
    }
  }
  document.body.dataset.quality = key;
  document.body.dataset.blur = q.blur ? 'on' : 'off';
  scene.requestRender();
}

function startTelemetry(viewer, city, ui) {
  let frames = 0;
  viewer.scene.postRender.addEventListener(() => { frames += 1; });
  setInterval(() => {
    ui.setTelemetry({
      fps: frames,
      pending: city.tileset ? city.pendingTiles : null,
      memoryMB: city.tileset ? city.tileset.totalMemoryUsageInBytes / 1048576 : null,
    });
    frames = 0;
  }, 1000);
}

async function initEditor(viewer, geo, city, ui) {
  const store = new ObjectStore({ historyLimit: CONFIG.editor.historyLimit });
  const renderer = new ObjectLayer(viewer, geo, CONFIG, city.mode ?? CITY_MODES.OSM_DEV);
  const sampler = new GroundSampler(viewer, city, geo);
  const editor = new Editor({
    viewer, geo, config: CONFIG, store, renderer, sampler,
    notify: (message, tone = 'info') => ui.toast(message, tone),
  });
  const root = document.getElementById('ui-root');
  new EditorUI(root, editor, store, geo, CONFIG);
  new CatalogUI({ root, viewer, editor, store });
  const heatmap = new Heatmap({ viewer, geo, config: CONFIG, store, layer: renderer, city, sampler, root });
  // Külək animasiyası istilik modelinin son sahəsindən (binalar + külək kölgəsi) qidalanır.
  const windFlow = new WindFlow({ viewer, geo, heatmap, size: CONFIG.areas.activeSizeM });
  heatmap.onField = (field, wind) => windFlow.update(field, wind);
  heatmap.onFlowToggle = (on) => windFlow.setEnabled(on);

  const persistence = new Persistence();
  try {
    await persistence.open();
    store.load(await persistence.loadAll());
    persistence.attach(store, (err) => {
      console.warn('[SOYUQ] Yadda saxlama xətası:', err);
      ui.toast('Dəyişiklik yadda saxlanmadı. Brauzer yaddaşını yoxlayın.', 'warn');
    });
  } catch (err) {
    console.warn('[SOYUQ] IndexedDB əlçatan deyil:', err);
    ui.toast('Brauzer yaddaşı əlçatan deyil — dəyişikliklər səhifə yenilənəndə itəcək.', 'warn');
  }
  return { store, editor, renderer, persistence, heatmap, windFlow };
}

async function bootstrap() {
  const ui = new Interface(document.getElementById('ui-root'), CONFIG);
  let viewer;
  try {
    viewer = createViewer();
  } catch (err) {
    console.error(err);
    ui.hideSplash();
    ui.showError(
      '3D mühit işə düşmədi',
      'Brauzer WebGL dəstəkləmir və ya qrafik sürücü bloklanıb. Chrome/Edge-in son versiyasını və "hardware acceleration" ayarını yoxlayın.',
    );
    return;
  }
  const geo = new GeographicSystem({ ...CONFIG.origin, height: CONFIG.provisionalGroundHeightM });
  const camera = new CameraSystem(viewer, geo, CONFIG);
  const city = new CityEnvironment(viewer, CONFIG, {
    onStatus: (text) => ui.setSplashText(text),
    onTiles: (n) => ui.setPendingTiles(n),
    onInitialLoad: () => ui.hideSplash(),
    onTileFailure: (count) => {
      if (count === 1) ui.toast('Bəzi 3D tayllar yüklənmədi. Şəbəkəni və API kvotasını yoxlayın.', 'warn');
    },
  });
  ui.on('view', (name) => camera.view(name));
  ui.on('zoom', (dir) => camera.zoom(dir));
  ui.on('north', () => camera.resetNorth());
  ui.on('quality', (key) => {
    city.setQuality(key);
    applyQualityExtras(viewer, city, geo, key);
  });
  camera.view('overview', { duration: 0 });
  setTimeout(() => ui.hideSplash(), 15000);

  await loadCity(city, geo, ui);
  if (city.mode) ui.setMode(city.mode, { buildingCount: city.devBuildingCount });
  city.setQuality(CONFIG.quality.default);
  applyQualityExtras(viewer, city, geo, CONFIG.quality.default);

  try {
    const h = await city.sampleGroundHeight(geo);
    if (Number.isFinite(h)) {
      geo.setOrigin(CONFIG.origin.longitude, CONFIG.origin.latitude, h);
      ui.setGround(h, true);
    } else {
      ui.setGround(geo.origin.height, false);
    }
  } catch (err) {
    console.warn('[SOYUQ] Hündürlük ölçülmədi:', err);
    ui.setGround(geo.origin.height, false);
  }

  const overlay = new AreaOverlay(viewer, geo, CONFIG, city.mode ?? CITY_MODES.OSM_DEV);
  overlay.build();
  const clipSupported = Boolean(city.tileset) && Cesium.ClippingPolygonCollection.isSupported(viewer.scene);
  if (!clipSupported) ui.disableToggle('clip', 'Bu rejimdə və ya bu brauzerdə mövcud deyil');
  ui.on('toggle', ({ id, value }) => {
    if (id === 'clip') city.setContextClip(value, geo);
    else if (id === 'shadows') {
      viewer.shadows = value;
      viewer.scene.requestRender();
    } else overlay.setVisible(id, value);
  });
  startTelemetry(viewer, city, ui);

  // Redaktor yer hündürlüyü ölçüləndən SONRA qurulur: obyektlər bu səviyyəyə nisbətən saxlanır.
  const edit = await initEditor(viewer, geo, city, ui);

  // Google / ion rejimlərində real bina konturları istilik modeli üçün fonda ayrıca yüklənir.
  if (city.mode && city.mode !== CITY_MODES.OSM_DEV) {
    city.loadFootprintsOnly(geo)
      .then((list) => edit.heatmap.setFootprints(list))
      .catch((err) => {
        console.warn('[SOYUQ] Bina konturları yüklənmədi:', err);
        ui.toast('Real binaların konturları yüklənmədi — istilik modelində yalnız əlavə etdiyiniz obyektlər nəzərə alınır.', 'warn');
      });
  }

  // Demo üçün: yüklənmiş OSM binalarını fayla yazır → public/data/osm-buildings.json kimi saxlayın (oflayn işləyir).
  const exportBuildings = () => {
    if (!city.lastOverpassJson) return console.warn('[SOYUQ] Overpass məlumatı yaddaşda yoxdur (snapshot və ya keşdən yüklənib).');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ elements: city.lastOverpassJson.elements })], { type: 'application/json' }));
    a.download = 'osm-buildings.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  window.soyuq = { viewer, geo, city, camera, overlay, CONFIG, CITY_MODES, exportBuildings, ...edit };
}

bootstrap();