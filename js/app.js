let currentRecentId = null;

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
}

function loadFile(src) {
  const process = content => {
    stopTTS();
    idx = 0;
    currentRecentId = src.recentId || null;

    const md     = preprocess(content);
    const blocks = parseBlocks(md);
    const { h1Idx, infocardStart, infocardEnd, endMatterIdx } = categorize(blocks);
    document.getElementById('doc-render').innerHTML =
      buildDoc(blocks, h1Idx, infocardStart, infocardEnd, endMatterIdx);
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
  if (currentRecentId !== null && idx > 0) {
    recentFileUpdatePosition(currentRecentId, idx);
  }
}

async function appInit() {
  await dbInit();
  setupMediaSession();
  showScreen('library');
  await renderLibraryScreen();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
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
  document.getElementById('rate-val').textContent = parseFloat(this.value).toFixed(1) + '\xD7';
  if (playing) { stopTTS(); startTTS(); }
});

document.getElementById('voice-sel').addEventListener('change', () => {
  localStorage.setItem(SAVED_VOICE_KEY, document.getElementById('voice-sel').value);
  if (playing) { stopTTS(); startTTS(); }
});

document.getElementById('file-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const content = await file.text();
  const saved = await recentFileSave(file.name, content, null);
  loadFile({ name: file.name, content, recentId: saved });
  e.target.value = '';
});

document.getElementById('load-pick-btn').addEventListener('click', () =>
  document.getElementById('file-input').click()
);
document.getElementById('open-btn').addEventListener('click', () =>
  document.getElementById('file-input').click()
);

document.getElementById('doc-render').addEventListener('click', e => {
  const el = e.target.closest('[data-bid]');
  if (!el) return;
  const bi      = parseInt(el.dataset.bid);
  const sentIdx = ttsList.findIndex(s => s.blockIdx === bi);
  if (sentIdx < 0) return;
  const was = playing; stopTTS();
  idx = sentIdx;
  if (was) startTTS(); else { highlightBlock(bi); updatePos(); }
});

appInit();
