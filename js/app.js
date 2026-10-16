import { setupDrawPad, toSketch } from './capture.js';
import { createSim } from './physics.js';
import { createRenderer } from './render.js';
import { PRESETS } from './gallery.js';

const tabs = [...document.querySelectorAll('[role="tab"]')];
const toast = document.getElementById('toast');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
let toastTimer;

export function showToast(message, isError = false) {
  window.clearTimeout(toastTimer);
  // A modal makes the rest of the document inert, including live regions.
  const modal = document.getElementById('settings-modal');
  (modal.open ? modal : document.body).append(toast);
  toast.textContent = String(message);
  toast.classList.toggle('is-error', Boolean(isError));
  toast.classList.add('is-visible');
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
    toast.classList.remove('is-visible', 'is-error');
    toast.textContent = '';
  }, 3500);
}

export function setLoading(visible, message = 'Loading…') {
  loadingText.textContent = visible ? String(message) : '';
  loadingOverlay.hidden = !visible;
  loadingOverlay.classList.toggle('is-visible', Boolean(visible));
}

function selectTab(selectedTab) {
  const liveTab = document.getElementById('tab-live');
  const changed = !selectedTab.classList.contains('is-active');
  if (selectedTab !== liveTab && liveTab.classList.contains('is-active')) disposeLive();
  if (selectedTab.id !== 'tab-draw') {
    stopCamera();
    uploadVersion += 1;
  }
  for (const tab of tabs) {
    const active = tab === selectedTab;
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    panel.classList.toggle('is-active', active);
    panel.hidden = !active;
  }
  if (selectedTab === liveTab && sim) {
    renderer.draw();
    startLoop();
  }
  if (changed) window.scrollTo(0, 0);
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (event) => {
    let nextIndex;
    switch (event.key) {
      case 'ArrowRight': nextIndex = (index + 1) % tabs.length; break;
      case 'ArrowLeft': nextIndex = (index - 1 + tabs.length) % tabs.length; break;
      case 'Home': nextIndex = 0; break;
      case 'End': nextIndex = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    selectTab(tabs[nextIndex]);
    tabs[nextIndex].focus();
  });
});

document.querySelectorAll('[data-unfinished]').forEach((button) => {
  button.addEventListener('click', () => showToast('Available in the next step'));
});

const SETTINGS_KEY = 'davinci-notebook.settings';
const defaults = {
  provider: 'ollama',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'qwen3-vl:8b',
  geminiApiKey: '',
  geminiModel: '',
};
const settingsModal = document.getElementById('settings-modal');
const settingsForm = document.getElementById('settings-form');
const settingsOpen = document.getElementById('settings-open');
let previousFocus;

function loadSettings() {
  try {
    const stored = window.localStorage.getItem(SETTINGS_KEY);
    if (stored === null) return { ...defaults };
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid settings');
    }
    // Copy only known string fields; malformed individual fields use defaults.
    const loaded = { ...defaults };
    for (const key of Object.keys(defaults)) {
      if (typeof parsed[key] === 'string') loaded[key] = parsed[key];
    }
    if (!['ollama', 'gemini'].includes(loaded.provider)) {
      loaded.provider = defaults.provider;
    }
    return loaded;
  } catch {
    showToast('Could not load saved settings. Using defaults.', true);
    return { ...defaults };
  }
}

let settings = loadSettings();

function fillSettings() {
  for (const [key, value] of Object.entries(settings)) {
    settingsForm.elements.namedItem(key).value = value;
  }
}

fillSettings();

settingsOpen.addEventListener('click', () => {
  if (settingsModal.open) return;
  previousFocus = document.activeElement;
  fillSettings();
  settingsModal.hidden = false;
  settingsModal.classList.add('is-open');
  // Native modal behavior keeps keyboard focus inside the dialog.
  settingsModal.showModal();
  settingsForm.elements.namedItem('provider').focus();
});

function closeSettings() {
  settingsModal.close();
}

document.getElementById('settings-close').addEventListener('click', closeSettings);
settingsModal.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeSettings();
});
settingsModal.addEventListener('close', () => {
  settingsModal.hidden = true;
  settingsModal.classList.remove('is-open');
  document.body.append(toast);
  const target = previousFocus?.isConnected ? previousFocus : settingsOpen;
  target.focus();
});

function saveSettings() {
  if (!settingsForm.reportValidity()) return;
  const updated = Object.fromEntries(Object.keys(defaults).map((key) => [
    key, settingsForm.elements.namedItem(key).value.trim(),
  ]));
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
    settings = updated;
    showToast('Settings saved');
    closeSettings();
  } catch {
    // Keep the dialog and entered values available for retry; never log secrets.
    showToast('Could not save settings. Browser storage is unavailable.', true);
  }
}

document.getElementById('settings-save').addEventListener('click', saveSettings);
settingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  saveSettings();
});

const drawCanvas = document.getElementById('draw-canvas');
const drawPad = setupDrawPad(drawCanvas);
const appState = { sketch: null };
const uploadInput = document.getElementById('sketch-upload');
const cameraPreview = document.getElementById('camera-preview');
const cameraVideo = document.getElementById('camera-video');
const captureButton = document.getElementById('camera-capture');
const cameraStatus = document.getElementById('camera-status');
let uploadVersion = 0;
let cameraVersion = 0;
let cameraStream = null;
let cameraWait = null;

function changeDrawing(action) {
  uploadVersion += 1;
  appState.sketch = null;
  action();
}
document.getElementById('draw-undo').addEventListener('click', () => changeDrawing(drawPad.undo));
document.getElementById('draw-clear').addEventListener('click', () => changeDrawing(drawPad.clear));
document.getElementById('draw-sample').addEventListener('click', () => changeDrawing(drawPad.drawSample));
drawCanvas.addEventListener('pointerdown', () => {
  uploadVersion += 1;
  appState.sketch = null;
});

function paintSource(source, width, height) {
  if (!width || !height) throw new Error('This image has no usable dimensions.');
  const fitted = document.createElement('canvas');
  fitted.width = drawCanvas.width;
  fitted.height = drawCanvas.height;
  const ctx = fitted.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, fitted.width, fitted.height);
  const scale = Math.min(fitted.width / width, fitted.height / height);
  ctx.drawImage(source, (fitted.width - width * scale) / 2,
    (fitted.height - height * scale) / 2, width * scale, height * scale);
  // Clear discards prior strokes. The next stroke snapshots this new image,
  // making it the baseline to which drawing edits can be undone. Decode and
  // fit first so an unreadable source cannot erase the current sketch.
  changeDrawing(drawPad.clear);
  drawCanvas.getContext('2d').drawImage(fitted, 0, 0);
}

async function loadImage(file) {
  if (!file) return;
  stopCamera();
  const version = ++uploadVersion;
  let objectURL;
  try {
    if (!file.type.startsWith('image/')) throw new Error('Please choose an image file, such as PNG or JPEG.');
    objectURL = URL.createObjectURL(file);
    const image = new Image();
    image.src = objectURL;
    try {
      await image.decode();
    } catch {
      throw new Error('This image could not be read. Try a PNG or JPEG image.');
    }
    if (version === uploadVersion) paintSource(image, image.naturalWidth, image.naturalHeight);
  } catch (error) {
    if (version === uploadVersion) showToast(error.message, true);
  } finally {
    if (objectURL) URL.revokeObjectURL(objectURL);
  }
}

document.getElementById('draw-upload').addEventListener('click', () => uploadInput.click());
uploadInput.addEventListener('change', () => {
  const file = uploadInput.files[0];
  uploadInput.value = '';
  void loadImage(file);
});
// Guard the whole page so a missed drop cannot navigate away from the sketch.
for (const type of ['dragover', 'drop']) {
  window.addEventListener(type, (event) => {
    if (Array.from(event.dataTransfer?.types || []).includes('Files')) event.preventDefault();
  });
}
const drawingArea = document.getElementById('drawing-area');
drawingArea.addEventListener('dragover', (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
});
drawingArea.addEventListener('drop', (event) => {
  event.preventDefault();
  void loadImage(event.dataTransfer?.files[0]);
});

function stopCamera() {
  cameraVersion += 1;
  cameraWait?.abort();
  cameraWait = null;
  for (const track of cameraStream?.getTracks() || []) track.stop();
  cameraStream = null;
  cameraVideo.pause();
  cameraVideo.srcObject = null;
  cameraPreview.hidden = true;
  captureButton.disabled = true;
}

function waitForCamera(signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      for (const type of ['loadeddata', 'canplay', 'resize']) cameraVideo.removeEventListener(type, ready);
      cameraVideo.removeEventListener('error', failed);
      signal.removeEventListener('abort', cancelled);
    };
    const ready = () => {
      if (cameraVideo.readyState >= 2 && cameraVideo.videoWidth && cameraVideo.videoHeight) {
        cleanup();
        resolve();
      }
    };
    const failed = () => { cleanup(); reject(new Error('The camera could not provide a frame. Please try again.')); };
    const cancelled = () => { cleanup(); reject(new DOMException('Camera cancelled', 'AbortError')); };
    const timer = setTimeout(failed, 15000);
    for (const type of ['loadeddata', 'canplay', 'resize']) cameraVideo.addEventListener(type, ready);
    cameraVideo.addEventListener('error', failed);
    signal.addEventListener('abort', cancelled, { once: true });
    if (signal.aborted) cancelled();
    else ready();
  });
}

document.getElementById('draw-camera').addEventListener('click', async () => {
  stopCamera();
  uploadVersion += 1;
  const version = cameraVersion;
  cameraPreview.hidden = false;
  cameraStatus.textContent = 'Waiting for the camera…';
  document.getElementById('camera-cancel').focus();
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is unavailable. Use localhost or HTTPS, or upload an image.');
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    if (version !== cameraVersion) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    cameraStream = stream;
    cameraVideo.srcObject = stream;
    cameraWait = new AbortController();
    await Promise.all([cameraVideo.play(), waitForCamera(cameraWait.signal)]);
    if (version !== cameraVersion) return;
    captureButton.disabled = false;
    cameraStatus.textContent = 'Ready. Position your sketch, then capture.';
    captureButton.focus();
  } catch (error) {
    if (version !== cameraVersion) return;
    stopCamera();
    const messages = {
      NotAllowedError: 'Camera permission was denied. Allow access in your browser or upload an image.',
      NotFoundError: 'No camera was found. Connect a camera or upload an image.',
      NotReadableError: 'The camera is unavailable or in use by another app. Try again or upload an image.',
    };
    showToast(messages[error.name] || error.message || 'Could not open the camera. Try uploading an image.', true);
    document.getElementById('draw-camera').focus();
  }
});

captureButton.addEventListener('click', () => {
  try {
    if (cameraVideo.readyState < 2 || !cameraVideo.videoWidth || !cameraVideo.videoHeight) {
      throw new Error('The camera is not ready yet. Please try again.');
    }
    paintSource(cameraVideo, cameraVideo.videoWidth, cameraVideo.videoHeight);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    stopCamera();
    document.getElementById('draw-camera').focus();
  }
});
document.getElementById('camera-cancel').addEventListener('click', () => {
  stopCamera();
  document.getElementById('draw-camera').focus();
});
window.addEventListener('pagehide', stopCamera);
window.addEventListener('beforeunload', stopCamera);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopCamera();
});

document.getElementById('draw-interpret').addEventListener('click', async () => {
  stopCamera();
  uploadVersion += 1;
  setLoading(true, 'Preparing your sketch…');
  try {
    const sketch = await toSketch(drawPad.getCanvas());
    appState.sketch = sketch;
    document.getElementById('interpret-canvas').getContext('2d').drawImage(sketch.canvas, 0, 0);
    console.info({ width: sketch.canvas.width, height: sketch.canvas.height, base64Length: sketch.base64.length });
    selectTab(document.getElementById('tab-interpret'));
    document.getElementById('screen-interpret').focus();
  } catch (error) {
    showToast(error.message || 'Could not prepare this sketch. Please try again.', true);
  } finally {
    setLoading(false);
  }
});

const galleryGrid = document.getElementById('gallery-grid');
const liveTab = document.getElementById('tab-live');
const simCanvas = document.getElementById('sim-canvas');
const liveContent = document.getElementById('live-content');
const liveEmpty = document.getElementById('live-empty');
const playPause = document.getElementById('sim-play-pause');
const gravitySlider = document.getElementById('sim-gravity');
const timeSlider = document.getElementById('sim-time-scale');
const showSketch = document.getElementById('sim-show-sketch');
const showLabels = document.getElementById('sim-show-labels');
let sim = null;
let renderer = null;
let playing = false;
let animationFrame = 0;
let lastStatsUpdate = 0;
let imageVersion = 0;

function updateStats() {
  const stats = sim?.getStats() || { distance: 0, peak: 0, topSpeed: 0 };
  document.getElementById('stat-distance').textContent = stats.distance.toFixed(2);
  document.getElementById('stat-peak').textContent = stats.peak.toFixed(2);
  document.getElementById('stat-top-speed').textContent = stats.topSpeed.toFixed(2);
}

function stopLoop() {
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = 0;
}

function frame(now) {
  animationFrame = 0;
  if (!sim || !playing || !liveTab.classList.contains('is-active') || document.hidden) return;
  sim.step();
  renderer.draw();
  if (now - lastStatsUpdate >= 200) {
    updateStats();
    lastStatsUpdate = now;
  }
  animationFrame = requestAnimationFrame(frame);
}

function startLoop() {
  if (sim && playing && !animationFrame && liveTab.classList.contains('is-active') && !document.hidden) {
    animationFrame = requestAnimationFrame(frame);
  }
}

function disposeLive() {
  stopLoop();
  imageVersion += 1;
  sim?.destroy();
  sim = null;
  renderer = null;
  playing = false;
  liveContent.hidden = true;
  liveEmpty.hidden = false;
  document.getElementById('live-title').textContent = 'Breathe life';
  document.getElementById('note-text').textContent = '';
  updateStats();
}

function loadPreset(preset) {
  disposeLive();
  gravitySlider.value = '1';
  timeSlider.value = '1';
  showSketch.checked = true;
  showLabels.checked = false;
  document.getElementById('sim-gravity-value').textContent = '1.00×';
  document.getElementById('sim-time-value').textContent = '1.0×';

  const image = new Image();
  const version = ++imageVersion;
  sim = createSim(preset.scene);
  renderer = createRenderer(simCanvas, sim, {
    sketchImage: image, showSketch: true, showLabels: false,
  });
  document.getElementById('live-title').textContent = preset.scene.title;
  document.getElementById('note-text').textContent = preset.scene.note;
  liveEmpty.hidden = true;
  liveContent.hidden = false;
  playPause.textContent = 'Pause';
  playing = true;
  lastStatsUpdate = 0;
  updateStats();
  selectTab(liveTab);
  sim.attachMouse(simCanvas);
  image.onload = () => {
    if (version === imageVersion && renderer) renderer.draw();
  };
  image.onerror = () => {
    if (version === imageVersion && renderer) renderer.set('sketchImage', null);
  };
  image.src = preset.image;
}

for (const preset of PRESETS) {
  const card = document.createElement('article');
  card.className = 'gallery-card paper';
  card.tabIndex = 0;
  card.setAttribute('aria-label', `${preset.title}. ${preset.blurb}`);

  const thumb = document.createElement('div');
  thumb.className = 'gallery-thumb';
  const placeholder = document.createElement('span');
  placeholder.className = 'gallery-placeholder';
  placeholder.textContent = 'Drawing unavailable';
  placeholder.hidden = true;
  const image = document.createElement('img');
  image.alt = `Leonardo drawing of ${preset.title.toLowerCase()}`;
  image.loading = 'lazy';
  image.onerror = () => {
    image.hidden = true;
    placeholder.hidden = false;
  };
  image.src = preset.image;
  thumb.append(image, placeholder);

  const meta = document.createElement('div');
  meta.className = 'gallery-meta';
  const source = document.createElement('p');
  source.className = 'source';
  source.textContent = preset.source;
  const title = document.createElement('h3');
  title.textContent = preset.title;
  const blurb = document.createElement('p');
  blurb.className = 'gallery-blurb';
  blurb.textContent = preset.blurb;
  const button = document.createElement('button');
  button.className = 'gallery-link';
  button.type = 'button';
  button.textContent = 'Breathe life →';
  meta.append(source, title, blurb, button);
  card.append(thumb, meta);
  card.addEventListener('click', () => loadPreset(preset));
  card.addEventListener('keydown', (event) => {
    if (event.target !== card || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    loadPreset(preset);
  });
  galleryGrid.append(card);
}

playPause.addEventListener('click', () => {
  if (!sim) return;
  playing = !playing;
  playPause.textContent = playing ? 'Pause' : 'Play';
  if (playing) startLoop();
  else stopLoop();
});
document.getElementById('sim-reset').addEventListener('click', () => {
  if (!sim) return;
  sim.reset();
  renderer.draw();
  updateStats();
});
timeSlider.addEventListener('input', () => {
  sim?.setTimeScale(Number(timeSlider.value));
  document.getElementById('sim-time-value').textContent = `${Number(timeSlider.value).toFixed(1)}×`;
});
function setGravity(value) {
  gravitySlider.value = String(value);
  sim?.setGravity(value);
  document.getElementById('sim-gravity-value').textContent = `${value.toFixed(2)}×`;
}
gravitySlider.addEventListener('input', () => setGravity(Number(gravitySlider.value)));
document.querySelectorAll('[data-gravity]').forEach(chip => {
  chip.addEventListener('click', () => setGravity(Number(chip.dataset.gravity)));
});
showSketch.addEventListener('change', () => {
  renderer?.set('showSketch', showSketch.checked);
  if (renderer && !playing) renderer.draw();
});
showLabels.addEventListener('change', () => {
  renderer?.set('showLabels', showLabels.checked);
  if (renderer && !playing) renderer.draw();
});
document.getElementById('live-back').addEventListener('click', () => {
  selectTab(document.getElementById('tab-gallery'));
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopLoop();
  else startLoop();
});
window.addEventListener('pagehide', disposeLive);
