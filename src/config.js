// SOYUQ BAKI — mərkəzi konfiqurasiya.
// API açarları koda YAZILMIR: Vite onları .env.local faylından oxuyur.
const env = import.meta.env ?? {};

export const CONFIG = Object.freeze({
  googleMapsApiKey: (env.VITE_GOOGLE_MAPS_API_KEY ?? '').trim(),
  cesiumIonToken: (env.VITE_CESIUM_ION_TOKEN ?? '').trim(),
  origin: { longitude: 49.8671, latitude: 40.4093 },
  provisionalGroundHeightM: 20,
  areas: {
    contextSizeM: 2000,
    activeSizeM: 1000,
  },
  time: {
    utcOffsetHours: 4,
    representativeDate: '2026-07-15',
    initialLocalTime: '13:00',
  },
  camera: {
    maxHorizontalRadiusM: 3000,
    maxHeightAboveOriginM: 3500,
    minZoomDistanceM: 15,
    maxZoomDistanceM: 4500,
    presets: {
      overview: { heading: 25, pitch: -35, range: 1900 },
      top: { heading: 0, pitch: -89.5, range: 2100 },
      close: { heading: 60, pitch: -16, range: 450 },
      context: { heading: 205, pitch: -27, range: 3000 },
    },
  },
  quality: {
    default: 'balanced',
    // msaa: kənar hamarlama nümunələri; cacheMB: tayl keşi; blur: panel bulanıqlığı;
    // limitGlobe: OSM rejimlərində qlobusu tədqiqat sahəsi ilə məhdudlaşdır.
    presets: {
      high: { label: 'Yüksək', sse: 8, resolutionScale: 1.0, msaa: 4, cacheMB: 512, blur: true, limitGlobe: false, shadowSize: 4096 },
      balanced: { label: 'Balanslı', sse: 16, resolutionScale: 1.0, msaa: 2, cacheMB: 384, blur: true, limitGlobe: false, shadowSize: 4096 },
      eco: { label: 'Performans', sse: 28, resolutionScale: 0.8, msaa: 1, cacheMB: 192, blur: false, limitGlobe: true, shadowSize: 2048 },
    },
    cacheBytes: 512 * 1024 * 1024,
    maximumCacheOverflowBytes: 256 * 1024 * 1024,
    globeLimitSizeM: 8000,
  },
  // Real vaxt kölgələri (Cesium shadow map). Günəşin mövqeyi saat sürgüsündən gəlir.
  shadows: {
    enabled: true,
    darkness: 0.38, // 0 = tam qara kölgə, 1 = kölgə görünmür
    maximumDistanceM: 3200,
    soft: true,
    primitiveBias: { normalOffsetScale: 1.6, depthBias: 0.0003, polygonOffsetFactor: 2.2, polygonOffsetUnits: 7 },
  },
  // Külək: istiqamət küləyin HARADAN əsdiyini göstərir (N = şimaldan). Sürət m/s.
  wind: {
    maxSpeed: 15,
    initial: { from: 'N', speed: 0 },
    presets: {
      calm: { label: 'Sakit', from: 'N', speed: 0 },
      khazri: { label: 'Xəzri', from: 'N', speed: 9 },
      gilavar: { label: 'Gilavar', from: 'S', speed: 5 },
    },
  },
  devFallback: {
    // Bina konturları bu ardıcıllıqla axtarılır: lokal snapshot → brauzer keşi → Overpass serverləri.
    snapshotUrl: 'data/osm-buildings.json',
    overpassEndpoints: [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
    ],
    defaultBuildingHeightM: 12,
    floorHeightM: 3.2,
  },
  editor: {
    historyLimit: 100,
    floorHeightM: 3.2,
    defaultFloors: 5,
    maxFloors: 60,
    minHeightM: 3,
    maxHeightM: 200,
    maxVertices: 64,
    minAreaM2: 9,
    baseSkirtM: 1.5,
    snapClosePx: 12,
    modelColor: '#eef1f5', // kataloq modelləri: xəritədəki binalar kimi ağ "maket" üslubu
    rotateStepDeg: 15,
    buildingTypes: {
      residential: { label: 'Yaşayış', color: '#d9d2c5' },
      office: { label: 'Ofis', color: '#9fb4c7' },
      commercial: { label: 'Ticarət', color: '#c9b08a' },
      public: { label: 'İctimai', color: '#c7c2d6' },
    },
    roofStyles: { flat: 'Düz', pyramid: 'Piramida' },

    // Fasad materialları (sadələşdirilmiş əmsallar, ölçmə deyil):
    //   albedo  — günəş şüasının əks olunan payı (0…1), paneldə göstərilir
    //   reflect — günəşli tərəfdə küçəyə əks olunan istilik, °C (tam günəşdə, divarın dibində)
    //   store   — gün ərzində yığılıb axşam qaytarılan istilik (beton = 1)
    //   surface — tam günəşdə fasad səthinin havadan nə qədər isti olması, °C
    //   cool    — buxarlanma sərinliyi, °C (yalnız yaşıl fasad)
    materials: {
      plaster: { label: 'Açıq suvaq', color: '#eef1f5', albedo: 0.6, reflect: 0.9, store: 0.6, surface: 7, cool: 0 },
      limestone: { label: 'Əhəngdaşı (aqlay)', color: '#e3d9c2', albedo: 0.5, reflect: 0.7, store: 0.8, surface: 9, cool: 0 },
      concrete: { label: 'Beton', color: '#b4b8bd', albedo: 0.3, reflect: 0.4, store: 1.0, surface: 14, cool: 0 },
      brick: { label: 'Kərpic', color: '#b98469', albedo: 0.3, reflect: 0.35, store: 0.95, surface: 15, cool: 0 },
      glass: { label: 'Şüşə fasad', color: '#a9cbdc', albedo: 0.35, reflect: 1.7, store: 0.35, surface: 10, cool: 0 },
      green: { label: 'Yaşıl fasad', color: '#86ad6c', albedo: 0.25, reflect: 0.1, store: 0.2, surface: 2, cool: 0.8 },
    },
    defaultMaterial: 'plaster', // kataloq və sərbəst binalar
    existingMaterial: 'concrete', // xəritədəki real binalar üçün fərziyyə

    // Parklar
    grassColor: '#5c8a45',
    parkSurfaces: {
      soil: { label: 'Torpaq', color: '#8a7a5c' },
      gravel: { label: 'Çınqıl', color: '#a8a294' },
      paving: { label: 'Döşəmə daşı', color: '#b5b0a6' },
    },

    // Yollar və cığırlar
    pathTypes: {
      pedestrian: { label: 'Piyada yolu', width: 3, surface: 'paving' },
      sidewalk: { label: 'Səki', width: 2, surface: 'paving' },
      parkpath: { label: 'Park cığırı', width: 1.8, surface: 'gravel' },
      road: { label: 'Avtomobil yolu', width: 7, surface: 'asphalt' },
      treerow: { label: 'Yalnız ağac cərgəsi', width: 0, surface: 'soil' },
    },
    pathSurfaces: {
      asphalt: { label: 'Asfalt', color: '#4a4f57' },
      paving: { label: 'Döşəmə daşı', color: '#b9b2a3' },
      gravel: { label: 'Çınqıl', color: '#c8b58e' },
      soil: { label: 'Torpaq', color: '#8a7a5c' },
    },
    treeRowSides: { none: 'Yoxdur', left: 'Sol', right: 'Sağ', both: 'Hər iki tərəf' },

    // Ağaclar
    treeVariants: { round: { label: 'Enliyarpaq' }, cypress: { label: 'Sərv' } },
    defaultTreeHeightM: 7,
    maxTreesPerGroup: 1200,
    maxLooseTrees: 400,
  },
});