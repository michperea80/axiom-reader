let ttsList = [];

const PRONUNCIATION_STORAGE_KEY = 'axiom-reader-pronunciation-map';

const BUILT_IN_SPEECH_WORD_MAP = {
  AXIOM: 'Axiom',
  TERRAN: 'Terran',
  PELARI: 'Pelari',
  CHORUS: 'Chorus',
  KELEDH: 'Keledh',
  VOROKH: 'Vorokh',
  SKORTH: 'Skorth',
  VEYDRAN: 'Veydran',
  SOLARIOTH: 'Solarioth',
  SYSTEM: 'system',
  STATUS: 'status',
  CLASSIFICATION: 'classification',
  HEADER: 'header',
  REGISTRY: 'registry',
  DOCUMENT: 'document',
  REVISION: 'revision',
  HISTORY: 'history',
  NOTES: 'notes',
  PAGE: 'page',
  PART: 'part',
  CHAPTER: 'chapter',
  SECTION: 'section',
  PHASE: 'phase',
  ACT: 'act',
  BOOK: 'book',
  VOLUME: 'volume',
  APPENDIX: 'appendix',
};

let customSpeechWordMap = {};

function sanitizePronunciationMap(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return {};
  return Object.entries(map).reduce((clean, [key, value]) => {
    const normalizedKey = String(key).trim().toUpperCase();
    const normalizedValue = String(value).trim();
    if (/^[A-Z0-9][A-Z0-9_-]*$/.test(normalizedKey) && normalizedValue) {
      clean[normalizedKey] = normalizedValue;
    }
    return clean;
  }, {});
}

function loadCustomPronunciationMap() {
  try {
    customSpeechWordMap = sanitizePronunciationMap(JSON.parse(localStorage.getItem(PRONUNCIATION_STORAGE_KEY) || '{}'));
  } catch (_) {
    customSpeechWordMap = {};
  }
  return customSpeechWordMap;
}

function saveCustomPronunciationMap(map) {
  customSpeechWordMap = sanitizePronunciationMap(map);
  localStorage.setItem(PRONUNCIATION_STORAGE_KEY, JSON.stringify(customSpeechWordMap, null, 2));
  return customSpeechWordMap;
}

function exportPronunciationMapData() {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    pronunciations: customSpeechWordMap,
  };
}

function importPronunciationMapData(data) {
  const map = data && data.pronunciations ? data.pronunciations : data;
  return saveCustomPronunciationMap(map);
}

function speechWordMap() {
  return { ...BUILT_IN_SPEECH_WORD_MAP, ...customSpeechWordMap };
}

const ROMAN_CONTEXT = '(Part|Chapter|Phase|Section|Act|Book|Volume|Appendix)';

function romanToNumber(roman) {
  const values = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  let prev = 0;
  for (let i = roman.length - 1; i >= 0; i -= 1) {
    const value = values[roman[i]];
    if (!value) return null;
    if (value < prev) total -= value;
    else {
      total += value;
      prev = value;
    }
  }
  if (total < 1 || total > 3999) return null;
  return total;
}

function numberToWords(num) {
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const teens = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  if (num < 10) return ones[num];
  if (num < 20) return teens[num - 10];
  if (num < 100) return `${tens[Math.floor(num / 10)]}${num % 10 ? ` ${ones[num % 10]}` : ''}`;
  if (num < 1000) return `${ones[Math.floor(num / 100)]} hundred${num % 100 ? ` ${numberToWords(num % 100)}` : ''}`;
  return `${ones[Math.floor(num / 1000)]} thousand${num % 1000 ? ` ${numberToWords(num % 1000)}` : ''}`;
}

function normalizeRomanNumeralsInHeading(text) {
  return text.replace(new RegExp(`\\b${ROMAN_CONTEXT}\\s+([IVXLCDM]+)\\b`, 'gi'), (match, label, roman) => {
    const value = romanToNumber(roman.toUpperCase());
    return value ? `${label} ${numberToWords(value)}` : match;
  });
}

function normalizeSpeechText(text, blockType = 'para') {
  let speech = text.replace(/\s+/g, ' ').trim();
  if (blockType === 'heading') speech = normalizeRomanNumeralsInHeading(speech);
  const map = speechWordMap();
  return speech.replace(/\b[A-Z0-9][A-Z0-9_-]{2,}\b/g, word => map[word] || word);
}

function addTtsItem(text, blockIdx, blockType = 'para') {
  const rawText = text.trim();
  if (!rawText) return;
  ttsList.push({
    text: rawText,
    speechText: normalizeSpeechText(rawText, blockType),
    blockIdx,
    blockType,
  });
}

function preprocess(raw) {
  let md = raw;
  md = md.replace(/^<!--.*?-->\s*$/gm, '');
  md = md.replace(/^---[\s\S]*?---\s*\n/m, '');
  md = md.replace(/\n{3,}/g, '\n\n');
  return md.trim();
}

function parseBlocks(md) {
  const lines = md.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (/^```/.test(line)) {
      const code = [];
      const fence = line.match(/^(`{3,})/)[1];
      i++;
      while (i < lines.length && !lines[i].startsWith(fence)) { code.push(lines[i]); i++; }
      i++;
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }

    const hm = line.match(/^(#{1,4})\s+(.+)/);
    if (hm) { blocks.push({ type: 'heading', level: hm[1].length, text: hm[2].trim() }); i++; continue; }

    if (/^[-*_=]{3,}\s*$/.test(line.trim())) { blocks.push({ type: 'hr' }); i++; continue; }

    if (/^[\t ]*[-*+]\s/.test(line)) {
      const items = [];
      while (i < lines.length) {
        if (/^[\t ]*[-*+]\s/.test(lines[i])) { items.push(lines[i].replace(/^[\t ]*[-*+]\s+/, '').trim()); i++; }
        else if (!lines[i].trim() && i + 1 < lines.length && /^[\t ]*[-*+]\s/.test(lines[i+1])) { i++; }
        else break;
      }
      if (items.length) blocks.push({ type: 'list', ordered: false, items });
      continue;
    }

    if (/^[\t ]*\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length) {
        if (/^[\t ]*\d+\.\s/.test(lines[i])) { items.push(lines[i].replace(/^[\t ]*\d+\.\s+/, '').trim()); i++; }
        else if (!lines[i].trim() && i + 1 < lines.length && /^[\t ]*\d+\.\s/.test(lines[i+1])) { i++; }
        else break;
      }
      if (items.length) blocks.push({ type: 'list', ordered: true, items });
      continue;
    }

    if (/^\|/.test(line)) {
      const rows = [];
      let isHeader = true;
      while (i < lines.length && /^\|/.test(lines[i])) {
        if (/^\|[\s\-:|]+\|/.test(lines[i])) { i++; isHeader = false; continue; }
        const cells = lines[i].split('|').slice(1, -1).map(c => c.trim());
        rows.push({ cells, isHeader });
        isHeader = false; i++;
      }
      if (rows.length > 0) rows[0].isHeader = true;
      blocks.push({ type: 'table', rows });
      continue;
    }

    if (/^>/.test(line)) {
      const qlines = [];
      while (i < lines.length && (/^>/.test(lines[i]) || (!lines[i].trim() && i + 1 < lines.length && /^>/.test(lines[i+1])))) {
        qlines.push(lines[i].replace(/^>\s?/, '')); i++;
      }
      blocks.push({ type: 'blockquote', text: qlines.join('\n') });
      continue;
    }

    const pLines = [];
    while (i < lines.length && lines[i].trim()) {
      if (/^#{1,4}\s/.test(lines[i])) break;
      if (/^[-*_=]{3,}\s*$/.test(lines[i].trim())) break;
      if (/^[\t ]*[-*+]\s/.test(lines[i])) break;
      if (/^[\t ]*\d+\.\s/.test(lines[i])) break;
      if (/^>/.test(lines[i])) break;
      if (/^```/.test(lines[i])) break;
      if (/^\|/.test(lines[i])) break;
      pLines.push(lines[i]); i++;
    }
    if (pLines.length) blocks.push({ type: 'para', text: pLines.join('\n') });
  }
  return blocks;
}

function categorize(blocks) {
  const h1Idx = blocks.findIndex(b => b.type === 'heading' && b.level === 1);
  const firstH2Idx = blocks.findIndex((b, i) => i > Math.max(h1Idx, 0) && b.type === 'heading' && b.level === 2);
  const infocardStart = h1Idx >= 0 && firstH2Idx > h1Idx + 1 ? h1Idx + 1 : -1;
  const infocardEnd   = infocardStart >= 0 ? firstH2Idx : -1;

  const END_PAT = /\b(revision\s+history|revision\s+notes?|amendment\s+log|change\s+log|errata|document\s+history)\b/i;
  let endMatterIdx = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type === 'heading' && END_PAT.test(blocks[i].text)) { endMatterIdx = i; break; }
  }
  if (endMatterIdx < 0) {
    for (let i = blocks.length - 1; i >= Math.max(0, blocks.length - 6); i--) {
      if (blocks[i].type === 'hr' && i + 1 < blocks.length) {
        const after = blocks[i + 1];
        if (after && after.type === 'para') {
          const lines = after.text.split('\n').filter(l => l.trim());
          const kv = lines.filter(l => /\*\*[\w\s]+:\*\*|[\w\s]+:\s/.test(l));
          if (kv.length >= 2) { endMatterIdx = i; break; }
        }
      }
    }
  }
  return { h1Idx, infocardStart, infocardEnd, endMatterIdx };
}

function inline(text) {
  let t = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  t = t.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  t = t.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/__(.+?)__/g, '<strong>$1</strong>');
  t = t.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
  t = t.replace(/_([^_\n]+?)_/g, '<em>$1</em>');
  t = t.replace(/~~(.+?)~~/g, '<del>$1</del>');
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  t = t.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
  return t;
}

function stripInline(text) {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g,'$1').replace(/___(.+?)___/g,'$1')
    .replace(/\*\*(.+?)\*\*/g,'$1').replace(/__(.+?)__/g,'$1')
    .replace(/\*([^*\n]+?)\*/g,'$1').replace(/_([^_\n]+?)_/g,'$1')
    .replace(/~~(.+?)~~/g,'$1').replace(/`([^`]+)`/g,'$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g,'$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g,'$1')
    .trim();
}

function splitSentences(text) {
  if (!text.trim()) return [];
  const parts = text.split(/(?<=[.!?…])\s+(?=[A-Z"'(\[])|\n\n+/);
  return parts.map(s => s.trim()).filter(s => s.length > 2);
}

function buildDoc(blocks, h1Idx, infocardStart, infocardEnd, endMatterIdx) {
  ttsList = [];
  let html = '';
  let infocardLines = [];
  let infocardHtml = '';

  if (infocardStart >= 0) {
    for (let bi = infocardStart; bi < infocardEnd; bi++) {
      const b = blocks[bi];
      if (b.type === 'hr') continue;
      if (b.type === 'para') {
        infocardLines.push(b.text.split('\n').filter(l => l.trim()).map(l => `<div>${inline(l)}</div>`).join(''));
      } else if (b.type === 'heading') {
        infocardLines.push(`<div style="letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">${inline(b.text)}</div>`);
      }
    }
    infocardHtml = infocardLines.join('<hr style="border:none;border-top:1px solid rgba(0,212,255,0.08);margin:6px 0">');
  }

  blocks.forEach((block, bi) => {
    const isInfocard  = infocardStart >= 0 && bi >= infocardStart && bi < infocardEnd;
    const isEndMatter = endMatterIdx >= 0 && bi >= endMatterIdx;

    if (bi === infocardEnd && infocardHtml) {
      html += `<div class="infocard"><div class="infocard-label">// Classification Header — not read aloud</div>${infocardHtml}</div>`;
    }
    if (isInfocard) return;

    const eid = isEndMatter ? '' : ` data-bid="${bi}"`;

    if (block.type === 'hr') { html += isEndMatter ? `<hr class="endmatter">` : `<hr>`; return; }
    if (block.type === 'code') {
      const safe = block.text.replace(/</g,'&lt;').replace(/>/g,'&gt;');
      html += isEndMatter ? `<pre class="endmatter"><code>${safe}</code></pre>` : `<pre><code>${safe}</code></pre>`;
      return;
    }
    if (block.type === 'table') {
      let thtml = '<table>';
      block.rows.forEach(row => {
        thtml += '<tr>';
        row.cells.forEach(cell => { const tag = row.isHeader ? 'th' : 'td'; thtml += `<${tag}>${inline(cell)}</${tag}>`; });
        thtml += '</tr>';
      });
      thtml += '</table>';
      if (isEndMatter) { html += `<div class="endmatter">${thtml}</div>`; }
      else { block.rows.forEach(row => { if (!row.isHeader) { const t = row.cells.map(stripInline).filter(Boolean).join(': '); if (t) addTtsItem(t, bi, 'table'); } }); html += `<div${eid}>${thtml}</div>`; }
      return;
    }
    if (block.type === 'heading') {
      const tag = `h${block.level}`;
      if (isEndMatter) { html += `<${tag} class="endmatter">${inline(block.text)}</${tag}>`; }
      else { addTtsItem(stripInline(block.text), bi, 'heading'); html += `<${tag}${eid}>${inline(block.text)}</${tag}>`; }
      return;
    }
    if (block.type === 'para') {
      const display = block.text.split('\n').map(inline).join(' ');
      if (isEndMatter) { html += `<p class="endmatter">${display}</p>`; }
      else { splitSentences(stripInline(block.text)).forEach(s => addTtsItem(s, bi, 'para')); html += `<p${eid}>${display}</p>`; }
      return;
    }
    if (block.type === 'blockquote') {
      const display = block.text.split('\n').map(inline).join('<br>');
      if (isEndMatter) { html += `<blockquote class="endmatter">${display}</blockquote>`; }
      else { splitSentences(stripInline(block.text)).forEach(s => addTtsItem(s, bi, 'blockquote')); html += `<blockquote${eid}>${display}</blockquote>`; }
      return;
    }
    if (block.type === 'list') {
      const tag = block.ordered ? 'ol' : 'ul';
      const items = block.items.map(item => `<li>${inline(item)}</li>`).join('');
      if (isEndMatter) { html += `<${tag} class="endmatter">${items}</${tag}>`; }
      else { block.items.forEach(item => addTtsItem(stripInline(item), bi, 'list')); html += `<${tag}${eid}>${items}</${tag}>`; }
    }
  });
  return html;
}
