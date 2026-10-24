'use strict';

const keyboard = document.querySelector('#keyboard');
const demo = document.querySelector('#typing-demo');
const status = document.querySelector('#audio-status');
const volume = document.querySelector('#demo-volume');
const soundToggle = document.querySelector('#sound-toggle');
const keyButtons = new Map();
const key = (label, code, units = 1, style = '') => ({ label, code, units, style });
const letters = (text) => [...text].map(letter => key(letter.toLowerCase(), `Key${letter}`));
const rows = [
  [key('esc', 'Escape', 1, 'esc'), ...'1234567890'.split('').map(n => key(n, `Digit${n}`)), key('−', 'Minus'), key('=', 'Equal'), key('delete', 'Backspace', 2, 'mod')],
  [key('tab', 'Tab', 1.5, 'mod'), ...letters('QWERTYUIOP'), key('[', 'BracketLeft'), key(']', 'BracketRight'), key('\\', 'Backslash', 1.5)],
  [key('caps', 'CapsLock', 1.75, 'mod'), ...letters('ASDFGHJKL'), key(';', 'Semicolon'), key("'", 'Quote'), key('return', 'Enter', 2.25, 'mod')],
  [key('shift', 'ShiftLeft', 2.25, 'mod'), ...letters('ZXCVBNM'), key(',', 'Comma'), key('.', 'Period'), key('/', 'Slash'), key('shift', 'ShiftRight', 2.75, 'mod')],
  [key('fn', 'Fn', 1, 'mod'), key('⌃', 'ControlLeft', 1, 'mod'), key('⌥', 'AltLeft', 1, 'mod'), key('⌘', 'MetaLeft', 1.25, 'mod'), key('', 'Space', 5.5, 'space'), key('⌘', 'MetaRight', 1.25, 'mod'), key('⌥', 'AltRight', 1, 'mod'), key('←', 'ArrowLeft', 1, 'mod'), [key('↑', 'ArrowUp', 1, 'mod'), key('↓', 'ArrowDown', 1, 'mod')], key('→', 'ArrowRight', 1, 'mod')]
];
function makeKey(def) {
  const button = document.createElement('button');
  button.className = `key ${def.style}`;
  button.type = 'button';
  button.style.setProperty('--u', def.units);
  button.textContent = def.label;
  button.setAttribute('aria-label', `Play ${def.code === 'Space' ? 'spacebar' : def.label || def.code} key`);
  // The focused text field provides a single, full-keyboard alternative to tabbing through every key.
  button.tabIndex = -1;
  button.addEventListener('pointerdown', () => flashKey(def.code));
  button.addEventListener('click', () => { previewGeneration++; play(def.code); });
  keyButtons.set(def.code, button);
  return button;
}
for (const row of rows) {
  const element = document.createElement('div');
  element.className = 'key-row';
  for (const def of row) {
    if (Array.isArray(def)) {
      const stack = document.createElement('div');
      stack.className = 'key-stack';
      def.forEach(item => stack.append(makeKey(item)));
      element.append(stack);
    } else element.append(makeKey(def));
  }
  keyboard.append(element);
}

let selectedProfile = 'cream';
let soundEnabled = true;
let audioContext;
let outputGain;
let manifestPromise;
let previewGeneration = 0;
const bufferPromises = new Map();
const activeSources = new Set();
const pressedTimers = new Map();
const profileNames = { cream: 'NK Cream', brown: 'Cherry MX Brown', blue: 'Cherry MX Blue' };

async function prepareAudio(profile) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Web Audio unavailable');
  if (!audioContext) {
    audioContext = new AudioContextClass();
    outputGain = audioContext.createGain();
    outputGain.gain.value = Number(volume.value) / 100 * 0.8;
    outputGain.connect(audioContext.destination);
  }
  // Resume in the original input gesture, before any network await.
  if (audioContext.state === 'suspended') await audioContext.resume();
  if (!manifestPromise) manifestPromise = fetch('assets/audio/manifest.json').then(response => {
    if (!response.ok) throw new Error('Manifest unavailable');
    return response.json();
  }).catch(error => { manifestPromise = null; throw error; });
  const manifest = await manifestPromise;
  if (!bufferPromises.has(profile)) {
    bufferPromises.set(profile, fetch(`assets/audio/${manifest.profiles[profile].file}`).then(response => {
      if (!response.ok) throw new Error('Recording unavailable');
      return response.arrayBuffer();
    }).then(bytes => audioContext.decodeAudioData(bytes)).catch(error => {
      bufferPromises.delete(profile);
      throw error;
    }));
  }
  return { buffer: await bufferPromises.get(profile), keys: manifest.profiles[profile].keys };
}
function flashKey(code, duration = 150) {
  const button = keyButtons.get(code);
  if (!button) return;
  clearTimeout(pressedTimers.get(code));
  button.classList.add('pressed');
  pressedTimers.set(code, setTimeout(() => {
    button.classList.remove('pressed');
    pressedTimers.delete(code);
  }, duration));
}
async function play(code, profile = selectedProfile, generation = previewGeneration) {
  flashKey(code);
  if (!soundEnabled) return;
  try {
    const { buffer, keys } = await prepareAudio(profile);
    if (!soundEnabled || generation !== previewGeneration || document.hidden) return;
    // Fn does not have a recording in these packs; do not substitute another key.
    const sample = keys[code];
    if (!sample) {
      status.textContent = 'No recording for this key in this pack.';
      return;
    }
    if (activeSources.size >= 16) activeSources.values().next().value.stop();
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(outputGain);
    activeSources.add(source);
    source.onended = () => { activeSources.delete(source); source.disconnect(); };
    source.start(0, sample.offset, sample.duration);
    status.textContent = `${profileNames[profile]} · real recorded keys`;
  } catch {
    status.textContent = 'Audio couldn’t load. Tap a key to retry.';
  }
}
function stopAudio() {
  previewGeneration++;
  activeSources.forEach(source => { try { source.stop(); } catch {} });
}
async function preview(profile) {
  stopAudio();
  const generation = previewGeneration;
  if (!soundEnabled) return;
  status.textContent = 'Getting your sound ready…';
  // Play the first key immediately after the sprite is ready, then a short typing rhythm.
  await play('KeyA', profile, generation);
  if (generation !== previewGeneration) return;
  [['KeyS', 120], ['KeyD', 250], ['Space', 430]].forEach(([code, delay]) => {
    setTimeout(() => {
      if (generation === previewGeneration && soundEnabled) play(code, profile, generation);
    }, delay);
  });
}
document.querySelectorAll('[data-profile]').forEach(button => {
  button.addEventListener('click', () => {
    selectedProfile = button.dataset.profile;
    document.querySelectorAll('[data-profile]').forEach(option => {
      const active = option === button;
      option.classList.toggle('active', active);
      option.setAttribute('aria-pressed', String(active));
    });
    preview(selectedProfile);
  });
});
demo.addEventListener('keydown', event => {
  if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.code === 'Tab' || event.code === 'Escape') return;
  play(event.code);
});
demo.addEventListener('beforeinput', event => {
  // Mobile virtual keyboards usually have no KeyboardEvent.code.
  if (event.inputType === 'insertText' && event.data && !demo.dataset.physicalKey) {
    const char = event.data.slice(-1);
    const code = /[a-z]/i.test(char) ? `Key${char.toUpperCase()}` : /[0-9]/.test(char) ? `Digit${char}` : char === ' ' ? 'Space' : null;
    if (code) play(code);
  }
});
demo.addEventListener('keydown', event => {
  if (event.code) { demo.dataset.physicalKey = 'true'; setTimeout(() => delete demo.dataset.physicalKey, 0); }
});
soundToggle.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  soundToggle.setAttribute('aria-pressed', String(soundEnabled));
  soundToggle.querySelector('span').textContent = soundEnabled ? 'Sound on' : 'Sound off';
  if (!soundEnabled) {
    stopAudio();
    status.textContent = 'A quiet moment.';
  } else {
    preview(selectedProfile);
  }
});
volume.addEventListener('input', () => {
  if (outputGain) outputGain.gain.setTargetAtTime(Number(volume.value) / 100 * 0.8, audioContext.currentTime, 0.015);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopAudio(); audioContext?.suspend(); }
});

function openDialog(id) {
  stopAudio();
  document.getElementById(id).showModal();
}
document.querySelectorAll('[data-download]').forEach(button => button.addEventListener('click', () => openDialog('download-dialog')));
document.querySelectorAll('[data-dialog]').forEach(button => button.addEventListener('click', () => openDialog(button.dataset.dialog)));
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    }
  });
});
