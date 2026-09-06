// Standard DOM ranges identify sentences without changing document markup,
// keeping note anchors, formatting, and text search intact.
let followAudio = true;

function speechMatchText(text) {
  return text.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}

function getSpeechRange(sentenceIdx) {
  const item = ttsList[sentenceIdx];
  if (!item) return null;
  const block = document.querySelector(`#doc-render [data-bid="${item.blockIdx}"]`);
  if (!block) return null;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const positions = [];
  let normalized = '';
  while (walker.nextNode()) {
    const node = walker.currentNode;
    for (let offset = 0; offset < node.length;) {
      const char = String.fromCodePoint(node.textContent.codePointAt(offset));
      const value = speechMatchText(char);
      for (const unit of value.split('')) {
        normalized += unit;
        positions.push({ node, offset, end: offset + char.length });
      }
      offset += char.length;
    }
  }
  let from = 0;
  // Search in reading order so repeated sentences map to their own occurrence.
  for (let i = 0; i <= sentenceIdx; i++) {
    if (ttsList[i].blockIdx !== item.blockIdx) continue;
    const needle = speechMatchText(ttsList[i].text);
    if (!needle) continue;
    const start = normalized.indexOf(needle, from);
    if (start < 0) { if (i === sentenceIdx) return null; continue; }
    from = start + needle.length;
    if (i !== sentenceIdx) continue;
    const first = positions[start];
    const last = positions[from - 1];
    const range = document.createRange();
    range.setStart(first.node, first.offset);
    range.setEnd(last.node, last.end);
    return range;
  }
  return null;
}

function setFollowAudio(enabled) {
  followAudio = enabled;
  const button = document.getElementById('follow-btn');
  button.setAttribute('aria-pressed', String(enabled));
  button.textContent = enabled ? 'Follow audio' : 'Resume following';
  button.title = enabled ? 'Automatically keep the spoken passage visible' : 'Return to the spoken passage and resume automatic scrolling';
}

function scrollReadingTarget(target, force = false, pinDuringPlayback = false) {
  if (!target || (!force && !followAudio)) return;
  // Let someone inspect tools or select text without moving their reading view.
  if (!force && (document.body.classList.contains('controls-open') && matchMedia('(max-width:900px)').matches || document.querySelector('.notes-panel.open, .note-modal.open'))) return;
  const container = document.getElementById('doc-view');
  if (!container || !container.clientHeight) return;
  const rect = target.getBoundingClientRect();
  const viewport = container.getBoundingClientRect();
  const top = viewport.top + 24;
  const bottom = viewport.bottom - 32;
  if (!pinDuringPlayback && rect.top >= top && rect.bottom <= bottom) return;
  const offset = rect.top - viewport.top - Math.min(container.clientHeight * .25, 120);
  // Timed narration can move again before a smooth animation finishes. Use an
  // immediate standards-based scroll while audio is playing so later sentence
  // marks cannot be trapped behind an earlier animation.
  const shouldMoveImmediately = force || playing || document.hidden || matchMedia('(prefers-reduced-motion:reduce)').matches;
  container.scrollTo({ top: container.scrollTop + offset, behavior: shouldMoveImmediately ? 'instant' : 'smooth' });
}

function highlightSpeechSentence(sentenceIdx, force = false) {
  const item = ttsList[sentenceIdx];
  if (!item) return;
  highlightBlock(item.blockIdx, false);
  const range = getSpeechRange(sentenceIdx);
  if (window.CSS?.highlights && typeof Highlight !== 'undefined') {
    CSS.highlights.delete('spoken-passage');
    if (range) CSS.highlights.set('spoken-passage', new Highlight(range));
  }
  const block = document.querySelector(`#doc-render [data-bid="${item.blockIdx}"]`);
  // For unusually tall units, show their first line instead of centering a
  // paragraph that extends beyond both edges of the reader.
  const firstRect = range && Array.from(range.getClientRects()).find(rect => rect.height > 0);
  // Keep the spoken line in a stable reading position while following audio.
  // This also prevents a previous scroll from making a new target appear
  // briefly visible while the browser is still moving toward the old target.
  scrollReadingTarget(firstRect ? { getBoundingClientRect: () => firstRect } : block, force, playing && followAudio);
}

document.getElementById('follow-btn').addEventListener('click', () => {
  setFollowAudio(!followAudio);
  if (followAudio) highlightSpeechSentence(idx, true);
});
const readingScrollContainer = document.getElementById('doc-view');
['wheel', 'touchmove'].forEach(event => readingScrollContainer.addEventListener(event, () => {
  if (playing) setFollowAudio(false);
}, { passive: true }));
readingScrollContainer.addEventListener('keydown', event => {
  if (playing && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) setFollowAudio(false);
});
readingScrollContainer.addEventListener('pointerdown', event => {
  const rect = readingScrollContainer.getBoundingClientRect();
  if (playing && event.clientX >= rect.left + readingScrollContainer.clientWidth) setFollowAudio(false);
});
