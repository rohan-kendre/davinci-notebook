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
