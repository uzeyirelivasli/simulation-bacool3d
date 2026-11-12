const Cesium = window.Cesium;

export class CameraSystem {
  constructor(viewer, geo, config) {
    this.viewer = viewer;
    this.scene = viewer.scene;
    this.camera = viewer.camera;
    this.geo = geo;
    this.cfg = config.camera;
    this._flying = false;

    const ctrl = this.scene.screenSpaceCameraController;
    ctrl.minimumZoomDistance = this.cfg.minZoomDistanceM;
    ctrl.maximumZoomDistance = this.cfg.maxZoomDistanceM;
    ctrl.enableCollisionDetection = true;
    this.scene.preUpdate.addEventListener(() => this._enforceBounds());
  }

  view(name, { duration = 1.6 } = {}) {
    const p = this.cfg.presets[name];
    if (!p) return;
    const target = this.geo.localToCartesian(0, 0, 0);
    this._fly(target, Cesium.Math.toRadians(p.heading), Cesium.Math.toRadians(p.pitch), p.range, duration);
  }

  zoom(direction) {
    const h = Math.max(50, this.geo.cartesianToLocal(this.camera.positionWC).z);
    const amount = h * 0.35;
    if (direction > 0) this.camera.zoomIn(amount);
    else this.camera.zoomOut(amount);
    this.scene.requestRender();
  }

  resetNorth() {
    const canvas = this.scene.canvas;
    const center = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
    let target = this.scene.pickPositionSupported ? this.scene.pickPosition(center) : undefined;
    if (!Cesium.defined(target)) target = this.geo.originCartesian;
    const range = Cesium.Cartesian3.distance(this.camera.positionWC, target);
    this._fly(target, 0, this.camera.pitch, range, 0.9);
  }

  _fly(target, heading, pitch, range, duration) {
    this._flying = true;
    const done = () => {
      this._flying = false;
      this.scene.requestRender();
    };
    this.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 1), {
      offset: new Cesium.HeadingPitchRange(heading, pitch, range),
      duration,
      complete: done,
      cancel: done,
    });
  }

  _enforceBounds() {
    if (this._flying) return;
    if (!Cesium.Matrix4.equals(this.camera.transform, Cesium.Matrix4.IDENTITY)) return;
    const p = this.geo.cartesianToLocal(this.camera.positionWC);
    const { maxHorizontalRadiusM: R, maxHeightAboveOriginM: H } = this.cfg;
    let { x, y, z } = p;
    let changed = false;
    const r = Math.hypot(x, y);
    if (r > R) {
      x *= R / r;
      y *= R / r;
      changed = true;
    }
    if (z > H) {
      z = H;
      changed = true;
    }
    if (changed) this.geo.localToCartesian(x, y, z, this.camera.position);
  }
}
