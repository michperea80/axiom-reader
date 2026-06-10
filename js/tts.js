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


// --- SECTION 3: DATABASE CACHING (INDEXEDDB) ---
const DB_NAME = 'axiom-tts-cache-db';
const STORE_NAME = 'audio-cache';

// Simple, zero-dependency utility to read audio out of IndexedDB local storage
function getCachedAudio(key) {
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (e) => {
      const db = e.target.result;
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
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
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (e) => {
      const db = e.target.result;
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const putRequest = store.put(base64Value, key);
      putRequest.onsuccess = () => resolve(true);
      putRequest.onerror = () => resolve(false);
    };
    request.onerror = () => resolve(false);
  });
}


// --- SECTION 4: ADVANCED VOICES DEFINITIONS ---
const ADVANCED_CHIRP_VOICES = [
  { id: 'en-US-Chirp3-HD-Charon', name: 'Charon (US) — Male' },
  { id: 'en-US-Chirp3-HD-Fenrir', name: 'Fenrir (US) — Male' },
  { id: 'en-US-Chirp3-HD-Enceladus', name: 'Enceladus (US) — Male' },
  { id: 'en-US-Chirp3-HD-Aoede', name: 'Aoede (US) — Female' },
  { id: 'en-US-Chirp3-HD-Kore', name: 'Kore (US) — Female' },
  { id: 'en-US-Chirp3-HD-Leda', name: 'Leda (US) — Female' },
  { id: 'en-GB-Chirp3-HD-Charon', name: 'Charon (UK) — Male' },
  { id: 'en-GB-Chirp3-HD-Fenrir', name: 'Fenrir (UK) — Male' },
  { id: 'en-GB-Chirp3-HD-Enceladus', name: 'Enceladus (UK) — Male' },
  { id: 'en-GB-Chirp3-HD-Aoede', name: 'Aoede (UK) — Female' },
  { id: 'en-GB-Chirp3-HD-Kore', name: 'Kore (UK) — Female' },
  { id: 'en-GB-Chirp3-HD-Leda', name: 'Leda (UK) — Female' }
];

const ADVANCED_GEMINI_VOICES = [
  { id: 'gemini-Puck', name: 'Puck (Gemini)' },
  { id: 'gemini-Charon', name: 'Charon (Gemini)' },
  { id: 'gemini-Kore', name: 'Kore (Gemini)' },
  { id: 'gemini-Fenrir', name: 'Fenrir (Gemini)' },
  { id: 'gemini-Aoede', name: 'Aoede (Gemini)' },
  { id: 'gemini-Leda', name: 'Leda (Gemini)' }
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

// Rate Limiting: max 3 live generation calls per minute to stay safe from limits
const apiRequestTimestamps = [];
async function acquireRequestSlot() {
  while (true) {
    const now = Date.now();
    while (apiRequestTimestamps.length > 0 && apiRequestTimestamps[0] < now - 60000) {
      apiRequestTimestamps.shift();
    }
    if (apiRequestTimestamps.length < 3) {
      apiRequestTimestamps.push(now);
      return;
    }
    const waitTime = (apiRequestTimestamps[0] + 60000) - now;
    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTime + 100));
    }
  }
}

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
    // 2. Gemini 3.1 Pro Audio (Bespoke AI Synthesis)
    const geminiGroup = document.createElement('optgroup');
    geminiGroup.label = 'Gemini 3.1 Pro Audio (AI Synthesis)';
    ADVANCED_GEMINI_VOICES.forEach(gv => {
      const option = document.createElement('option');
      option.value = gv.id;
      option.textContent = `${gv.name} (Requires Proxy)`;
      geminiGroup.appendChild(option);
    });
    sel.appendChild(geminiGroup);

    // 3. Chirp 3 HD Voices (Google Cloud High-Def)
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

  // 4. Local Device Voices (Legacy fallback)
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
    speakAdvanced(item, sentenceIdx, token);
  }
}


// --- SECTION 6: ADVANCED WEB AUDIO SYNTHESIS & DECODING ---
async function speakAdvanced(item, sentenceIdx, token) {
  ensureAudioCtx();
  
  if (!playing || token !== queueToken) return;

  // Highlight active visual segment inside the doc viewer
  idx = sentenceIdx;
  highlightBlock(item.blockIdx);
  updatePos();
  updateMediaSession('playing');

  // Strip Markdown symbols from speech target text
  const cleanText = (item.speechText || item.text)
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/^>\s*/gm, '');

  if (!cleanText.trim()) {
    // If empty text line, jump past with a minor gap
    scheduleSpeech(sentenceIdx + 1, token, 70);
    return;
  }

  const voiceSel = document.getElementById('voice-sel');
  const voiceId = voiceSel ? voiceSel.value : 'en-US-Chirp3-HD-Charon';
  const speed = parseFloat(document.getElementById('rate-slider').value) || 1.0;
  const engine = getSelectedVoiceEngine();

  // Distinct key for local storage caching
  const cacheKey = `tts_${voiceId}_${speed}_${cleanText}`;
  let base64Audio = null;

  try {
    base64Audio = await getCachedAudio(cacheKey);
  } catch (err) {
    console.error("Cache database retrieve error:", err);
  }

  // If missing from local DB, fetch audio from API proxy
  if (!base64Audio) {
    const playBtn = document.getElementById('play-btn');
    if (playBtn) playBtn.classList.add('generating-audio');

    try {
      // Respect our polite client-side rate limit slot
      await acquireRequestSlot();

      const proxyUrl = cleanProxyUrl(localStorage.getItem('axiom-tts-proxy-url') || '');
      if (!proxyUrl) {
        throw new Error("Proxy server URL is not configured in settings.");
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
          speed: speed,
          engine: engine
        })
      });

      if (!response.ok) {
        const errorText = await response.json().catch(() => ({}));
        throw new Error(errorText.error || `Proxy response failure: ${response.status}`);
      }

      const responseJson = await response.json();
      base64Audio = responseJson.data;

      if (!base64Audio) throw new Error("No data string inside response payload");

      // Save to IndexedDB to preserve token quotas
      try {
        await setCachedAudio(cacheKey, base64Audio);
      } catch (err) {
        console.error("Cache save database write error:", err);
      }
    } catch (err) {
      console.error("Advanced fetch failed:", err);
      
      // Fallback message notice
      const notice = document.createElement('div');
      notice.className = 'tts-error-toast';
      notice.textContent = `Vocal synthesis proxy failed: ${err.message}. Reverting to standard local device.`;
      document.body.appendChild(notice);
      setTimeout(() => notice.remove(), 4000);
      
      // Fallback immediately to standard browser speech synthesis for this segment
      try {
        currentUtterance = buildUtterance(item, sentenceIdx, token, 0, true);
        synth.speak(currentUtterance);
      } catch (_) {
        stopTTS();
      }
      return;
    } finally {
      if (playBtn) playBtn.classList.remove('generating-audio');
    }
  }

  if (!playing || token !== queueToken) return;

  try {
    // Decode base64 to 16-bit PCM bytes
    const rawBinary = atob(base64Audio);
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
    // Note: Google Cloud (Chirp) applies speed synthesis server-side.
    // Gemini does not support custom speaking rates natively, so we apply speed scale in browser context.
    sourceNode.playbackRate.value = engine === 'CHIRP3_HD' ? 1.0 : speed;

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
      if (currentAudioSource === sourceNode) {
        currentAudioSource = null;
        isAudioContextSpeaking = false;
        audioAnalyser = null;
      }
      
      if (!playing || token !== queueToken) return;
      saveCurrentReadPosition();

      if (sentenceIdx >= ttsList.length - 1) {
        stopTTS();
        return;
      }

      idx = sentenceIdx + 1;
      scheduleSpeech(idx, token, 70);
    };

    sourceNode.start(0);

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
    highlightBlock(item.blockIdx);
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
  const btn = document.getElementById('play-btn');
  if (!btn) return;
  const icon = btn.querySelector('.material-symbols-outlined');
  if (icon) {
    icon.textContent = s === 'play' ? 'play_arrow' : 'pause';
  } else {
    btn.textContent = s === 'play' ? '▶' : '⏸';
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

function highlightBlock(blockIdx) {
  document.querySelectorAll('.reading-block').forEach(el => el.classList.remove('reading-block'));
  const el = document.querySelector(`[data-bid="${blockIdx}"]`);
  if (el) {
    el.classList.add('reading-block');
    const container = document.getElementById('doc-view');
    if (container) {
      if (!isBlockVisible(el, container)) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

function updatePos() {
  const posLabel = document.getElementById('pos-label');
  if (posLabel) {
    posLabel.textContent = ttsList.length ? `${idx + 1} / ${ttsList.length}` : '— / —';
  }
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
    const voiceId = voiceSel ? voiceSel.value : 'en-US-Chirp3-HD-Charon';
    const speed = parseFloat(document.getElementById('rate-slider').value) || 1.0;
    const engine = getSelectedVoiceEngine();

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

    // Sequentially process each text block in the document playlist
    for (let sIdx = 0; sIdx < list.length; sIdx++) {
      const segment = list[sIdx];
      const progressPct = Math.round((sIdx / list.length) * 100);
      
      if (downloadBtn) {
        downloadBtn.textContent = `Compiling segment ${sIdx + 1} of ${list.length} (${progressPct}%)`;
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

      const cacheKey = `tts_${voiceId}_${speed}_${cleanText}`;
      let base64Audio = "";

      // 1. Try to load from database cache
      try {
        base64Audio = await getCachedAudio(cacheKey);
      } catch (err) {
        console.error("IndexedDB fetch failed in downloader:", err);
      }

      // 2. Fetch live via network if cache missed
      if (!base64Audio) {
        try {
          await acquireRequestSlot();

          const proxyUrl = cleanProxyUrl(localStorage.getItem('axiom-tts-proxy-url') || '');
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
              speed: speed,
              engine: engine
            })
          });

          if (response.ok) {
            const json = await response.json();
            if (json && json.data) {
              base64Audio = json.data;
              try {
                await setCachedAudio(cacheKey, base64Audio);
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


// --- SECTION 10: SETTINGS DIALOG, GITHUB OAUTH & WIRING ---
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

  // DOM Elements for settings modal
  const settingsBtn = document.getElementById('tts-settings-btn');
  const settingsModal = document.getElementById('tts-settings-modal');
  const cancelBtn = document.getElementById('tts-settings-cancel-btn');
  const saveBtn = document.getElementById('tts-settings-save-btn');
  const proxyFields = document.getElementById('proxy-settings-fields');
  const proxyUrlInput = document.getElementById('tts-proxy-url');
  const githubUserStatus = document.getElementById('github-user-status');
  const githubLoginBtn = document.getElementById('github-login-btn');
  const modeRadios = document.getElementsByName('tts-mode');

  // Load saved settings
  const loadSavedConfig = () => {
    const savedMode = localStorage.getItem('axiom-tts-mode') || 'offline';
    const savedProxyUrl = cleanProxyUrl(localStorage.getItem('axiom-tts-proxy-url') || '');
    const githubUsername = localStorage.getItem('axiom-github-username') || '';

    // Set radio buttons
    for (const radio of modeRadios) {
      if (radio.value === savedMode) {
        radio.checked = true;
      }
    }

    // Toggle proxy fields visual visibility
    proxyFields.style.display = savedMode === 'proxy' ? 'block' : 'none';
    proxyUrlInput.value = savedProxyUrl;

    // Set GitHub login status
    if (githubUsername) {
      githubUserStatus.textContent = `LOGGED IN AS: ${githubUsername.toUpperCase()}`;
      githubUserStatus.style.color = 'var(--primary)';
      githubLoginBtn.textContent = 'LOGOUT';
    } else {
      githubUserStatus.textContent = 'NOT LOGGED IN';
      githubUserStatus.style.color = 'var(--text-muted)';
      githubLoginBtn.textContent = 'LOGIN';
    }
  };

  // Toggle proxy fields depending on mode selector
  for (const radio of modeRadios) {
    radio.addEventListener('change', (e) => {
      proxyFields.style.display = e.target.value === 'proxy' ? 'block' : 'none';
    });
  }

  // Open settings modal
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      loadSavedConfig();
      settingsModal.classList.add('open');
      settingsModal.setAttribute('aria-hidden', 'false');
    });
  }

  // Close settings modal
  const closeModal = () => {
    settingsModal.classList.remove('open');
    settingsModal.setAttribute('aria-hidden', 'true');
  };

  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeModal);
  }

  // Save settings
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      let selectedMode = 'offline';
      for (const radio of modeRadios) {
        if (radio.checked) selectedMode = radio.value;
      }

      localStorage.setItem('axiom-tts-mode', selectedMode);
      localStorage.setItem('axiom-tts-proxy-url', cleanProxyUrl(proxyUrlInput.value));

      // If switching to enhanced mode and no token, show warning
      const token = localStorage.getItem('axiom-github-token');
      if (selectedMode === 'proxy' && !token) {
        alert("Enhanced Voice Mode saved. Note: You must log in with GitHub before you can generate voices.");
      }

      loadVoices();
      closeModal();
    });
  }

  // Handle GitHub OAuth Login/Logout
  if (githubLoginBtn) {
    githubLoginBtn.addEventListener('click', () => {
      const token = localStorage.getItem('axiom-github-token');
      
      if (token) {
        // Log out
        localStorage.removeItem('axiom-github-token');
        localStorage.removeItem('axiom-github-username');
        loadSavedConfig();
        loadVoices();
        alert("Logged out successfully.");
      } else {
        // Log in
        const proxyUrl = cleanProxyUrl(proxyUrlInput.value);
        if (!proxyUrl) {
          alert("Please enter a Proxy Server URL first!");
          return;
        }

        // Store active settings state so they aren't lost on redirect
        let selectedMode = 'offline';
        for (const radio of modeRadios) {
          if (radio.checked) selectedMode = radio.value;
        }
        localStorage.setItem('axiom-tts-mode', selectedMode);
        localStorage.setItem('axiom-tts-proxy-url', proxyUrl);

        // Redirect to proxy oauth endpoint
        let redirectUri = window.location.origin + window.location.pathname;
        if (!redirectUri.endsWith('/') && !redirectUri.endsWith('.html')) {
          redirectUri += '/';
        }
        const authUrl = `${proxyUrl}/api/auth/login?redirect_uri=${encodeURIComponent(redirectUri)}`;
        window.location.href = authUrl;
      }
    });
  }

  // --- CAPTURE GITHUB OAUTH CALLBACK CODE ---
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  if (code) {
    // Clear code parameter from URL immediately
    let cleanUrl = window.location.origin + window.location.pathname;
    if (!cleanUrl.endsWith('/') && !cleanUrl.endsWith('.html')) {
      cleanUrl += '/';
    }
    window.history.replaceState({}, document.title, cleanUrl);

    // Retrieve saved proxy URL to send exchange request
    const proxyUrl = cleanProxyUrl(localStorage.getItem('axiom-tts-proxy-url'));
    if (!proxyUrl) {
      console.error("Oauth code received but proxy URL is not set in local storage.");
      return;
    }

    // Display a loading notice toast
    const loadingToast = document.createElement('div');
    loadingToast.className = 'tts-error-toast';
    loadingToast.style.background = 'var(--surface-highest)';
    loadingToast.style.borderColor = 'var(--primary)';
    loadingToast.textContent = 'Verifying GitHub login...';
    document.body.appendChild(loadingToast);

    // Call proxy to exchange code for token
    fetch(`${proxyUrl}/api/auth/github`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, redirect_uri: cleanUrl })
    })
    .then(res => {
      if (!res.ok) {
        return res.json().then(data => { throw new Error(data.error || 'Failed to exchange login code'); });
      }
      return res.json();
    })
    .then(data => {
      // Save token and username
      localStorage.setItem('axiom-github-token', data.token);
      localStorage.setItem('axiom-github-username', data.username);
      localStorage.setItem('axiom-tts-mode', 'proxy'); // Auto toggle proxy mode
      
      loadingToast.remove();
      loadVoices();
      
      // Open settings page to show success status
      if (settingsBtn) {
        settingsBtn.click();
      }

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
      console.error("OAuth token exchange error:", err);
      alert(`GitHub authentication failed: ${err.message}`);
    });
  }

  // Restore initial voices listing
  loadVoices();
});
