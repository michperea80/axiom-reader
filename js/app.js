let currentRecentId = null;
let currentFileName = '';
let currentBlocks = [];
let activeNoteBlockIdx = null;
let longPressTimer = null;
let longPressStart = null;
let suppressNextClick = false;

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
}

async function readSupportedFile(file) {
  if (isPdfFile(file)) return extractPdfToMarkdown(file);
  return file.text();
}

function showFileOpenError(err) {
  if (err && err.message === 'NO_EXTRACTABLE_TEXT') {
    alert('This PDF does not contain selectable text. Scanned/image PDFs need OCR and are not supported in this version.');
    return;
  }
  alert('Unable to open this file. Please try another .md, .txt, or text-based .pdf file.');
}

function loadFile(src) {
  const process = async content => {
    stopTTS();
    idx = 0;
    currentRecentId = src.recentId || null;
    currentFileName = src.name;

    const md     = preprocess(content);
    currentBlocks = parseBlocks(md);
    const { h1Idx, infocardStart, infocardEnd, endMatterIdx } = categorize(currentBlocks);
    document.getElementById('doc-render').innerHTML =
      buildDoc(currentBlocks, h1Idx, infocardStart, infocardEnd, endMatterIdx);
    document.getElementById('file-name').textContent = src.name;

    document.getElementById('load-screen').style.display = 'none';
    document.getElementById('doc-view').style.display    = 'block';
    showScreen('reader');
    updatePos();
    updateMediaSession('none');
    setupMediaSession();

    if (src.resumePosition && src.resumePosition > 0 && src.resumePosition < ttsList.length) {
      idx = src.resumePosition;
      highlightBlock(ttsList[idx]?.blockIdx);
      updatePos();
    }
    await refreshNoteIndicators();
  };

  if (typeof src.content === 'string') {
    process(src.content);
  } else {
    const fr = new FileReader();
    fr.onload = e => process(e.target.result);
    fr.readAsText(src);
  }
}

function saveReadPosition() {
  if (currentRecentId !== null) {
    return recentFileUpdatePosition(currentRecentId, idx);
  }
  return Promise.resolve();
}

async function appInit() {
  await dbInit();
  restoreTTSSettings();
  setupMediaSession();
  showScreen('library');
  await renderLibraryScreen();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

function getSectionElement(blockIdx) {
  return document.querySelector(`[data-bid="${blockIdx}"]`);
}

function getSectionExcerpt(blockIdx) {
  const el = getSectionElement(blockIdx);
  if (!el) return '';
  return el.innerText.replace(/\s+/g, ' ').trim().slice(0, 700);
}

function getSectionLabel(blockIdx) {
  for (let i = blockIdx; i >= 0; i -= 1) {
    const block = currentBlocks[i];
    if (block && block.type === 'heading') return stripInline(block.text);
  }
  const block = currentBlocks[blockIdx];
  if (block && block.type === 'table') return 'Table';
  if (block && block.type === 'list') return 'List';
  return `Section ${blockIdx}`;
}

async function refreshNoteIndicators() {
  document.querySelectorAll('.has-note').forEach(el => el.classList.remove('has-note'));
  if (currentRecentId === null) return;
  const notes = await notesForFile(currentRecentId);
  notes.forEach(note => {
    const el = getSectionElement(note.blockIdx);
    if (el) el.classList.add('has-note');
  });
}

function showNoteModal() {
  const modal = document.getElementById('note-modal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.getElementById('note-text').focus();
}

function hideNoteModal() {
  const modal = document.getElementById('note-modal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  activeNoteBlockIdx = null;
}

async function openNoteEditor(blockIdx) {
  if (currentRecentId === null || blockIdx === null || blockIdx === undefined) return;
  activeNoteBlockIdx = blockIdx;
  const existing = await noteForSection(currentRecentId, blockIdx);
  document.getElementById('note-title').textContent = getSectionLabel(blockIdx);
  document.getElementById('note-section-excerpt').textContent = getSectionExcerpt(blockIdx);
  document.getElementById('note-text').value = existing ? existing.noteText : '';
  document.getElementById('note-delete-btn').style.visibility = existing ? 'visible' : 'hidden';
  document.getElementById('note-delete-btn').dataset.noteId = existing ? existing.id : '';
  showNoteModal();
}

async function saveActiveNote() {
  if (currentRecentId === null || activeNoteBlockIdx === null) return;
  const noteText = document.getElementById('note-text').value.trim();
  const existing = await noteForSection(currentRecentId, activeNoteBlockIdx);
  if (!noteText) {
    if (existing) await noteDelete(existing.id);
    hideNoteModal();
    await refreshNoteIndicators();
    return;
  }
  await noteSave({
    fileId: currentRecentId,
    fileName: currentFileName,
    blockIdx: activeNoteBlockIdx,
    sectionLabel: getSectionLabel(activeNoteBlockIdx),
    sectionExcerpt: getSectionExcerpt(activeNoteBlockIdx),
    noteText,
  });
  hideNoteModal();
  await refreshNoteIndicators();
}

async function deleteActiveNote() {
  const noteId = parseInt(document.getElementById('note-delete-btn').dataset.noteId);
  if (!Number.isNaN(noteId)) await noteDelete(noteId);
  hideNoteModal();
  await refreshNoteIndicators();
}

function markdownQuote(text) {
  return text.split('\n').map(line => `> ${line}`).join('\n');
}

function notesMarkdown(notes) {
  const lines = [`# Review Notes: ${currentFileName}`, ''];
  notes.forEach((note, index) => {
    lines.push(`## Note ${index + 1}`);
    lines.push(`- Section: ${note.sectionLabel}`);
    lines.push(`- Position: Section ${note.blockIdx}`);
    lines.push(`- Created: ${new Date(note.createdAt).toLocaleString()}`);
    lines.push('');
    lines.push(markdownQuote(note.sectionExcerpt || 'No section excerpt available.'));
    lines.push('');
    lines.push(note.noteText);
    lines.push('');
  });
  return lines.join('\n');
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportNotes() {
  if (currentRecentId === null) return;
  const notes = await notesForFile(currentRecentId);
  if (!notes.length) {
    alert('No notes have been saved for this file yet.');
    return;
  }
  const base = currentFileName.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'axiom-reader';
  downloadText(`${base}-review-notes.md`, notesMarkdown(notes));
}

document.getElementById('open-folder-btn').addEventListener('click', () =>
  document.getElementById('dir-input').click()
);

document.getElementById('dir-input').addEventListener('change', e => {
  if (e.target.files.length) handleDirSelection(e.target.files);
  e.target.value = '';
});

document.getElementById('open-file-btn').addEventListener('click', () =>
  document.getElementById('file-input').click()
);

document.getElementById('lib-recents-list').addEventListener('click', async e => {
  const delBtn = e.target.closest('.recent-delete');
  if (delBtn) {
    e.stopPropagation();
    await recentFileDelete(parseInt(delBtn.dataset.recentId));
    await renderLibraryScreen();
    return;
  }
  const playBtn = e.target.closest('.recent-play');
  if (playBtn) { openRecentFile(parseInt(playBtn.dataset.recentId)); return; }
  const info = e.target.closest('.recent-info');
  if (info) openRecentFile(parseInt(info.dataset.recentId));
});

document.getElementById('browse-back-btn').addEventListener('click', () => showScreen('library'));

document.getElementById('browse-file-list').addEventListener('click', e => {
  const row = e.target.closest('.browse-row');
  if (row) openBrowseFile(parseInt(row.dataset.browseIdx));
});

document.getElementById('reader-back-btn').addEventListener('click', () => {
  saveReadPosition();
  stopTTS();
  showScreen('library');
  renderLibraryScreen();
});

document.getElementById('play-btn').addEventListener('click', toggleTTS);
document.getElementById('btn-prev').addEventListener('click', () => jump(-1));
document.getElementById('btn-next').addEventListener('click', () => jump(1));
document.getElementById('btn-b5').addEventListener('click',  () => jump(-5));
document.getElementById('btn-f5').addEventListener('click',  () => jump(5));

document.getElementById('rate-slider').addEventListener('input', function () {
  const rate = parseFloat(this.value).toFixed(1);
  document.getElementById('rate-val').textContent = rate + '\xD7';
  saveRateSetting(rate);
  if (playing) { stopTTS(); startTTS(); }
});

document.getElementById('voice-sel').addEventListener('change', () => {
  localStorage.setItem(SAVED_VOICE_KEY, document.getElementById('voice-sel').value);
  if (playing) { stopTTS(); startTTS(); }
});

document.getElementById('note-current-btn').addEventListener('click', () => {
  const blockIdx = ttsList[idx]?.blockIdx;
  if (blockIdx !== undefined) openNoteEditor(blockIdx);
});

document.getElementById('save-notes-btn').addEventListener('click', exportNotes);

document.getElementById('file-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const content = await readSupportedFile(file);
    const saved = await recentFileSave(file.name, content, null);
    loadFile({
      name: file.name,
      content,
      recentId: saved.id,
      resumePosition: saved.readPosition,
    });
  } catch (err) {
    showFileOpenError(err);
  } finally {
    e.target.value = '';
  }
});

document.getElementById('load-pick-btn').addEventListener('click', () =>
  document.getElementById('file-input').click()
);
document.getElementById('open-btn').addEventListener('click', () =>
  document.getElementById('file-input').click()
);

document.getElementById('doc-render').addEventListener('click', e => {
  if (suppressNextClick) {
    suppressNextClick = false;
    e.preventDefault();
    return;
  }
  const el = e.target.closest('[data-bid]');
  if (!el) return;
  const bi      = parseInt(el.dataset.bid);
  const sentIdx = ttsList.findIndex(s => s.blockIdx === bi);
  if (sentIdx < 0) return;
  const was = playing; stopTTS();
  idx = sentIdx;
  if (was) startTTS(); else { highlightBlock(bi); updatePos(); }
  saveReadPosition();
});

document.getElementById('doc-render').addEventListener('contextmenu', e => {
  const el = e.target.closest('[data-bid]');
  if (!el) return;
  e.preventDefault();
  openNoteEditor(parseInt(el.dataset.bid));
});

document.getElementById('doc-render').addEventListener('pointerdown', e => {
  const el = e.target.closest('[data-bid]');
  if (!el || e.pointerType === 'mouse') return;
  longPressStart = { x: e.clientX, y: e.clientY };
  longPressTimer = setTimeout(() => {
    suppressNextClick = true;
    openNoteEditor(parseInt(el.dataset.bid));
  }, 650);
});

document.getElementById('doc-render').addEventListener('pointermove', e => {
  if (!longPressTimer || !longPressStart) return;
  const moved = Math.hypot(e.clientX - longPressStart.x, e.clientY - longPressStart.y);
  if (moved > 12) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
});

['pointerup', 'pointercancel', 'pointerleave'].forEach(type => {
  document.getElementById('doc-render').addEventListener(type, () => {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
    longPressStart = null;
  });
});

document.getElementById('note-save-btn').addEventListener('click', saveActiveNote);
document.getElementById('note-delete-btn').addEventListener('click', deleteActiveNote);
document.getElementById('note-cancel-btn').addEventListener('click', hideNoteModal);
document.getElementById('note-modal').addEventListener('click', e => {
  if (e.target.id === 'note-modal') hideNoteModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('note-modal').classList.contains('open')) {
    hideNoteModal();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveReadPosition();
});
window.addEventListener('pagehide', saveReadPosition);
window.addEventListener('beforeunload', saveReadPosition);

appInit();
