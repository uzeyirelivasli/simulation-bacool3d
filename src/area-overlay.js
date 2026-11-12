import { CITY_MODES, nudgeRender } from './city-environment.js';

const Cesium = window.Cesium;

export class AreaOverlay {
  constructor(viewer, geo, config, mode) {
    this.viewer = viewer;
    this.geo = geo;
    this.config = config;
    this.mode = mode;
    this.entities = { active: [], context: [] };
  }

  build() {
    this.clear();
    const E = this.viewer.entities;
    const classificationType =
      this.mode === CITY_MODES.GOOGLE ? Cesium.ClassificationType.CESIUM_3D_TILE : Cesium.ClassificationType.BOTH;
    const { activeSizeM, contextSizeM } = this.config.areas;
    const ring = (size, closed) => {
      const c = this.geo.squareCornersLonLat(size);
      const pts = closed ? [...c, c[0]] : c;
      return Cesium.Cartesian3.fromDegreesArray(pts.flatMap((p) => [p.longitude, p.latitude]));
    };
    const cyan = Cesium.Color.fromCssColorString('#ffffff');

    this.entities.context.push(
      E.add({
        id: 'zone-context-outline',
        polyline: {
          positions: ring(contextSizeM, true),
          width: 2,
          clampToGround: true,
          classificationType,
          material: Cesium.Color.fromCssColorString('#9fb1c4').withAlpha(0.7),
        },
      }),
      E.add({
        id: 'zone-context-label',
        position: this.geo.localToCartesian(-contextSizeM / 2, contextSizeM / 2, 80),
        label: this._label(`KONTEKST ZONASI · ${contextSizeM / 1000} × ${contextSizeM / 1000} km`, '#b9c6d3'),
      }),
    );

    this.entities.active.push(
      E.add({
        id: 'zone-active-fill',
        polygon: { hierarchy: ring(activeSizeM, false), classificationType, material: cyan.withAlpha(0.07) },
      }),
      E.add({
        id: 'zone-active-outline',
        polyline: {
          positions: ring(activeSizeM, true),
          width: 3.5,
          clampToGround: true,
          classificationType,
          material: cyan,
        },
      }),
      E.add({
        id: 'zone-active-label',
        position: this.geo.localToCartesian(-activeSizeM / 2, activeSizeM / 2, 80),
        label: this._label(`AKTİV DİZAYN ZONASI · ${activeSizeM / 1000} × ${activeSizeM / 1000} km`, '#ffffff'),
      }),
      E.add({
        id: 'zone-origin',
        position: this.geo.localToCartesian(0, 0, 3),
        point: {
          pixelSize: 7,
          color: cyan,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1.5,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }),
    );
    nudgeRender(this.viewer.scene);
  }

  setVisible(kind, visible) {
    for (const e of this.entities[kind] ?? []) e.show = visible;
    this.viewer.scene.requestRender();
  }

  clear() {
    for (const list of Object.values(this.entities)) {
      for (const e of list) this.viewer.entities.remove(e);
      list.length = 0;
    }
  }

  _label(text, color) {
    return {
      text,
      font: '600 12px Inter, system-ui, sans-serif',
      fillColor: Cesium.Color.fromCssColorString(color),
      outlineColor: Cesium.Color.fromCssColorString('#0b0e12'),
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(6, -4),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      scaleByDistance: new Cesium.NearFarScalar(500, 1.0, 5000, 0.75),
    };
  }
}
