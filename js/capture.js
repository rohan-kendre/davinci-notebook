const WIDTH = 1000;
const HEIGHT = 625;
const HISTORY_LIMIT = 12;

export function setupDrawPad(canvas) {
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d', { alpha: false });
  const history = [];
  let stroke = null;

  function white() {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    const style = getComputedStyle(canvas);
    const number = (name) => parseFloat(style[name]) || 0;
    const left = number('borderLeftWidth') + number('paddingLeft');
    const top = number('borderTopWidth') + number('paddingTop');
    const width = rect.width - left - number('borderRightWidth') - number('paddingRight');
    const height = rect.height - top - number('borderBottomWidth') - number('paddingBottom');
    return {
      x: (event.clientX - rect.left - left) * WIDTH / width,
      y: (event.clientY - rect.top - top) * HEIGHT / height,
    };
  }

  function pen() {
    ctx.strokeStyle = '#3B2A1A';
    ctx.fillStyle = '#3B2A1A';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  function finish(commit) {
    if (!stroke) return;
    const completed = stroke;
    stroke = null;
    if (commit) {
      history.push(completed.before);
      if (history.length > HISTORY_LIMIT) history.shift();
    } else {
      ctx.putImageData(completed.before, 0, 0);
    }
    if (canvas.hasPointerCapture(completed.id)) canvas.releasePointerCapture(completed.id);
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (stroke || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    const p = point(event);
    stroke = { id: event.pointerId, last: p, before: ctx.getImageData(0, 0, WIDTH, HEIGHT) };
    canvas.setPointerCapture(event.pointerId);
    pen();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });

  function move(event) {
    if (!stroke || event.pointerId !== stroke.id) return;
    event.preventDefault();
    const events = event.getCoalescedEvents?.() || [];
    for (const sample of events.length ? events : [event]) {
      const p = point(sample);
      pen();
      ctx.beginPath();
      ctx.moveTo(stroke.last.x, stroke.last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      stroke.last = p;
    }
  }
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', (event) => {
    if (stroke?.id !== event.pointerId) return;
    move(event);
    finish(true);
  });
  for (const type of ['pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, (event) => {
      if (stroke?.id === event.pointerId) finish(false);
    });
  }
  // Non-passive listeners cancel touch panning on this canvas only, without
  // adding CSS or changing scrolling elsewhere in the notebook.
  for (const type of ['touchstart', 'touchmove']) {
    canvas.addEventListener(type, (event) => event.preventDefault(), { passive: false });
  }

  function clear() {
    finish(false);
    history.length = 0;
    white();
  }

  function undo() {
    finish(false);
    const previous = history.pop();
    if (previous) ctx.putImageData(previous, 0, 0);
  }

  function drawSample() {
    clear();
    pen();
    const line = (points) => {
      ctx.beginPath();
      points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.stroke();
    };
    line([[100, 520], [900, 520]]);
    line([[340, 515], [455, 330], [570, 515], [340, 515]]);
    for (let x = 350; x < 565; x += 22) line([[x, 520], [x - 14, 540]]);
    line([[245, 425], [720, 205], [730, 225], [255, 445], [245, 425]]);
    ctx.beginPath();
    ctx.arc(455, 340, 13, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(720, 170, 28, 0, Math.PI * 2);
    ctx.stroke();
  }

  white();
  return { clear, undo, drawSample, getCanvas: () => canvas };
}

export async function toSketch(source) {
  let image = source;
  let objectURL;
  try {
    let width;
    let height;
    if (source instanceof File) {
      if (!source.type.startsWith('image/')) throw new Error('Please choose an image file, such as PNG or JPEG.');
      objectURL = URL.createObjectURL(source);
      image = new Image();
      image.src = objectURL;
      try {
        await image.decode();
      } catch {
        throw new Error('This image could not be read. Try a PNG or JPEG image.');
      }
      width = image.naturalWidth;
      height = image.naturalHeight;
    } else if (source instanceof HTMLVideoElement) {
      width = source.videoWidth;
      height = source.videoHeight;
      if (source.readyState < 2 || !width || !height) throw new Error('The camera is not ready yet. Please try again.');
    } else if (source instanceof HTMLCanvasElement) {
      width = source.width;
      height = source.height;
    } else {
      throw new Error('Please use an image file, camera frame or drawing canvas.');
    }
    if (!width || !height) throw new Error('This image has no usable dimensions.');

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const scale = Math.min(WIDTH / width, HEIGHT / height);
    ctx.drawImage(image, (WIDTH - width * scale) / 2, (HEIGHT - height * scale) / 2, width * scale, height * scale);

    // Process the opaque composite, including transparent source pixels. White
    // stays white under this contrast transform, preserving letterbox margins.
    const pixels = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const gray = 0.2126 * pixels.data[i] + 0.7152 * pixels.data[i + 1] + 0.0722 * pixels.data[i + 2];
      const value = Math.max(0, Math.min(255, (gray - 127.5) * 1.4 + 127.5));
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
      pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    const dataURL = canvas.toDataURL('image/jpeg', 0.9);
    if (!dataURL.startsWith('data:image/jpeg;base64,')) throw new Error('The browser could not export this sketch as JPEG.');
    return { canvas, base64: dataURL.slice(dataURL.indexOf(',') + 1) };
  } catch (error) {
    if (error.name === 'SecurityError') throw new Error('This image cannot be read securely. Try uploading a local PNG or JPEG.');
    throw error;
  } finally {
    if (objectURL) URL.revokeObjectURL(objectURL);
  }
}
