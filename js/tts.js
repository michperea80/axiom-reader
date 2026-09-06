/**
 * AXIOM READER ADVANCED TEXT-TO-SPEECH (TTS) SYSTEM
 * 
 * This file is a complete, drop-in replacement for the legacy `js/tts.js` in your Axiom Reader app.
 * It integrates Google Cloud's Chirp 3 HD and Gemini 3.1 Pro audio synthesis systems alongside 
 * your legacy local browser voice options, adding local IndexedDB caching to save API quota,
 * and a batch-compiler to download complete documents as standard WAV audio files.
 * 
 * TECHNICAL TERMS TRANSLATED:
 * - AudioContext: A built-in web browser manager for creating and controlling digital audio.
 * - IndexedDB: A database built inside your browser used to store large amounts of data locally.
 * - Compressor: An audio leveling tool that softens loud sounds and boosts quiet sounds to make speech clear.
 * - Base64: A text format used to encode binary files (like sound files) so they can be sent over the internet.
 * - 429 Quota Error: An error returned by servers when you make too many requests in a short period.
 */

// --- SECTION 1: GLOBAL AUDIO CONTEXT & WAKE STATE ---
let audioCtx = null;
let keepAliveSource = null;
let keepAliveScheduled = false;

// Setup or wake up the browser's AudioContext (set at 24kHz to match high-def models)
function ensureAudioCtx() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return;
  }
  try { 
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 24000 // Match standard Google voice sample rate (24kHz)
    }); 
  } catch (_) {
    console.error("Failed to initialize AudioContext");
  }
}

// Keeps mobile phone browsers awake during speech by feeding silent sound signals
function startKeepAlive() {
  if (!audioCtx || keepAliveScheduled) return;
  keepAliveScheduled = true;
  const sr = audioCtx.sampleRate;
  const frameCount = Math.ceil(sr * 0.1);
  const buf = audioCtx.createBuffer(1, frameCount, sr);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frameCount; i++) data[i] = (Math.random() * 2 - 1) * 0.0001;
  function scheduleNext() {
    if (!playing || !audioCtx) { keepAliveScheduled = false; return; }
    keepAliveSource = audioCtx.createBufferSource();
    keepAliveSource.buffer = buf;
    keepAliveSource.connect(audioCtx.destination);
    keepAliveSource.onended = scheduleNext;
    keepAliveSource.start();
  }
  scheduleNext();
}

// Stops the keep-alive signal
function stopKeepAlive() {
  keepAliveScheduled = false;
  if (keepAliveSource) {
    try { keepAliveSource.onended = null; keepAliveSource.stop(); } catch (_) {}
    keepAliveSource = null;
  }
}

let wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (_) {}
}

async function releaseWakeLock() {
  if (wakeLock) { try { await wakeLock.release(); } catch (_) {} wakeLock = null; }
}


// --- SECTION 2: SYSTEM MEDIA SESSION CONTROLS ---
function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.setActionHandler('play',          () => { if (!playing) startTTS(); });
  navigator.mediaSession.setActionHandler('pause',         () => { if (playing)  stopTTS();  });
  navigator.mediaSession.setActionHandler('stop',          () => stopTTS());
  navigator.mediaSession.setActionHandler('previoustrack', () => jump(-1));
  navigator.mediaSession.setActionHandler('nexttrack',     () => jump(1));
  navigator.mediaSession.setActionHandler('seekbackward',  d  => jump(-(d && d.seekOffset ? Math.ceil(d.seekOffset) : 5)));
  navigator.mediaSession.setActionHandler('seekforward',   d  => jump(d && d.seekOffset ? Math.ceil(d.seekOffset) : 5));
}

function updateMediaSession(state) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.playbackState = state;
  const fileElem = document.getElementById('file-name');
  const fileName = fileElem ? fileElem.textContent : 'No file loaded';
  navigator.mediaSession.metadata = new MediaMetadata({
    title:  fileName === 'No file loaded' ? 'AXIOM Reader' : fileName,
    artist: 'AXIOM // Reader',
    album:  ttsList.length ? `${idx + 1} of ${ttsList.length}` : '',
  });
}

function recoverPlayback() {
  if (!playing) return;
  if (!wakeLock) requestWakeLock();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  
  const engine = getSelectedVoiceEngine();
  if (engine === 'LEGACY') {
    synth.resume();
    if (!synth.paused && !synth.speaking && !synth.pending) {
      synth.cancel();
      speak(idx);
    }
  }
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) recoverPlayback(); });
window.addEventListener('focus', recoverPlayback);
window.addEventListener('pageshow', recoverPlayback);


// Default proxy URL — hard-coded so users never need to type or remember it.
// This is NOT a security risk: the proxy still requires GitHub OAuth login.
// Only the allowed GitHub user (configured on Vercel) can authenticate.
const DEFAULT_PROXY_URL = 'https://axiom-tts-proxy.vercel.app';

function cleanProxyUrl(url) {
  url = (url || '').trim();
  if (!url) return '';
  if (url.startsWith('http://')) {
    url = 'https://' + url.substring(7);
  } else if (!url.startsWith('https://')) {
    url = 'https://' + url;
  }
  while (url.endsWith('/')) {
    url = url.slice(0, -1);
  }
  return url;
}

// Resolve the active proxy URL: use saved value, or fall back to the default
function getProxyUrl() {
  const saved = cleanProxyUrl(localStorage.getItem('axiom-tts-proxy-url') || '');
  return saved || DEFAULT_PROXY_URL;
}

// --- LOADING PROGRESS BAR ---
// Shows a thin horizontal bar below the reader header during cloud voice synthesis.
// The bar fills incrementally at each processing phase so users see real progress.
function showLoadingBar() {
  const bar = document.getElementById('tts-progress-bar');
  const fill = document.getElementById('tts-progress-fill');
  if (bar) {
    bar.classList.add('active');
    bar.classList.remove('indeterminate');
  }
  if (fill) fill.style.width = '0%';
}
function updateLoadingBar(percent) {
  const fill = document.getElementById('tts-progress-fill');
  if (fill) fill.style.width = percent + '%';
}
function hideLoadingBar() {
  const bar = document.getElementById('tts-progress-bar');
  const fill = document.getElementById('tts-progress-fill');
  if (bar) bar.classList.remove('active', 'indeterminate');
  if (fill) fill.style.width = '0%';
}


// --- SECTION 3: DATABASE CACHING (INDEXEDDB) ---
// Note: these constant names are prefixed with TTS_CACHE_ to avoid collisions
// with library.js which also declares database constants in the global scope.
const TTS_CACHE_DB_NAME = 'axiom-tts-cache-db';
const TTS_CACHE_STORE_NAME = 'audio-cache';

// Simple, zero-dependency utility to read audio out of IndexedDB local storage
function getCachedAudio(key) {
  return new Promise((resolve) => {
    const request = indexedDB.open(TTS_CACHE_DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(TTS_CACHE_STORE_NAME)) {
        db.createObjectStore(TTS_CACHE_STORE_NAME);
      }
    };
    request.onsuccess = (e) => {
      const db = e.target.result;
      const transaction = db.transaction(TTS_CACHE_STORE_NAME, 'readonly');
      const store = transaction.objectStore(TTS_CACHE_STORE_NAME);
      const getRequest = store.get(key);
      getRequest.onsuccess = () => resolve(getRequest.result || null);
      getRequest.onerror = () => resolve(null);
    };
    request.onerror = () => resolve(null);
  });
}

// Simple, zero-dependency utility to save audio into IndexedDB local storage
function setCachedAudio(key, base64Value) {
  return new Promise((resolve) => {
    const request = indexedDB.open(TTS_CACHE_DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(TTS_CACHE_STORE_NAME)) {
        db.createObjectStore(TTS_CACHE_STORE_NAME);
      }
    };
    request.onsuccess = (e) => {
      const db = e.target.result;
      const transaction = db.transaction(TTS_CACHE_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(TTS_CACHE_STORE_NAME);
      const putRequest = store.put(base64Value, key);
      putRequest.onsuccess = () => resolve(true);
      putRequest.onerror = () => resolve(false);
    };
    request.onerror = () => resolve(false);
  });
}


// --- SECTION 4: ADVANCED VOICES DEFINITIONS ---
// Voice profiles with descriptions for the 3-column settings panel cards
const ADVANCED_CHIRP_VOICES = [
  { id: 'en-US-Chirp3-HD-Charon', name: 'Charon (US) — Male', desc: 'Deep, resonant, mature male' },
  { id: 'en-US-Chirp3-HD-Fenrir', name: 'Fenrir (US) — Male', desc: 'Steady, slightly raspy male' },
  { id: 'en-US-Chirp3-HD-Enceladus', name: 'Enceladus (US) — Male', desc: 'Smooth, deep male' },
  { id: 'en-US-Chirp3-HD-Aoede', name: 'Aoede (US) — Female', desc: 'Warm, clear female' },
  { id: 'en-US-Chirp3-HD-Kore', name: 'Kore (US) — Female', desc: 'Bright, expressive female' },
  { id: 'en-US-Chirp3-HD-Leda', name: 'Leda (US) — Female', desc: 'Soft, gentle female' },
  { id: 'en-GB-Chirp3-HD-Charon', name: 'Charon (UK) — Male', desc: 'Deep, resonant, mature male' },
  { id: 'en-GB-Chirp3-HD-Fenrir', name: 'Fenrir (UK) — Male', desc: 'Steady, slightly raspy male' },
  { id: 'en-GB-Chirp3-HD-Enceladus', name: 'Enceladus (UK) — Male', desc: 'Smooth, deep male' },
  { id: 'en-GB-Chirp3-HD-Aoede', name: 'Aoede (UK) — Female', desc: 'Warm, clear female' },
  { id: 'en-GB-Chirp3-HD-Kore', name: 'Kore (UK) — Female', desc: 'Bright, expressive female' },
  { id: 'en-GB-Chirp3-HD-Leda', name: 'Leda (UK) — Female', desc: 'Soft, gentle female' }
];

const ADVANCED_GEMINI_VOICES = [
  { id: 'gemini-Puck', name: 'Puck (Gemini)', desc: 'Energetic, playful' },
  { id: 'gemini-Charon', name: 'Charon (Gemini)', desc: 'Deep, thoughtful' },
  { id: 'gemini-Kore', name: 'Kore (Gemini)', desc: 'Bright, clear' },
  { id: 'gemini-Fenrir', name: 'Fenrir (Gemini)', desc: 'Steady, grounded' },
  { id: 'gemini-Aoede', name: 'Aoede (Gemini)', desc: 'Warm, melodic' },
  { id: 'gemini-Leda', name: 'Leda (Gemini)', desc: 'Gentle, soothing' }
];

const ADVANCED_NEURAL2_VOICES = [
  { id: 'en-US-Neural2-D', name: 'Neural2 D (US) — Male', desc: 'Clear, steady American male' },
  { id: 'en-US-Neural2-F', name: 'Neural2 F (US) — Female', desc: 'Clear, natural American female' },
  { id: 'en-US-Neural2-F', style: 'lively', name: 'Neural2 F (US) — Female · Lively (Preview)', desc: 'Brighter, more energetic delivery' },
  { id: 'en-US-Neural2-J', name: 'Neural2 J (US) — Male', desc: 'Natural American male' },
  { id: 'en-US-Neural2-J', style: 'lively', name: 'Neural2 J (US) — Male · Lively (Preview)', desc: 'Brighter, more energetic delivery' },
  { id: 'en-GB-Neural2-B', name: 'Neural2 B (UK) — Male', desc: 'Clear, steady British male' },
  { id: 'en-GB-Neural2-F', name: 'Neural2 F (UK) — Female', desc: 'Clear, natural British female' }
];

const NEURAL2_STYLE_SEPARATOR = '::style=';

function advancedVoiceValue(voice) {
  return voice.style ? `${voice.id}${NEURAL2_STYLE_SEPARATOR}${voice.style}` : voice.id;
}

function parseAdvancedVoiceSelection(value) {
  const [voiceId, style = ''] = String(value || '').split(NEURAL2_STYLE_SEPARATOR, 2);
  return { voiceId, style: style === 'lively' ? 'lively' : '' };
}

// Engine definitions for the settings panel cards
const TTS_ENGINES = [
  { id: 'legacy', name: 'Legacy Speech synthesis', desc: 'Local processor offline speech module synth block', mode: 'offline' },
  { id: 'chirp', name: 'Chirp 3 HD Web-API', desc: 'Google Cloud high fidelity hyper-resonant neural stream', mode: 'proxy' },
  { id: 'neural2', name: 'Google Neural2 with live following', desc: 'Natural Google voice with sentence-timed highlighting and scrolling', mode: 'proxy' },
  { id: 'gemini', name: 'Gemini 3.1 Flash TTS (Preview)', desc: 'Higher-cost voice generation for intentional sections and exports', mode: 'proxy' }
];


// --- SECTION 5: PLAYBACK ENGINE & RATE LIMIT MANAGER ---
const synth = window.speechSynthesis;
let voices = [];
let idx = 0;
let playing = false;
let queueToken = 0;
let speechTimer = null;
let currentUtterance = null;

// Advanced audio player references
let currentAudioSource = null;
let isAudioContextSpeaking = false;
let audioAnalyser = null;
let visualizerAnimationId = null;
let visualizerSpike = 0;
let advancedFollowTimerId = null;
let advancedFollowSource = null;

// Cloud generation is deliberately conservative. Chirp gets enough capacity to
// stay ahead of playback once text is chunked; Gemini remains limited because it
// is intended for intentional, higher-cost generation rather than live reading.
const API_REQUESTS_PER_MINUTE = {
  CHIRP3_HD: 3,
  NEURAL2: 3,
  GEMINI: 1,
};
const apiRequestTimestamps = new Map();

function createAbortError() {
  return new DOMException('Audio generation was cancelled.', 'AbortError');
}

function waitForSlot(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(createAbortError());
    }, { once: true });
  });
}

async function acquireRequestSlot(engine, signal) {
  const requestLimit = API_REQUESTS_PER_MINUTE[engine] || API_REQUESTS_PER_MINUTE.CHIRP3_HD;
  const timestamps = apiRequestTimestamps.get(engine) || [];
  apiRequestTimestamps.set(engine, timestamps);

  while (true) {
    if (signal?.aborted) throw createAbortError();
    const now = Date.now();
    while (timestamps.length > 0 && timestamps[0] < now - 60000) {
      timestamps.shift();
    }
    if (timestamps.length < requestLimit) {
      timestamps.push(now);
      return;
    }
    const waitTime = (timestamps[0] + 60000) - now;
    if (waitTime > 0) {
      await waitForSlot(waitTime + 100, signal);
    }
  }
}

// A chunk is large enough to cover roughly 20–45 seconds of narration. This
// lets the reader prepare audio while the current chunk is playing instead of
// making the listener wait after every sentence.
const ADVANCED_CHUNK_TARGET_CHARS = 450;
const ADVANCED_CHUNK_MAX_CHARS = 550;
const ADVANCED_PREFETCH_BY_ENGINE = { CHIRP3_HD: 2, NEURAL2: 2, GEMINI: 1 };
const advancedAudioRequests = new Map();
const advancedRequestControllers = new Set();

const SYSTEM_VOICE_VALUE = 'system';
const SAVED_VOICE_KEY = 'axiom-reader-voice';
const SAVED_RATE_KEY = 'axiom-reader-rate';
const TTS_TEST_TEXT = 'AXIOM Reader voice check complete.';

function saveCurrentReadPosition() {
  if (typeof saveReadPosition === 'function') saveReadPosition();
}

function saveRateSetting(value) {
  localStorage.setItem(SAVED_RATE_KEY, value);
}

function restoreTTSSettings() {
  const slider = document.getElementById('rate-slider');
  const label = document.getElementById('rate-val');
  const savedRate = parseFloat(localStorage.getItem(SAVED_RATE_KEY));
  if (slider && Number.isFinite(savedRate)) {
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    const clamped = Math.max(min, Math.min(max, savedRate));
    slider.value = clamped.toFixed(1);
    if (label) label.textContent = clamped.toFixed(1) + '\xD7';
  }

  const pitchSlider = document.getElementById('pitch-slider');
  const pitchLabel = document.getElementById('pitch-val');
  const savedPitch = parseFloat(localStorage.getItem('axiom-reader-pitch'));
  if (pitchSlider && Number.isFinite(savedPitch)) {
    const min = parseFloat(pitchSlider.min);
    const max = parseFloat(pitchSlider.max);
    const clamped = Math.max(min, Math.min(max, savedPitch));
    pitchSlider.value = clamped.toFixed(1);
    if (pitchLabel) pitchLabel.textContent = clamped.toFixed(1) + '\xD7';
  }
}

function voiceKey(voice) {
  return [voice.voiceURI, voice.lang, voice.name].filter(Boolean).join('|');
}

function isEnglishVoice(voice) {
  return /^en([-_]|$)/i.test(voice.lang || '');
}

function voiceLabel(voice) {
  const parts = [voice.name || 'Unnamed voice'];
  if (voice.lang) parts.push(voice.lang);
  if (voice.default) parts.push('default');
  if (voice.localService) parts.push('device');
  return parts.join(' - ');
}

// Determines the currently active engine type based on user selection in dropdown and mode settings
function getSelectedVoiceEngine() {
  const mode = localStorage.getItem('axiom-tts-mode') || 'offline';
  if (mode !== 'proxy') return 'LEGACY';
  
  const sel = document.getElementById('voice-sel');
  if (!sel) return 'LEGACY';
  const val = sel.value;
  if (val.startsWith('gemini-')) return 'GEMINI';
  if (/^en-(US|GB)-Neural2-/.test(val)) return 'NEURAL2';
  if (val.startsWith('en-US-Chirp3-HD-') || val.startsWith('en-GB-Chirp3-HD-')) return 'CHIRP3_HD';
  return 'LEGACY';
}

function getSelectedVoice() {
  const sel = document.getElementById('voice-sel');
  if (!sel || sel.value === SYSTEM_VOICE_VALUE) return null;
  
  const engine = getSelectedVoiceEngine();
  if (engine !== 'LEGACY') return null; // Web Audio API uses code ids
  
  return voices.find(v => voiceKey(v) === sel.value) || null;
}

function useSystemVoice(save = true) {
  const sel = document.getElementById('voice-sel');
  if (sel) sel.value = SYSTEM_VOICE_VALUE;
  if (save) localStorage.setItem(SAVED_VOICE_KEY, SYSTEM_VOICE_VALUE);
}

// Populates the dropdown menu with structured, grouped options for advanced and legacy voices
function loadVoices() {
  const all = synth.getVoices();
  const sel = document.getElementById('voice-sel');
  if (!sel) return;

  const unique = [];
  const seen = new Set();
  all.forEach(v => {
    const key = voiceKey(v);
    if (!key || seen.has(key)) return;
    seen.add(key);
    unique.push(v);
  });
  voices = unique.filter(isEnglishVoice);

  const saved = localStorage.getItem(SAVED_VOICE_KEY);
  const current = sel.value && sel.value !== SYSTEM_VOICE_VALUE ? sel.value : '';
  const prev = current || saved || SYSTEM_VOICE_VALUE;

  sel.innerHTML = '';

  // 1. System default option
  const systemOption = document.createElement('option');
  systemOption.value = SYSTEM_VOICE_VALUE;
  systemOption.textContent = 'Phone default voice';
  sel.appendChild(systemOption);

  const mode = localStorage.getItem('axiom-tts-mode') || 'offline';
  
  if (mode === 'proxy') {
    // 2. Google Neural2 voices with sentence timing marks
    const neural2Group = document.createElement('optgroup');
    neural2Group.label = 'Google Neural2 (Timed Highlighting)';
    ADVANCED_NEURAL2_VOICES.forEach(nv => {
      const option = document.createElement('option');
      option.value = advancedVoiceValue(nv);
      option.textContent = nv.name;
      neural2Group.appendChild(option);
    });
    sel.appendChild(neural2Group);

    // 3. Gemini 3.1 Flash TTS (stream-capable provider model)
    const geminiGroup = document.createElement('optgroup');
    geminiGroup.label = 'Gemini 3.1 Flash TTS (AI Synthesis)';
    ADVANCED_GEMINI_VOICES.forEach(gv => {
      const option = document.createElement('option');
      option.value = gv.id;
      option.textContent = `${gv.name} (Requires Proxy)`;
      geminiGroup.appendChild(option);
    });
    sel.appendChild(geminiGroup);

    // 4. Chirp 3 HD Voices (Google Cloud High-Def)
    const chirpGroup = document.createElement('optgroup');
    chirpGroup.label = 'Chirp 3 HD Voices (Google Cloud)';
    ADVANCED_CHIRP_VOICES.forEach(cv => {
      const option = document.createElement('option');
      option.value = cv.id;
      option.textContent = cv.name;
      chirpGroup.appendChild(option);
    });
    sel.appendChild(chirpGroup);
  }

  // 5. Local Device Voices (Legacy fallback)
  if (voices.length > 0) {
    const nativeGroup = document.createElement('optgroup');
    nativeGroup.label = 'Local Device Voices (Legacy)';
    voices.forEach(v => {
      const option = document.createElement('option');
      option.value = voiceKey(v);
      option.textContent = voiceLabel(v);
      nativeGroup.appendChild(option);
    });
    sel.appendChild(nativeGroup);
  }

  // Restore selection if matching key is found
  if ([...sel.options].some(o => o.value === prev)) {
    sel.value = prev;
    return;
  }

  useSystemVoice(!!saved);
}

function primeVoices() {
  if (!synth) return;
  loadVoices();
  [250, 750, 1500, 3000].forEach(delay => setTimeout(loadVoices, delay));
}

if (typeof synth !== 'undefined') {
  synth.addEventListener('voiceschanged', loadVoices);
  primeVoices();
}

function clearSpeechTimer() {
  if (speechTimer) {
    clearTimeout(speechTimer);
    speechTimer = null;
  }
}

// Scheduled triggers to play sentences sequentially
function scheduleSpeech(sentenceIdx, token, delay = 0, attempt = 0, forceSystemVoice = false) {
  clearSpeechTimer();
  if (delay <= 0) {
    speakOne(sentenceIdx, token, attempt, forceSystemVoice);
    return;
  }
  speechTimer = setTimeout(() => {
    speechTimer = null;
    speakOne(sentenceIdx, token, attempt, forceSystemVoice);
  }, delay);
}

// Master player router: decides whether to feed sentence to legacy or advanced engines
function speakOne(sentenceIdx, token, attempt = 0, forceSystemVoice = false) {
  if (!playing || token !== queueToken) return;
  if (sentenceIdx >= ttsList.length) { stopTTS(); return; }
  const item = ttsList[sentenceIdx];
  if (!item) { stopTTS(); return; }

  const engine = getSelectedVoiceEngine();
  
  if (engine === 'LEGACY') {
    try {
      currentUtterance = buildUtterance(item, sentenceIdx, token, attempt, forceSystemVoice);
      synth.speak(currentUtterance);
    } catch (_) {
      currentUtterance = null;
      stopTTS();
    }
  } else {
    speakAdvanced(createAdvancedChunk(sentenceIdx), token);
  }
}

function createAdvancedChunk(startIdx, list = ttsList) {
  const start = Math.max(0, Math.min(list.length - 1, startIdx));
  const items = [];
  const segmentIndexes = [];
  let characterCount = 0;
  let endIdx = start;

  for (let currentIdx = start; currentIdx < list.length; currentIdx += 1) {
    const item = list[currentIdx];
    const text = (item?.speechText || item?.text || '').trim();
    if (!text) continue;

    const nextLength = characterCount + (items.length ? 1 : 0) + text.length;
    if (items.length && nextLength > ADVANCED_CHUNK_MAX_CHARS) break;

    items.push(text);
    segmentIndexes.push(currentIdx);
    characterCount = nextLength;
    endIdx = currentIdx;

    if (characterCount >= ADVANCED_CHUNK_TARGET_CHARS) break;
  }

  return {
    startIdx: start,
    endIdx,
    blockIdx: list[start]?.blockIdx,
    speechText: items.join(' '),
    segments: items,
    segmentIndexes,
  };
}

function createAdvancedChunks(list = ttsList) {
  const chunks = [];
  let nextIdx = 0;
  while (nextIdx < list.length) {
    const chunk = createAdvancedChunk(nextIdx, list);
    chunks.push(chunk);
    nextIdx = chunk.endIdx + 1;
  }
  return chunks;
}

function getAdvancedCacheKey({ engine, voiceId, voiceStyle = '', speed, text, segments = [] }) {
  // Gemini playback speed is applied in the browser, so it must not create a
  // second paid generation of identical audio.
  const synthesisSpeed = engine === 'GEMINI' ? 'native' : speed;
  // Neural2 timing marks depend on sentence boundaries, even when the joined
  // spoken text happens to be identical.
  const timingShape = engine === 'NEURAL2' ? segments.join('\u241e') : text;
  return `tts:v4:${engine}:${voiceId}:${voiceStyle || 'default'}:${synthesisSpeed}:${timingShape}`;
}

function normalizeAdvancedAudioRecord(value) {
  if (typeof value === 'string' && value) return { data: value, timings: [] };
  if (!value || typeof value.data !== 'string' || !value.data) return null;
  return {
    data: value.data,
    timings: Array.isArray(value.timings) ? value.timings : [],
  };
}

function cancelAdvancedAudioRequests() {
  advancedRequestControllers.forEach(controller => controller.abort());
  advancedRequestControllers.clear();
  advancedAudioRequests.clear();
}

async function requestAdvancedAudio(chunk) {
  const voiceSel = document.getElementById('voice-sel');
  const selectedVoice = parseAdvancedVoiceSelection(voiceSel ? voiceSel.value : 'en-US-Chirp3-HD-Charon');
  const voiceId = selectedVoice.voiceId;
  const voiceStyle = selectedVoice.style;
  const speed = parseFloat(document.getElementById('rate-slider').value) || 1.0;
  const engine = getSelectedVoiceEngine();
  const text = chunk.speechText.trim();
  const segments = Array.isArray(chunk.segments) ? chunk.segments : [text];
  const cacheKey = getAdvancedCacheKey({ engine, voiceId, voiceStyle, speed, text, segments });

  const cachedAudio = await getCachedAudio(cacheKey);
  const cachedRecord = normalizeAdvancedAudioRecord(cachedAudio);
  if (cachedRecord) return cachedRecord;

  const existingRequest = advancedAudioRequests.get(cacheKey);
  if (existingRequest) return existingRequest;

  const controller = new AbortController();
  advancedRequestControllers.add(controller);

  const request = (async () => {
    await acquireRequestSlot(engine, controller.signal);

    const proxyUrl = getProxyUrl();
    if (!proxyUrl) {
      throw new Error('Proxy server URL is not configured. Open TTS Engine Settings to set it up.');
    }

    const headers = { 'Content-Type': 'application/json' };
    const githubToken = localStorage.getItem('axiom-github-token');
    if (githubToken) headers.Authorization = `Bearer ${githubToken}`;

    const response = await fetch(`${proxyUrl}/api/tts`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        text,
        voice: voiceId,
        style: voiceStyle,
        speed,
        engine,
        ...(engine === 'NEURAL2' ? { segments } : {})
      })
    });

    if (!response.ok) {
      const errorText = await response.json().catch(() => ({}));
      const retryAfter = response.headers.get('Retry-After');
      const retryHint = retryAfter ? ` Try again in about ${retryAfter} seconds.` : '';
      throw new Error((errorText.error || `Proxy response failure: ${response.status}`) + retryHint);
    }

    const responseJson = await response.json();
    const audioRecord = normalizeAdvancedAudioRecord(responseJson);
    if (!audioRecord) throw new Error('No audio data returned by the voice service.');

    await setCachedAudio(cacheKey, audioRecord);
    return audioRecord;
  })();

  advancedAudioRequests.set(cacheKey, request);
  const cleanup = () => {
    advancedRequestControllers.delete(controller);
    if (advancedAudioRequests.get(cacheKey) === request) advancedAudioRequests.delete(cacheKey);
  };
  request.then(cleanup, cleanup);
  return request;
}

async function prefetchAdvancedAudio(startIdx, token, engine) {
  const lookAhead = ADVANCED_PREFETCH_BY_ENGINE[engine] || 0;
  let nextIdx = startIdx;

  for (let count = 0; count < lookAhead && nextIdx < ttsList.length; count += 1) {
    if (!playing || token !== queueToken) return;
    const chunk = createAdvancedChunk(nextIdx);
    try {
      await requestAdvancedAudio(chunk);
    } catch (err) {
      if (err?.name !== 'AbortError') console.warn('Audio prefetch skipped:', err.message || err);
      return;
    }
    nextIdx = chunk.endIdx + 1;
  }
}

function cancelAdvancedTimedFollowing(source = null) {
  if (source && advancedFollowSource !== source) return;
  if (advancedFollowTimerId !== null) {
    clearTimeout(advancedFollowTimerId);
    advancedFollowTimerId = null;
  }
  advancedFollowSource = null;
}

function getValidAdvancedTimeline(timings, chunk, audioDuration) {
  if (!Array.isArray(timings) || !Array.isArray(chunk.segmentIndexes)) return [];
  const timeline = [];
  let lastTime = -1;
  timings.forEach(timing => {
    const segmentIndex = Number(timing?.segmentIndex);
    const timeSeconds = Number(timing?.timeSeconds);
    const sentenceIdx = chunk.segmentIndexes[segmentIndex];
    if (!Number.isInteger(segmentIndex) || sentenceIdx === undefined) return;
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0 || timeSeconds < lastTime) return;
    if (Number.isFinite(audioDuration) && timeSeconds > audioDuration + 0.25) return;
    timeline.push({ sentenceIdx, timeSeconds });
    lastTime = timeSeconds;
  });
  return timeline;
}

function startAdvancedTimedFollowing(sourceNode, chunk, timings, token, audioDuration) {
  cancelAdvancedTimedFollowing();
  const timeline = getValidAdvancedTimeline(timings, chunk, audioDuration);
  if (timeline.length < 1 || !audioCtx) return false;

  advancedFollowSource = sourceNode;
  const startedAt = audioCtx.currentTime;
  let nextTiming = 0;

  const followFrame = () => {
    if (!playing || token !== queueToken || currentAudioSource !== sourceNode || advancedFollowSource !== sourceNode) {
      cancelAdvancedTimedFollowing(sourceNode);
      return;
    }
    const elapsedAudioSeconds = Math.max(0, audioCtx.currentTime - startedAt) * sourceNode.playbackRate.value;
    while (nextTiming < timeline.length && timeline[nextTiming].timeSeconds <= elapsedAudioSeconds + 0.03) {
      const sentenceIdx = timeline[nextTiming].sentenceIdx;
      idx = sentenceIdx;
      highlightSpeechSentence(sentenceIdx);
      updatePos();
      nextTiming += 1;
    }
    // Track the audio clock directly. A short timer keeps following reliable
    // when a browser pauses visual animation frames in an embedded reader.
    advancedFollowTimerId = setTimeout(followFrame, 50);
  };

  followFrame();
  return true;
}


// --- SECTION 6: ADVANCED WEB AUDIO SYNTHESIS & DECODING ---
async function speakAdvanced(chunk, token) {
  ensureAudioCtx();

  if (!playing || token !== queueToken) return;

  const item = ttsList[chunk.startIdx];
  if (!item || !chunk.speechText) return;
  const speed = parseFloat(document.getElementById('rate-slider').value) || 1;

  // Highlight active visual segment inside the doc viewer
  idx = chunk.startIdx;
  highlightSpeechSentence(chunk.startIdx);
  updatePos();
  updateMediaSession('playing');
  const engine = getSelectedVoiceEngine();

  const playBtn = document.getElementById('play-btn');
  if (playBtn) playBtn.classList.add('generating-audio');
  showLoadingBar();
  updateLoadingBar(20);

  let audioRecord;
  try {
    audioRecord = normalizeAdvancedAudioRecord(await requestAdvancedAudio(chunk));
    if (!audioRecord) throw new Error('No playable audio returned by the voice service.');
  } catch (err) {
    if (err?.name === 'AbortError') return;
    if (!playing || token !== queueToken) return;
    console.error('Advanced fetch failed:', err);
    const notice = document.createElement('div');
    notice.className = 'tts-error-toast';
    notice.textContent = `Vocal synthesis proxy failed: ${err.message}. Reverting to standard local device.`;
    document.body.appendChild(notice);
    setTimeout(() => notice.remove(), 4000);
    try {
      currentUtterance = buildUtterance(item, chunk.startIdx, token, 0, true);
      synth.speak(currentUtterance);
    } catch (_) {
      stopTTS();
    }
    return;
  } finally {
    if (token === queueToken) {
      if (playBtn) playBtn.classList.remove('generating-audio');
      hideLoadingBar();
    }
  }

  if (!playing || token !== queueToken) return;

  try {
    updateLoadingBar(90); // Phase: Decoding audio data
    // Decode base64 to 16-bit PCM bytes
    const rawBinary = atob(audioRecord.data);
    const byteLength = rawBinary.length;
    const arrayBytes = new Uint8Array(byteLength);
    for (let i = 0; i < byteLength; i++) {
      arrayBytes[i] = rawBinary.charCodeAt(i);
    }

    const pcm16 = new Int16Array(arrayBytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768.0; // scale from 16-bit integers to float values (-1.0 to 1.0)
    }

    // Load float buffer into AudioContext source
    const buffer = audioCtx.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(float32, 0);

    const sourceNode = audioCtx.createBufferSource();
    sourceNode.buffer = buffer;

    // Apply speed adjustment.
    // Google Cloud voices apply speed during generation. Gemini applies it in
    // the browser because that service does not accept a speaking rate.
    sourceNode.playbackRate.value = engine === 'GEMINI' ? speed : 1.0;

    const gainNode = audioCtx.createGain();
    gainNode.gain.value = 2.0;

    // Audio compressor configuration for crisp voice volume leveling
    const compressorNode = audioCtx.createDynamicsCompressor();
    compressorNode.threshold.value = -16;
    compressorNode.knee.value = 12;
    compressorNode.ratio.value = 4;
    compressorNode.attack.value = 0.005;
    compressorNode.release.value = 0.1;

    // Connect analyzer to feed dynamic spectrum bars
    const analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 64;

    sourceNode.connect(gainNode);
    gainNode.connect(compressorNode);
    compressorNode.connect(analyserNode);
    analyserNode.connect(audioCtx.destination);

    currentAudioSource = sourceNode;
    audioAnalyser = analyserNode;
    isAudioContextSpeaking = true;

    sourceNode.onended = () => {
      cancelAdvancedTimedFollowing(sourceNode);
      if (currentAudioSource === sourceNode) {
        currentAudioSource = null;
        isAudioContextSpeaking = false;
        audioAnalyser = null;
      }
      
      if (!playing || token !== queueToken) return;
      saveCurrentReadPosition();

      if (chunk.endIdx >= ttsList.length - 1) {
        stopTTS();
        return;
      }

      idx = chunk.endIdx + 1;
      scheduleSpeech(idx, token, 70);
    };

    hideLoadingBar(); // Audio playing — hide progress bar
    sourceNode.start(0);
    startAdvancedTimedFollowing(sourceNode, chunk, audioRecord.timings, token, buffer.duration);
    void prefetchAdvancedAudio(chunk.endIdx + 1, token, engine);

  } catch (err) {
    console.error("Audio buffer setup failed:", err);
    stopTTS();
  }
}

// Build standard utterance wrapper for legacy synthesis fallback
function buildUtterance(item, sentenceIdx, token, attempt = 0, forceSystemVoice = false) {
  const utt = new SpeechSynthesisUtterance(item.speechText || item.text);
  const selectedVoice = forceSystemVoice ? null : getSelectedVoice();
  const rate = parseFloat(document.getElementById('rate-slider').value);
  const pitchSlider = document.getElementById('pitch-slider');
  const pitch = pitchSlider ? parseFloat(pitchSlider.value) : 1.0;
  let started = false;

  utt.rate = Number.isFinite(rate) ? rate : 0.95;
  utt.pitch = Number.isFinite(pitch) ? pitch : 1.0;
  utt.volume = 1;
  utt.onboundary = (event) => {
    if (event.name === 'word') {
      visualizerSpike = 1.0; // Trigger spike on visualizer for word changes
    }
  };
  if (selectedVoice) {
    utt.voice = selectedVoice;
    utt.lang = selectedVoice.lang;
  }

  utt.onstart = () => {
    if (!playing || token !== queueToken) return;
    started = true;
    idx = sentenceIdx;
    highlightSpeechSentence(sentenceIdx);
    updatePos();
    updateMediaSession('playing');
  };

  utt.onend = () => {
    if (!playing || token !== queueToken) return;
    currentUtterance = null;
    if (!started && attempt < 1) {
      scheduleSpeech(sentenceIdx, token, 150, attempt + 1, !!selectedVoice);
      return;
    }
    saveCurrentReadPosition();
    if (sentenceIdx >= ttsList.length - 1) {
      stopTTS();
      return;
    }
    idx = sentenceIdx + 1;
    scheduleSpeech(idx, token, 70);
  };

  utt.onerror = e => {
    if (!playing || token !== queueToken) return;
    if (e.error === 'interrupted' || e.error === 'canceled') return;
    currentUtterance = null;
    if (attempt < 1) {
      scheduleSpeech(sentenceIdx, token, 150, attempt + 1, !!selectedVoice);
      return;
    }
    saveCurrentReadPosition();
    if (sentenceIdx >= ttsList.length - 1) {
      stopTTS();
      return;
    }
    idx = sentenceIdx + 1;
    scheduleSpeech(idx, token, 70);
  };

  return utt;
}

function queueSpeechFrom(startIdx) {
  if (!ttsList.length) { stopTTS(); return; }

  queueToken += 1;
  const token = queueToken;
  clearSpeechTimer();
  cancelAdvancedTimedFollowing();
  
  // Stop existing sound sources
  if (currentAudioSource) {
    try { currentAudioSource.stop(); } catch (_) {}
    currentAudioSource = null;
  }
  isAudioContextSpeaking = false;
  audioAnalyser = null;

  const needsCancel = synth.speaking || synth.pending || synth.paused;
  if (needsCancel) synth.cancel();
  currentUtterance = null;

  idx = Math.max(0, Math.min(ttsList.length - 1, startIdx));
  highlightBlock(ttsList[idx].blockIdx);
  updatePos();
  updateMediaSession('playing');

  scheduleSpeech(idx, token, needsCancel ? 120 : 0);
}

function speak(i) {
  if (i >= ttsList.length) { stopTTS(); return; }
  queueSpeechFrom(i);
}


// --- SECTION 7: DYNAMIC SPECTRUM ANIMATION ---
function updateVisualizerAnimation() {
  if (!playing) {
    visualizerAnimationId = null;
    return;
  }

  const viz = document.getElementById('visualizer');
  if (viz) {
    const bars = viz.querySelectorAll('.visualizer-bar');
    const time = Date.now() * 0.005;
    
    // Check if we are actively outputting voice bytes
    const isSpeaking = (synth.speaking && !synth.paused) || isAudioContextSpeaking;
    
    if (isAudioContextSpeaking && audioAnalyser) {
      // Connect visualizer bars to actual real-time audio volume
      const binCount = audioAnalyser.frequencyBinCount;
      const dataArray = new Uint8Array(binCount);
      audioAnalyser.getByteFrequencyData(dataArray);
      let totalVolume = 0;
      for (let i = 0; i < binCount; i++) totalVolume += dataArray[i];
      const averageVolume = totalVolume / binCount; // Range 0 to 255
      visualizerSpike = averageVolume / 85.0; // scale spike value
    } else {
      // Smooth decay for legacy word spikes
      visualizerSpike *= 0.92;
    }

    bars.forEach((bar, index) => {
      let height = 15;

      if (isSpeaking) {
        // Base sine wave fluctuation
        const wave1 = Math.sin(time * 1.5 + index * 0.6) * 15;
        const wave2 = Math.cos(time * 2.8 - index * 0.4) * 10;
        
        // Spike effect from actual audio volume or boundary marks
        const spike = visualizerSpike * (Math.sin(index * 0.9) + 1.2) * 35;
        
        // Dynamic noise jitter
        const noise = (Math.random() - 0.5) * 8;

        height = 30 + wave1 + wave2 + spike + noise;
        height = Math.max(10, Math.min(95, height));
      } else {
        // Resting baseline vibration when paused or quiet
        height = 12 + Math.sin(time * 3 + index) * 3 + (Math.random() - 0.5) * 2;
      }

      bar.style.height = `${height}%`;
    });
  }

  visualizerAnimationId = requestAnimationFrame(updateVisualizerAnimation);
}


// --- SECTION 8: MASTER PLAYER CONTROLS ---
function startTTS() {
  if (!ttsList.length) { updatePos(); return; }
  ensureAudioCtx();
  primeVoices();
  playing = true;
  setBtn('pause');
  startKeepAlive();
  requestWakeLock();
  updateMediaSession('playing');
  
  const viz = document.getElementById('visualizer');
  if (viz) viz.classList.add('animating');
  if (!visualizerAnimationId) {
    visualizerAnimationId = requestAnimationFrame(updateVisualizerAnimation);
  }
  
  speak(idx);
}

function stopTTS() {
  saveCurrentReadPosition();
  playing = false;
  queueToken += 1;
  cancelAdvancedAudioRequests();
  cancelAdvancedTimedFollowing();
  clearSpeechTimer();
  currentUtterance = null;
  setBtn('play');
  stopKeepAlive();
  releaseWakeLock();
  updateMediaSession('paused');
  
  const viz = document.getElementById('visualizer');
  if (viz) viz.classList.remove('animating');
  if (visualizerAnimationId) {
    cancelAnimationFrame(visualizerAnimationId);
    visualizerAnimationId = null;
  }
  
  // Reset visualizer bars to flat baseline heights
  if (viz) {
    viz.querySelectorAll('.visualizer-bar').forEach(bar => {
      bar.style.height = '15%';
    });
  }
  
  // Clean stop for advanced player
  hideLoadingBar();
  if (currentAudioSource) {
    try { currentAudioSource.stop(); } catch (_) {}
    currentAudioSource = null;
  }
  isAudioContextSpeaking = false;
  audioAnalyser = null;

  synth.cancel();
}

function toggleTTS() { if (playing) stopTTS(); else startTTS(); }

function setBtn(s) {
  const icon = s === 'play' ? 'play_arrow' : 'pause';
  // Update main play button
  const btn = document.getElementById('play-btn');
  if (btn) {
    btn.setAttribute('aria-label', s === 'play' ? 'Play' : 'Pause');
    btn.title = s === 'play' ? 'Play' : 'Pause';
    const btnIcon = btn.querySelector('.material-symbols-outlined');
    if (btnIcon) btnIcon.textContent = icon;
    else btn.textContent = s === 'play' ? '▶' : '⏸';
  }
  // Sync mini-player play button
  const miniBtn = document.getElementById('mini-play-btn');
  if (miniBtn) {
    miniBtn.setAttribute('aria-label', s === 'play' ? 'Play' : 'Pause');
    miniBtn.title = s === 'play' ? 'Play' : 'Pause';
    const miniIcon = miniBtn.querySelector('.material-symbols-outlined');
    if (miniIcon) miniIcon.textContent = icon;
  }
}

function resetTTSVoice() {
  const wasPlaying = playing;
  stopTTS();
  useSystemVoice(true);
  primeVoices();
  setTimeout(() => {
    synth.cancel();
    const test = new SpeechSynthesisUtterance(TTS_TEST_TEXT);
    synth.speak(test);
    if (wasPlaying) setTimeout(startTTS, 600);
  }, 100);
}

// Watchdog interval to recover speech if browser engine hangs (common Chromium issue)
setInterval(() => {
  if (!playing) return;
  
  const engine = getSelectedVoiceEngine();
  if (engine !== 'LEGACY') return; // Managed by AudioContext event callbacks
  
  if (synth.paused) { synth.resume(); return; }
  if (!synth.speaking && !synth.pending && !speechTimer && !currentUtterance) speak(idx);
}, 1200);

function jump(delta) {
  const was = playing;
  if (was) stopTTS();
  idx = Math.max(0, Math.min(ttsList.length - 1, idx + delta));
  if (was) startTTS(); else { highlightBlock(ttsList[idx]?.blockIdx); updatePos(); }
  saveCurrentReadPosition();
}

function isBlockVisible(el, container) {
  if (!el || !container) return false;
  const elRect = el.getBoundingClientRect();
  const conRect = container.getBoundingClientRect();
  return (elRect.top >= conRect.top + 10 && elRect.bottom <= conRect.bottom - 10);
}

function highlightBlock(blockIdx, scroll = true) {
  document.querySelectorAll('.reading-block').forEach(el => { el.classList.remove('reading-block'); el.removeAttribute('aria-current'); });
  if (window.CSS?.highlights) CSS.highlights.delete('spoken-passage');
  const el = document.querySelector(`[data-bid="${blockIdx}"]`);
  if (el) {
    el.classList.add('reading-block');
    el.setAttribute('aria-current', 'true');
    if (scroll) scrollReadingTarget(el, !playing);
  }
}

function updatePos() {
  const posText = ttsList.length ? `${idx + 1} / ${ttsList.length}` : '— / —';
  const posLabel = document.getElementById('pos-label');
  if (posLabel) posLabel.textContent = posText;
  // Sync mini-player position label
  const miniPos = document.getElementById('mini-pos-label');
  if (miniPos) miniPos.textContent = posText;
}


// --- SECTION 9: OFFLINE AUDIO BATCH DOWNLOAD COMPILER ---
async function downloadAudioBatch(list, title = "Axiom_Audio_Book") {
  if (list.length === 0) return;

  const downloadBtn = document.getElementById('download-wav-btn');
  const originalLabel = downloadBtn ? downloadBtn.textContent : 'COMPILE AUDIO BOOK';
  
  try {
    if (downloadBtn) {
      downloadBtn.disabled = true;
      downloadBtn.textContent = 'Preparing generation...';
    }

    const voiceSel = document.getElementById('voice-sel');
    const selectedVoice = parseAdvancedVoiceSelection(voiceSel ? voiceSel.value : 'en-US-Chirp3-HD-Charon');
    const voiceId = selectedVoice.voiceId;
    const voiceStyle = selectedVoice.style;
    const speed = parseFloat(document.getElementById('rate-slider').value) || 1.0;
    const engine = getSelectedVoiceEngine();
    if (engine === 'LEGACY') {
      throw new Error('Choose a Neural2, Chirp, or Gemini voice before compiling cloud audio.');
    }
    const batchSegments = createAdvancedChunks(list);

    const allBytes = [];
    let totalDataSize = 0;
    let succeededCount = 0;
    let failedCount = 0;

    // Helper to calculate silent duration byte lengths (24kHz Mono 16-bit PCM = 48000 bytes per second)
    const getSilenceBytes = (seconds) => {
      const byteLen = Math.floor(24000 * 1 * 2 * seconds);
      const alignedLen = byteLen + (byteLen % 2); // align to 16-bit sample boundaries
      return new Uint8Array(alignedLen);
    };

    // Sequentially process narration chunks so long exports use far fewer
    // provider requests than sentence-by-sentence generation.
    for (let sIdx = 0; sIdx < batchSegments.length; sIdx++) {
      const segment = batchSegments[sIdx];
      const progressPct = Math.round((sIdx / batchSegments.length) * 100);
      
      if (downloadBtn) {
        downloadBtn.textContent = `Compiling narration chunk ${sIdx + 1} of ${batchSegments.length} (${progressPct}%)`;
      }

      // Check if item text is a section divider or page break symbol
      if (segment.text === '═══' || segment.text === '───' || segment.text === '---') {
        const silence = getSilenceBytes(0.4);
        allBytes.push(silence);
        totalDataSize += silence.length;
        continue;
      }

      const cleanText = (segment.speechText || segment.text)
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')
        .replace(/^>\s*/gm, '');

      if (!cleanText.trim()) continue;

      const segments = Array.isArray(segment.segments) ? segment.segments : [cleanText];
      const cacheKey = getAdvancedCacheKey({ engine, voiceId, voiceStyle, speed, text: cleanText, segments });
      let base64Audio = "";

      // 1. Try to load from database cache
      try {
        const cachedRecord = normalizeAdvancedAudioRecord(await getCachedAudio(cacheKey));
        base64Audio = cachedRecord?.data || '';
      } catch (err) {
        console.error("IndexedDB fetch failed in downloader:", err);
      }

      // 2. Fetch live via network if cache missed
      if (!base64Audio) {
        try {
          await acquireRequestSlot(engine);

          const proxyUrl = getProxyUrl();
          if (!proxyUrl) {
            throw new Error("Proxy server URL is not configured.");
          }

          const headers = { 'Content-Type': 'application/json' };
          const githubToken = localStorage.getItem('axiom-github-token');
          if (githubToken) {
            headers['Authorization'] = `Bearer ${githubToken}`;
          }

          const response = await fetch(`${proxyUrl}/api/tts`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
              text: cleanText,
              voice: voiceId,
              style: voiceStyle,
              speed: speed,
              engine: engine,
              ...(engine === 'NEURAL2' ? { segments } : {})
            })
          });

          if (response.ok) {
            const json = await response.json();
            const audioRecord = normalizeAdvancedAudioRecord(json);
            if (audioRecord) {
              base64Audio = audioRecord.data;
              try {
                await setCachedAudio(cacheKey, audioRecord);
              } catch (e) {
                console.error("IndexedDB save failed in downloader:", e);
              }
            }
          }
        } catch (err) {
          console.error("Failed downloading block segment:", err);
        }
      }

      // 3. Compile audio bytes
      if (base64Audio) {
        succeededCount++;
        const rawBinary = atob(base64Audio);
        const len = rawBinary.length;
        const bytes = new Uint8Array(len);
        for (let j = 0; j < len; j++) {
          bytes[j] = rawBinary.charCodeAt(j);
        }
        allBytes.push(bytes);
        totalDataSize += len;

        // Append a minor voice phrasing pause (0.5 seconds) between blocks
        const phraseGap = getSilenceBytes(0.5);
        allBytes.push(phraseGap);
        totalDataSize += phraseGap.length;
      } else {
        failedCount++;
      }
    }

    if (succeededCount === 0) {
      throw new Error("No files were generated. Verify your internet connection or proxy settings.");
    }

    if (failedCount > 0) {
      alert(`⚠️ PARTIAL RECOVERY NOTIFICATION\n\nSome API requests failed. We successfully recovered ${succeededCount} voice lines out of local caches/responses, and compile-packaged them into your audio file.`);
    }

    // Configure standard WAV header constants
    const sampleRate = 24000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    
    // Allocate buffer size for 44-byte WAV header + raw PCM payload
    const wavBuffer = new ArrayBuffer(44 + totalDataSize);
    const dataView = new DataView(wavBuffer);
    
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        dataView.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    // Write standard RIFF WAV headers
    writeString(0, 'RIFF');
    dataView.setUint32(4, 36 + totalDataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    dataView.setUint32(16, 16, true);
    dataView.setUint16(20, 1, true); // PCM Format code
    dataView.setUint16(22, numChannels, true);
    dataView.setUint32(24, sampleRate, true);
    dataView.setUint32(28, byteRate, true);
    dataView.setUint16(32, blockAlign, true);
    dataView.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    dataView.setUint32(40, totalDataSize, true);
    
    // Join all audio fragments into data view buffer
    const wavPayloadArray = new Uint8Array(wavBuffer, 44);
    let offset = 0;
    for (const fragment of allBytes) {
      wavPayloadArray.set(fragment, offset);
      offset += fragment.length;
    }
    
    // Output blob URL download link
    const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
    const wavUrl = URL.createObjectURL(wavBlob);
    const downloadLink = document.createElement('a');
    downloadLink.href = wavUrl;
    
    const cleanTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    downloadLink.download = `${cleanTitle}_narration.wav`;
    downloadLink.click();
    
    return wavUrl;
  } catch (err) {
    console.error("Batch download compilation failed:", err);
    alert(err.message || "Unable to compile WAV audio book file.");
  } finally {
    if (downloadBtn) {
      downloadBtn.disabled = false;
      downloadBtn.textContent = originalLabel;
    }
  }
}


// --- SECTION 10: VOICE PREVIEW FUNCTION ---
// Plays a short test sentence using the currently selected voice engine.
// Gemini previews are blocked because this reader reserves Gemini requests for
// intentional narration rather than short disposable tests.
async function playAdvancedVoicePreview() {
  if (playing) stopTTS();
  ensureAudioCtx();
  const engine = getSelectedVoiceEngine();
  const chunk = {
    startIdx: 0,
    endIdx: 0,
    speechText: TTS_TEST_TEXT,
    segments: [TTS_TEST_TEXT],
    segmentIndexes: [0],
  };

  showLoadingBar();
  updateLoadingBar(20);
  try {
    const record = normalizeAdvancedAudioRecord(await requestAdvancedAudio(chunk));
    if (!record) throw new Error('No playable audio returned by the voice service.');
    const rawBinary = atob(record.data);
    const bytes = new Uint8Array(rawBinary.length);
    for (let i = 0; i < rawBinary.length; i += 1) bytes[i] = rawBinary.charCodeAt(i);
    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i += 1) float32[i] = pcm16[i] / 32768;
    const buffer = audioCtx.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(float32, 0);
    const sourceNode = audioCtx.createBufferSource();
    sourceNode.buffer = buffer;
    const speed = parseFloat(document.getElementById('rate-slider').value) || 1;
    sourceNode.playbackRate.value = engine === 'GEMINI' ? speed : 1;
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = 2;
    sourceNode.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    if (currentAudioSource) {
      try { currentAudioSource.stop(); } catch (_) {}
    }
    currentAudioSource = sourceNode;
    isAudioContextSpeaking = true;
    sourceNode.onended = () => {
      if (currentAudioSource === sourceNode) currentAudioSource = null;
      isAudioContextSpeaking = false;
    };
    sourceNode.start(0);
  } catch (err) {
    if (err?.name !== 'AbortError') alert(`Voice preview failed: ${err.message || err}`);
  } finally {
    hideLoadingBar();
  }
}

function previewTTSVoice() {
  console.log('[AXIOM Preview] previewTTSVoice called');
  const engine = getSelectedVoiceEngine();
  console.log('[AXIOM Preview] Current engine:', engine);

  // Block Gemini previews so quota is kept for actual narration.
  if (engine === 'GEMINI') {
    alert('Preview is disabled for Gemini voices.\n\nGemini generation is reserved for intentional narration. Use Chirp for quick voice checks, or use Gemini for a selected passage or export.');
    return;
  }

  ensureAudioCtx();
  primeVoices();

  if (engine === 'LEGACY') {
    // Use the browser's built-in speech to preview
    synth.cancel();
    const utt = new SpeechSynthesisUtterance(TTS_TEST_TEXT);
    const selectedVoice = getSelectedVoice();
    const rate = parseFloat(document.getElementById('rate-slider').value);
    const pitchSlider = document.getElementById('pitch-slider');
    const pitch = pitchSlider ? parseFloat(pitchSlider.value) : 1.0;
    utt.rate = Number.isFinite(rate) ? rate : 0.95;
    utt.pitch = Number.isFinite(pitch) ? pitch : 1.0;
    if (selectedVoice) {
      utt.voice = selectedVoice;
      utt.lang = selectedVoice.lang;
    }
    console.log('[AXIOM Preview] Speaking with legacy voice:', selectedVoice?.name || 'default');
    synth.speak(utt);
  } else {
    // Google cloud previews synthesize one short sentence through the existing proxy.
    console.log(`[AXIOM Preview] Requesting ${engine} preview from proxy`);
    void playAdvancedVoicePreview();
  }
}


// --- SECTION 11: SETTINGS DIALOG, GITHUB OAUTH & WIRING ---
document.addEventListener('DOMContentLoaded', () => {
  // Bind compiler batch download button if present in UI layout
  const downloadBtn = document.getElementById('download-wav-btn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', async () => {
      if (!ttsList || !ttsList.length) {
        alert("Please load a document archive before compiling audio.");
        return;
      }
      const titleElem = document.getElementById('file-name');
      const docTitle = titleElem ? titleElem.textContent : 'axiom_book';
      await downloadAudioBatch(ttsList, docTitle);
    });
  }

  // DOM Elements for the 3-column settings panel
  const settingsBtn = document.getElementById('tts-settings-btn');
  const settingsModal = document.getElementById('tts-settings-modal');
  const closeBtn = document.getElementById('tts-settings-close-btn');
  const cancelBtn = document.getElementById('tts-settings-cancel-btn');
  const saveBtn = document.getElementById('tts-settings-save-btn');
  const engineCardsContainer = document.getElementById('tts-engine-cards');
  const voiceCardsContainer = document.getElementById('tts-voice-cards');
  const proxyUrlInput = document.getElementById('tts-proxy-url');
  const githubUserStatus = document.getElementById('github-user-status');
  const githubLoginBtn = document.getElementById('github-login-btn');
  const proxySection = document.getElementById('tts-proxy-section');
  const githubSection = document.getElementById('tts-github-section');
  const quotaSection = document.getElementById('tts-quota-section');
  const quotaInfo = document.getElementById('tts-quota-info');

  // Track the currently selected engine and voice within the modal
  let pendingEngine = 'legacy';
  let pendingVoice = '';

  // --- RENDER ENGINE CARDS (Column 1) ---
  function renderEngineCards() {
    engineCardsContainer.innerHTML = '';
    TTS_ENGINES.forEach(eng => {
      const card = document.createElement('div');
      card.className = 'tts-engine-card' + (eng.id === pendingEngine ? ' active' : '');
      card.dataset.engineId = eng.id;
      card.innerHTML = `
        <div class="engine-dot"></div>
        <div class="engine-name">${eng.name}</div>
        <div class="engine-desc">${eng.desc}</div>
      `;
      card.addEventListener('click', () => {
        pendingEngine = eng.id;
        renderEngineCards();
        renderVoiceCards();
        updateConnectionVisibility();
      });
      engineCardsContainer.appendChild(card);
    });
  }

  // --- RENDER VOICE CARDS (Column 2) ---
  function renderVoiceCards() {
    voiceCardsContainer.innerHTML = '';
    let voiceList = [];

    if (pendingEngine === 'chirp') {
      voiceList = ADVANCED_CHIRP_VOICES;
    } else if (pendingEngine === 'neural2') {
      voiceList = ADVANCED_NEURAL2_VOICES;
    } else if (pendingEngine === 'gemini') {
      voiceList = ADVANCED_GEMINI_VOICES;
    } else {
      // Legacy: show browser voices + system default
      const sysCard = document.createElement('div');
      sysCard.className = 'tts-voice-card' + (pendingVoice === SYSTEM_VOICE_VALUE || !pendingVoice ? ' active' : '');
      sysCard.innerHTML = '<div class="voice-name">Phone default voice</div><div class="voice-desc">System built-in speech engine</div>';
      sysCard.addEventListener('click', () => { pendingVoice = SYSTEM_VOICE_VALUE; renderVoiceCards(); });
      voiceCardsContainer.appendChild(sysCard);

      voices.forEach(v => {
        const vk = voiceKey(v);
        const card = document.createElement('div');
        card.className = 'tts-voice-card' + (pendingVoice === vk ? ' active' : '');
        card.innerHTML = `<div class="voice-name">${v.name || 'Unnamed'}</div><div class="voice-desc">${v.lang || ''} ${v.localService ? '— device' : ''}</div>`;
        card.addEventListener('click', () => { pendingVoice = vk; renderVoiceCards(); });
        voiceCardsContainer.appendChild(card);
      });
      return;
    }

    // For Google cloud and Gemini engines
    voiceList.forEach(v => {
      const profileValue = advancedVoiceValue(v);
      const card = document.createElement('div');
      card.className = 'tts-voice-card' + (pendingVoice === profileValue ? ' active' : '');
      card.innerHTML = `<div class="voice-name">${v.name}</div><div class="voice-desc">${v.desc}</div>`;
      card.addEventListener('click', () => { pendingVoice = profileValue; renderVoiceCards(); });
      voiceCardsContainer.appendChild(card);
    });

    // Select first voice by default if none selected for this engine
    if (voiceList.length > 0 && !voiceList.some(v => advancedVoiceValue(v) === pendingVoice)) {
      pendingVoice = advancedVoiceValue(voiceList[0]);
      renderVoiceCards();
    }
  }

  // --- SHOW/HIDE CONNECTION CONTROLS (Column 3) ---
  function updateConnectionVisibility() {
    const needsProxy = (pendingEngine === 'chirp' || pendingEngine === 'neural2' || pendingEngine === 'gemini');
    proxySection.style.display = needsProxy ? 'block' : 'none';
    githubSection.style.display = needsProxy ? 'block' : 'none';

    // Show the reader's conservative live-generation policy. The Google project
    // remains the source of truth for its actual provider quota.
    if (pendingEngine === 'gemini') {
      quotaSection.style.display = 'block';
      quotaInfo.innerHTML = '<span class="tts-quota-badge">INTENTIONAL NARRATION MODE</span><br>Reader cap: 1 new chunk per minute<br>Preview is disabled to preserve your provider quota.';
    } else if (pendingEngine === 'chirp') {
      quotaSection.style.display = 'block';
      quotaInfo.innerHTML = 'Reader cap: 3 new chunks per minute<br>Upcoming chunks are prepared and cached locally to keep playback continuous.';
    } else if (pendingEngine === 'neural2') {
      quotaSection.style.display = 'block';
      quotaInfo.innerHTML = '<span class="tts-quota-badge">TIMED FOLLOWING</span><br>Reader cap: 3 new chunks per minute<br>Google sentence marks keep the highlight and scroll position aligned with the recording.';
    } else {
      quotaSection.style.display = 'none';
    }
  }

  // --- UPDATE GITHUB STATUS DISPLAY ---
  function updateGithubStatus() {
    const githubUsername = localStorage.getItem('axiom-github-username') || '';
    if (githubUsername) {
      githubUserStatus.textContent = `LOGGED IN AS: ${githubUsername.toUpperCase()}`;
      githubUserStatus.style.color = 'var(--primary)';
      githubLoginBtn.textContent = 'LOGOUT';
    } else {
      githubUserStatus.textContent = 'NOT LOGGED IN';
      githubUserStatus.style.color = 'var(--text-muted)';
      githubLoginBtn.textContent = 'LOGIN';
    }
  }

  // --- DETERMINE PENDING ENGINE FROM SAVED VOICE ---
  function resolveEngineFromVoice(voiceId) {
    if (!voiceId || voiceId === SYSTEM_VOICE_VALUE) return 'legacy';
    if (voiceId.startsWith('gemini-')) return 'gemini';
    if (/^en-(US|GB)-Neural2-/.test(voiceId)) return 'neural2';
    if (voiceId.startsWith('en-US-Chirp3-HD-') || voiceId.startsWith('en-GB-Chirp3-HD-')) return 'chirp';
    return 'legacy';
  }

  // --- LOAD SAVED CONFIG INTO MODAL ---
  function loadSavedConfig() {
    const savedMode = localStorage.getItem('axiom-tts-mode') || 'offline';
    const savedVoice = localStorage.getItem(SAVED_VOICE_KEY) || SYSTEM_VOICE_VALUE;
    const savedProxyUrl = cleanProxyUrl(localStorage.getItem('axiom-tts-proxy-url') || '') || DEFAULT_PROXY_URL;

    // Determine engine from saved mode and voice
    if (savedMode === 'proxy') {
      pendingEngine = resolveEngineFromVoice(savedVoice);
      // If mode is proxy but voice is a legacy voice, default to chirp engine
      if (pendingEngine === 'legacy') pendingEngine = 'chirp';
    } else {
      pendingEngine = 'legacy';
    }
    pendingVoice = savedVoice;
    proxyUrlInput.value = savedProxyUrl;

    renderEngineCards();
    renderVoiceCards();
    updateConnectionVisibility();
    updateGithubStatus();
  }

  // --- OPEN SETTINGS MODAL ---
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      loadSavedConfig();
      settingsModal.classList.add('open');
      settingsModal.setAttribute('aria-hidden', 'false');
    });
  }

  // --- CLOSE SETTINGS MODAL ---
  const closeModal = () => {
    settingsModal.classList.remove('open');
    settingsModal.setAttribute('aria-hidden', 'true');
  };

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  // --- SAVE SETTINGS ---
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      // Determine mode from engine selection
      const newMode = (pendingEngine === 'legacy') ? 'offline' : 'proxy';

      localStorage.setItem('axiom-tts-mode', newMode);
      localStorage.setItem('axiom-tts-proxy-url', cleanProxyUrl(proxyUrlInput.value));
      localStorage.setItem(SAVED_VOICE_KEY, pendingVoice || SYSTEM_VOICE_VALUE);

      // Warn if proxy mode selected but not logged in
      if (newMode === 'proxy' && !localStorage.getItem('axiom-github-token')) {
        alert('Enhanced voice engine saved. Note: You must log in with GitHub before you can generate voices.');
      }

      // Refresh the sidebar voice dropdown
      loadVoices();

      // Set the dropdown to the voice chosen in the modal
      const sel = document.getElementById('voice-sel');
      if (sel && pendingVoice) {
        if ([...sel.options].some(o => o.value === pendingVoice)) {
          sel.value = pendingVoice;
        }
      }

      closeModal();
    });
  }

  // Helper: build a consistent, canonical redirect URI every time
  // This must exactly match what is registered in your GitHub OAuth App settings
  function getCanonicalRedirectUri() {
    let uri = window.location.origin + window.location.pathname;
    if (!uri.endsWith('/') && !uri.endsWith('.html')) {
      uri += '/';
    }
    return uri;
  }

  // --- GITHUB OAUTH LOGIN/LOGOUT ---
  if (githubLoginBtn) {
    githubLoginBtn.addEventListener('click', () => {
      const token = localStorage.getItem('axiom-github-token');

      if (token) {
        // Log out
        localStorage.removeItem('axiom-github-token');
        localStorage.removeItem('axiom-github-username');
        updateGithubStatus();
        loadVoices();
        alert('Logged out successfully.');
      } else {
        // Log in — save current state first
        const proxyUrl = cleanProxyUrl(proxyUrlInput.value);
        if (!proxyUrl) {
          alert('Please enter a Proxy Server URL first!');
          return;
        }

        const newMode = (pendingEngine === 'legacy') ? 'offline' : 'proxy';
        localStorage.setItem('axiom-tts-mode', newMode);
        localStorage.setItem('axiom-tts-proxy-url', proxyUrl);

        const redirectUri = getCanonicalRedirectUri();
        const authUrl = `${proxyUrl}/api/auth/login?redirect_uri=${encodeURIComponent(redirectUri)}`;
        console.log('[AXIOM Auth] Redirecting to GitHub login via:', authUrl);
        window.location.href = authUrl;
      }
    });
  }

  // --- CAPTURE GITHUB OAUTH CALLBACK CODE ---
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  if (code) {
    const cleanUrl = getCanonicalRedirectUri();
    window.history.replaceState({}, document.title, cleanUrl);

    const proxyUrl = getProxyUrl();
    if (!proxyUrl) {
      console.error('[AXIOM Auth] OAuth code received but proxy URL is not saved.');
      alert('Login failed: Proxy Server URL was lost. Please open TTS Engine Settings, enter your proxy URL, and try again.');
      return;
    }

    console.log('[AXIOM Auth] Exchanging OAuth code with proxy at:', proxyUrl);

    const loadingToast = document.createElement('div');
    loadingToast.className = 'tts-error-toast';
    loadingToast.style.background = 'var(--surface-highest)';
    loadingToast.style.borderColor = 'var(--primary)';
    loadingToast.textContent = 'Verifying GitHub login...';
    document.body.appendChild(loadingToast);

    fetch(`${proxyUrl}/api/auth/github`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, redirect_uri: cleanUrl })
    })
    .then(res => {
      console.log('[AXIOM Auth] Proxy response status:', res.status);
      if (!res.ok) {
        return res.json()
          .catch(() => ({ error: `Server returned status ${res.status}` }))
          .then(data => { throw new Error(data.error || 'Failed to exchange login code'); });
      }
      return res.json();
    })
    .then(data => {
      localStorage.setItem('axiom-github-token', data.token);
      localStorage.setItem('axiom-github-username', data.username);
      localStorage.setItem('axiom-tts-mode', 'proxy');
      // Save the proxy URL from the server response (ensures cross-device persistence)
      if (data.proxyUrl) {
        localStorage.setItem('axiom-tts-proxy-url', cleanProxyUrl(data.proxyUrl));
      }

      loadingToast.remove();
      loadVoices();
      console.log('[AXIOM Auth] Login successful as:', data.username);

      // Open settings panel to show the success
      if (settingsBtn) settingsBtn.click();

      const successToast = document.createElement('div');
      successToast.className = 'tts-error-toast';
      successToast.style.background = 'var(--surface-highest)';
      successToast.style.borderColor = 'var(--primary)';
      successToast.textContent = `Login successful! Connected as ${data.username.toUpperCase()}`;
      document.body.appendChild(successToast);
      setTimeout(() => successToast.remove(), 4000);
    })
    .catch(err => {
      loadingToast.remove();
      console.error('[AXIOM Auth] OAuth token exchange error:', err);
      alert(`GitHub authentication failed: ${err.message}\n\nTroubleshooting tips:\n• Make sure your Proxy Server URL is correct\n• Check that the proxy is deployed on Vercel\n• Try logging out and logging in again`);
    });
  }

  // Restore initial voices listing
  loadVoices();
});
