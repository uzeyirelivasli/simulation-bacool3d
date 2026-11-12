// Bina konturlarının lokal snapshot-u: `npm run snapshot`
// Overpass API-dən kontekst zonasının (2 × 2 km) binalarını yükləyib public/data/osm-buildings.json faylına yazır.
// Bu fayl varsa, tətbiq Overpass-a müraciət etmir → demo internetdən və sorğu limitindən asılı olmur.
import { mkdir, writeFile } from 'node:fs/promises';

const ORIGIN = { longitude: 49.8671, latitude: 40.4093 }; // src/config.js ilə eyni olmalıdır
const CONTEXT_SIZE_M = 2000;
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const half = CONTEXT_SIZE_M / 2 + 60; // kiçik ehtiyat
const dLat = half / 111320;
const dLon = half / (111320 * Math.cos((ORIGIN.latitude * Math.PI) / 180));
const bbox = [ORIGIN.latitude - dLat, ORIGIN.longitude - dLon, ORIGIN.latitude + dLat, ORIGIN.longitude + dLon]
  .map((v) => v.toFixed(5)).join(',');
const query = `[out:json][timeout:60];(way["building"](${bbox});relation["building"]["type"="multipolygon"](${bbox}););out geom;`;

let json = null;
for (const endpoint of ENDPOINTS) {
  try {
    console.log('Sorğu:', endpoint);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'soyuq-baki-snapshot/1.0' },
      body: 'data=' + encodeURIComponent(query),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.elements) || !data.elements.length) throw new Error('boş cavab');
    json = data;
    break;
  } catch (err) {
    console.warn('  alınmadı:', err.message);
  }
}
if (!json) {
  console.error('Heç bir Overpass serveri cavab vermədi. Bir az sonra yenidən cəhd edin.');
  process.exit(1);
}
await mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
const out = new URL('../public/data/osm-buildings.json', import.meta.url);
await writeFile(out, JSON.stringify({ elements: json.elements }));
console.log(`Hazırdır: ${json.elements.length} bina → public/data/osm-buildings.json`);
