const PDFJS_BASE_URL = new URL('../vendor/pdfjs/', document.currentScript.src).href;
let pdfjsLibPromise = null;

async function getPdfjsLib() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import(PDFJS_BASE_URL + 'pdf.min.mjs').then(pdfjsLib => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE_URL + 'pdf.worker.min.mjs';
      return pdfjsLib;
    });
  }
  return pdfjsLibPromise;
}

function normalizePdfText(text) {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function textItemsToParagraphs(items) {
  const rows = [];
  items.forEach(item => {
    const str = (item.str || '').trim();
    if (!str) return;
    const y = Math.round(item.transform[5]);
    let row = rows.find(r => Math.abs(r.y - y) <= 2);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push({ x: item.transform[4], str });
  });

  rows.sort((a, b) => b.y - a.y);
  return rows
    .map(row => row.items.sort((a, b) => a.x - b.x).map(item => item.str).join(' '))
    .join('\n')
    .replace(/([a-z,;:])\n(?=[a-z])/g, '$1 ')
    .replace(/\n{2,}/g, '\n\n');
}

async function extractPdfToMarkdown(file) {
  const pdfjsLib = await getPdfjsLib();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = normalizePdfText(textItemsToParagraphs(textContent.items));
    if (pageText) pages.push(`## Page ${pageNumber}\n\n${pageText}`);
  }

  if (!pages.length) {
    throw new Error('NO_EXTRACTABLE_TEXT');
  }

  const title = file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim() || file.name;
  return `# ${title}\n\n${pages.join('\n\n')}`;
}

function isPdfFile(file) {
  return file && (/\.pdf$/i.test(file.name) || file.type === 'application/pdf');
}
