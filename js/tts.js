let silentAudio = null;
let silentSrc   = null;

function buildSilentWavSrc() {
  if (silentSrc) return silentSrc;
  const sr = 8000, n = sr;
  const ab = new ArrayBuffer(44 + n * 2);
  const v  = new DataView(ab);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true);
  ws(8, 'WAVE'); ws(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ws(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, 1, true);
  silentSrc = URL.createObjectURL(new Blob([ab], { type: 'audio/wav' }));
  return silentSrc;
}

function startKeepAlive() {
  if (!silentAudio) {
    silentAudio        = new Audio();
    silentAudio.loop   = true;
    silentAudio.volume = 0.01;
    silentAudio.src    = buildSilentWavSrc();
  }
  silentAudio.play().catch(() => {});
}

function stopKeepAlive() {
  if (silentAudio) silentAudio.pause();
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
  if (silentAudio && silentAudio.paused) silentAudio.play().catch(() => {});
  if (synth.paused) {
    synth.resume();
  } else if (!synth.speaking && !synth.pending) {
    synth.cancel();
    speak(idx);
  }
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) recoverPlayback(); });
window.addEventListener('focus', recoverPlayback);

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
  if (playing && !synth.speaking && !synth.pending) speak(idx);
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
