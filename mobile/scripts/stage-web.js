const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '../..');
const targetDir = path.resolve(__dirname, '../www');

const itemsToCopy = [
  'index.html',
  'manifest.json',
  'sw.js',
  'css',
  'js',
  'font',
  'icons',
  'vendor',
  'tests'
];

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

console.log(`Staging web reader assets into ${targetDir}...`);

if (fs.existsSync(targetDir)) {
  fs.rmSync(targetDir, { recursive: true, force: true });
}
fs.mkdirSync(targetDir, { recursive: true });

for (const item of itemsToCopy) {
  const srcPath = path.join(rootDir, item);
  const destPath = path.join(targetDir, item);
  if (fs.existsSync(srcPath)) {
    copyRecursive(srcPath, destPath);
    console.log(`  ✓ Copied ${item}`);
  } else {
    console.warn(`  ! Skipped missing item: ${item}`);
  }
}

console.log('Staging complete.');
