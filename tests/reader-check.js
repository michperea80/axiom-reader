const frame = document.getElementById('app');
const status = document.getElementById('status');
async function loadSample() {
  const app = frame.contentWindow;
  const content = await (await fetch('reading-sample.md')).text();
  const saved = await app.recentFileSave('Reading sample (local test)', content, null);
  app.loadFile({ name:'Reading sample (local test)', content, recentId:saved.id });
  status.textContent = 'Synthetic document loaded';
}
document.getElementById('load').onclick = loadSample;
document.getElementById('run').onclick = async () => {
  await loadSample();
  const script = frame.contentDocument.createElement('script');
  script.src = './tests/playback-checks.js?run=' + Date.now();
  frame.contentDocument.body.appendChild(script);
};
window.showReaderResults = results => {
  const output = document.getElementById('results');
  output.hidden = false;
  output.replaceChildren(...results.map(text => { const item = document.createElement('p'); item.textContent = text; return item; }));
  status.textContent = results.some(text => text.startsWith('FAIL')) ? 'Checks need attention' : `${results.length} checks passed`;
};

if (new URLSearchParams(window.location.search).has('autorun')) {
  frame.addEventListener('load', () => {
    setTimeout(() => document.getElementById('run').click(), 400);
  });
}

