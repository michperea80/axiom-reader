const DB_NAME    = 'axiom-reader-db';
const DB_VERSION = 1;
let db = null;

function dbInit() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('folders')) {
        d.createObjectStore('folders', { keyPath: 'id', autoIncrement: true });
      }
      if (!d.objectStoreNames.contains('recentFiles')) {
        const rs = d.createObjectStore('recentFiles', { keyPath: 'id', autoIncrement: true });
        rs.createIndex('openedAt', 'openedAt', { unique: false });
      }
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

async function folderSave(name, handle) {
  return idbPut('folders', { name, handle, addedAt: Date.now() });
}
async function folderList() { return idbGetAll('folders'); }
async function folderDelete(id) { return idbDelete('folders', id); }

async function recentFileSave(name, content, folderId = null) {
  const all = await idbGetAll('recentFiles');
  const existing = all.find(f => f.name === name);
  const record = {
    ...(existing || {}),
    name, content, folderId,
    openedAt: Date.now(),
    readPosition: 0,
  };
  return idbPut('recentFiles', record);
}

async function recentFileUpdatePosition(id, position) {
  const all = await idbGetAll('recentFiles');
  const rec = all.find(f => f.id === id);
  if (rec) { rec.readPosition = position; return idbPut('recentFiles', rec); }
}

async function recentFileList(limit = 20) {
  const all = await idbGetAll('recentFiles');
  return all.sort((a, b) => b.openedAt - a.openedAt).slice(0, limit);
}

async function recentFileDelete(id) { return idbDelete('recentFiles', id); }

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)        return 'just now';
  if (s < 3600)      return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)     return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

async function renderLibraryScreen() {
  const [folders, recents] = await Promise.all([folderList(), recentFileList()]);

  const foldersEl = document.getElementById('lib-folders-grid');
  if (folders.length === 0) {
    foldersEl.innerHTML = '<p class="lib-empty">No folders saved yet.</p>';
  } else {
    foldersEl.innerHTML = folders.map(f => `
      <div class="folder-card" data-folder-id="${f.id}">
        <div class="folder-card-icon">${LOGO_SVG_SMALL}</div>
        <div class="folder-card-name">${escHtml(f.name)}</div>
        <button class="folder-card-delete" data-folder-id="${f.id}" title="Remove">✕</button>
      </div>
    `).join('');
  }

  const recentsEl = document.getElementById('lib-recents-list');
  if (recents.length === 0) {
    recentsEl.innerHTML = '<p class="lib-empty">No files opened yet.</p>';
  } else {
    recentsEl.innerHTML = recents.map(f => `
      <div class="recent-row">
        <div class="recent-info" data-recent-id="${f.id}">
          <span class="recent-name">${escHtml(f.name)}</span>
          <span class="recent-time">${timeAgo(f.openedAt)}</span>
        </div>
        <button class="recent-play" data-recent-id="${f.id}" title="Open">▶</button>
        <button class="recent-delete" data-recent-id="${f.id}" title="Remove">✕</button>
      </div>
    `).join('');
  }
}

async function renderBrowseScreen(folder, files) {
  document.getElementById('browse-folder-name').textContent = folder.name;
  const listEl = document.getElementById('browse-file-list');
  if (files.length === 0) {
    listEl.innerHTML = '<p class="lib-empty">No .md files found in this folder.</p>';
  } else {
    listEl.innerHTML = files.map((f, i) => `
      <div class="browse-row" data-browse-idx="${i}">
        <span class="browse-name">${escHtml(f.name)}</span>
        <span class="browse-arrow">›</span>
      </div>
    `).join('');
  }
  window._browseFiles    = files;
  window._browseFolderId = folder.id;
}

async function addFolder() {
  if (!window.showDirectoryPicker) {
    alert('Your browser does not support folder access.\nUse "Open file" in the reader to load files. They will be saved to Recent Files automatically.');
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'read' });
    await folderSave(handle.name, handle);
    await renderLibraryScreen();
  } catch (e) {
    if (e.name !== 'AbortError') console.error('addFolder:', e);
  }
}

async function browseFolder(folderId) {
  const folders = await folderList();
  const folder  = folders.find(f => f.id === folderId);
  if (!folder) return;

  let perm;
  try { perm = await folder.handle.requestPermission({ mode: 'read' }); }
  catch (_) { perm = 'denied'; }

  if (perm !== 'granted') {
    alert('Permission to access this folder was denied. Please add it again.');
    await folderDelete(folderId);
    await renderLibraryScreen();
    return;
  }

  const files = [];
  for await (const [name, fh] of folder.handle.entries()) {
    if (fh.kind === 'file' && (name.endsWith('.md') || name.endsWith('.txt'))) {
      files.push({ name, fh });
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  await renderBrowseScreen(folder, files);
  showScreen('browse');
}

async function openBrowseFile(idx) {
  const f        = window._browseFiles[idx];
  const folderId = window._browseFolderId;
  if (!f) return;
  const file    = await f.fh.getFile();
  const content = await file.text();
  const saved   = await recentFileSave(file.name, content, folderId);
  loadFile({ name: file.name, content, recentId: saved });
}

async function openRecentFile(id) {
  const all = await idbGetAll('recentFiles');
  const rec = all.find(f => f.id === id);
  if (!rec) return;
  rec.openedAt = Date.now();
  await idbPut('recentFiles', rec);
  loadFile({ name: rec.name, content: rec.content, recentId: rec.id, resumePosition: rec.readPosition });
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const LOGO_SVG_SMALL = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
  <circle cx="50" cy="50" r="20" fill="none" stroke="#00d4ff" stroke-width="3"
    style="filter:drop-shadow(0 0 6px #00d4ff)"/>
  <path d="M 50 10 A 40 40 0 0 1 85 27" fill="none" stroke="#8ab4c8" stroke-width="5"
    stroke-linecap="round"/>
  <path d="M 90 50 A 40 40 0 0 1 27 87" fill="none" stroke="#8ab4c8" stroke-width="5"
    stroke-linecap="round"/>
  <path d="M 15 72 A 40 40 0 0 1 14 30" fill="none" stroke="#8ab4c8" stroke-width="5"
    stroke-linecap="round"/>
</svg>`;
