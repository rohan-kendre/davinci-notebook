import { setupDrawPad, toSketch } from './capture.js';

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
