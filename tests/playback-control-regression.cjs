// Run with node tests/playback-control-regression.cjs. No device or cloud calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { PlaybackBridge } = require('../js/bridge/playback-bridge.js');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/tts.js'), 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  const body = source.indexOf('{', start);
  let depth = 1, end = body + 1;
  while (depth) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; end++; }
  return source.slice(start, end);
}
(async () => {
  let pauseCalls = 0;
  const events = {};
  const bridge = new PlaybackBridge();
  bridge.nativePlugin = {
    loadQueue: async q => assert.equal(q.playbackOwner, 'web'),
    pause: async () => pauseCalls++,
    addListener: (name, cb) => { events[name] = cb; }
  };
  bridge._setupNativeListeners();
  let commands = 0, states = 0;
  bridge.on('transportCommand', () => commands++);
  bridge.on('stateChange', () => states++);
  await bridge.loadQueue({ playbackOwner: 'web', items: [{ text: 'Synthetic sentence' }] });
  await bridge.pause();
  assert.equal(pauseCalls, 1, 'Pause reaches native even while bridge says stopped');
  events.onTransportCommand({ command: 'pause' });
  assert.equal(commands, 1);
  const before = commands;
  events.onPlaybackStateChanged({ state: 'playing' });
  assert.equal(commands, before, 'State acknowledgments are not commands');
  assert.ok(states);

  let resolveLoad, loads = 0, plays = 0;
  const noop = () => {};
  const context = {
    playing: false, ttsList: [{ text: 'Synthetic' }], idx: 0,
    playbackStartRevision: 0, queueToken: 0, currentAudioSource: null,
    synth: { cancel: noop }, currentUtterance: null, visualizerAnimationId: null,
    window: { axiomBridge: { isNative: () => true,
      loadQueue: () => { loads++; return new Promise(r => { resolveLoad = r; }); },
      play: async () => { plays++; }, pause: async () => {}, setPlaybackState: async () => {} } },
    document: { getElementById: () => null },
    getSelectedVoiceEngine: () => 'LEGACY', console,
  };
  for (const name of ['updatePos','setBtn','updateMediaSession','saveCurrentReadPosition',
    'stopKeepAlive','releaseWakeLock','clearSpeechTimer','cancelAdvancedAudioRequests',
    'cancelAdvancedTimedFollowing','hideLoadingBar']) context[name] = noop;
  vm.createContext(context);
  vm.runInContext(extract('startTTS') + '\n' + extract('stopTTS'), context);
  context.startTTS(); context.startTTS();
  assert.equal(loads, 1, 'Repeated play does not load a second queue');
  context.stopTTS(); resolveLoad(); await Promise.resolve();
  assert.equal(plays, 0, 'Pause cancels a pending queue-start continuation');
  context.localStorage = { getItem: () => 'system' };
  context.SAVED_VOICE_KEY = 'axiom-reader-voice';
  context.SYSTEM_VOICE_VALUE = 'system';
  context.window.axiomBridge.setVoice = async () => {};
  context.startTTS(); resolveLoad();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(plays, 1, 'A fresh play after pause starts exactly once');
  context.startTTS();
  assert.equal(plays, 1, 'Play while active remains idempotent');
  context.stopTTS();

  let resolveVoices;
  context.voiceListRevision = 2;
  context.SAVED_VOICE_KEY = 'axiom-reader-voice';
  context.localStorage = { getItem: () => 'system' };
  context.window.axiomBridge.getVoices = () => new Promise(r => { resolveVoices = r; });
  const group = { innerHTML: '', appendChild: noop };
  context.document = { getElementById: () => group, createElement: () => ({}) };
  vm.runInContext('async ' + extract('loadNativeVoices'), context);
  const sel = { value: 'system', options: [{ value: 'system' }, { value: 'old-cloud' }] };
  const stale = context.loadNativeVoices(sel, 'old-cloud', 1);
  resolveVoices([{ name: 'device' }]); await stale;
  assert.equal(sel.value, 'system', 'Stale native lookup cannot restore old cloud voice');
  const fresh = context.loadNativeVoices(sel, 'old-cloud', 2);
  resolveVoices([{ name: 'device' }]); await fresh;
  assert.equal(sel.value, 'system', 'Fresh lookup respects latest saved preference');
  console.log('PASS: bridge ownership, command separation, pending pause, repeated play, voice refresh races');
})().catch(error => { console.error(error); process.exitCode = 1; });
