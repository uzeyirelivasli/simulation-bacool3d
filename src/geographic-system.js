const Cesium = window.Cesium;

/**
 * Lokal koordinat sistemi — ENU (East-North-Up), mənşə aktiv zonanın mərkəzindədir.
 * x → Şərq (m), y → Şimal (m), z → Yuxarı (m, mənşə hündürlüyünə nisbətən)
 */
export class GeographicSystem {
  constructor({ longitude, latitude, height = 0 }) {
    this.setOrigin(longitude, latitude, height);
  }

  setOrigin(longitude, latitude, height = 0) {
    this.origin = { longitude, latitude, height };
    this.originCartesian = Cesium.Cartesian3.fromDegrees(longitude, latitude, height);
    this.enuToFixed = Cesium.Transforms.eastNorthUpToFixedFrame(this.originCartesian);
    this.fixedToEnu = Cesium.Matrix4.inverseTransformation(this.enuToFixed, new Cesium.Matrix4());
  }

  localToCartesian(x, y, z = 0, result = new Cesium.Cartesian3()) {
    return Cesium.Matrix4.multiplyByPoint(this.enuToFixed, new Cesium.Cartesian3(x, y, z), result);
  }

  cartesianToLocal(cartesian) {
    const p = Cesium.Matrix4.multiplyByPoint(this.fixedToEnu, cartesian, new Cesium.Cartesian3());
    return { x: p.x, y: p.y, z: p.z };
  }

  lonLatToLocal(longitude, latitude, height = this.origin.height) {
    return this.cartesianToLocal(Cesium.Cartesian3.fromDegrees(longitude, latitude, height));
  }

  localToLonLat(x, y, z = 0) {
    const c = Cesium.Cartographic.fromCartesian(this.localToCartesian(x, y, z));
    return {
      longitude: Cesium.Math.toDegrees(c.longitude),
      latitude: Cesium.Math.toDegrees(c.latitude),
      height: c.height,
    };
  }

  squareCornersLonLat(sizeM) {
    const h = sizeM / 2;
    return [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, y]) => this.localToLonLat(x, y, 0));
  }

  boundsDegrees(sizeM) {
    const c = this.squareCornersLonLat(sizeM);
    const lons = c.map((p) => p.longitude);
    const lats = c.map((p) => p.latitude);
    return {
      west: Math.min(...lons), east: Math.max(...lons),
      south: Math.min(...lats), north: Math.max(...lats),
    };
  }

  isInsideSquare(x, y, sizeM) {
    const h = sizeM / 2;
    return Math.abs(x) <= h && Math.abs(y) <= h;
  }

  modelMatrixAt(x, y, z = 0, headingRad = 0) {
    const position = this.localToCartesian(x, y, z);
    return Cesium.Transforms.headingPitchRollToFixedFrame(
      position,
      new Cesium.HeadingPitchRoll(headingRad, 0, 0),
    );
  }
}
