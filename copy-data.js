const fs = require('fs-extra');
const path = require('path');

const srcDir = path.resolve('../lol-haikesi/public/data');
const dstDir = path.resolve('./electron/data');

console.log('Source:', srcDir);
console.log('Destination:', dstDir);

// Ensure destination directory exists
fs.ensureDirSync(dstDir);

// Copy individual files
const files = [
  'champions-stats.json',
  'augments-base.json',
  'augment-detail.json',
  'items-i18n.json'
];

console.log('\nCopying files...');
files.forEach(file => {
  const src = path.join(srcDir, file);
  const dst = path.join(dstDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst);
    console.log('✓', file);
  } else {
    console.log('✗', file, '(not found)');
  }
});

// Copy directories
console.log('\nCopying directories...');
const championAugmentsSrc = path.join(srcDir, 'champion-augments');
const championAugmentsDst = path.join(dstDir, 'champion-augments');
if (fs.existsSync(championAugmentsSrc)) {
  fs.copySync(championAugmentsSrc, championAugmentsDst, { overwrite: true });
  const count = fs.readdirSync(championAugmentsDst).length;
  console.log('✓ champion-augments (' + count + ' files)');
} else {
  console.log('✗ champion-augments (not found)');
}

const buildsSrc = path.join(srcDir, 'builds', 'HOWLING_ABYSS_ARAM');
const buildsDst = path.join(dstDir, 'builds_aram');
if (fs.existsSync(buildsSrc)) {
  fs.ensureDirSync(buildsDst);
  fs.copySync(buildsSrc, buildsDst, { overwrite: true });
  const count = fs.readdirSync(buildsDst).length;
  console.log('✓ builds_aram (' + count + ' files)');
} else {
  console.log('✗ builds_aram (not found)');
}

console.log('\nData copy completed!');
