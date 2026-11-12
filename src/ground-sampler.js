import { CITY_MODES } from './city-environment.js';

const Cesium = window.Cesium;

// Ekran nöqtəsindən yer səthindəki mövqeyi tapır (rejimə görə fərqli üsulla).
export class GroundSampler {
  constructor(viewer, city, geo) {
    this.viewer = viewer;
    this.city = city;
    this.geo = geo;
  }

  // → { cartesian, local: {x, y, z} } və ya null. local.z mənşə hündürlüyünə nisbətəndir.
  pick(windowPosition) {
    const { scene, camera } = this.viewer;
    let position;
    if (this.city.mode === CITY_MODES.GOOGLE) {
      if (scene.pickPositionSupported) position = scene.pickPosition(windowPosition);
    } else {
      const ray = camera.getPickRay(windowPosition);
      if (ray) position = scene.globe.pick(ray, scene);
    }
    if (!Cesium.defined(position)) return null;
    const local = this.geo.cartesianToLocal(position);
    if (!Number.isFinite(local.x) || !Number.isFinite(local.y) || !Number.isFinite(local.z)) return null;
    return { cartesian: Cesium.Cartesian3.clone(position), local };
  }

  // Lokal (x, y) nöqtəsində yer səviyyəsi (mənşəyə nisbətən, m). exclude: nəzərə alınmayan primitivlər.
  heightAt(x, y, exclude = []) {
    if (this.city.mode === CITY_MODES.OSM_DEV) return 0;
    const ll = this.geo.localToLonLat(x, y, 0);
    const carto = Cesium.Cartographic.fromDegrees(ll.longitude, ll.latitude);
    let h;
    try {
      if (this.city.mode === CITY_MODES.GOOGLE) {
        if (this.viewer.scene.sampleHeightSupported) h = this.viewer.scene.sampleHeight(carto, exclude);
      } else {
        h = this.viewer.scene.globe.getHeight(carto);
      }
    } catch { h = undefined; }
    return Number.isFinite(h) ? h - this.geo.origin.height : null;
  }
}
