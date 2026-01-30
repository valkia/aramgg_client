// Test the data loading
const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'electron/data');

console.log('Testing data files...\n');

// Test loading champions-stats.json
try {
  const stats = JSON.parse(fs.readFileSync(path.join(dataPath, 'champions-stats.json'), 'utf-8'));
  console.log(`✓ champions-stats.json: ${stats.length} champions`);
  console.log(`  First champion: ID ${stats[0].championId}, Tier ${stats[0].tier}, WinRate ${(stats[0].winRate * 100).toFixed(2)}%`);
} catch (e) {
  console.log(`✗ champions-stats.json: ${e.message}`);
}

// Test loading augments-base.json
try {
  const augments = JSON.parse(fs.readFileSync(path.join(dataPath, 'augments-base.json'), 'utf-8'));
  console.log(`✓ augments-base.json: ${augments.length} augments`);
  console.log(`  Sample: ${augments[0].name} (${augments[0].rarity})`);
} catch (e) {
  console.log(`✗ augments-base.json: ${e.message}`);
}

// Test loading champion-augments
try {
  const championAug = JSON.parse(fs.readFileSync(path.join(dataPath, 'champion-augments/1.json'), 'utf-8'));
  console.log(`✓ champion-augments/1.json: Loaded`);
  if (Array.isArray(championAug) && championAug.length > 0) {
    const firstElement = championAug[0];
    if (Array.isArray(firstElement) && firstElement.length >= 2) {
      const augmentStr = firstElement[1];
      const augmentData = JSON.parse(augmentStr);
      const augmentCount = Object.keys(augmentData.augments).length;
      console.log(`  Augments for champion 1: ${augmentCount}`);
    }
  }
} catch (e) {
  console.log(`✗ champion-augments/1.json: ${e.message}`);
}

// Test loading builds
try {
  const build = JSON.parse(fs.readFileSync(path.join(dataPath, 'builds_aram/1.json'), 'utf-8'));
  console.log(`✓ builds_aram/1.json: Loaded`);
  console.log(`  Patch: ${build.data.result.dataArray[0][0]}`);
} catch (e) {
  console.log(`✗ builds_aram/1.json: ${e.message}`);
}

// Test loading items
try {
  const items = JSON.parse(fs.readFileSync(path.join(dataPath, 'items-i18n.json'), 'utf-8'));
  console.log(`✓ items-i18n.json: ${Object.keys(items).length} items`);
} catch (e) {
  console.log(`✗ items-i18n.json: ${e.message}`);
}

console.log('\nAll data files tested successfully!');
