let currentRecentId = null;
let currentFileName = '';
let currentBlocks = [];
let activeNoteBlockIdx = null;
let longPressTimer = null;
let longPressStart = null;
let suppressNextClick = false;
let searchMatches = [];
let activeSearchIdx = -1;

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
    clearSearch();
    hideNotesPanel();
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
    await saveReadPosition();
    await loadReviewStatus();
    await refreshNoteIndicators();
    await refreshHighlightIndicators();
    await renderNotesPanel();
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
    return recentFileUpdateReadMeta(currentRecentId, idx, ttsList.length);
  }
  return Promise.resolve();
}

async function loadReviewStatus() {
  const sel = document.getElementById('status-sel');
  if (!sel || currentRecentId === null) return;
  const rec = await recentFileGet(currentRecentId);
  sel.value = normalizeReviewStatus(rec ? rec.reviewStatus : 'unread');
  updateNotesStatusPill(sel.value);
}

async function updateReviewStatus(status) {
  if (currentRecentId === null) return;
  const normalized = await recentFileUpdateStatus(currentRecentId, status);
  const sel = document.getElementById('status-sel');
  if (sel && normalized) sel.value = normalized;
  updateNotesStatusPill(normalized || status);
  await renderLibraryScreen();
}

function updateNotesStatusPill(status) {
  const pill = document.getElementById('notes-status-pill');
  if (!pill) return;
  const normalized = normalizeReviewStatus(status);
  pill.textContent = statusLabel(normalized);
  pill.className = `status-pill status-${normalized}`;
}

async function appInit() {
  await dbInit();
  if (typeof loadCustomPronunciationMap === 'function') loadCustomPronunciationMap();
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
  await renderNotesPanel(notes);
}

async function refreshHighlightIndicators() {
  document.querySelectorAll('.has-highlight').forEach(el => {
    el.classList.remove('has-highlight', 'highlight-important', 'highlight-needs_edit', 'highlight-fact_check', 'highlight-continuity');
    delete el.dataset.highlightLabel;
  });
  if (currentRecentId === null) return;
  const highlights = await highlightsForFile(currentRecentId);
  highlights.forEach(highlight => {
    const el = getSectionElement(highlight.blockIdx);
    if (el) {
      const kind = normalizeHighlightKind(highlight.kind);
      el.classList.add('has-highlight', `highlight-${kind}`);
      el.dataset.highlightLabel = highlightLabel(kind);
    }
  });
  await renderHighlightsPanel(highlights);
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
  await renderLibraryScreen();
}

async function deleteActiveNote() {
  const noteId = parseInt(document.getElementById('note-delete-btn').dataset.noteId);
  if (!Number.isNaN(noteId)) await noteDelete(noteId);
  hideNoteModal();
  await refreshNoteIndicators();
  await renderLibraryScreen();
}

function showNotesPanel() {
  const panel = document.getElementById('notes-panel');
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  renderNotesPanel();
}

function hideNotesPanel() {
  const panel = document.getElementById('notes-panel');
  if (!panel) return;
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
}

async function renderNotesPanel(existingNotes) {
  const list = document.getElementById('notes-list');
  if (!list) return;
  document.getElementById('notes-file-name').textContent = currentFileName || 'No file loaded';
  const status = document.getElementById('status-sel')?.value || 'unread';
  updateNotesStatusPill(status);

  if (currentRecentId === null) {
    list.innerHTML = '<p class="notes-empty">Open a file to review notes.</p>';
    document.getElementById('highlights-list').innerHTML = '<p class="notes-empty">Open a file to review highlights.</p>';
    updateReviewSummary([], []);
    return;
  }

  const notes = existingNotes || await notesForFile(currentRecentId);
  const highlights = await highlightsForFile(currentRecentId);
  updateReviewSummary(notes, highlights);
  if (!notes.length) {
    list.innerHTML = '<p class="notes-empty">No notes saved for this file yet.</p>';
    await renderHighlightsPanel(highlights);
    return;
  }

  list.innerHTML = notes.map(note => `
    <article class="note-card" data-note-id="${note.id}" data-block-idx="${note.blockIdx}">
      <div class="note-card-top">
        <h3>${escHtml(note.sectionLabel || `Section ${note.blockIdx}`)}</h3>
        <span>${timeAgo(note.updatedAt || note.createdAt)}</span>
      </div>
      <blockquote>${escHtml(note.sectionExcerpt || 'No section excerpt available.')}</blockquote>
      <p>${escHtml(note.noteText)}</p>
      <div class="note-card-actions">
        <button data-note-action="jump">Jump</button>
        <button data-note-action="edit">Edit</button>
        <button data-note-action="delete">Delete</button>
      </div>
    </article>
  `).join('');
  await renderHighlightsPanel(highlights);
}

async function renderHighlightsPanel(existingHighlights) {
  const list = document.getElementById('highlights-list');
  if (!list) return;
  if (currentRecentId === null) {
    list.innerHTML = '<p class="notes-empty">Open a file to review highlights.</p>';
    return;
  }

  const highlights = existingHighlights || await highlightsForFile(currentRecentId);
  const notes = await notesForFile(currentRecentId);
  updateReviewSummary(notes, highlights);
  if (!highlights.length) {
    list.innerHTML = '<p class="notes-empty">No highlights saved for this file yet.</p>';
    return;
  }

  list.innerHTML = highlights.map(highlight => `
    <article class="note-card highlight-card highlight-card-${normalizeHighlightKind(highlight.kind)}" data-highlight-id="${highlight.id}" data-block-idx="${highlight.blockIdx}">
      <div class="note-card-top">
        <h3>${escHtml(highlight.sectionLabel || `Section ${highlight.blockIdx}`)}</h3>
        <span>${timeAgo(highlight.updatedAt || highlight.createdAt)}</span>
      </div>
      <div class="highlight-label">${escHtml(highlightLabel(highlight.kind))}</div>
      <blockquote>${escHtml(highlight.sectionExcerpt || 'No section excerpt available.')}</blockquote>
      <div class="note-card-actions">
        <button data-highlight-action="jump">Jump</button>
        <button data-highlight-action="remove">Remove</button>
      </div>
    </article>
  `).join('');
}

function updateReviewSummary(notes = [], highlights = []) {
  const summary = document.getElementById('review-summary');
  if (!summary) return;
  const unresolved = notes.length;
  summary.innerHTML = `
    <span>${notes.length} notes</span>
    <span>${highlights.length} highlights</span>
    <span>${unresolved} unresolved tasks</span>
  `;
}

function jumpToBlock(blockIdx) {
  const sentIdx = ttsList.findIndex(s => s.blockIdx === blockIdx);
  if (sentIdx >= 0) {
    if (playing) stopTTS();
    idx = sentIdx;
  }
  highlightBlock(blockIdx);
  updatePos();
  saveReadPosition();
}

async function toggleHighlightForBlock(blockIdx) {
  if (currentRecentId === null || blockIdx === null || blockIdx === undefined) return;
  const kind = normalizeHighlightKind(document.getElementById('highlight-kind-sel')?.value);
  await highlightToggle({
    fileId: currentRecentId,
    fileName: currentFileName,
    blockIdx,
    kind,
    label: highlightLabel(kind),
    color: highlightColor(kind),
    sectionLabel: getSectionLabel(blockIdx),
    sectionExcerpt: getSectionExcerpt(blockIdx),
  });
  await refreshHighlightIndicators();
  await renderLibraryScreen();
}

function showSearchBar() {
  const bar = document.getElementById('search-bar');
  bar.classList.add('open');
  bar.setAttribute('aria-hidden', 'false');
  document.getElementById('search-input').focus();
}

function hideSearchBar() {
  const bar = document.getElementById('search-bar');
  bar.classList.remove('open');
  bar.setAttribute('aria-hidden', 'true');
  clearSearch();
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clearSearchMarks() {
  document.querySelectorAll('mark.search-match').forEach(mark => {
    const text = document.createTextNode(mark.textContent);
    mark.replaceWith(text);
    text.parentNode?.normalize();
  });
}

function clearSearch() {
  clearSearchMarks();
  searchMatches = [];
  activeSearchIdx = -1;
  const input = document.getElementById('search-input');
  const count = document.getElementById('search-count');
  if (input) input.value = '';
  if (count) count.textContent = '0 / 0';
}

function markTextMatches(el, query) {
  const regex = new RegExp(escapeRegExp(query), 'gi');
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      if (node.parentElement?.closest('mark')) return NodeFilter.FILTER_REJECT;
      regex.lastIndex = 0;
      return regex.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  nodes.forEach(node => {
    regex.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(node.nodeValue)) !== null) {
      if (match.index > lastIndex) frag.appendChild(document.createTextNode(node.nodeValue.slice(lastIndex, match.index)));
      const mark = document.createElement('mark');
      mark.className = 'search-match';
      mark.textContent = match[0];
      mark.dataset.blockIdx = el.dataset.bid;
      frag.appendChild(mark);
      searchMatches.push(mark);
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < node.nodeValue.length) frag.appendChild(document.createTextNode(node.nodeValue.slice(lastIndex)));
    node.replaceWith(frag);
  });
}

function runSearch() {
  const input = document.getElementById('search-input');
  const query = input.value.trim();
  clearSearchMarks();
  searchMatches = [];
  activeSearchIdx = -1;

  if (query.length < 2) {
    document.getElementById('search-count').textContent = '0 / 0';
    return;
  }

  document.querySelectorAll('#doc-render [data-bid]').forEach(el => markTextMatches(el, query));
  if (searchMatches.length) setActiveSearchMatch(0);
  else document.getElementById('search-count').textContent = '0 / 0';
}

function setActiveSearchMatch(nextIdx) {
  if (!searchMatches.length) return;
  searchMatches.forEach(mark => mark.classList.remove('active-search-match'));
  activeSearchIdx = (nextIdx + searchMatches.length) % searchMatches.length;
  const active = searchMatches[activeSearchIdx];
  active.classList.add('active-search-match');
  document.getElementById('search-count').textContent = `${activeSearchIdx + 1} / ${searchMatches.length}`;
  const blockIdx = parseInt(active.dataset.blockIdx);
  const sentIdx = ttsList.findIndex(s => s.blockIdx === blockIdx);
  if (sentIdx >= 0) {
    if (playing) stopTTS();
    idx = sentIdx;
    updatePos();
    saveReadPosition();
  }
  active.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function markdownQuote(text) {
  return text.split('\n').map(line => `> ${line}`).join('\n');
}

function groupReviewItems(notes, highlights) {
  const groups = new Map();
  [...notes, ...highlights].forEach(item => {
    const key = item.sectionLabel || `Section ${item.blockIdx}`;
    if (!groups.has(key)) groups.set(key, { notes: [], highlights: [] });
  });
  notes.forEach(note => groups.get(note.sectionLabel || `Section ${note.blockIdx}`).notes.push(note));
  highlights.forEach(highlight => groups.get(highlight.sectionLabel || `Section ${highlight.blockIdx}`).highlights.push(highlight));
  return [...groups.entries()].sort((a, b) => {
    const aItems = [...a[1].notes, ...a[1].highlights];
    const bItems = [...b[1].notes, ...b[1].highlights];
    return Math.min(...aItems.map(item => item.blockIdx)) - Math.min(...bItems.map(item => item.blockIdx));
  });
}

function filteredReviewItems(notes, highlights, filter) {
  if (filter === 'notes') return { notes, highlights: [] };
  if (filter === 'highlights') return { notes: [], highlights };
  if (filter && filter.startsWith('highlight:')) {
    const kind = normalizeHighlightKind(filter.split(':')[1]);
    return { notes: [], highlights: highlights.filter(highlight => normalizeHighlightKind(highlight.kind) === kind) };
  }
  return { notes, highlights };
}

function notesMarkdown(notes, highlights = [], filter = 'all') {
  const filtered = filteredReviewItems(notes, highlights, filter);
  const status = statusLabel(document.getElementById('status-sel')?.value || 'unread');
  const lines = [`# Review Notes: ${currentFileName}`, ''];
  lines.push(`- Review status: ${status}`);
  lines.push(`- Notes: ${notes.length}`);
  lines.push(`- Highlights: ${highlights.length}`);
  lines.push(`- Unresolved tasks: ${notes.length}`);
  lines.push(`- Export filter: ${exportFilterLabel(filter)}`);
  lines.push(`- Exported: ${new Date().toLocaleString()}`);
  lines.push('');

  groupReviewItems(filtered.notes, filtered.highlights).forEach(([section, group]) => {
    lines.push(`## ${section}`);
    lines.push('');

    group.notes.forEach(note => {
      lines.push(`- [ ] ${note.noteText.replace(/\n+/g, ' ')}`);
      lines.push(`  - Position: Section ${note.blockIdx}`);
      lines.push(`  - Created: ${new Date(note.createdAt).toLocaleString()}`);
      lines.push('');
      lines.push(markdownQuote(note.sectionExcerpt || 'No section excerpt available.'));
      lines.push('');
    });

    group.highlights.forEach(highlight => {
      lines.push(`- Highlight: ${highlightLabel(highlight.kind)}, Section ${highlight.blockIdx}`);
      lines.push(`  - Created: ${new Date(highlight.createdAt).toLocaleString()}`);
      lines.push('');
      lines.push(markdownQuote(highlight.sectionExcerpt || 'No highlighted excerpt available.'));
      lines.push('');
    });
  });
  return lines.join('\n');
}

function exportFilterLabel(filter) {
  if (filter === 'notes') return 'Notes only';
  if (filter === 'highlights') return 'All highlights';
  if (filter && filter.startsWith('highlight:')) return `${highlightLabel(filter.split(':')[1])} highlights`;
  return 'All review items';
}

function downloadText(filename, text, type = 'text/markdown;charset=utf-8') {
  const blob = new Blob([text], { type });
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
  const highlights = await highlightsForFile(currentRecentId);
  const filter = document.getElementById('export-filter-sel')?.value || 'all';
  const filtered = filteredReviewItems(notes, highlights, filter);
  if (!filtered.notes.length && !filtered.highlights.length) {
    alert('No notes or highlights have been saved for this file yet.');
    return;
  }
  const base = currentFileName.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'axiom-reader';
  downloadText(`${base}-review-notes.md`, notesMarkdown(notes, highlights, filter));
}

async function backupAppData() {
  const data = await exportAppData();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  downloadText(`axiom-reader-backup-${stamp}.json`, JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
}

async function restoreAppDataFromFile(file) {
  try {
    const data = JSON.parse(await file.text());
    const ok = confirm('Restore will replace local AXIOM Reader files, notes, highlights, and review status with this backup. Continue?');
    if (!ok) return;
    await importAppData(data);
    currentRecentId = null;
    currentFileName = '';
    currentBlocks = [];
    stopTTS();
    clearSearch();
    hideNotesPanel();
    document.getElementById('doc-render').innerHTML = '';
    document.getElementById('file-name').textContent = 'No file loaded';
    document.getElementById('load-screen').style.display = 'flex';
    document.getElementById('doc-view').style.display = 'none';
    showScreen('library');
    await renderLibraryScreen();
    alert('AXIOM Reader data restored.');
  } catch (_) {
    alert('Unable to restore this backup file.');
  }
}

async function exportPronunciation() {
  if (typeof exportPronunciationMapData !== 'function') return;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  downloadText(`axiom-reader-pronunciation-${stamp}.json`, JSON.stringify(exportPronunciationMapData(), null, 2), 'application/json;charset=utf-8');
}

async function importPronunciationFromFile(file) {
  try {
    const data = JSON.parse(await file.text());
    importPronunciationMapData(data);
    if (currentBlocks.length) {
      const content = (await recentFileGet(currentRecentId))?.content;
      if (content) loadFile({ name: currentFileName, content, recentId: currentRecentId, resumePosition: idx });
    }
    alert('Pronunciation dictionary imported.');
  } catch (_) {
    alert('Unable to import this pronunciation dictionary.');
  }
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
document.getElementById('backup-data-btn').addEventListener('click', backupAppData);
document.getElementById('restore-data-btn').addEventListener('click', () =>
  document.getElementById('restore-input').click()
);
document.getElementById('export-pronunciation-btn').addEventListener('click', exportPronunciation);
document.getElementById('import-pronunciation-btn').addEventListener('click', () =>
  document.getElementById('pronunciation-input').click()
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

document.getElementById('status-sel').addEventListener('change', e => {
  updateReviewStatus(e.target.value);
});

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
document.getElementById('notes-panel-btn').addEventListener('click', showNotesPanel);
document.getElementById('notes-close-btn').addEventListener('click', hideNotesPanel);
document.getElementById('notes-export-btn').addEventListener('click', exportNotes);
document.getElementById('notes-panel').addEventListener('click', e => {
  if (e.target.id === 'notes-panel') hideNotesPanel();
});
document.getElementById('notes-list').addEventListener('click', async e => {
  const action = e.target.dataset.noteAction;
  if (!action) return;
  const card = e.target.closest('.note-card');
  const blockIdx = parseInt(card.dataset.blockIdx);
  const noteId = parseInt(card.dataset.noteId);
  if (action === 'jump') jumpToBlock(blockIdx);
  if (action === 'edit') openNoteEditor(blockIdx);
  if (action === 'delete' && !Number.isNaN(noteId)) {
    await noteDelete(noteId);
    await refreshNoteIndicators();
    await renderLibraryScreen();
  }
});
document.getElementById('highlights-list').addEventListener('click', async e => {
  const action = e.target.dataset.highlightAction;
  if (!action) return;
  const card = e.target.closest('.highlight-card');
  const blockIdx = parseInt(card.dataset.blockIdx);
  const highlightId = parseInt(card.dataset.highlightId);
  if (action === 'jump') jumpToBlock(blockIdx);
  if (action === 'remove' && !Number.isNaN(highlightId)) {
    await highlightDelete(highlightId);
    await refreshHighlightIndicators();
    await renderLibraryScreen();
  }
});

document.getElementById('search-toggle-btn').addEventListener('click', () => {
  const bar = document.getElementById('search-bar');
  if (bar.classList.contains('open')) hideSearchBar();
  else showSearchBar();
});
document.getElementById('search-input').addEventListener('input', runSearch);
document.getElementById('search-prev-btn').addEventListener('click', () => setActiveSearchMatch(activeSearchIdx - 1));
document.getElementById('search-next-btn').addEventListener('click', () => setActiveSearchMatch(activeSearchIdx + 1));
document.getElementById('search-clear-btn').addEventListener('click', hideSearchBar);

document.getElementById('highlight-current-btn').addEventListener('click', () => {
  const blockIdx = ttsList[idx]?.blockIdx;
  if (blockIdx !== undefined) toggleHighlightForBlock(blockIdx);
});

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

document.getElementById('restore-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (file) await restoreAppDataFromFile(file);
  e.target.value = '';
});

document.getElementById('pronunciation-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (file) await importPronunciationFromFile(file);
  e.target.value = '';
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
  } else if (e.key === 'Escape' && document.getElementById('notes-panel').classList.contains('open')) {
    hideNotesPanel();
  } else if (e.key === 'Escape' && document.getElementById('search-bar').classList.contains('open')) {
    hideSearchBar();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveReadPosition();
});
window.addEventListener('pagehide', saveReadPosition);
window.addEventListener('beforeunload', saveReadPosition);

appInit();
