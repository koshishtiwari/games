// Writes games/<game>/manifest.json listing every file the game needs at
// runtime (everything except thumbnails and source dirs). The app downloads
// these so games work offline. Run before `wrangler pages deploy games`.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'games');
const SKIP_DIRS = new Set(['src', 'node_modules', '.git']);
const SKIP_FILES = /^(\.DS_Store|manifest\.json|thumbnail\..+)$/;
function walk(dir, rel = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : walk(path.join(dir, e.name), rel + e.name + '/');
    return SKIP_FILES.test(e.name) ? [] : [rel + e.name];
  });
}
for (const d of fs.readdirSync(root, { withFileTypes: true })) {
  if (!d.isDirectory() || d.name.startsWith('.')) continue;
  const dir = path.join(root, d.name);
  if (!fs.existsSync(path.join(dir, 'index.html'))) continue;
  const mf = path.join(dir, 'manifest.json');
  // Existing manifests may be hand-curated (mr-strange lists src/ files). Only overwrite with --force.
  if (fs.existsSync(mf) && !process.argv.includes('--force')) { console.log(d.name, 'manifest exists, kept'); continue; }
  const files = walk(dir).sort();
  fs.writeFileSync(mf, JSON.stringify({ files }, null, 1) + '\n');
  console.log(d.name, files.length, 'files');
}
