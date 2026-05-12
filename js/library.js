const DB_NAME    = 'axiom-reader-db';
const DB_VERSION = 2;
let db = null;

function dbInit() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('recentFiles')) {
        const rs = d.createObjectStore('recentFiles', { keyPath: 'id', autoIncrement: true });
        rs.createIndex('openedAt', 'openedAt', { unique: false });
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
  const recents   = await recentFileList();
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
        <button class="recent-play" data-recent-id="${f.id}" title="Open">&#x25B6;</button>
        <button class="recent-delete" data-recent-id="${f.id}" title="Remove">&#x2715;</button>
      </div>
    `).join('');
  }
}

function handleDirSelection(fileList) {
  const files = Array.from(fileList)
    .filter(f => f.name.endsWith('.md') || f.name.endsWith('.txt'));
  if (files.length === 0) {
    alert('No .md or .txt files found in the selected folder.');
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
  const content = await f.text();
  const saved   = await recentFileSave(f.name, content, null);
  loadFile({ name: f.name, content, recentId: saved });
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
