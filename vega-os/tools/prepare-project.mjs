import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const vegaDir = path.resolve(toolDir, '..');
const repoRoot = path.resolve(vegaDir, '..');
const projectDir = path.resolve(process.argv[2] || path.join(vegaDir, 'generated', 'PlezyVega'));
const webSource = path.join(repoRoot, 'samsung-tizen');
const webDestination = path.join(projectDir, 'assets');
const appSource = path.join(vegaDir, 'overlay', 'src', 'App.tsx');
const appDestination = path.join(projectDir, 'src', 'App.tsx');
const manifestPath = path.join(projectDir, 'manifest.toml');

function requireFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file is missing: ${filePath}`);
  }
}

function addManifestEntry(manifest, table, id) {
  const entry = `[[${table}]]\nid = "${id}"`;
  if (manifest.includes(entry)) {
    return manifest;
  }
  return `${manifest.trimEnd()}\n\n${entry}\n`;
}

requireFile(path.join(webSource, 'index.html'));
requireFile(path.join(webSource, 'js', 'api.js'));
requireFile(path.join(webSource, 'js', 'app.js'));
requireFile(appSource);
requireFile(manifestPath);

fs.rmSync(webDestination, {recursive: true, force: true});
fs.cpSync(webSource, webDestination, {recursive: true});

for (const fileName of ['config.xml', '.tproject']) {
  fs.rmSync(path.join(webDestination, fileName), {force: true});
}

const indexPath = path.join(webDestination, 'index.html');
let indexHtml = fs.readFileSync(indexPath, 'utf8');
indexHtml = indexHtml
  .replace(/^\s*<script src="\$WEBAPIS\/[^\n]+\n/gm, '')
  .replace(/^\s*<script src="\$B2BAPIS\/[^\n]+\n/gm, '');
fs.writeFileSync(indexPath, indexHtml, 'utf8');

fs.mkdirSync(path.dirname(appDestination), {recursive: true});
fs.copyFileSync(appSource, appDestination);

let manifest = fs.readFileSync(manifestPath, 'utf8');
if (!/\[package\][\s\S]*?id\s*=\s*"com\.edde746\.plezy\.vega"/.test(manifest)) {
  throw new Error('The generated manifest package id is not com.edde746.plezy.vega. Regenerate with vega-os/build.sh.');
}
if (!manifest.includes('categories = ["com.amazon.category.main"]')) {
  throw new Error('The generated manifest is missing the required com.amazon.category.main category.');
}

const wantedServices = [
  'com.amazon.inputmethod.service',
  'com.amazon.media.server',
  'com.amazon.mediametrics.service',
  'com.amazon.mediabuffer.service',
  'com.amazon.mediatransform.service',
  'com.amazon.audio.stream',
  'com.amazon.audio.control',
  'com.amazon.kepler.ucc.publisher',
  'com.amazon.gipc.uuid.*',
];
for (const id of wantedServices) {
  manifest = addManifestEntry(manifest, 'wants.service', id);
}
manifest = addManifestEntry(manifest, 'offers.service', 'com.amazon.gipc.uuid.*');
fs.writeFileSync(manifestPath, manifest, 'utf8');

console.log(`Prepared Vega project: ${projectDir}`);
console.log(`Bundled web entry point: ${path.join(webDestination, 'index.html')}`);
