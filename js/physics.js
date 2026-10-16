export function createSim(scene, { gravity = 1, timeScale = 1 } = {}) {
  return {
    engine: null,
    bodies: [],
    joints: [],
    scene,
    step() {},
    reset() {},
    setGravity(g) {
      gravity = g;
    },
    setTimeScale(s) {
      timeScale = s;
    },
    getStats() {
      return { distance: 0, peak: 0, topSpeed: 0 };
    },
    destroy() {},
    attachMouse(canvas) {},
  };
}
