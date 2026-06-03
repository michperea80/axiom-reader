let audioCtx = null;
let keepAliveSource = null;
let keepAliveScheduled = false;

function ensureAudioCtx() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return;
  }
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
}

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
  const fileName = document.getElementById('file-name').textContent;
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
  synth.resume();
  if (!synth.paused && !synth.speaking && !synth.pending) {
    synth.cancel();
    speak(idx);
  }
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) recoverPlayback(); });
window.addEventListener('focus', recoverPlayback);
window.addEventListener('pageshow', recoverPlayback);

const synth = window.speechSynthesis;
let voices  = [];
let idx     = 0;
let playing = false;
let queueToken = 0;
let speechTimer = null;
let currentUtterance = null;
let visualizerAnimationId = null;
let visualizerSpike = 0;

const SYSTEM_VOICE_VALUE = 'system';
const SAVED_VOICE_KEY = 'axiom-reader-voice';
const SAVED_RATE_KEY = 'axiom-reader-rate';
const TTS_TEST_TEXT = 'AXIOM Reader voice test.';

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

function getSelectedVoice() {
  const sel = document.getElementById('voice-sel');
  if (!sel || sel.value === SYSTEM_VOICE_VALUE) return null;
  return voices.find(v => voiceKey(v) === sel.value) || null;
}

function useSystemVoice(save = true) {
  const sel = document.getElementById('voice-sel');
  if (sel) sel.value = SYSTEM_VOICE_VALUE;
  if (save) localStorage.setItem(SAVED_VOICE_KEY, SYSTEM_VOICE_VALUE);
}

function loadVoices() {
  const all = synth.getVoices();
  const sel  = document.getElementById('voice-sel');
  if (!sel) return;
  // Prevent Chrome from wiping voices when synth.cancel() temporarily returns empty voices
  if (all.length === 0 && voices && voices.length > 0) return;

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

  const systemOption = document.createElement('option');
  systemOption.value = SYSTEM_VOICE_VALUE;
  systemOption.textContent = 'Phone default voice';
  sel.appendChild(systemOption);

  if (!voices.length) {
    sel.value = SYSTEM_VOICE_VALUE;
    return;
  }

  const ordered = voices;

  ordered.forEach(v => {
    const option = document.createElement('option');
    option.value = voiceKey(v);
    option.textContent = voiceLabel(v);
    sel.appendChild(option);
  });

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
      visualizerSpike = 1.0;
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

function speakOne(sentenceIdx, token, attempt = 0, forceSystemVoice = false) {
  if (!playing || token !== queueToken) return;
  if (sentenceIdx >= ttsList.length) { stopTTS(); return; }
  const item = ttsList[sentenceIdx];
  if (!item) { stopTTS(); return; }
  try {
    currentUtterance = buildUtterance(item, sentenceIdx, token, attempt, forceSystemVoice);
    synth.speak(currentUtterance);
  } catch (_) {
    currentUtterance = null;
    stopTTS();
  }
}

function queueSpeechFrom(startIdx) {
  if (!ttsList.length) { stopTTS(); return; }

  queueToken += 1;
  const token = queueToken;
  clearSpeechTimer();
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

function updateVisualizerAnimation() {
  if (!playing) {
    visualizerAnimationId = null;
    return;
  }

  const viz = document.getElementById('visualizer');
  if (viz) {
    const bars = viz.querySelectorAll('.visualizer-bar');
    const time = Date.now() * 0.005;
    const isSpeaking = synth.speaking && !synth.paused;
    
    // Decay visualizerSpike by 8% per frame
    visualizerSpike *= 0.92;

    bars.forEach((bar, index) => {
      let height = 15;

      if (isSpeaking) {
        // Base sine wave fluctuation
        const wave1 = Math.sin(time * 1.5 + index * 0.6) * 15;
        const wave2 = Math.cos(time * 2.8 - index * 0.4) * 10;
        
        // Spike effect from word boundaries
        const spike = visualizerSpike * (Math.sin(index * 0.9) + 1.2) * 35;
        
        // Minor background noise
        const noise = (Math.random() - 0.5) * 8;

        height = 30 + wave1 + wave2 + spike + noise;
        height = Math.max(10, Math.min(95, height));
      } else {
        // Quiet baseline vibration when between sentences or paused
        height = 12 + Math.sin(time * 3 + index) * 3 + (Math.random() - 0.5) * 2;
      }

      bar.style.height = `${height}%`;
    });
  }

  visualizerAnimationId = requestAnimationFrame(updateVisualizerAnimation);
}

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
  // Reset visualizer bars to resting baseline heights
  if (viz) {
    viz.querySelectorAll('.visualizer-bar').forEach(bar => {
      bar.style.height = '15%';
    });
  }
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

setInterval(() => {
  if (!playing) return;
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
  document.getElementById('pos-label').textContent =
    ttsList.length ? `${idx + 1} / ${ttsList.length}` : '— / —';
}

function updatePlaybackControlsState() {
  const hasFile = (ttsList && ttsList.length > 0 && document.getElementById('screen-reader').classList.contains('active'));
  
  const controls = [
    'play-btn', 'btn-prev', 'btn-next', 'btn-b5', 'btn-f5',
    'rate-slider', 'pitch-slider', 'status-sel',
    'highlight-current-btn', 'note-current-btn', 'notes-panel-btn', 'save-notes-btn'
  ];
  
  controls.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.disabled = !hasFile;
      if (!hasFile) {
        el.classList.add('disabled-control');
      } else {
        el.classList.remove('disabled-control');
      }
    }
  });
}

function previewTTSVoice() {
  const selectedVoice = getSelectedVoice();
  const wasPlaying = playing;
  stopTTS();
  
  setTimeout(() => {
    ensureAudioCtx();
    const testText = "AXIOM voice system online.";
    const utt = new SpeechSynthesisUtterance(testText);
    const rate = parseFloat(document.getElementById('rate-slider').value);
    const pitchSlider = document.getElementById('pitch-slider');
    const pitch = pitchSlider ? parseFloat(pitchSlider.value) : 1.0;
    
    utt.rate = Number.isFinite(rate) ? rate : 0.95;
    utt.pitch = Number.isFinite(pitch) ? pitch : 1.0;
    utt.volume = 1;
    if (selectedVoice) {
      utt.voice = selectedVoice;
      utt.lang = selectedVoice.lang;
    }
    
    const viz = document.getElementById('visualizer');
    if (viz) viz.classList.add('animating');
    if (!visualizerAnimationId) {
      playing = true;
      visualizerAnimationId = requestAnimationFrame(updateVisualizerAnimation);
    }
    
    utt.onboundary = (event) => {
      if (event.name === 'word') {
        visualizerSpike = 1.0;
      }
    };
    
    const endHandler = () => {
      playing = false;
      if (visualizerAnimationId) {
        cancelAnimationFrame(visualizerAnimationId);
        visualizerAnimationId = null;
      }
      if (viz) viz.classList.remove('animating');
      viz.querySelectorAll('.visualizer-bar').forEach(bar => {
        bar.style.height = '15%';
      });
      if (wasPlaying) {
        setTimeout(startTTS, 300);
      }
    };
    
    utt.onend = endHandler;
    utt.onerror = endHandler;
    
    synth.speak(utt);
  }, 100);
}
