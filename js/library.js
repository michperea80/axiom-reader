const DB_NAME    = 'axiom-reader-db';
const DB_VERSION = 5;
let db = null;

const REVIEW_STATUS = {
  unread: 'Unread',
  in_review: 'In Review',
  needs_edits: 'Needs Edits',
  reviewed: 'Reviewed',
};

const HIGHLIGHT_KINDS = {
  important: { label: 'Important', color: 'gold' },
  needs_edit: { label: 'Needs Edit', color: 'red' },
  fact_check: { label: 'Fact-check', color: 'cyan' },
  continuity: { label: 'Continuity', color: 'teal' },
};

function normalizeReviewStatus(status) {
  return REVIEW_STATUS[status] ? status : 'unread';
}

function statusLabel(status) {
  return REVIEW_STATUS[normalizeReviewStatus(status)];
}

function normalizeHighlightKind(kind) {
  return HIGHLIGHT_KINDS[kind] ? kind : 'important';
}

function highlightLabel(kind) {
  return HIGHLIGHT_KINDS[normalizeHighlightKind(kind)].label;
}

function highlightColor(kind) {
  return HIGHLIGHT_KINDS[normalizeHighlightKind(kind)].color;
}

function dbInit() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('recentFiles')) {
        const rs = d.createObjectStore('recentFiles', { keyPath: 'id', autoIncrement: true });
        rs.createIndex('openedAt', 'openedAt', { unique: false });
      }
      if (!d.objectStoreNames.contains('notes')) {
        const ns = d.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
        ns.createIndex('fileId', 'fileId', { unique: false });
        ns.createIndex('fileBlock', ['fileId', 'blockIdx'], { unique: false });
      }
      if (!d.objectStoreNames.contains('highlights')) {
        const hs = d.createObjectStore('highlights', { keyPath: 'id', autoIncrement: true });
        hs.createIndex('fileId', 'fileId', { unique: false });
        hs.createIndex('fileBlock', ['fileId', 'blockIdx'], { unique: true });
      }
      if (d.objectStoreNames.contains('folders')) d.deleteObjectStore('folders');
    };
    req.onsuccess  = e => { db = e.target.result; resolve(db); };
    req.onerror    = e => reject(e.target.error);
  });
}

function tx(storeName, mode = 'readonly') {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function idbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName).getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function idbPut(storeName, record) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName, 'readwrite').put(record);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function idbDelete(storeName, id) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName, 'readwrite').delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

function idbClear(storeName) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName, 'readwrite').clear();
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

async function recentFileSave(name, content, folderId = null) {
  const all = await idbGetAll('recentFiles');
  const existing = all.find(f => f.name === name);
  const record = {
    ...(existing || {}),
    name, content, folderId,
    openedAt: Date.now(),
    readPosition: existing ? existing.readPosition || 0 : 0,
    readTotal: existing ? existing.readTotal || 0 : 0,
    reviewStatus: normalizeReviewStatus(existing ? existing.reviewStatus : 'unread'),
    reviewStatusUpdatedAt: existing ? existing.reviewStatusUpdatedAt || Date.now() : Date.now(),
    sourceType: /\.pdf$/i.test(name) ? 'pdf' : 'text',
  };
  const id = await idbPut('recentFiles', record);
  return { id, readPosition: record.readPosition };
}

async function recentFileGet(id) {
  const all = await idbGetAll('recentFiles');
  return all.find(f => f.id === id) || null;
}

async function recentFileUpdatePosition(id, position) {
  const rec = await recentFileGet(id);
  if (rec) { rec.readPosition = position; return idbPut('recentFiles', rec); }
}

async function recentFileUpdateReadMeta(id, position, total) {
  const rec = await recentFileGet(id);
  if (!rec) return;
  rec.readPosition = position;
  rec.readTotal = total;
  return idbPut('recentFiles', rec);
}

async function recentFileUpdateStatus(id, status) {
  const rec = await recentFileGet(id);
  if (!rec) return null;
  rec.reviewStatus = normalizeReviewStatus(status);
  rec.reviewStatusUpdatedAt = Date.now();
  await idbPut('recentFiles', rec);
  return rec.reviewStatus;
}

async function recentFileList(limit = 20) {
  const all = await idbGetAll('recentFiles');
  return all
    .map(f => ({
      ...f,
      readPosition: f.readPosition || 0,
      readTotal: f.readTotal || 0,
      reviewStatus: normalizeReviewStatus(f.reviewStatus),
      reviewStatusUpdatedAt: f.reviewStatusUpdatedAt || f.openedAt || Date.now(),
    }))
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, limit);
}

async function recentFileDelete(id) {
  const notes = await notesForFile(id);
  const highlights = await highlightsForFile(id);
  await Promise.all([
    ...notes.map(note => idbDelete('notes', note.id)),
    ...highlights.map(highlight => idbDelete('highlights', highlight.id)),
  ]);
  return idbDelete('recentFiles', id);
}

async function notesForFile(fileId) {
  if (fileId === null || fileId === undefined) return [];
  const all = await idbGetAll('notes');
  return all.filter(n => n.fileId === fileId).sort((a, b) => a.blockIdx - b.blockIdx || a.createdAt - b.createdAt);
}

async function noteForSection(fileId, blockIdx) {
  const notes = await notesForFile(fileId);
  return notes.find(n => n.blockIdx === blockIdx) || null;
}

async function noteSave(note) {
  const now = Date.now();
  const existing = await noteForSection(note.fileId, note.blockIdx);
  const record = {
    ...(existing || {}),
    ...note,
    noteText: note.noteText.trim(),
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };
  return idbPut('notes', record);
}

async function noteDelete(id) {
  return idbDelete('notes', id);
}

async function highlightsForFile(fileId) {
  if (fileId === null || fileId === undefined) return [];
  const all = await idbGetAll('highlights');
  return all.filter(h => h.fileId === fileId).sort((a, b) => a.blockIdx - b.blockIdx || a.createdAt - b.createdAt);
}

async function highlightForSection(fileId, blockIdx) {
  const highlights = await highlightsForFile(fileId);
  return highlights.find(h => h.blockIdx === blockIdx) || null;
}

async function highlightSave(highlight) {
  const now = Date.now();
  const existing = await highlightForSection(highlight.fileId, highlight.blockIdx);
  const kind = normalizeHighlightKind(highlight.kind || existing?.kind);
  const record = {
    ...(existing || {}),
    ...highlight,
    kind,
    label: highlightLabel(kind),
    color: highlightColor(kind),
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };
  return idbPut('highlights', record);
}

async function highlightDelete(id) {
  return idbDelete('highlights', id);
}

async function highlightToggle(highlight) {
  const existing = await highlightForSection(highlight.fileId, highlight.blockIdx);
  if (existing) {
    await highlightDelete(existing.id);
    return false;
  }
  await highlightSave(highlight);
  return true;
}

async function noteCountsByFile() {
  const notes = await idbGetAll('notes');
  return notes.reduce((counts, note) => {
    counts[note.fileId] = (counts[note.fileId] || 0) + 1;
    return counts;
  }, {});
}

async function highlightCountsByFile() {
  const highlights = await idbGetAll('highlights');
  return highlights.reduce((counts, highlight) => {
    counts[highlight.fileId] = (counts[highlight.fileId] || 0) + 1;
    return counts;
  }, {});
}

async function exportAppData() {
  return {
    schemaVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    recentFiles: await idbGetAll('recentFiles'),
    notes: await idbGetAll('notes'),
    highlights: await idbGetAll('highlights'),
    pronunciations: typeof exportPronunciationMapData === 'function' ? exportPronunciationMapData().pronunciations : {},
  };
}

async function importAppData(data) {
  if (!data || !Array.isArray(data.recentFiles) || !Array.isArray(data.notes)) {
    throw new Error('INVALID_BACKUP');
  }
  const highlights = Array.isArray(data.highlights) ? data.highlights : [];
  await idbClear('recentFiles');
  await idbClear('notes');
  await idbClear('highlights');
  await Promise.all(data.recentFiles.map(record => idbPut('recentFiles', record)));
  await Promise.all(data.notes.map(record => idbPut('notes', record)));
  await Promise.all(highlights.map(record => idbPut('highlights', record)));
  if (data.pronunciations && typeof importPronunciationMapData === 'function') {
    importPronunciationMapData(data.pronunciations);
  }
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)        return 'just now';
  if (s < 3600)      return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)     return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

async function renderLibraryScreen() {
  const recents   = await recentFileList();
  const recentsEl = document.getElementById('lib-recents-list');
  if (recents.length === 0) {
    recentsEl.innerHTML = '<p class="lib-empty">No files opened yet.</p>';
  } else {
    const noteCounts = await noteCountsByFile();
    const highlightCounts = await highlightCountsByFile();
    recentsEl.innerHTML = recents.map((f, index) => {
      const displayIndex = String(index + 1).padStart(2, '0');
      return `
      <div class="recent-row">
        <div class="recent-row-left recent-info" data-recent-id="${f.id}">
          <span class="recent-num">${displayIndex}</span>
          <div class="recent-info-block">
            <p class="recent-name">${escHtml(f.name)}</p>
            <div class="recent-meta">
              <span class="recent-status status-${normalizeReviewStatus(f.reviewStatus)}">${statusLabel(f.reviewStatus)}</span>
              <span class="recent-time">${timeAgo(f.openedAt)}</span>
              <span>${noteCounts[f.id] || 0} notes</span>
              <span>${highlightCounts[f.id] || 0} highlights</span>
              <span>${readPositionLabel(f)}</span>
            </div>
          </div>
        </div>
        <div class="recent-row-right">
          <button class="recent-action-btn recent-play" data-recent-id="${f.id}" title="Open">
            <span class="material-symbols-outlined" style="font-size: 18px">play_arrow</span>
          </button>
          <button class="recent-action-btn btn-delete recent-delete" data-recent-id="${f.id}" title="Remove">
            <span class="material-symbols-outlined" style="font-size: 18px">delete</span>
          </button>
        </div>
      </div>
    `;
    }).join('');
  }
}

function handleDirSelection(fileList) {
  const files = Array.from(fileList)
    .filter(f => /\.(md|txt|pdf)$/i.test(f.name));
  if (files.length === 0) {
    alert('No .md, .txt, or .pdf files found in the selected folder.');
    return;
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  const folderName = files[0].webkitRelativePath
    ? files[0].webkitRelativePath.split('/')[0]
    : 'Folder';
  renderBrowseScreenFromFiles(folderName, files);
  showScreen('browse');
}

function renderBrowseScreenFromFiles(folderName, files) {
  document.getElementById('browse-folder-name').textContent = folderName;
  const listEl = document.getElementById('browse-file-list');
  listEl.innerHTML = files.map((f, i) => `
    <div class="browse-row" data-browse-idx="${i}">
      <span class="browse-name">${escHtml(f.name)}</span>
      <span class="browse-arrow">&#x203A;</span>
    </div>
  `).join('');
  window._browseFiles = files;
}

async function openBrowseFile(idx) {
  const f = window._browseFiles[idx];
  if (!f) return;
  try {
    const content = await readSupportedFile(f);
    const saved   = await recentFileSave(f.name, content, null);
    loadFile({ name: f.name, content, recentId: saved.id, resumePosition: saved.readPosition });
  } catch (err) {
    showFileOpenError(err);
  }
}

async function openRecentFile(id) {
  const rec = await recentFileGet(id);
  if (!rec) return;
  rec.openedAt = Date.now();
  rec.reviewStatus = normalizeReviewStatus(rec.reviewStatus);
  rec.reviewStatusUpdatedAt = rec.reviewStatusUpdatedAt || Date.now();
  await idbPut('recentFiles', rec);
  loadFile({ name: rec.name, content: rec.content, recentId: rec.id, resumePosition: rec.readPosition });
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function readPositionLabel(file) {
  if (!file.readTotal) return 'Pos -';
  const current = Math.min(file.readTotal, (file.readPosition || 0) + 1);
  return `Pos ${current}/${file.readTotal}`;
}
