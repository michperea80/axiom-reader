// Connect the reference design's shortcuts to the existing application actions.
document.getElementById('reader-search-btn').addEventListener('click', () => {
  showVoiceControls(false);
  showSearchBar();
});
document.getElementById('reader-notes-btn').addEventListener('click', showNotesPanel);
document.getElementById('bar-note-btn').addEventListener('click', () => document.getElementById('note-current-btn').click());
document.getElementById('bar-highlight-btn').addEventListener('click', () => document.getElementById('highlight-current-btn').click());
document.getElementById('rate-chip').addEventListener('click', () => {
  showVoiceControls(false);
  document.getElementById('rate-slider').focus();
});
const readingSettings = [
  ['text-size-setting', 'axiom-reader-text-size', 'default'],
  ['skip-header-setting', 'axiom-reader-skip-header', 'on'],
  ['hold-setting', 'axiom-reader-hold', '650'],
];
function applyReadingSize(value) {
  document.documentElement.style.setProperty('--reader-size', { compact:'16px', default:'19px', large:'23px' }[value] || '19px');
}
readingSettings.forEach(([id, key, fallback]) => {
  const select = document.getElementById(id);
  const saved = localStorage.getItem(key);
  select.value = Array.from(select.options).some(option => option.value === saved) ? saved : fallback;
  if (id === 'text-size-setting') applyReadingSize(select.value);
  select.addEventListener('change', () => {
    localStorage.setItem(key, select.value);
    if (id === 'text-size-setting') applyReadingSize(select.value);
  });
});
function syncRateChip() {
  document.getElementById('rate-chip').textContent = Number(document.getElementById('rate-slider').value).toFixed(1) + '×';
}
document.getElementById('rate-slider').addEventListener('input', syncRateChip);
new MutationObserver(syncRateChip).observe(document.getElementById('rate-val'), { childList:true });
syncRateChip();
document.getElementById('doc-view').tabIndex = 0;
document.getElementById('doc-view').setAttribute('aria-label', 'Document');

// The same file-opening path handles picker and drag-and-drop files.
const libraryScreen = document.getElementById('screen-library');
libraryScreen.addEventListener('dragover', event => { event.preventDefault(); libraryScreen.classList.add('drag-over'); });
libraryScreen.addEventListener('dragleave', event => {
  if (!libraryScreen.contains(event.relatedTarget)) libraryScreen.classList.remove('drag-over');
});
libraryScreen.addEventListener('drop', async event => {
  event.preventDefault();
  libraryScreen.classList.remove('drag-over');
  const file = Array.from(event.dataTransfer.files).find(file => /\.(md|txt|pdf)$/i.test(file.name));
  if (!file) { alert('Drop a Markdown (.md), text (.txt), or text-based PDF file.'); return; }
  try {
    const content = await readSupportedFile(file);
    const saved = await recentFileSave(file.name, content, null);
    loadFile({ name:file.name, content, recentId:saved.id });
  } catch (error) { showFileOpenError(error); }
});
document.getElementById('lib-recents-list').addEventListener('keydown', event => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.recent-info')) {
    event.preventDefault();
    event.target.click();
  }
});
// Give symbol-only controls readable names, including when the icon font fails.
document.querySelectorAll('button[title]').forEach(button => {
  if (!button.hasAttribute('aria-label')) button.setAttribute('aria-label', button.title);
});
setBtn('play');

// Keep keyboard navigation inside an open dialog or the mobile tools panel.
document.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const overlay = document.querySelector('#tts-settings-modal.open') || document.querySelector('#note-modal.open') || document.querySelector('#notes-panel.open') || (matchMedia('(max-width:900px)').matches && document.querySelector('#voice-controls-panel.mobile-open'));
  if (!overlay) return;
  const controls = Array.from(overlay.querySelectorAll('button, input, select, textarea, [tabindex="0"]')).filter(el => !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  if (!controls.length) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && (document.activeElement === first || !overlay.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || !overlay.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
});
