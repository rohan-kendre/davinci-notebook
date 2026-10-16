export function createRenderer(canvas, sim, options = {}) {
  return {
    draw() {
      const pixelRatio = globalThis.devicePixelRatio || 1;
      canvas.width = Math.round(1000 * pixelRatio);
      canvas.height = Math.round(625 * pixelRatio);
      canvas.style.width = '1000px';
      canvas.style.height = '625px';

      const context = canvas.getContext('2d');
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.fillStyle = '#FBF5E6';
      context.fillRect(0, 0, 1000, 625);
    },
    set(option, value) {
      options[option] = value;
    },
  };
}
