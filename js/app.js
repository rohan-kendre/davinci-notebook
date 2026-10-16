import { setupDrawPad, toSketch } from './capture.js';
import { createSim } from './physics.js';
import { createRenderer } from './render.js';
import { createView3D } from './view3d.js';
import { PRESETS } from './gallery.js';
import { normalizeScene } from './scene.js';
import { interpretSketch, askLeonardo } from './ai.js';

const tabs = [...document.querySelectorAll('[role="tab"]')];
const homeScreen = document.getElementById('screen-home');
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
  const changed = homeScreen.classList.contains('is-active') || !selectedTab.classList.contains('is-active');
  if (selectedTab !== liveTab && liveTab.classList.contains('is-active')) disposeLive();
  if (selectedTab.id !== 'tab-draw') {
    stopCamera();
    uploadVersion += 1;
  }
  homeScreen.classList.remove('is-active');
  homeScreen.hidden = true;
  for (const tab of tabs) {
    const active = tab === selectedTab;
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    panel.classList.toggle('is-active', active);
    panel.hidden = !active;
  }
  if (selectedTab.id === 'tab-interpret' && appState.scene && appState.sketch) {
    drawInterpretScene();
    renderParts();
  }
  if (selectedTab === liveTab && sim) {
    renderer.draw();
    syncView();
    startLoop();
  }
  if (changed) window.scrollTo(0, 0);
}

function showHome() {
  if (document.getElementById('tab-live').classList.contains('is-active')) disposeLive();
  stopCamera();
  uploadVersion += 1;
  for (const tab of tabs) {
    tab.classList.remove('is-active');
    tab.setAttribute('aria-selected', 'false');
    tab.tabIndex = tab.id === 'tab-gallery' ? 0 : -1;
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    panel.classList.remove('is-active');
    panel.hidden = true;
  }
  homeScreen.hidden = false;
  homeScreen.classList.add('is-active');
  window.scrollTo(0, 0);
}

for (const id of ['brand-home', 'home-link']) {
  document.getElementById(id).addEventListener('click', (event) => {
    event.preventDefault();
    showHome();
  });
}
document.getElementById('home-draw').addEventListener('click', () => selectTab(document.getElementById('tab-draw')));
document.getElementById('home-gallery').addEventListener('click', () => selectTab(document.getElementById('tab-gallery')));

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

const SETTINGS_KEY = 'davinci-notebook.settings';
const defaults = {
  provider: 'gemini',
  geminiApiKey: '',
  geminiModel: 'gemini-3.8-flash',
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
    if (!['mock', 'gemini'].includes(loaded.provider)) {
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
document.getElementById('settings-test').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const provider = settingsForm.elements.namedItem('provider').value;
  if (provider === 'mock') { showToast('Mock is ready to use offline.'); return; }
  const key = settingsForm.elements.namedItem('geminiApiKey').value.trim();
  const model = settingsForm.elements.namedItem('geminiModel').value.trim();
  if (!key) { showToast('Add a Gemini API key first.', true); return; }
  if (!/^[A-Za-z0-9._-]+$/.test(model)) {
    showToast('Enter a valid Gemini model name.', true);
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  button.disabled = true;
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}`, {
      headers: { 'x-goog-api-key': key }, signal: controller.signal,
    });
    if (response.ok) showToast(`${model} is ready.`);
    else if (response.status === 400 || response.status === 401 || response.status === 403)
      showToast('Gemini rejected this API key. Check it in Settings.', true);
    else if (response.status === 404)
      showToast('Gemini model not found. Check the model name.', true);
    else if (response.status === 429)
      showToast('Gemini quota or rate limit reached. Try again later.', true);
    else showToast(`Gemini connection test failed (${response.status}).`, true);
  } catch {
    showToast(controller.signal.aborted
      ? 'Gemini connection test timed out. Try again.'
      : 'Could not reach Gemini. Check your internet connection.', true);
  } finally {
    clearTimeout(timer);
    button.disabled = false;
  }
});
settingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  saveSettings();
});

const drawCanvas = document.getElementById('draw-canvas');
const drawPad = setupDrawPad(drawCanvas);
const appState = { sketch: null, scene: null };
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
  appState.scene = null;
  action();
}
document.getElementById('draw-undo').addEventListener('click', () => changeDrawing(drawPad.undo));
document.getElementById('draw-clear').addEventListener('click', () => changeDrawing(drawPad.clear));
document.getElementById('draw-sample').addEventListener('click', () => changeDrawing(drawPad.drawSample));
drawCanvas.addEventListener('pointerdown', () => {
  uploadVersion += 1;
  appState.sketch = null;
  appState.scene = null;
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

const interpretCanvas = document.getElementById('interpret-canvas');
const partsList = document.getElementById('parts-list');
const interpretButton = document.getElementById('draw-interpret');
const rereadButton = document.getElementById('interpret-reread');
const breatheButton = document.getElementById('interpret-live');
let interpretBusy = false;

function drawInterpretScene() {
  if (!appState.sketch || !appState.scene) return;
  const ctx = interpretCanvas.getContext('2d');
  ctx.clearRect(0, 0, 1000, 625);
  ctx.drawImage(appState.sketch.canvas, 0, 0);
  for (const body of appState.scene.bodies) {
    ctx.save();
    ctx.strokeStyle = '#8B3E1C';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 6]);
    ctx.beginPath();
    if (body.shape === 'circle') {
      ctx.arc(body.x, body.y, body.radius, 0, Math.PI * 2);
    } else if (body.shape === 'rect') {
      ctx.translate(body.x, body.y);
      ctx.rotate(body.angle * Math.PI / 180);
      ctx.rect(-body.width / 2, -body.height / 2, body.width, body.height);
    } else {
      body.vertices.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.closePath();
    }
    ctx.stroke();
    ctx.restore();
    const anchor = body.shape === 'polygon' ? body.vertices[0] : [body.x, body.y];
    const tagX = Math.max(5, Math.min(850, anchor[0] + 12));
    const tagY = Math.max(22, Math.min(610, anchor[1] - 14));
    ctx.font = '13px "Space Mono", monospace';
    const label = body.label.slice(0, 22);
    const width = ctx.measureText(label).width + 14;
    ctx.fillStyle = '#FBF5E6';
    ctx.fillRect(tagX, tagY - 16, width, 21);
    ctx.strokeStyle = '#8B3E1C';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeRect(tagX, tagY - 16, width, 21);
    ctx.fillStyle = '#3B2A1A';
    ctx.fillText(label, tagX + 7, tagY);
  }
}

function renderParts() {
  partsList.replaceChildren();
  for (const body of appState.scene?.bodies || []) {
    const row = document.createElement('div');
    row.className = 'part-row';
    const label = document.createElement('strong');
    label.className = 'part-label';
    label.textContent = body.label;
    const shape = document.createElement('span');
    shape.className = 'part-tag';
    shape.textContent = body.shape;
    const material = document.createElement('select');
    material.className = 'part-material';
    material.setAttribute('aria-label', `Material for ${body.label}`);
    for (const name of ['wood', 'stone', 'metal', 'rubber', 'cloth', 'earth']) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      material.append(option);
    }
    material.value = body.material;
    material.addEventListener('change', () => { body.material = material.value; drawInterpretScene(); });
    const fixed = document.createElement('label');
    fixed.className = 'part-fixed';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = body.static;
    checkbox.addEventListener('change', () => { body.static = checkbox.checked; drawInterpretScene(); });
    fixed.append(checkbox, ' Fixed');
    const remove = document.createElement('button');
    remove.className = 'part-delete icon-btn';
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Delete ${body.label}`);
    remove.addEventListener('click', () => {
      appState.scene.bodies = appState.scene.bodies.filter(part => part !== body);
      appState.scene.joints = appState.scene.joints.filter(joint => joint.a !== body.id && joint.b !== body.id);
      appState.scene.motors = appState.scene.motors.filter(motor => motor.body !== body.id);
      appState.scene.velocities = appState.scene.velocities.filter(velocity => velocity.body !== body.id);
      renderParts();
      drawInterpretScene();
    });
    row.append(label, shape, material, fixed, remove);
    partsList.append(row);
  }
  breatheButton.disabled = !appState.scene?.bodies.length;
}

async function runInterpret(reuseSketch = false) {
  if (interpretBusy) return;
  interpretBusy = true;
  interpretButton.disabled = true;
  rereadButton.disabled = true;
  const messages = ['Leonardo is studying your sketch…', 'Measuring the beams…', 'Finding the pivots…'];
  let messageIndex = 0;
  setLoading(true, messages[messageIndex]);
  const rotate = setInterval(() => setLoading(true, messages[++messageIndex % messages.length]), 700);
  try {
    if (!reuseSketch || !appState.sketch) {
      stopCamera();
      uploadVersion += 1;
      appState.sketch = await toSketch(drawPad.getCanvas());
    }
    const raw = await interpretSketch(appState.sketch.base64, settings);
    appState.scene = normalizeScene(raw);
    selectTab(document.getElementById('tab-interpret'));
    document.getElementById('screen-interpret').focus();
  } catch (error) {
    showToast(error.message || 'Could not interpret this sketch. Please try again.', true);
  } finally {
    clearInterval(rotate);
    setLoading(false);
    interpretBusy = false;
    interpretButton.disabled = false;
    rereadButton.disabled = false;
  }
}

interpretButton.addEventListener('click', () => void runInterpret());
rereadButton.addEventListener('click', () => void runInterpret(true));
breatheButton.addEventListener('click', () => {
  if (!appState.scene?.bodies.length) return;
  loadScene(appState.scene, appState.sketch?.canvas || null);
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
const viewContainer = document.getElementById('sim-view3d');
const viewToggle = document.getElementById('view-toggle');
let view3d = null;
let viewMode = '2d';
let view3dFailed = false;
let sim = null;
let renderer = null;
let playing = false;
let animationFrame = 0;
let lastStatsUpdate = 0;
let imageVersion = 0;
let currentScene = null;

function syncView() {
  const in3D = viewMode === '3d' && Boolean(view3d) && !view3dFailed;
  simCanvas.hidden = in3D;
  viewContainer.hidden = !in3D;
  for (const mode of ['2d', '3d']) {
    const button = document.getElementById(`view-${mode}`);
    const selected = mode === (in3D ? '3d' : '2d');
    button.setAttribute('aria-pressed', String(selected));
    button.classList.toggle('is-active', selected);
  }
  if (in3D && sim && liveTab.classList.contains('is-active') && !document.hidden) view3d.start();
  else view3d?.stop();
  if (!in3D) renderer?.draw();
}

function disable3D(error) {
  console.warn('Optional 3D view unavailable; continuing in 2D.', error);
  view3dFailed = true;
  viewToggle.hidden = true;
  viewMode = '2d';
  syncView();
}

for (const mode of ['2d', '3d']) {
  document.getElementById(`view-${mode}`).addEventListener('click', () => {
    viewMode = mode;
    syncView();
  });
}
viewContainer.addEventListener('view3d-unavailable', () => disable3D('WebGL context lost'));

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
  view3d?.stop();
  view3d?.setSim(null);
  imageVersion += 1;
  sim?.destroy();
  sim = null;
  renderer = null;
  currentScene = null;
  playing = false;
  liveContent.hidden = true;
  liveEmpty.hidden = false;
  document.getElementById('live-title').textContent = 'Breathe life';
  document.getElementById('note-text').textContent = '';
  updateStats();
}

function loadScene(scene, sketchImage = null) {
  disposeLive();
  gravitySlider.value = '1';
  timeSlider.value = '1';
  showSketch.checked = true;
  showLabels.checked = false;
  document.getElementById('sim-gravity-value').textContent = '1.00×';
  document.getElementById('sim-time-value').textContent = '1.0×';

  const version = ++imageVersion;
  currentScene = scene;
  const image = typeof sketchImage === 'string' ? new Image() : sketchImage;
  sim = createSim(scene);
  renderer = createRenderer(simCanvas, sim, {
    sketchImage: image, showSketch: true, showLabels: false,
  });
  if (!view3dFailed) {
    try {
      if (view3d) view3d.setSim(sim);
      else view3d = createView3D(viewContainer, sim);
      viewToggle.hidden = false;
    } catch (error) {
      disable3D(error);
    }
  }
  document.getElementById('live-title').textContent = scene.title;
  document.getElementById('note-text').textContent = scene.note;
  liveEmpty.hidden = true;
  liveContent.hidden = false;
  playPause.textContent = 'Pause';
  playing = true;
  lastStatsUpdate = 0;
  updateStats();
  selectTab(liveTab);
  sim.attachMouse(simCanvas);
  if (typeof sketchImage === 'string') {
    image.onload = () => {
      if (version === imageVersion && renderer) renderer.draw();
    };
    image.onerror = () => {
      if (version === imageVersion && renderer) {
        renderer.set('sketchImage', null);
        renderer.draw();
      }
    };
    image.src = sketchImage;
  }
}

function loadPreset(preset) {
  loadScene(preset.scene, preset.image);
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
document.getElementById('ask-leonardo').addEventListener('click', async (event) => {
  if (!sim || !currentScene) return;
  const button = event.currentTarget;
  const scene = currentScene;
  button.disabled = true;
  try {
    const answer = await askLeonardo(scene, sim.getStats(), settings);
    if (scene === currentScene) document.getElementById('note-text').textContent = answer;
  } catch (error) {
    showToast(error.message || 'Leonardo could not answer just now.', true);
  } finally {
    button.disabled = false;
  }
});
document.getElementById('live-back').addEventListener('click', () => {
  selectTab(document.getElementById('tab-gallery'));
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopLoop();
    view3d?.stop();
  } else {
    startLoop();
    syncView();
  }
});
window.addEventListener('pagehide', disposeLive);
