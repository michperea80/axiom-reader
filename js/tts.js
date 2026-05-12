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

function loadVoices() {
  const all = synth.getVoices();
  if (!all.length) return;
  voices = all;
  const sel  = document.getElementById('voice-sel');
  const prev = sel.value;
  sel.innerHTML = '';
  const en   = all.filter(v => v.lang.startsWith('en'));
  const good = en.filter(v => /natural|premium|neural|enhanced|siri|alex|samantha|karen|daniel|google/i.test(v.name));
  const rest = en.filter(v => !/natural|premium|neural|enhanced|siri|alex|samantha|karen|daniel|google/i.test(v.name));
  const ordered = good.length ? [...good, ...rest] : (en.length ? en : all);
  ordered.forEach(v => {
    const o = document.createElement('option');
    o.value = all.indexOf(v);
    o.textContent = v.name.replace(/\(.*?\)/g, '').trim();
    sel.appendChild(o);
  });
  if (prev) sel.value = prev;
}
if (typeof synth !== 'undefined') {
  synth.addEventListener('voiceschanged', loadVoices);
  loadVoices();
}

function speak(i) {
  if (i >= ttsList.length) { stopTTS(); return; }
  synth.cancel();
  idx = i;
  highlightBlock(ttsList[i].blockIdx);
  updatePos();
  updateMediaSession('playing');
  const utt  = new SpeechSynthesisUtterance(ttsList[i].text);
  utt.rate   = parseFloat(document.getElementById('rate-slider').value);
  const vi   = parseInt(document.getElementById('voice-sel').value);
  if (!isNaN(vi) && voices[vi]) utt.voice = voices[vi];
  utt.onend  = () => { if (playing) speak(i + 1); };
  utt.onerror = e => { if (e.error !== 'interrupted' && playing) speak(i + 1); };
  synth.speak(utt);
}

function startTTS() {
  ensureAudioCtx();
  playing = true;
  setBtn('pause');
  startKeepAlive();
  requestWakeLock();
  updateMediaSession('playing');
  speak(idx);
}

function stopTTS() {
  playing = false;
  setBtn('play');
  stopKeepAlive();
  releaseWakeLock();
  updateMediaSession('paused');
  synth.cancel();
}

function toggleTTS() { if (playing) stopTTS(); else startTTS(); }
function setBtn(s)   { document.getElementById('play-btn').textContent = s === 'play' ? '▶' : '⏸'; }

setInterval(() => {
  if (!playing) return;
  if (synth.paused) { synth.resume(); return; }
  if (!synth.speaking && !synth.pending) speak(idx);
}, 1200);

function jump(delta) {
  const was = playing; stopTTS();
  idx = Math.max(0, Math.min(ttsList.length - 1, idx + delta));
  if (was) startTTS(); else { highlightBlock(ttsList[idx]?.blockIdx); updatePos(); }
}

function highlightBlock(blockIdx) {
  document.querySelectorAll('.reading-block').forEach(el => el.classList.remove('reading-block'));
  const el = document.querySelector(`[data-bid="${blockIdx}"]`);
  if (el) { el.classList.add('reading-block'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
}

function updatePos() {
  document.getElementById('pos-label').textContent =
    ttsList.length ? `${idx + 1} / ${ttsList.length}` : '— / —';
}
